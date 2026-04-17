import "dotenv/config";
import { z } from "zod";

/**
 * Central, validated configuration. Fails fast on startup if any required
 * secret is missing or malformed, so we never silently run in a half-broken
 * state.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),

  // --- Firebase Admin ---
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  FIREBASE_SERVICE_ACCOUNT: z.string().min(1).optional(),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),

  // --- Blockchain (Sepolia) ---
  ALCHEMY_API_KEY: z.string().min(1, "ALCHEMY_API_KEY is required"),
  DEPLOYER_PRIVATE_KEY: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, "DEPLOYER_PRIVATE_KEY must be a 32-byte hex string"),

  // --- Auth / sessions ---
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters").default(
    // Only used as a fallback in dev; production deploys should always override.
    "krydo-dev-session-secret-change-in-prod-please-this-is-not-secure",
  ),
  JWT_SECRET: z.string().min(32).optional(),

  // --- CORS ---
  // Comma-separated list of allowed origins. Empty = allow everything in dev.
  CORS_ORIGINS: z.string().optional(),

  // --- Rate limiting ---
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  const env = parsed.data;

  if (!env.GOOGLE_APPLICATION_CREDENTIALS && !env.FIREBASE_SERVICE_ACCOUNT) {
    // eslint-disable-next-line no-console
    console.error(
      "Missing Firebase credentials: set GOOGLE_APPLICATION_CREDENTIALS (path) or FIREBASE_SERVICE_ACCOUNT (JSON)",
    );
    process.exit(1);
  }

  // JWT secret defaults to SESSION_SECRET if not set.
  const jwtSecret = env.JWT_SECRET ?? env.SESSION_SECRET;

  return {
    ...env,
    JWT_SECRET: jwtSecret,
    isProd: env.NODE_ENV === "production",
    isDev: env.NODE_ENV === "development",
    corsOrigins:
      env.CORS_ORIGINS && env.CORS_ORIGINS.trim().length > 0
        ? env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
        : null,
  };
}

export const config = loadConfig();
export type AppConfig = typeof config;
