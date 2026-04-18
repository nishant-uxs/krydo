# Security Policy

Krydo is an MVP running on Ethereum Sepolia testnet. The cryptographic core has been carefully implemented on top of audited primitives (`@noble/curves`, `@noble/hashes`) but the composition itself has **not been externally audited**. Please treat this as a research / pre-production codebase until further notice.

---

## Supported versions

Only the latest commit on `main` is supported. There are no LTS branches yet — Krydo is pre-1.0.

| Version | Supported          |
|---------|--------------------|
| `main`  | ✅ Yes             |
| Older commits | ❌ No        |

---

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.**

If you discover a vulnerability in Krydo — cryptographic flaw, authentication bypass, injection vector, on-chain logic issue, anything that could be exploited — please report it privately:

- **Email:** (add a real contact address before making this repo public)
- **GitHub Security Advisory:** https://github.com/nishant-uxs/krydo/security/advisories/new (preferred — gets triaged faster)

Please include:

1. A clear description of the vulnerability and its impact.
2. Steps to reproduce (proof-of-concept code is welcome).
3. Any suggested mitigation, if you have one.
4. Whether you'd like public credit in the fix commit / release notes.

### Expected timeline

| Stage                             | Target      |
|-----------------------------------|-------------|
| Acknowledgement of report         | 48 hours    |
| Initial severity assessment       | 7 days      |
| Patch available (high severity)   | 14 days     |
| Patch available (medium severity) | 30 days     |
| Public disclosure (coordinated)   | 90 days max |

---

## In scope

- Cryptographic correctness of `server/crypto/*` (EC math, Pedersen commitments, sigma protocols).
- Zero-knowledge proof generation / verification in `server/zk-engine.ts`.
- Authentication and authorization flow (SIWE + JWT).
- On-chain contract logic in `contracts/*.sol`.
- Server-side input validation / injection / SSRF.
- Client-side XSS / CSRF.
- Supply-chain risks in direct dependencies.

## Out of scope

- Denial-of-service attacks against the public demo (if/when one exists).
- Issues in `@noble/curves`, `@noble/hashes`, `ethers`, `express`, or other upstream libraries — please report to the upstream project directly.
- Self-XSS requiring the attacker to have console access on their own machine.
- Outdated deployment environments not matching the `main` branch.
- Social engineering attacks.
- Findings that require physical access to a user's device.

---

## Known limitations (not bugs — documented trade-offs)

These are public design choices, not vulnerabilities:

- **Credentials plaintext lives in Firestore**, not on-chain. Losing Firestore makes commitments un-openable. Mitigation: migrate to IPFS/Arweave with user-held keys (planned).
- **Single-key root authority.** The deployer wallet is the root. Compromise = total compromise. Mitigation: migrate to a Safe multi-sig (planned).
- **Off-chain ZK verifier.** Proofs are verified by our backend, not by a Solidity contract. A malicious backend could return false positives. Mitigation: ship an on-chain Groth16/PLONK verifier (planned).
- **No W3C Verifiable Credentials conformance** yet. Interop with DID ecosystems is deliberately deferred.

---

## Responsible disclosure philosophy

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). Reporters who give us a reasonable window to patch before public disclosure will always be credited (unless they request anonymity). Public naming-and-shaming without prior private contact will not be celebrated.

Thank you for helping keep Krydo safe.
