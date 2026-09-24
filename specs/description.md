# galactic-unicorn-remote — design description

**Status:** design (settled). Derived from `memos/galactic-unicorn-remote-v1` (design memo **v2.4**,
2026-09-23) and its companion `memos/galactic-unicorn-remote-stack` (service stack addendum).
Where the two disagree about the service's stack, bind or `/health` path, **the stack memo wins**
(memo-1 §8.1/§8.2/§8.5 and its §7.1 prose are superseded by stack-memo §2 and §4).

This repository (`galactic-unicorn-remote`) is the **NAS service**. It is one of two repos in the
phase-2 project; the other (the board's MicroPython firmware) is out of scope for this repo's
implementation but its **HTTP contract** is specified here precisely, because it is the only thing
the two repos share.

Citations of the form *(memo §5.1)* refer to `memos/galactic-unicorn-remote-v1`; *(stack-memo §4)*
refers to `memos/galactic-unicorn-remote-stack`.

---

## 1. Goals and Overview

Start and cancel the three household countdowns — **bathtime / booktime / cleanup** — from a phone,
with the physical panel (a Pimoroni Galactic Unicorn) behaving *exactly* as it does today, and give a
second phone that is **not** on Tailscale the same ability through a Cloudflare Tunnel gated on her
email address (memo Goal).

The panel is a toddler-facing display that already runs three countdowns off four physical buttons.
The remote adds **no new panel behaviour**: it is a *second producer of the four button events*
(`bathtime`, `booktime`, `cleanup`, `reset`) that the existing state machine already handles
(memo §3). Remote cancel *is* the `D` button. Consequently the panel works identically with this
service **dead** — the failure mode is "the phone didn't work", never "the display broke" (memo §2).

What this service is:

- **One SvelteKit 5 program on Node** (`@sveltejs/adapter-node`) serving both the UI and the API as
  `+server.js` endpoints (stack-memo §1, §2). There is no separate frontend artefact and no separate
  API framework.
- A **reconciliation server**: it holds *desired state* with a monotonic `gen` counter; the board
  reconciles against it on a ~2 s / ~5 s poll and reports back what it actually did (memo §5).
- The holder of the **only** connection broker between the two doors: a Cloudflare Tunnel for the
  public door, and the LAN for the board's poll (memo §2, §8).

What this service is **not**:

- Not a timer. The panel is the only timer; this service holds a *mirror*, never a clock (memo §0,
  §5.3). It never computes `remaining_s`; it relays the board's own `ticks_ms` countdown and lets the
  browser interpolate between polls.
- Not a command queue. Pending desired state has a **~45 s TTL** and is then dropped; a command that
  arrives during a network dead window **does not queue and fire later** — it fails, and the UI says
  so (memo §5.2, §5.4).
- Not an MQTT client or broker. The phase-2 transport in the v1.5 memo (Mosquitto) is **replaced by
  polling** for the trigger path only (memo §1).

### 1.1 The two doors

| Door | Who | Path | Auth |
|---|---|---|---|
| Public | wife's phone, off-tailnet | `https://home-display.fintechnick.com` → Cloudflare edge → Access → tunnel → NAS | Cloudflare Access, Allow-list on email, One-time PIN (memo §8) |
| Private | Nick's phone, on the tailnet | same UI at the NAS LAN address | none — the house pattern (memo §8.4) |

The device and health surfaces are **LAN-only and not routed by the tunnel at all** (memo §8.4).

### 1.2 Success criteria

1. Pressing a routine on the wife's phone, on cellular, starts the same countdown a physical button
   press starts — same tune, same timing — and the phone can honestly say whether the panel did it
   (memo §3, §9.1).
2. With this service stopped, **every button and every countdown on the panel is unchanged**
   (memo §13 Phase C — the critical regression test).
3. A command issued during a network dead window fails *visibly*, not silently, and never fires late
   (memo §5.4, §9.1).

---

## 2. Users

| Actor | Surface | Workflow |
|---|---|---|
| **Parent (wife)** | Public door, phone, cellular | Opens `home-display.fintechnick.com`, signs in with an emailed six-digit code once a week, taps duck / book / toy-box / Cancel. |
| **Parent (Nick)** | Private door, tailnet | Same UI, no login. |
| **The panel** (Pico W) | `GET /device/poll`, LAN, plain HTTP | Polls every ~2 s (active) / ~5 s (idle), applies desired state, reports observed state + `next_poll_ms`. Never dials anything else; never reached inbound. |
| **Operator** | NAS, Docker | Watchtower auto-updates the container from GHCR on push to `main`; checks `/health` on the Homepage dashboard. |
| **CI** | Buildkite | Builds, lints, tests, smoke-tests the image via its declared `HEALTHCHECK`, publishes to GHCR on `main`. |

A deliberate non-user: **the child**. Nothing on the phone is ever shown to the child; remote cancel
stays silent so a phone-triggered cancel is indistinguishable from `D` at the panel (memo §3, §11.13).

---

## 3. Out-of-Scope

Explicitly **not** built here (each also recorded in `spec/implementation-considerations.md`):

1. **The board's firmware** — `lib/remote.py`, `lib/routine.py`, `lib/net.py`, `config.py`,
   `config_secrets.py`, and the *pure reconcile function* live in a **separate repo**. Firmware
   internals are out of scope for this repo. **Only the shared HTTP contract is in scope** and is
   specified in `spec/api/device-protocols.md` (memo §6, §7.2).
2. **The board's pytest/ruff suite** — separate suite, tests a different pure function; neither
   suite replaces the other (memo §6.4, stack-memo §5).
3. **`+2 min` / extending a running countdown** — deliberately deferred; it needs a new `extend`
   event, not a button mimic (memo §12).
4. **Duration editing, settings, privilege tiers** — the panel has no such feature, so the remote
   cannot either. This is what makes the Access identity-header trap inert (memo §8.3, §10).
5. **The phase-4 orchestrator** — the name `galactic-unicorn-remote` was chosen so the orchestrator
   name stays free (memo §7.1).
6. **MQTT / ambient cards (phase 3)** — MQTT remains the right answer for phase 3, but no broker is
   stood up here (memo §1).
7. **Cloudflare Tunnel / Access provisioning and the `cloudflared` container** — Phase A is an
   infrastructure deployment on the NAS, not code in this repo (memo §13). This repo's job is to
   *behave correctly behind* that door: not route `/device/*`, not trust forged identity headers.
8. **NAS address pinning (DHCP reservation / static IP)** — a router/DSM change, not a repo change,
   but a prerequisite for the board's `config.py` literal to keep working (memo §11.12).
9. **The Homepage dashboard config** — the widget snippet is generated (`deploy/homepage-services.yaml`);
   editing `services.yaml` on the NAS is out of scope.

---

## 4. Agreed Architectural Decisions

These are hard constraints for later phases. Each is settled in a memo; none is invented here.

| # | Decision | Source |
|---|---|---|
| AD-1 | **The panel stays the only timer.** The server holds a mirror, never a clock. `remaining_s` comes from the board's report; the browser interpolates and re-syncs. | memo §0, §5.3 |
| AD-2 | **The remote is a second producer of button events**, not a new code path. Exactly four events: `bathtime`, `booktime`, `cleanup`, `reset`. Scope = start + cancel only. | memo §0, §3 |
| AD-3 | **The board polls the NAS over plain HTTP** (~2 s active / ~5 s idle). Not MQTT, not an inbound listener. | memo §0, §4 |
| AD-4 | **Every connection is outbound; nothing ever dials the board.** The board dials the NAS; the NAS dials Cloudflare. | memo §2, §4 |
| AD-5 | **Server holds desired state with a monotonic `gen`; the device reconciles and reports `applied_gen`.** No clock on either side; `applied_gen` persisted to flash on the device. | memo §5.1 |
| AD-6 | **Pending desired state has a ~45 s TTL** and is dropped, never queued. | memo §0, §5.4 |
| AD-7 | **The server owns the cadence** via `next_poll_ms` in every poll response; driven by demand — no desired/applied pending, no countdown, no viewer → ~5 s; any → ~2 s. | memo §5.1, §6.3.5 |
| AD-8 | **Conflict handling lives on the server, never in the firmware.** Phone asks replace → server asks cancel → waits for `state: ambient` reported → asks start. Never a silent switch. | memo §3, §5.5 |
| AD-9 | **Public door:** `home-display.fintechnick.com` on `fintechnick.com` (already on Cloudflare) → Tunnel + Access, Allow rule on `ts.akhtar@gmail.com` + `nick.brett1@gmail.com`, login method **One-time PIN**. | memo §0, §8.1 |
| AD-10 | **Private door:** the same UI on the tailnet, same service, **no auth** in the way. | memo §0, §8.4 |
| AD-11 | **Browser ↔ server: SSE** with a 2 s polling fallback; **device ↔ server: the poll response itself.** | memo §0, §8, §11.8 |
| AD-12 | **Service = `galactic-unicorn-remote`, SvelteKit (Svelte 5) on Node, `adapter-node`** — app *and* API. GHCR image, deployed on the NAS. | memo §0; stack-memo §1 |
| AD-13 | **Port:** container listens on `3000`; published **`0.0.0.0:3009:3000`** — LAN-exposed, **not loopback**, **not pinned to one interface**. | stack-memo §4; memo §7.5 |
| AD-14 | **Two authentications, two purposes:** Cloudflare Access is the public perimeter; the device token is defence in depth for a LAN-only endpoint. | memo §10 |
| AD-15 | **Plaintext HTTP on the LAN is deliberate.** Do not describe any of it as secure. | memo §10 |
| AD-16 | **The one hard UX rule:** the UI must distinguish **"sent" from "the panel did it."** | memo §0, §9.1 |
| AD-17 | **`/health` is a shared contract**: the container `HEALTHCHECK`, the Homepage widget and the pipeline's image-smoke step poll the same path, and the smoke step gates publish. Change one, change both. | memo §11.17; stack-memo §3, §6 |
| AD-18 | **`routines.json` is the single source of truth** for routine ids and labels (`cleanup` / "Cleanup"); no hard-coded labels. Symbol artwork is the only identity channel on both surfaces. | memo §12 |
| AD-19 | **No auto-resume after a reboot.** The server clears pending desired on a new `boot` id; `applied_gen` is persisted on the device, so a panel reboot cannot re-run the last command. | memo §5.6 |
| AD-20 | **CI is Buildkite**; deploys are CI-only. | memo §7.1; stack-memo §5; `.agents/.rules/git_guidelines.md` |

---

## 5. Proposed Spec File Generation Plan

The table of contents for `spec/`:

```
spec/
├── topology/
│   ├── component-graph.mmd           # system nodes + the two doors + the LAN device link
│   └── deployment-targets.md         # NAS / Cloudflare / GHCR / board / dev infra mapping
├── api/
│   ├── galactic-unicorn-remote-openapi.yaml  # OpenAPI 3.1 for this service (all 8 surfaces)
│   └── device-protocols.md           # the SHARED board↔server wire contract (in scope)
├── data-architecture/
│   ├── state-layout.json             # the two slots, `gen`, TTL, cadence inputs (KV/access patterns)
│   ├── audit-log-schema.sql          # append-only (when, who, action, did-it-land) log
│   └── domain-models.ts              # TypeScript types for Desired/Observed/Response/events
├── flows/
│   ├── command-round-trip-sequence.md      # press → desired → poll → applied_gen → confirmed
│   ├── replace-conflict-sequence.md        # cancel → wait ambient → start, never a silent switch
│   ├── door-routing-sequence.md            # tunnel vs tailnet vs LAN-only surfaces
│   ├── device-desired-state-state-machine.md  # the four events × panel state
│   └── panel-lifecycle-state-machine.md    # boot / online / offline / new-boot-id
├── ui/
│   ├── design-system.md              # tokens, the four controls, the sent/done rule, a11y
│   └── wireframes/
│       └── remote-ui.excalidraw      # low-fidelity phone wireframes (import at excalidraw.com)
├── capacity/
│   └── load-model.md                 # 1 device, 2 users, poll rates, retention
├── event-flow.md                     # event/SSE schemas + the four device events
├── implementation-considerations.md  # the constraint ledger (§1..§N)
└── docs/adr/
    ├── 0001-buildkite-not-circleci.md
    ├── 0002-one-sveltekit-program.md
    ├── 0003-lan-bind-0.0.0.0-3009.md
    ├── 0004-ci-only-deployment.md
    ├── 0005-plaintext-http-on-lan.md
    ├── 0006-sse-with-poll-fallback.md
    └── 0007-secrets-via-doppler-env.md
```

`docs/adr/` is created under `spec/` so every design artifact stays inside the project root.

---

## 6. Constraints and Prerequisites

### 6.1 Already true in this repo (verified; do not contradict)

- SvelteKit 5 + `@sveltejs/adapter-node`; `svelte.config.js` calls `adapter()` from `adapter-node`
  (not `adapter-auto`) — stack-memo §2.
- Build output `build/`; runtime image `CMD ["node","build/index.js"]`; container `EXPOSE 3000`,
  multi-stage `node:22-slim`, runtime copies `/app/build` only.
- Compose publishes **`0.0.0.0:3009:3000`**, container name `galactic-unicorn-remote`, Watchtower
  label, Homepage `customapi` widget pointed at `http://localhost:3009/health`.
- `src/routes/health/+server.js` returns `{"status":"ok"}` as JSON (deliberately: the Homepage widget
  parses JSON) — memo §11.17.
- CI is **Buildkite** (`.buildkite/pipeline.yml`): `npm ci → build → lint → test(vitest)`, then image
  smoke (polls the **declared healthcheck**), then publish to GHCR `linux/amd64` on `main` only,
  credentials from Doppler `common/prd` `GHCR_UPDATE_TOKEN` via `$DOPPLER_TOKEN`.
- Tests are **vitest** (`+ @testing-library/svelte`); lint is ESLint + `eslint-plugin-sonarjs` +
  `eslint-plugin-security`; coverage thresholds in `vite.config.js`: statements 80 / branches 50 /
  functions 80 / lines 80.
- Doppler: shared `common` project, `dev` config (`doppler.yaml`).

### 6.2 Prerequisites external to this repo

- **Phase A infrastructure:** `cloudflared` is **not** installed on the NAS; a new container
  (token-auth, outbound-only) and the `home-display.fintechnick.com` Access application must exist
  (memo §8.1, §11.11).
- **NAS address pinned:** DHCP reservation or DSM static IP for `192.168.1.2`, because the board's
  `config.py` holds `http://192.168.1.2:3009` as a literal (memo §11.12; stack-memo §4).
- **Device token** exists only as a NAS environment value; the repo is public (memo §10).
- **Watchtower** on the NAS polls GHCR and recreates the container on a new `latest`.
- **Buildkite agent prerequisites:** `DOPPLER_TOKEN` in the agent's `environment` hook, and
  `plugins-path` in `buildkite-agent.cfg` (`.buildkite/README.md`, `deploy/README.md`).

### 6.3 Environmental truths that shaped the design

- The board's network fails in **windows of minutes** — measured (memo §15 build record). This is why
  the transport is polling and why the failure is handled in the wording, not in a queue.
- The board's in-loop update check was failing on **heap fragmentation, not the network**; the radio
  is never turned off; the largest contiguous block is **16 KB** (memo §16). This is why the board
  caps every read, `gc.collect()`s before the request, and why "the poll failed" must be logged with
  enough context to tell a heap failure from a link failure (memo §6.2, §6.3, §11.15).
- Worst-case phone-to-panel latency is **one poll interval**; a command during a dead window **does
  not happen at all** (memo §4).

### 6.4 Open decisions (the memos leave these genuinely open — do not invent)

Recorded here and expanded in `spec/implementation-considerations.md` §11. No artifact in `spec/`
depends on a resolution of these; each is flagged where it is touched.

1. **Persistence backing store** for desired/observed state and the audit log (in-memory + append-only
   file vs SQLite). The memo specifies the *contents* ("a small append-only log") but not the store
   (memo §7.3, §5.1).
2. **Device-token transport** on `GET /device/poll` (query parameter vs header). The memo says "shared
   token" and that the request is a GET with query parameters; it does not name the key (memo §5.1,
   §7.2). This spec proposes `?token=` for the board's simplicity and marks it open.
3. **SSE fallback endpoint shape** — whether the 2 s fallback is polling `GET /api/state` as-is
   (memo §11.8) or a dedicated compact route.
4. **Offline threshold** — the "panel is offline" cut-off (a multiple of the idle poll interval) used
   by the UI's disabled state and by the server's refusal to set desired state (memo §5.5, §9.1).
5. **`next_poll_ms` server clamp values** — the memo fixes the board-side floors/ceilings in
   `config.py` but not the server's clamp numbers (memo §6.3.5, §11.10).
6. **Exact TTL constant** — "~45 s" is approximate (memo §0, §5.4).
7. **Formal surface-trust rule** — the concrete predicate by which a request is known to have come
   from the tunnel (header presence + JWT verification) vs from the tailnet (network), and how the
   two are expressed in `hooks.server.js` (memo §7.4, §8.3).
8. **Audit-log retention / rotation** policy (memo §7.3 says "small"; no number).
