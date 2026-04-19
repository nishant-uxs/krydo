import solc from "solc";
import fs from "fs";
import path from "path";

const contractsDir = path.resolve("contracts");
const outputDir = path.resolve("contracts/artifacts");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const authoritySource = fs.readFileSync(
  path.join(contractsDir, "KrydoAuthority.sol"),
  "utf8"
);
const credentialsSource = fs.readFileSync(
  path.join(contractsDir, "KrydoCredentials.sol"),
  "utf8"
);
const auditSource = fs.readFileSync(
  path.join(contractsDir, "KrydoAudit.sol"),
  "utf8"
);

const input = {
  language: "Solidity",
  sources: {
    "KrydoAuthority.sol": { content: authoritySource },
    "KrydoCredentials.sol": { content: credentialsSource },
    "KrydoAudit.sol": { content: auditSource },
  },
  settings: {
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
};

console.log("Compiling contracts...");
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const errors = output.errors.filter((e: any) => e.severity === "error");
  if (errors.length > 0) {
    console.error("Compilation errors:");
    errors.forEach((e: any) => console.error(e.formattedMessage));
    process.exit(1);
  }
  output.errors
    .filter((e: any) => e.severity === "warning")
    .forEach((e: any) => console.warn("Warning:", e.formattedMessage));
}

for (const contractFile of Object.keys(output.contracts)) {
  for (const contractName of Object.keys(output.contracts[contractFile])) {
    const contract = output.contracts[contractFile][contractName];
    const artifact = {
      contractName,
      abi: contract.abi,
      bytecode: "0x" + contract.evm.bytecode.object,
    };
    const outPath = path.join(outputDir, `${contractName}.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(`Compiled ${contractName} -> ${outPath}`);
  }
}

console.log("Compilation complete!");
