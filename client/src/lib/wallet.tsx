import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { BrowserProvider } from "ethers";
import { SiweMessage } from "siwe";
import { apiRequest, queryClient } from "./queryClient";
import { setAuthToken, getAuthToken } from "./auth-token";

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, handler: (...args: any[]) => void) => void;
      removeListener: (event: string, handler: (...args: any[]) => void) => void;
    };
  }
}

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
  const [address, setAddress] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [onChainTxHash, setOnChainTxHash] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasMetaMask, setHasMetaMask] = useState(false);
  const addressRef = useRef<string | null>(null);

  useEffect(() => {
    setHasMetaMask(!!window.ethereum?.isMetaMask);
  }, []);

  // Hydrate from localStorage. Only trust it if we still have a JWT.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const token = getAuthToken();
      if (!token) {
        // Token was wiped (logout or expired elsewhere); force re-auth.
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

  // Handle MetaMask account switching — treat as logout, user must re-sign.
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      const newAddr = accounts[0]?.toLowerCase() ?? null;
      if (newAddr !== addressRef.current?.toLowerCase()) {
        setAddress(null);
        setRole(null);
        setLabel(null);
        setOnChainTxHash(null);
        addressRef.current = null;
        setAuthToken(null);
        localStorage.removeItem(STORAGE_KEY);
        queryClient.invalidateQueries({ queryKey: ["/api"] });
      }
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) return;
    setIsConnecting(true);
    try {
      // 1. Ensure MetaMask exposes an account.
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      const accounts: string[] = await window.ethereum.request({
        method: "eth_accounts",
      });
      if (!accounts || accounts.length === 0) return;
      const walletAddr = accounts[0];

      // 2. Fetch a server-issued nonce.
      const nonceRes = await fetch(
        `/api/auth/nonce?address=${encodeURIComponent(walletAddr)}`,
      );
      if (!nonceRes.ok) {
        throw new Error("Failed to fetch auth nonce");
      }
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      // 3. Build a SIWE message.
      const provider = new BrowserProvider(window.ethereum as any);
      const network = await provider.getNetwork();
      const siwe = new SiweMessage({
        domain: window.location.host,
        address: walletAddr,
        statement: "Sign in to Krydo to prove ownership of this wallet.",
        uri: window.location.origin,
        version: "1",
        chainId: Number(network.chainId),
        nonce,
        issuedAt: new Date().toISOString(),
      });
      const message = siwe.prepareMessage();

      // 4. Ask wallet to sign it.
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(message);

      // 5. Submit to backend for verification + JWT issuance.
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
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setRole(null);
    setLabel(null);
    setOnChainTxHash(null);
    addressRef.current = null;
    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
    queryClient.clear();
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        role,
        label,
        onChainTxHash,
        isConnected: !!address && !!role,
        isConnecting,
        hasMetaMask,
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
