import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import { Eye, CheckCircle2, XCircle, AlertTriangle, Search, Shield, Hash, Building, User, Clock, Link2, Fingerprint, Lock } from "lucide-react";
import { shortenAddress } from "@/lib/wallet";
import type { Credential } from "@shared/schema";
import { claimTypeLabels, proofTypeLabels, type ClaimType, type ProofType } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";

const verifySchema = z.object({
  credentialHash: z.string().min(1, "Credential hash or ID is required"),
});

const zkVerifySchema = z.object({
  proofId: z.string().min(1, "ZK Proof ID is required"),
});

interface VerificationResult {
  valid: boolean;
  credential: Credential | null;
  issuerName: string | null;
  issuerActive: boolean;
  onChain: boolean;
  message: string;
}

interface ZkVerificationResult {
  valid: boolean;
  reason: string;
  onChainVerified?: boolean | null;
  proof: {
    id: string;
    proofType: string;
    commitment: string;
    createdAt: string;
    onChainTxHash?: string | null;
    onChainStatus?: string | null;
    publicInputs: {
      proofType: string;
      threshold?: number;
      targetValue?: string;
      disclosedFields?: string[];
      fieldCommitments?: Record<string, string>;
      commitment: string;
      timestamp: number;
    };
  };
  credential: {
    claimType: string;
    claimSummary: string;
    status: string;
    holderAddress: string;
  } | null;
  issuer: {
    name: string;
    active: boolean;
  } | null;
}

