import { describe, it, expect } from "vitest";
import { G, H, randomScalar, modN, pointToHex, scalarToHex } from "./ec";
import { commit, valueOnly } from "./pedersen";
import {
  schnorrProve, schnorrVerify,
  openingProve, openingVerify,
  proveRange, verifyRange,
  proveEquality, verifyEquality,
  proveMembership, verifyMembership,
} from "./sigma";

/**
 * Sigma-protocol tests. Each protocol gets:
 *   - honest prover / honest verifier → accept
 *   - proof re-used against a DIFFERENT statement → reject
 *   - tampered proof → reject
 */

describe("sigma.ts — sigma protocols over Pedersen commitments", () => {
  // ------------------------------------------------------------
  describe("Schnorr PoK of x s.t. Y = x·BASE", () => {
    it("accepts an honest proof", () => {
      const x = randomScalar();
      const Y = G.multiply(x);
      const pf = schnorrProve(x, G, "ctx-1");
      expect(schnorrVerify(Y, G, "ctx-1", pf)).toBe(true);
    });

    it("rejects a proof against a DIFFERENT Y", () => {
      const x = randomScalar();
      const Y = G.multiply(x);
      const otherY = G.multiply(randomScalar());
      const pf = schnorrProve(x, G, "ctx-2");
      expect(schnorrVerify(otherY, G, "ctx-2", pf)).toBe(false);
      // Sanity: same Y still accepts.
      expect(schnorrVerify(Y, G, "ctx-2", pf)).toBe(true);
    });

    it("rejects a proof under a DIFFERENT context (Fiat-Shamir binding)", () => {
      const x = randomScalar();
      const Y = G.multiply(x);
      const pf = schnorrProve(x, G, "context-A");
      expect(schnorrVerify(Y, G, "context-B", pf)).toBe(false);
    });

    it("rejects a tampered response s", () => {
      const x = randomScalar();
      const Y = G.multiply(x);
      const pf = schnorrProve(x, G, "ctx");
      const tampered = { ...pf, s: scalarToHex(randomScalar()) };
      expect(schnorrVerify(Y, G, "ctx", tampered)).toBe(false);
    });
  });

  // ------------------------------------------------------------
  describe("Knowledge-of-opening proof", () => {
    it("accepts an honest opening proof", () => {
      const v = 99n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const pf = openingProve(C, v, r, "ctx");
      expect(openingVerify(C, "ctx", pf)).toBe(true);
    });

    it("rejects when the commitment is swapped", () => {
      const v = 99n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const C2 = commit(99n, randomScalar()).point;
      const pf = openingProve(C, v, r, "ctx");
      expect(openingVerify(C2, "ctx", pf)).toBe(false);
    });

    it("rejects when context changes", () => {
      const v = 99n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const pf = openingProve(C, v, r, "ctx-A");
      expect(openingVerify(C, "ctx-B", pf)).toBe(false);
    });
  });

  // ------------------------------------------------------------
  describe("Range proof (via bit-decomposition OR proofs)", () => {
    it("accepts v ∈ [0, 2^32) with 32-bit range", () => {
      const v = 12_345n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const pf = proveRange(v, r, "ctx", 32);
      expect(verifyRange(C, "ctx", pf)).toBe(true);
    });

    it("accepts v = 0 (edge)", () => {
      const v = 0n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const pf = proveRange(v, r, "ctx", 8);
      expect(verifyRange(C, "ctx", pf)).toBe(true);
    });

    it("accepts v = 2^n - 1 (max)", () => {
      const bits = 8;
      const v = (1n << BigInt(bits)) - 1n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const pf = proveRange(v, r, "ctx", bits);
      expect(verifyRange(C, "ctx", pf)).toBe(true);
    });

    it("throws when v is out of range", () => {
      expect(() => proveRange(1000n, randomScalar(), "ctx", 4)).toThrow();
    });

    it("throws when v is negative", () => {
      expect(() => proveRange(-1n, randomScalar(), "ctx", 8)).toThrow();
    });

    it("rejects a proof against a DIFFERENT commitment", () => {
      const v = 42n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const C2 = commit(50n, randomScalar()).point;
      const pf = proveRange(v, r, "ctx", 8);
      expect(verifyRange(C2, "ctx", pf)).toBe(false);
    });

    it("rejects a tampered bit commitment", () => {
      const v = 5n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const pf = proveRange(v, r, "ctx", 4);
      // Flip one of the per-bit commitments — verification must fail.
      const badPf = { ...pf, bitCommitments: [...pf.bitCommitments] };
      badPf.bitCommitments[0] = pointToHex(G.multiply(randomScalar()));
      expect(verifyRange(C, "ctx", badPf)).toBe(false);
    });
  });

  // ------------------------------------------------------------
  describe("Equality proof", () => {
    it("accepts C that commits to the claimed target", () => {
      const r = randomScalar();
      const target = 7n;
      const C = commit(target, r).point;
      const pf = proveEquality(r);
      expect(verifyEquality(C, target, pf)).toBe(true);
    });

    it("rejects a wrong target value", () => {
      const r = randomScalar();
      const C = commit(7n, r).point;
      const pf = proveEquality(r);
      expect(verifyEquality(C, 8n, pf)).toBe(false);
    });

    it("rejects a wrong blinding", () => {
      const target = 7n;
      const C = commit(target, randomScalar()).point;
      const pf = proveEquality(randomScalar()); // wrong
      expect(verifyEquality(C, target, pf)).toBe(false);
    });

    it("accepts target = 0", () => {
      const r = randomScalar();
      const C = commit(0n, r).point;
      const pf = proveEquality(r);
      expect(verifyEquality(C, 0n, pf)).toBe(true);
    });
  });

  // ------------------------------------------------------------
  describe("Membership proof (k-way OR of Schnorr)", () => {
    it("accepts a value that IS in the member set", () => {
      const set = [10n, 20n, 30n, 42n, 100n];
      const v = 42n;
      const r = randomScalar();
      const C = commit(v, r).point;
      const pf = proveMembership(C, v, r, set, "ctx");
      expect(verifyMembership(C, set, "ctx", pf)).toBe(true);
    });

    it("accepts first/last index (corner cases)", () => {
      const set = [7n, 11n, 13n];
      const r1 = randomScalar();
      const r2 = randomScalar();
      const C1 = commit(7n, r1).point;
      const C2 = commit(13n, r2).point;
      expect(verifyMembership(C1, set, "c", proveMembership(C1, 7n, r1, set, "c"))).toBe(true);
      expect(verifyMembership(C2, set, "c", proveMembership(C2, 13n, r2, set, "c"))).toBe(true);
    });

    it("throws when the claim value is NOT in the set (prover-side)", () => {
      const set = [1n, 2n, 3n];
      expect(() => proveMembership(
        commit(99n, randomScalar()).point,
        99n, randomScalar(), set, "ctx",
      )).toThrow();
    });

    it("throws on an empty set", () => {
      expect(() => proveMembership(
        commit(1n, randomScalar()).point,
        1n, randomScalar(), [], "ctx",
      )).toThrow();
    });

    it("rejects a proof when the context changes", () => {
      const set = [10n, 20n, 30n];
      const r = randomScalar();
      const C = commit(20n, r).point;
      const pf = proveMembership(C, 20n, r, set, "ctx-A");
      expect(verifyMembership(C, set, "ctx-B", pf)).toBe(false);
    });

    it("rejects a proof when the commitment is swapped", () => {
      const set = [10n, 20n, 30n];
      const r = randomScalar();
      const C = commit(20n, r).point;
      const pf = proveMembership(C, 20n, r, set, "ctx");
      const C2 = commit(20n, randomScalar()).point;
      expect(verifyMembership(C2, set, "ctx", pf)).toBe(false);
    });

    it("rejects a proof where set elements are reordered", () => {
      const set = [10n, 20n, 30n];
      const r = randomScalar();
      const C = commit(20n, r).point;
      const pf = proveMembership(C, 20n, r, set, "ctx");
      const reordered = [30n, 10n, 20n];
      expect(verifyMembership(C, reordered, "ctx", pf)).toBe(false);
    });
  });
});
