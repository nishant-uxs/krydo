# Krydo — Privacy-Preserving Financial Trust Infrastructure

Krydo is a decentralized privacy-preserving financial trust system. Users can prove financial credibility without revealing sensitive financial data. The system uses a hierarchical trust model: **Root Authority → Issuers → Users → Verifiers**.

---

## Tech Stack

- **Frontend**: React + TypeScript, Vite, shadcn/ui components, wouter routing, TanStack Query
- **Backend**: Express.js REST API
- **Database**: Firebase Firestore (Admin SDK)
- **Blockchain**: Solidity smart contracts on Sepolia testnet via Alchemy RPC + ethers.js
- **Wallet**: MetaMask (`window.ethereum`)

---

## Getting Started

### Prerequisites

- Node.js 20+
- A Firebase project with Firestore enabled
- A Firebase Admin SDK service-account JSON (place in project root)
- An Alchemy API key for Sepolia
- A Sepolia wallet private key (funded with test ETH) for the root authority

### Setup

```bash
npm install
```

Create a `.env` file in the project root:

```env
# Firebase Admin SDK (path to service-account JSON)
GOOGLE_APPLICATION_CREDENTIALS=./your-service-account.json
FIREBASE_PROJECT_ID=your-project-id

# Ethereum / Sepolia
ALCHEMY_API_KEY=your-alchemy-key
DEPLOYER_PRIVATE_KEY=your-wallet-private-key

# Express
SESSION_SECRET=change-me-in-production
PORT=5000
```

### Run

```bash
# development
npm run dev

# production build
npm run build
npm start
```

The app is served at `http://localhost:5000`.

---

## Smart Contracts (Sepolia Testnet)

- **KrydoAuthority** at `0x0BE4fE934Ff4e9B24186C1cdd0cdFe0594209821` — Issuer registry (add / revoke issuers)
- **KrydoCredentials** at `0xEdb9EB8966053B5dc7C6ec17C65673D919Ea77Cb` — Credential issuance / revocation / verification
- **Root Authority**: `0x4Debe0136310df354CE1E8846799409d37f704cB` (deployer wallet)

Contract ABIs and addresses are stored in `contracts/deployment.json`.

---

## Trust Model

- **Root Authority** — First wallet connected. Manages issuers, full network visibility.
- **Issuers** — Approved by root. Can issue / revoke credentials.
- **Users** — Hold credentials. Identified by wallet address only.
- **Verifiers** — Public credential verification (no auth required).

---

## Key Design Decisions

- **Real MetaMask wallet connection** via `window.ethereum` (`eth_requestAccounts`). Users connect their actual Ethereum wallet.
- Flow: MetaMask popup → get real ETH address → role detection → register address + role on backend.
- Backend normalizes addresses to lowercase for consistency.
- Credential hashes stored both on-chain (Sepolia) and in Firestore.
- On-chain operations use the deployer wallet server-side.
- **Graceful degradation**: if blockchain unavailable, operations continue off-chain.
- Issuer add/revoke requires on-chain success before DB write. Credential issuance logs on-chain failure but still saves to DB.
- Listens for MetaMask `accountsChanged` events to handle account switching.

---

## Blockchain Integration (`server/blockchain.ts`)

- `initBlockchain()` — connects to Sepolia via Alchemy, loads contract ABIs.
- `addIssuerOnChain()` / `revokeIssuerOnChain()` — issuer registry operations.
- `issueCredentialOnChain()` / `revokeCredentialOnChain()` — credential operations.
- `verifyCredentialOnChain()` — cross-verification against on-chain state.
- `anchorRoleAssignmentOnChain()` — anchors wallet role assignments on Sepolia via self-transaction with ABI-encoded data (`KRYDO_ROLE_ASSIGN_V1` protocol tag).
- `anchorCredentialRequestOnChain()` — anchors credential request lifecycle (created / approved / rejected).
- `anchorCredentialRenewalOnChain()` — anchors credential renewals with new expiry timestamp.
- `isBlockchainReady()` — checks if contracts are connected.

**Protocol tags**: `KRYDO_ROLE_ASSIGN_V1`, `KRYDO_CRED_REQUEST_V1`, `KRYDO_CRED_RENEWAL_V1`, `KRYDO_ZK_PROOF_V1`.

---

## Zero-Knowledge Proof System (`server/zk-engine.ts`)

- Hash-commitment based ZK proof protocol (`krydo-zkp-v1`).
- **Proof types**: `range_above`, `range_below`, `equality`, `membership`, `non_zero`, `selective_disclosure`.
- Proof generation: `commitment = SHA256(value + salt)`, challenge-response with auxiliary data.
- Range proofs include bit-decomposition chains and boundary checks.
- Membership proofs use Merkle tree construction.
- Selective disclosure: per-field commitments; user picks which fields to reveal; hidden fields stay behind commitments.
- Verification validates response, witness, and boundary integrity without seeing the actual value.
- Proofs stored with public inputs (threshold, proof type, disclosed fields) but **never** the actual claim value.
- **On-chain anchoring**: ZK proof commitments are anchored on Sepolia. Transaction records created for each ZK proof generation.

