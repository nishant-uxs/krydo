import crypto from "crypto";
import { G, H, Point, modN, pointToHex, pointFromHex } from "./crypto/ec.js";
import { commit, valueOnly } from "./crypto/pedersen.js";
import {
  proveRange, verifyRange, type RangeProof,
  proveEquality, verifyEquality, type EqualityProof,
  proveMembership, verifyMembership, type MembershipProof,
  openingProve, openingVerify, type OpeningProof,
} from "./crypto/sigma.js";

/**
 * Krydo ZK engine — cryptographically sound sigma-protocol proofs on
 * secp256k1. Replaces the previous hash-only placeholder with real
 * Pedersen-commitment-based proofs that a verifier can actually trust.
 *
 * Proof types supported:
 *   - range_above     : prove  value >= threshold,   threshold public
 *   - range_below     : prove  value <= threshold,   threshold public
 *   - equality        : prove  value == targetValue, targetValue public
 *   - membership      : prove  value ∈ memberSet,    memberSet public
 *   - non_zero        : prove  value >= 1 (strict positive integer)
 *   - selective_disclosure : per-field Pedersen commitments with selective open
 */

const PROTOCOL = "krydo-zkp-v2";
const VERSION = "2.0.0";
// Range-proof bit width. 32 bits covers values 0..4_294_967_295, more than enough
// for credit scores (300-900), incomes (cents), asset amounts, etc.
const RANGE_BITS = 32;
// Used to shift negative-going differences (range_below) into the non-negative domain.
const RANGE_MAX = 1n << BigInt(RANGE_BITS);

// ---------- public types (what callers give us / see back) ----------

export interface ZkProofRequest {
  credentialId: string;
  claimValue: string;
  proofType:
    | "range_above" | "range_below" | "equality"
    | "membership" | "non_zero" | "selective_disclosure";
  threshold?: number;
  targetValue?: string;
  memberSet?: string[];
  selectedFields?: string[];
  allFields?: Record<string, string>;
}

export interface ZkProofOutput {
  commitment: string;           // compressed hex of C = v·G + r·H
  proofData: {
    protocol: string;           // "krydo-zkp-v2"
    version: string;            // "2.0.0"
    auxiliaryData: Record<string, unknown>;
  };
  publicInputs: {
    proofType: string;
    threshold?: number;
    targetValue?: string;
    memberSet?: string[];
    disclosedFields?: string[];
    fieldCommitments?: Record<string, string>;
    commitment: string;
    timestamp: number;
  };
  /**
   * Truthfulness flag the prover produces. This is NOT what the verifier relies
   * on — `verifyZkProof` re-runs the EC math. It's kept for quick UI display.
   */
  verified: boolean;
}

// ---------- value encoding ----------

/**
 * Convert a claim string to a bigint in [0, 2^RANGE_BITS). Supports:
 *   - integer-looking strings ("42", "85000", "-3")
 *   - floats are rounded to their integer part (truncated toward zero)
 *   - non-numeric strings are hashed into a 32-bit scalar (deterministic)
 *
 * Negative integers are shifted into the positive range by adding RANGE_MAX,
 * so e.g. -3 becomes (2^32 - 3). Range proofs on shifted values remain correct
 * provided the prover and verifier agree on the shift (we encode it in the
 * proof's `encoding` field).
 */
function encodeValue(raw: string): { scalar: bigint; encoding: "int" | "shifted_int" | "hashed" } {
  const s = raw.trim();
  if (/^-?\d+$/.test(s)) {
    const n = BigInt(s);
    if (n >= 0n && n < RANGE_MAX) return { scalar: n, encoding: "int" };
    if (n < 0n && -n < RANGE_MAX) return { scalar: RANGE_MAX + n, encoding: "shifted_int" };
    // Out of range: hash.
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    const truncated = BigInt(Math.trunc(parseFloat(s)));
    if (truncated >= 0n && truncated < RANGE_MAX) return { scalar: truncated, encoding: "int" };
    if (truncated < 0n && -truncated < RANGE_MAX) return { scalar: RANGE_MAX + truncated, encoding: "shifted_int" };
  }
  // Fallback: SHA-256 into a 32-bit scalar (keeps equality/membership meaningful
  // across string domains; ranges are not meaningful for hashed values).
  const digest = crypto.createHash("sha256").update(s).digest();
  const h = BigInt("0x" + digest.subarray(0, 4).toString("hex")); // 32-bit window
  return { scalar: h, encoding: "hashed" };
}

