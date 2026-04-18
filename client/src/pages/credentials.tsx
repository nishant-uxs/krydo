import { useWallet, shortenAddress } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Shield, Clock, Hash, User, Building, QrCode, AlertTriangle, CalendarClock, Layers } from "lucide-react";
import type { Credential } from "@shared/schema";
import { claimTypeLabels, type ClaimType } from "@shared/schema";
import { motion } from "framer-motion";
import { useState } from "react";
import { QrCodeCanvas } from "@/components/qr-code-canvas";

function getExpiryStatus(cred: Credential): { label: string; color: string; icon: typeof Clock } | null {
  if (!cred.expiresAt) return null;
  const exp = new Date(cred.expiresAt);
  const now = new Date();
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 0) return { label: "Expired", color: "bg-destructive/15 text-destructive", icon: AlertTriangle };
  if (daysLeft <= 30) return { label: `Expires in ${daysLeft}d`, color: "bg-chart-4/15 text-chart-4", icon: CalendarClock };
  return { label: `Expires ${exp.toLocaleDateString()}`, color: "bg-muted text-muted-foreground", icon: CalendarClock };
}

export default function CredentialsPage() {
  const { address } = useWallet();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const [qrTitle, setQrTitle] = useState("");

  const { data: credentials, isLoading } = useQuery<Credential[]>({
    queryKey: ["/api/credentials", address],
    enabled: !!address,
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold" data-testid="text-credentials-title">
          My Credentials
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and manage your verifiable credentials
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : credentials && credentials.length > 0 ? (
        <div className="space-y-4">
          {credentials.map((cred, i) => (
            <motion.div
              key={cred.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <Card data-testid={`card-credential-${cred.id}`}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-serif font-semibold text-lg capitalize">
                          {claimTypeLabels[cred.claimType as ClaimType] || cred.claimType.replace(/_/g, " ")}
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
                        {(() => {
                          const expiry = getExpiryStatus(cred);
                          if (!expiry) return null;
                          const ExpiryIcon = expiry.icon;
                          return (
                            <Badge variant="secondary" className={`text-[10px] no-default-active-elevate ${expiry.color}`}>
                              <ExpiryIcon className="w-2.5 h-2.5 mr-0.5" />
                              {expiry.label}
                            </Badge>
                          );
                        })()}
                        {(() => {
                          const cd = cred.claimData as { fields?: Record<string, string> } | null;
                          const fieldCount = cd?.fields ? Object.keys(cd.fields).length : 0;
                          if (fieldCount <= 1) return null;
                          return (
                            <Badge variant="secondary" className="text-[10px] bg-primary/15 text-primary no-default-active-elevate">
                              <Layers className="w-2.5 h-2.5 mr-0.5" />
                              {fieldCount} fields
                            </Badge>
                          );
                        })()}
                      </div>
                      <p className="text-sm text-muted-foreground">{cred.claimSummary}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQrValue(cred.credentialHash);
                        setQrTitle(claimTypeLabels[cred.claimType as ClaimType] || cred.claimType);
                        setQrOpen(true);
                      }}
                      data-testid={`button-qr-${cred.id}`}
                    >
                      <QrCode className="w-3.5 h-3.5 mr-1" />
                      QR
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="flex items-start gap-2">
                      <Hash className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground mb-0.5">Credential Hash</p>
                        <p className="font-mono break-all">{cred.credentialHash}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Building className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground mb-0.5">Issuer</p>
                        <p className="font-mono">{shortenAddress(cred.issuerAddress)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground mb-0.5">Issued</p>
                        <p>{new Date(cred.issuedAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <User className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground mb-0.5">Holder</p>
                        <p className="font-mono">{shortenAddress(cred.holderAddress)}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-serif text-lg font-semibold mb-1">No Credentials</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              You don't have any credentials yet. Request credentials from a trusted issuer in the network.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-primary" />
              Share Credential
            </DialogTitle>
            <DialogDescription>
              {qrTitle} - scan to verify
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="bg-white p-2 rounded-lg">
              <QrCodeCanvas value={qrValue} />
            </div>
            <p className="font-mono text-[10px] text-muted-foreground break-all text-center px-4">
              {qrValue}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(qrValue);
              }}
              data-testid="button-copy-hash"
            >
              Copy Hash
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
