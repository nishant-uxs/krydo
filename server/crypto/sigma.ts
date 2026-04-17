import {
  G, H, Point,
  N,
  modN,
  randomScalar,
  hashToScalar,
  pointToHex, pointFromHex,
  scalarToHex, scalarFromHex,
} from "./ec.js";
import { valueOnly, addCommitments, subCommitments, scaleCommitment } from "./pedersen.js";

/**
 * Sigma protocols over Pedersen commitments on secp256k1.
 *
 * All proofs are non-interactive via Fiat-Shamir:
 *   challenge c = H("krydo-zkp-v2" || domain || public-inputs || prover-commits)
 *
 * Security: EUF-CMA / honest-verifier zero-knowledge under the discrete-log
 * assumption on secp256k1. Soundness error = 1/N ≈ 2^-256 per protocol step.
 */

const DOMAIN = "krydo-zkp-v2";

// ---------------------------------------------------------------------------
// Schnorr proof of knowledge of a scalar x s.t. Y = x · BASE
// ---------------------------------------------------------------------------

export interface SchnorrProof {
  T: string; // commitment T = k · BASE
  s: string; // response s = k + c · x
}

export function schnorrProve(x: bigint, BASE: Point, context: string): SchnorrProof {
  const k = randomScalar();
  const T = BASE.multiply(modN(k === 0n ? 1n : k));
  const Y = BASE.multiply(modN(x === 0n ? 1n : x));
  const c = hashToScalar(DOMAIN, context, pointToHex(Y), pointToHex(T));
  const s = modN(k + c * modN(x));
  return { T: pointToHex(T), s: scalarToHex(s) };
}

