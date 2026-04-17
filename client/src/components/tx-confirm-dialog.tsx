import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Wallet, ArrowRight, AlertTriangle, Loader2 } from "lucide-react";

export interface TxConfirmInfo {
  action: "add_issuer" | "revoke_issuer" | "issue_credential" | "revoke_credential";
  title: string;
  description: string;
  details: { label: string; value: string; mono?: boolean }[];
  warning?: string;
}

interface TxConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  info: TxConfirmInfo | null;
  onConfirm: () => void;
  isPending?: boolean;
}

const actionLabels: Record<TxConfirmInfo["action"], { label: string; color: string }> = {
  add_issuer: { label: "Authorize Issuer", color: "bg-chart-3/15 text-chart-3" },
  revoke_issuer: { label: "Revoke Issuer", color: "bg-destructive/15 text-destructive" },
  issue_credential: { label: "Issue Credential", color: "bg-chart-1/15 text-chart-1" },
  revoke_credential: { label: "Revoke Credential", color: "bg-destructive/15 text-destructive" },
};

export function TxConfirmDialog({ open, onOpenChange, info, onConfirm, isPending }: TxConfirmDialogProps) {
  if (!info) return null;

  const actionMeta = actionLabels[info.action];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            {info.title}
          </DialogTitle>
          <DialogDescription>{info.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Transaction Type:</span>
            <Badge variant="secondary" className={`text-[10px] no-default-active-elevate ${actionMeta.color}`}>
              {actionMeta.label}
            </Badge>
          </div>

          <div className="space-y-2 p-3 rounded-md bg-muted/50 border">
            {info.details.map((detail, i) => (
              <div key={i} className="flex items-start justify-between gap-2">
                <span className="text-xs text-muted-foreground shrink-0">{detail.label}</span>
                <span className={`text-xs text-right break-all ${detail.mono ? "font-mono" : "font-medium"}`}>
                  {detail.value}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 p-3 rounded-md bg-chart-1/10 border border-chart-1/20">
            <Wallet className="w-4 h-4 text-chart-1 shrink-0" />
            <div>
              <p className="text-xs font-medium text-chart-1">MetaMask will open next</p>
              <p className="text-[11px] text-chart-1/80">
                Review and confirm the transaction in your MetaMask wallet. Gas fees apply on Sepolia testnet.
              </p>
            </div>
          </div>

          {info.warning && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-chart-4/10 border border-chart-4/20">
              <AlertTriangle className="w-4 h-4 text-chart-4 shrink-0 mt-0.5" />
              <p className="text-xs text-chart-4">{info.warning}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending} data-testid="button-tx-cancel">
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending} data-testid="button-tx-proceed">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4 mr-2" />
                Proceed to MetaMask
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
