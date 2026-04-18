import "dotenv/config";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

function loadSa(): Record<string, any> {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) return JSON.parse(inline);
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS!;
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

async function main() {
  const sa = loadSa();
  const projectId = sa.project_id;
  const cred = admin.credential.cert(sa as admin.ServiceAccount);
  const { access_token } = await cred.getAccessToken();

  const groups = ["credentials", "credentialRequests", "zkProofs"];

  for (const cg of groups) {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${cg}/indexes`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const data = (await res.json()) as any;
    const indexes = data.indexes || [];
    console.log(`\n${cg}: ${indexes.length} index(es)`);
    for (const ix of indexes) {
      const fields = (ix.fields || [])
        .filter((f: any) => f.fieldPath !== "__name__")
        .map((f: any) => `${f.fieldPath} ${f.order ?? f.arrayConfig}`)
        .join(", ");
      console.log(`  [${ix.state}] ${fields}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
