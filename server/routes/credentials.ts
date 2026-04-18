import type { Express } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { insertCredentialSchema } from "@shared/schema";
import { validateClaimData } from "@shared/claim-schemas";
import {
  issueCredentialOnChain,
  revokeCredentialOnChain,
  verifyCredentialOnChain,
  anchorCredentialRenewalOnChain,
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

  app.patch("/api/credentials/:id/tx", async (req, res) => {
    try {
      const { id } = req.params;
      const { txHash } = req.body;
      if (!txHash) return res.status(400).json({ message: "txHash is required" });

      const credential = await storage.getCredentialById(id);
      if (!credential) return res.status(404).json({ message: "Credential not found" });

      const txs = await storage.getTransactions(credential.issuerAddress);
      const credTx = txs.find((t) => t.data && (t.data as any).credentialId === id);
      if (credTx) {
        await storage.updateTransactionTxHash(credTx.id, txHash);
        log.info({ txHash, credTxId: credTx.id }, "credential tx updated (MetaMask)");
      }
      res.json({ success: true, txHash });
    } catch (error: any) {
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
