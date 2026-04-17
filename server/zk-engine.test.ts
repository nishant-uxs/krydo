import { describe, it, expect } from "vitest";
import { generateZkProof, verifyZkProof } from "./zk-engine";

/**
 * End-to-end zk-engine tests: generate a proof for every supported proof type,
 * then verify that an honest proof passes and a tampered proof fails.
 */

describe("zk-engine — proof generation + verification", () => {
  // ------------------------------------------------------------
  describe("range_above", () => {
    it("accepts when value >= threshold", () => {
      const p = generateZkProof({
        credentialId: "cred-1",
        claimValue: "850",
        proofType: "range_above",
        threshold: 700,
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });

    it("generates a non-verifying proof when value < threshold", () => {
      const p = generateZkProof({
        credentialId: "cred-1",
        claimValue: "600",
        proofType: "range_above",
        threshold: 700,
      });
      expect(p.verified).toBe(false);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(false);
    });

    it("accepts the boundary value >= threshold exactly", () => {
      const p = generateZkProof({
        credentialId: "cred-1",
        claimValue: "700",
        proofType: "range_above",
        threshold: 700,
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });

    it("throws for non-numeric claim values", () => {
      expect(() => generateZkProof({
        credentialId: "cred-1",
        claimValue: "alice@example.com",
        proofType: "range_above",
        threshold: 10,
      })).toThrow();
    });
  });

  // ------------------------------------------------------------
  describe("range_below", () => {
    it("accepts when value <= threshold", () => {
      const p = generateZkProof({
        credentialId: "cred-1",
        claimValue: "200",
        proofType: "range_below",
        threshold: 500,
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });

    it("generates a non-verifying proof when value > threshold", () => {
      const p = generateZkProof({
        credentialId: "cred-1",
        claimValue: "501",
        proofType: "range_below",
        threshold: 500,
      });
      expect(p.verified).toBe(false);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(false);
    });
  });

  // ------------------------------------------------------------
  describe("equality", () => {
    it("accepts equal numeric values", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "42",
        proofType: "equality",
        targetValue: "42",
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });

    it("rejects unequal values", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "42",
        proofType: "equality",
        targetValue: "43",
      });
      expect(p.verified).toBe(false);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(false);
    });

    it("accepts equal non-numeric values (hashed encoding)", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "alice",
        proofType: "equality",
        targetValue: "alice",
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });
  });

  // ------------------------------------------------------------
  describe("membership", () => {
    it("accepts when value is in the member set", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "21",
        proofType: "membership",
        memberSet: ["10", "21", "55", "100"],
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });

    it("rejects when value is NOT in the member set", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "99",
        proofType: "membership",
        memberSet: ["10", "21", "55", "100"],
      });
      expect(p.verified).toBe(false);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(false);
    });

    it("works on string members (hashed encoding)", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "CA",
        proofType: "membership",
        memberSet: ["US", "CA", "UK"],
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });
  });

  // ------------------------------------------------------------
  describe("non_zero", () => {
    it("accepts numeric v >= 1", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "12345",
        proofType: "non_zero",
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });

    it("rejects v = 0", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "0",
        proofType: "non_zero",
      });
      expect(p.verified).toBe(false);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(false);
    });

    it("accepts non-empty hashed strings", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "alice",
        proofType: "non_zero",
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });
  });

  // ------------------------------------------------------------
  describe("selective_disclosure", () => {
    it("accepts when disclosed fields open to their commitments", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "ignored-for-SD",
        proofType: "selective_disclosure",
        selectedFields: ["name"],
        allFields: { name: "Alice", ssn: "123-45-6789", age: "30" },
      });
      expect(p.verified).toBe(true);
      expect(verifyZkProof(p.proofData, p.publicInputs).valid).toBe(true);
    });

    it("rejects if tampered disclosure references a wrong field value", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "ignored",
        proofType: "selective_disclosure",
        selectedFields: ["name"],
        allFields: { name: "Alice", age: "30" },
      });
      // Tamper: rewrite the disclosed opening's value.
      const tampered = JSON.parse(JSON.stringify(p.proofData));
      tampered.auxiliaryData.disclosedOpenings.name.value = "Eve";
      expect(verifyZkProof(tampered, p.publicInputs).valid).toBe(false);
    });

    it("throws without selectedFields", () => {
      expect(() => generateZkProof({
        credentialId: "c",
        claimValue: "x",
        proofType: "selective_disclosure",
        allFields: { a: "1" },
      })).toThrow();
    });

    it("throws without allFields", () => {
      expect(() => generateZkProof({
        credentialId: "c",
        claimValue: "x",
        proofType: "selective_disclosure",
        selectedFields: ["a"],
      })).toThrow();
    });
  });

  // ------------------------------------------------------------
  describe("tampering resistance (cross-cutting)", () => {
    it("rejects a proof when the commitment is swapped post-hoc", () => {
      const a = generateZkProof({
        credentialId: "c",
        claimValue: "100",
        proofType: "range_above",
        threshold: 50,
      });
      const b = generateZkProof({
        credentialId: "c",
        claimValue: "200",
        proofType: "range_above",
        threshold: 50,
      });
      // Take proof a's proofData but publicInputs from b → commitments mismatch.
      const hybrid = { ...a.publicInputs, commitment: b.publicInputs.commitment };
      expect(verifyZkProof(a.proofData, hybrid).valid).toBe(false);
    });

    it("rejects a corrupt protocol identifier", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "100",
        proofType: "range_above",
        threshold: 50,
      });
      const badData = { ...p.proofData, protocol: "some-other-protocol" };
      expect(verifyZkProof(badData, p.publicInputs).valid).toBe(false);
    });

    it("rejects an unknown proofType", () => {
      const p = generateZkProof({
        credentialId: "c",
        claimValue: "1",
        proofType: "equality",
        targetValue: "1",
      });
      const badInputs = { ...p.publicInputs, proofType: "totally-fake" };
      expect(verifyZkProof(p.proofData, badInputs).valid).toBe(false);
    });
  });
});
