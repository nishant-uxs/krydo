import type { Express, Request, Response } from "express";
import { SiweMessage } from "siwe";
import { z } from "zod";
import { storage } from "../storage";
import { getDeployment, isBlockchainReady, isIssuerOnChain, anchorRoleAssignmentOnChain } from "../blockchain";
import { ethAddressSchema, type WalletRole } from "@shared/schema";
import { issueNonce, consumeNonce } from "./nonce-store";
import { signAuthToken } from "./jwt";
import { sensitiveLimiter } from "../middleware/security";

const verifySchema = z.object({
  message: z.string().min(20).max(4_000),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/, "Invalid signature format"),
});

export function registerAuthRoutes(app: Express) {
  /** GET /api/auth/nonce?address=0x... — returns a server-issued nonce to sign. */
  app.get("/api/auth/nonce", sensitiveLimiter, async (req: Request, res: Response) => {
    try {
      const address = ethAddressSchema.parse(req.query.address);
      const { nonce, expiresAt } = issueNonce(address);
      res.json({ nonce, expiresAt });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0].message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/auth/verify — verifies the SIWE message + signature, issues a JWT. */
  app.post("/api/auth/verify", sensitiveLimiter, async (req: Request, res: Response) => {
    try {
      const { message, signature } = verifySchema.parse(req.body);

      const siwe = new SiweMessage(message);
      const verification = await siwe.verify({ signature });

      if (!verification.success) {
        return res.status(401).json({ message: "Signature verification failed" });
      }

      const addr = siwe.address.toLowerCase();

      // Single-use nonce check: prevents replay and ensures the signed message
      // was created from a challenge we issued.
      if (!consumeNonce(siwe.nonce, addr)) {
        return res.status(401).json({ message: "Invalid or expired nonce" });
      }

      // Detect role exactly like the old wallet/connect route.
      const dep = getDeployment();
      const deployerAddr = dep?.deployer?.toLowerCase();
      let role: WalletRole = "user";
      let label = "User";

      if (deployerAddr && addr === deployerAddr) {
        role = "root";
        label = "Root Authority";
      } else {
        const issuer = await storage.getIssuerByAddress(addr);
        if (issuer && issuer.active) {
          role = "issuer";
          label = issuer.name;
        } else if (isBlockchainReady()) {
          try {
            if (await isIssuerOnChain(addr)) {
              role = "issuer";
              label = "Trusted Issuer";
            }
          } catch {
            /* fall through to user */
          }
        }
      }

      const wallet = await storage.connectWallet(addr, role, label);

      // Best-effort anchor of the role assignment on Sepolia.
      if (isBlockchainReady()) {
        try {
          const { txHash, blockNumber } = await anchorRoleAssignmentOnChain(addr, role, label);
          await storage.updateWalletOnChainTxHash(addr, txHash);
          // Log a transaction row so the dashboard can show a real block number.
          await storage.createTransaction({
            txHash,
            action: "role_assigned_onchain",
            fromAddress: addr,
            data: { role, label, onChain: true },
            blockNumber,
          });
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.error("Role anchor failed:", err.message);
        }
      }

      const token = signAuthToken({ sub: addr, role });
      const updated = (await storage.getWallet(addr)) || wallet;

      res.json({ token, wallet: updated });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0].message });
      }
      // Many SIWE errors are deliberately vague; expose the message only in dev.
      res.status(401).json({ message: err.message || "Authentication failed" });
    }
  });

  /** GET /api/auth/me — returns the current session wallet if JWT is valid. */
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.auth) return res.status(401).json({ message: "Not authenticated" });
    const wallet = await storage.getWallet(req.auth.sub);
    if (!wallet) return res.status(404).json({ message: "Wallet not found" });
    res.json({ wallet });
  });
}