function CredentialResult({ result }: { result: VerificationResult }) {
  return (
    <Card data-testid="card-verification-result">
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-5">
          {result.valid ? (
            <div className="w-10 h-10 rounded-md bg-chart-3/15 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-chart-3" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-md bg-destructive/15 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
          )}
          <div>
            <h3 className="font-serif font-semibold text-lg">
              {result.valid ? "Credential Verified" : "Verification Failed"}
            </h3>
            <p className="text-sm text-muted-foreground">{result.message}</p>
          </div>
        </div>

        {result.credential && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Claim Type</p>
                  <p className="text-sm font-medium capitalize">
                    {claimTypeLabels[result.credential.claimType as ClaimType] || result.credential.claimType}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Building className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Issuer</p>
                  <p className="text-sm font-medium">
                    {result.issuerName || shortenAddress(result.credential.issuerAddress)}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {result.issuerActive ? (
                      <Badge variant="secondary" className="text-[10px] bg-chart-3/15 text-chart-3 no-default-active-elevate">Active Issuer</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] bg-destructive/15 text-destructive no-default-active-elevate">Revoked Issuer</Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Holder</p>
                  <p className="font-mono text-sm">{shortenAddress(result.credential.holderAddress)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Issued</p>
                  <p className="text-sm">{new Date(result.credential.issuedAt).toLocaleDateString()}</p>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t space-y-3">
              <div className="flex items-start gap-2">
                <Hash className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">On-Chain Hash</p>
                  <p className="font-mono text-xs break-all">{result.credential.credentialHash}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Link2 className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Blockchain Verification</p>
                  {result.onChain ? (
                    <Badge variant="secondary" className="text-[10px] bg-chart-3/15 text-chart-3 no-default-active-elevate" data-testid="badge-onchain-verified">Verified on Sepolia</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground no-default-active-elevate" data-testid="badge-offchain">Off-chain only</Badge>
                  )}
                </div>
              </div>
            </div>

            {!result.issuerActive && result.valid && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-chart-4/10 border border-chart-4/20">
                <AlertTriangle className="w-4 h-4 text-chart-4 mt-0.5 shrink-0" />
                <p className="text-xs text-chart-4">
                  Warning: The issuer of this credential has been revoked. The credential data is authentic but the issuer is no longer trusted.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ZkProofResult({ zkResult }: { zkResult: ZkVerificationResult }) {
  return (
    <Card data-testid="card-zk-verification-result">
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-5">
          {zkResult.valid ? (
            <div className="w-10 h-10 rounded-md bg-chart-3/15 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-chart-3" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-md bg-destructive/15 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
          )}
          <div>
            <h3 className="font-serif font-semibold text-lg">
              {zkResult.valid ? "ZK Proof Verified" : "ZK Proof Invalid"}
            </h3>
            <p className="text-sm text-muted-foreground">{zkResult.reason}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-2">
              <Fingerprint className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Proof Type</p>
                <p className="text-sm font-medium">
                  {proofTypeLabels[zkResult.proof.proofType as ProofType] || zkResult.proof.proofType}
                </p>
              </div>
            </div>
            {zkResult.proof.publicInputs.threshold !== undefined && (
              <div className="flex items-start gap-2">
                <Hash className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Threshold</p>
                  <p className="text-sm font-medium">{zkResult.proof.publicInputs.threshold}</p>
                </div>
              </div>
            )}
            {zkResult.proof.publicInputs.disclosedFields && zkResult.proof.publicInputs.disclosedFields.length > 0 && (
              <div className="col-span-full flex items-start gap-2">
                <Eye className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Disclosed Fields</p>
                  <div className="flex flex-wrap gap-1">
                    {zkResult.proof.publicInputs.disclosedFields.map((f: string) => (
                      <Badge key={f} variant="secondary" className="text-[10px] bg-chart-3/15 text-chart-3 no-default-active-elevate capitalize">
                        <Eye className="w-2.5 h-2.5 mr-0.5" />
                        {f.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {zkResult.credential && (
              <>
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Claim Type</p>
                    <p className="text-sm font-medium capitalize">
                      {claimTypeLabels[zkResult.credential.claimType as ClaimType] || zkResult.credential.claimType}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Holder</p>
                    <p className="font-mono text-sm">{shortenAddress(zkResult.credential.holderAddress)}</p>
                  </div>
                </div>
              </>
            )}
            {zkResult.issuer && (
              <div className="flex items-start gap-2">
                <Building className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Issuer</p>
                  <p className="text-sm font-medium">{zkResult.issuer.name}</p>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] mt-0.5 no-default-active-elevate ${zkResult.issuer.active ? "bg-chart-3/15 text-chart-3" : "bg-destructive/15 text-destructive"}`}
                  >
                    {zkResult.issuer.active ? "Active" : "Revoked"}
                  </Badge>
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t space-y-3">
            <div className="flex items-start gap-2">
              <Hash className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Commitment Hash</p>
                <p className="font-mono text-xs break-all">{zkResult.proof.commitment}</p>
              </div>
            </div>
            {zkResult.proof.onChainTxHash && (
              <div className="flex items-start gap-2">
                <Link2 className="w-4 h-4 text-chart-1 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">On-Chain Proof Anchor</p>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${zkResult.proof.onChainTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-chart-1 hover:underline break-all"
                    data-testid="link-proof-tx"
                  >
                    {zkResult.proof.onChainTxHash}
                  </a>
                </div>
              </div>
            )}
            {zkResult.onChainVerified !== null && zkResult.onChainVerified !== undefined && (
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-chart-1 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">On-Chain Credential Status</p>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] no-default-active-elevate ${zkResult.onChainVerified ? "bg-chart-3/15 text-chart-3" : "bg-destructive/15 text-destructive"}`}
                    data-testid="badge-onchain-cred-status"
                  >
                    {zkResult.onChainVerified ? "Verified on Sepolia" : "Not verified on-chain"}
                  </Badge>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <Lock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Privacy Status</p>
                <Badge variant="secondary" className="text-[10px] bg-chart-1/15 text-chart-1 no-default-active-elevate">
                  Zero-Knowledge — actual value never revealed
                </Badge>
              </div>
            </div>
          </div>

          {zkResult.valid && (
            <div className="p-3 rounded-md bg-chart-3/10 border border-chart-3/20">
              <p className="text-xs text-chart-3">
                This proof cryptographically confirms the claim satisfies the stated condition. The actual credential value was never exposed during verification.
                {zkResult.proof.onChainTxHash && " Proof commitment is anchored on Sepolia testnet."}
                {zkResult.onChainVerified && " Underlying credential is verified on-chain."}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function VerifyPage() {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [zkResult, setZkResult] = useState<ZkVerificationResult | null>(null);

  const form = useForm<z.infer<typeof verifySchema>>({
    resolver: zodResolver(verifySchema),
    defaultValues: { credentialHash: "" },
  });

  const zkForm = useForm<z.infer<typeof zkVerifySchema>>({
    resolver: zodResolver(zkVerifySchema),
    defaultValues: { proofId: "" },
  });

  const verifyMutation = useMutation({
    mutationFn: async (data: z.infer<typeof verifySchema>) => {
      const res = await apiRequest("POST", "/api/verify", data);
      return res.json() as Promise<VerificationResult>;
    },
    onSuccess: (data) => setResult(data),
    onError: () => {
      setResult({
        valid: false,
        credential: null,
        issuerName: null,
        issuerActive: false,
        onChain: false,
        message: "Verification failed. The credential could not be found or verified.",
      });
    },
  });

  const zkVerifyMutation = useMutation({
    mutationFn: async (data: z.infer<typeof zkVerifySchema>) => {
      const res = await apiRequest("POST", "/api/zk/verify", data);
      return res.json() as Promise<ZkVerificationResult>;
    },
    onSuccess: (data) => setZkResult(data),
    onError: () => {
      setZkResult(null);
    },
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold" data-testid="text-verify-title">
          Verify
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verify credentials and zero-knowledge proofs without special permissions
        </p>
      </div>

      <Tabs defaultValue="credential">
        <TabsList className="w-full">
          <TabsTrigger value="credential" className="flex-1" data-testid="tab-verify-credential">
            <Eye className="w-4 h-4 mr-2" />
            Credential
          </TabsTrigger>
          <TabsTrigger value="zk-proof" className="flex-1" data-testid="tab-verify-zk">
            <Fingerprint className="w-4 h-4 mr-2" />
            ZK Proof
          </TabsTrigger>
        </TabsList>

        <TabsContent value="credential" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="w-4 h-4" />
                Credential Lookup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((data) => verifyMutation.mutate(data))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="credentialHash"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Credential Hash or ID</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="0x... or credential ID"
                            className="font-mono text-sm"
                            data-testid="input-verify-hash"
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
                    disabled={verifyMutation.isPending}
                    data-testid="button-verify"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    {verifyMutation.isPending ? "Verifying..." : "Verify Credential"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <AnimatePresence mode="wait">
            {result && (
              <motion.div
                key={result.valid ? "valid" : "invalid"}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
              >
                <CredentialResult result={result} />
              </motion.div>
            )}
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="zk-proof" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Fingerprint className="w-4 h-4" />
                ZK Proof Verification
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...zkForm}>
                <form
                  onSubmit={zkForm.handleSubmit((data) => zkVerifyMutation.mutate(data))}
                  className="space-y-4"
                >
                  <FormField
                    control={zkForm.control}
                    name="proofId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZK Proof ID</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter the proof ID shared by the holder..."
                            className="font-mono text-sm"
                            data-testid="input-verify-zk-id"
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
                    disabled={zkVerifyMutation.isPending}
                    data-testid="button-verify-zk"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    {zkVerifyMutation.isPending ? "Verifying ZK Proof..." : "Verify ZK Proof"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <AnimatePresence mode="wait">
            {zkResult && (
              <motion.div
                key={zkResult.valid ? "zk-valid" : "zk-invalid"}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
              >
                <ZkProofResult zkResult={zkResult} />
              </motion.div>
            )}
          </AnimatePresence>
        </TabsContent>
      </Tabs>
    </div>
  );
}
