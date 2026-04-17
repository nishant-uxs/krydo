import crypto from "crypto";

/**
 * Short-lived nonce storage for SIWE challenges. In-memory is fine because
 * nonces are only valid for a few minutes and we gracefully handle expiry.
 * Swap to Redis later if we need horizontal scale.
 */
interface NonceEntry {
  nonce: string;
  address: string; // lowercased
  issuedAt: number;
  expiresAt: number;
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_NONCES = 10_000;

const store = new Map<string, NonceEntry>();

function gc(now: number) {
  if (store.size < MAX_NONCES) return;
  store.forEach((v, k) => {
    if (v.expiresAt <= now) store.delete(k);
  });
}

export function issueNonce(address: string): { nonce: string; expiresAt: number } {
  const lc = address.toLowerCase();
  const nonce = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  const expiresAt = now + NONCE_TTL_MS;
  gc(now);
  store.set(nonce, { nonce, address: lc, issuedAt: now, expiresAt });
  return { nonce, expiresAt };
}

/**
 * Single-use consume: returns true iff the nonce exists, matches the address,
 * hasn't expired, and removes it from the store in the process.
 */
export function consumeNonce(nonce: string, address: string): boolean {
  const entry = store.get(nonce);
  if (!entry) return false;
  store.delete(nonce);
  if (entry.expiresAt < Date.now()) return false;
  return entry.address === address.toLowerCase();
}
