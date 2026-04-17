import { useState, useMemo } from "react";
import { useWallet, shortenAddress } from "@/lib/wallet";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck,
  Lock,
  Loader2,
  Copy,
  CheckCircle2,
  Eye,
  Fingerprint,
  Hash,
  ArrowUpRight,
  EyeOff,
  Link2,
  ExternalLink,
} from "lucide-react";
import type { Credential, ZkProof } from "@shared/schema";
import { proofTypeLabels, claimTypeLabels, type ProofType, type ClaimType } from "@shared/schema";
import { motion } from "framer-motion";

export default function ZkProofsPage() {
  const { address } = useWallet();
  const { toast } = useToast();
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);
  const [proofType, setProofType] = useState<ProofType>("range_above");
  const [threshold, setThreshold] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [generatedProof, setGeneratedProof] = useState<any>(null);
  const [proofDialogOpen, setProofDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);

  const credentialFields = useMemo(() => {
    if (!selectedCredential) return {};
    const cd = selectedCredential.claimData as { fields?: Record<string, string>; value?: string } | null;
    if (cd?.fields) return cd.fields;
    if (cd?.value) return { value: cd.value };
    return {};
  }, [selectedCredential]);

  const { data: credentials, isLoading: credsLoading } = useQuery<Credential[]>({
    queryKey: ["/api/credentials", address],
    enabled: !!address,
  });

  const { data: proofs, isLoading: proofsLoading } = useQuery<ZkProof[]>({
    queryKey: ["/api/zk/proofs", address],
    enabled: !!address,
  });

  const activeCredentials = credentials?.filter((c) => c.status === "active") || [];

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCredential) throw new Error("Select a credential");
      const body: any = {
        credentialId: selectedCredential.id,
        proverAddress: address,
        proofType,
      };
      if (proofType === "range_above" || proofType === "range_below") {
        if (!threshold) throw new Error("Threshold is required for range proofs");
        body.threshold = parseFloat(threshold);
      }
      if (proofType === "equality") {
        if (!targetValue) throw new Error("Target value is required");
        body.targetValue = targetValue;
      }
      if (proofType === "selective_disclosure") {
        if (selectedFields.length === 0) throw new Error("Select at least one field to disclose");
        body.selectedFields = selectedFields;
      }
      const res = await apiRequest("POST", "/api/zk/generate", body);
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedProof(data);
      setProofDialogOpen(true);
      queryClient.invalidateQueries({ queryKey: ["/api/zk/proofs"] });
      toast({ title: "ZK Proof Generated", description: data.verified ? "Proof verified - claim satisfies the condition" : "Proof generated but claim does NOT satisfy the condition" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to generate proof", description: error.message, variant: "destructive" });
    },
  });

  const copyProofId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold" data-testid="text-zk-title">
          Zero-Knowledge Proofs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prove facts about your credentials without revealing sensitive data
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="w-4 h-4" />
            Generate ZK Proof
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Select Credential</label>
            {credsLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : activeCredentials.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active credentials available</p>
            ) : (
              <Select
                value={selectedCredential?.id || ""}
                onValueChange={(id) => {
                  setSelectedCredential(activeCredentials.find((c) => c.id === id) || null);
                  setSelectedFields([]);
                }}
              >
                <SelectTrigger data-testid="select-zk-credential">
                  <SelectValue placeholder="Choose a credential..." />
                </SelectTrigger>
                <SelectContent>
                  {activeCredentials.map((cred) => (
                    <SelectItem key={cred.id} value={cred.id}>
                      {claimTypeLabels[cred.claimType as ClaimType] || cred.claimType} — {cred.claimSummary}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedCredential && (
            <div className="p-3 rounded-md bg-muted/50 border text-sm space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-[10px] bg-chart-3/15 text-chart-3 no-default-active-elevate">
                  {claimTypeLabels[selectedCredential.claimType as ClaimType]}
                </Badge>
                {Object.keys(credentialFields).length > 1 && (
                  <Badge variant="secondary" className="text-[10px] bg-primary/15 text-primary no-default-active-elevate">
                    {Object.keys(credentialFields).length} fields
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground">{selectedCredential.claimSummary}</p>
              <p className="font-mono text-xs text-muted-foreground">
                Hash: {selectedCredential.credentialHash.slice(0, 24)}...
              </p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-2 block">Proof Type</label>
            <Select value={proofType} onValueChange={(v) => { setProofType(v as ProofType); setSelectedFields([]); }}>
              <SelectTrigger data-testid="select-proof-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(proofTypeLabels) as [ProofType, string][]).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {proofType === "selective_disclosure" && selectedCredential && (
            <div className="space-y-2">
              <label className="text-sm font-medium mb-2 block">
                <Eye className="w-3.5 h-3.5 inline mr-1" />
                Select Fields to Disclose
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Choose which credential fields to reveal. Unselected fields remain hidden behind cryptographic commitments.
              </p>
              {Object.keys(credentialFields).length > 0 ? (
                <div className="space-y-2 p-3 rounded-md bg-muted/50 border">
                  {Object.entries(credentialFields).map(([fieldName, fieldValue]) => (
                    <div key={fieldName} className="flex items-center gap-3">
                      <Checkbox
                        id={`field-${fieldName}`}
                        checked={selectedFields.includes(fieldName)}
                        onCheckedChange={(checked) => {
                          setSelectedFields(
                            checked
                              ? [...selectedFields, fieldName]
                              : selectedFields.filter((f) => f !== fieldName)
                          );
                        }}
                        data-testid={`checkbox-field-${fieldName}`}
                      />
                      <label htmlFor={`field-${fieldName}`} className="flex-1 flex items-center justify-between cursor-pointer">
                        <span className="text-sm font-medium capitalize">{fieldName.replace(/_/g, " ")}</span>
                        {selectedFields.includes(fieldName) ? (
                          <Badge variant="secondary" className="text-[10px] bg-chart-3/15 text-chart-3 no-default-active-elevate">
                            <Eye className="w-2.5 h-2.5 mr-0.5" />
                            Disclosed
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground no-default-active-elevate">
                            <EyeOff className="w-2.5 h-2.5 mr-0.5" />
                            Hidden
                          </Badge>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This credential has no multi-field data available.</p>
              )}
            </div>
          )}

          {(proofType === "range_above" || proofType === "range_below") && (
            <div>
              <label className="text-sm font-medium mb-2 block">
                Threshold Value
              </label>
              <Input
                type="number"
                placeholder={proofType === "range_above" ? "e.g. 700 (prove value >= this)" : "e.g. 50 (prove value <= this)"}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                data-testid="input-zk-threshold"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {proofType === "range_above"
                  ? "Proves your credential value is at or above this threshold without revealing the exact value"
                  : "Proves your credential value is at or below this threshold without revealing the exact value"}
              </p>
            </div>
          )}

          {proofType === "equality" && (
            <div>
              <label className="text-sm font-medium mb-2 block">Target Value</label>
              <Input
                placeholder="Value to prove equality with"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                data-testid="input-zk-target"
              />
            </div>
          )}

          <Button
            onClick={() => generateMutation.mutate()}
            disabled={!selectedCredential || generateMutation.isPending}
            className="w-full"
            data-testid="button-generate-proof"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating ZK Proof...
              </>
            ) : (
              <>
                <Fingerprint className="w-4 h-4 mr-2" />
                Generate Zero-Knowledge Proof
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="font-serif text-lg font-semibold mb-3">Generated Proofs</h2>
        {proofsLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : proofs && proofs.length > 0 ? (
          <div className="space-y-3">
            {proofs.map((proof, i) => (
              <motion.div
                key={proof.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card data-testid={`card-zk-proof-${proof.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold">
                            {proofTypeLabels[proof.proofType as ProofType] || proof.proofType}
                          </h3>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] no-default-active-elevate ${
                              proof.verified
                                ? "bg-chart-3/15 text-chart-3"
                                : "bg-chart-4/15 text-chart-4"
                            }`}
                          >
                            {proof.verified ? "Verified" : "Pending"}
                          </Badge>
                          {proof.onChainTxHash ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] bg-chart-1/15 text-chart-1 no-default-active-elevate cursor-pointer"
                              onClick={() => window.open(`https://sepolia.etherscan.io/tx/${proof.onChainTxHash}`, "_blank")}
                              data-testid={`badge-onchain-${proof.id}`}
                            >
                              <Link2 className="w-2.5 h-2.5 mr-0.5" />
                              On-Chain
                              <ExternalLink className="w-2 h-2 ml-0.5" />
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground no-default-active-elevate">
                              Off-Chain
                            </Badge>
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          Proof ID: {proof.id}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          Commitment: {proof.commitment.slice(0, 24)}...
                        </p>
                        {proof.onChainTxHash && (
                          <p className="font-mono text-[11px] text-muted-foreground">
                            Tx: {proof.onChainTxHash.slice(0, 18)}...
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {new Date(proof.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyProofId(proof.id)}
                        data-testid={`button-copy-proof-${proof.id}`}
                      >
                        {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <ShieldCheck className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No ZK proofs generated yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Generate a proof above to share verifiable claims without exposing data
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={proofDialogOpen} onOpenChange={setProofDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-chart-3" />
              ZK Proof Generated
            </DialogTitle>
          </DialogHeader>
          {generatedProof && (
            <div className="space-y-4">
              <div className={`p-3 rounded-md ${generatedProof.verified ? "bg-chart-3/10 border-chart-3/20" : "bg-destructive/10 border-destructive/20"} border`}>
                <p className="text-sm font-medium">
                  {generatedProof.verified
                    ? "Proof verified — your credential satisfies the condition"
                    : "Proof generated — but your credential does NOT satisfy the condition"}
                </p>
              </div>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Proof ID (share this for verification)</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="font-mono text-xs bg-muted px-2 py-1 rounded flex-1 break-all">
                      {generatedProof.id}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyProofId(generatedProof.id)}
                      data-testid="button-copy-proof-dialog"
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">Commitment</p>
                  <code className="font-mono text-xs break-all">{generatedProof.commitment}</code>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">Proof Type</p>
                  <p className="text-sm">{proofTypeLabels[generatedProof.proofType as ProofType]}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">Protocol</p>
                  <p className="text-sm font-mono">krydo-zkp-v1</p>
                </div>

                {generatedProof?.proofType === "selective_disclosure" && generatedProof?.publicInputs?.disclosedFields && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Disclosed Fields</p>
                    <div className="flex flex-wrap gap-1">
                      {generatedProof.publicInputs.disclosedFields.map((f: string) => (
                        <Badge key={f} variant="secondary" className="text-[10px] bg-chart-3/15 text-chart-3 no-default-active-elevate capitalize">
                          <Eye className="w-2.5 h-2.5 mr-0.5" />
                          {f.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Share the Proof ID with any verifier. They can verify your claim without seeing your actual data.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
