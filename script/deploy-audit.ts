// Load .env first so ALCHEMY_API_KEY / DEPLOYER_PRIVATE_KEY are available when
// read below. Side-effect import; must stay above any env-reading code.
import "dotenv/config";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";

/**
 * Incremental deployer for KrydoAudit. Reads the existing
 * `contracts/deployment.json` produced by `deploy.ts`, deploys only the new
 * audit contract, and merges the address + ABI back into the same file so
 * server and client pick it up via `@shared/contracts`.
 *
 * Run after `npm run compile:contracts`:
 *   npm run deploy:audit
 */
async function main() {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!alchemyKey) throw new Error("ALCHEMY_API_KEY not set");
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY not set");

  const rpcUrl = alchemyKey.startsWith("http")
    ? alchemyKey
    : `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Deployer address:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  if (balance === 0n) {
    throw new Error("Deployer wallet has no ETH. Fund it with Sepolia ETH.");
  }

  const artifactsDir = path.resolve("contracts/artifacts");
  const auditArtifact = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, "KrydoAudit.json"), "utf8")
  );

  console.log("\nDeploying KrydoAudit...");
  const AuditFactory = new ethers.ContractFactory(
    auditArtifact.abi,
    auditArtifact.bytecode,
    wallet
  );
  const auditContract = await AuditFactory.deploy();
  await auditContract.waitForDeployment();
  const auditAddress = await auditContract.getAddress();
  console.log("KrydoAudit deployed at:", auditAddress);

  const deploymentPath = path.resolve("contracts/deployment.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      "contracts/deployment.json not found. Run `npm run deploy:contracts` first to deploy the base contracts.",
    );
  }
  const existing = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  existing.contracts = existing.contracts || {};
  existing.contracts.KrydoAudit = {
    address: auditAddress,
    abi: auditArtifact.abi,
  };
  existing.deployedAt = new Date().toISOString();

  fs.writeFileSync(deploymentPath, JSON.stringify(existing, null, 2));
  console.log("\nUpdated deployment info saved to:", deploymentPath);

  console.log("\n--- Deployment Summary ---");
  console.log("KrydoAudit:", auditAddress);
  console.log("Etherscan: https://sepolia.etherscan.io/address/" + auditAddress);
}

main().catch((err) => {
  console.error("Audit deployment failed:", err);
  process.exit(1);
});