---

## Credential Request System

- Users can request credentials from issuers by category (marketplace-style browsing).
- Issuers see incoming requests in their dashboard (Incoming Requests tab).
- **Approve & Issue flow**: Issuer fills in claim summary, value, and optional expiry. Backend atomically locks the request, creates the credential, issues on-chain, and updates request status to `issued`.
- **Reject flow**: Issuer can reject with a message.
- Request statuses: `pending`, `issuing` (lock), `issued`, `rejected`.
- Race-condition protection: `lockRequestForIssuing()` uses a Firestore transaction (conditional `status=pending→issuing`) to prevent duplicate issuance.

---

## Issuer Categories

`credit_bureau`, `income_verifier`, `identity_provider`, `asset_auditor`, `employment_verifier`, `tax_authority`, `insurance_provider`, `general`.

Shown as badges on issuer cards, filterable on the request page.

---

## Multi-Claim Credentials

- Credentials support multiple named fields via `claimData.fields` (e.g., `{ income: "85000", employer: "Acme" }`).
- Issuers can add arbitrary fields when issuing credentials.
- Field count badge shown on credential cards.
- Fields used for selective disclosure in ZK proofs.

---

## Credential Expiry & QR Codes

- Optional expiry date when issuing credentials (30d, 90d, 6mo, 1yr).
- Expiry status badges: `active`, `expiring soon` (≤30d), `expired`.
- QR code generation from credential hash using the `qrcode` library.

---

## Firestore Collections

- `wallets` — wallet addresses with roles (root / issuer / user). Doc id = lowercase address.
- `issuers` — approved issuer registry with category field.
- `credentials` — credential records with hashes, expiry, multi-field `claimData`.
- `credentialRequests` — user-to-issuer credential request workflow.
- `transactions` — blockchain transaction log (real tx hashes when on-chain).
- `zkProofs` — generated zero-knowledge proofs with commitments and public inputs.

---

## API Routes

- `GET  /api/network` — Blockchain connection status and contract addresses.
- `POST /api/wallet/connect` — Register / authenticate a wallet.
- `GET  /api/issuers` — List all issuers.
- `GET  /api/issuers/category/:category` — List issuers by category.
- `POST /api/issuers` — Add issuer (root only, on-chain).
- `POST /api/issuers/:id/revoke` — Revoke issuer (root only, on-chain).
- `GET  /api/credentials/:address` — Get credentials held by an address.
- `GET  /api/credentials/issued/:address` — Get credentials issued by an address.
- `POST /api/credentials` — Issue credential (issuers only, on-chain).
- `POST /api/credentials/:id/revoke` — Revoke credential (on-chain).
- `POST /api/credentials/:id/renew` — Renew credential expiry.
- `POST /api/verify` — Public credential verification (cross-checks on-chain).
- `GET  /api/stats/:address` — Dashboard statistics.
- `GET  /api/transactions/:address` — Transaction history.
- `GET  /api/transactions/recent/:address` — Recent transactions.
- `POST /api/credential-requests` — Create credential request (users).
- `GET  /api/credential-requests/user/:address` — Get user's requests.
- `GET  /api/credential-requests/issuer/:address` — Get issuer's incoming requests.
- `POST /api/credential-requests/:id/respond` — Approve / reject request (issuers).
- `POST /api/zk/generate` — Generate ZK proof (supports `selective_disclosure` with `selectedFields`).
- `POST /api/zk/verify` — Verify a ZK proof by ID (public).
- `GET  /api/zk/proofs/:address` — List ZK proofs generated by an address.

---

## Frontend Pages

- `/` — Landing page (unauthenticated).
- `/dashboard` — Role-adaptive dashboard with Sepolia network badge.
- `/issuers` — Issuer management with category selector (root only).
- `/issue` — Issue credentials with tabs (Issue / Incoming Requests / Issued), multi-field support, expiry picker (issuers only).
- `/credentials` — View held credentials with expiry badges, QR code sharing, multi-field indicators.
- `/request` — Request credentials from issuers by category (users only).
- `/verify` — Public credential + ZK proof verification with selective disclosure display (tabbed interface).
- `/zk-proofs` — ZK proof generation with selective disclosure field picker.
- `/transactions` — Transaction history.

---

## Theme

- **Fonts**: Inter (body), Space Grotesk (headings), JetBrains Mono (addresses / hashes).
- Dark mode with toggle.
- Design tokens via CSS variables in `index.css` + `tailwind.config.ts`.

---

## License

MIT
