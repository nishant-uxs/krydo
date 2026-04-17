import type { Express } from "express";
import { type Server } from "http";
import { initBlockchain } from "./blockchain";
import { attachAuth } from "./auth/jwt";
import { registerAuthRoutes } from "./auth/siwe";
import { registerNetworkRoutes } from "./routes/network";
import { registerIssuerRoutes } from "./routes/issuers";
import { registerCredentialRoutes } from "./routes/credentials";
import { registerCredentialRequestRoutes } from "./routes/credential-requests";
import { registerStatsRoutes } from "./routes/stats";
import { registerZkRoutes } from "./routes/zk";
import { childLogger } from "./logger";

const log = childLogger("routes");

/**
 * Top-level route orchestrator. Each domain has its own registration module in
 * `server/routes/`. This file just wires them together so `server/index.ts`
 * stays oblivious to the growing API surface.
 */
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const blockchainEnabled = await initBlockchain();
  log.info(
    { mode: blockchainEnabled ? "on-chain" : "off-chain" },
    "blockchain mode",
  );

  // Populate req.auth from the Bearer token (never required; routes opt in).
  app.use("/api", attachAuth);

  // Auth (SIWE nonce / verify / me).
  registerAuthRoutes(app);

  // Domain routers.
  registerNetworkRoutes(app);
  registerIssuerRoutes(app);
  registerCredentialRoutes(app);
  registerCredentialRequestRoutes(app);
  registerStatsRoutes(app);
  registerZkRoutes(app);

  return httpServer;
}
