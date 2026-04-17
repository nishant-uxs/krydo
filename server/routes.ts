import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertIssuerSchema, insertCredentialSchema, insertCredentialRequestSchema, proofTypes, issuerCategories, ethAddressSchema } from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";
import {
  initBlockchain,
  isBlockchainReady,
  addIssuerOnChain,
  revokeIssuerOnChain,
  issueCredentialOnChain,
  revokeCredentialOnChain,
  verifyCredentialOnChain,
  isIssuerOnChain,
  anchorZkProofOnChain,
  anchorRoleAssignmentOnChain,
  anchorCredentialRequestOnChain,
  anchorCredentialRenewalOnChain,
  getDeployment,
} from "./blockchain";
import { attachAuth, requireAuth, requireRole } from "./auth/jwt";
import { registerAuthRoutes } from "./auth/siwe";
import { sensitiveLimiter } from "./middleware/security";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const blockchainEnabled = await initBlockchain();
  console.log(`Blockchain mode: ${blockchainEnabled ? "ON-CHAIN (Sepolia)" : "OFF-CHAIN"}`);

  // Attach auth context globally so req.auth is populated when a valid JWT is
  // present. Individual routes decide whether the token is REQUIRED.
  app.use("/api", attachAuth);

  // Mount SIWE auth routes (nonce, verify, me).
  registerAuthRoutes(app);

  app.get("/api/network", async (_req, res) => {
    const deployment = getDeployment();
    res.json({
      blockchain: isBlockchainReady(),
      network: deployment?.network || null,
      contracts: deployment ? {
        authority: deployment.contracts.KrydoAuthority.address,
        credentials: deployment.contracts.KrydoCredentials.address,
      } : null,
      deployer: deployment?.deployer || null,
    });
  });

  // Legacy /api/wallet/connect is intentionally disabled: connecting now
  // requires a SIWE-signed message (see /api/auth/nonce + /api/auth/verify).
  app.post("/api/wallet/connect", (_req, res) => {
    res.status(410).json({
      message:
        "Endpoint removed. Use SIWE flow: GET /api/auth/nonce then POST /api/auth/verify with a signed message.",
    });
  });

  app.get("/api/issuers", async (_req, res) => {
    try {
      const issuerList = await storage.getIssuers();
      res.json(issuerList);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/issuers", requireAuth, requireRole("root"), sensitiveLimiter, async (req, res) => {
    try {
      const { onChainTxHash: clientTxHash, ...body } = req.body;
      // Force approvedBy to match the authenticated wallet regardless of client-supplied value.
      body.approvedBy = req.auth!.sub;
      const data = insertIssuerSchema.parse(body);

      const existing = await storage.getIssuerByAddress(data.walletAddress);
      if (existing && existing.active) {
        return res.status(400).json({ message: "This wallet address is already registered as an active issuer" });
      }

      let onChainTxHash: string | null = clientTxHash || null;
      if (!onChainTxHash && isBlockchainReady()) {
        try {
          onChainTxHash = await addIssuerOnChain(data.walletAddress, data.name);
          console.log(`Issuer added on-chain (server): ${onChainTxHash}`);
        } catch (err: any) {
          console.error("On-chain addIssuer failed:", err.message);
          return res.status(500).json({ message: `On-chain transaction failed: ${err.reason || err.message}` });
        }
      }

      if (clientTxHash) {
        console.log(`Issuer added on-chain (MetaMask): ${clientTxHash}`);
      }

      if (existing && !existing.active) {
        const result = await storage.reactivateIssuer(existing.id, data.name, data.description || "", data.approvedBy, onChainTxHash, data.category);
        res.json({ ...result.issuer, txHash: result.tx.txHash, blockNumber: result.tx.blockNumber });
      } else {
        const result = await storage.createIssuer(data, onChainTxHash);
        res.json({ ...result.issuer, txHash: result.tx.txHash, blockNumber: result.tx.blockNumber });
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/issuers/:id/revoke", requireAuth, requireRole("root"), sensitiveLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { onChainTxHash: clientTxHash } = req.body;
      // Authenticated root wallet is the revoker — never trust client body.
      const revokedBy = req.auth!.sub;

      const issuer = await storage.getIssuer(id);
      if (!issuer) {
        return res.status(404).json({ message: "Issuer not found" });
      }

      if (!issuer.active) {
        return res.status(400).json({ message: "Issuer is already revoked" });
      }

      let onChainTxHash: string | null = clientTxHash || null;
      if (!onChainTxHash && isBlockchainReady()) {
        try {
          onChainTxHash = await revokeIssuerOnChain(issuer.walletAddress);
          console.log(`Issuer revoked on-chain (server): ${onChainTxHash}`);
        } catch (err: any) {
          console.error("On-chain revokeIssuer failed:", err.message);
          return res.status(500).json({ message: `On-chain transaction failed: ${err.reason || err.message}` });
        }
      }

      if (clientTxHash) {
        console.log(`Issuer revoked on-chain (MetaMask): ${clientTxHash}`);
      }

      const result = await storage.revokeIssuer(id, revokedBy, onChainTxHash);
      res.json({ ...result.issuer, txHash: result.tx.txHash, blockNumber: result.tx.blockNumber });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/credentials/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const wallet = await storage.getWallet(address);

      if (!wallet) {
        return res.json([]);
      }

      if (wallet.role === "root") {
        const allCreds = await storage.getAllCredentials();
        return res.json(allCreds);
      }

      const creds = await storage.getCredentials(address);
      res.json(creds);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/credentials/issued/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const creds = await storage.getCredentialsByIssuer(address);
      res.json(creds);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/credentials", requireAuth, requireRole("issuer", "root"), sensitiveLimiter, async (req, res) => {
    try {
      const { onChainTxHash: clientTxHash, ...body } = req.body;
      // Enforce issuerAddress == authenticated wallet (issuers can only issue as themselves).
      body.issuerAddress = req.auth!.sub;
      if (body.expiresAt && typeof body.expiresAt === "string") {
        body.expiresAt = new Date(body.expiresAt);
      }
      const data = insertCredentialSchema.parse(body);

      const issuer = await storage.getIssuerByAddress(data.issuerAddress);
      if (!issuer || !issuer.active) {
        return res.status(403).json({ message: "Only active issuers can issue credentials" });
      }

      const result = await storage.createCredential(data);

      if (clientTxHash) {
        console.log(`Credential issued on-chain (MetaMask): ${clientTxHash}`);
        await storage.updateTransactionTxHash(result.tx.id, clientTxHash);
      } else if (isBlockchainReady()) {
        try {
          const onChainTxHash = await issueCredentialOnChain(
            result.credential.credentialHash,
            data.holderAddress,
            data.claimType,
            data.claimSummary
          );
          console.log(`Credential issued on-chain (server): ${onChainTxHash}`);
          await storage.updateTransactionTxHash(result.tx.id, onChainTxHash);
        } catch (err: any) {
          console.error("On-chain issueCredential failed:", err.message);
        }
      }

      const updatedTxHash = clientTxHash || result.tx.txHash;
      res.json({ ...result.credential, txHash: updatedTxHash, blockNumber: result.tx.blockNumber });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/credentials/:id/tx", async (req, res) => {
    try {
      const { id } = req.params;
      const { txHash } = req.body;
      if (!txHash) return res.status(400).json({ message: "txHash is required" });

      const credential = await storage.getCredentialById(id);
      if (!credential) return res.status(404).json({ message: "Credential not found" });

      const txs = await storage.getTransactions(credential.issuerAddress);
      const credTx = txs.find(t => t.data && (t.data as any).credentialId === id);
      if (credTx) {
        await storage.updateTransactionTxHash(credTx.id, txHash);
        console.log(`Credential tx updated (MetaMask): ${txHash}`);
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
      if (!credential) {
        return res.status(404).json({ message: "Credential not found" });
      }

      // Only original issuer or root can revoke. Authenticated wallet is authoritative.
      const isIssuer = credential.issuerAddress.toLowerCase() === revokedBy;
      const isRoot = req.auth!.role === "root";
      if (!isIssuer && !isRoot) {
        return res.status(403).json({ message: "Only the issuer or Root Authority can revoke credentials" });
      }

      if (credential.status === "revoked") {
        return res.status(400).json({ message: "Credential is already revoked" });
      }

      if (!clientTxHash && isBlockchainReady()) {
        try {
          const onChainTxHash = await revokeCredentialOnChain(credential.credentialHash);
          console.log(`Credential revoked on-chain (server): ${onChainTxHash}`);
        } catch (err: any) {
          console.error("On-chain revokeCredential failed:", err.message);
        }
      }

      if (clientTxHash) {
        console.log(`Credential revoked on-chain (MetaMask): ${clientTxHash}`);
      }

      const result = await storage.revokeCredential(id, revokedBy);
      res.json({ ...result.credential, txHash: clientTxHash || result.tx.txHash, blockNumber: result.tx.blockNumber });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/verify", async (req, res) => {
    try {
      const { credentialHash } = req.body;

      if (!credentialHash) {
        return res.status(400).json({ message: "credentialHash is required" });
      }

      let credential = await storage.getCredentialByHash(credentialHash);
      if (!credential) {
        credential = await storage.getCredentialById(credentialHash);
      }

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
      const isExpired = credential.expiresAt ? new Date(credential.expiresAt) < new Date() : false;
      const isActive = credential.status === "active" && !isExpired;
      const issuerActive = issuer?.active ?? false;

      let onChainVerified = false;
      if (isBlockchainReady()) {
        try {
          const onChainResult = await verifyCredentialOnChain(credential.credentialHash);
          onChainVerified = onChainResult.valid;
        } catch {
          onChainVerified = false;
        }
      }

      res.json({
        valid: isActive,
        credential,
        issuerName: issuer?.name || null,
        issuerActive,
        onChain: onChainVerified,
        message: isActive
          ? "Credential is valid and active"
          : `Credential is ${credential.status}`,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/stats/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const wallet = await storage.getWallet(address);
      const role = wallet?.role || "user";
      const stats = await storage.getStats(address, role);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/transactions/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const wallet = await storage.getWallet(address);
      if (wallet?.role === "root") {
        const txs = await storage.getTransactions();
        return res.json(txs);
      }
      const txs = await storage.getTransactions(address);
      res.json(txs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/transactions/recent/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const wallet = await storage.getWallet(address);
      if (wallet?.role === "root") {
        const txs = await storage.getRecentTransactions(undefined, 10);
        return res.json(txs);
      }
      const txs = await storage.getRecentTransactions(address, 10);
      res.json(txs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/issuers/category/:category", async (req, res) => {
    try {
      const { category } = req.params;
      const issuerList = await storage.getIssuersByCategory(category);
      res.json(issuerList);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/credential-requests", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      // Requester is always the authenticated wallet.
      const body = { ...req.body, requesterAddress: req.auth!.sub };
      const data = insertCredentialRequestSchema.parse(body);
      const wallet = await storage.getWallet(data.requesterAddress);
      if (!wallet) {
        return res.status(400).json({ message: "Wallet not connected" });
      }

      if (data.issuerAddress) {
        const issuer = await storage.getIssuerByAddress(data.issuerAddress);
        if (!issuer || !issuer.active) {
          return res.status(400).json({ message: "Invalid or inactive issuer" });
        }
      }

      const request = await storage.createCredentialRequest(data);

      let onChainTxHash: string | null = null;
      if (isBlockchainReady()) {
        try {
          onChainTxHash = await anchorCredentialRequestOnChain(
            request.id,
            data.requesterAddress,
            data.claimType,
            "request_created"
          );
          console.log(`Credential request anchored on-chain: ${onChainTxHash}`);
        } catch (err: any) {
          console.error("Credential request on-chain anchoring failed:", err.message);
        }
      }

      await storage.createTransaction({
        txHash: onChainTxHash || ("0x" + crypto.randomBytes(32).toString("hex")),
        action: "credential_requested",
        fromAddress: data.requesterAddress,
        toAddress: data.issuerAddress || null,
        data: {
          requestId: request.id,
          claimType: data.claimType,
          issuerCategory: data.issuerCategory || null,
          onChain: !!onChainTxHash,
        },
        blockNumber: String(1000 + Math.floor(Math.random() * 1000)),
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
      if (!issuer) {
        return res.json([]);
      }

      const directRequests = await storage.getCredentialRequestsForIssuer(address);
      const categoryRequests = issuer.category ? await storage.getPendingRequestsForCategory(issuer.category) : [];

      const allRequests = [...directRequests];
      for (const req of categoryRequests) {
        if (!allRequests.find(r => r.id === req.id)) {
          allRequests.push(req);
        }
      }
      allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json(allRequests);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/credential-requests/:id/respond", requireAuth, requireRole("issuer", "root"), sensitiveLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { status, responseMessage, claimSummary, claimValue, claimData, expiresAt: rawExpiresAt, onChainTxHash } = req.body;
      // Responder is always the authenticated issuer wallet.
      const respondedBy = req.auth!.sub;

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Status must be approved or rejected" });
      }

      const request = await storage.getCredentialRequest(id);
      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      if (request.status !== "pending") {
        return res.status(400).json({ message: "Request is not pending" });
      }

      const issuer = await storage.getIssuerByAddress(respondedBy);
      if (!issuer || !issuer.active) {
        return res.status(403).json({ message: "Only active issuers can respond to requests" });
      }

      if (request.issuerAddress) {
        if (issuer.walletAddress.toLowerCase() !== request.issuerAddress.toLowerCase()) {
          return res.status(403).json({ message: "You can only respond to requests addressed to you" });
        }
      } else if (request.issuerCategory) {
        if (issuer.category !== request.issuerCategory) {
          return res.status(403).json({ message: "Your issuer category does not match this request" });
        }
      }

      if (status === "rejected") {
        const updated = await storage.updateCredentialRequestStatus(id, "rejected", responseMessage);

        if (isBlockchainReady()) {
          try {
            const rejectTxHash = await anchorCredentialRequestOnChain(
              id, request.requesterAddress, request.claimType, "rejected"
            );
            console.log(`Request rejection anchored on-chain: ${rejectTxHash}`);
            await storage.updateCredentialRequestOnChainTxHash(id, rejectTxHash);
            await storage.createTransaction({
              txHash: rejectTxHash,
              action: "credential_request_rejected_onchain",
              fromAddress: respondedBy,
              toAddress: request.requesterAddress,
              data: { requestId: id, claimType: request.claimType, onChain: true },
              blockNumber: String(1000 + Math.floor(Math.random() * 1000)),
            });
          } catch (err: any) {
            console.error("Request rejection on-chain anchoring failed:", err.message);
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
        return res.status(409).json({ message: "Request is already being processed or has been issued" });
      }

      const credData = claimData || { value: claimValue, type: request.claimType, fields: { value: claimValue } };

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
          const txHash = await issueCredentialOnChain(
            result.credential.credentialHash,
            request.requesterAddress,
            request.claimType,
            claimSummary.trim()
          );
          await storage.updateTransactionTxHash(result.tx.id, txHash);
        } catch (err: any) {
          console.error("On-chain issueCredential failed:", err.message);
        }
      }

      if (isBlockchainReady()) {
        try {
          const approveTxHash = await anchorCredentialRequestOnChain(
            id, request.requesterAddress, request.claimType, "approved_and_issued"
          );
          console.log(`Request approval anchored on-chain: ${approveTxHash}`);
          await storage.updateCredentialRequestOnChainTxHash(id, approveTxHash);
          await storage.createTransaction({
            txHash: approveTxHash,
            action: "credential_request_approved_onchain",
            fromAddress: respondedBy,
            toAddress: request.requesterAddress,
            data: { requestId: id, claimType: request.claimType, credentialId: result.credential.id, onChain: true },
            blockNumber: String(1000 + Math.floor(Math.random() * 1000)),
          });
        } catch (err: any) {
          console.error("Request approval on-chain anchoring failed:", err.message);
        }
      }

      const updated = await storage.updateCredentialRequestStatus(id, "issued", responseMessage || "Credential issued", result.credential.id);

      res.json({
        request: updated,
        credential: result.credential,
        txHash: onChainTxHash || result.tx.txHash,
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
      if (!credential) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const isIssuer = credential.issuerAddress.toLowerCase() === renewedBy;
      const isRoot = req.auth!.role === "root";
      if (!isIssuer && !isRoot) {
        return res.status(403).json({ message: "Only the original issuer or Root Authority can renew credentials" });
      }

      const newExpiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
      const renewed = await storage.renewCredential(id, newExpiry);

      let onChainTxHash: string | null = null;
      if (isBlockchainReady()) {
        try {
          onChainTxHash = await anchorCredentialRenewalOnChain(
            credential.credentialHash,
            credential.holderAddress,
            Math.floor(newExpiry.getTime() / 1000)
          );
          console.log(`Credential renewal anchored on-chain: ${onChainTxHash}`);
        } catch (err: any) {
          console.error("Credential renewal on-chain anchoring failed:", err.message);
        }
      }

      await storage.createTransaction({
        txHash: onChainTxHash || ("0x" + crypto.randomBytes(32).toString("hex")),
        action: "credential_renewed",
        fromAddress: renewedBy,
        toAddress: credential.holderAddress,
        data: {
          credentialId: id,
          credentialHash: credential.credentialHash,
          newExpiresAt: newExpiry.toISOString(),
          onChain: !!onChainTxHash,
        },
        blockNumber: String(1000 + Math.floor(Math.random() * 1000)),
      });

      res.json({ ...renewed, onChainTxHash });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/zk/generate", requireAuth, sensitiveLimiter, async (req, res) => {
    try {
      const { generateZkProof } = await import("./zk-engine");
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
      if (!credential) {
        return res.status(404).json({ message: "Credential not found" });
      }

      if (credential.holderAddress.toLowerCase() !== data.proverAddress.toLowerCase()) {
        return res.status(403).json({ message: "Only the credential holder can generate ZK proofs" });
      }

      if (credential.status !== "active") {
        return res.status(400).json({ message: "Cannot generate proof for revoked credential" });
      }

      if (credential.expiresAt && new Date(credential.expiresAt) < new Date()) {
        return res.status(400).json({ message: "Cannot generate proof for expired credential" });
      }

      const claimData = credential.claimData as { value?: string; type?: string; fields?: Record<string, string> };
      const claimValue = claimData?.value || "";

      let allFields: Record<string, string> | undefined;
      if (claimData?.fields) {
        allFields = claimData.fields;
      } else if (claimData?.value) {
        allFields = { value: claimData.value };
      }

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
      if (isBlockchainReady()) {
        try {
          onChainTxHash = await anchorZkProofOnChain(
            proof.commitment,
            credential.credentialHash,
            data.proofType,
            data.proverAddress
          );
          await storage.updateZkProofOnChain(stored.id, onChainTxHash);
          console.log(`ZK proof anchored on-chain: ${onChainTxHash}`);
        } catch (err: any) {
          console.error("ZK proof on-chain anchoring failed:", err.message);
          await storage.markZkProofOnChainFailed(stored.id);
        }
      }

      const tx = await storage.createTransaction({
        txHash: onChainTxHash || ("0x" + crypto.randomBytes(32).toString("hex")),
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
        blockNumber: String(1000 + Math.floor(Math.random() * 1000)),
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
      const { verifyZkProof } = await import("./zk-engine");
      const { proofId } = req.body;

      if (!proofId) {
        return res.status(400).json({ message: "proofId is required" });
      }

      const proof = await storage.getZkProof(proofId);
      if (!proof) {
        return res.status(404).json({ message: "ZK proof not found" });
      }

      const result = verifyZkProof(
        proof.proofData as any,
        proof.publicInputs as any,
      );

      if (result.valid) {
        await storage.markZkProofVerified(proof.id);
      }

      const credential = await storage.getCredentialById(proof.credentialId);
      const issuer = credential ? await storage.getIssuerByAddress(credential.issuerAddress) : null;

      let onChainVerified: boolean | null = null;
      if (isBlockchainReady() && credential) {
        try {
          const onChainResult = await verifyCredentialOnChain(credential.credentialHash);
          onChainVerified = onChainResult.valid
            && onChainResult.holder.toLowerCase() === credential.holderAddress.toLowerCase()
            && onChainResult.issuerActive;
        } catch (err: any) {
          console.error("On-chain credential verification during ZK verify failed:", err.message);
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
        credential: credential ? {
          claimType: credential.claimType,
          claimSummary: credential.claimSummary,
          status: credential.status,
          holderAddress: credential.holderAddress,
          credentialHash: credential.credentialHash,
        } : null,
        issuer: issuer ? { name: issuer.name, active: issuer.active } : null,
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

  return httpServer;
}
