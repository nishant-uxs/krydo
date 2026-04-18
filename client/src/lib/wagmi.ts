/**
 * wagmi v2 + RainbowKit configuration.
 *
 * Why this file exists:
 *   Krydo originally wired `window.ethereum` directly, which pinned users to
 *   MetaMask's browser extension. That excludes mobile users, hardware
 *   wallets routed through WalletConnect, Coinbase Wallet, Rainbow, Rabby,
 *   and everything else in the ecosystem. This module replaces that with a
 *   proper wagmi connector stack while keeping our custom SIWE flow.
 *
 * Connector policy:
 *   - MetaMask + Coinbase Wallet get dedicated connectors (they have
 *     first-class UX and don't always show up via `injected`).
 *   - `injected()` picks up every other EIP-1193 browser wallet (Rabby,
 *     Brave, Frame, Trust, …).
 *   - WalletConnect is added only if `VITE_WALLETCONNECT_PROJECT_ID` is
 *     configured. Without it, WalletConnect's own SDK throws at import
 *     time, so we gate it.
 */

import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import {
  coinbaseWallet,
  injected,
  metaMask,
  walletConnect,
} from "wagmi/connectors";

const walletConnectProjectId = import.meta.env
  .VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

const connectors = [
  metaMask({ dappMetadata: { name: "Krydo" } }),
  coinbaseWallet({ appName: "Krydo" }),
  injected({ shimDisconnect: true }),
  ...(walletConnectProjectId
    ? [
        walletConnect({
          projectId: walletConnectProjectId,
          metadata: {
            name: "Krydo",
            description:
              "Privacy-preserving financial trust infrastructure on Ethereum.",
            url:
              typeof window !== "undefined"
                ? window.location.origin
                : "https://krydo.app",
            icons: [],
          },
          showQrModal: true,
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors,
  transports: {
    [sepolia.id]: http(),
  },
  ssr: false,
});

export const SUPPORTED_CHAIN = sepolia;
