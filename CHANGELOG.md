# Changelog

All notable changes to Krydo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a stable release ships. Until then, minor/major is informal.

---

## [Unreleased]

Nothing pending.

---

## [0.4.0] — 2026-04-18

Interop + UX upgrade. Three structural items that unblock production rollout.

### Added — multi-wallet

- **wagmi v2 + RainbowKit v2** wired into the client. Users can now connect with MetaMask, WalletConnect v2 (mobile + hardware wallets), Coinbase Wallet, Rainbow, Rabby, Brave, Frame, or any other EIP-1193-compatible wallet — not just the MetaMask browser extension.
- `client/src/lib/wagmi.ts` — connector registry. WalletConnect is gated behind `VITE_WALLETCONNECT_PROJECT_ID` so builds without a projectId still succeed (MetaMask / Coinbase / injected still work).
- `client/src/lib/eip1193-bridge.ts` — pluggable provider shim so `lib/contracts.ts` can keep its ethers-based function signatures unchanged. The active wagmi connector's provider is pushed in whenever it changes.
- `client/src/lib/wallet.tsx` — rewrote the `WalletProvider` internals on top of `useAccount`, `useSignMessage`, `useDisconnect`, and RainbowKit's `useConnectModal`. Public `useWallet()` API (address / role / connect / disconnect) is unchanged so no pages had to be rewritten.
- Removed the old "MetaMask Required" dialog from `client/src/pages/landing.tsx` — RainbowKit's modal covers the "no wallet installed" case (offers the WalletConnect QR fallback).
- Auto-triggers SIWE sign-in when wagmi reports a new connected address. On wallet-level disconnect, invalidates the Krydo JWT too.

### Added — W3C Verifiable Credentials Data Model v2

- `shared/vc.ts` — pure view-layer mapper that renders an internal Krydo `Credential` as a W3C VC v2 JSON-LD document. Maps `issuerAddress` → `issuer.id` as `did:ethr:sepolia:0x...`, `holderAddress` → `credentialSubject.id`, `claimType` → PascalCased type tag + nested subject key, `credentialHash` → a `KrydoOnChainAnchor2025` proof with CAIP-2 chain ID (`eip155:11155111`). Handles `validFrom` / `validUntil`, and computes a live `credentialStatus.status` of `active | revoked | expired | suspended` using the now-aware predicate.
- `GET /api/credentials/:id/vc` — public endpoint that returns the VC representation with `Content-Type: application/vc+ld+json`. Enables interop with Veramo, Ceramic, Walt.id, Microsoft Entra, Trinsic — anything that speaks W3C VC. Issuance paths stay gated behind `requireAuth + requireRole`; this is a read-only export.
- 22 Vitest cases in `shared/vc.test.ts` covering context ordering, type naming, DID derivation (lowercase), subject nesting, validFrom/validUntil, status resolution (active / revoked / expired / suspended), proof anchor shape, issuer name optionality, ISO-string date coercion, and JSON serializability.
- Zero storage-shape changes. Internal `Credential` schema and Firestore layout are identical.

### Added — Render one-click deploy

- `render.yaml` Blueprint: single `web` service that runs `npm ci && npm run build` / `npm start`, with `/healthz` as the liveness probe and `sync: false` markers on every secret so nothing is ever committed to git. Auto-generates `SESSION_SECRET` and `JWT_SECRET` on each environment.
- `.env.example` now documents `FIREBASE_SERVICE_ACCOUNT` (inline JSON) as the cloud-friendly alternative to `GOOGLE_APPLICATION_CREDENTIALS` (file path), and the new `VITE_WALLETCONNECT_PROJECT_ID` build-time variable.
- README gains a "Deploy to Render" section and a W3C VC export example.

### Changed

- Landing page + WalletButton copy: "Connect MetaMask" → "Connect Wallet". Same button, more honest label.
- Project layout tree in README updated to call out `lib/wagmi.ts`, `lib/eip1193-bridge.ts`, `shared/vc.ts`, and `render.yaml`.
- Tests bumped from 132 to **154** (+22 VC mapper cases).

---

## [0.3.0] — 2026-04-18

Feature wave. Semantic upgrades to make the proof/credential system behave like a real product, plus the operational endpoints needed to deploy and observe it.

### Added — semantic validation

- **Per-claim-type structured schemas** in `shared/claim-schemas.ts`. Known claim types (`income_verification`, `credit_score`, `age`, `kyc_verified`, `identity_verification`, `debt_ratio`, `asset_proof`) now validate with tight bounds — e.g. credit scores are bounded to `[300, 900]`, ages to `[0, 150]`, income to non-negative integers. Unknown claim types remain free-form (subject to the existing 32 KB bounded-JSON cap) so existing issuers don't break.
- 27 new Vitest cases covering each schema's happy path, boundary values, and rejection cases. Total test count: **132**.

### Added — ZK proof lifecycle

- **Proof TTL.** `POST /api/zk/generate` now accepts an optional `ttlDays` (default `30`, max `365`). Proof `expiresAt` is capped by the underlying credential's own expiry so a proof can never outlive its credential.
- **Revocation-aware verification.** `POST /api/zk/verify` now computes a composite verdict: `cryptographicallyValid` (the raw EC math) AND NOT (`proofExpired` OR `credentialRevoked` OR `credentialExpired` OR `issuerRevoked`). Response includes a `liveStatus` object so the UI can render *why* a proof was rejected even when the math checks out.
- **Shareable verification URL.** New public endpoint `GET /api/zk/share/:id` returns a pared-down, safe-to-share view of a proof (omits prover identity, omits cryptographic witness). Enables `verify?proofId=<id>` deep links without exposing the full proof blob.

