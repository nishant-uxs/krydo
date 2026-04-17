import type { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "../config";

/**
 * Installs a defense-in-depth stack of HTTP security middleware.
 * Must be called BEFORE the body parser / route handlers.
 */
export function installSecurityMiddleware(app: Express) {
  // Trust first proxy so req.ip reflects the real client when behind a load
  // balancer / reverse proxy. Important for rate-limit fairness.
  app.set("trust proxy", 1);

  // -- Helmet: sane HTTP security headers.
  // CSP is relaxed in dev so Vite HMR (inline scripts, ws://) works.
  app.use(
    helmet({
      contentSecurityPolicy: config.isProd
        ? {
            useDefaults: true,
            directives: {
              "default-src": ["'self'"],
              "script-src": ["'self'"],
              "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
              "img-src": ["'self'", "data:", "blob:"],
              "connect-src": [
                "'self'",
                "https://eth-sepolia.g.alchemy.com",
                "https://*.alchemy.com",
                "https://*.infura.io",
              ],
              "frame-ancestors": ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false, // would break MetaMask injected provider
    }),
  );

  // -- CORS
  const corsOrigins = config.corsOrigins;
  app.use(
    cors({
      origin: corsOrigins ?? true, // true = reflect request origin in dev
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );

  // -- Global rate limit: lenient baseline.
  // Sensitive routes (auth, on-chain mutations) can add a tighter limiter.
  const baseLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Only rate-limit /api/*; static assets should not be throttled.
    skip: (req) => !req.path.startsWith("/api"),
    message: { message: "Too many requests, please slow down and retry shortly." },
  });
  app.use(baseLimiter);
}

/**
 * Tight limiter for auth + on-chain mutation routes.
 * 10 requests / minute per IP by default.
 */
export const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts, please wait a minute." },
});
