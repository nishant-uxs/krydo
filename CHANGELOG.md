# Changelog

All notable changes to Krydo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a stable release ships. Until then, minor/major is informal.

---

## [Unreleased]

Nothing pending.

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
