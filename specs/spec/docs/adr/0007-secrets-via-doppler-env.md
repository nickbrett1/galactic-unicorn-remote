# ADR 0007 — secrets via Doppler and NAS environment values; the device token is never a committed default

- **Status:** accepted
- **Date:** 2026-09-24
- **Decider:** design phase (galactic-unicorn-remote)
- **Source:** memo §10; stack-memo §8; `doppler.yaml`; README; deploy/README.md

## Context

The repo is **public**. Two secrets matter:

1. **The GHCR publish token** (`GHCR_UPDATE_TOKEN`) — used only by CI.
2. **The device token** — the shared secret the board presents on `GET /device/poll`. It is *not* in
   the OTA pack (so it changes over USB on the board) and must not be a committed default anywhere,
   least of all in a public repo (memo §10).

The default conventions say: use Doppler if there is any secret, never commit `.env`, never log
secrets.

## Decision

- **CI secrets** (GHCR token) resolve **at run time from Doppler** `common`/`prd` via
  `$DOPPLER_TOKEN`. They are never stored in the repo and never in the agent's `environment` hook.
- **Runtime secrets for the container** (the device token) are **NAS environment values** — set on the
  host (Container Manager / `.env` next to the compose file), never committed. `.env.example` carries
  no real values.
- **Development secrets** come from Doppler `common`/`dev` (`doppler.yaml`).
- **Secrets are never logged**, and the device token is never echoed into a response.

## Rationale

- The publish step previously read credentials from the agent's `environment` hook, where **every job
  on the fleet could read them**, and every build of this repo failed because they were not set. The
  Doppler channel fixes both problems at once (stack-memo §8).
- The device token is **defence in depth, not a boundary** (memo §10) — but it is exactly the kind of
  value that must not be a committed default in a public repo.
- The **WiFi credentials never leave the board's `config_secrets.py`** and are out of scope for this
  repo entirely.

## Consequences

- **Operational dependency created:** the pipeline now **depends on `GHCR_UPDATE_TOKEN` existing in
  Doppler `common/prd`**. If it is missing, publish fails loudly with an explicit message rather than
  publishing anonymously.
- **A public repo yields a public package**, so the NAS/Watchtower pulls with no credentials; a
  *private* package would require `docker login` on the NAS (deploy/README.md §3).
- **Rotation:** the device token is changed on the board over USB (it is not in the pack) and mirrored
  in the NAS environment — the right cost for a secret (memo §6.1).
- **No GitGuardian capability.** It still hard-depends on CircleCI; secret hygiene is carried by
  Doppler + `.gitignore` + not committing defaults (implementation-considerations §7.9).
