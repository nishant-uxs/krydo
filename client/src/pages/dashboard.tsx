import { useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Users, FileCheck, Activity, TrendingUp, Clock, Link2 } from "lucide-react";
import type { Issuer, Credential, Transaction } from "@shared/schema";
import { motion } from "framer-motion";

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35 },
};

export default function Dashboard() {
  const { address, role, onChainTxHash } = useWallet();

  const { data: stats, isLoading: statsLoading } = useQuery<{
    issuers: number;
    credentials: number;
    transactions: number;
    activeCredentials: number;
    revokedCredentials: number;
  }>({
    queryKey: ["/api/stats", address],
    enabled: !!address,
  });

  const { data: recentTx, isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions/recent", address],
    enabled: !!address,
  });

  const { data: credentials, isLoading: credsLoading } = useQuery<Credential[]>({
    queryKey: ["/api/credentials", address],
    enabled: !!address,
  });

  const { data: network } = useQuery<{
    blockchain: boolean;
    network: string | null;
    contracts: { authority: string; credentials: string } | null;
    deployer: string | null;
  }>({
    queryKey: ["/api/network"],
  });

  const roleTitles: Record<string, string> = {
    root: "Root Authority Dashboard",
    issuer: "Issuer Dashboard",
    user: "My Dashboard",
  };

  const roleDescriptions: Record<string, string> = {
    root: "Manage the trust network. Approve issuers, monitor credential activity.",
    issuer: "Issue and manage credentials for users in the network.",
    user: "View your credentials, request new ones, and manage your identity.",
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <motion.div {...fadeUp}>
        <h1 className="font-serif text-2xl font-bold" data-testid="text-dashboard-title">
          {roleTitles[role || "user"]}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm text-muted-foreground">
            {roleDescriptions[role || "user"]}
          </p>
          {network?.blockchain && (
            <Badge variant="secondary" className="text-[10px] bg-chart-3/15 text-chart-3 no-default-active-elevate shrink-0" data-testid="badge-network-status">
              <Link2 className="w-3 h-3 mr-1" />
              Sepolia
            </Badge>
          )}
          {onChainTxHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${onChainTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-role-onchain"
            >
              <Badge variant="secondary" className="text-[10px] bg-chart-1/15 text-chart-1 no-default-active-elevate shrink-0 cursor-pointer hover:bg-chart-1/25">
                <Shield className="w-3 h-3 mr-1" />
                Role On-Chain
              </Badge>
            </a>
          )}
        </div>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        initial="initial"
        animate="animate"
        variants={{ animate: { transition: { staggerChildren: 0.08 } } }}
      >
        {role === "root" && (
          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Trusted Issuers</CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <p className="text-2xl font-bold font-mono" data-testid="text-stat-issuers">{stats?.issuers || 0}</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {role === "root" ? "Total Credentials" : "My Credentials"}
              </CardTitle>
              <FileCheck className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-bold font-mono" data-testid="text-stat-credentials">{stats?.credentials || 0}</p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-bold font-mono text-chart-3" data-testid="text-stat-active">
                  {stats?.activeCredentials || 0}
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Transactions</CardTitle>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-bold font-mono" data-testid="text-stat-transactions">{stats?.transactions || 0}</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div {...fadeUp} transition={{ delay: 0.2 }}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {txLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : recentTx && recentTx.length > 0 ? (
                <div className="space-y-3">
                  {recentTx.slice(0, 5).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0"
                      data-testid={`row-tx-${tx.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium capitalize">{tx.action.replace(/_/g, " ")}</p>
                          {tx.txHash.startsWith("0x") && tx.txHash.length === 66 && (tx.data as any)?.onChain !== false && (
                            <a
                              href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid={`link-tx-onchain-${tx.id}`}
                            >
                              <Badge variant="secondary" className="text-[9px] bg-chart-1/15 text-chart-1 no-default-active-elevate cursor-pointer hover:bg-chart-1/25">
                                On-Chain
                              </Badge>
                            </a>
                          )}
                        </div>
                        <a
                          href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[11px] text-muted-foreground truncate block hover:text-foreground transition-colors"
                        >
                          {tx.txHash}
                        </a>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="secondary" className="text-[10px] no-default-active-elevate">
                          #{tx.blockNumber}
                        </Badge>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(tx.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No recent activity</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...fadeUp} transition={{ delay: 0.3 }}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-4 h-4" />
                {role === "root" ? "Network Credentials" : "My Credentials"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {credsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : credentials && credentials.length > 0 ? (
                <div className="space-y-3">
                  {credentials.slice(0, 5).map((cred) => (
                    <div
                      key={cred.id}
                      className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0"
                      data-testid={`row-cred-${cred.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium capitalize">
                          {cred.claimType.replace(/_/g, " ")}
                        </p>
                        <p className="text-xs text-muted-foreground">{cred.claimSummary}</p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] no-default-active-elevate ${
                          cred.status === "active"
                            ? "bg-chart-3/15 text-chart-3"
                            : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        {cred.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No credentials yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
