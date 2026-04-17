import type { Express } from "express";
import { storage } from "../storage";

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
      const wallet = await storage.getWallet(address);
      if (wallet?.role === "root") {
        return res.json(await storage.getTransactions());
      }
      res.json(await storage.getTransactions(address));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/transactions/recent/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const wallet = await storage.getWallet(address);
      if (wallet?.role === "root") {
        return res.json(await storage.getRecentTransactions(undefined, 10));
      }
      res.json(await storage.getRecentTransactions(address, 10));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
