# ADR 0004 — deployments are CI-only

- **Status:** accepted
- **Date:** 2026-09-24
- **Decider:** design phase (galactic-unicorn-remote)
- **Source:** `.agents/.rules/git_guidelines.md`; deploy/README.md; stack-memo §5

## Context

The generated repository carries a deployment runbook (Buildkite → GHCR → Watchtower → Docker host)
and a `.agents/.rules/git_guidelines.md` rule stating that no one may run a deployment command
(`wrangler deploy`, `npm run deploy`, or any other) to push code to the production/default
environment.

## Decision

**All deployments happen through CI.** The only path to the NAS is: push to `main` → Buildkite
`docker_publish` → GHCR `:latest` → Watchtower recreates the container. No plan step, agent or human
workflow may run a deploy command.

## Rationale

- The pipeline runs the quality gates (lint, vitest + coverage thresholds, image smoke) before the
  image is published, so an unverified build cannot reach the host.
- Credentials resolve at run time from Doppler and never land in the repo or an agent environment
  hook, so a manual deploy would additionally need its own credential channel.
- Rollback is a **configuration** action (pin the SHA tag in `docker-compose.yml`), not a deploy
  command — so the "no manual deploy" rule does not remove the escape hatch.

## Consequences

- **Positive:** one auditable release path; gates enforced; no drift between what CI verified and what
  runs on the NAS.
- **Negative:** a fix cannot be hot-pushed to the container; it must go through a commit + build. The
  SHA-tag pin is the only mitigation and it is a deliberate manual action.
- **Note:** Watchtower recreates on **every** push to `main`, including a broken build that passed
  its gates — hence the rollback instruction in `deploy/README.md` §4.
