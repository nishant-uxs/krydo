/**
 * Single source of truth for deployed-contract metadata, shared between
 * `server/*` (ethers.js + Sepolia RPC) and `client/src/*` (MetaMask signer).
 *
 * The deployment JSON is produced by `script/deploy.ts` after running the
 * Hardhat deploy task; it contains the on-chain addresses and the full ABI
 * for each Krydo contract. Anything below is derived from that file so the
 * two codebases can never drift apart.
 */
import type { InterfaceAbi } from "ethers";
import deployment from "../contracts/deployment.json";

export interface ContractInfo {
  address: string;
  abi: InterfaceAbi;
}

export interface DeploymentInfo {
  network: string;
  deployer: string;
  deployedAt: string;
  contracts: {
    KrydoAuthority: ContractInfo;
    KrydoCredentials: ContractInfo;
  };
}

/** Typed view of the deployment.json baked into the bundle. */
export const DEPLOYMENT = deployment as unknown as DeploymentInfo;

/** Contract addresses on Sepolia. */
export const AUTHORITY_ADDRESS = DEPLOYMENT.contracts.KrydoAuthority.address;
export const CREDENTIALS_ADDRESS = DEPLOYMENT.contracts.KrydoCredentials.address;

/** Full structured ABIs, suitable for `new ethers.Contract(addr, abi, signer)`. */
export const AUTHORITY_ABI = DEPLOYMENT.contracts.KrydoAuthority.abi;
export const CREDENTIALS_ABI = DEPLOYMENT.contracts.KrydoCredentials.abi;

/** Chain constants. Sepolia = 11155111 = 0xaa36a7. */
export const SEPOLIA_CHAIN_ID_DEC = 11_155_111;
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

export const SEPOLIA_NETWORK_CONFIG = {
  chainId: SEPOLIA_CHAIN_ID_HEX,
  chainName: "Sepolia Testnet",
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.sepolia.org"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
} as const;
