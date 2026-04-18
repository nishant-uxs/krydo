/**
 * EIP-1193 bridge between wagmi and our ethers-based contract helpers.
 *
 * Our contract helpers (`lib/contracts.ts`) are plain async functions —
 * they can't call React hooks, so they can't read wagmi state directly.
 * Instead, a React component mounted inside <WagmiProvider> pushes the
 * *current* connector's EIP-1193 provider into this module, and the
 * helpers pull it out when they need a signer.
 *
 * Fallback order:
 *   1. The wagmi-injected provider (covers WalletConnect, Coinbase,
 *      Rainbow, etc. — anything that doesn't set `window.ethereum`).
 *   2. `window.ethereum` (classic MetaMask / Rabby / Brave path).
 *
 * This lets us move to wagmi without rewriting every caller.
 */

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

let activeProvider: Eip1193Provider | null = null;

export function setActiveProvider(p: Eip1193Provider | null) {
  activeProvider = p;
}

export function getActiveProvider(): Eip1193Provider {
  if (activeProvider) return activeProvider;
  if (typeof window !== "undefined" && (window as any).ethereum) {
    return (window as any).ethereum as Eip1193Provider;
  }
  throw new Error(
    "No wallet provider available. Please connect a wallet before signing.",
  );
}

export function hasActiveProvider(): boolean {
  if (activeProvider) return true;
  if (typeof window !== "undefined" && (window as any).ethereum) return true;
  return false;
}
