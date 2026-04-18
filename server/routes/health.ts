import type { Express } from "express";
import { isBlockchainReady } from "../blockchain";
import { storage } from "../storage";

/**
 * Health / liveness / readiness endpoints for deployment monitoring.
 *
 * - `/healthz` is unauthenticated and cheap — meant for load balancers and
 *   uptime pingers. Returns 200 iff the process is alive.
 * - `/readyz` checks that upstream dependencies (Firestore, Sepolia RPC)
 *   are reachable. Returns 200 only when traffic should be routed here.
 *
 * Both follow the Kubernetes convention so they drop in unchanged if/when
 * this ships behind a cluster.
 */
export function registerHealthRoutes(app: Express) {
  const startedAt = new Date();

  app.get("/healthz", (_req, res) => {
    res.json({
      status: "ok",
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      version: process.env.npm_package_version ?? "unknown",
    });
  });

  app.get("/readyz", async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    // Firestore: a tiny read of a known collection is enough to confirm creds
    // are valid and the SDK is reachable. We never care about the result, only
    // that the call succeeds.
    try {
      await storage.getWallet("0x0000000000000000000000000000000000000000");
      checks.firestore = { ok: true };
    } catch (err: any) {
      checks.firestore = { ok: false, detail: err?.message ?? "unknown error" };
    }

    // Blockchain: we only verify the module was initialized. We deliberately
    // don't make a live RPC call here — /readyz needs to be cheap and
    // upstream-failure-tolerant. Deep RPC probes belong on a separate
    // /readyz/deep endpoint if we ever need them.
    checks.blockchain = { ok: isBlockchainReady() };

    const allOk = Object.values(checks).every(c => c.ok);
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ready" : "degraded",
      checks,
    });
  });
}
