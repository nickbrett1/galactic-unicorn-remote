# Deployment targets

Infrastructure mapping for the phase-2 remote-triggering system. Sources: memo §7, §8, §13;
stack-memo §2, §4, §5, §6.

## 1. Target inventory

| # | Target | What runs there | Change class | Owner |
|---|---|---|---|---|
| T1 | **NAS (Synology DS220+, x86-64)** — LAN address `192.168.1.2` | the `galactic-unicorn-remote` container (this repo), `cloudflared`, Watchtower, Homepage, DSM | new container + one new container (`cloudflared`) | operator |
| T2 | **Cloudflare** — zone `fintechnick.com` | DNS for `home-display.fintechnick.com`; Access application + Allow policy; tunnel | new subdomain + Access app | operator |
| T3 | **GHCR** | `ghcr.io/nickbrett1/galactic-unicorn-remote:{sha,latest}` (+ `:buildcache`) | published by CI | CI |
| T4 | **Buildkite** (`mac-studio-linux` queue, Apple silicon) | the pipeline: build/test → image smoke → publish | generated with the repo | this repo |
| T5 | **Galactic Unicorn (Pico W)** `192.168.1.63` (DHCP reservation, informational) | firmware — **separate repo** | out of scope here | firmware repo |
| T6 | **Dev containers** (OrbStack on mac-studio) | `devcontainer-node` + goose + doppler CLI | generated | this repo |

## 2. T1 — the NAS

```
container: galactic-unicorn-remote
  image:   ghcr.io/nickbrett1/galactic-unicorn-remote:latest     (Stack: stack-memo §5)
  ports:   0.0.0.0:3009 -> 3000                                   (AD-13; stack-memo §4)
  restart: unless-stopped
  health:  Dockerfile HEALTHCHECK -> http://127.0.0.1:3000/health (AD-17)
  labels:  watchtower.enable=true; homepage widget -> http://localhost:3009/health
```

- **Bind is `0.0.0.0:3009`, not `127.0.0.1` and not one interface.** This is a deliberate break from
  the house pshelf loopback convention: a Pico W on the LAN is a real client with no Tailscale
  (memo §7.1; stack-memo §4). Naming one interface buys nothing and breaks if the NAS's lease moves
  (memo §12.12).
- **The NAS's *address* is what must be pinned**, via DHCP reservation or a DSM static IP, because the
  board's `config.py` dials `http://192.168.1.2:3009` as a literal (memo §11.12).
- **Surfaces are split by policy and routing, not by interface** (memo §7.1, §9.4):
  `/`, `/api/*` are the public+tailnet surfaces; `/device/*` and `/health` are LAN-only and not
  routed by the tunnel.
- **Deploys happen through CI only.** Watchtower recreates the container when `:latest` moves;
  a pinned SHA tag rolls back (`.agents/.rules/git_guidelines.md` forbids manual deploy commands).

New on T1 for Phase A: a **`cloudflared` container** — outbound-only, token-auth, `--no-autoupdate`,
no ports opened, no port forwarding, no router changes (memo §8.1, §11.11).

## 3. T2 — Cloudflare

| Item | Value |
|---|---|
| Zone | `fintechnick.com` (already registered on Cloudflare) |
| Hostname | `home-display.fintechnick.com` — a subdomain; `www` is already in use and a subdomain's own record cannot disturb it (memo §8.1) |
| Access application | self-hosted app **scoped to that one hostname**, not the zone |
| Policy | one **Allow** rule, selector **Emails**: `ts.akhtar@gmail.com`, `nick.brett1@gmail.com`; everyone else refused at the edge |
| Login method | **One-time PIN** (six-digit emailed code; no Cloudflare account, no Google account, no app, no password) |
| Session duration | raised from the 24 h default to ~1 week |
| Cost | free tier — Zero Trust covers up to 50 users; this is not an expiring trial |
| App name shown to users | "Home Display" (the hostname is mostly invisible) |

**Tunnel ingress rules — exactly two, and nothing else ever** (memo §8.4):

