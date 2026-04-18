import { z } from "zod";

/**
 * Per-claim-type structured Zod validators.
 *
 * A credential's `claimData` was previously a free-form `unknown`. That meant
 * an "income_verification" credential could literally be `{ foo: "bar" }` and
 * the server would happily accept it. With the per-type map below we enforce
 * shape-and-bounds at the API boundary:
 *
 *   - Numeric claims (income, credit_score, age) must parse as positive
 *     integers within documented ranges.
 *   - Boolean claims (kyc_verified) must be actual booleans.
 *   - Free-form claim types still accept a bounded object, so legacy / custom
 *     issuers aren't locked out.
 *
 * The verifier side can now reason semantically: "this is a credit_score, so
 * the underlying scalar is guaranteed to be in [300, 900]".
 */

// ---------------------------------------------------------------------------
// Structured claim data shapes
// ---------------------------------------------------------------------------

/** Annual income in whole units of the local currency (INR rupees or USD). */
export const incomeClaimSchema = z.object({
  amount: z
    .number()
    .int("income amount must be a whole number")
    .nonnegative("income cannot be negative")
    .max(10 ** 12, "income out of supported range (≤ 1 trillion)"),
  currency: z.string().trim().length(3).toUpperCase().optional().default("INR"),
  period: z.enum(["annual", "monthly"]).optional().default("annual"),
  employer: z.string().trim().max(200).optional(),
});
export type IncomeClaim = z.infer<typeof incomeClaimSchema>;

/**
 * Credit score on the CIBIL/FICO-style scale (300–900).
 * Values outside this range get rejected at the API boundary so verifiers can
 * trust the min/max when building range proofs.
 */
export const creditScoreClaimSchema = z.object({
  score: z
    .number()
    .int("credit score must be a whole number")
    .min(300, "credit score below 300")
    .max(900, "credit score above 900"),
  bureau: z.enum(["CIBIL", "Experian", "Equifax", "CRIF", "FICO", "other"]).optional(),
  asOf: z.string().datetime().optional(),
});
export type CreditScoreClaim = z.infer<typeof creditScoreClaimSchema>;

/** Age in whole years. Sanity bounded to reject "-3" or "500". */
export const ageClaimSchema = z.object({
  years: z
    .number()
    .int("age must be a whole number of years")
    .min(0, "age cannot be negative")
    .max(150, "age out of supported range"),
});
export type AgeClaim = z.infer<typeof ageClaimSchema>;

/** KYC verification — either present (true) or absent (the credential shouldn't exist). */
export const kycClaimSchema = z.object({
  verified: z.literal(true),
  level: z.enum(["basic", "full", "enhanced"]).optional(),
  documentsHash: z.string().max(256).optional(),
});
export type KycClaim = z.infer<typeof kycClaimSchema>;

/** Debt-to-income ratio, 0.00 to 1.00 (or 0% to 100%). */
export const debtRatioClaimSchema = z.object({
  ratio: z.number().min(0).max(1, "debt ratio expressed as a fraction in [0, 1]"),
});
export type DebtRatioClaim = z.infer<typeof debtRatioClaimSchema>;

/** Asset ownership — value in whole units of currency. */
export const assetClaimSchema = z.object({
  valueAmount: z.number().int().nonnegative().max(10 ** 15),
  currency: z.string().trim().length(3).toUpperCase().optional().default("INR"),
  assetType: z.enum(["cash", "equity", "real_estate", "crypto", "other"]).optional(),
});
export type AssetClaim = z.infer<typeof assetClaimSchema>;

// ---------------------------------------------------------------------------
// Claim-type dispatch table
// ---------------------------------------------------------------------------

/**
 * Map of claimType → schema. `claim-schemas.ts` is the single source of truth
 * for what a structured claim of each type must look like.
 *
 * When the issuer POSTs a new credential, `validateClaimData(claimType, data)`
 * looks up the schema here. Unknown types fall back to the permissive
 * bounded-JSON check defined on `insertCredentialSchema`, so introducing a
 * new claim type doesn't break existing issuers.
 */
export const claimSchemasByType = {
  income_verification: incomeClaimSchema,
  credit_score: creditScoreClaimSchema,
  age: ageClaimSchema,
  kyc_verified: kycClaimSchema,
  identity_verification: kycClaimSchema,
  debt_ratio: debtRatioClaimSchema,
  asset_proof: assetClaimSchema,
} as const;

export type KnownClaimType = keyof typeof claimSchemasByType;

/**
 * Validate structured claim data. Returns the parsed object on success, or
 * throws a ZodError (caller catches and converts to a 400 response).
 *
 * If `claimType` isn't in `claimSchemasByType`, we accept the data verbatim —
 * unknown claim types remain free-form (subject to the outer bounded-JSON cap).
 */
export function validateClaimData(claimType: string, data: unknown): unknown {
  const schema = claimSchemasByType[claimType as KnownClaimType];
  if (!schema) return data;
  return schema.parse(data);
}
