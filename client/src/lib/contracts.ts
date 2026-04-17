import { ethers } from "ethers";

const AUTHORITY_ADDRESS = "0x0BE4fE934Ff4e9B24186C1cdd0cdFe0594209821";
const CREDENTIALS_ADDRESS = "0xEdb9EB8966053B5dc7C6ec17C65673D919Ea77Cb";
const SEPOLIA_CHAIN_ID = "0xaa36a7";

const AUTHORITY_ABI = [
  "function addIssuer(address _issuer, string _name) external",
  "function revokeIssuer(address _issuer) external",
  "function isIssuer(address _addr) view returns (bool)",
  "function rootAuthority() view returns (address)",
];

const CREDENTIALS_ABI = [
  "function issueCredential(bytes32 _hash, address _holder, string _claimType, string _claimSummary) external",
  "function revokeCredential(bytes32 _hash) external",
  "function verifyCredential(bytes32 _hash) view returns (bool valid, address issuer, address holder, string claimType, string claimSummary, uint256 issuedAt, bool issuerActive)",
];

async function ensureSepoliaNetwork(): Promise<void> {
  if (!window.ethereum) throw new Error("MetaMask not found");

  const currentChainId = await window.ethereum.request({ method: "eth_chainId" });
  if (currentChainId === SEPOLIA_CHAIN_ID) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
    });
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: SEPOLIA_CHAIN_ID,
          chainName: "Sepolia Testnet",
          nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.sepolia.org"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        }],
      });
    } else {
      throw switchError;
    }
  }
}

function getProvider(): ethers.BrowserProvider {
  if (!window.ethereum) throw new Error("MetaMask not found");
  return new ethers.BrowserProvider(window.ethereum);
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