1. `/` and `/api/*` → the app.
2. `/device/*` → `http_status:404`.
3. No catch-all to DSM. A catch-all pointing at DSM would put the NAS admin UI behind Access — the
   failure mode of the whole section.

`/health` is deliberately **not** routed either.

**What Cloudflare in the path does not solve:** if Cloudflare is down, the public door is shut.
Nick's tailnet door is not (memo §8.2).

## 4. T3 — GHCR

- `ghcr.io/nickbrett1/galactic-unicorn-remote:${BUILDKITE_COMMIT}` and `:latest`, platform
  **`linux/amd64`** — the DS220+ is x86-64, so `armBuilds` is off (stack-memo §5).
- The `:buildcache` tag is registry-backed BuildKit cache (`mode=max`), never a deployable image.
- Credentials are resolved **at run time** from Doppler `common`/`prd` secret `GHCR_UPDATE_TOKEN`
  via `$DOPPLER_TOKEN`; **never** stored in the repo and never in the agent's `environment` hook
  (stack-memo §8; `deploy/README.md`).
- Package visibility: public (repo is public) → the NAS/Watchtower pulls with **no credentials**.
- Skipped if the commit is already published (positive answer only; "could not ask" must never read
  as "already published").

## 5. T4 — Buildkite

| Step | Key | Gate |
|---|---|---|
| Build and test (node) | `build` | `npm ci` → `npm run build` → `npm run lint` → `CI=true npm test` (vitest, coverage thresholds from `vite.config.js`) |
| Smoke test image | `docker_smoke` | builds the image, runs it, polls the **declared healthcheck** until `healthy`; fails loudly if the container exits instead of serving |
| Build and publish (GHCR) | `docker_publish` | `build.branch == "main"`; depends on `build` + `docker_smoke` |

- Runs on the `mac-studio-linux` queue; steps use `platform: linux/arm64` (the fleet is Apple
  silicon) while the **published image** is `linux/amd64`.
- The pipeline and its **GitHub webhook** are created during generation. On any hand-made or
  regenerated repo, check the webhook first — without it a push triggers nothing at all
  (stack-memo §5).
- The two vitest suites (this repo) and pytest suites (firmware repo) are separate; neither replaces
  the other (memo §6.4; stack-memo §5).

## 6. T5 — the board (separate repo, out of scope)

- Product: Galactic Unicorn (Pico W / RP2040), MicroPython 1.19.1 subset.
- Network: LAN only, plaintext HTTP, outbound only. Radio never turned off; DHCP only at boot
  (memo §6.2).
- The **only** thing shared with T1 is the HTTP contract in `api/device-protocols.md`.
- Its DHCP reservation (`28:CD:C1:08:C1:6D → 192.168.1.63`) is **not required by this protocol** —
  under polling the server identifies the board by token and boot id, not address. It is kept for the
  network-health log and to identify the panel in the router (memo §11.12).

## 7. T6 — developer infrastructure

- Dev container: `devcontainer-node` + `sveltekit` + `docker` + `code-quality` + `buildkite` +
  `coding-agents` (+ `doppler` as its declared dependency) — stack-memo §8.
- Secrets for development come from Doppler `common`/`dev` (`doppler.yaml`). The **device token is
  never** a committed default, `.env` is never committed, and secrets are never logged.

## 8. Failure-domain summary

| Failure | Blast radius | Recovery |
|---|---|---|
| This service down | phone doesn't work; panel fully normal | restart container / Watchtower |
| Cloudflare down | public door shut; tailnet door fine | wait; Nick's door is the fallback |
| NAS IP moves | board polls a dead address → presents as a broken panel | DHCP reservation (memo §11.12) |
| Board network dead window | a command during the window is lost and reported as lost | next poll recovers; no session to rebuild |
| Board reboot | countdown lost, panel back to AMBIENT; desired cleared on new `boot` id | by design (memo §5.6) |
| Bad image published | live container replaced | pin the SHA tag in compose (deploy/README §4) |
