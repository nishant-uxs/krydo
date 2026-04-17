import { describe, it, expect } from "vitest";
import { G, H, randomScalar, modN, pointToHex } from "./ec";
import {
  commit, verifyOpen, addCommitments, scaleCommitment,
  subCommitments, valueOnly,
} from "./pedersen";

/**
 * Pedersen commitment tests.
 *
 * Binding: commitments are binding under the DL assumption (we don't try to
 * break that here). Hiding + homomorphism are structurally testable though.
 */

describe("pedersen.ts — Pedersen commitments on secp256k1", () => {
  describe("commit / verifyOpen", () => {
    it("opens to the same (value, blinding)", () => {
      const v = 42n;
      const r = randomScalar();
      const c = commit(v, r);
      expect(verifyOpen(c.point, v, r)).toBe(true);
    });

    it("does NOT open to a different value", () => {
      const v = 42n;
      const r = randomScalar();
      const c = commit(v, r);
      expect(verifyOpen(c.point, 43n, r)).toBe(false);
    });

    it("does NOT open to a different blinding", () => {
      const v = 42n;
      const r = randomScalar();
      const wrong = randomScalar();
      const c = commit(v, r);
      expect(verifyOpen(c.point, v, wrong)).toBe(false);
    });

    it("supports v = 0 (edge case for noble Point.multiply)", () => {
      const r = randomScalar();
      const c = commit(0n, r);
      expect(verifyOpen(c.point, 0n, r)).toBe(true);
      expect(verifyOpen(c.point, 1n, r)).toBe(false);
    });

    it("two commitments to the same value with different blindings differ", () => {
      const v = 100n;
      const a = commit(v);
      const b = commit(v);
      expect(pointToHex(a.point)).not.toEqual(pointToHex(b.point));
    });
  });

  describe("homomorphism", () => {
    it("C(v1, r1) + C(v2, r2) opens to (v1+v2, r1+r2)", () => {
      const v1 = 10n;
      const v2 = 7n;
      const r1 = randomScalar();
      const r2 = randomScalar();
      const C1 = commit(v1, r1).point;
      const C2 = commit(v2, r2).point;
      const sum = addCommitments(C1, C2);
      expect(verifyOpen(sum, modN(v1 + v2), modN(r1 + r2))).toBe(true);
    });

    it("k · C(v, r) opens to (k·v, k·r)", () => {
      const v = 3n;
      const r = randomScalar();
      const k = 5n;
      const C = commit(v, r).point;
      const scaled = scaleCommitment(C, k);
      expect(verifyOpen(scaled, modN(k * v), modN(k * r))).toBe(true);
    });

    it("C1 - C2 opens to (v1-v2, r1-r2)", () => {
      const v1 = 20n;
      const v2 = 7n;
      const r1 = randomScalar();
      const r2 = randomScalar();
      const C1 = commit(v1, r1).point;
      const C2 = commit(v2, r2).point;
      const diff = subCommitments(C1, C2);
      expect(verifyOpen(diff, modN(v1 - v2), modN(r1 - r2))).toBe(true);
    });

    it("k = 0 yields the identity element", () => {
      const C = commit(123n, randomScalar()).point;
      const zero = scaleCommitment(C, 0n);
      // Zero commitment + any commitment X should equal X.
      const X = commit(5n, randomScalar()).point;
      expect(zero.add(X).equals(X)).toBe(true);
    });
  });

  describe("valueOnly", () => {
    it("valueOnly(v) returns v·G", () => {
      const v = 17n;
      expect(valueOnly(v).equals(G.multiply(v))).toBe(true);
    });

    it("valueOnly(0) is the additive identity w.r.t. G", () => {
      const zero = valueOnly(0n);
      expect(zero.add(G).equals(G)).toBe(true);
    });

    it("C - valueOnly(threshold) shifts the committed value by -threshold", () => {
      // Used by range proofs to reduce "v >= t" to "delta >= 0" where delta = v-t.
      const v = 100n;
      const r = randomScalar();
      const t = 40n;
      const C = commit(v, r).point;
      const Cdelta = C.subtract(valueOnly(t));
      expect(verifyOpen(Cdelta, v - t, r)).toBe(true);
    });
  });

  describe("H cannot be expressed as a multiple of G (implicit)", () => {
    it("commit(0, 1) = H (up to the noble zero quirk)", () => {
      const c = commit(0n, 1n);
      expect(c.point.equals(H)).toBe(true);
    });
  });
});
