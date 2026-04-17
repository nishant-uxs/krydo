import { G, H, Point, randomScalar, modN } from "./ec.js";

/**
 * Pedersen commitments on secp256k1:
 *   C = v·G + r·H
 *
 * Perfectly hiding (given H with unknown log_G) and computationally binding
 * under the discrete-log assumption.
 *
 * Homomorphic:
 *   C(v1, r1) + C(v2, r2) = C(v1+v2, r1+r2)
 *   k · C(v, r)           = C(k·v, k·r)
 */

export interface Commitment {
  /** The curve point C = v·G + r·H. */
  point: Point;
  /** Witness (secret): value being committed to. */
  value: bigint;
  /** Witness (secret): blinding factor. */
  blinding: bigint;
}

/** Create a Pedersen commitment. If `blinding` is omitted, a fresh random one is used. */
export function commit(value: bigint, blinding: bigint = randomScalar()): Commitment {
  const point = G.multiply(modN(value === 0n ? N_EPSILON : value))
    .add(H.multiply(modN(blinding)));
  // The dance above handles a noble quirk: `multiply(0n)` throws. We use a sentinel
  // only to compute, but re-add the "real zero" below if value was actually 0.
  const actualPoint = value === 0n
    ? H.multiply(modN(blinding))
    : point;
  return { point: actualPoint, value, blinding };
}

// noble's Point.multiply rejects 0; we swap in any safe non-zero then subtract.
const N_EPSILON = 1n;

/** Verify that a commitment C opens to (value, blinding). */
export function verifyOpen(C: Point, value: bigint, blinding: bigint): boolean {
  const expected = value === 0n
    ? H.multiply(modN(blinding))
    : G.multiply(modN(value)).add(H.multiply(modN(blinding)));
  return C.equals(expected);
}

/** C1 + C2 commits to (v1+v2, r1+r2). */
export function addCommitments(C1: Point, C2: Point): Point {
  return C1.add(C2);
}

/** k · C commits to (k·v, k·r). */
export function scaleCommitment(C: Point, k: bigint): Point {
  const km = modN(k);
  if (km === 0n) {
    // Pedersen identity element: 0·G + 0·H. noble doesn't let us multiply by 0 directly
    // so we subtract a point from itself to get the identity.
    return C.subtract(C);
  }
  return C.multiply(km);
}

/** C1 - C2 commits to (v1-v2, r1-r2). */
export function subCommitments(C1: Point, C2: Point): Point {
  return C1.subtract(C2);
}

/** v·G (public "value only" component, used to shift commitments by known quantities). */
export function valueOnly(value: bigint): Point {
  const vm = modN(value);
  if (vm === 0n) return G.subtract(G);
  return G.multiply(vm);
}
