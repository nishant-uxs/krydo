# Contributing to Krydo

Thanks for your interest in contributing. Krydo deals with cryptography and on-chain state, so we have a slightly higher bar than a typical CRUD app. This guide covers what that means in practice.

---

## Before you start

1. **Look for an existing issue** that matches what you want to change. If nothing matches, open a new one describing the problem + your proposed solution *before* writing code. This avoids surprise PRs that conflict with the direction of the project.
2. **Security bugs go to [`SECURITY.md`](./SECURITY.md), not a public issue.**
3. **Do not touch `server/crypto/*` without reading [`server/crypto/ec.ts`](./server/crypto/ec.ts), [`server/crypto/pedersen.ts`](./server/crypto/pedersen.ts), and [`server/crypto/sigma.ts`](./server/crypto/sigma.ts) in full first.** These files are load-bearing. Any change to them requires updated tests, a written threat-model justification in the PR description, and ideally an external review.

---

## Development setup

```bash
git clone https://github.com/nishant-uxs/krydo.git
cd krydo
npm install
cp .env.example .env           # fill in your values
npm run dev                    # http://localhost:5000
```

See [`README.md`](./README.md) for the full getting-started guide.

---

## The contract you're signing

Every PR must satisfy **all** of these before review:

| Gate                 | Command                 | Must return                                   |
|----------------------|-------------------------|-----------------------------------------------|
| TypeScript typecheck | `npm run check`         | exit 0, zero errors                           |
| Unit tests           | `npm test`              | all green, no skipped tests without comment   |
| New routes           | —                       | Zod-validated body / params / query          |
| New middlewares      | —                       | at least one unit test                        |
| New crypto           | —                       | at least honest-accept + tamper-reject tests  |
| Commit message       | —                       | Conventional Commits format (see below)       |

GitHub Actions re-runs typecheck + tests on every PR — it will reject anything that fails locally anyway.

---

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body explaining WHAT changed and WHY, not HOW.
Wrap at ~72 chars. Multiple paragraphs ok.
Link issues at the bottom if relevant.>

Closes #123
```

**Types we use:**

- `feat` — user-visible new capability
- `fix` — bug fix
- `refactor` — no behavior change, internal cleanup
- `docs` — README / comments only
- `test` — adding or fixing tests
- `chore` — tooling, lockfile, CI, build
- `ci` — GitHub Actions specifically
- `perf` — performance improvement with a measurement
- `security` — security-related change (use `fix` if it's a CVE-level bug reported privately)

**Scope** (optional but preferred) is the affected subsystem: `auth`, `zk`, `crypto`, `chain`, `routes`, `ui`, `tests`, `ci`, `deps`, etc.

**Good example:**

```
feat(zk): add non_zero proof type via range_above(1) reduction

Prove v >= 1 without revealing v, reusing the existing 32-bit range
proof machinery. Uses range_above with threshold=1 so we avoid adding a
new protocol type.

Tested in server/zk-engine.test.ts: accepts v >= 1, rejects v = 0,
accepts non-empty hashed strings.
```

**Bad example:**

```
updates
```

---

## Code style

- TypeScript strict mode. No `any` unless justified in a comment.
- **No new comments unless someone would be genuinely confused.** The code should be readable. Comments explain *why*, not *what*.
- Imports at the top of the file, always. No lazy `require()` in the middle of functions.
- Path aliases: `@shared/*` for `shared/`, `@/*` for `client/src/` (in client code only).
- Tailwind over inline styles. shadcn/ui over custom components when possible.
- Filenames: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.

---

## Testing philosophy

- **Unit tests live next to the code they test**, not in a parallel `__tests__` tree. `server/foo.ts` → `server/foo.test.ts`.
- Prefer many small tests over one big integration test. Read the failure name, know what broke.
- For new cryptographic functions, test **at minimum**:
  - Honest prover / honest verifier → accept.
  - Proof re-used against a different statement → reject.
  - Tampered proof (any field mutated) → reject.
  - Context / Fiat-Shamir binding (change context → reject).
- For new routes, test the happy path + one failure mode (400 or 401).

---

## Pull request checklist

Copy this into your PR description:

```markdown
- [ ] `npm run check` passes locally
- [ ] `npm test` passes locally
- [ ] New code has tests (unless purely docs / config)
- [ ] No new secrets / keys committed
- [ ] Commit messages follow Conventional Commits
- [ ] If touching `server/crypto/*` or `server/zk-engine.ts`, I've included a threat-model note
```

---

## Reviewing philosophy

- We optimize for **low total surface area** over clever code. A boring two-line fix beats a clever abstraction every time.
- Breaking changes to on-chain contracts require a migration note + version bump.
- "Why is this needed?" is always a fair review question — we'd rather say no to a good PR than ship code that doesn't belong.
- Nit comments are fine; please label them `nit:` so authors know they're not blocking.

---

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE), same as the rest of the project.
