import type { Express } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { insertCredentialRequestSchema } from "@shared/schema";
import {
  anchorCredentialRequestOnChain,
  issueCredentialOnChain,
  isBlockchainReady,
  waitForClientTx,
} from "../blockchain";
import { requireAuth, requireRole } from "../auth/jwt";
import { sensitiveLimiter } from "../middleware/security";
import { readPageOpts, sendPage } from "../middleware/pagination";
import { childLogger } from "../logger";

const log = childLogger("routes/credential-requests");

/**
 * User-to-issuer credential request workflow.
 */
export function registerCredentialRequestRoutes(app: Express) {
  app.post("/api/credential-requests", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      // Full-SSI flag: if true, server creates the request off-chain and
      // the holder's wallet will sign its own audit anchor via MetaMask
      // and link it via POST /api/credential-requests/:id/anchor.
      const { clientWillAnchor, ...rest } = req.body ?? {};
      const body = { ...rest, requesterAddress: req.auth!.sub };
      const data = insertCredentialRequestSchema.parse(body);
      const wallet = await storage.getWallet(data.requesterAddress);
      if (!wallet) return res.status(400).json({ message: "Wallet not connected" });

      if (data.issuerAddress) {
        const issuer = await storage.getIssuerByAddress(data.issuerAddress);
        if (!issuer || !issuer.active) {
          return res.status(400).json({ message: "Invalid or inactive issuer" });
        }
      }

      const request = await storage.createCredentialRequest(data);

      let onChainTxHash: string | null = null;
      let onChainBlockNumber: string | null = null;

      // Legacy server-signed path: only when client hasn't opted into
      // self-signing the request anchor.
      if (!clientWillAnchor && isBlockchainReady()) {
        try {
          const r = await anchorCredentialRequestOnChain(
            request.id,
            data.requesterAddress,
            data.claimType,
            "request_created",
          );
          onChainTxHash = r.txHash;
          onChainBlockNumber = r.blockNumber;
          log.info({ txHash: r.txHash, blockNumber: r.blockNumber }, "credential request anchored on-chain (server)");
        } catch (err: any) {
          log.error({ err: err.message }, "credential request on-chain anchoring failed");
        }
      }

      await storage.createTransaction({
        txHash: onChainTxHash || "0x" + crypto.randomBytes(32).toString("hex"),
        action: "credential_requested",
        fromAddress: data.requesterAddress,
        toAddress: data.issuerAddress || null,
        data: {
          requestId: request.id,
          claimType: data.claimType,
          issuerCategory: data.issuerCategory || null,
          onChain: !!onChainTxHash,
        },
        blockNumber: onChainBlockNumber || "0",
      });

      if (onChainTxHash) {
        await storage.updateCredentialRequestOnChainTxHash(request.id, onChainTxHash);
      }

      res.json({ ...request, onChainTxHash });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * Link a client-signed audit-anchor tx to a credential request. Used by
   * the Full-SSI request-creation flow: holder's wallet signs a self-tx
   * with encoded KRYDO_CRED_REQUEST_V1 payload, then POSTs the hash here
   * so the server can verify the Sepolia receipt and persist it.
   *
   * Only the requester (or root) can anchor their own request.
   */
  app.post("/api/credential-requests/:id/anchor", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { txHash } = req.body ?? {};
      if (!txHash || typeof txHash !== "string") {
        return res.status(400).json({ message: "txHash is required" });
      }
      if (!/^0x[0-9a-f]{64}$/i.test(txHash)) {
        return res.status(400).json({ message: "txHash is not a valid Ethereum transaction hash" });
      }

      const request = await storage.getCredentialRequest(id);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const caller = req.auth!.sub.toLowerCase();
      const isOwner = request.requesterAddress.toLowerCase() === caller;
      const isRoot = req.auth!.role === "root";
      if (!isOwner && !isRoot) {
        return res
          .status(403)
          .json({ message: "Only the requester can anchor this request" });
      }

      if (!isBlockchainReady()) {
        return res
          .status(503)
          .json({ message: "Blockchain provider not configured on this server" });
      }

      const result = await waitForClientTx(txHash, { timeoutMs: 45_000 });
      if (result.status === "unknown") {
        return res.status(422).json({
          message: "Anchor tx not found on Sepolia. Retry signing.",
          status: result.status,
        });
      }
      if (result.status === "reverted") {
        return res.status(422).json({
          message: "Anchor tx reverted. Request was not anchored on-chain.",
          status: result.status,
          blockNumber: result.blockNumber,
        });
      }

      await storage.updateCredentialRequestOnChainTxHash(id, txHash);

      // Update the related transaction row too.
      const txs = await storage.getTransactions(request.requesterAddress);
      const reqTx = txs.find(
        (t) => t.data && (t.data as any).requestId === id,
      );
      if (reqTx) {
        if (result.status === "confirmed") {
          await storage.updateTransactionOnChain(reqTx.id, txHash, result.blockNumber);
        } else {
          await storage.updateTransactionTxHash(reqTx.id, txHash);
        }
      }

      log.info(
        { requestId: id, txHash, status: result.status },
        "credential request anchored on-chain (MetaMask)",
      );

      res.json({
        success: true,
        requestId: id,
        txHash,
        status: result.status,
        blockNumber: result.status === "confirmed" ? result.blockNumber : undefined,
      });
    } catch (error: any) {
      log.error({ err: error.message }, "failed to anchor credential request");
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * Delete a credential request. Used by the Full-SSI client flow to roll
   * back a request when the holder cancels the MetaMask anchor popup —
   * otherwise an un-anchored, un-wanted request would linger in the
   * issuer's pending queue.
   *
   * Hard constraints:
   *   - Only the requester (or root) can delete their own request.
   *   - Only `pending` requests are deletable; once approved / rejected /
   *     issued the audit trail is preserved.
   *   - Requests that already carry a confirmed on-chain anchor cannot be
   *     deleted (we don't erase anchored history, even when pending).
   */
  app.delete("/api/credential-requests/:id", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const request = await storage.getCredentialRequest(id);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const caller = req.auth!.sub.toLowerCase();
      const isOwner = request.requesterAddress.toLowerCase() === caller;
      const isRoot = req.auth!.role === "root";
      if (!isOwner && !isRoot) {
        return res.status(403).json({ message: "Only the requester can delete this request" });
      }

      if (request.status !== "pending") {
        return res.status(409).json({
          message: `Cannot delete request in status '${request.status}'. Only pending requests can be deleted.`,
        });
      }

      if (request.onChainTxHash) {
        return res.status(409).json({
          message: "Request already anchored on-chain and cannot be deleted.",
        });
      }

      await storage.deleteCredentialRequest(id);
      log.info({ requestId: id, deletedBy: caller }, "credential request deleted");
      res.json({ success: true, id });
    } catch (error: any) {
      log.error({ err: error.message }, "failed to delete credential request");
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/credential-requests/user/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const page = await storage.listCredentialRequestsByRequesterPaged(address, readPageOpts(req));
      sendPage(res, page);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/credential-requests/issuer/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const page = await storage.listCredentialRequestsForIssuerPaged(address, readPageOpts(req));
      sendPage(res, page);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/credential-requests/:id/respond",
    requireAuth,
    requireRole("issuer", "root"),
    sensitiveLimiter,
    async (req, res) => {
      try {
        const id = req.params.id as string;
        const {
          status,
          responseMessage,
          claimSummary,
          claimValue,
          claimData,
          expiresAt: rawExpiresAt,
          onChainTxHash,
          // Full-SSI two-phase flags:
          //  - prepareOnly: stage credential in Firestore + return hash,
          //                 skip server-side on-chain signing (client will sign via MetaMask).
          //  - finalize:    caller has already signed + confirmed on Sepolia;
          //                 just mark request "issued" and link tx hash.
          //  - credentialId: passed in phase-2 finalize so we know which
          //                  previously-staged credential this maps to.
          prepareOnly,
          finalize,
          credentialId: providedCredentialId,
        } = req.body;
        const respondedBy = req.auth!.sub;

        if (!["approved", "rejected"].includes(status)) {
          return res.status(400).json({ message: "Status must be approved or rejected" });
        }

        const request = await storage.getCredentialRequest(id);
        if (!request) return res.status(404).json({ message: "Request not found" });

        // Phase-2 finalize is allowed only when the request is already
        // "issuing" (staged by a prior prepareOnly call). All other calls
        // require "pending".
        const expectedStatus = finalize ? "issuing" : "pending";
        if (request.status !== expectedStatus) {
          return res.status(400).json({
            message: `Request is not ${expectedStatus} (current status: ${request.status})`,
          });
        }

        const issuer = await storage.getIssuerByAddress(respondedBy);
        if (!issuer || !issuer.active) {
          return res.status(403).json({ message: "Only active issuers can respond to requests" });
        }

        if (request.issuerAddress) {
          if (issuer.walletAddress.toLowerCase() !== request.issuerAddress.toLowerCase()) {
            return res
              .status(403)
              .json({ message: "You can only respond to requests addressed to you" });
          }
        } else if (request.issuerCategory) {
          if (issuer.category !== request.issuerCategory) {
            return res
              .status(403)
              .json({ message: "Your issuer category does not match this request" });
          }
        }

        if (status === "rejected") {
          const updated = await storage.updateCredentialRequestStatus(id, "rejected", responseMessage);
          // Rejection anchor: only sign server-side if client hasn't already
          // provided a signed tx hash (Full-SSI mode sends its own tx here).
          if (onChainTxHash) {
            await storage.updateCredentialRequestOnChainTxHash(id, onChainTxHash);
            await storage.createTransaction({
              txHash: onChainTxHash,
              action: "credential_request_rejected_onchain",
              fromAddress: respondedBy,
              toAddress: request.requesterAddress,
              data: { requestId: id, claimType: request.claimType, onChain: true, clientSigned: true },
              blockNumber: "0",
            });
          } else if (isBlockchainReady()) {
            try {
              const rejectRes = await anchorCredentialRequestOnChain(
                id,
                request.requesterAddress,
                request.claimType,
                "rejected",
              );
              log.info(
                { txHash: rejectRes.txHash, blockNumber: rejectRes.blockNumber },
                "request rejection anchored on-chain",
              );
              await storage.updateCredentialRequestOnChainTxHash(id, rejectRes.txHash);
              await storage.createTransaction({
                txHash: rejectRes.txHash,
                action: "credential_request_rejected_onchain",
                fromAddress: respondedBy,
                toAddress: request.requesterAddress,
                data: { requestId: id, claimType: request.claimType, onChain: true },
                blockNumber: rejectRes.blockNumber,
              });
            } catch (err: any) {
              log.error({ err: err.message }, "request rejection on-chain anchoring failed");
            }
          }
          return res.json(updated);
        }

        // ---- Phase-2: finalize a previously-staged credential --------------
        if (finalize) {
          if (!providedCredentialId) {
            return res.status(400).json({ message: "credentialId is required to finalize" });
          }
          if (!onChainTxHash) {
            return res.status(400).json({ message: "onChainTxHash is required to finalize" });
          }
          const credential = await storage.getCredentialById(providedCredentialId);
          if (!credential) {
            return res.status(404).json({ message: "Staged credential not found" });
          }
          // Safety: make sure this staged credential actually belongs to this
          // request + issuer (prevents crossing wires between requests).
          if (
            credential.issuerAddress.toLowerCase() !== issuer.walletAddress.toLowerCase() ||
            credential.holderAddress.toLowerCase() !== request.requesterAddress.toLowerCase()
          ) {
            return res.status(403).json({
              message: "Staged credential does not match this request",
            });
          }
          await storage.updateCredentialRequestOnChainTxHash(id, onChainTxHash);
          const updated = await storage.updateCredentialRequestStatus(
            id,
            "issued",
            responseMessage || "Credential issued",
            providedCredentialId,
          );
          log.info(
            { requestId: id, credentialId: providedCredentialId, txHash: onChainTxHash },
            "request finalized (client-signed)",
          );
          return res.json({
            request: updated,
            credential,
            txHash: onChainTxHash,
          });
        }

        // ---- Phase-1 or legacy single-shot approval flow -------------------
        if (!claimSummary || typeof claimSummary !== "string" || claimSummary.trim().length === 0) {
          return res.status(400).json({ message: "claimSummary is required to approve and issue" });
        }
        if (!claimValue || typeof claimValue !== "string" || claimValue.trim().length === 0) {
          return res.status(400).json({ message: "claimValue is required to approve and issue" });
        }

        let expiresAtDate: Date | undefined;
        if (rawExpiresAt && typeof rawExpiresAt === "string") {
          const parsed = new Date(rawExpiresAt);
          if (isNaN(parsed.getTime())) {
            return res.status(400).json({ message: "Invalid expiresAt date" });
          }
          expiresAtDate = parsed;
        }

        const locked = await storage.lockRequestForIssuing(id);
        if (!locked) {
          return res
            .status(409)
            .json({ message: "Request is already being processed or has been issued" });
        }

        const credData =
          claimData || { value: claimValue, type: request.claimType, fields: { value: claimValue } };

        const result = await storage.createCredential({
          issuerAddress: issuer.walletAddress,
          holderAddress: request.requesterAddress,
          claimType: request.claimType,
          claimSummary: claimSummary.trim(),
          claimData: credData,
          ...(expiresAtDate ? { expiresAt: expiresAtDate } : {}),
        });

        // Full-SSI Phase-1: stop here. Client will sign issueCredential via
        // MetaMask, PATCH /api/credentials/:id/tx to confirm the receipt,
        // then POST /respond again with finalize=true to mark request issued.
        if (prepareOnly) {
          log.info(
            { requestId: id, credentialId: result.credential.id },
            "request staged for client-signed issuance",
          );
          return res.json({
            request: { ...request, status: "issuing" },
            credential: result.credential,
            txHash: result.tx.txHash,
            prepared: true,
          });
        }

        // Legacy single-shot flow: server signs on behalf of issuer.
        if (onChainTxHash) {
          await storage.updateTransactionTxHash(result.tx.id, onChainTxHash);
        } else if (isBlockchainReady()) {
          try {
            const issueRes = await issueCredentialOnChain(
              result.credential.credentialHash,
              request.requesterAddress,
              request.claimType,
              claimSummary.trim(),
            );
            await storage.updateTransactionOnChain(result.tx.id, issueRes.txHash, issueRes.blockNumber);
          } catch (err: any) {
            log.error({ err: err.message }, "on-chain issueCredential failed");
          }
        }

        if (isBlockchainReady()) {
          try {
            const approveRes = await anchorCredentialRequestOnChain(
              id,
              request.requesterAddress,
              request.claimType,
              "approved_and_issued",
            );
            log.info(
              { txHash: approveRes.txHash, blockNumber: approveRes.blockNumber },
              "request approval anchored on-chain",
            );
            await storage.updateCredentialRequestOnChainTxHash(id, approveRes.txHash);
            await storage.createTransaction({
              txHash: approveRes.txHash,
              action: "credential_request_approved_onchain",
              fromAddress: respondedBy,
              toAddress: request.requesterAddress,
              data: {
                requestId: id,
                claimType: request.claimType,
                credentialId: result.credential.id,
                onChain: true,
              },
              blockNumber: approveRes.blockNumber,
            });
          } catch (err: any) {
            log.error({ err: err.message }, "request approval on-chain anchoring failed");
          }
        }

        const updated = await storage.updateCredentialRequestStatus(
          id,
          "issued",
          responseMessage || "Credential issued",
          result.credential.id,
        );

        res.json({
          request: updated,
          credential: result.credential,
          txHash: onChainTxHash || result.tx.txHash,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );
}
