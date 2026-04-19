import { useWallet, shortenAddress } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, ArrowUpRight, ArrowDownLeft, ExternalLink, Link2 } from "lucide-react";
import type { Transaction } from "@shared/schema";
import { isOffChainTx } from "@shared/schema";
import { motion } from "framer-motion";

const ETHERSCAN_BASE = "https://sepolia.etherscan.io";

const actionColors: Record<string, string> = {
  issuer_approved: "bg-chart-3/15 text-chart-3",
  issuer_revoked: "bg-destructive/15 text-destructive",
  credential_issued: "bg-chart-1/15 text-chart-1",
  credential_revoked: "bg-chart-4/15 text-chart-4",
  wallet_connected: "bg-chart-2/15 text-chart-2",
};

export default function TransactionsPage() {
  const { address } = useWallet();

  const { data: transactions, isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", address],
    enabled: !!address,
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold" data-testid="text-transactions-title">
          Transaction Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          On-chain transaction history verified on Sepolia testnet
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : transactions && transactions.length > 0 ? (
        <div className="space-y-2">
          {transactions.map((tx, i) => {
            // Canonical detection: prefers tx.data.onChain === false, falls
            // back to the OFF_CHAIN_TX_HASH sentinel. Much more robust than
            // the old prefix heuristic.
            const isOnChain = !isOffChainTx(tx);
            return (
              <motion.div
                key={tx.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card data-testid={`card-tx-${tx.id}`}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                          {tx.action.includes("issued") || tx.action.includes("approved") ? (
                            <ArrowUpRight className="w-4 h-4 text-chart-3" />
                          ) : (
                            <ArrowDownLeft className="w-4 h-4 text-chart-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium capitalize">
                              {tx.action.replace(/_/g, " ")}
                            </p>
                            <Badge
                              variant="secondary"
                              className={`text-[10px] no-default-active-elevate ${actionColors[tx.action] || ""}`}
                            >
                              Block #{tx.blockNumber}
                            </Badge>
                            {isOnChain && (
                              <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary no-default-active-elevate">
                                <Link2 className="w-2.5 h-2.5 mr-0.5" />
                                On-Chain
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {isOnChain ? (
                              <a
                                href={`${ETHERSCAN_BASE}/tx/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                                data-testid={`link-tx-hash-${tx.id}`}
                              >
                                {tx.txHash.slice(0, 18)}...
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ) : (
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {tx.txHash.slice(0, 18)}...
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                              from{" "}
                              <a
                                href={`${ETHERSCAN_BASE}/address/${tx.fromAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-primary transition-colors"
                              >
                                {shortenAddress(tx.fromAddress)}
                              </a>
                            </span>
                            {tx.toAddress && (
                              <span className="text-[11px] text-muted-foreground">
                                to{" "}
                                <a
                                  href={`${ETHERSCAN_BASE}/address/${tx.toAddress}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-primary transition-colors"
                                >
                                  {shortenAddress(tx.toAddress)}
                                </a>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0">
                        {new Date(tx.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center">
            <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-serif text-lg font-semibold mb-1">No Transactions</h3>
            <p className="text-sm text-muted-foreground">
              Transactions will appear here as network activity occurs.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
