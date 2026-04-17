import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ETHERSCAN_BASE = "https://sepolia.etherscan.io";

interface TxSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  txHash: string;
  blockNumber?: string;
  title: string;
  description: string;
}

export function TxSuccessDialog({
  open,
  onOpenChange,
  txHash,
  blockNumber,
  title,
  description,
}: TxSuccessDialogProps) {
  const [copied, setCopied] = useState(false);
  const isOnChain = txHash && !txHash.startsWith("0x000");

  const copyHash = () => {
    navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="items-center text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          >
            <div className="w-16 h-16 rounded-full bg-chart-3/15 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8 text-chart-3" />
            </div>
          </motion.div>
          <DialogTitle className="font-serif text-xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Transaction Hash
              </p>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs break-all flex-1" data-testid="text-tx-hash">
                  {txHash}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={copyHash}
                  data-testid="button-copy-tx-hash"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-chart-3" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {blockNumber && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Block Number
                </p>
                <p className="font-mono text-xs" data-testid="text-block-number">#{blockNumber}</p>
              </div>
            )}

            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Network
              </p>
              <p className="text-xs">Sepolia Testnet</p>
            </div>
          </div>

          <div className="flex gap-2">
            {isOnChain && (
              <Button
                variant="outline"
                className="flex-1"
                asChild
                data-testid="button-view-etherscan"
              >
                <a
                  href={`${ETHERSCAN_BASE}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View on Etherscan
                </a>
              </Button>
            )}
            <Button
              className="flex-1"
              onClick={() => onOpenChange(false)}
              data-testid="button-close-tx-dialog"
            >
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
