import { config } from "./config"; // loads + validates .env
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { installSecurityMiddleware } from "./middleware/security";
import { logger } from "./logger";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Install helmet / CORS / rate-limiting BEFORE body parsers and routes.
installSecurityMiddleware(app);

app.use(
  express.json({
    limit: "256kb", // hard cap JSON body size to stop memory-exhaustion DoS
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "64kb" }));

/**
 * Back-compat shim for the old `log()` helper still called by server/vite.ts.
 * Routes the message through the pino logger at info level.
 */
export function log(message: string, source = "express") {
  logger.info({ source }, message);
}

// HTTP access log. Redacts auth headers via logger.redact config.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (!req.path.startsWith("/api")) return;
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
    }, `${req.method} ${req.path} → ${res.statusCode}`);
  });
  next();
});

(async () => {
  await seedDatabase().catch((err) => {
    logger.error({ err: err.message ?? String(err) }, "seed error");
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    logger.error({ err: err.message ?? String(err), status, stack: err.stack }, "internal server error");

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (config.isProd) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = config.PORT;
  // `reusePort` is not supported on Windows, so only enable it elsewhere.
  const listenOpts: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
  };
  if (process.platform !== "win32") {
    listenOpts.reusePort = true;
  }
  httpServer.listen(listenOpts, () => {
    log(`serving on port ${port}`);
  });
})();
