/**
 * One-off dev/test cleanup. Deletes credential requests that:
 *   - are in `pending` status
 *   - AND have no confirmed on-chain anchor (onChainTxHash missing/empty)
 *
 * Safe to run repeatedly: anything approved / rejected / issued or already
 * anchored is left alone so audit history is never clobbered.
 *
 * Usage:
 *   # delete every pending-unanchored request in the project
 *   npm run clean:pending-requests
 *
 *   # delete only a specific requester's pending-unanchored requests
 *   npm run clean:pending-requests -- 0xabc...def
 */
import "dotenv/config";
// Importing db initializes firebase-admin as a side-effect.
import { collections } from "../server/db";

async function main() {
  const filterAddress = process.argv[2]?.toLowerCase();
  const snap = await collections.credentialRequests.get();

  let matched = 0;
  let deleted = 0;
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const id = doc.id;
    const status = (data.status ?? "").toString();
    const anchored = !!data.onChainTxHash;
    const requester = (data.requesterAddress ?? "").toString().toLowerCase();

    if (filterAddress && requester !== filterAddress) continue;
    matched++;

    if (status !== "pending") {
      skipped.push({ id, reason: `status=${status}` });
      continue;
    }
    if (anchored) {
      skipped.push({ id, reason: `anchored:${data.onChainTxHash}` });
      continue;
    }

    await doc.ref.delete();
    deleted++;
    console.log(
      `deleted ${id} requester=${requester} claimType=${data.claimType}`,
    );
  }

  console.log("\n--- Summary ---");
  console.log(`Scanned:  ${snap.size}`);
  console.log(`Matched:  ${matched}${filterAddress ? ` (filter=${filterAddress})` : ""}`);
  console.log(`Deleted:  ${deleted}`);
  console.log(`Skipped:  ${skipped.length}`);
  for (const s of skipped.slice(0, 20)) {
    console.log(`  - ${s.id}  (${s.reason})`);
  }
  if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
