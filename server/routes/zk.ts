import type { Express } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { proofTypes } from "@shared/schema";
import {
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
        // Full-SSI flag: when true, server generates + stores the proof but
        // skips on-chain anchoring. Client is expected to call
        // anchorZkProofViaMetaMask with the returned commitment + credentialHash,
        // then POST /api/zk/:id/anchor to link the tx hash.
        clientWillAnchor: z.boolean().optional(),
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

      // Defense-in-depth: reject range proofs whose threshold exceeds the
      // holder's actual numeric value. The UI blocks this too, but a direct
      // API caller must not be able to bypass the cap. Only applies when the
      // credential's claimValue parses as a finite number; non-numeric or
      // empty values fall through to the engine, which rejects range proofs
      // on hashed values with its own error.
      //
      // Important: an empty string MUST NOT be coerced to 0 (Number('') === 0),
      // otherwise a credential with no value would cap every range_above to
      // threshold ≤ 0 and break the flow.
      if (data.proofType === "range_above" || data.proofType === "range_below") {
        const trimmed = String(claimValue).trim();
        const numeric = trimmed === "" ? NaN : Number(trimmed);
        if (Number.isFinite(numeric) && data.threshold !== undefined) {
          if (data.proofType === "range_above" && data.threshold > numeric) {
            return res.status(400).json({
              message: `Threshold ${data.threshold} exceeds credential value ${numeric}. Cannot prove a claim stronger than the credential itself.`,
            });
          }
          if (data.proofType === "range_below" && data.threshold < numeric) {
            return res.status(400).json({
              message: `Threshold ${data.threshold} is below credential value ${numeric}. Cannot prove a claim stronger than the credential itself.`,
            });
          }
        }
      }

      let allFields: Record<string, string> | undefined;
      if (claimData?.fields) allFields = claimData.fields;
      else if (claimData?.value) allFields = { value: claimData.value };

      let proof: ReturnType<typeof generateZkProof>;
      try {
        proof = generateZkProof({
          credentialId: data.credentialId,
          claimValue,
          proofType: data.proofType,
          threshold: data.threshold,
          targetValue: data.targetValue,
          memberSet: data.memberSet,
          selectedFields: data.selectedFields,
          allFields,
        });
      } catch (engineErr: any) {
        // The ZK engine throws for caller-correctable mistakes like
        // "range_above not supported on non-numeric values", missing
        // threshold / targetValue / memberSet, or empty selectedFields.
        // These are all 400s, not 500s.
        const msg = engineErr?.message ?? "ZK proof generation failed";
        if (
          /not supported on non-numeric/i.test(msg) ||
          /required for/i.test(msg) ||
          /memberSet required/i.test(msg) ||
          /selectedFields required/i.test(msg) ||
          /allFields required/i.test(msg)
        ) {
          return res.status(400).json({ message: msg });
        }
        throw engineErr;
      }

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

      // ZK proofs are generated off-chain by design: the holder does not
      // need to pay gas or reveal the commitment to the network just to
      // share a proof with a verifier. If on-chain anchoring is ever
      // desired later, the caller can invoke POST /api/zk/:id/anchor
      // explicitly (that endpoint still exists for backwards compat).
      const tx = await storage.createTransaction({
        txHash: "0x" + crypto.randomBytes(32).toString("hex"),
        action: "zk_proof_generated",
        fromAddress: data.proverAddress,
        toAddress: null,
        data: {
          proofId: stored.id,
          proofType: data.proofType,
          credentialId: data.credentialId,
          commitment: proof.commitment,
          onChain: false,
        },
        blockNumber: "0",
      });

      res.json({
        ...stored,
        verified: proof.verified,
        claimType: credential.claimType,
        claimSummary: credential.claimSummary,
        // credentialHash is still echoed back in case the caller decides
        // to anchor later via POST /api/zk/:id/anchor.
        credentialHash: credential.credentialHash,
        onChainTxHash: null,
        txHash: tx.txHash,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * Link a client-signed anchor tx to an already-generated ZK proof.
   * Used by the Full-SSI flow: the holder's wallet signs a self-tx with
   * encoded KRYDO_ZK_PROOF_V1 payload, then POSTs the tx hash here so the
   * server can verify the Sepolia receipt and mark the proof as anchored.
   *
   * Only the prover (who created the proof) or root can call this.
   */
  app.post("/api/zk/:id/anchor", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { txHash } = req.body ?? {};
      if (!txHash || typeof txHash !== "string") {
        return res.status(400).json({ message: "txHash is required" });
      }
      if (!/^0x[0-9a-f]{64}$/i.test(txHash)) {
        return res.status(400).json({ message: "txHash is not a valid Ethereum transaction hash" });
      }

      const proof = await storage.getZkProof(id);
      if (!proof) return res.status(404).json({ message: "ZK proof not found" });

      const caller = req.auth!.sub.toLowerCase();
      const isProver = proof.proverAddress.toLowerCase() === caller;
      const isRoot = req.auth!.role === "root";
      if (!isProver && !isRoot) {
        return res
          .status(403)
          .json({ message: "Only the prover can anchor this ZK proof" });
      }

      if (!isBlockchainReady()) {
        return res
          .status(503)
          .json({ message: "Blockchain provider not configured on this server" });
      }

      // Verify the client-signed tx actually landed on Sepolia. We reuse
      // the same receipt-polling helper as the credential PATCH path.
      const { waitForClientTx } = await import("../blockchain");
      const result = await waitForClientTx(txHash, { timeoutMs: 45_000 });
      if (result.status === "unknown") {
        return res.status(422).json({
          message:
            "Anchor tx not found on Sepolia. Please retry signing — your wallet may be on a different chain.",
          status: result.status,
        });
      }
      if (result.status === "reverted") {
        return res.status(422).json({
          message: "Anchor tx reverted. The proof was not anchored on-chain.",
          status: result.status,
          blockNumber: result.blockNumber,
        });
      }

      await storage.updateZkProofOnChain(id, txHash);

      // Link the tx audit row too (mirrors how /credentials/:id/tx does it).
      const txs = await storage.getTransactions(proof.proverAddress);
      const proofTx = txs.find(
        (t) => t.data && (t.data as any).proofId === id,
      );
      if (proofTx) {
        if (result.status === "confirmed") {
          await storage.updateTransactionOnChain(proofTx.id, txHash, result.blockNumber);
        } else {
          await storage.updateTransactionTxHash(proofTx.id, txHash);
        }
      }

      log.info(
        { proofId: id, txHash, status: result.status },
        "ZK proof anchored on-chain (MetaMask)",
      );

      res.json({
        success: true,
        proofId: id,
        txHash,
        status: result.status,
        blockNumber: result.status === "confirmed" ? result.blockNumber : undefined,
      });
    } catch (error: any) {
      log.error({ err: error.message }, "failed to anchor ZK proof");
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
