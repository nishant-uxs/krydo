import { useWallet, shortenAddress } from "@/lib/wallet";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  FileCheck,
  Building,
  Tag,
  Loader2,
  MessageSquare,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import {
  claimTypes,
  claimTypeLabels,
  issuerCategories,
  issuerCategoryLabels,
  categoryClaimTypes,
  type IssuerCategory,
  type ClaimType,
} from "@shared/schema";
import type { Issuer, CredentialRequest } from "@shared/schema";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { anchorCredentialRequestViaMetaMask } from "@/lib/contracts";

export default function RequestCredentialPage() {
  const { address } = useWallet();
  const { toast } = useToast();
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [selectedIssuer, setSelectedIssuer] = useState<Issuer | null>(null);
  const [selectedClaimType, setSelectedClaimType] = useState<string>("");
  const [requestMessage, setRequestMessage] = useState("");

  const { data: myRequests, isLoading: requestsLoading } = useQuery<CredentialRequest[]>({
    queryKey: ["/api/credential-requests/user", address],
    enabled: !!address,
  });

  const { data: allIssuers } = useQuery<Issuer[]>({
    queryKey: ["/api/issuers"],
    enabled: !!address,
  });

  const activeIssuers = allIssuers?.filter((i) => i.active) || [];

  const issuersByCategory = useMemo(() => {
    const grouped: Record<string, Issuer[]> = {};
    for (const issuer of activeIssuers) {
      const cat = issuer.category || "general";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(issuer);
    }
    return grouped;
  }, [activeIssuers]);

  const availableClaimTypes = useMemo(() => {
    if (!selectedIssuer) return claimTypes;
    const cat = (selectedIssuer.category || "general") as IssuerCategory;
    return categoryClaimTypes[cat] || claimTypes;
  }, [selectedIssuer]);

  const [reqStep, setReqStep] = useState<string>("");

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClaimType) throw new Error("Select a credential type");
      if (!address) throw new Error("Wallet not connected");

      // Step 1: POST request with clientWillAnchor — server stores it but
      // skips server-side on-chain anchoring.
      setReqStep("Creating request...");
      const res = await apiRequest("POST", "/api/credential-requests", {
        requesterAddress: address,
        claimType: selectedClaimType,
        issuerCategory: selectedIssuer?.category || null,
        issuerAddress: selectedIssuer?.walletAddress || null,
        message: requestMessage || null,
        clientWillAnchor: true,
      });
      const request = await res.json();

      // Step 2: MetaMask popup — holder signs a self-tx with encoded
      // KRYDO_CRED_REQUEST_V1 payload to anchor the request on Sepolia.
      setReqStep("Waiting for MetaMask approval...");
      console.log("[SSI] anchorCredentialRequest params:", {
        requestId: request.id, address, selectedClaimType,
      });
      let txResult: { txHash: string; blockNumber: number };
      try {
        txResult = await anchorCredentialRequestViaMetaMask(
          request.id,
          address!,
          selectedClaimType,
          "request_created",
        );
      } catch (err: any) {
        if (err.code === 4001 || err.code === "ACTION_REJECTED") {
          toast({
            title: "Anchor signing skipped",
            description: "Request created but not anchored on-chain.",
            variant: "destructive",
          });
          return { ...request, anchorSkipped: true };
        }
        throw err;
      }

      // Step 3: POST anchor tx hash to server — server verifies the
      // Sepolia receipt and persists it against the request.
      setReqStep("Recording anchor on Sepolia...");
      try {
        await apiRequest("POST", `/api/credential-requests/${request.id}/anchor`, {
          txHash: txResult.txHash,
        });
      } catch (err: any) {
        console.warn("Request anchor PATCH failed:", err?.message);
      }

      return { ...request, onChainTxHash: txResult.txHash };
    },
    onSuccess: () => {
      setReqStep("");
      queryClient.invalidateQueries({ queryKey: ["/api/credential-requests/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setRequestDialogOpen(false);
      setSelectedIssuer(null);
      setSelectedClaimType("");
      setRequestMessage("");
      toast({ title: "Request sent & anchored", description: "Your credential request has been submitted and recorded on-chain." });
    },
    onError: (error: Error) => {
      setReqStep("");
      toast({ title: "Request failed", description: error.message, variant: "destructive" });
    },
  });

  const statusConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
    pending: { icon: Clock, color: "bg-chart-4/15 text-chart-4", label: "Pending" },
    approved: { icon: CheckCircle2, color: "bg-chart-1/15 text-chart-1", label: "Approved" },
    rejected: { icon: XCircle, color: "bg-destructive/15 text-destructive", label: "Rejected" },
    issued: { icon: FileCheck, color: "bg-chart-3/15 text-chart-3", label: "Credential Issued" },
  };

  const openRequestDialog = (issuer: Issuer) => {
    setSelectedIssuer(issuer);
    const cat = (issuer.category || "general") as IssuerCategory;
    const types = categoryClaimTypes[cat] || claimTypes;
    setSelectedClaimType(types[0]);
    setRequestMessage("");
    setRequestDialogOpen(true);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold" data-testid="text-request-title">
          Request Credential
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse available issuers and request verifiable credentials
        </p>
      </div>

      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse" data-testid="tab-browse-issuers">
            <Building className="w-3.5 h-3.5 mr-1.5" />
            Available Issuers
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-request-history">
            My Requests
            {myRequests && myRequests.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] no-default-active-elevate">
                {myRequests.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-5 mt-4">
          {activeIssuers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-serif font-semibold mb-1">No Issuers Available</h3>
                <p className="text-sm text-muted-foreground">
                  No authorized issuers are currently active in the network.
                </p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(issuersByCategory).map(([category, issuers]) => {
              const cat = category as IssuerCategory;
              const availableClaims = categoryClaimTypes[cat] || [];
              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-3">
                    <Tag className="w-4 h-4 text-primary" />
                    <h2 className="font-serif text-lg font-semibold">
                      {issuerCategoryLabels[cat] || category}
                    </h2>
                    <Badge variant="secondary" className="text-[10px] no-default-active-elevate">
                      {issuers.length} issuer{issuers.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  {availableClaims.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {availableClaims.map((ct) => (
                        <Badge
                          key={ct}
                          variant="outline"
                          className="text-[10px] border-primary/30 text-primary no-default-active-elevate"
                        >
                          <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />
                          {claimTypeLabels[ct]}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    {issuers.map((issuer, i) => (
                      <motion.div
                        key={issuer.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                      >
                        <Card
                          className="cursor-pointer transition-colors hover:border-primary/40"
                          data-testid={`issuer-card-${issuer.id}`}
                          onClick={() => openRequestDialog(issuer)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm">{issuer.name}</span>
                                  <Badge variant="secondary" className="text-[10px] bg-chart-3/15 text-chart-3 no-default-active-elevate">
                                    Active
                                  </Badge>
                                </div>
                                <p className="font-mono text-xs text-muted-foreground mt-0.5">
                                  {shortenAddress(issuer.walletAddress)}
                                </p>
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {(categoryClaimTypes[cat] || []).map((ct) => (
                                    <span key={ct} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                      {claimTypeLabels[ct]}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <Button variant="outline" size="sm" data-testid={`button-request-from-${issuer.id}`}>
                                Request
                                <ArrowRight className="w-3.5 h-3.5 ml-1" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-3 mt-4">
          {requestsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : myRequests && myRequests.length > 0 ? (
            myRequests.map((req, i) => {
              const sc = statusConfig[req.status] || statusConfig.pending;
              const StatusIcon = sc.icon;
              return (
                <motion.div
                  key={req.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card data-testid={`request-card-${req.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="font-medium text-sm">
                              {claimTypeLabels[req.claimType as ClaimType] || req.claimType}
                            </h3>
                            <Badge variant="secondary" className={`text-[10px] no-default-active-elevate ${sc.color}`}>
                              <StatusIcon className="w-2.5 h-2.5 mr-0.5" />
                              {sc.label}
                            </Badge>
                            {req.onChainTxHash && (
                              <a
                                href={`https://sepolia.etherscan.io/tx/${req.onChainTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`link-request-onchain-${req.id}`}
                              >
                                <Badge variant="secondary" className="text-[9px] bg-chart-1/15 text-chart-1 no-default-active-elevate cursor-pointer hover:bg-chart-1/25">
                                  On-Chain
                                </Badge>
                              </a>
                            )}
                          </div>
                          {req.issuerAddress && (
                            <p className="text-xs text-muted-foreground">
                              To: <span className="font-mono">{shortenAddress(req.issuerAddress)}</span>
                            </p>
                          )}
                          {req.issuerCategory && (
                            <p className="text-xs text-muted-foreground">
                              Category: {issuerCategoryLabels[req.issuerCategory as IssuerCategory] || req.issuerCategory}
                            </p>
                          )}
                          {req.message && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                              <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                              {req.message}
                            </p>
                          )}
                          {req.responseMessage && (
                            <p className="text-xs mt-1 p-2 rounded bg-muted/50">
                              Response: {req.responseMessage}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground mt-2">
                            {new Date(req.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Send className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-serif font-semibold mb-1">No Requests Yet</h3>
                <p className="text-sm text-muted-foreground">
                  Browse available issuers and submit your first credential request.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" />
              Request Credential
            </DialogTitle>
            <DialogDescription>
              {selectedIssuer && (
                <>
                  Request from <span className="font-medium text-foreground">{selectedIssuer.name}</span>
                  {" "}({issuerCategoryLabels[(selectedIssuer.category || "general") as IssuerCategory]})
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">What credential do you need?</label>
              <Select value={selectedClaimType} onValueChange={setSelectedClaimType}>
                <SelectTrigger data-testid="select-request-claim-type">
                  <SelectValue placeholder="Select credential type" />
                </SelectTrigger>
                <SelectContent>
                  {availableClaimTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {claimTypeLabels[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Message to issuer (optional)</label>
              <Textarea
                placeholder="Explain why you need this credential..."
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                data-testid="input-request-message"
              />
            </div>

            <Button
              className="w-full"
              disabled={!selectedClaimType || requestMutation.isPending}
              onClick={() => requestMutation.mutate()}
              data-testid="button-submit-request"
            >
              {requestMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {reqStep || "Submitting..."}
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Submit & Sign On-Chain
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
