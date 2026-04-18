/**
 * One-off repair: re-anchors any credential whose Firestore row exists but
 * is NOT on-chain on Sepolia. Used to clean up records from the pre-fix era
 * when the client's PATCH /api/credentials/:id/tx swallowed errors silently
 * and left the DB pointing at fake placeholder tx hashes.
 *
 * Iterates all credentials, skips those already confirmed via
 * verifyCredentialOnChain, and for the rest calls the server's
 * issueCredentialOnChain (signed by the root wallet) and updates the
 * matching transaction row with the real hash + block number.
 *
 * Requires: ALCHEMY_API_KEY, DEPLOYER_PRIVATE_KEY, Firebase credentials.
 *
 * Usage:
 *   npx tsx script/reanchor-creds.ts                # dry run, show what would happen
 *   npx tsx script/reanchor-creds.ts --apply        # actually submit anchor txs
 */

import "dotenv/config";
import { storage } from "../server/storage";
import {
  initBlockchain,
  isBlockchainReady,
  issueCredentialOnChain,
  verifyCredentialOnChain,
} from "../server/blockchain";

async function main() {
  const apply = process.argv.includes("--apply");
  await initBlockchain();
  if (!isBlockchainReady()) {
    console.error("Blockchain keys not configured in .env — aborting.");
    process.exit(1);
  }

  const all = await storage.getAllCredentials();
  console.log(`Found ${all.length} credential(s).\n`);

  let confirmed = 0;
  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  for (const cred of all) {
    process.stdout.write(`- ${cred.id} (${cred.claimType}) ... `);
    try {
      const onChain = await verifyCredentialOnChain(cred.credentialHash);
      if (
        onChain.valid &&
        onChain.holder.toLowerCase() === cred.holderAddress.toLowerCase()
      ) {
        console.log("already on-chain, skip");
        confirmed++;
        continue;
      }

      if (!apply) {
        console.log("NEEDS RE-ANCHOR (dry run)");
        skipped++;
        continue;
      }

      const { txHash, blockNumber } = await issueCredentialOnChain(
        cred.credentialHash,
        cred.holderAddress,
        cred.claimType,
        cred.claimSummary,
      );
      console.log(`re-anchored tx=${txHash} block=${blockNumber}`);

      // Update the matching credential_issued transaction row with the real hash.
      const txs = await storage.getTransactions(cred.issuerAddress);
      const credTx = txs.find(
        (t) => t.data && (t.data as any).credentialId === cred.id,
      );
      if (credTx) {
        await storage.updateTransactionOnChain(credTx.id, txHash, blockNumber);
      }
      repaired++;
    } catch (err: any) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(
    `\nSummary: confirmed=${confirmed}, repaired=${repaired}, needs-repair=${skipped}, failed=${failed}`,
  );
  if (!apply && skipped > 0) {
    console.log("\nRe-run with --apply to actually submit the repair txs.");
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
