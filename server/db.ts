import admin from "firebase-admin";
import fs from "fs";
import path from "path";

// Initialize Firebase Admin exactly once
if (!admin.apps.length) {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  let serviceAccount: admin.ServiceAccount | null = null;

  if (inlineJson) {
    try {
      serviceAccount = JSON.parse(inlineJson) as admin.ServiceAccount;
    } catch (err) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${(err as Error).message}`);
    }
  } else if (credsPath) {
    const resolved = path.isAbsolute(credsPath) ? credsPath : path.resolve(process.cwd(), credsPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Firebase credentials file not found at: ${resolved}`);
    }
    serviceAccount = JSON.parse(fs.readFileSync(resolved, "utf8")) as admin.ServiceAccount;
  } else {
    throw new Error(
      "Firebase credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS (path to JSON) or FIREBASE_SERVICE_ACCOUNT (JSON string) in your .env",
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || (serviceAccount as any).project_id,
  });

  console.log(`Firebase initialized. Project: ${process.env.FIREBASE_PROJECT_ID || (serviceAccount as any).project_id}`);
}

export const firestore = admin.firestore();
// Allow undefined values in writes (zk proof publicInputs can have undefined fields)
firestore.settings({ ignoreUndefinedProperties: true });

export const Timestamp = admin.firestore.Timestamp;
export const FieldValue = admin.firestore.FieldValue;

// Collection references used across storage layer
export const collections = {
  wallets: firestore.collection("wallets"),
  issuers: firestore.collection("issuers"),
  credentials: firestore.collection("credentials"),
  credentialRequests: firestore.collection("credentialRequests"),
  transactions: firestore.collection("transactions"),
  zkProofs: firestore.collection("zkProofs"),
};

// Alias for convenience
export const db = firestore;
