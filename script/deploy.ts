import { ethers } from "ethers";
import fs from "fs";
import path from "path";

async function main() {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!alchemyKey) {
    throw new Error("ALCHEMY_API_KEY not set");
  }
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY not set");
  }

  const rpcUrl = alchemyKey.startsWith("http")
    ? alchemyKey
    : `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Deployer address:", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    throw new Error("Deployer wallet has no ETH. Please fund it with Sepolia ETH from a faucet.");
  }

  const artifactsDir = path.resolve("contracts/artifacts");

  const authorityArtifact = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, "KrydoAuthority.json"), "utf8")
  );
  const credentialsArtifact = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, "KrydoCredentials.json"), "utf8")
  );

  console.log("\nDeploying KrydoAuthority...");
  const AuthorityFactory = new ethers.ContractFactory(
    authorityArtifact.abi,
    authorityArtifact.bytecode,
    wallet
  );
  const authority = await AuthorityFactory.deploy();
  await authority.waitForDeployment();
  const authorityAddress = await authority.getAddress();
  console.log("KrydoAuthority deployed at:", authorityAddress);

  console.log("\nDeploying KrydoCredentials...");
  const CredentialsFactory = new ethers.ContractFactory(
    credentialsArtifact.abi,
    credentialsArtifact.bytecode,
    wallet
  );
  const credentialsContract = await CredentialsFactory.deploy(authorityAddress);
  await credentialsContract.waitForDeployment();
  const credentialsAddress = await credentialsContract.getAddress();
  console.log("KrydoCredentials deployed at:", credentialsAddress);

  const rootAuthority = await (authority as any).rootAuthority();
  console.log("\nRoot Authority:", rootAuthority);

  const deployment = {
    network: "sepolia",
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      KrydoAuthority: {
        address: authorityAddress,
        abi: authorityArtifact.abi,
      },
      KrydoCredentials: {
        address: credentialsAddress,
        abi: credentialsArtifact.abi,
      },
    },
  };

  const deploymentPath = path.resolve("contracts/deployment.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("\nDeployment info saved to:", deploymentPath);

  console.log("\n--- Deployment Summary ---");
  console.log("Network: Sepolia");
  console.log("KrydoAuthority:", authorityAddress);
  console.log("KrydoCredentials:", credentialsAddress);
  console.log("Root Authority:", rootAuthority);
  console.log("Etherscan: https://sepolia.etherscan.io/address/" + authorityAddress);
  console.log("Etherscan: https://sepolia.etherscan.io/address/" + credentialsAddress);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
