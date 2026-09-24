# ADR 0001 — CI is Buildkite, not CircleCI

- **Status:** accepted
- **Date:** 2026-09-24
- **Decider:** design phase (galactic-unicorn-remote)
- **Source:** memo §7.1; stack-memo §5, §8; `.buildkite/pipeline.yml`; `.agents/.rules/git_guidelines.md`

## Context

The default development conventions name **CircleCI** as the sanctioned pipeline
(install → lint → format → test → build → deploy). This repo was generated with the `buildkite`
capability and already carries `.buildkite/pipeline.yml` with the pipeline and its GitHub webhook
created at generation time.

## Decision

CI is **Buildkite** on the self-hosted `mac-studio-linux` queue. Steps: `build` (npm ci → build →
lint → vitest), `docker_smoke` (build the image, run it, poll the **declared healthcheck**),
`docker_publish` (GHCR, `linux/amd64`, `main` only).

## Consequences

- **Positive:** runs on owned hardware instead of a metered cloud fleet; the pipeline and webhook
  exist from generation, so there is no manual "set up project" step; the image-smoke step is a real
  gate before publish.
- **Negative:** the pipeline is bespoke and must be maintained; the agent-side prerequisites
  (`DOPPLER_TOKEN` in the `environment` hook, `plugins-path` in `buildkite-agent.cfg`) are real setup
  obligations; the fleet is Apple silicon while the published image is `linux/amd64`, so the build
  step pins `platform: linux/arm64` deliberately.
- **Watch for:** on a regenerated repo the **webhook** is the first thing to check — without it a push
  triggers nothing at all (stack-memo §5). Also preserve the cancellation traps
  (`trap 'exit 143' TERM INT`) and the cleanup ordering, which fix a known host disk leak.
- **Follow-on:** GitGuardian is deliberately **not** selected — it still hard-depends on CircleCI and
  would drag it back in (implementation-considerations §7.9).