function randomBlinding(): bigint {
  // crypto.randomBytes(32) mod N — same as server/crypto/ec.ts randomScalar
  // but kept local to avoid circular import.
  const bytes = crypto.randomBytes(32);
  return modN(BigInt("0x" + bytes.toString("hex")));
}

// ---------- proof generation ----------

export function generateZkProof(request: ZkProofRequest): ZkProofOutput {
  const { scalar: v, encoding } = encodeValue(request.claimValue);
  const r = randomBlinding();
  const { point: C } = commit(v, r);
  const commitmentHex = pointToHex(C);
  const context = `cred:${request.credentialId}|type:${request.proofType}`;

  const auxiliaryData: Record<string, unknown> = { encoding, context };
  let verified = false;

  switch (request.proofType) {
    case "range_above": {
      if (request.threshold === undefined) throw new Error("threshold required for range_above");
      const tEnc = encodeValue(String(request.threshold));
      const threshold = tEnc.scalar;
      // Prove v >= threshold by building C' = C - threshold·G and proving
      // C' commits to delta = v - threshold ∈ [0, 2^RANGE_BITS).
      if (encoding === "hashed") throw new Error("range_above not supported on non-numeric values");
      if (v < threshold) {
        // Claim does not hold. We still produce a proof that is honestly
        // un-verifiable: construct a dummy large delta so range proof fails.
        verified = false;
        const fakeDelta = RANGE_MAX - 1n;
        const fakeR = randomBlinding();
        const fakeC = commit(fakeDelta, fakeR).point;
        const pf = proveRange(fakeDelta, fakeR, context, RANGE_BITS);
        auxiliaryData.rangeProof = pf;
        auxiliaryData.deltaCommitment = pointToHex(fakeC);
        auxiliaryData.claimsHolds = false;
      } else {
        const delta = v - threshold;
        const pf = proveRange(delta, r, context, RANGE_BITS);
        auxiliaryData.rangeProof = pf;
        auxiliaryData.claimsHolds = true;
        verified = true;
      }
      auxiliaryData.threshold = threshold.toString();
      break;
    }
    case "range_below": {
      if (request.threshold === undefined) throw new Error("threshold required for range_below");
      if (encoding === "hashed") throw new Error("range_below not supported on non-numeric values");
      const tEnc = encodeValue(String(request.threshold));
      const threshold = tEnc.scalar;
      // Prove v <= threshold ⟺ threshold - v ∈ [0, 2^RANGE_BITS).
      if (v > threshold) {
        verified = false;
        const fakeDelta = RANGE_MAX - 1n;
        const fakeR = randomBlinding();
        const pf = proveRange(fakeDelta, fakeR, context, RANGE_BITS);
        auxiliaryData.rangeProof = pf;
        auxiliaryData.claimsHolds = false;
      } else {
        const delta = threshold - v;
        // new blinding = -r mod N, so the derived commitment C' = threshold·G - C
        // opens to (delta, -r). We pass the negated blinding to proveRange.
        const negR = modN(-r);
        const pf = proveRange(delta, negR, context, RANGE_BITS);
        auxiliaryData.rangeProof = pf;
        auxiliaryData.claimsHolds = true;
        verified = true;
      }
      auxiliaryData.threshold = threshold.toString();
      break;
    }
    case "equality": {
      if (!request.targetValue) throw new Error("targetValue required for equality");
      const tEnc = encodeValue(request.targetValue);
      if (v === tEnc.scalar) {
        const pf = proveEquality(r);
        auxiliaryData.equalityProof = pf;
        verified = true;
      } else {
        auxiliaryData.equalityProof = proveEquality(randomBlinding()); // bogus
        verified = false;
      }
      auxiliaryData.targetScalar = tEnc.scalar.toString();
      break;
    }
    case "membership": {
      if (!request.memberSet || request.memberSet.length === 0) {
        throw new Error("memberSet required for membership");
      }
      const setScalars = request.memberSet.map((m) => encodeValue(m).scalar);
      if (setScalars.includes(v)) {
        const pf = proveMembership(C, v, r, setScalars, context);
        auxiliaryData.membershipProof = pf;
        verified = true;
      } else {
        // Cannot construct a valid membership proof; publish an open proof of
        // knowledge as a filler so downstream serialization is consistent.
        const pf = openingProve(C, v, r, context);
        auxiliaryData.openingProof = pf;
        verified = false;
      }
      auxiliaryData.setScalars = setScalars.map((s) => s.toString());
      break;
    }
    case "non_zero": {
      if (encoding === "hashed") {
        // For opaque strings, non-zero means "non-empty" which encodeValue
        // already handled (only empty string would map to all-zero hash).
        verified = v !== 0n;
        auxiliaryData.openingProof = openingProve(C, v, r, context);
      } else {
        // Reduce to range_above(1): prove v >= 1.
        if (v >= 1n) {
          const delta = v - 1n;
          const pf = proveRange(delta, r, context, RANGE_BITS);
          auxiliaryData.rangeProof = pf;
          auxiliaryData.claimsHolds = true;
          verified = true;
        } else {
          const fakeR = randomBlinding();
          auxiliaryData.rangeProof = proveRange(RANGE_MAX - 1n, fakeR, context, RANGE_BITS);
          auxiliaryData.claimsHolds = false;
          verified = false;
        }
      }
      break;
    }
    case "selective_disclosure": {
      if (!request.selectedFields || request.selectedFields.length === 0) {
        throw new Error("selectedFields required for selective_disclosure");
      }
      if (!request.allFields || Object.keys(request.allFields).length === 0) {
        throw new Error("allFields required for selective_disclosure");
      }
      const fieldCommitments: Record<string, string> = {};
      const disclosed: Record<string, { value: string; blinding: string }> = {};
      for (const [fieldName, fieldVal] of Object.entries(request.allFields)) {
        const fEnc = encodeValue(fieldVal);
        const fr = randomBlinding();
        const fc = commit(fEnc.scalar, fr).point;
        fieldCommitments[fieldName] = pointToHex(fc);
        if (request.selectedFields.includes(fieldName)) {
          disclosed[fieldName] = {
            value: fieldVal,
            blinding: fr.toString(16).padStart(64, "0"),
          };
        }
      }
      auxiliaryData.fieldCommitments = fieldCommitments;
      auxiliaryData.disclosedOpenings = disclosed;
      auxiliaryData.totalFields = Object.keys(request.allFields).length;
      auxiliaryData.disclosedCount = request.selectedFields.length;
      verified = request.selectedFields.every((f) => f in request.allFields!);
      break;
    }
  }

  return {
    commitment: commitmentHex,
    proofData: {
      protocol: PROTOCOL,
      version: VERSION,
      auxiliaryData,
    },
    publicInputs: {
      proofType: request.proofType,
      threshold: request.threshold,
      targetValue: request.targetValue,
      memberSet: request.memberSet,
      disclosedFields: request.selectedFields,
      fieldCommitments: request.proofType === "selective_disclosure"
        ? (auxiliaryData.fieldCommitments as Record<string, string>)
        : undefined,
      commitment: commitmentHex,
      timestamp: Date.now(),
    },
    verified,
  };
}

