import type { Express } from "express";
import { storage } from "../storage";
import { readPageOpts, sendPage } from "../middleware/pagination";

/**
 * Dashboard statistics + transaction history endpoints.
 *
 * Root wallets see global stats/transactions; everyone else sees their own.
 */
export function registerStatsRoutes(app: Express) {
  app.get("/api/stats/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const wallet = await storage.getWallet(address);
      const role = wallet?.role || "user";
      res.json(await storage.getStats(address, role));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/transactions/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const opts = readPageOpts(req);
      const wallet = await storage.getWallet(address);
      const page = wallet?.role === "root"
        ? await storage.listTransactionsPaged(undefined, opts)
        : await storage.listTransactionsPaged(address, opts);
      sendPage(res, page);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/transactions/recent/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const wallet = await storage.getWallet(address);
      // Recent = small non-paginated list, capped at 10 items.
      const page = wallet?.role === "root"
        ? await storage.listTransactionsPaged(undefined, { limit: 10 })
        : await storage.listTransactionsPaged(address, { limit: 10 });
      res.json(page.items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
