/**
 * Krydo WalletProvider — v2 (wagmi + RainbowKit).
 *
 * This module still exposes the exact same `useWallet()` shape the rest
 * of the app depends on (address, role, label, connect, disconnect, …),
 * but internally now:
 *   1. Connection UX is handled by RainbowKit's modal, so users can pick
 *      MetaMask, WalletConnect, Coinbase Wallet, Rainbow, Brave, Rabby,
 *      etc. — not just MetaMask.
 *   2. The active wallet's EIP-1193 provider is pushed into
 *      `eip1193-bridge.ts` whenever it changes, so our ethers-based
 *      `lib/contracts.ts` keeps working unchanged.
 *   3. SIWE message construction + signature is driven by wagmi's
 *      `useSignMessage`, which routes through whatever connector is
 *      active (so WalletConnect mobile signing Just Works).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SiweMessage } from "siwe";
import {
  useAccount,
  useAccountEffect,
  useChainId,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
} from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { apiRequest, queryClient } from "./queryClient";
import { setAuthToken, getAuthToken } from "./auth-token";
import { setActiveProvider } from "./eip1193-bridge";
import { SUPPORTED_CHAIN } from "./wagmi";

const STORAGE_KEY = "krydo_wallet";

interface StoredWallet {
  address: string;
  role: string;
  label: string | null;
  onChainTxHash: string | null;
}

interface WalletContextType {
  address: string | null;
  role: string | null;
  label: string | null;
  onChainTxHash: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  /** Kept for API compatibility; effectively "has any EVM wallet?". */
  hasMetaMask: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  role: null,
  label: null,
  onChainTxHash: null,
  isConnected: false,
  isConnecting: false,
  hasMetaMask: false,
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const { address: wagmiAddress, connector, isConnected: wagmiConnected } =
    useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();

  const [address, setAddress] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [onChainTxHash, setOnChainTxHash] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  // `hasMetaMask` is kept for backward compatibility with the old UI. With
  // wagmi we always expose a wallet story (WalletConnect QR works without
  // any extension), so we hard-code true after the first render.
  const [hasWallet, setHasWallet] = useState(false);

  const addressRef = useRef<string | null>(null);
  // Track whether we've kicked off a SIWE sign for the current wagmi
  // session. Prevents duplicate sign prompts on re-mount / HMR.
  const signInInFlightFor = useRef<string | null>(null);

  useEffect(() => {
    setHasWallet(true);
  }, []);

  // Keep the EIP-1193 bridge in sync with the active wagmi connector so
  // `lib/contracts.ts` always signs through the right wallet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!connector) {
        setActiveProvider(null);
        return;
      }
      try {
        const provider = (await connector.getProvider()) as {
          request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
        };
        if (!cancelled) setActiveProvider(provider);
      } catch {
        // Connector transient error; ignore and let next render retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connector]);

  // Hydrate from localStorage. Only trust it if a valid JWT is still around.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const token = getAuthToken();
      if (!token) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const data = JSON.parse(stored) as StoredWallet;
      setAddress(data.address);
      setRole(data.role);
      setLabel(data.label);
      setOnChainTxHash(data.onChainTxHash || null);
      addressRef.current = data.address;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // If wagmi reports an address change away from our active SIWE session,
  // treat it as a silent logout — the user must re-sign.
  useEffect(() => {
    const krydoAddr = addressRef.current?.toLowerCase();
    const walletAddr = wagmiAddress?.toLowerCase() ?? null;
    if (krydoAddr && walletAddr && krydoAddr !== walletAddr) {
      clearLocalSession();
    }
    // If wagmi has fully disconnected but we still hold a session, keep it
    // so the user survives an accidental wallet disconnect. A real logout
    // must come through our `disconnect()` handler.
  }, [wagmiAddress]);

  useAccountEffect({
    onDisconnect() {
      // Explicit disconnect from the wallet app itself — drop the JWT too.
      clearLocalSession();
    },
  });

  function clearLocalSession() {
    setAddress(null);
    setRole(null);
    setLabel(null);
    setOnChainTxHash(null);
    addressRef.current = null;
    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
    queryClient.invalidateQueries({ queryKey: ["/api"] });
  }

  const runSiweFlow = useCallback(
    async (walletAddr: string) => {
      if (signInInFlightFor.current === walletAddr) return;
      signInInFlightFor.current = walletAddr;
      setIsConnecting(true);
      try {
        // Make sure the wallet is on Sepolia before signing. Some wallets
        // (e.g. Coinbase) will silently sign on whatever chain they're on.
        if (chainId !== SUPPORTED_CHAIN.id) {
          try {
            await switchChainAsync({ chainId: SUPPORTED_CHAIN.id });
          } catch {
            // User refused the switch — abort sign-in.
            return;
          }
        }

        const nonceRes = await fetch(
          `/api/auth/nonce?address=${encodeURIComponent(walletAddr)}`,
        );
        if (!nonceRes.ok) throw new Error("Failed to fetch auth nonce");
        const { nonce } = (await nonceRes.json()) as { nonce: string };

        const siwe = new SiweMessage({
          domain: window.location.host,
          address: walletAddr,
          statement: "Sign in to Krydo to prove ownership of this wallet.",
          uri: window.location.origin,
          version: "1",
          chainId: SUPPORTED_CHAIN.id,
          nonce,
          issuedAt: new Date().toISOString(),
        });
        const message = siwe.prepareMessage();
        const signature = await signMessageAsync({ message });

        const verifyRes = await apiRequest("POST", "/api/auth/verify", {
          message,
          signature,
        });
        const { token, wallet } = (await verifyRes.json()) as {
          token: string;
          wallet: StoredWallet;
        };

        setAuthToken(token);
        setAddress(wallet.address);
        setRole(wallet.role);
        setLabel(wallet.label);
        setOnChainTxHash(wallet.onChainTxHash || null);
        addressRef.current = wallet.address;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
        queryClient.invalidateQueries({ queryKey: ["/api"] });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Wallet sign-in failed:", err);
        setAuthToken(null);
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        setIsConnecting(false);
        signInInFlightFor.current = null;
      }
    },
    [chainId, switchChainAsync, signMessageAsync],
  );

  const connect = useCallback(async () => {
    // If wagmi already has an address, go straight to the SIWE flow.
    if (wagmiConnected && wagmiAddress) {
      await runSiweFlow(wagmiAddress);
      return;
    }
    // Otherwise let RainbowKit prompt the user to pick a wallet.
    openConnectModal?.();
  }, [wagmiConnected, wagmiAddress, openConnectModal, runSiweFlow]);

  // Once wagmi has an address but we don't have a Krydo session yet, kick
  // off the SIWE flow automatically. Fires exactly once per new address.
  useEffect(() => {
    if (!wagmiConnected || !wagmiAddress) return;
    if (addressRef.current?.toLowerCase() === wagmiAddress.toLowerCase()) return;
    void runSiweFlow(wagmiAddress);
  }, [wagmiConnected, wagmiAddress, runSiweFlow]);

  const disconnect = useCallback(async () => {
    clearLocalSession();
    try {
      await disconnectAsync();
    } catch {
      /* ignore */
    }
    queryClient.clear();
  }, [disconnectAsync]);

  return (
    <WalletContext.Provider
      value={{
        address,
        role,
        label,
        onChainTxHash,
        isConnected: !!address && !!role,
        isConnecting,
        hasMetaMask: hasWallet,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}

export function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
