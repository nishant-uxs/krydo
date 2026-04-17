import crypto from "crypto";
import { collections, firestore } from "./db";
import {
  type Wallet, type InsertWallet,
  type Issuer, type InsertIssuer,
  type Credential, type InsertCredential,
  type Transaction, type InsertTransaction,
  type ZkProof, type InsertZkProof,
  type CredentialRequest, type InsertCredentialRequest,
  type WalletRole,
} from "@shared/schema";

// ---------- helpers ----------

function generateTxHash(): string {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

function generateCredentialHash(data: object): string {
  return "0x" + crypto.createHash("sha256").update(JSON.stringify(data) + Date.now()).digest("hex");
}

let blockCounter = 1000;
function nextBlock(): string {
  return String(++blockCounter);
}

function newId(): string {
  return crypto.randomUUID();
}

function lc(addr: string | null | undefined): string {
  return (addr ?? "").toLowerCase();
}

/** Convert Firestore Timestamp / Date / ISO string to JS Date (or null). */
function toDate(value: any): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function mustDate(value: any): Date {
  return toDate(value) ?? new Date(0);
}

// ---------- mappers (Firestore doc -> domain type) ----------

function walletFromDoc(data: any): Wallet {
  return {
    address: data.address,
    role: data.role,
    label: data.label ?? null,
    onChainTxHash: data.onChainTxHash ?? null,
    createdAt: mustDate(data.createdAt),
  };
}

function issuerFromDoc(id: string, data: any): Issuer {
  return {
    id,
    walletAddress: data.walletAddress,
    name: data.name,
    description: data.description ?? null,
    category: data.category ?? "general",
    active: !!data.active,
    approvedBy: data.approvedBy,
    approvedAt: mustDate(data.approvedAt),
    revokedAt: toDate(data.revokedAt),
  };
}

function credentialFromDoc(id: string, data: any): Credential {
  return {
    id,
    credentialHash: data.credentialHash,
    issuerAddress: data.issuerAddress,
    holderAddress: data.holderAddress,
    claimType: data.claimType,
    claimSummary: data.claimSummary,
    claimData: data.claimData ?? null,
    status: data.status ?? "active",
    issuedAt: mustDate(data.issuedAt),
    revokedAt: toDate(data.revokedAt),
    expiresAt: toDate(data.expiresAt),
  };
}

function transactionFromDoc(id: string, data: any): Transaction {
  return {
    id,
    txHash: data.txHash,
    action: data.action,
    fromAddress: data.fromAddress,
    toAddress: data.toAddress ?? null,
    data: data.data ?? null,
    blockNumber: data.blockNumber,
    timestamp: mustDate(data.timestamp),
  };
}

function credentialRequestFromDoc(id: string, data: any): CredentialRequest {
  return {
    id,
    requesterAddress: data.requesterAddress,
    issuerAddress: data.issuerAddress ?? null,
    issuerCategory: data.issuerCategory ?? null,
    claimType: data.claimType,
    message: data.message ?? null,
    status: data.status ?? "pending",
    responseMessage: data.responseMessage ?? null,
    credentialId: data.credentialId ?? null,
    onChainTxHash: data.onChainTxHash ?? null,
    createdAt: mustDate(data.createdAt),
    updatedAt: mustDate(data.updatedAt),
  };
}

function zkProofFromDoc(id: string, data: any): ZkProof {
  return {
    id,
    credentialId: data.credentialId,
    proverAddress: data.proverAddress,
    proofType: data.proofType,
    publicInputs: data.publicInputs ?? null,
    proofData: data.proofData ?? null,
    commitment: data.commitment,
    verified: !!data.verified,
    onChainTxHash: data.onChainTxHash ?? null,
    onChainStatus: data.onChainStatus ?? null,
    createdAt: mustDate(data.createdAt),
    expiresAt: toDate(data.expiresAt),
  };
}

// ---------- IStorage ----------

export interface IStorage {
  getWallet(address: string): Promise<Wallet | undefined>;
  createWallet(wallet: InsertWallet): Promise<Wallet>;
  connectWallet(address: string, role: string, label?: string): Promise<Wallet>;

  getIssuers(): Promise<Issuer[]>;
  getIssuer(id: string): Promise<Issuer | undefined>;
  getIssuerByAddress(address: string): Promise<Issuer | undefined>;
  createIssuer(issuer: InsertIssuer, onChainTxHash?: string | null): Promise<{ issuer: Issuer; tx: Transaction }>;
  reactivateIssuer(id: string, name: string, description: string, approvedBy: string, onChainTxHash?: string | null, category?: string): Promise<{ issuer: Issuer; tx: Transaction }>;
  revokeIssuer(id: string, revokedBy: string, onChainTxHash?: string | null): Promise<{ issuer: Issuer; tx: Transaction }>;

  getCredentials(holderAddress: string): Promise<Credential[]>;
  getCredentialsByIssuer(issuerAddress: string): Promise<Credential[]>;
  getAllCredentials(): Promise<Credential[]>;
  getCredentialById(id: string): Promise<Credential | undefined>;
  getCredentialByHash(hash: string): Promise<Credential | undefined>;
  createCredential(cred: InsertCredential): Promise<{ credential: Credential; tx: Transaction }>;
  revokeCredential(id: string, revokedBy: string): Promise<{ credential: Credential; tx: Transaction }>;

  updateTransactionTxHash(id: string, txHash: string): Promise<void>;
  createTransaction(data: InsertTransaction): Promise<Transaction>;
  getTransactions(address?: string): Promise<Transaction[]>;
  getRecentTransactions(address?: string, limit?: number): Promise<Transaction[]>;

  getStats(address: string, role: string): Promise<{
    issuers: number;
    credentials: number;
    transactions: number;
    activeCredentials: number;
    revokedCredentials: number;
  }>;

  createZkProof(proof: InsertZkProof): Promise<ZkProof>;
  getZkProof(id: string): Promise<ZkProof | undefined>;
  getZkProofsByProver(address: string): Promise<ZkProof[]>;
  getZkProofsByCredential(credentialId: string): Promise<ZkProof[]>;
  markZkProofVerified(id: string): Promise<ZkProof>;
  updateZkProofOnChain(id: string, txHash: string): Promise<ZkProof>;
  markZkProofOnChainFailed(id: string): Promise<void>;

  getIssuersByCategory(category: string): Promise<Issuer[]>;

  createCredentialRequest(req: InsertCredentialRequest): Promise<CredentialRequest>;
  getCredentialRequest(id: string): Promise<CredentialRequest | undefined>;
  getCredentialRequestsByRequester(address: string): Promise<CredentialRequest[]>;
  getCredentialRequestsForIssuer(issuerAddress: string): Promise<CredentialRequest[]>;
  getPendingRequestsForCategory(category: string): Promise<CredentialRequest[]>;
  updateCredentialRequestStatus(id: string, status: string, responseMessage?: string, credentialId?: string): Promise<CredentialRequest>;
  lockRequestForIssuing(id: string): Promise<boolean>;

  renewCredential(id: string, newExpiresAt: Date): Promise<Credential>;

  updateWalletOnChainTxHash(address: string, txHash: string): Promise<void>;
  updateCredentialRequestOnChainTxHash(id: string, txHash: string): Promise<void>;
}

// ---------- FirestoreStorage ----------

export class FirestoreStorage implements IStorage {
  // ----- wallets -----

  async getWallet(address: string): Promise<Wallet | undefined> {
    const id = lc(address);
    const doc = await collections.wallets.doc(id).get();
    if (!doc.exists) return undefined;
    return walletFromDoc(doc.data());
  }

  async createWallet(wallet: InsertWallet): Promise<Wallet> {
    const address = lc(wallet.address);
    const now = new Date();
    const payload = {
      address,
      role: wallet.role ?? "user",
      label: wallet.label ?? null,
      onChainTxHash: null,
      createdAt: now,
    };
    await collections.wallets.doc(address).set(payload);
    return walletFromDoc(payload);
  }

  async connectWallet(address: string, role: string, label?: string): Promise<Wallet> {
    const normalized = lc(address);
    const existing = await this.getWallet(normalized);
    if (existing) {
      const needsUpdate = existing.role !== role || (label && existing.label !== label);
      if (needsUpdate) {
        const patch: Record<string, any> = { role };
        if (label) patch.label = label;
        await collections.wallets.doc(normalized).update(patch);
        return { ...existing, role, label: label ?? existing.label };
      }
      return existing;
    }

    const walletLabel = label || (role === "root" ? "Root Authority" : role === "issuer" ? "Trusted Issuer" : "User");
    const created = await this.createWallet({
      address: normalized,
      role: role as WalletRole,
      label: walletLabel,
    });

    const txHash = generateTxHash();
    const txId = newId();
    await collections.transactions.doc(txId).set({
      id: txId,
      txHash,
      action: "wallet_connected",
      fromAddress: normalized,
      toAddress: null,
      data: { role },
      blockNumber: nextBlock(),
      timestamp: new Date(),
    });

    return created;
  }

  async updateWalletOnChainTxHash(address: string, txHash: string): Promise<void> {
    await collections.wallets.doc(lc(address)).set({ onChainTxHash: txHash }, { merge: true });
  }

  // ----- issuers -----

  async getIssuers(): Promise<Issuer[]> {
    const snap = await collections.issuers.orderBy("approvedAt", "desc").get();
    return snap.docs.map(d => issuerFromDoc(d.id, d.data()));
  }

  async getIssuer(id: string): Promise<Issuer | undefined> {
    const doc = await collections.issuers.doc(id).get();
    if (!doc.exists) return undefined;
    return issuerFromDoc(doc.id, doc.data());
  }

  async getIssuerByAddress(address: string): Promise<Issuer | undefined> {
    const snap = await collections.issuers.where("walletAddress", "==", lc(address)).limit(1).get();
    if (snap.empty) return undefined;
    const d = snap.docs[0];
    return issuerFromDoc(d.id, d.data());
  }

  async createIssuer(data: InsertIssuer, onChainTxHash?: string | null): Promise<{ issuer: Issuer; tx: Transaction }> {
    const id = newId();
    const now = new Date();
    const walletAddress = lc(data.walletAddress);
    const approvedBy = lc(data.approvedBy);

    const issuerPayload = {
      id,
      walletAddress,
      name: data.name,
      description: data.description ?? null,
      category: data.category ?? "general",
      active: true,
      approvedBy,
      approvedAt: now,
      revokedAt: null,
    };
    await collections.issuers.doc(id).set(issuerPayload);

    // Ensure a wallet row exists / upgrade to issuer role
    const existingWallet = await this.getWallet(walletAddress);
    if (!existingWallet) {
      await this.createWallet({ address: walletAddress, role: "issuer", label: data.name });
    } else {
      await collections.wallets.doc(walletAddress).update({ role: "issuer", label: data.name });
    }

    const txHash = onChainTxHash || generateTxHash();
    const txId = newId();
    const txPayload = {
      id: txId,
      txHash,
      action: "issuer_approved",
      fromAddress: approvedBy,
      toAddress: walletAddress,
      data: { issuerName: data.name, issuerId: id, onChain: !!onChainTxHash },
      blockNumber: nextBlock(),
      timestamp: new Date(),
    };
    await collections.transactions.doc(txId).set(txPayload);

    return {
      issuer: issuerFromDoc(id, issuerPayload),
      tx: transactionFromDoc(txId, txPayload),
    };
  }

  async reactivateIssuer(id: string, name: string, description: string, approvedBy: string, onChainTxHash?: string | null, category?: string): Promise<{ issuer: Issuer; tx: Transaction }> {
    const approvedByLc = lc(approvedBy);
    const now = new Date();
    const patch: Record<string, any> = {
      active: true,
      name,
      description,
      approvedBy: approvedByLc,
      approvedAt: now,
      revokedAt: null,
    };
    if (category) patch.category = category;
    await collections.issuers.doc(id).update(patch);

    const doc = await collections.issuers.doc(id).get();
    const issuer = issuerFromDoc(doc.id, doc.data());

    await collections.wallets.doc(lc(issuer.walletAddress)).set({ role: "issuer", label: name }, { merge: true });

    const txHash = onChainTxHash || generateTxHash();
    const txId = newId();
    const txPayload = {
      id: txId,
      txHash,
      action: "issuer_approved",
      fromAddress: approvedByLc,
      toAddress: issuer.walletAddress,
      data: { issuerName: name, issuerId: id, onChain: !!onChainTxHash, reactivated: true },
      blockNumber: nextBlock(),
      timestamp: new Date(),
    };
    await collections.transactions.doc(txId).set(txPayload);

    return { issuer, tx: transactionFromDoc(txId, txPayload) };
  }

  async revokeIssuer(id: string, revokedBy: string, onChainTxHash?: string | null): Promise<{ issuer: Issuer; tx: Transaction }> {
    const now = new Date();
    await collections.issuers.doc(id).update({ active: false, revokedAt: now });
    const doc = await collections.issuers.doc(id).get();
    const issuer = issuerFromDoc(doc.id, doc.data());

    const txHash = onChainTxHash || generateTxHash();
    const txId = newId();
    const txPayload = {
      id: txId,
      txHash,
      action: "issuer_revoked",
      fromAddress: lc(revokedBy),
      toAddress: issuer.walletAddress,
      data: { issuerName: issuer.name, issuerId: id, onChain: !!onChainTxHash },
      blockNumber: nextBlock(),
      timestamp: new Date(),
    };
    await collections.transactions.doc(txId).set(txPayload);

    return { issuer, tx: transactionFromDoc(txId, txPayload) };
  }

  async getIssuersByCategory(category: string): Promise<Issuer[]> {
    // Firestore compound query (category + active + orderBy) may require an index.
    // Do single where + in-memory filter for simplicity.
    const snap = await collections.issuers.where("category", "==", category).get();
    return snap.docs
      .map(d => issuerFromDoc(d.id, d.data()))
      .filter(i => i.active)
      .sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime());
  }

  // ----- credentials -----

  async getCredentials(holderAddress: string): Promise<Credential[]> {
    const snap = await collections.credentials
      .where("holderAddress", "==", lc(holderAddress))
      .get();
    return snap.docs
      .map(d => credentialFromDoc(d.id, d.data()))
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
  }

  async getCredentialsByIssuer(issuerAddress: string): Promise<Credential[]> {
    const snap = await collections.credentials
      .where("issuerAddress", "==", lc(issuerAddress))
      .get();
    return snap.docs
      .map(d => credentialFromDoc(d.id, d.data()))
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
  }

  async getAllCredentials(): Promise<Credential[]> {
    const snap = await collections.credentials.orderBy("issuedAt", "desc").get();
    return snap.docs.map(d => credentialFromDoc(d.id, d.data()));
  }

  async getCredentialById(id: string): Promise<Credential | undefined> {
    const doc = await collections.credentials.doc(id).get();
    if (!doc.exists) return undefined;
    return credentialFromDoc(doc.id, doc.data());
  }

  async getCredentialByHash(hash: string): Promise<Credential | undefined> {
    const snap = await collections.credentials.where("credentialHash", "==", hash).limit(1).get();
    if (snap.empty) return undefined;
    const d = snap.docs[0];
    return credentialFromDoc(d.id, d.data());
  }

  async createCredential(data: InsertCredential): Promise<{ credential: Credential; tx: Transaction }> {
    const credHash = generateCredentialHash(data);
    const id = newId();
    const now = new Date();
    const issuerAddress = lc(data.issuerAddress);
    const holderAddress = lc(data.holderAddress);

    const payload = {
      id,
      credentialHash: credHash,
      issuerAddress,
      holderAddress,
      claimType: data.claimType,
      claimSummary: data.claimSummary,
      claimData: data.claimData ?? null,
      status: "active",
      issuedAt: now,
      revokedAt: null,
      expiresAt: data.expiresAt ?? null,
    };
    await collections.credentials.doc(id).set(payload);

    // Ensure holder wallet exists
    const existingWallet = await this.getWallet(holderAddress);
    if (!existingWallet) {
      await this.createWallet({ address: holderAddress, role: "user" });
    }

    const txHash = generateTxHash();
    const txId = newId();
    const txPayload = {
      id: txId,
      txHash,
      action: "credential_issued",
      fromAddress: issuerAddress,
      toAddress: holderAddress,
      data: { credentialHash: credHash, claimType: data.claimType },
      blockNumber: nextBlock(),
      timestamp: new Date(),
    };
    await collections.transactions.doc(txId).set(txPayload);

    return {
      credential: credentialFromDoc(id, payload),
      tx: transactionFromDoc(txId, txPayload),
    };
  }

  async revokeCredential(id: string, revokedBy: string): Promise<{ credential: Credential; tx: Transaction }> {
    const now = new Date();
    await collections.credentials.doc(id).update({ status: "revoked", revokedAt: now });
    const doc = await collections.credentials.doc(id).get();
    const credential = credentialFromDoc(doc.id, doc.data());

    const txHash = generateTxHash();
    const txId = newId();
    const txPayload = {
      id: txId,
      txHash,
      action: "credential_revoked",
      fromAddress: lc(revokedBy),
      toAddress: credential.holderAddress,
      data: { credentialHash: credential.credentialHash, claimType: credential.claimType },
      blockNumber: nextBlock(),
      timestamp: new Date(),
    };
    await collections.transactions.doc(txId).set(txPayload);

    return { credential, tx: transactionFromDoc(txId, txPayload) };
  }

  async renewCredential(id: string, newExpiresAt: Date): Promise<Credential> {
    await collections.credentials.doc(id).update({
      expiresAt: newExpiresAt,
      status: "active",
      revokedAt: null,
    });
    const doc = await collections.credentials.doc(id).get();
    return credentialFromDoc(doc.id, doc.data());
  }

  // ----- transactions -----

  async updateTransactionTxHash(id: string, txHash: string): Promise<void> {
    await collections.transactions.doc(id).update({ txHash });
  }

  async createTransaction(data: InsertTransaction): Promise<Transaction> {
    const id = newId();
    const payload = {
      id,
      txHash: data.txHash,
      action: data.action,
      fromAddress: lc(data.fromAddress),
      toAddress: data.toAddress ? lc(data.toAddress) : null,
      data: data.data ?? null,
      blockNumber: data.blockNumber,
      timestamp: new Date(),
    };
    await collections.transactions.doc(id).set(payload);
    return transactionFromDoc(id, payload);
  }

  async getTransactions(address?: string): Promise<Transaction[]> {
    if (!address) {
      const snap = await collections.transactions.orderBy("timestamp", "desc").get();
      return snap.docs.map(d => transactionFromDoc(d.id, d.data()));
    }
    const a = lc(address);
    // Firestore doesn't support OR natively on different fields in a single query;
    // run two queries and merge.
    const [fromSnap, toSnap] = await Promise.all([
      collections.transactions.where("fromAddress", "==", a).get(),
      collections.transactions.where("toAddress", "==", a).get(),
    ]);
    const map = new Map<string, Transaction>();
    for (const d of fromSnap.docs) map.set(d.id, transactionFromDoc(d.id, d.data()));
    for (const d of toSnap.docs) map.set(d.id, transactionFromDoc(d.id, d.data()));
    return Array.from(map.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async getRecentTransactions(address?: string, limit = 10): Promise<Transaction[]> {
    if (!address) {
      const snap = await collections.transactions.orderBy("timestamp", "desc").limit(limit).get();
      return snap.docs.map(d => transactionFromDoc(d.id, d.data()));
    }
    const all = await this.getTransactions(address);
    return all.slice(0, limit);
  }

  // ----- stats -----

  async getStats(address: string, role: string) {
    const a = lc(address);

    if (role === "root") {
      const [issuersSnap, credsSnap, activeSnap, revokedSnap, txSnap] = await Promise.all([
        collections.issuers.count().get(),
        collections.credentials.count().get(),
        collections.credentials.where("status", "==", "active").count().get(),
        collections.credentials.where("status", "==", "revoked").count().get(),
        collections.transactions.count().get(),
      ]);
      return {
        issuers: issuersSnap.data().count,
        credentials: credsSnap.data().count,
        transactions: txSnap.data().count,
        activeCredentials: activeSnap.data().count,
        revokedCredentials: revokedSnap.data().count,
      };
    }

    if (role === "issuer") {
      const base = collections.credentials.where("issuerAddress", "==", a);
      const [credsSnap, activeSnap, revokedSnap] = await Promise.all([
        base.count().get(),
        base.where("status", "==", "active").count().get(),
        base.where("status", "==", "revoked").count().get(),
      ]);
      const txs = await this.getTransactions(a);
      return {
        issuers: 0,
        credentials: credsSnap.data().count,
        transactions: txs.length,
        activeCredentials: activeSnap.data().count,
        revokedCredentials: revokedSnap.data().count,
      };
    }

    // user
    const base = collections.credentials.where("holderAddress", "==", a);
    const [credsSnap, activeSnap, revokedSnap] = await Promise.all([
      base.count().get(),
      base.where("status", "==", "active").count().get(),
      base.where("status", "==", "revoked").count().get(),
    ]);
    const txs = await this.getTransactions(a);
    return {
      issuers: 0,
      credentials: credsSnap.data().count,
      transactions: txs.length,
      activeCredentials: activeSnap.data().count,
      revokedCredentials: revokedSnap.data().count,
    };
  }

  // ----- zk proofs -----

  async createZkProof(proof: InsertZkProof): Promise<ZkProof> {
    const id = newId();
    const payload = {
      id,
      credentialId: proof.credentialId,
      proverAddress: lc(proof.proverAddress),
      proofType: proof.proofType,
      publicInputs: proof.publicInputs ?? null,
      proofData: proof.proofData ?? null,
      commitment: proof.commitment,
      verified: false,
      onChainTxHash: null,
      onChainStatus: "pending",
      createdAt: new Date(),
      expiresAt: proof.expiresAt ?? null,
    };
    await collections.zkProofs.doc(id).set(payload);
    return zkProofFromDoc(id, payload);
  }

  async getZkProof(id: string): Promise<ZkProof | undefined> {
    const doc = await collections.zkProofs.doc(id).get();
    if (!doc.exists) return undefined;
    return zkProofFromDoc(doc.id, doc.data());
  }

  async getZkProofsByProver(address: string): Promise<ZkProof[]> {
    const snap = await collections.zkProofs.where("proverAddress", "==", lc(address)).get();
    return snap.docs
      .map(d => zkProofFromDoc(d.id, d.data()))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getZkProofsByCredential(credentialId: string): Promise<ZkProof[]> {
    const snap = await collections.zkProofs.where("credentialId", "==", credentialId).get();
    return snap.docs
      .map(d => zkProofFromDoc(d.id, d.data()))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async markZkProofVerified(id: string): Promise<ZkProof> {
    await collections.zkProofs.doc(id).update({ verified: true });
    const doc = await collections.zkProofs.doc(id).get();
    return zkProofFromDoc(doc.id, doc.data());
  }

  async updateZkProofOnChain(id: string, txHash: string): Promise<ZkProof> {
    await collections.zkProofs.doc(id).update({ onChainTxHash: txHash, onChainStatus: "anchored" });
    const doc = await collections.zkProofs.doc(id).get();
    return zkProofFromDoc(doc.id, doc.data());
  }

  async markZkProofOnChainFailed(id: string): Promise<void> {
    await collections.zkProofs.doc(id).update({ onChainStatus: "failed" });
  }

  // ----- credential requests -----

  async createCredentialRequest(data: InsertCredentialRequest): Promise<CredentialRequest> {
    const id = newId();
    const now = new Date();
    const payload = {
      id,
      requesterAddress: lc(data.requesterAddress),
      issuerAddress: data.issuerAddress ? lc(data.issuerAddress) : null,
      issuerCategory: data.issuerCategory ?? null,
      claimType: data.claimType,
      message: data.message ?? null,
      status: "pending",
      responseMessage: null,
      credentialId: null,
      onChainTxHash: null,
      createdAt: now,
      updatedAt: now,
    };
    await collections.credentialRequests.doc(id).set(payload);
    return credentialRequestFromDoc(id, payload);
  }

  async getCredentialRequest(id: string): Promise<CredentialRequest | undefined> {
    const doc = await collections.credentialRequests.doc(id).get();
    if (!doc.exists) return undefined;
    return credentialRequestFromDoc(doc.id, doc.data());
  }

  async getCredentialRequestsByRequester(address: string): Promise<CredentialRequest[]> {
    const snap = await collections.credentialRequests.where("requesterAddress", "==", lc(address)).get();
    return snap.docs
      .map(d => credentialRequestFromDoc(d.id, d.data()))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getCredentialRequestsForIssuer(issuerAddress: string): Promise<CredentialRequest[]> {
    const snap = await collections.credentialRequests.where("issuerAddress", "==", lc(issuerAddress)).get();
    return snap.docs
      .map(d => credentialRequestFromDoc(d.id, d.data()))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getPendingRequestsForCategory(category: string): Promise<CredentialRequest[]> {
    const snap = await collections.credentialRequests.where("issuerCategory", "==", category).get();
    return snap.docs
      .map(d => credentialRequestFromDoc(d.id, d.data()))
      .filter(r => r.status === "pending")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async lockRequestForIssuing(id: string): Promise<boolean> {
    try {
      return await firestore.runTransaction(async (txn) => {
        const ref = collections.credentialRequests.doc(id);
        const snap = await txn.get(ref);
        if (!snap.exists) return false;
        const data = snap.data();
        if (data?.status !== "pending") return false;
        txn.update(ref, { status: "issuing", updatedAt: new Date() });
        return true;
      });
    } catch {
      return false;
    }
  }

  async updateCredentialRequestStatus(id: string, status: string, responseMessage?: string, credentialId?: string): Promise<CredentialRequest> {
    await collections.credentialRequests.doc(id).update({
      status,
      responseMessage: responseMessage ?? null,
      credentialId: credentialId ?? null,
      updatedAt: new Date(),
    });
    const doc = await collections.credentialRequests.doc(id).get();
    return credentialRequestFromDoc(doc.id, doc.data());
  }

  async updateCredentialRequestOnChainTxHash(id: string, txHash: string): Promise<void> {
    await collections.credentialRequests.doc(id).update({ onChainTxHash: txHash });
  }
}

export const storage = new FirestoreStorage();
