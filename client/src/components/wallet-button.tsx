import { useWallet, shortenAddress } from "@/lib/wallet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { LogOut, Copy, Check } from "lucide-react";
import { SiEthereum } from "react-icons/si";
import { useState } from "react";

export function WalletButton() {
  const { address, role, label, isConnected, isConnecting, connect, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isConnected) {
    return (
      <Button
        onClick={connect}
        disabled={isConnecting}
        data-testid="button-connect-wallet"
      >
        <SiEthereum className="w-4 h-4 mr-2" />
        {isConnecting ? "Signing in..." : "Connect Wallet"}
      </Button>
    );
  }

  const roleColors: Record<string, string> = {
    root: "bg-chart-5/15 text-chart-5 dark:bg-chart-5/20 dark:text-chart-5",
    issuer: "bg-chart-1/15 text-chart-1 dark:bg-chart-1/20 dark:text-chart-1",
    user: "bg-chart-3/15 text-chart-3 dark:bg-chart-3/20 dark:text-chart-3",
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid="button-wallet-menu">
          <div className="flex items-center gap-2">
            <SiEthereum className="w-3 h-3 text-primary" />
            <span className="font-mono text-xs">{shortenAddress(address!)}</span>
            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 no-default-active-elevate ${roleColors[role || "user"]}`}>
              {role}
            </Badge>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <SiEthereum className="w-3 h-3 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Connected Wallet</p>
          </div>
          <p className="font-mono text-xs mt-1 break-all">{address}</p>
          {label && <p className="text-sm text-muted-foreground mt-1">{label}</p>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={copyAddress} data-testid="button-copy-address">
          {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
          {copied ? "Copied!" : "Copy Address"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={disconnect} data-testid="button-disconnect">
          <LogOut className="w-4 h-4 mr-2" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
