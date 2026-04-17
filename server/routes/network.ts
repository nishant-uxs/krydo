import type { Express } from "express";
import { getDeployment, isBlockchainReady } from "../blockchain";

/**
 * Network info + disabled legacy wallet-connect endpoint.
 */
export function registerNetworkRoutes(app: Express) {
  app.get("/api/network", async (_req, res) => {
    const deployment = getDeployment();
    res.json({
      blockchain: isBlockchainReady(),
      network: deployment?.network || null,
      contracts: deployment
        ? {
            authority: deployment.contracts.KrydoAuthority.address,
            credentials: deployment.contracts.KrydoCredentials.address,
          }
        : null,
      deployer: deployment?.deployer || null,
    });
  });

  // Legacy /api/wallet/connect is intentionally disabled: connecting now
  // requires a SIWE-signed message (see /api/auth/nonce + /api/auth/verify).
  app.post("/api/wallet/connect", (_req, res) => {
    res.status(410).json({
      message:
        "Endpoint removed. Use SIWE flow: GET /api/auth/nonce then POST /api/auth/verify with a signed message.",
    });
  });
}
