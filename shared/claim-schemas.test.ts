import { describe, it, expect } from "vitest";
import {
  validateClaimData,
  incomeClaimSchema,
  creditScoreClaimSchema,
  ageClaimSchema,
  kycClaimSchema,
  debtRatioClaimSchema,
  assetClaimSchema,
} from "./claim-schemas";

/**
 * Tests for per-claim-type structured validation. The goal is to prove that
 * each claim type enforces its documented bounds — a verifier relying on
 * `credit_score ∈ [300, 900]` must be able to trust that statement because
 * the API rejects anything outside the range at the boundary.
 */

describe("claim-schemas — income_verification", () => {
  it("accepts a reasonable salary", () => {
    const parsed = incomeClaimSchema.parse({ amount: 1_200_000 });
    expect(parsed.amount).toBe(1_200_000);
    expect(parsed.currency).toBe("INR");
    expect(parsed.period).toBe("annual");
  });

  it("normalizes currency to uppercase", () => {
    const parsed = incomeClaimSchema.parse({ amount: 50_000, currency: "usd" });
    expect(parsed.currency).toBe("USD");
  });

  it("rejects non-integer amounts", () => {
    expect(() => incomeClaimSchema.parse({ amount: 1_000.5 })).toThrow();
  });

  it("rejects negative amounts", () => {
    expect(() => incomeClaimSchema.parse({ amount: -1 })).toThrow();
  });

  it("rejects absurdly large amounts", () => {
    expect(() => incomeClaimSchema.parse({ amount: 10 ** 13 })).toThrow();
  });

  it("allows optional employer field", () => {
    const parsed = incomeClaimSchema.parse({ amount: 100, employer: "Acme" });
    expect(parsed.employer).toBe("Acme");
  });
});

describe("claim-schemas — credit_score", () => {
  it("accepts the canonical range boundaries", () => {
    expect(creditScoreClaimSchema.parse({ score: 300 }).score).toBe(300);
    expect(creditScoreClaimSchema.parse({ score: 900 }).score).toBe(900);
    expect(creditScoreClaimSchema.parse({ score: 750 }).score).toBe(750);
  });

  it("rejects scores below 300", () => {
    expect(() => creditScoreClaimSchema.parse({ score: 299 })).toThrow();
    expect(() => creditScoreClaimSchema.parse({ score: 0 })).toThrow();
  });

  it("rejects scores above 900", () => {
    expect(() => creditScoreClaimSchema.parse({ score: 901 })).toThrow();
    expect(() => creditScoreClaimSchema.parse({ score: 1000 })).toThrow();
  });

  it("rejects non-integer scores", () => {
    expect(() => creditScoreClaimSchema.parse({ score: 750.5 })).toThrow();
  });

  it("accepts optional bureau", () => {
    const parsed = creditScoreClaimSchema.parse({ score: 750, bureau: "CIBIL" });
    expect(parsed.bureau).toBe("CIBIL");
  });
});

describe("claim-schemas — age", () => {
  it("accepts valid ages", () => {
    expect(ageClaimSchema.parse({ years: 0 }).years).toBe(0);
    expect(ageClaimSchema.parse({ years: 25 }).years).toBe(25);
    expect(ageClaimSchema.parse({ years: 150 }).years).toBe(150);
  });

  it("rejects negative age", () => {
    expect(() => ageClaimSchema.parse({ years: -1 })).toThrow();
  });

  it("rejects ages > 150", () => {
    expect(() => ageClaimSchema.parse({ years: 200 })).toThrow();
  });
});

describe("claim-schemas — kyc_verified", () => {
  it("accepts only verified = true (a non-verified KYC shouldn't exist as a credential)", () => {
    expect(kycClaimSchema.parse({ verified: true }).verified).toBe(true);
  });

  it("rejects verified = false", () => {
    expect(() => kycClaimSchema.parse({ verified: false })).toThrow();
  });

  it("accepts optional level", () => {
    const parsed = kycClaimSchema.parse({ verified: true, level: "enhanced" });
    expect(parsed.level).toBe("enhanced");
  });
});

describe("claim-schemas — debt_ratio", () => {
  it("accepts a ratio in [0, 1]", () => {
    expect(debtRatioClaimSchema.parse({ ratio: 0 }).ratio).toBe(0);
    expect(debtRatioClaimSchema.parse({ ratio: 0.37 }).ratio).toBeCloseTo(0.37);
    expect(debtRatioClaimSchema.parse({ ratio: 1 }).ratio).toBe(1);
  });

  it("rejects ratios > 1", () => {
    expect(() => debtRatioClaimSchema.parse({ ratio: 1.5 })).toThrow();
  });

  it("rejects negative ratios", () => {
    expect(() => debtRatioClaimSchema.parse({ ratio: -0.1 })).toThrow();
  });
});

describe("claim-schemas — asset_proof", () => {
  it("accepts a non-negative value", () => {
    const parsed = assetClaimSchema.parse({ valueAmount: 500_000 });
    expect(parsed.valueAmount).toBe(500_000);
    expect(parsed.currency).toBe("INR");
  });

  it("rejects fractional amounts", () => {
    expect(() => assetClaimSchema.parse({ valueAmount: 100.5 })).toThrow();
  });

  it("rejects negative values", () => {
    expect(() => assetClaimSchema.parse({ valueAmount: -100 })).toThrow();
  });
});

describe("claim-schemas — validateClaimData dispatcher", () => {
  it("routes income_verification to the income schema", () => {
    const parsed = validateClaimData("income_verification", { amount: 100 });
    expect((parsed as any).amount).toBe(100);
  });

  it("routes credit_score to the credit-score schema", () => {
    const parsed = validateClaimData("credit_score", { score: 750 });
    expect((parsed as any).score).toBe(750);
  });

  it("is lenient with unknown claim types (returns data verbatim)", () => {
    const custom = { anything: "goes" };
    expect(validateClaimData("custom_future_type", custom)).toEqual(custom);
  });

  it("propagates validation errors for known types", () => {
    expect(() =>
      validateClaimData("credit_score", { score: 9999 }),
    ).toThrow();
  });
});
