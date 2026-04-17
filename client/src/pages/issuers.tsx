import { useWallet } from "@/lib/wallet";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Plus, Ban, CheckCircle2, Shield, ExternalLink, Loader2, Link2, Tag } from "lucide-react";
import { shortenAddress } from "@/lib/wallet";
import { issuerCategories, issuerCategoryLabels, type IssuerCategory } from "@shared/schema";
import { TxSuccessDialog } from "@/components/tx-success-dialog";
import { TxConfirmDialog, type TxConfirmInfo } from "@/components/tx-confirm-dialog";
import { addIssuerViaMetaMask, revokeIssuerViaMetaMask } from "@/lib/contracts";
import type { Issuer } from "@shared/schema";
import { useState } from "react";
import { motion } from "framer-motion";

const ETHERSCAN_BASE = "https://sepolia.etherscan.io";

const addIssuerSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address"),
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  category: z.enum(issuerCategories),
});

export default function IssuersPage() {
  const { address, role } = useWallet();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [lastTx, setLastTx] = useState<{ txHash: string; blockNumber?: string; title: string; description: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInfo, setConfirmInfo] = useState<TxConfirmInfo | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const { data: issuers, isLoading } = useQuery<Issuer[]>({
    queryKey: ["/api/issuers"],
    enabled: !!address,
  });

  const form = useForm<z.infer<typeof addIssuerSchema>>({
    resolver: zodResolver(addIssuerSchema),
    defaultValues: { walletAddress: "", name: "", description: "", category: "general" as const },
  });

  const [mutationStep, setMutationStep] = useState<string>("");

  const addIssuerMutation = useMutation({
    mutationFn: async (data: z.infer<typeof addIssuerSchema>) => {
      setMutationStep("Checking on-chain status...");
      let onChainTxHash: string | undefined;
      let blockNumber: number | undefined;
      try {
        setMutationStep("Approve in MetaMask...");
        const txResult = await addIssuerViaMetaMask(data.walletAddress, data.name);
        onChainTxHash = txResult.txHash;
        blockNumber = txResult.blockNumber;
        setMutationStep("Confirming on Sepolia...");
      } catch (err: any) {
        if (err.code === 4001 || err.code === "ACTION_REJECTED") {
          throw new Error("Transaction rejected in MetaMask");
        }
        throw err;
      }

      setMutationStep("Saving to database...");
      const res = await apiRequest("POST", "/api/issuers", {
        walletAddress: data.walletAddress,
        name: data.name,
        description: data.description,
        category: data.category,
        approvedBy: address,
        onChainTxHash,
      });
      const result = await res.json();
      return { ...result, txHash: onChainTxHash, blockNumber };
    },
    onSuccess: (data: any) => {
      setMutationStep("");
      queryClient.invalidateQueries({ queryKey: ["/api/issuers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      form.reset();
      setDialogOpen(false);
      setLastTx({
        txHash: data.txHash,
        blockNumber: String(data.blockNumber),
        title: "Issuer Approved",
        description: `${data.name} has been registered as a trusted issuer on-chain.`,
      });
      setTxDialogOpen(true);
    },
    onError: (error: Error) => {
      setMutationStep("");
      toast({ title: "Transaction failed", description: error.message, variant: "destructive" });
    },
  });

  const revokeIssuerMutation = useMutation({
    mutationFn: async (issuerId: string) => {
      const issuerData = issuers?.find((i) => i.id === issuerId);
      if (!issuerData) throw new Error("Issuer not found");

      setMutationStep("Waiting for MetaMask approval...");
      let onChainTxHash: string | undefined;
      let blockNumber: number | undefined;
      try {
        const txResult = await revokeIssuerViaMetaMask(issuerData.walletAddress);
        onChainTxHash = txResult.txHash;
        blockNumber = txResult.blockNumber;
      } catch (err: any) {
        if (err.code === 4001 || err.code === "ACTION_REJECTED") {
          throw new Error("Transaction rejected in MetaMask");
        }
        throw err;
      }

      setMutationStep("Saving to database...");
      const res = await apiRequest("POST", `/api/issuers/${issuerId}/revoke`, {
        revokedBy: address,
        onChainTxHash,
      });
      const result = await res.json();
      return { ...result, txHash: onChainTxHash, blockNumber };
    },
    onSuccess: (data: any) => {
      setMutationStep("");
      queryClient.invalidateQueries({ queryKey: ["/api/issuers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      setLastTx({
        txHash: data.txHash,
        blockNumber: String(data.blockNumber),
        title: "Issuer Revoked",
        description: `${data.name} has been revoked from the trust network.`,
      });
      setTxDialogOpen(true);
    },
    onError: (error: Error) => {
      setMutationStep("");
      toast({ title: "Transaction failed", description: error.message, variant: "destructive" });
    },
  });

  if (role !== "root") {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h2 className="font-serif text-xl font-bold mb-1">Access Denied</h2>
          <p className="text-sm text-muted-foreground">Only the Root Authority can manage issuers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold" data-testid="text-issuers-title">
            Manage Issuers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Approve and revoke trusted institutions on-chain (Sepolia)
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-issuer">
              <Plus className="w-4 h-4 mr-2" />
              Add Issuer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif">Approve New Issuer</DialogTitle>
              <DialogDescription>
                This will submit a transaction to the KrydoAuthority contract on Sepolia.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => {
                  setDialogOpen(false);
                  setConfirmInfo({
                    action: "add_issuer",
                    title: "Authorize New Issuer",
                    description: "This will register the institution as a trusted issuer on the Sepolia blockchain.",
                    details: [
                      { label: "Action", value: "Add Issuer to Trust Network" },
                      { label: "Institution", value: data.name },
                      { label: "Wallet", value: data.walletAddress, mono: true },
                      { label: "Contract", value: "KrydoAuthority", mono: true },
                      { label: "Network", value: "Sepolia Testnet" },
                    ],
                  });
                  setPendingAction(() => () => addIssuerMutation.mutate(data));
                  setConfirmOpen(true);
                })}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="walletAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Wallet Address</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="0x..."
                          className="font-mono text-sm"
                          data-testid="input-issuer-address"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Institution Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. First National Bank"
                          data-testid="input-issuer-name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Issuer Category</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-issuer-category">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {issuerCategories.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {issuerCategoryLabels[cat]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Brief description of the institution..."
                          data-testid="input-issuer-description"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={addIssuerMutation.isPending}
                  data-testid="button-submit-issuer"
                >
                  {addIssuerMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {mutationStep || "Processing..."}
                    </>
                  ) : (
                    "Approve Issuer (On-Chain)"
                  )}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : issuers && issuers.length > 0 ? (
        <div className="space-y-3">
          {issuers.map((issuer, i) => (
            <motion.div
              key={issuer.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card data-testid={`card-issuer-${issuer.id}`}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold">{issuer.name}</h3>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] no-default-active-elevate ${
                            issuer.active
                              ? "bg-chart-3/15 text-chart-3"
                              : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {issuer.active ? "Active" : "Revoked"}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary no-default-active-elevate">
                          <Link2 className="w-2.5 h-2.5 mr-0.5" />
                          On-Chain
                        </Badge>
                        {issuer.category && issuer.category !== "general" && (
                          <Badge variant="secondary" className="text-[10px] bg-chart-4/15 text-chart-4 no-default-active-elevate">
                            <Tag className="w-2.5 h-2.5 mr-0.5" />
                            {issuerCategoryLabels[issuer.category as IssuerCategory] || issuer.category}
                          </Badge>
                        )}
                      </div>
                      <a
                        href={`${ETHERSCAN_BASE}/address/${issuer.walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1 mb-1"
                        data-testid={`link-issuer-address-${issuer.id}`}
                      >
                        {issuer.walletAddress}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {issuer.description && (
                        <p className="text-sm text-muted-foreground">{issuer.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Approved {new Date(issuer.approvedAt).toLocaleDateString()}
                        </span>
                        {issuer.revokedAt && (
                          <span className="flex items-center gap-1">
                            <Ban className="w-3 h-3" />
                            Revoked {new Date(issuer.revokedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {issuer.active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setConfirmInfo({
                            action: "revoke_issuer",
                            title: "Revoke Issuer Access",
                            description: "This will remove the institution's authority to issue credentials on-chain.",
                            details: [
                              { label: "Action", value: "Revoke from Trust Network" },
                              { label: "Institution", value: issuer.name },
                              { label: "Wallet", value: issuer.walletAddress, mono: true },
                              { label: "Contract", value: "KrydoAuthority", mono: true },
                              { label: "Network", value: "Sepolia Testnet" },
                            ],
                            warning: "All credentials issued by this institution will remain valid, but they cannot issue new ones.",
                          });
                          setPendingAction(() => () => revokeIssuerMutation.mutate(issuer.id));
                          setConfirmOpen(true);
                        }}
                        disabled={revokeIssuerMutation.isPending}
                        data-testid={`button-revoke-issuer-${issuer.id}`}
                      >
                        {revokeIssuerMutation.isPending ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Ban className="w-3 h-3 mr-1" />
                        )}
                        {revokeIssuerMutation.isPending ? "Revoking..." : "Revoke"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-serif font-semibold mb-1">No Issuers Yet</h3>
            <p className="text-sm text-muted-foreground">
              Add trusted institutions to start building the trust network.
            </p>
          </CardContent>
        </Card>
      )}

      <TxConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPendingAction(null);
        }}
        info={confirmInfo}
        isPending={addIssuerMutation.isPending || revokeIssuerMutation.isPending}
        onConfirm={() => {
          setConfirmOpen(false);
          const action = pendingAction;
          setPendingAction(null);
          action?.();
        }}
      />

      {lastTx && (
        <TxSuccessDialog
          open={txDialogOpen}
          onOpenChange={setTxDialogOpen}
          txHash={lastTx.txHash}
          blockNumber={lastTx.blockNumber}
          title={lastTx.title}
          description={lastTx.description}
        />
      )}
    </div>
  );
}