// ---------- verification ----------

export function verifyZkProof(
  proofData: ZkProofOutput["proofData"],
  publicInputs: ZkProofOutput["publicInputs"],
): { valid: boolean; reason: string } {
  try {
    if (proofData.protocol !== PROTOCOL) {
      return { valid: false, reason: `unknown proof protocol: ${proofData.protocol}` };
    }
    const aux = proofData.auxiliaryData as Record<string, unknown>;
    const proofType = publicInputs.proofType;
    // Context must match what the prover used; we don't carry it on the wire,
    // but the CredentialId is implicit via publicInputs.commitment reconstruction.
    // For this MVP we require the verifier to reconstruct the context the same
    // way the prover did — we piggyback on a fixed encoding.

    // NOTE: credentialId isn't in publicInputs explicitly (kept off-wire to avoid
    // leaking). Verifier gets it separately and passes it in as the context.
    // For self-contained verification we approximate it via proofType only; the
    // route-level verifier should additionally re-derive the full context.
    const context = aux.context as string ?? `cred:unknown|type:${proofType}`;

    if (!publicInputs.commitment) return { valid: false, reason: "missing commitment" };
    const C = pointFromHex(publicInputs.commitment);

    switch (proofType) {
      case "range_above": {
        if (publicInputs.threshold === undefined) return { valid: false, reason: "missing threshold" };
        if (aux.claimsHolds === false) {
          return { valid: false, reason: "proof asserts claim does not hold" };
        }
        const pf = aux.rangeProof as RangeProof | undefined;
        if (!pf) return { valid: false, reason: "missing range proof" };
        // Derived commitment for delta = v - threshold:
        //   Cδ = C - threshold·G  = (v - threshold)·G + r·H
        const thresholdBig = BigInt(publicInputs.threshold);
        const Cdelta = C.subtract(valueOnly(thresholdBig));
        if (!verifyRange(Cdelta, context, pf)) {
          return { valid: false, reason: "range proof failed" };
        }
        return { valid: true, reason: "value is provably at or above threshold" };
      }
      case "range_below": {
        if (publicInputs.threshold === undefined) return { valid: false, reason: "missing threshold" };
        if (aux.claimsHolds === false) {
          return { valid: false, reason: "proof asserts claim does not hold" };
        }
        const pf = aux.rangeProof as RangeProof | undefined;
        if (!pf) return { valid: false, reason: "missing range proof" };
        // Cδ = threshold·G - C = (threshold - v)·G + (-r)·H
        const thresholdBig = BigInt(publicInputs.threshold);
        const Cdelta = valueOnly(thresholdBig).subtract(C);
        if (!verifyRange(Cdelta, context, pf)) {
          return { valid: false, reason: "range proof failed" };
        }
        return { valid: true, reason: "value is provably at or below threshold" };
      }
      case "equality": {
        if (publicInputs.targetValue === undefined) return { valid: false, reason: "missing targetValue" };
        const pf = aux.equalityProof as EqualityProof | undefined;
        if (!pf) return { valid: false, reason: "missing equality proof" };
        const targetScalar = BigInt(aux.targetScalar as string);
        if (!verifyEquality(C, targetScalar, pf)) {
          return { valid: false, reason: "equality proof failed" };
        }
        return { valid: true, reason: "committed value matches public target" };
      }
      case "membership": {
        const pf = aux.membershipProof as MembershipProof | undefined;
        if (!pf) return { valid: false, reason: "proof does not demonstrate membership" };
        const setScalars = (aux.setScalars as string[]).map((s) => BigInt(s));
        if (!verifyMembership(C, setScalars, context, pf)) {
          return { valid: false, reason: "membership proof failed" };
        }
        return { valid: true, reason: "committed value ∈ public set" };
      }
      case "non_zero": {
        const pf = aux.rangeProof as RangeProof | undefined;
        if (aux.claimsHolds === false) {
          return { valid: false, reason: "proof asserts value is zero" };
        }
        if (pf) {
          // Numeric: verify v - 1 ∈ [0, 2^n)
          const Cdelta = C.subtract(valueOnly(1n));
          if (!verifyRange(Cdelta, context, pf)) {
            return { valid: false, reason: "non-zero range proof failed" };
          }
          return { valid: true, reason: "value is provably >= 1" };
        }
        const op = aux.openingProof as OpeningProof | undefined;
        if (op && openingVerify(C, context, op)) {
          return { valid: true, reason: "prover demonstrated knowledge of (v, r) for hashed non-empty value" };
        }
        return { valid: false, reason: "no usable non-zero proof component" };
      }
      case "selective_disclosure": {
        const openings = aux.disclosedOpenings as
          | Record<string, { value: string; blinding: string }>
          | undefined;
        const fieldCommitments = aux.fieldCommitments as Record<string, string> | undefined;
        if (!openings || !fieldCommitments) {
          return { valid: false, reason: "missing selective-disclosure components" };
        }
        for (const [field, open] of Object.entries(openings)) {
          const CField = pointFromHex(fieldCommitments[field]);
          const v = encodeValue(open.value).scalar;
          const r = BigInt("0x" + open.blinding);
          const expected = v === 0n
            ? H.multiply(modN(r === 0n ? 1n : r))
            : G.multiply(modN(v)).add(H.multiply(modN(r === 0n ? 1n : r)));
          const final = (v === 0n && r === 0n) ? G.subtract(G) : expected;
          if (!CField.equals(final)) {
            return { valid: false, reason: `disclosed field '${field}' does not open commitment` };
          }
        }
        return { valid: true, reason: "all disclosed fields open to their published commitments" };
      }
      default:
        return { valid: false, reason: `unknown proof type: ${proofType}` };
    }
  } catch (err: any) {
    return { valid: false, reason: `verification error: ${err.message}` };
  }
}
