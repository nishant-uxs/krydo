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
    /** Optional: present only after `npm run deploy:audit` has been run. */
    KrydoAudit?: ContractInfo;
  };
}

/** Typed view of the deployment.json baked into the bundle. */
export const DEPLOYMENT = deployment as unknown as DeploymentInfo;

/** Contract addresses on Sepolia. */
export const AUTHORITY_ADDRESS = DEPLOYMENT.contracts.KrydoAuthority.address;
export const CREDENTIALS_ADDRESS = DEPLOYMENT.contracts.KrydoCredentials.address;
/**
 * Empty string when the audit contract hasn't been deployed yet; code that
 * depends on it must gate on `AUDIT_ADDRESS` being truthy.
 */
export const AUDIT_ADDRESS = DEPLOYMENT.contracts.KrydoAudit?.address ?? "";

/** Full structured ABIs, suitable for `new ethers.Contract(addr, abi, signer)`. */
export const AUTHORITY_ABI = DEPLOYMENT.contracts.KrydoAuthority.abi;
export const CREDENTIALS_ABI = DEPLOYMENT.contracts.KrydoCredentials.abi;
/**
 * Minimal fallback ABI that matches `KrydoAudit.sol`. Used when deployment.json
 * does not carry an audit entry yet (pre-audit-deploy bootstrap). Once the
 * contract is deployed, the full ABI from deployment.json takes over.
 */
const AUDIT_FALLBACK_ABI = [
  "event Anchor(address indexed sender, bytes32 indexed kind, bytes32 indexed id, bytes data, uint256 timestamp)",
  "function anchor(bytes32 kind, bytes32 id, bytes data) external",
];
export const AUDIT_ABI = DEPLOYMENT.contracts.KrydoAudit?.abi ?? AUDIT_FALLBACK_ABI;

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
