import type { Express } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { insertCredentialRequestSchema } from "@shared/schema";
import {
  anchorCredentialRequestOnChain,
  issueCredentialOnChain,
  isBlockchainReady,
} from "../blockchain";
import { requireAuth, requireRole } from "../auth/jwt";
import { sensitiveLimiter } from "../middleware/security";
import { childLogger } from "../logger";

const log = childLogger("routes/credential-requests");

/**
 * User-to-issuer credential request workflow.
 */
export function registerCredentialRequestRoutes(app: Express) {
  app.post("/api/credential-requests", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const body = { ...req.body, requesterAddress: req.auth!.sub };
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
      if (isBlockchainReady()) {
        try {
          const r = await anchorCredentialRequestOnChain(
            request.id,
            data.requesterAddress,
            data.claimType,
            "request_created",
          );
          onChainTxHash = r.txHash;
          onChainBlockNumber = r.blockNumber;
          log.info({ txHash: r.txHash, blockNumber: r.blockNumber }, "credential request anchored on-chain");
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

  app.get("/api/credential-requests/user/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const requests = await storage.getCredentialRequestsByRequester(address);
      res.json(requests);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/credential-requests/issuer/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const issuer = await storage.getIssuerByAddress(address);
      if (!issuer) return res.json([]);

      const directRequests = await storage.getCredentialRequestsForIssuer(issuer.walletAddress);
      const categoryRequests = await storage.getPendingRequestsForCategory(issuer.category);

      const seen = new Set<string>();
      const allRequests = [];
      for (const r of [...directRequests, ...categoryRequests]) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          allRequests.push(r);
        }
      }
      allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json(allRequests);
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
        } = req.body;
        const respondedBy = req.auth!.sub;

        if (!["approved", "rejected"].includes(status)) {
          return res.status(400).json({ message: "Status must be approved or rejected" });
        }

        const request = await storage.getCredentialRequest(id);
        if (!request) return res.status(404).json({ message: "Request not found" });
        if (request.status !== "pending") {
          return res.status(400).json({ message: "Request is not pending" });
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
          if (isBlockchainReady()) {
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
