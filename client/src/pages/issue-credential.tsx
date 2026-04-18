import { useWallet } from "@/lib/wallet";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileCheck, Shield, Ban, Send, Loader2, Inbox, CheckCircle2, XCircle, Clock, MessageSquare, Plus, Trash2, Link2 } from "lucide-react";
import { claimTypes, claimTypeLabels, type ClaimType } from "@shared/schema";
import type { Credential, CredentialRequest } from "@shared/schema";
import { shortenAddress } from "@/lib/wallet";
import { TxSuccessDialog } from "@/components/tx-success-dialog";
import { TxConfirmDialog, type TxConfirmInfo } from "@/components/tx-confirm-dialog";
import { issueCredentialViaMetaMask, revokeCredentialViaMetaMask } from "@/lib/contracts";
import { useState } from "react";
import { motion } from "framer-motion";

const issueCredentialSchema = z.object({
  holderAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address"),
  claimType: z.enum(claimTypes),
  claimSummary: z.string().min(1, "Summary is required").max(200),
  claimValue: z.string().min(1, "Claim value is required"),
  expiresIn: z.string().optional(),
});

interface ClaimField {
  name: string;
  value: string;
}

export default function IssueCredentialPage() {
  const { address, role } = useWallet();
  const { toast } = useToast();
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [lastTx, setLastTx] = useState<{ txHash: string; blockNumber?: string; title: string; description: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInfo, setConfirmInfo] = useState<TxConfirmInfo | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const { data: issuedCredentials, isLoading } = useQuery<Credential[]>({
    queryKey: ["/api/credentials/issued", address],
    enabled: !!address && role === "issuer",
  });

  const { data: incomingRequests } = useQuery<CredentialRequest[]>({
    queryKey: ["/api/credential-requests/issuer", address],
    enabled: !!address && role === "issuer",
  });

  const pendingRequests = incomingRequests?.filter((r) => r.status === "pending") || [];

  const respondMutation = useMutation({
    mutationFn: async (params: { id: string; status: string; responseMessage?: string; claimSummary?: string; claimValue?: string; expiresAt?: string; onChainTxHash?: string }) => {
      const { id, status, ...body } = params;

      // --- Rejection path: single POST, no MetaMask popup needed. ---------
      // Server still anchors the rejection on-chain via its root wallet;
      // that's purely audit and doesn't require issuer consent.
      if (status === "rejected") {
        const res = await apiRequest("POST", `/api/credential-requests/${id}/respond`, {
          ...body,
          status,
          respondedBy: address,
        });
        return res.json();
      }

      // --- Approval path: Full-SSI 3-step flow with MetaMask popup --------
      //  1. POST /respond with prepareOnly=true → server stages credential,
      //     returns canonical credentialHash, marks request "issuing".
      //  2. Issuer signs issueCredential via MetaMask → real tx hash.
      //  3a. PATCH /api/credentials/:id/tx → server verifies Sepolia receipt.
      //  3b. POST /respond with finalize=true → server marks request "issued".
      //
      // If the user rejects the MetaMask popup at step 2, the staged
      // credential + request stay in "issuing" state. They can retry later
      // via the Re-anchor button on the Issued tab.
      setMutationStep("Staging credential...");
      const stageRes = await apiRequest("POST", `/api/credential-requests/${id}/respond`, {
        ...body,
        status,
        respondedBy: address,
        prepareOnly: true,
      });
      const staged = await stageRes.json();
      const credential = staged.credential;
      if (!credential?.credentialHash) {
        throw new Error("Server did not return a staged credential");
      }

      setMutationStep("Waiting for MetaMask approval...");
      let txResult: { txHash: string; blockNumber: number };
      try {
        txResult = await issueCredentialViaMetaMask(
          credential.credentialHash,
          credential.holderAddress,
          credential.claimType,
          credential.claimSummary,
        );
      } catch (err: any) {
        if (err.code === 4001 || err.code === "ACTION_REJECTED") {
          throw new Error("Transaction rejected in MetaMask. The credential is staged but not anchored — retry from the Pending tab.");
        }
        throw err;
      }

      setMutationStep("Confirming on Sepolia...");
      try {
        await apiRequest("PATCH", `/api/credentials/${credential.id}/tx`, {
          txHash: txResult.txHash,
        });
      } catch (err: any) {
        // Receipt not confirmed yet — surface as a warning but continue
        // finalize. The issuer can hit Re-anchor if it ultimately reverts.
        console.warn("Credential tx PATCH failed (continuing):", err?.message);
      }

      setMutationStep("Finalizing request...");
      const finalRes = await apiRequest("POST", `/api/credential-requests/${id}/respond`, {
        status,
        respondedBy: address,
        finalize: true,
        credentialId: credential.id,
        onChainTxHash: txResult.txHash,
        responseMessage: body.responseMessage,
      });
      const finalJson = await finalRes.json();
      return { ...finalJson, txHash: txResult.txHash, blockNumber: txResult.blockNumber };
    },
    onSuccess: (data, variables) => {
      setMutationStep("");
      queryClient.invalidateQueries({ queryKey: ["/api/credential-requests/issuer"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credentials/issued", address] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      if (variables.status === "approved") {
        setApproveDialogOpen(false);
        setApproveRequest(null);
        setLastTx({
          txHash: (data as any)?.txHash || "",
          blockNumber: (data as any)?.blockNumber ? String((data as any).blockNumber) : undefined,
          title: "Credential Issued",
          description: "Request approved and credential has been signed on-chain by your wallet.",
        });
        setTxDialogOpen(true);
      } else {
        toast({ title: "Request Rejected" });
      }
    },
    onError: (error: Error) => {
      setMutationStep("");
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<z.infer<typeof issueCredentialSchema>>({
    resolver: zodResolver(issueCredentialSchema),
    defaultValues: {
      holderAddress: "",
      claimType: "credit_score",
      claimSummary: "",
      claimValue: "",
      expiresIn: "",
    },
  });

  const [mutationStep, setMutationStep] = useState<string>("");
  const [additionalFields, setAdditionalFields] = useState<ClaimField[]>([]);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveRequest, setApproveRequest] = useState<CredentialRequest | null>(null);
  const [approveSummary, setApproveSummary] = useState("");
  const [approveValue, setApproveValue] = useState("");
  const [approveExpiry, setApproveExpiry] = useState("");

  const issueMutation = useMutation({
    mutationFn: async (data: z.infer<typeof issueCredentialSchema>) => {
      setMutationStep("Saving credential...");
      let expiresAt: string | undefined;
      if (data.expiresIn) {
        const days = parseInt(data.expiresIn);
        if (!isNaN(days) && days > 0) {
          expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        }
      }
      const fields: Record<string, string> = { value: data.claimValue };
      for (const af of additionalFields) {
        if (af.name.trim() && af.value.trim()) {
          fields[af.name.trim()] = af.value.trim();
        }
      }
      const res = await apiRequest("POST", "/api/credentials", {
        issuerAddress: address,
        holderAddress: data.holderAddress,
        claimType: data.claimType,
        claimSummary: data.claimSummary,
        claimData: { value: data.claimValue, type: data.claimType, fields },
        ...(expiresAt ? { expiresAt } : {}),
      });
      const credential = await res.json();

      let onChainTxHash: string | undefined;
      let blockNumber: number | undefined;
      let confirmWarning: string | undefined;
      try {
        setMutationStep("Waiting for MetaMask approval...");
        const txResult = await issueCredentialViaMetaMask(
          credential.credentialHash,
          data.holderAddress,
          data.claimType,
          data.claimSummary
        );
        onChainTxHash = txResult.txHash;
        blockNumber = txResult.blockNumber;
      } catch (err: any) {
        if (err.code === 4001 || err.code === "ACTION_REJECTED") {
          return { ...credential, txHash: credential.txHash, blockNumber: credential.blockNumber, rejected: true };
        }
        throw err;
      }

      // Hand the hash to the server so it can verify the receipt against
      // Sepolia and persist the real block number. Previously we swallowed
      // errors here with `.catch(() => {})`, which meant a dropped /
      // wrong-chain / reverted tx would leave the UI permanently stuck on
      // the server's random placeholder hash. We now surface server-side
      // failures as a *warning* (the credential itself is already saved +
      // MetaMask already confirmed locally) and the user can hit the
      // Re-anchor button on the Issued tab to retry.
      setMutationStep("Confirming on Sepolia...");
      try {
        const patchRes = await apiRequest(
          "PATCH",
          `/api/credentials/${credential.id}/tx`,
          { txHash: onChainTxHash },
        );
        const patched = await patchRes.json().catch(() => ({} as any));
        if (patched.blockNumber) blockNumber = Number(patched.blockNumber);
      } catch (err: any) {
        confirmWarning = err.message ?? "Server could not confirm the tx — use Re-anchor to retry.";
      }

      return {
        ...credential,
        txHash: onChainTxHash || credential.txHash,
        blockNumber: blockNumber || credential.blockNumber,
        confirmWarning,
      };
    },
    onSuccess: (data: any) => {
      setMutationStep("");
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      form.reset();
      if (data.rejected) {
        toast({ title: "On-chain signing rejected", description: "Credential saved but not recorded on-chain.", variant: "destructive" });
        return;
      }
      if (data.confirmWarning) {
        toast({
          title: "Credential issued — confirmation pending",
          description: "MetaMask confirmed the tx, but the server could not verify it yet. Use Re-anchor on the Issued tab if this persists.",
          variant: "destructive",
        });
      }
      setLastTx({
        txHash: data.txHash,
        blockNumber: String(data.blockNumber),
        title: "Credential Issued",
        description: `${data.claimType?.replace(/_/g, " ")} credential has been issued and recorded on-chain.`,
      });
      setTxDialogOpen(true);
    },
    onError: (error: Error) => {
      setMutationStep("");
      toast({ title: "Failed to issue credential", description: error.message, variant: "destructive" });
    },
  });

  // Re-anchor a credential whose Firestore row exists but whose on-chain tx
  // was never confirmed (legacy records from before the PATCH endpoint
  // started verifying receipts, or records where the user's wallet dropped
  // the tx). The server signs + submits from its root wallet so the user
  // doesn't need to open MetaMask; endpoint is idempotent.
  const reanchorMutation = useMutation({
    mutationFn: async (credId: string) => {
      setMutationStep("Re-anchoring on Sepolia...");
      const res = await apiRequest("POST", `/api/credentials/${credId}/anchor`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      setMutationStep("");
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credentials/issued"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      if (data.alreadyOnChain) {
        toast({
          title: "Already on-chain",
          description: "This credential is already verified on Sepolia.",
        });
        return;
      }
      setLastTx({
        txHash: data.txHash,
        blockNumber: String(data.blockNumber),
        title: "Credential Re-anchored",
        description: "The credential is now verified on the Sepolia blockchain.",
      });
      setTxDialogOpen(true);
    },
    onError: (error: Error) => {
      setMutationStep("");
      toast({ title: "Re-anchor failed", description: error.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (credId: string) => {
      const credData = issuedCredentials?.find((c) => c.id === credId);
      if (!credData) throw new Error("Credential not found");

      setMutationStep("Waiting for MetaMask approval...");
      let onChainTxHash: string | undefined;
      let blockNumber: number | undefined;
      try {
        const txResult = await revokeCredentialViaMetaMask(credData.credentialHash);
        onChainTxHash = txResult.txHash;
        blockNumber = txResult.blockNumber;
      } catch (err: any) {
        if (err.code === 4001 || err.code === "ACTION_REJECTED") {
          throw new Error("Transaction rejected in MetaMask");
        }
        throw err;
      }

      setMutationStep("Saving to database...");
      const res = await apiRequest("POST", `/api/credentials/${credId}/revoke`, {
        revokedBy: address,
        onChainTxHash,
      });
      const result = await res.json();
      return { ...result, txHash: onChainTxHash, blockNumber };
    },
    onSuccess: (data: any) => {
      setMutationStep("");
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      setLastTx({
        txHash: data.txHash,
        blockNumber: String(data.blockNumber),
        title: "Credential Revoked",
        description: "Credential has been revoked and recorded on-chain.",
      });
      setTxDialogOpen(true);
    },
    onError: (error: Error) => {
      setMutationStep("");
      toast({ title: "Failed to revoke", description: error.message, variant: "destructive" });
    },
  });

  if (role !== "issuer") {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h2 className="font-serif text-xl font-bold mb-1">Access Denied</h2>
          <p className="text-sm text-muted-foreground">Only approved issuers can issue credentials.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold" data-testid="text-issue-title">
          Issue Credentials
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Issue verifiable credentials to users in the network
        </p>
      </div>

      <Tabs defaultValue="issue">
        <TabsList>
          <TabsTrigger value="issue" data-testid="tab-issue">Issue</TabsTrigger>
          <TabsTrigger value="requests" data-testid="tab-requests">
            Incoming Requests
            {pendingRequests.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] bg-chart-4/15 text-chart-4 no-default-active-elevate">
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="issued" data-testid="tab-issued">Issued</TabsTrigger>
        </TabsList>

      <TabsContent value="issue" className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="w-4 h-4" />
            New Credential
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => {
                setConfirmInfo({
                  action: "issue_credential",
                  title: "Issue New Credential",
                  description: "This will save the credential, then open MetaMask to record it on the Sepolia blockchain.",
                  details: [
                    { label: "Action", value: "Issue Credential On-Chain" },
                    { label: "Type", value: claimTypeLabels[data.claimType] || data.claimType },
                    { label: "Holder", value: data.holderAddress, mono: true },
                    { label: "Summary", value: data.claimSummary },
                    { label: "Contract", value: "KrydoCredentials", mono: true },
                    { label: "Network", value: "Sepolia Testnet" },
                  ],
                });
                setPendingAction(() => () => issueMutation.mutate(data));
                setConfirmOpen(true);
              })}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="holderAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Holder Wallet Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="0x..."
                        className="font-mono text-sm"
                        data-testid="input-holder-address"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="claimType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Claim Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-claim-type">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {claimTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {claimTypeLabels[type]}
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
                name="claimSummary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Summary (public reference)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Credit score above 750"
                        data-testid="input-claim-summary"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="claimValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Claim Value (private, hashed on-chain)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. 780"
                        data-testid="input-claim-value"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Additional Fields (optional)</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAdditionalFields([...additionalFields, { name: "", value: "" }])}
                    data-testid="button-add-field"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Field
                  </Button>
                </div>
                {additionalFields.map((field, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <Input
                      placeholder="Field name (e.g. employer)"
                      value={field.name}
                      onChange={(e) => {
                        const updated = [...additionalFields];
                        updated[idx] = { ...updated[idx], name: e.target.value };
                        setAdditionalFields(updated);
                      }}
                      className="flex-1"
                      data-testid={`input-field-name-${idx}`}
                    />
                    <Input
                      placeholder="Field value"
                      value={field.value}
                      onChange={(e) => {
                        const updated = [...additionalFields];
                        updated[idx] = { ...updated[idx], value: e.target.value };
                        setAdditionalFields(updated);
                      }}
                      className="flex-1"
                      data-testid={`input-field-value-${idx}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAdditionalFields(additionalFields.filter((_, i) => i !== idx))}
                      data-testid={`button-remove-field-${idx}`}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                {additionalFields.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Additional fields enable selective disclosure — holders can choose which fields to reveal in ZK proofs.
                  </p>
                )}
              </div>
              <FormField
                control={form.control}
                name="expiresIn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Validity Period (optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-expiry">
                          <SelectValue placeholder="No expiry (permanent)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="30">30 Days</SelectItem>
                        <SelectItem value="90">90 Days</SelectItem>
                        <SelectItem value="180">6 Months</SelectItem>
                        <SelectItem value="365">1 Year</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={issueMutation.isPending}
                data-testid="button-issue-credential"
              >
                {issueMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {mutationStep || "Processing..."}
                  </>
                ) : (
                  "Issue Credential (On-Chain)"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      </TabsContent>

      <TabsContent value="requests" className="space-y-3 mt-4">
        {pendingRequests.length > 0 ? (
          pendingRequests.map((req, i) => (
            <motion.div
              key={req.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card data-testid={`request-card-${req.id}`}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-sm font-semibold">
                          {claimTypeLabels[req.claimType as ClaimType] || req.claimType}
                        </h3>
                        <Badge variant="secondary" className="text-[10px] bg-chart-4/15 text-chart-4 no-default-active-elevate">
                          <Clock className="w-2.5 h-2.5 mr-0.5" />
                          Pending
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        From: <span className="font-mono">{shortenAddress(req.requesterAddress)}</span>
                      </p>
                      {req.message && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                          <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                          {req.message}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {new Date(req.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => respondMutation.mutate({ id: req.id, status: "rejected", responseMessage: "Request rejected" })}
                        disabled={respondMutation.isPending}
                        data-testid={`button-reject-request-${req.id}`}
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setApproveRequest(req);
                          setApproveSummary("");
                          setApproveValue("");
                          setApproveExpiry("");
                          setApproveDialogOpen(true);
                        }}
                        disabled={respondMutation.isPending}
                        data-testid={`button-approve-request-${req.id}`}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Approve & Issue
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-serif font-semibold mb-1">No Pending Requests</h3>
              <p className="text-sm text-muted-foreground">
                Credential requests from users will appear here.
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="issued" className="mt-4">
      <div>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : issuedCredentials && issuedCredentials.length > 0 ? (
          <div className="space-y-3">
            {issuedCredentials.map((cred, i) => (
              <motion.div
                key={cred.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card data-testid={`card-issued-cred-${cred.id}`}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="text-sm font-semibold capitalize">
                            {cred.claimType.replace(/_/g, " ")}
                          </h3>
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
                        <p className="text-xs text-muted-foreground">{cred.claimSummary}</p>
                        <p className="font-mono text-[11px] text-muted-foreground mt-1">
                          Holder: {shortenAddress(cred.holderAddress)}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          Hash: {cred.credentialHash.slice(0, 20)}...
                        </p>
                      </div>
                      {cred.status === "active" && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => reanchorMutation.mutate(cred.id)}
                            disabled={reanchorMutation.isPending}
                            data-testid={`button-reanchor-cred-${cred.id}`}
                            title="Verify / re-submit the on-chain anchor transaction"
                          >
                            {reanchorMutation.isPending ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Link2 className="w-3 h-3 mr-1" />
                            )}
                            {reanchorMutation.isPending ? "Anchoring..." : "Re-anchor"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setConfirmInfo({
                                action: "revoke_credential",
                                title: "Revoke Credential",
                                description: "This will permanently revoke this credential on the Sepolia blockchain.",
                                details: [
                                  { label: "Action", value: "Revoke Credential On-Chain" },
                                  { label: "Type", value: claimTypeLabels[cred.claimType as keyof typeof claimTypeLabels] || cred.claimType },
                                  { label: "Holder", value: cred.holderAddress, mono: true },
                                  { label: "Hash", value: cred.credentialHash.slice(0, 20) + "...", mono: true },
                                  { label: "Contract", value: "KrydoCredentials", mono: true },
                                  { label: "Network", value: "Sepolia Testnet" },
                                ],
                                warning: "This action is irreversible. The credential will be marked as revoked on-chain.",
                              });
                              setPendingAction(() => () => revokeMutation.mutate(cred.id));
                              setConfirmOpen(true);
                            }}
                            disabled={revokeMutation.isPending}
                            data-testid={`button-revoke-cred-${cred.id}`}
                          >
                            {revokeMutation.isPending ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Ban className="w-3 h-3 mr-1" />
                            )}
                            {revokeMutation.isPending ? "Revoking..." : "Revoke"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <FileCheck className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No credentials issued yet</p>
            </CardContent>
          </Card>
        )}
      </div>
      </TabsContent>
      </Tabs>

      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-chart-3" />
              Approve & Issue Credential
            </DialogTitle>
            <DialogDescription>
              {approveRequest && (
                <>
                  Issue a <span className="font-medium text-foreground">{claimTypeLabels[approveRequest.claimType as ClaimType] || approveRequest.claimType}</span> credential
                  to <span className="font-mono text-foreground">{shortenAddress(approveRequest.requesterAddress)}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {approveRequest && (
            <div className="space-y-4">
              {approveRequest.message && (
                <div className="p-3 rounded-md bg-muted/50 border text-sm">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    Requester's message
                  </p>
                  <p>{approveRequest.message}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-2 block">Summary (public reference)</label>
                <Input
                  placeholder="e.g. Credit Score Above 750"
                  value={approveSummary}
                  onChange={(e) => setApproveSummary(e.target.value)}
                  data-testid="input-approve-summary"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Claim Value (private, hashed on-chain)</label>
                <Input
                  placeholder="e.g. 780"
                  value={approveValue}
                  onChange={(e) => setApproveValue(e.target.value)}
                  data-testid="input-approve-value"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Validity Period (optional)</label>
                <Select value={approveExpiry} onValueChange={setApproveExpiry}>
                  <SelectTrigger data-testid="select-approve-expiry">
                    <SelectValue placeholder="No expiry (permanent)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 Days</SelectItem>
                    <SelectItem value="90">90 Days</SelectItem>
                    <SelectItem value="180">6 Months</SelectItem>
                    <SelectItem value="365">1 Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full"
                disabled={!approveSummary || !approveValue || respondMutation.isPending}
                onClick={() => {
                  let expiresAt: string | undefined;
                  if (approveExpiry) {
                    const days = parseInt(approveExpiry);
                    if (!isNaN(days) && days > 0) {
                      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
                    }
                  }
                  respondMutation.mutate({
                    id: approveRequest.id,
                    status: "approved",
                    claimSummary: approveSummary,
                    claimValue: approveValue,
                    ...(expiresAt ? { expiresAt } : {}),
                  });
                }}
                data-testid="button-confirm-approve"
              >
                {respondMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {mutationStep || "Issuing Credential..."}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Approve & Sign On-Chain
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TxConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPendingAction(null);
        }}
        info={confirmInfo}
        isPending={issueMutation.isPending || revokeMutation.isPending}
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
