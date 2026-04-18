import { ethers } from "ethers";
import {
  AUTHORITY_ADDRESS,
  CREDENTIALS_ADDRESS,
  AUTHORITY_ABI,
  CREDENTIALS_ABI,
  SEPOLIA_CHAIN_ID_HEX,
  SEPOLIA_NETWORK_CONFIG,
} from "@shared/contracts";
import { getActiveProvider } from "./eip1193-bridge";

async function ensureSepoliaNetwork(): Promise<void> {
  const eip = getActiveProvider();
  const currentChainId = await eip.request({ method: "eth_chainId" });
  if (currentChainId === SEPOLIA_CHAIN_ID_HEX) return;

  try {
    await eip.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch (switchError: any) {
    // 4902 = chain not added yet. Only applies to wallets that keep a local
    // chain list (MetaMask, Rabby, Brave). For WalletConnect/Coinbase the
    // chain comes in via dApp metadata and this branch is never hit.
    if (switchError.code === 4902) {
      await eip.request({
        method: "wallet_addEthereumChain",
        params: [SEPOLIA_NETWORK_CONFIG],
      });
    } else {
      throw switchError;
    }
  }
}

function getProvider(): ethers.BrowserProvider {
  // `any` is unavoidable: ethers wants BrowserProvider constructor args that
  // are wider than our EIP-1193 shape. At runtime every wagmi connector's
  // provider satisfies it.
  return new ethers.BrowserProvider(getActiveProvider() as any);
}

async function getSigner(): Promise<ethers.JsonRpcSigner> {
  await ensureSepoliaNetwork();
  const provider = getProvider();
  return provider.getSigner();
}

export async function checkIsIssuerOnChain(issuerAddress: string): Promise<boolean> {
  await ensureSepoliaNetwork();
  const provider = getProvider();
  const contract = new ethers.Contract(AUTHORITY_ADDRESS, AUTHORITY_ABI, provider);
  return contract.isIssuer(issuerAddress);
}

export async function addIssuerViaMetaMask(
  issuerAddress: string,
  name: string
): Promise<{ txHash: string; blockNumber: number }> {
  const signer = await getSigner();
  const contract = new ethers.Contract(AUTHORITY_ADDRESS, AUTHORITY_ABI, signer);

  const alreadyActive = await contract.isIssuer(issuerAddress);
  if (alreadyActive) {
    const revokeTx = await contract.revokeIssuer(issuerAddress);
    await revokeTx.wait();
  }

  const tx = await contract.addIssuer(issuerAddress, name);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function revokeIssuerViaMetaMask(
  issuerAddress: string
): Promise<{ txHash: string; blockNumber: number }> {
  const signer = await getSigner();
  const contract = new ethers.Contract(AUTHORITY_ADDRESS, AUTHORITY_ABI, signer);
  const tx = await contract.revokeIssuer(issuerAddress);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function issueCredentialViaMetaMask(
  credentialHash: string,
  holderAddress: string,
  claimType: string,
  claimSummary: string
): Promise<{ txHash: string; blockNumber: number }> {
  const signer = await getSigner();
  const contract = new ethers.Contract(CREDENTIALS_ADDRESS, CREDENTIALS_ABI, signer);
  const hashBytes = ethers.zeroPadValue(credentialHash, 32);
  const tx = await contract.issueCredential(hashBytes, holderAddress, claimType, claimSummary);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function revokeCredentialViaMetaMask(
  credentialHash: string
): Promise<{ txHash: string; blockNumber: number }> {
  const signer = await getSigner();
  const contract = new ethers.Contract(CREDENTIALS_ADDRESS, CREDENTIALS_ABI, signer);
  const hashBytes = ethers.zeroPadValue(credentialHash, 32);
  const tx = await contract.revokeCredential(hashBytes);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function anchorZkProofViaMetaMask(
  proofCommitment: string,
  credentialHash: string,
  proofType: string,
  proverAddress: string
): Promise<{ txHash: string; blockNumber: number }> {
  const signer = await getSigner();
  const encoder = ethers.AbiCoder.defaultAbiCoder();
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

  const signerAddress = await signer.getAddress();
  const tx = await signer.sendTransaction({
    to: signerAddress,
    data,
    value: 0,
  });
  const receipt = await tx.wait();
  return { txHash: receipt!.hash, blockNumber: receipt!.blockNumber };
}

export async function anchorRoleViaMetaMask(
  walletAddress: string,
  role: string,
  label: string
): Promise<{ txHash: string; blockNumber: number }> {
  await ensureSepoliaNetwork();
  const provider = getProvider();
  const signer = await provider.getSigner();

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

  const tx = await signer.sendTransaction({
    to: await signer.getAddress(),
    data,
    value: 0,
  });
  const receipt = await tx.wait();
  return { txHash: receipt!.hash, blockNumber: receipt!.blockNumber };
}

export async function anchorCredentialRequestViaMetaMask(
  requestId: string,
  requesterAddress: string,
  claimType: string,
  action: string
): Promise<{ txHash: string; blockNumber: number }> {
  await ensureSepoliaNetwork();
  const provider = getProvider();
  const signer = await provider.getSigner();

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

  const tx = await signer.sendTransaction({
    to: await signer.getAddress(),
    data,
    value: 0,
  });
  const receipt = await tx.wait();
  return { txHash: receipt!.hash, blockNumber: receipt!.blockNumber };
}

export async function verifyCredentialOnChainView(
  credentialHash: string
): Promise<{ valid: boolean; issuer: string; holder: string; claimType: string; issuerActive: boolean }> {
  await ensureSepoliaNetwork();
  const provider = getProvider();
  const contract = new ethers.Contract(CREDENTIALS_ADDRESS, CREDENTIALS_ABI, provider);
  const hashBytes = ethers.zeroPadValue(credentialHash, 32);
  const result = await contract.verifyCredential(hashBytes);
  return {
    valid: result[0],
    issuer: result[1],
    holder: result[2],
    claimType: result[3],
    issuerActive: result[6],
  };
}
