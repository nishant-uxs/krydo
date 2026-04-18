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
 * Implementation note:
 *   We use RainbowKit's `getDefaultConfig` rather than wagmi's plain
 *   `createConfig` because the RainbowKit modal can only render wallets
 *   that have been registered through its own wallet-wrapper system
 *   (`@rainbow-me/rainbowkit/wallets`). Passing raw wagmi connectors
 *   produces a modal with no visible wallet buttons — the connector
 *   works but nothing shows up. `getDefaultConfig` registers the
 *   standard wallet roster (MetaMask, Rainbow, Coinbase, WalletConnect,
 *   injected, Safe) with proper icons + metadata out of the box.
 *
 * WalletConnect projectId:
 *   RainbowKit v2 REQUIRES a non-empty projectId at init time, even if
 *   the user never picks WalletConnect. If `VITE_WALLETCONNECT_PROJECT_ID`
 *   is missing we fall back to a dev placeholder; MetaMask / Coinbase /
 *   Rainbow / injected still work, WalletConnect QR pairing won't — the
 *   user should register a free project at https://cloud.reown.com/ for
 *   a real deploy.
 */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";

const PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ||
  // Not a real project id — just keeps the RainbowKit SDK from throwing
  // when no env var is configured. Replace it in production.
  "krydo-dev-placeholder-no-walletconnect";

export const wagmiConfig = getDefaultConfig({
  appName: "Krydo",
  appDescription:
    "Privacy-preserving financial trust infrastructure on Ethereum.",
  appUrl:
    typeof window !== "undefined" ? window.location.origin : "https://krydo.app",
  projectId: PROJECT_ID,
  chains: [sepolia],
  ssr: false,
});

export const SUPPORTED_CHAIN = sepolia;
