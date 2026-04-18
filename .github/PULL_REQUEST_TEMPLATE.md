<!--
Thanks for contributing to Krydo! Please fill out this template so reviewers
can understand your change quickly. Delete sections that don't apply.
-->

## What & Why

<!-- One or two sentences. What does this PR change, and why is that change needed?
Link to the issue this closes, e.g. "Closes #42". -->

## How

<!-- Brief technical explanation. What are the key decisions? If you considered
alternatives, mention them. For crypto or on-chain changes, spell out the
threat model. -->

## Type of change

- [ ] Bug fix (`fix`)
- [ ] New feature (`feat`)
- [ ] Refactor (no behavior change) (`refactor`)
- [ ] Docs only (`docs`)
- [ ] Tooling / CI (`chore` / `ci`)
- [ ] Breaking change (bumps API or contract interface)

## Checklist

- [ ] `npm run check` passes locally
- [ ] `npm test` passes locally
- [ ] New or changed code has tests (unless purely docs / config)
- [ ] No new secrets, keys, or service-account JSONs committed
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] If touching `server/crypto/*` or `server/zk-engine.ts`, I've included a short threat-model note above
- [ ] If touching `contracts/*.sol`, I've bumped the protocol version tag and noted the migration path

## Screenshots / output

<!-- Optional: UI screenshots, test-run output, gas-diff screenshots. -->
