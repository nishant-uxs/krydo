import type { Express } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { proofTypes } from "@shared/schema";
import {
  anchorZkProofOnChain,
  verifyCredentialOnChain,
  isBlockchainReady,
} from "../blockchain";
import { requireAuth } from "../auth/jwt";
import { sensitiveLimiter } from "../middleware/security";
import { readPageOpts, sendPage } from "../middleware/pagination";
import { childLogger } from "../logger";

const log = childLogger("routes/zk");

/**
 * ZK proof generation + verification + history.
 */
export function registerZkRoutes(app: Express) {
  app.post("/api/zk/generate", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const { generateZkProof } = await import("../zk-engine");
      const schema = z.object({
        credentialId: z.string().uuid(),
        proofType: z.enum(proofTypes),
        threshold: z.number().finite().optional(),
        targetValue: z.string().max(1024).optional(),
        memberSet: z.array(z.string().max(256)).max(1024).optional(),
        selectedFields: z.array(z.string().max(64)).max(64).optional(),
        // Proof TTL in days. Defaults to 30 (matches credential-review SLAs
        // most fintech counterparties operate on). Cap at 365 so stale
        // proofs don't linger forever.
        ttlDays: z.number().int().min(1).max(365).optional().default(30),
      });
      // Prover is always the authenticated wallet.
      const data = { ...schema.parse(req.body), proverAddress: req.auth!.sub };

      const credential = await storage.getCredentialById(data.credentialId);
      if (!credential) return res.status(404).json({ message: "Credential not found" });

      if (credential.holderAddress.toLowerCase() !== data.proverAddress.toLowerCase()) {
        return res
          .status(403)
          .json({ message: "Only the credential holder can generate ZK proofs" });
      }

      if (credential.status !== "active") {
        return res.status(400).json({ message: "Cannot generate proof for revoked credential" });
      }

      if (credential.expiresAt && new Date(credential.expiresAt) < new Date()) {
        return res.status(400).json({ message: "Cannot generate proof for expired credential" });
      }

      const claimData = credential.claimData as {
        value?: string;
        type?: string;
        fields?: Record<string, string>;
      };
      const claimValue = claimData?.value || "";

      let allFields: Record<string, string> | undefined;
      if (claimData?.fields) allFields = claimData.fields;
      else if (claimData?.value) allFields = { value: claimData.value };

      const proof = generateZkProof({
        credentialId: data.credentialId,
        claimValue,
        proofType: data.proofType,
        threshold: data.threshold,
        targetValue: data.targetValue,
        memberSet: data.memberSet,
        selectedFields: data.selectedFields,
        allFields,
      });

      // Compute expiry from ttlDays. Can't exceed the underlying credential's
      // own expiry — proof outlives credential is meaningless.
      const now = new Date();
      const proofExpiry = new Date(now.getTime() + data.ttlDays * 86_400_000);
      const expiresAt = credential.expiresAt && credential.expiresAt < proofExpiry
        ? credential.expiresAt
        : proofExpiry;

      const stored = await storage.createZkProof({
        credentialId: data.credentialId,
        proverAddress: data.proverAddress,
        proofType: data.proofType,
        publicInputs: proof.publicInputs,
        proofData: proof.proofData,
        commitment: proof.commitment,
        expiresAt,
      });

      let onChainTxHash: string | null = null;
      let onChainBlockNumber: string | null = null;
      if (isBlockchainReady()) {
        try {
          const r = await anchorZkProofOnChain(
            proof.commitment,
            credential.credentialHash,
            data.proofType,
            data.proverAddress,
          );
          onChainTxHash = r.txHash;
          onChainBlockNumber = r.blockNumber;
          await storage.updateZkProofOnChain(stored.id, r.txHash);
          log.info(
            { txHash: r.txHash, blockNumber: r.blockNumber, proofId: stored.id },
            "ZK proof anchored on-chain",
          );
        } catch (err: any) {
          log.error({ err: err.message, proofId: stored.id }, "ZK proof on-chain anchoring failed");
          await storage.markZkProofOnChainFailed(stored.id);
        }
      }

      const tx = await storage.createTransaction({
        txHash: onChainTxHash || "0x" + crypto.randomBytes(32).toString("hex"),
        action: "zk_proof_generated",
        fromAddress: data.proverAddress,
        toAddress: null,
        data: {
          proofId: stored.id,
          proofType: data.proofType,
          credentialId: data.credentialId,
          commitment: proof.commitment,
          onChain: !!onChainTxHash,
        },
        blockNumber: onChainBlockNumber || "0",
      });

      res.json({
        ...stored,
        verified: proof.verified,
        claimType: credential.claimType,
        claimSummary: credential.claimSummary,
        onChainTxHash,
        txHash: tx.txHash,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/zk/verify", async (req, res) => {
    try {
      const { verifyZkProof } = await import("../zk-engine");
      const { proofId } = req.body;
      if (!proofId) return res.status(400).json({ message: "proofId is required" });

      const proof = await storage.getZkProof(proofId);
      if (!proof) return res.status(404).json({ message: "ZK proof not found" });

      // Gather live context (credential + issuer + expiry + on-chain state)
      // before returning a verdict — an honest cryptographic proof can still
      // be semantically invalid if the underlying credential has been
      // revoked, the proof has expired, or the issuer was de-listed.
      const now = new Date();
      const credential = await storage.getCredentialById(proof.credentialId);
      const issuer = credential ? await storage.getIssuerByAddress(credential.issuerAddress) : null;

      const liveStatus = {
        proofExpired: !!proof.expiresAt && proof.expiresAt < now,
        credentialRevoked: credential?.status !== "active",
        credentialExpired:
          !!credential?.expiresAt && credential.expiresAt < now,
        issuerRevoked: !issuer?.active,
      };

      // Always run the cryptographic verifier — it's cheap and the result is
      // part of the audit payload.
      const cryptoResult = verifyZkProof(proof.proofData as any, proof.publicInputs as any);
      if (cryptoResult.valid) await storage.markZkProofVerified(proof.id);

      // Compose the final semantic verdict. Any live-status failure vetoes a
      // mathematically-valid proof.
      let valid = cryptoResult.valid;
      let reason = cryptoResult.reason;
      if (valid && liveStatus.proofExpired) {
        valid = false;
        reason = "proof has expired";
      } else if (valid && liveStatus.credentialRevoked) {
        valid = false;
        reason = "underlying credential has been revoked";
      } else if (valid && liveStatus.credentialExpired) {
        valid = false;
        reason = "underlying credential has expired";
      } else if (valid && liveStatus.issuerRevoked) {
        valid = false;
        reason = "issuer has been de-listed";
      }

      let onChainVerified: boolean | null = null;
      if (isBlockchainReady() && credential) {
        try {
          const r = await verifyCredentialOnChain(credential.credentialHash);
          onChainVerified =
            r.valid &&
            r.holder.toLowerCase() === credential.holderAddress.toLowerCase() &&
            r.issuerActive;
        } catch (err: any) {
          log.error({ err: err.message }, "on-chain credential verification during ZK verify failed");
        }
      }

      res.json({
        valid,
        reason,
        cryptographicallyValid: cryptoResult.valid,
        liveStatus,
        proof: {
          id: proof.id,
          proofType: proof.proofType,
          commitment: proof.commitment,
          createdAt: proof.createdAt,
          expiresAt: proof.expiresAt,
          publicInputs: proof.publicInputs,
          onChainTxHash: proof.onChainTxHash,
          onChainStatus: proof.onChainStatus,
        },
        credential: credential
          ? {
              claimType: credential.claimType,
              claimSummary: credential.claimSummary,
              status: credential.status,
              holderAddress: credential.holderAddress,
              issuerAddress: credential.issuerAddress,
              credentialHash: credential.credentialHash,
              expiresAt: credential.expiresAt,
            }
          : null,
        issuerName: issuer?.name || null,
        issuerActive: issuer?.active ?? false,
        onChainVerified,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/zk/proofs/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const page = await storage.listZkProofsByProverPaged(address, readPageOpts(req));
      sendPage(res, page);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * Public share endpoint. Returns a pared-down, safe-to-share view of a proof
   * so anyone with the URL can render the verify page without auth. We
   * deliberately omit the prover's identity (proofs are pseudonymous) and the
   * cryptographic witness (still reachable via /api/zk/verify).
   */
  app.get("/api/zk/share/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const proof = await storage.getZkProof(id);
      if (!proof) return res.status(404).json({ message: "ZK proof not found" });

      const credential = await storage.getCredentialById(proof.credentialId);
      const issuer = credential ? await storage.getIssuerByAddress(credential.issuerAddress) : null;

      res.json({
        id: proof.id,
        proofType: proof.proofType,
        commitment: proof.commitment,
        createdAt: proof.createdAt,
        expiresAt: proof.expiresAt,
        publicInputs: proof.publicInputs,
        onChainTxHash: proof.onChainTxHash,
        claim: credential
          ? { type: credential.claimType, summary: credential.claimSummary }
          : null,
        issuer: issuer ? { name: issuer.name, active: issuer.active } : null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
