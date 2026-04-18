import { ethers } from "ethers";
import {
  DEPLOYMENT,
  AUTHORITY_ADDRESS,
  CREDENTIALS_ADDRESS,
  AUTHORITY_ABI,
  CREDENTIALS_ABI,
  type DeploymentInfo,
} from "@shared/contracts";

/**
 * Thin wrapper around the Sepolia RPC. Every on-chain operation returns both
 * the transaction hash AND the real block number from the mined receipt so the
 * storage layer never has to fabricate placeholder values.
 *
 * Contract addresses + ABIs come from `@shared/contracts`, which is itself
 * generated from `contracts/deployment.json` at build/startup time. The same
 * constants are consumed by the React client so server and browser can never
 * drift apart on which contract they're talking to.
 */

export interface OnChainResult {
  txHash: string;
  blockNumber: string;
}

let provider: ethers.JsonRpcProvider;
let wallet: ethers.Wallet;
let authorityContract: ethers.Contract;
let credentialsContract: ethers.Contract;
let deployment: DeploymentInfo | undefined;

export function getProvider() {
  return provider;
}

export function getWallet() {
  return wallet;
}

export function getAuthorityContract() {
  return authorityContract;
}

export function getCredentialsContract() {
  return credentialsContract;
}

export function getDeployment() {
  return deployment;
}

