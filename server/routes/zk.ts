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

      const stored = await storage.createZkProof({
        credentialId: data.credentialId,
        proverAddress: data.proverAddress,
        proofType: data.proofType,
        publicInputs: proof.publicInputs,
        proofData: proof.proofData,
        commitment: proof.commitment,
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

      const result = verifyZkProof(proof.proofData as any, proof.publicInputs as any);
      if (result.valid) await storage.markZkProofVerified(proof.id);

      const credential = await storage.getCredentialById(proof.credentialId);
      const issuer = credential ? await storage.getIssuerByAddress(credential.issuerAddress) : null;

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
        ...result,
        proof: {
          id: proof.id,
          proofType: proof.proofType,
          commitment: proof.commitment,
          createdAt: proof.createdAt,
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
      const proofs = await storage.getZkProofsByProver(address);
      res.json(proofs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
