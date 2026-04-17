import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";

/**
 * Low-level elliptic-curve primitives used by the Krydo ZK stack. We commit to
 * secp256k1 because ethers.js already carries it and we never need pairings.
 * The "real ZK" here is sigma-protocol-based (Pedersen + Schnorr + OR-proofs),
 * not SNARKs, but it is cryptographically sound: soundness + honest-verifier ZK
 * under the discrete-log assumption on secp256k1.
 */

export const Point = secp256k1.Point;
export type Point = InstanceType<typeof Point>;

/** Curve order (scalar field modulus). */
export const N: bigint = (Point as any).Fn.ORDER;

/** Standard generator. */
export const G: Point = Point.BASE;

// ---------- hashing / Fiat-Shamir ----------

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

function toBytes(part: string | Uint8Array): Uint8Array {
  return typeof part === "string" ? utf8ToBytes(part) : part;
}

/** Domain-separated SHA-256 over a concatenation of tagged parts. */
export function hashBytes(...parts: (string | Uint8Array)[]): Uint8Array {
  return nobleSha256(concatBytes(...parts.map(toBytes)));
}

/** Hash-to-scalar: SHA-256 mapped into Z_n via reduction. */
export function hashToScalar(...parts: (string | Uint8Array)[]): bigint {
  const bytes = hashBytes(...parts);
  const x = BigInt("0x" + bytesToHex(bytes));
  return modN(x);
}

// ---------- scalar arithmetic ----------

export function modN(x: bigint): bigint {
  const r = x % N;
  return r < 0n ? r + N : r;
}

/** Uniform random non-zero scalar in [1, N-1]. */
export function randomScalar(): bigint {
  while (true) {
    const bytes = secp256k1.utils.randomSecretKey();
    const x = BigInt("0x" + bytesToHex(bytes));
    if (x > 0n && x < N) return x;
  }
}

/** Modular inverse via extended Euclidean. */
export function invModN(a: bigint): bigint {
  let [old_r, r] = [modN(a), N];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error("not invertible");
  return modN(old_s);
}

// ---------- encoding ----------

export function pointToHex(p: Point): string {
  return p.toHex(true); // compressed (33 bytes / 66 hex chars)
}

export function pointFromHex(s: string): Point {
  return Point.fromHex(s);
}

export function scalarToHex(s: bigint): string {
  return modN(s).toString(16).padStart(64, "0");
}

export function scalarFromHex(s: string): bigint {
  return modN(BigInt("0x" + s));
}

// ---------- "nothing-up-my-sleeve" generator H ----------

/**
 * Derive a curve point deterministically from a domain tag via try-and-increment.
 * The discrete log of the resulting point w.r.t. G is unknown (provided no one
 * back-doored SHA-256), which is the exact security requirement for a second
 * Pedersen generator.
 */
function deriveNumsPoint(tag: string): Point {
  for (let ctr = 0; ctr < 1024; ctr++) {
    const digest = hashBytes(`${tag}|${ctr}`);
    // Try both even and odd y by flipping the compressed prefix.
    for (const prefix of [0x02, 0x03]) {
      try {
        const compressed = new Uint8Array(33);
        compressed[0] = prefix;
        compressed.set(digest, 1);
        return Point.fromHex(bytesToHex(compressed));
      } catch {
        /* not on curve with this prefix; try next */
      }
    }
  }
  throw new Error("deriveNumsPoint: exhausted candidates (should never happen)");
}

/** Fixed second Pedersen generator; log_G(H) is unknown. */
export const H = deriveNumsPoint("krydo-zkp-v2-pedersen-H");

// ---------- helpers for transcripts ----------

export function encodePoints(points: Point[]): Uint8Array {
  return concatBytes(...points.map((p) => hexToBytes(pointToHex(p))));
}

export function encodeScalars(scalars: bigint[]): Uint8Array {
  return concatBytes(...scalars.map((s) => hexToBytes(scalarToHex(s))));
}

export { hexToBytes, bytesToHex };