export async function initBlockchain() {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!alchemyKey || !privateKey) {
    console.warn("Blockchain keys not configured. Running in off-chain mode.");
    return false;
  }

  if (!AUTHORITY_ADDRESS || !CREDENTIALS_ADDRESS) {
    console.warn("Shared deployment metadata is missing contract addresses. Off-chain mode.");
    return false;
  }

  deployment = DEPLOYMENT;

  const rpcUrl = alchemyKey.startsWith("http")
    ? alchemyKey
    : `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;

  provider = new ethers.JsonRpcProvider(rpcUrl);
  wallet = new ethers.Wallet(privateKey, provider);

  authorityContract = new ethers.Contract(AUTHORITY_ADDRESS, AUTHORITY_ABI, wallet);
  credentialsContract = new ethers.Contract(CREDENTIALS_ADDRESS, CREDENTIALS_ABI, wallet);

  console.log(`Blockchain initialized. Root: ${wallet.address}`);
  console.log(`Authority contract: ${AUTHORITY_ADDRESS}`);
  console.log(`Credentials contract: ${CREDENTIALS_ADDRESS}`);
  return true;
}

function resultOf(receipt: ethers.TransactionReceipt | null | undefined): OnChainResult {
  if (!receipt) throw new Error("tx receipt missing");
  return {
    txHash: receipt.hash,
    blockNumber: String(receipt.blockNumber),
  };
}

export async function addIssuerOnChain(address: string, name: string): Promise<OnChainResult> {
  if (!authorityContract) throw new Error("Blockchain not initialized");
  const tx = await authorityContract.addIssuer(address, name);
  return resultOf(await tx.wait());
}

export async function revokeIssuerOnChain(address: string): Promise<OnChainResult> {
  if (!authorityContract) throw new Error("Blockchain not initialized");
  const tx = await authorityContract.revokeIssuer(address);
  return resultOf(await tx.wait());
}

export async function issueCredentialOnChain(
  credentialHash: string,
  holderAddress: string,
  claimType: string,
  claimSummary: string,
): Promise<OnChainResult> {
  if (!credentialsContract) throw new Error("Blockchain not initialized");
  const hashBytes = ethers.zeroPadValue(credentialHash, 32);
  const tx = await credentialsContract.issueCredential(
    hashBytes,
    holderAddress,
    claimType,
    claimSummary,
  );
  return resultOf(await tx.wait());
}

export async function revokeCredentialOnChain(credentialHash: string): Promise<OnChainResult> {
  if (!credentialsContract) throw new Error("Blockchain not initialized");
  const hashBytes = ethers.zeroPadValue(credentialHash, 32);
  const tx = await credentialsContract.revokeCredential(hashBytes);
  return resultOf(await tx.wait());
}

export async function verifyCredentialOnChain(credentialHash: string) {
  if (!credentialsContract) throw new Error("Blockchain not initialized");
  const hashBytes = ethers.zeroPadValue(credentialHash, 32);
  const result = await credentialsContract.verifyCredential(hashBytes);
  return {
    valid: result[0],
    issuer: result[1],
    holder: result[2],
    claimType: result[3],
    claimSummary: result[4],
    issuedAt: Number(result[5]),
    issuerActive: result[6],
  };
}

/**
 * Fetch the receipt for a client-submitted tx hash. Used by the PATCH
 * /api/credentials/:id/tx flow: the user's MetaMask broadcasts the issuance
 * tx and reports the hash to us, but we can't trust that blindly — if the
 * tx was sent to the wrong chain, reverted, or dropped from the mempool, we
 * must not record it as a confirmed anchor.
 *
 * Returns:
 *   { status: "confirmed", blockNumber } — tx is on-chain AND succeeded
 *   { status: "reverted", blockNumber }  — tx is on-chain but reverted
 *   { status: "pending" }                 — tx is known to the node but not mined
 *   { status: "unknown" }                 — RPC has never seen this hash
 *
 * Callers should only treat "confirmed" as a valid on-chain anchor.
 */
export async function waitForClientTx(
  txHash: string,
  opts: { timeoutMs?: number; confirmations?: number } = {},
): Promise<
  | { status: "confirmed"; blockNumber: string }
  | { status: "reverted"; blockNumber: string }
  | { status: "pending" }
  | { status: "unknown" }
> {
  if (!provider) throw new Error("Blockchain not initialized");
  const { timeoutMs = 60_000, confirmations = 1 } = opts;

  const tx = await provider.getTransaction(txHash);
  if (!tx) return { status: "unknown" };

  // Already mined — fetch receipt directly.
  if (tx.blockNumber) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return { status: "pending" };
    return {
      status: receipt.status === 1 ? "confirmed" : "reverted",
      blockNumber: String(receipt.blockNumber),
    };
  }

  // Still pending — wait up to timeoutMs for confirmation.
  try {
    const receipt = await provider.waitForTransaction(
      txHash,
      confirmations,
      timeoutMs,
    );
    if (!receipt) return { status: "pending" };
    return {
      status: receipt.status === 1 ? "confirmed" : "reverted",
      blockNumber: String(receipt.blockNumber),
    };
  } catch {
    // ethers throws on timeout — surface as pending so caller can retry later.
    return { status: "pending" };
  }
}

async function sendAnchor(data: string): Promise<OnChainResult> {
  if (!wallet || !provider) throw new Error("Blockchain not initialized");
  const tx = await wallet.sendTransaction({
    to: wallet.address,
    data,
    value: 0,
  });
  return resultOf(await tx.wait());
}

export async function anchorZkProofOnChain(
  proofCommitment: string,
  credentialHash: string,
  proofType: string,
  proverAddress: string,
): Promise<OnChainResult> {
  const encoder = new ethers.AbiCoder();
  // proofCommitment is a secp256k1 compressed point (33 bytes / 66 hex) — encode as bytes.
  const commitmentBytes = proofCommitment.startsWith("0x")
    ? proofCommitment
    : "0x" + proofCommitment;
  const data = encoder.encode(
    ["string", "bytes", "bytes32", "string", "address"],
    [
      "KRYDO_ZK_PROOF_V2",
      commitmentBytes,
      ethers.zeroPadValue(credentialHash, 32),
      proofType,
      proverAddress,
    ],
  );
  return sendAnchor(data);
}

export async function anchorRoleAssignmentOnChain(
  walletAddress: string,
  role: string,
  label: string,
): Promise<OnChainResult> {
  const encoder = new ethers.AbiCoder();
  const data = encoder.encode(
    ["string", "address", "string", "string", "uint256"],
    [
      "KRYDO_ROLE_ASSIGN_V1",
      walletAddress,
      role,
      label,
      Math.floor(Date.now() / 1000),
    ],
  );
  return sendAnchor(data);
}

export async function anchorCredentialRequestOnChain(
  requestId: string,
  requesterAddress: string,
  claimType: string,
  action: string,
): Promise<OnChainResult> {
  const encoder = new ethers.AbiCoder();
  const data = encoder.encode(
    ["string", "string", "address", "string", "string", "uint256"],
    [
      "KRYDO_CRED_REQUEST_V1",
      requestId,
      requesterAddress,
      claimType,
      action,
      Math.floor(Date.now() / 1000),
    ],
  );
  return sendAnchor(data);
}

export async function anchorCredentialRenewalOnChain(
  credentialHash: string,
  holderAddress: string,
  newExpiresAt: number,
): Promise<OnChainResult> {
  const encoder = new ethers.AbiCoder();
  const data = encoder.encode(
    ["string", "bytes32", "address", "uint256", "uint256"],
    [
      "KRYDO_CRED_RENEWAL_V1",
      ethers.zeroPadValue(credentialHash, 32),
      holderAddress,
      newExpiresAt,
      Math.floor(Date.now() / 1000),
    ],
  );
  return sendAnchor(data);
}

export async function isIssuerOnChain(address: string): Promise<boolean> {
  if (!authorityContract) return false;
  return authorityContract.isIssuer(address);
}

export function isBlockchainReady(): boolean {
  return !!authorityContract && !!credentialsContract;
}
