import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { insertIssuerSchema } from "@shared/schema";
import {
  addIssuerOnChain,
  revokeIssuerOnChain,
  isBlockchainReady,
} from "../blockchain";
import { requireAuth, requireRole } from "../auth/jwt";
import { sensitiveLimiter } from "../middleware/security";
import { childLogger } from "../logger";

const log = childLogger("routes/issuers");

/**
 * Issuer registry routes.
 *
 *  GET  /api/issuers                   — list all issuers (public read)
 *  POST /api/issuers                   — root-only, add issuer (on-chain)
 *  POST /api/issuers/:id/revoke        — root-only, revoke issuer (on-chain)
 *  GET  /api/issuers/category/:cat     — filter by category
 */
export function registerIssuerRoutes(app: Express) {
  app.get("/api/issuers", async (_req, res) => {
    try {
      const list = await storage.getIssuers();
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/issuers",
    requireAuth,
    requireRole("root"),
    sensitiveLimiter,
    async (req, res) => {
      try {
        const { onChainTxHash: clientTxHash, ...body } = req.body;
        // Force approvedBy to match the authenticated wallet.
        body.approvedBy = req.auth!.sub;
        const data = insertIssuerSchema.parse(body);

        const existing = await storage.getIssuerByAddress(data.walletAddress);
        if (existing && existing.active) {
          return res.status(400).json({
            message: "This wallet address is already registered as an active issuer",
          });
        }

        let onChainTxHash: string | null = clientTxHash || null;
        let onChainBlockNumber: string | null = null;
        if (!onChainTxHash && isBlockchainReady()) {
          try {
            const r = await addIssuerOnChain(data.walletAddress, data.name);
            onChainTxHash = r.txHash;
            onChainBlockNumber = r.blockNumber;
            log.info({ txHash: r.txHash, blockNumber: r.blockNumber }, "issuer added on-chain (server)");
          } catch (err: any) {
            log.error({ err: err.message }, "on-chain addIssuer failed");
            return res
              .status(500)
              .json({ message: `On-chain transaction failed: ${err.reason || err.message}` });
          }
        }
        if (clientTxHash) log.info({ txHash: clientTxHash }, "issuer added on-chain (MetaMask)");

        const result = existing && !existing.active
          ? await storage.reactivateIssuer(
              existing.id,
              data.name,
              data.description || "",
              data.approvedBy,
              onChainTxHash,
              data.category,
            )
          : await storage.createIssuer(data, onChainTxHash);

        if (onChainTxHash && onChainBlockNumber) {
          await storage.updateTransactionOnChain(result.tx.id, onChainTxHash, onChainBlockNumber);
        }

        res.json({
          ...result.issuer,
          txHash: onChainTxHash || result.tx.txHash,
          blockNumber: onChainBlockNumber || result.tx.blockNumber,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: error.errors[0].message });
        }
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/issuers/:id/revoke",
    requireAuth,
    requireRole("root"),
    sensitiveLimiter,
    async (req, res) => {
      try {
        const id = req.params.id as string;
        const { onChainTxHash: clientTxHash } = req.body;
        const revokedBy = req.auth!.sub;

        const issuer = await storage.getIssuer(id);
        if (!issuer) return res.status(404).json({ message: "Issuer not found" });
        if (!issuer.active) return res.status(400).json({ message: "Issuer is already revoked" });

        let onChainTxHash: string | null = clientTxHash || null;
        let onChainBlockNumber: string | null = null;
        if (!onChainTxHash && isBlockchainReady()) {
          try {
            const r = await revokeIssuerOnChain(issuer.walletAddress);
            onChainTxHash = r.txHash;
            onChainBlockNumber = r.blockNumber;
            log.info({ txHash: r.txHash, blockNumber: r.blockNumber }, "issuer revoked on-chain (server)");
          } catch (err: any) {
            log.error({ err: err.message }, "on-chain revokeIssuer failed");
            return res
              .status(500)
              .json({ message: `On-chain transaction failed: ${err.reason || err.message}` });
          }
        }
        if (clientTxHash) log.info({ txHash: clientTxHash }, "issuer revoked on-chain (MetaMask)");

        const result = await storage.revokeIssuer(id, revokedBy, onChainTxHash);
        if (onChainTxHash && onChainBlockNumber) {
          await storage.updateTransactionOnChain(result.tx.id, onChainTxHash, onChainBlockNumber);
        }
        res.json({
          ...result.issuer,
          txHash: onChainTxHash || result.tx.txHash,
          blockNumber: onChainBlockNumber || result.tx.blockNumber,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.get("/api/issuers/category/:category", async (req, res) => {
    try {
      const { category } = req.params;
      const list = await storage.getIssuersByCategory(category);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
