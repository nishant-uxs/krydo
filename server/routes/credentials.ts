import type { Express } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { insertCredentialSchema } from "@shared/schema";
import { validateClaimData } from "@shared/claim-schemas";
import { credentialToVC } from "@shared/vc";
import {
  issueCredentialOnChain,
  revokeCredentialOnChain,
  verifyCredentialOnChain,
  anchorCredentialRenewalOnChain,
  waitForClientTx,
  isBlockchainReady,
} from "../blockchain";
import { requireAuth, requireRole } from "../auth/jwt";
import { sensitiveLimiter } from "../middleware/security";
import { readPageOpts, sendPage } from "../middleware/pagination";
import { childLogger } from "../logger";

const log = childLogger("routes/credentials");

/**
 * Credential CRUD + verification + renewal.
 */
export function registerCredentialRoutes(app: Express) {
  app.get("/api/credentials/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const opts = readPageOpts(req);
      const wallet = await storage.getWallet(address);
      if (!wallet) return sendPage(res, { items: [], nextCursor: null });
      const page = wallet.role === "root"
        ? await storage.listAllCredentialsPaged(opts)
        : await storage.listCredentialsForHolderPaged(address, opts);

      // Optional in-memory filtering. We do it post-Firestore to keep the
      // query surface tiny — current page sizes are small (<=200) so the
      // cost is negligible. Swap for Firestore composite indexes if page
      // sizes ever grow meaningfully.
      const search = typeof req.query.search === "string" ? req.query.search.toLowerCase().trim() : "";
      const claimType = typeof req.query.claimType === "string" ? req.query.claimType : "";
      let items = page.items;
      if (claimType) items = items.filter(c => c.claimType === claimType);
      if (search) {
        items = items.filter(c =>
          c.claimType.toLowerCase().includes(search) ||
          c.claimSummary.toLowerCase().includes(search) ||
          c.credentialHash.toLowerCase().includes(search),
        );
      }
      sendPage(res, { items, nextCursor: page.nextCursor });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/credentials/issued/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const page = await storage.listCredentialsByIssuerPaged(address, readPageOpts(req));
      sendPage(res, page);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // --- W3C Verifiable Credentials Data Model v2 export -----------------
  // Renders an internal Krydo credential in the standard W3C VC v2 shape
  // so external verifiers / DID tooling (Veramo, Ceramic, Walt.id, Trinsic,
  // Microsoft Entra, etc.) can consume it unmodified. Pure view layer —
  // internal storage is unchanged.
  //
  // Public by design: VCs are portable, shareable documents. The sensitive
  // path is *issuing* (which stays gated behind requireAuth + requireRole).
  app.get("/api/credentials/:id/vc", async (req, res) => {
    try {
      const id = req.params.id as string;
      // Basic shape check so we don't collide with the /:address route
      // (ETH addresses never contain dashes, UUIDs always do).
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ message: "Invalid credential id" });
      }
      const cred = await storage.getCredentialById(id);
      if (!cred) return res.status(404).json({ message: "Credential not found" });

      const issuer = await storage.getIssuerByAddress(cred.issuerAddress);
      const baseUrl = `${req.protocol}://${req.get("host")}/api/credentials`;
      const vc = credentialToVC(cred, {
        issuerName: issuer?.name,
        statusBaseUrl: baseUrl,
      });

      res.setHeader("Content-Type", "application/vc+ld+json; charset=utf-8");
      res.json(vc);
    } catch (error: any) {
      log.error({ err: error }, "failed to render VC");
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/credentials",
    requireAuth,
    requireRole("issuer", "root"),
    sensitiveLimiter,
    async (req, res) => {
      try {
        const { onChainTxHash: clientTxHash, ...body } = req.body;
        // Enforce issuerAddress == authenticated wallet.
        body.issuerAddress = req.auth!.sub;
        if (body.expiresAt && typeof body.expiresAt === "string") {
          body.expiresAt = new Date(body.expiresAt);
        }
        const data = insertCredentialSchema.parse(body);

        // Per-claim-type structured validation. For known claim types this
        // enforces tight bounds (credit score 300-900, income >= 0, etc.);
        // for unknown types it's a no-op that accepts any bounded JSON.
        data.claimData = validateClaimData(data.claimType, data.claimData);

        const issuer = await storage.getIssuerByAddress(data.issuerAddress);
        if (!issuer || !issuer.active) {
          return res.status(403).json({ message: "Only active issuers can issue credentials" });
        }

        const result = await storage.createCredential(data);

        let finalTxHash = result.tx.txHash;
        let finalBlockNumber = result.tx.blockNumber;
        if (clientTxHash) {
          log.info({ txHash: clientTxHash }, "credential issued on-chain (MetaMask)");
          await storage.updateTransactionTxHash(result.tx.id, clientTxHash);
          finalTxHash = clientTxHash;
        } else if (isBlockchainReady()) {
          try {
            const { txHash, blockNumber } = await issueCredentialOnChain(
              result.credential.credentialHash,
              data.holderAddress,
              data.claimType,
              data.claimSummary,
            );
            log.info({ txHash, blockNumber }, "credential issued on-chain (server)");
            await storage.updateTransactionOnChain(result.tx.id, txHash, blockNumber);
            finalTxHash = txHash;
            finalBlockNumber = blockNumber;
          } catch (err: any) {
            log.error({ err: err.message }, "on-chain issueCredential failed");
          }
        }

        res.json({ ...result.credential, txHash: finalTxHash, blockNumber: finalBlockNumber });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: error.errors[0].message });
        }
        res.status(500).json({ message: error.message });
      }
    },
  );

  /**
   * Record a MetaMask-signed tx hash against a credential and — crucially —
   * verify it against Sepolia before persisting. The previous implementation
   * blindly trusted whatever hex the client sent, which meant a dropped /
   * wrong-chain / reverted tx would still surface as "on-chain" in the UI.
   *
   * Guards:
   *   - requireAuth: only the authenticated wallet (the issuer) can update
   *     their own credentials.
   *   - hash must match the issuer/root who owns the credential.
   *   - blockchain must be configured; we cannot confirm otherwise.
   *   - waitForClientTx must return "confirmed" before we mark the tx row
   *     as anchored (we store the real blockNumber too). Reverted / unknown
   *     hashes are reported back to the client with HTTP 422 so the UI can
   *     prompt the user to retry instead of silently succeeding.
   */
  app.patch("/api/credentials/:id/tx", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { txHash } = req.body ?? {};
      if (!txHash || typeof txHash !== "string") {
        return res.status(400).json({ message: "txHash is required" });
      }
      if (!/^0x[0-9a-f]{64}$/i.test(txHash)) {
        return res.status(400).json({ message: "txHash is not a valid Ethereum transaction hash" });
      }

      const credential = await storage.getCredentialById(id);
      if (!credential) return res.status(404).json({ message: "Credential not found" });

      // Lock this endpoint to the issuer (or the root authority) — the
      // holder shouldn't be able to rewrite an issuer's on-chain record.
      const caller = req.auth!.sub.toLowerCase();
      const isIssuer = credential.issuerAddress.toLowerCase() === caller;
      const isRoot = req.auth!.role === "root";
      if (!isIssuer && !isRoot) {
        return res
          .status(403)
          .json({ message: "Only the credential issuer can record its on-chain tx" });
      }

      if (!isBlockchainReady()) {
        return res
          .status(503)
          .json({ message: "Blockchain provider not configured on this server" });
      }

      // Fetch the matching transaction row. We need its id to update block
      // number once the Sepolia receipt lands.
      const txs = await storage.getTransactions(credential.issuerAddress);
      const credTx = txs.find((t) => t.data && (t.data as any).credentialId === id);
      if (!credTx) {
        return res
          .status(404)
          .json({ message: "No transaction row exists for this credential" });
      }

      const result = await waitForClientTx(txHash, { timeoutMs: 45_000 });
      if (result.status === "unknown") {
        return res.status(422).json({
          message:
            "Transaction not found on Sepolia. Please retry signing — your wallet may be on a different chain.",
          status: result.status,
        });
      }
      if (result.status === "reverted") {
        return res.status(422).json({
          message:
            "Transaction was mined but reverted. The credential was not anchored on-chain.",
          status: result.status,
          blockNumber: result.blockNumber,
        });
      }
      if (result.status === "pending") {
        // Record the hash anyway so the UI can show a 'pending' state;
        // we deliberately do NOT set blockNumber yet so other endpoints
        // continue treating the credential as unanchored until confirmation.
        await storage.updateTransactionTxHash(credTx.id, txHash);
        log.info({ txHash, credTxId: credTx.id }, "credential tx pending on-chain");
        return res.json({ success: true, txHash, status: "pending" });
      }

      // status === "confirmed"
      await storage.updateTransactionOnChain(credTx.id, txHash, result.blockNumber);
      log.info(
        { txHash, blockNumber: result.blockNumber, credTxId: credTx.id },
        "credential tx confirmed on-chain (MetaMask)",
      );
      res.json({
        success: true,
        txHash,
        blockNumber: result.blockNumber,
        status: "confirmed",
      });
    } catch (error: any) {
      log.error({ err: error.message }, "failed to record credential tx");
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * Server-initiated on-chain anchor for a credential that was saved to
   * Firestore but never confirmed on Sepolia (e.g. the user's browser died
   * between `storage.createCredential` and the MetaMask signature). Acts as
   * a "retry" button: we sign + submit from the root wallet on behalf of
   * the issuer, then update the tx row with the real hash + block.
   *
   * Caller must be the issuer of the credential (or root). Idempotent:
   * if the credential is already confirmed on-chain per verifyCredential,
   * we no-op and return the existing on-chain state.
   */
  app.post("/api/credentials/:id/anchor", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const credential = await storage.getCredentialById(id);
      if (!credential) return res.status(404).json({ message: "Credential not found" });

      const caller = req.auth!.sub.toLowerCase();
      const isIssuer = credential.issuerAddress.toLowerCase() === caller;
      const isRoot = req.auth!.role === "root";
      if (!isIssuer && !isRoot) {
        return res
          .status(403)
          .json({ message: "Only the credential issuer can anchor it on-chain" });
      }

      if (!isBlockchainReady()) {
        return res
          .status(503)
          .json({ message: "Blockchain provider not configured on this server" });
      }

      // Idempotency check — don't pay gas twice for the same anchor.
      const onChain = await verifyCredentialOnChain(credential.credentialHash);
      if (
        onChain.valid &&
        onChain.holder.toLowerCase() === credential.holderAddress.toLowerCase()
      ) {
        return res.json({
          success: true,
          alreadyOnChain: true,
          message: "Credential is already anchored on-chain",
        });
      }

      const txs = await storage.getTransactions(credential.issuerAddress);
      const credTx = txs.find((t) => t.data && (t.data as any).credentialId === id);

      const { txHash, blockNumber } = await issueCredentialOnChain(
        credential.credentialHash,
        credential.holderAddress,
        credential.claimType,
        credential.claimSummary,
      );
      log.info({ txHash, blockNumber, credentialId: id }, "credential re-anchored on-chain (server)");

      if (credTx) {
        await storage.updateTransactionOnChain(credTx.id, txHash, blockNumber);
      }

      res.json({ success: true, txHash, blockNumber, status: "confirmed" });
    } catch (error: any) {
      log.error({ err: error.message }, "server-side credential anchor failed");
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/credentials/:id/revoke", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { onChainTxHash: clientTxHash } = req.body;
      const revokedBy = req.auth!.sub;

      const credential = await storage.getCredentialById(id);
      if (!credential) return res.status(404).json({ message: "Credential not found" });

      const isIssuer = credential.issuerAddress.toLowerCase() === revokedBy;
      const isRoot = req.auth!.role === "root";
      if (!isIssuer && !isRoot) {
        return res
          .status(403)
          .json({ message: "Only the issuer or Root Authority can revoke credentials" });
      }
      if (credential.status === "revoked") {
        return res.status(400).json({ message: "Credential is already revoked" });
      }

      let chainTx: string | null = clientTxHash || null;
      let chainBlock: string | null = null;
      if (!clientTxHash && isBlockchainReady()) {
        try {
          const r = await revokeCredentialOnChain(credential.credentialHash);
          log.info({ txHash: r.txHash, blockNumber: r.blockNumber }, "credential revoked on-chain (server)");
          chainTx = r.txHash;
          chainBlock = r.blockNumber;
        } catch (err: any) {
          log.error({ err: err.message }, "on-chain revokeCredential failed");
        }
      }
      if (clientTxHash) log.info({ txHash: clientTxHash }, "credential revoked on-chain (MetaMask)");

      const result = await storage.revokeCredential(id, revokedBy);
      if (chainTx && chainBlock) {
        await storage.updateTransactionOnChain(result.tx.id, chainTx, chainBlock);
      } else if (chainTx) {
        await storage.updateTransactionTxHash(result.tx.id, chainTx);
      }
      res.json({
        ...result.credential,
        txHash: chainTx || result.tx.txHash,
        blockNumber: chainBlock || result.tx.blockNumber,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/verify", async (req, res) => {
    try {
      const { credentialHash } = req.body;
      if (!credentialHash) return res.status(400).json({ message: "credentialHash is required" });

      let credential = await storage.getCredentialByHash(credentialHash);
      if (!credential) credential = await storage.getCredentialById(credentialHash);
      if (!credential) {
        return res.json({
          valid: false,
          credential: null,
          issuerName: null,
          issuerActive: false,
          onChain: false,
          message: "No credential found with this hash or ID",
        });
      }

      const issuer = await storage.getIssuerByAddress(credential.issuerAddress);
      const isExpired = credential.expiresAt
        ? new Date(credential.expiresAt) < new Date()
        : false;
      const isActive = credential.status === "active" && !isExpired;

      let onChainVerified = false;
      if (isBlockchainReady()) {
        try {
          const r = await verifyCredentialOnChain(credential.credentialHash);
          onChainVerified = r.valid;
        } catch {
          onChainVerified = false;
        }
      }

      res.json({
        valid: isActive,
        credential,
        issuerName: issuer?.name || null,
        issuerActive: issuer?.active ?? false,
        onChain: onChainVerified,
        message: isActive ? "Credential is valid and active" : `Credential is ${credential.status}`,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/credentials/:id/renew", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { expiresAt } = req.body;
      const renewedBy = req.auth!.sub;

      const credential = await storage.getCredentialById(id);
      if (!credential) return res.status(404).json({ message: "Credential not found" });

      const isIssuer = credential.issuerAddress.toLowerCase() === renewedBy;
      const isRoot = req.auth!.role === "root";
      if (!isIssuer && !isRoot) {
        return res
          .status(403)
          .json({ message: "Only the original issuer or Root Authority can renew credentials" });
      }

      const newExpiry = expiresAt
        ? new Date(expiresAt)
        : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
      const renewed = await storage.renewCredential(id, newExpiry);

      let onChainTxHash: string | null = null;
      let onChainBlockNumber: string | null = null;
      if (isBlockchainReady()) {
        try {
          const r = await anchorCredentialRenewalOnChain(
            credential.credentialHash,
            credential.holderAddress,
            Math.floor(newExpiry.getTime() / 1000),
          );
          onChainTxHash = r.txHash;
          onChainBlockNumber = r.blockNumber;
          log.info({ txHash: r.txHash, blockNumber: r.blockNumber }, "credential renewal anchored on-chain");
        } catch (err: any) {
          log.error({ err: err.message }, "credential renewal on-chain anchoring failed");
        }
      }

      await storage.createTransaction({
        txHash: onChainTxHash || "0x" + crypto.randomBytes(32).toString("hex"),
        action: "credential_renewed",
        fromAddress: renewedBy,
        toAddress: credential.holderAddress,
        data: {
          credentialId: id,
          credentialHash: credential.credentialHash,
          newExpiresAt: newExpiry.toISOString(),
          onChain: !!onChainTxHash,
        },
        blockNumber: onChainBlockNumber || "0",
      });

      res.json({ ...renewed, onChainTxHash });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