### Added — operations

- **Health + readiness probes.** `GET /healthz` reports uptime/version (cheap, for load balancer pings). `GET /readyz` checks upstream dependencies (Firestore + Sepolia connectivity) and returns `503 Degraded` when any check fails. Both follow Kubernetes conventions.
- **Issuer analytics.** `GET /api/stats/issuer/:address` returns total issued, active, revoked, expired, expiring-soon counts, plus a `byClaimType` histogram for dashboard charts.

### Added — UX

- **Search + filter** on list endpoints:
  - `GET /api/credentials/:address?search=<text>&claimType=<type>` — filters by claim type or full-text match on claimType/claimSummary/credentialHash.
  - `GET /api/issuers?search=<text>&category=<cat>` — filters by category or full-text match on name/description/walletAddress.
  - Post-Firestore in-memory filter (safe while page sizes stay bounded via cursor pagination).

### Changed

- `ZkProof.expiresAt` is now populated on creation (was always `null`). Existing records without it behave as "never expires" to preserve backward compatibility.
- `/api/zk/verify` response shape: added `valid` (composite), `reason` (human-readable), `cryptographicallyValid`, `liveStatus`. Old callers reading `result.valid` still work — the field now reflects the full verdict.

---

## [0.2.0] — 2026-04-18

First pitch-ready release. Full hardening of the security / crypto / infra foundations.

### Added — security & cryptography

- **Real zero-knowledge proofs.** Replaced the previous hash-commitment placeholder (`SHA256(value ∥ salt)`) with sigma protocols on secp256k1: Pedersen commitments, Schnorr proof-of-knowledge, knowledge-of-opening, bit-decomposition range proofs, equality proofs, k-way OR membership proofs. All primitives live in `server/crypto/{ec,pedersen,sigma}.ts`. Fiat–Shamir for non-interactivity.
- **SIWE authentication.** EIP-4361 Sign-In With Ethereum flow (`server/auth/siwe.ts`) issues short-lived JWTs. Server no longer trusts `req.body.address` — every mutation is cryptographically tied to a `personal_sign` signature.
- **Role-based access control.** `requireAuth`, `requireRole(...)`, `requireSelf({ param | bodyKey })` middlewares gate every mutation.
- **Input hardening.** Zod schemas on every body / params / query (`server/validation/schemas.ts`).
- **Transport hardening.** Helmet CSP, CORS allowlist via `CORS_ORIGINS`, per-IP rate limits (stricter for sensitive ops).
- **Env validation at startup.** `server/config.ts` refuses to boot if `JWT_SECRET` / `SESSION_SECRET` are missing or < 32 bytes.

### Added — observability & quality

- **Structured logging.** `pino` with request IDs, redacted auth headers, ISO timestamps.
- **105 unit tests** (Vitest): EC primitives (14), Pedersen (12), sigma protocols (25), zk-engine end-to-end (22), JWT middleware (16), pagination middleware (10), + 6 crypto round-trip tests. All green in ~15s.
- **GitHub Actions CI.** Typecheck + full test suite on every push and PR to `main`. Concurrency group cancels superseded runs.

### Added — architecture & DX

- **Routes split by domain.** Monolithic `server/routes.ts` broken into `server/routes/{issuers,credentials,credential-requests,zk,stats,network}.ts`.
- **Cursor-based pagination.** Every list endpoint accepts `?limit=` + `?cursor=`, responds with `X-Next-Cursor` and `X-Page-Size` headers. Validated via Zod; hard cap at 200.
- **Single source of truth for contracts.** `shared/contracts.ts` exports addresses + ABIs once; server and client both import from there. No more drift risk.
- **`.env.example`** with full documentation of every required variable.
- **Community health files:** `SECURITY.md`, `CONTRIBUTING.md`, GitHub issue + PR templates.
- **Pitch-ready README** with Mermaid architecture + sequence diagrams, on-chain vs off-chain data matrix, sigma-vs-SNARK trade-off table, roadmap.

### Changed

- **Real Sepolia block numbers.** Every on-chain operation returns and persists the actual `blockNumber` from the transaction receipt instead of the previous mock `"0x0"`. Affects `KrydoAuthority`, `KrydoCredentials`, and all anchoring helpers (`anchorRoleAssignmentOnChain`, `anchorCredentialRequestOnChain`, `anchorCredentialRenewalOnChain`).
- **`ZkProof` protocol tag bumped** `krydo-zkp-v1` → `krydo-zkp-v2` to reflect the move from hash commitments to real EC commitments. Old proofs are not backward-compatible by design.

### Removed

- **`POST /api/wallet/connect`** deleted. Replaced by the SIWE nonce → verify flow. The old endpoint trusted any client-supplied address and is now `410 Gone`.
- **Server-side truncated ABIs** in `client/src/lib/contracts.ts`. Client imports from `shared/contracts.ts` instead.

### Security

- Rotated all local dev secrets to ≥ 48-byte random values (no real values in `.env.example`).
- `.env`, `*.firebase-adminsdk-*.json`, and `node_modules` all confirmed gitignored and never tracked.

---

## [0.1.0] — Baseline (pre-refactor)

Initial commit. Krydo on Firebase + Sepolia with MetaMask wallet connection. Hash-based "ZK" placeholder, unauthenticated write endpoints, no tests. Documented here only for historical reference — do not run this version.
