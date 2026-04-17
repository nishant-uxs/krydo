import { ethers } from "ethers";
import fs from "fs";
import path from "path";

let provider: ethers.JsonRpcProvider;
let wallet: ethers.Wallet;
let authorityContract: ethers.Contract;
let credentialsContract: ethers.Contract;
let deployment: any;

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

  const deploymentPath = path.resolve("contracts/deployment.json");
  if (!fs.existsSync(deploymentPath)) {
    console.warn("No deployment.json found. Running in off-chain mode.");
    return false;
  }

  deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const rpcUrl = alchemyKey.startsWith("http")
    ? alchemyKey
    : `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;

  provider = new ethers.JsonRpcProvider(rpcUrl);
  wallet = new ethers.Wallet(privateKey, provider);

  authorityContract = new ethers.Contract(
    deployment.contracts.KrydoAuthority.address,
    deployment.contracts.KrydoAuthority.abi,
    wallet
  );

  credentialsContract = new ethers.Contract(
    deployment.contracts.KrydoCredentials.address,
    deployment.contracts.KrydoCredentials.abi,
    wallet
  );

  const rootAddr = await authorityContract.rootAuthority();
  console.log(`Blockchain initialized. Root: ${rootAddr}`);
  console.log(`Authority contract: ${deployment.contracts.KrydoAuthority.address}`);
  console.log(`Credentials contract: ${deployment.contracts.KrydoCredentials.address}`);

  return true;
}

export async function addIssuerOnChain(issuerAddress: string, name: string): Promise<string> {
  if (!authorityContract) throw new Error("Blockchain not initialized");
  const tx = await authorityContract.addIssuer(issuerAddress, name);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function revokeIssuerOnChain(issuerAddress: string): Promise<string> {
  if (!authorityContract) throw new Error("Blockchain not initialized");
  const tx = await authorityContract.revokeIssuer(issuerAddress);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function issueCredentialOnChain(
  credentialHash: string,
  holderAddress: string,
  claimType: string,
  claimSummary: string
): Promise<string> {
  if (!credentialsContract) throw new Error("Blockchain not initialized");
  const hashBytes = ethers.zeroPadValue(credentialHash, 32);
  const tx = await credentialsContract.issueCredential(
    hashBytes,
    holderAddress,
    claimType,
    claimSummary
  );
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function revokeCredentialOnChain(credentialHash: string): Promise<string> {
  if (!credentialsContract) throw new Error("Blockchain not initialized");
  const hashBytes = ethers.zeroPadValue(credentialHash, 32);
  const tx = await credentialsContract.revokeCredential(hashBytes);
  const receipt = await tx.wait();
  return receipt.hash;
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

export async function anchorZkProofOnChain(
  proofCommitment: string,
  credentialHash: string,
  proofType: string,
  proverAddress: string
): Promise<string> {
  if (!wallet || !provider) throw new Error("Blockchain not initialized");

  const encoder = new ethers.AbiCoder();
  const data = encoder.encode(
    ["string", "bytes32", "bytes32", "string", "address"],
    [
      "KRYDO_ZK_PROOF_V1",
      ethers.zeroPadValue(proofCommitment, 32),
      ethers.zeroPadValue(credentialHash, 32),
      proofType,
      proverAddress,
    ]
  );

  const tx = await wallet.sendTransaction({
    to: wallet.address,
    data,
    value: 0,
  });
  const receipt = await tx.wait();
  return receipt!.hash;
}

export async function anchorRoleAssignmentOnChain(
  walletAddress: string,
  role: string,
  label: string
): Promise<string> {
  if (!wallet || !provider) throw new Error("Blockchain not initialized");

  const encoder = new ethers.AbiCoder();
  const data = encoder.encode(
    ["string", "address", "string", "string", "uint256"],
    [
      "KRYDO_ROLE_ASSIGN_V1",
      walletAddress,
      role,
      label,
      Math.floor(Date.now() / 1000),
    ]
  );

  const tx = await wallet.sendTransaction({
    to: wallet.address,
    data,
    value: 0,
  });
  const receipt = await tx.wait();
  return receipt!.hash;
}

export async function anchorCredentialRequestOnChain(
  requestId: string,
  requesterAddress: string,
  claimType: string,
  action: string
): Promise<string> {
  if (!wallet || !provider) throw new Error("Blockchain not initialized");

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
    ]
  );

  const tx = await wallet.sendTransaction({
    to: wallet.address,
    data,
    value: 0,
  });
  const receipt = await tx.wait();
  return receipt!.hash;
}

export async function anchorCredentialRenewalOnChain(
  credentialHash: string,
  holderAddress: string,
  newExpiresAt: number
): Promise<string> {
  if (!wallet || !provider) throw new Error("Blockchain not initialized");

  const encoder = new ethers.AbiCoder();
  const data = encoder.encode(
    ["string", "bytes32", "address", "uint256", "uint256"],
    [
      "KRYDO_CRED_RENEWAL_V1",
      ethers.zeroPadValue(credentialHash, 32),
      holderAddress,
      newExpiresAt,
      Math.floor(Date.now() / 1000),
    ]
  );

  const tx = await wallet.sendTransaction({
    to: wallet.address,
    data,
    value: 0,
  });
  const receipt = await tx.wait();
  return receipt!.hash;
}

export async function isIssuerOnChain(address: string): Promise<boolean> {
  if (!authorityContract) return false;
  return authorityContract.isIssuer(address);
}

export function isBlockchainReady(): boolean {
  return !!authorityContract && !!credentialsContract;
}
