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

/**
 * Block number placeholder for transaction rows that are not (yet) anchored
 * on-chain. When a real block number is known it is filled in via
 * `updateTransactionOnChain`.
 */
const NO_BLOCK = "0";

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

// ---------- pagination ----------

// The types live in middleware/pagination.ts so they're importable without
// pulling Firebase in transitively.
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type PageOpts,
  type PageResult,
} from "./middleware/pagination";

export { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT };
export type { PageOpts, PageResult };

/** Clamp + normalize an incoming PageOpts. */
function normalizePage(opts?: PageOpts): { limit: number; cursor: string | null } {
  const raw = opts?.limit ?? DEFAULT_PAGE_LIMIT;
  const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(raw)));
  return { limit, cursor: opts?.cursor ?? null };
}

/**
 * Turn an ordered Firestore query into a paginated result. The cursor we
 * return to the client is just the last document's id; on the next call we
 * fetch that doc and use it as `startAfter` anchor.
 */
async function paginateQuery<T>(
  baseQuery: FirebaseFirestore.Query,
  coll: FirebaseFirestore.CollectionReference,
  opts: PageOpts | undefined,
  mapFn: (id: string, data: any) => T,
): Promise<PageResult<T>> {
  const { limit, cursor } = normalizePage(opts);
  let q = baseQuery;
  if (cursor) {
    const anchor = await coll.doc(cursor).get();
    if (anchor.exists) q = q.startAfter(anchor);
  }
  q = q.limit(limit + 1); // fetch one extra to detect if more exist
  const snap = await q.get();
  const hasMore = snap.docs.length > limit;
  const pageDocs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
  const items = pageDocs.map((d) => mapFn(d.id, d.data()));
  const nextCursor = hasMore ? pageDocs[pageDocs.length - 1].id : null;
  return { items, nextCursor };
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
  updateTransactionOnChain(id: string, txHash: string, blockNumber: string): Promise<void>;
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

  // --- paginated list endpoints ---
  listIssuersPaged(opts?: PageOpts): Promise<PageResult<Issuer>>;
  listCredentialsForHolderPaged(address: string, opts?: PageOpts): Promise<PageResult<Credential>>;
  listCredentialsByIssuerPaged(address: string, opts?: PageOpts): Promise<PageResult<Credential>>;
  listAllCredentialsPaged(opts?: PageOpts): Promise<PageResult<Credential>>;
  listTransactionsPaged(address: string | undefined, opts?: PageOpts): Promise<PageResult<Transaction>>;
  listCredentialRequestsByRequesterPaged(address: string, opts?: PageOpts): Promise<PageResult<CredentialRequest>>;
  listCredentialRequestsForIssuerPaged(address: string, opts?: PageOpts): Promise<PageResult<CredentialRequest>>;
  listZkProofsByProverPaged(address: string, opts?: PageOpts): Promise<PageResult<ZkProof>>;
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
      blockNumber: NO_BLOCK,
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
      blockNumber: NO_BLOCK,
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
      blockNumber: NO_BLOCK,
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
      blockNumber: NO_BLOCK,
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
      blockNumber: NO_BLOCK,
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
      blockNumber: NO_BLOCK,
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

  /** Update both tx hash and real block number once the on-chain receipt is in. */
  async updateTransactionOnChain(id: string, txHash: string, blockNumber: string): Promise<void> {
    await collections.transactions.doc(id).update({ txHash, blockNumber });
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

  // ----- paginated list implementations -----

  async listIssuersPaged(opts?: PageOpts): Promise<PageResult<Issuer>> {
    return paginateQuery(
      collections.issuers.orderBy("approvedAt", "desc"),
      collections.issuers,
      opts,
      (id, data) => issuerFromDoc(id, data),
    );
  }

  async listCredentialsForHolderPaged(address: string, opts?: PageOpts): Promise<PageResult<Credential>> {
    return paginateQuery(
      collections.credentials
        .where("holderAddress", "==", lc(address))
        .orderBy("issuedAt", "desc"),
      collections.credentials,
      opts,
      (id, data) => credentialFromDoc(id, data),
    );
  }

  async listCredentialsByIssuerPaged(address: string, opts?: PageOpts): Promise<PageResult<Credential>> {
    return paginateQuery(
      collections.credentials
        .where("issuerAddress", "==", lc(address))
        .orderBy("issuedAt", "desc"),
      collections.credentials,
      opts,
      (id, data) => credentialFromDoc(id, data),
    );
  }

  async listAllCredentialsPaged(opts?: PageOpts): Promise<PageResult<Credential>> {
    return paginateQuery(
      collections.credentials.orderBy("issuedAt", "desc"),
      collections.credentials,
      opts,
      (id, data) => credentialFromDoc(id, data),
    );
  }

  async listTransactionsPaged(
    address: string | undefined,
    opts?: PageOpts,
  ): Promise<PageResult<Transaction>> {
    // "all transactions" case uses Firestore-native pagination.
    if (!address) {
      return paginateQuery(
        collections.transactions.orderBy("timestamp", "desc"),
        collections.transactions,
        opts,
        (id, data) => transactionFromDoc(id, data),
      );
    }
    // Per-address requires merging two queries (from-address OR to-address),
    // so we fall back to offset-style: fetch all then slice. The cursor we
    // return is the next slice offset encoded as a string.
    const all = await this.getTransactions(address);
    const { limit } = normalizePage(opts);
    const offset = opts?.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
    const items = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
    return { items, nextCursor };
  }

  async listCredentialRequestsByRequesterPaged(address: string, opts?: PageOpts): Promise<PageResult<CredentialRequest>> {
    return paginateQuery(
      collections.credentialRequests
        .where("requesterAddress", "==", lc(address))
        .orderBy("createdAt", "desc"),
      collections.credentialRequests,
      opts,
      (id, data) => credentialRequestFromDoc(id, data),
    );
  }

  async listCredentialRequestsForIssuerPaged(address: string, opts?: PageOpts): Promise<PageResult<CredentialRequest>> {
    // Issuer sees both direct (issuerAddress = me) and pending-category requests.
    // We merge in memory then offset-paginate — data volume per issuer is small.
    const issuer = await this.getIssuerByAddress(address);
    if (!issuer) return { items: [], nextCursor: null };

    const [direct, categoryPending] = await Promise.all([
      this.getCredentialRequestsForIssuer(issuer.walletAddress),
      this.getPendingRequestsForCategory(issuer.category),
    ]);
    const seen = new Set<string>();
    const merged: CredentialRequest[] = [];
    for (const r of [...direct, ...categoryPending]) {
      if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
    }
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const { limit } = normalizePage(opts);
    const offset = opts?.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
    const items = merged.slice(offset, offset + limit);
    const nextCursor = offset + limit < merged.length ? String(offset + limit) : null;
    return { items, nextCursor };
  }

  async listZkProofsByProverPaged(address: string, opts?: PageOpts): Promise<PageResult<ZkProof>> {
    return paginateQuery(
      collections.zkProofs
        .where("proverAddress", "==", lc(address))
        .orderBy("createdAt", "desc"),
      collections.zkProofs,
      opts,
      (id, data) => zkProofFromDoc(id, data),
    );
  }
}

export const storage = new FirestoreStorage();