export function schnorrVerify(Y: Point, BASE: Point, context: string, proof: SchnorrProof): boolean {
  try {
    const T = pointFromHex(proof.T);
    const s = scalarFromHex(proof.s);
    const c = hashToScalar(DOMAIN, context, pointToHex(Y), proof.T);
    // s · BASE ?= T + c · Y
    const lhs = BASE.multiply(modN(s === 0n ? 1n : s));
    const rhsAdd = Y.multiply(modN(c === 0n ? 1n : c));
    const rhs = T.add(rhsAdd);
    return lhs.equals(rhs);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Knowledge-of-opening proof: prove I know (v, r) s.t. C = v·G + r·H
// Implemented as a combined Schnorr over two bases.
// ---------------------------------------------------------------------------

export interface OpeningProof {
  T: string;   // T = kv·G + kr·H
  sv: string;  // sv = kv + c·v
  sr: string;  // sr = kr + c·r
}

export function openingProve(C: Point, v: bigint, r: bigint, context: string): OpeningProof {
  const kv = randomScalar();
  const kr = randomScalar();
  const T = G.multiply(modN(kv)).add(H.multiply(modN(kr)));
  const c = hashToScalar(DOMAIN, "opening", context, pointToHex(C), pointToHex(T));
  const sv = modN(kv + c * modN(v));
  const sr = modN(kr + c * modN(r));
  return { T: pointToHex(T), sv: scalarToHex(sv), sr: scalarToHex(sr) };
}

export function openingVerify(C: Point, context: string, proof: OpeningProof): boolean {
  try {
    const T = pointFromHex(proof.T);
    const sv = scalarFromHex(proof.sv);
    const sr = scalarFromHex(proof.sr);
    const c = hashToScalar(DOMAIN, "opening", context, pointToHex(C), proof.T);
    // sv·G + sr·H ?= T + c·C
    const lhs = G.multiply(modN(sv === 0n ? 1n : sv)).add(H.multiply(modN(sr === 0n ? 1n : sr)));
    const rhs = T.add(C.multiply(modN(c === 0n ? 1n : c)));
    return lhs.equals(rhs);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bit proof: prove B = b·G + r·H with b ∈ {0, 1}, without revealing b.
// Implemented as a Chaum-Pedersen-style OR-proof.
// ---------------------------------------------------------------------------

export interface BitProof {
  T0: string;
  T1: string;
  c0: string;
  c1: string;
  s0: string;
  s1: string;
}

function proveBit(B: Point, bit: 0 | 1, r: bigint, context: string): BitProof {
  // P0 = B (if bit=0, then B = r·H)
  // P1 = B - G (if bit=1, then B - G = r·H)
  const P0 = B;
  const P1 = B.subtract(G);

  if (bit === 0) {
    // Real branch: know log_H(P0) = r. Fake branch for bit=1.
    const k0 = randomScalar();
    const T0 = H.multiply(modN(k0));
    const c1 = randomScalar();
    const s1 = randomScalar();
    const T1 = H.multiply(modN(s1)).subtract(P1.multiply(modN(c1)));
    const c = hashToScalar(DOMAIN, "bit", context, pointToHex(B), pointToHex(T0), pointToHex(T1));
    const c0 = modN(c - c1);
    const s0 = modN(k0 + c0 * modN(r));
    return {
      T0: pointToHex(T0), T1: pointToHex(T1),
      c0: scalarToHex(c0), c1: scalarToHex(c1),
      s0: scalarToHex(s0), s1: scalarToHex(s1),
    };
  } else {
    // Real branch: know log_H(P1) = r. Fake branch for bit=0.
    const k1 = randomScalar();
    const T1 = H.multiply(modN(k1));
    const c0 = randomScalar();
    const s0 = randomScalar();
    const T0 = H.multiply(modN(s0)).subtract(P0.multiply(modN(c0)));
    const c = hashToScalar(DOMAIN, "bit", context, pointToHex(B), pointToHex(T0), pointToHex(T1));
    const c1 = modN(c - c0);
    const s1 = modN(k1 + c1 * modN(r));
    return {
      T0: pointToHex(T0), T1: pointToHex(T1),
      c0: scalarToHex(c0), c1: scalarToHex(c1),
      s0: scalarToHex(s0), s1: scalarToHex(s1),
    };
  }
}

function verifyBit(B: Point, context: string, proof: BitProof): boolean {
  try {
    const T0 = pointFromHex(proof.T0);
    const T1 = pointFromHex(proof.T1);
    const c0 = scalarFromHex(proof.c0);
    const c1 = scalarFromHex(proof.c1);
    const s0 = scalarFromHex(proof.s0);
    const s1 = scalarFromHex(proof.s1);
    const P0 = B;
    const P1 = B.subtract(G);
    const c = hashToScalar(DOMAIN, "bit", context, pointToHex(B), proof.T0, proof.T1);
    if (modN(c0 + c1) !== modN(c)) return false;
    // s0·H ?= T0 + c0·P0
    const lhs0 = H.multiply(modN(s0 === 0n ? 1n : s0));
    const rhs0 = T0.add(P0.multiply(modN(c0 === 0n ? 1n : c0)));
    if (!lhs0.equals(rhs0)) return false;
    // s1·H ?= T1 + c1·P1
    const lhs1 = H.multiply(modN(s1 === 0n ? 1n : s1));
    const rhs1 = T1.add(P1.multiply(modN(c1 === 0n ? 1n : c1)));
    return lhs1.equals(rhs1);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Range proof: prove a commitment C = v·G + r·H hides v in [0, 2^bits - 1].
// Uses bit decomposition: commit to each bit, prove each is 0 or 1, verify
// that the weighted sum equals C.
// ---------------------------------------------------------------------------

export interface RangeProof {
  bits: BitProof[];
  bitCommitments: string[]; // compressed hex points
  /** Blinding correction: r_correction = r - Σ (r_i · 2^i).  Revealed, safe. */
  rCorrection: string;
}

/** @param vRangeBits max bit-length of v (default 32, i.e. up to ~4.29 billion). */
export function proveRange(
  value: bigint,
  blinding: bigint,
  context: string,
  vRangeBits = 32,
): RangeProof {
  if (value < 0n) {
    throw new Error("range proof requires non-negative value");
  }
  if (value >= 1n << BigInt(vRangeBits)) {
    throw new Error(`value out of declared range [0, 2^${vRangeBits})`);
  }

  const bitProofs: BitProof[] = [];
  const bitCommitments: string[] = [];
  const bitBlindings: bigint[] = [];

  let sumR = 0n;
  for (let i = 0; i < vRangeBits; i++) {
    const bit = Number((value >> BigInt(i)) & 1n) as 0 | 1;
    const r_i = randomScalar();
    const B_i = G.multiply(modN(bit === 0 ? 1n : BigInt(bit)))
      .add(H.multiply(modN(r_i)));
    // Fix the bit=0 case: we used `1n` only because noble rejects multiply(0).
    const B_i_real = bit === 0 ? H.multiply(modN(r_i)) : B_i;
    bitCommitments.push(pointToHex(B_i_real));
    bitBlindings.push(r_i);
    bitProofs.push(proveBit(B_i_real, bit, r_i, `${context}|bit${i}`));
    sumR = modN(sumR + r_i * (1n << BigInt(i)));
  }

  // Correction so that Σ 2^i · B_i - r_correction · H = v·G, i.e. C and Σ align.
  // Prover reveals r_correction = r - Σ(r_i · 2^i) so verifier can rebuild.
  const rCorrection = modN(blinding - sumR);

  return {
    bits: bitProofs,
    bitCommitments,
    rCorrection: scalarToHex(rCorrection),
  };
}

export function verifyRange(C: Point, context: string, proof: RangeProof): boolean {
  try {
    if (proof.bits.length !== proof.bitCommitments.length) return false;
    // 1) Every bit commitment must pass the bit proof.
    for (let i = 0; i < proof.bits.length; i++) {
      const B_i = pointFromHex(proof.bitCommitments[i]);
      if (!verifyBit(B_i, `${context}|bit${i}`, proof.bits[i])) return false;
    }

    // 2) Σ 2^i · B_i + r_correction · H ?= C
    let acc: Point | null = null;
    for (let i = 0; i < proof.bitCommitments.length; i++) {
      const B_i = pointFromHex(proof.bitCommitments[i]);
      const weight = 1n << BigInt(i);
      const weighted = weight === 0n ? null : B_i.multiply(modN(weight));
      if (weighted === null) continue;
      acc = acc === null ? weighted : acc.add(weighted);
    }
    if (acc === null) return false;

    const rc = scalarFromHex(proof.rCorrection);
    const rhs = acc.add(H.multiply(modN(rc === 0n ? 1n : rc)));
    // Handle r_correction = 0 case explicitly
    const rhsFinal = rc === 0n ? acc : rhs;
    return rhsFinal.equals(C);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Equality proof: prove C commits to a publicly-known targetValue.
// Simply reveal the blinding; verifier recomputes.
// ---------------------------------------------------------------------------

export interface EqualityProof {
  blinding: string;
}

export function proveEquality(blinding: bigint): EqualityProof {
  return { blinding: scalarToHex(blinding) };
}

export function verifyEquality(C: Point, targetValue: bigint, proof: EqualityProof): boolean {
  try {
    const r = scalarFromHex(proof.blinding);
    // C ?= target·G + r·H
    const expected = targetValue === 0n
      ? H.multiply(modN(r === 0n ? 1n : r))
      : G.multiply(modN(targetValue)).add(H.multiply(modN(r === 0n ? 1n : r)));
    const expFinal = (targetValue === 0n && r === 0n)
      ? G.subtract(G) // identity
      : expected;
    return C.equals(expFinal);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Membership proof: prove C commits to some element of a public set S.
// k-way OR of Schnorr proofs of knowledge of log_H(C - s_j · G) for j∈[0,k).
// ---------------------------------------------------------------------------

export interface MembershipProof {
  Ts: string[]; // per-branch commitments
  cs: string[]; // per-branch challenges (sum to overall c)
  ss: string[]; // per-branch responses
}

export function proveMembership(
  C: Point,
  value: bigint,
  blinding: bigint,
  memberSet: bigint[],
  context: string,
): MembershipProof {
  const k = memberSet.length;
  if (k === 0) throw new Error("empty member set");
  const realIdx = memberSet.findIndex((m) => m === value);
  if (realIdx < 0) throw new Error("claim value is not in member set");

  // P_j = C - s_j · G. For j == realIdx, P_realIdx = blinding · H.
  const Ps = memberSet.map((s) => s === 0n ? C : C.subtract(valueOnly(s)));

  const Ts: Point[] = new Array(k);
  const cs: bigint[] = new Array(k);
  const ss: bigint[] = new Array(k);

  // Pick a real random commitment for the real branch.
  const kReal = randomScalar();

  // Pre-pick fake (c_j, s_j) and derive T_j for every j != realIdx.
  for (let j = 0; j < k; j++) {
    if (j === realIdx) continue;
    cs[j] = randomScalar();
    ss[j] = randomScalar();
    // T_j = s_j·H - c_j·P_j
    const sH = H.multiply(modN(ss[j] === 0n ? 1n : ss[j]));
    const cP = Ps[j].multiply(modN(cs[j] === 0n ? 1n : cs[j]));
    Ts[j] = sH.subtract(cP);
  }
  Ts[realIdx] = H.multiply(modN(kReal));

  // Overall challenge binds all T_j's, the set, and C.
  const setHashInputs: string[] = [];
  for (const s of memberSet) setHashInputs.push(scalarToHex(s));
  const c = hashToScalar(
    DOMAIN, "membership", context, pointToHex(C),
    ...setHashInputs,
    ...Ts.map(pointToHex),
  );

  // Real challenge = c - Σ (fake c_j)
  let sumFake = 0n;
  for (let j = 0; j < k; j++) if (j !== realIdx) sumFake = modN(sumFake + cs[j]);
  cs[realIdx] = modN(c - sumFake);
  ss[realIdx] = modN(kReal + cs[realIdx] * modN(blinding));

  return {
    Ts: Ts.map(pointToHex),
    cs: cs.map(scalarToHex),
    ss: ss.map(scalarToHex),
  };
}

export function verifyMembership(
  C: Point,
  memberSet: bigint[],
  context: string,
  proof: MembershipProof,
): boolean {
  try {
    const k = memberSet.length;
    if (proof.Ts.length !== k || proof.cs.length !== k || proof.ss.length !== k) return false;
    const Ts = proof.Ts.map(pointFromHex);
    const cs = proof.cs.map(scalarFromHex);
    const ss = proof.ss.map(scalarFromHex);
    const Ps = memberSet.map((s) => s === 0n ? C : C.subtract(valueOnly(s)));

    // Rebuild the overall challenge and check c = Σ c_j.
    const setHashInputs: string[] = [];
    for (const s of memberSet) setHashInputs.push(scalarToHex(s));
    const c = hashToScalar(
      DOMAIN, "membership", context, pointToHex(C),
      ...setHashInputs,
      ...proof.Ts,
    );
    let sum = 0n;
    for (const ci of cs) sum = modN(sum + ci);
    if (sum !== modN(c)) return false;

    // Every branch must satisfy: s_j · H ?= T_j + c_j · P_j
    for (let j = 0; j < k; j++) {
      const lhs = H.multiply(modN(ss[j] === 0n ? 1n : ss[j]));
      const rhs = Ts[j].add(Ps[j].multiply(modN(cs[j] === 0n ? 1n : cs[j])));
      if (!lhs.equals(rhs)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
