/**
 * Deploys the composite indexes declared in `firestore.indexes.json` to
 * Firestore using the Admin SDK service-account credentials we already
 * have — no `firebase login`, no Firebase CLI install, no browser OAuth.
 *
 * How it works:
 *   1. Load the service account from `GOOGLE_APPLICATION_CREDENTIALS`
 *      (file path) or `FIREBASE_SERVICE_ACCOUNT` (inline JSON), same
 *      path the server uses.
 *   2. Ask firebase-admin for an OAuth access token scoped to the
 *      service account's default scope (cloud-platform, which covers
 *      Firestore admin).
 *   3. POST each index spec to the Firestore Admin REST API. Index
 *      creation is a long-running op on Google's side — the call
 *      returns immediately with an operation name; the index builds
 *      asynchronously (usually <1 minute for small collections).
 *   4. Treat HTTP 409 / "already exists" as success — re-running the
 *      script is safe and idempotent.
 *
 * Usage:
 *   npm run deploy:indexes
 */

import "dotenv/config";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

interface IndexField {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
}

interface IndexSpec {
  collectionGroup: string;
  queryScope: "COLLECTION" | "COLLECTION_GROUP";
  fields: IndexField[];
}

interface IndexesFile {
  indexes: IndexSpec[];
}

function loadServiceAccount(): Record<string, any> {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineJson) {
    try {
      return JSON.parse(inlineJson);
    } catch (err) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${(err as Error).message}`,
      );
    }
  }

  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath) {
    throw new Error(
      "Set GOOGLE_APPLICATION_CREDENTIALS (file path) or FIREBASE_SERVICE_ACCOUNT (inline JSON) in your .env",
    );
  }
  const resolved = path.isAbsolute(credsPath)
    ? credsPath
    : path.resolve(process.cwd(), credsPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Service account file not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

async function createIndex(
  projectId: string,
  token: string,
  spec: IndexSpec,
): Promise<"submitted" | "already exists"> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${spec.collectionGroup}/indexes`;

  // Firestore implicitly tacks `__name__` onto every composite index with
  // the same direction as the last ordered field. Match that behaviour
  // explicitly so repeated runs don't create duplicates.
  const fields = [...spec.fields];
  const last = fields[fields.length - 1];
  const hasNameField = fields.some((f) => f.fieldPath === "__name__");
  if (!hasNameField && last.order) {
    fields.push({ fieldPath: "__name__", order: last.order });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ queryScope: spec.queryScope, fields }),
  });

  const text = await res.text();
  if (res.ok) return "submitted";

  // Firestore returns 409 Conflict OR a 400 with "already exists" text
  // depending on whether the index is identical. Both mean "idempotent no-op".
  if (
    res.status === 409 ||
    text.includes("already exists") ||
    text.includes("index already exists")
  ) {
    return "already exists";
  }

  throw new Error(`HTTP ${res.status}: ${text}`);
}

async function main(): Promise<void> {
  const sa = loadServiceAccount();
  const projectId = sa.project_id || sa.projectId;
  if (!projectId) {
    throw new Error("Service account JSON missing 'project_id' field");
  }

  const indexesPath = path.resolve(process.cwd(), "firestore.indexes.json");
  if (!fs.existsSync(indexesPath)) {
    throw new Error(`firestore.indexes.json not found at ${indexesPath}`);
  }
  const file: IndexesFile = JSON.parse(fs.readFileSync(indexesPath, "utf8"));

  console.log(
    `Deploying ${file.indexes.length} composite index(es) to project '${projectId}'...\n`,
  );

  // Obtain an OAuth access token from the service account. No need to
  // initializeApp() just for this — cert().getAccessToken() is enough.
  const credential = admin.credential.cert(sa as admin.ServiceAccount);
  const { access_token } = await credential.getAccessToken();

  let submitted = 0;
  let existing = 0;
  let failed = 0;

  for (let i = 0; i < file.indexes.length; i++) {
    const spec = file.indexes[i];
    const desc =
      `${spec.collectionGroup}(` +
      spec.fields
        .map((f) => `${f.fieldPath} ${f.order ?? f.arrayConfig}`)
        .join(", ") +
      ")";
    process.stdout.write(`  [${i + 1}/${file.indexes.length}] ${desc} ... `);
    try {
      const result = await createIndex(projectId, access_token, spec);
      console.log(result);
      if (result === "submitted") submitted++;
      else existing++;
    } catch (err: any) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(
    `\nDone. submitted=${submitted}, already-existed=${existing}, failed=${failed}`,
  );
  if (submitted > 0) {
    console.log(
      "\nIndexes build asynchronously. Small collections usually finish in <1 minute.",
    );
    console.log(
      `Monitor: https://console.firebase.google.com/project/${projectId}/firestore/indexes`,
    );
  }

  if (failed > 0) process.exit(1);
}

main().catch((err: any) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
