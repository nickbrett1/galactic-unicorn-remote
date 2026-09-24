# Implementation plan — `galactic-unicorn-remote` (the NAS service)

**Status:** plan (executable). Generated from the validated design documents in this `specs/` tree.
**Repo:** `/workspaces/galactic-unicorn-remote` (public; GHCR `ghcr.io/nickbrett1/galactic-unicorn-remote`).
**Owner of this plan:** the NAS service repo. Firmware (Phase C) is a **separate repo** and is not planned here.

This plan is written to be executed end-to-end by **either a human developer or a fresh AI agent session**
with repository access and no prior context, without asking clarifying questions. Every step names its
**action**, its **tool/mechanism**, its **actor flag** (`[MANUAL]` / `[AGENT]` / `[MANUAL + AGENT]`), and its
**success condition**. Where a step writes code it names the **file(s)**, what they must implement (with the
spec citation), and the **test that proves it**.

---

## 0. How to read this plan

### 0.1 Ground truth and authority order

1. `spec/implementation-considerations.md` — **the constraint ledger. It is the authority.** The plan must
   not contradict or ignore anything in it (cited as `implementation-considerations §N`).
2. `description.md` — goals, scope, out-of-scope, the 20 agreed decisions (AD-1…AD-20).
3. `spec/api/galactic-unicorn-remote-openapi.yaml` — the eight surfaces, machine-readable.
4. `spec/api/device-protocols.md` — the **shared** board↔server wire (the only thing shared with firmware).
5. `spec/event-flow.md`, `spec/flows/**`, `spec/data-architecture/**`, `spec/ui/**`, `spec/capacity/**`,
   `spec/topology/**`, `spec/docs/adr/**`.
6. `spec/dependency-map.yaml` — the plan's phases map to its `job.*` nodes; each phase's success criteria
   reference its `expectation.*` nodes (see the traceability line in each phase).

### 0.2 Scope in one paragraph

This repo is **one SvelteKit 5 program on Node (`@sveltejs/adapter-node`)** that serves the remote UI **and**
the API (`description §1`, AD-12). It is a **reconciliation server**: it holds *desired state* with a
monotonic `gen`; the board reconciles on a ~2 s/~5 s poll and reports what it actually did (`applied_gen`).
It is **not a timer, not a queue, not MQTT** (`description §1`). The one hard UX rule is that the UI must
distinguish **"sent" from "the panel did it"** (`description §1.2`, `spec/ui/design-system.md §5`,
`flows/device-desired-state-state-machine.md §2`).

### 0.3 Phase map (recipe phases ↔ memo phases)

The memo fixes the delivery phases A–E; this plan keeps the recipe's numbered spine and maps the two together
so neither vocabulary is lost (`implementation-considerations §12`).

| Recipe phase | Memo phase | Owner | This plan §  |
|---|---|---|---|
| Phase 0 Prerequisites | — | shared | §2 |
| Phase 1 Repository Bootstrap | — (done in generation) | this repo | §3 |
| **Phase A The Door** | **A** | NAS/Cloudflare (**not this repo**) | §4 |
| Phase 2 Backend | **B** (service vs a fake board) | **this repo** | §5 |
| — Firmware | **C** | firmware repo (**external**) | §6 |
| Phase 3 Client / UI | **D** (the real UI) | **this repo** | §7 |
| Phase 4 Integration | **D/E** | this repo | §8 |
| Phase 5 Validation | **E** (polish & hold) | both | §9 |

**B and C are independent by construction** (`implementation-considerations §3.3`, memo §13): the service is
Node, the board is MicroPython, and nothing is shared but the HTTP contract. Either can proceed without the
other. **Phase B must be provable with `curl` and `vitest` and must NOT depend on the firmware** — its fake
board is a `curl` loop (§5, step B4).

### 0.4 Tooling table (only the tools this project actually uses)

| Tool | What it does | Used in |
|---|---|---|
| `genproj` MCP → `generate_project` | Scaffold/regenerate the starter repo with capabilities. **Only ever re-run with the config in §3.** | §3 (reference only) |
| `genproj` MCP → `list_genproj_capabilities` | Inspect capabilities before any regeneration | §3 |
| `specdag` CLI | Re-validate the spec DAG after any change to `spec/` (`specdag validate` / `summary`, `--strict`) | §10, ongoing |
| `shell` (devcontainer terminal) | `npm` (build/test/lint), `docker`/`docker compose` (local), `curl` (fake board + route tests), `doppler` CLI, `git` | §5, §8, §9 |
| `write` / `edit` / `read`/`view` | Create and modify files (routes, `+server.js`, `routines.json`, tests, `scripts/fake-board.sh`) | §5, §7 |
| `github` MCP | Repo operations: branches, PRs, file contents, issue comments | §5, §8, §9 |
| `doppler` MCP / `doppler` CLI | Secrets and project config (`common`/`dev` locally, `common`/`prd` for the GHCR token) | §2, §9 |
| `buildkite` MCP | Inspect pipelines/builds, trigger/rebuild, read logs, check the GitHub webhook | §2, §8, §9 |
| `svelte` MCP → `get-documentation`, `svelte-autofixer`, `list-sections` | Svelte 5 runes semantics and autofixing while writing the UI | §7 |
| `read_image` | Inspect the low-fidelity phone wireframes (`spec/ui/wireframes/remote-ui.excalidraw`) | §7 |

> **Not used here (do not add):** `xcode-native` (no iOS/macOS app), `circleci` (CI is **Buildkite**,
> AD-20 / `implementation-considerations §5.1`), and **no manual deployment tool of any kind** —
> deployments are **CI-only** (`implementation-considerations §5.6`, `.agents/.rules/git_guidelines.md`).

### 0.5 Constraint-ledger enforcement map

Every section of the ledger is enforced by a named part of this plan. A reviewer can use this table as the audit.

| Ledger | Enforced where |
|---|---|
| §1 scope boundaries | §0.2, §5 (in-repo files), §6 (firmware out) |
| §2 verified ground truth (do not contradict) | §3 (Phase 1 facts), §5 (keep `/health`, adapter-node, port) |
| §3 ordering dependencies | Phase order §3→§4→§5→§7; internal ordering §5 B1–B4 |
| §4 tooling decisions | §0.4, §5 (route shapes), §7 (SSE route) |
| §5 CI/CD & deployment | §2 (webhook), §3 (pipeline preserved), §9 (gates, no manual deploy) |
| §6 conventions deviations + ADRs | §3, §10 (new decisions → new ADRs 0008+) |
| §7 security & secrets | §5 B2/B5, §7 D1, §9 |
| §8 contracts that must not drift | §5 B1, §5 B6, §7 D4, §9 |
| §9 risks & mitigations R1–R21 | §5 (R1,R4,R6,R15,R19), §7 (R7,R18), §9 (R17,R20,R21) |
| §10 testing strategy | §5 B1 tests, §8, §9 |
| §11 open decisions O1–O11 | §11 (this plan's explicit open-decisions section) |
| §12 rollout mapping | §0.3, each phase header |
| §13 standing invariants | §12 (the invariants list; fail a review if violated) |

---

## 2. Phase 0 — Prerequisites

**Goal:** everything the plan depends on exists or is explicitly owned by a named actor, before Phase B starts.
**Success criteria:** all boxes below ticked; nothing in Phase B/D blocks on a missing prerequisite.

| # | Prerequisite | Tool / mechanism | Actor | Success condition |
|---|---|---|---|---|
| P1 | Devcontainer works: `node:22`, `npm@11.19.1`, `docker` CLI, `doppler` CLI, `git` | `shell` in the repo devcontainer | `[MANUAL + AGENT]` | `node -v` → v22.x; `npm -v` → 11.19.x; `docker version` and `doppler --version` succeed |
| P2 | Doppler wired: shared project `common`, config `dev` (`doppler.yaml`) | `doppler` CLI (`doppler secrets`) / `doppler` MCP | `[AGENT]` | `doppler secrets --only-names` lists `DEVICE_TOKEN` (see O2) after step B2 creates it |
| P3 | Buildkite **GitHub webhook exists** on the pipeline | `buildkite` MCP → `get_pipeline` / `list_pipelines`; GitHub repo settings | `[MANUAL + AGENT]` | A push to a branch produces a Buildkite build. **Without the webhook a push triggers nothing at all** (`implementation-considerations §5.1`) |
| P4 | Buildkite agent prerequisites: `DOPPLER_TOKEN` in the agent `environment` hook; `plugins-path` in `buildkite-agent.cfg` | `buildkite` MCP → `get_agent`; `deploy/README.md` §1 | `[MANUAL]` | `docker_publish` can resolve `GHCR_UPDATE_TOKEN` from Doppler `common`/`prd` |
| P5 | The NAS's **address is pinned** (`192.168.1.2`) via DHCP reservation or DSM static IP | NAS (Synology DSM) | `[MANUAL]` | The board's `config.py` literal `http://192.168.1.2:3009` has a stable target (`implementation-considerations §3.6`, memo §11.12) |
| P6 | Phase A (the door) is complete — §4 | Cloudflare + NAS | `[MANUAL]` | §4 success criteria met |
| P7 | Design docs present in `specs/` (description, `spec/`, `dependency-map.yaml`, `_generated/`, this `plan.md`) | `shell`/`tree` | `[AGENT]` | `specdag validate --strict` exits 0 on `spec/dependency-map.yaml` |

**Not prerequisites (deliberately):** the firmware repo, a Mosquitto broker, a database tier, a second
replica, or any manual deploy path. All are out of scope (`description §3`, `capacity/load-model.md §6`).

---

## 3. Phase 1 — Repository Bootstrap (**ALREADY COMPLETE**)

> **Do not re-scaffold.** The repo already exists at `/workspaces/galactic-unicorn-remote`, generated by
> genproj with **9 resolved capabilities**: `docker` + `devcontainer-node` + `svelte` + `sveltekit` +
> `docker-container` + `buildkite` + `code-quality` + `coding-agents` (+ `doppler` as a dependency). The
> design docs already live in `specs/`. The generated counter demo (`src/routes/+page.svelte` +
> `tests/smoke.test.js`) is the only thing to be **replaced** later (§7).
>
> **Verified facts (do not contradict — `implementation-considerations §2`, `description §6.1`):**
> - SvelteKit 5 + **`@sveltejs/adapter-node`**; `svelte.config.js` calls `adapter()` (not `adapter-auto`).
> - Build output `build/`; runtime image `CMD ["node","build/index.js"]`; multi-stage `node:22-slim`;
>   `EXPOSE 3000`.
> - `docker-compose.yml` publishes **`0.0.0.0:3009:3000`**, container name `galactic-unicorn-remote`,
>   Watchtower label, Homepage `customapi` widget → `http://localhost:3009/health`.
> - `src/routes/health/+server.js` returns `{"status":"ok"}` as JSON (deliberate — Homepage parses JSON).
> - CI is **Buildkite** (`.buildkite/pipeline.yml`): `npm ci → build → lint → test(vitest)`; then an
>   **image-smoke step that polls the declared healthcheck**; then GHCR publish `linux/amd64` on `main` only;
>   creds from Doppler `common`/`prd` `GHCR_UPDATE_TOKEN` via `$DOPPLER_TOKEN`.
> - Tests are **vitest** (+ `@testing-library/svelte`), jsdom, `src/test-setup.js`; coverage thresholds in
>   `vite.config.js`: **statements 80 / branches 50 / functions 80 / lines 80**.
> - Lint = `prettier --check . && eslint .` (ESLint + `eslint-plugin-sonarjs` + `eslint-plugin-security`).
> - Doppler: shared `common`, config `dev` (`doppler.yaml`).

### 3.1 The one thing a regeneration must not get wrong

**If this repo is ever regenerated, re-supply the `docker-container` configuration *verbatim*.** Without it
the generator falls back to `publishPort: "3000:3000"`, silently undoing the LAN bind and the port the
board's `config.py` literal dials (`implementation-considerations §3.1`, stack-memo §8). The exact values to
preserve:

```jsonc
{
  "docker-container": {
    "publishPort": "0.0.0.0:3009:3000",
    "hostname": "nas"
  }
}
```

- **`[MANUAL + AGENT]`** — before any regeneration: `list_genproj_capabilities` to confirm the capability
  set, then `generate_project` with `overwrite: true` and the config above. **Success condition:** after
  regeneration, `grep -n "0.0.0.0:3009:3000" docker-compose.yml` matches, and `curl -s http://localhost:3009/health`
  returns `{"status":"ok"}` from the running container.
- **Do not** invent a clone step, an `[AGENT]` scaffold step, or a design-doc copy step — all three are already
  done. This section is a *warning*, not work.

---

## 4. Phase A — The Door (**`[MANUAL]` infrastructure**, not this repo)

**Memo phase A. Owner: operator/Cloudflare. This repo's job is only to *behave correctly behind* the door**
(`description §3.7`, `implementation-considerations §3.2`). Do this **before** Phase D — the tunnel + Access
+ a static "hello" page is the cheapest place to discover a policy problem (`implementation-considerations §3.2`,
memo §13).

**Flow:** `spec/flows/door-routing-sequence.md`; **targets:** `spec/topology/deployment-targets.md §2–§3`.

| Step | Action | Tool / mechanism | Actor | Success condition |
|---|---|---|---|---|
| A1 | Confirm the NAS address is pinned (`192.168.1.2`) | DSM | `[MANUAL]` | see P5 |
| A2 | Install a **`cloudflared` container on the NAS**: token-auth, outbound-only, `--no-autoupdate`, **no ports opened, no port forwarding, no router changes** | Synology Container Manager / `docker run` on the NAS | `[MANUAL]` | The container runs and reports a healthy tunnel in the Cloudflare dashboard |
| A3 | Create the **tunnel** and its **exactly-two ingress rules, and nothing else** | Cloudflare Zero Trust dashboard | `[MANUAL]` | Rule 1: `/` and `/api/*` → the app. Rule 2: **`/device/*` → `http_status:404`**. **No catch-all to DSM.** `spec/flows/door-routing-sequence.md §2` |
| A4 | Create the **Access application** scoped to the single hostname `home-display.fintechnick.com` | Cloudflare Zero Trust | `[MANUAL]` | App "Home Display" exists, scoped to that hostname only, not the zone |
| A5 | Policy: one **Allow** rule, selector **Emails** = `ts.akhtar@gmail.com`, `nick.brett1@gmail.com`; everyone else refused at the edge | Cloudflare Zero Trust | `[MANUAL]` | A non-listed email is refused **before any login page** |
| A6 | Login method = **One-time PIN** (six-digit emailed code); session duration raised from 24 h to **~1 week** | Cloudflare Zero Trust | `[MANUAL]` | sign-in emails a PIN; no Cloudflare/Google account needed; session survives ~a week |
| A7 | Serve a **static "hello" page** through the door (no app, no board) and verify both doors | browser (cellular + tailnet) | `[MANUAL]` | wife's phone on **cellular** gets in with an emailed code; Nick's tailnet door serves the same page with no auth |
| A8 | Verify `/device/*` and `/health` are **not** reachable through the tunnel | browser/`curl` against `home-display.fintechnick.com` | `[MANUAL]` | `GET .../device/poll` → **404**; `/health` → not routed |
| A9 | **Verify the iOS home-screen-web-app / Safari Access-session question** | wife's iPhone | `[MANUAL]` | Either the Access session survives in a home-screen web app, **or** the fallback is chosen: a Safari bookmark (`flows/door-routing-sequence.md §6`, memo §8.5) |

**Phase A success criteria (memo-fixed, `implementation-considerations §12`):** *her phone, on cellular, gets
in with an emailed code; a stranger's email gets 403; `/device/*` is a 404 through the tunnel.*

> **What Cloudflare does NOT solve:** if Cloudflare is down, the public door is shut; Nick's tailnet door is
> not. Acceptable — but know it (`flows/door-routing-sequence.md §5`).

---

## 5. Phase 2 — Backend: the service against a fake board (**memo Phase B**)

**Memo phase B — the core of this repo's work.** Success criterion (memo §13): *the two slots, `gen`, TTL,
audit log, `next_poll_ms`, and `/device/poll` driven by `curl` on a loop; reconciliation proven under
**vitest***.* **Nothing here depends on the firmware.**

**Ordering inside Phase B (`implementation-considerations §3.4`): the reconciliation logic lands before the
UI.** It is host-testable, so prove it under vitest where it costs nothing to be wrong.

**Tests:** vitest, jsdom, `src/test-setup.js`; coverage gates statements 80 / branches 50 / functions 80 /
lines 80 (`implementation-considerations §10.1–§10.2`).

**Traceability:** this phase implements `job.sveltekit-service`, `job.reconcile-engine`,
`job.device-poll-endpoint`, `job.health-endpoint`, `job.audit-log-store`, `job.public-door-guard`. Verified by
`verifier.unit-reconcile`, `verifier.gen-reseed-test`, `verifier.route-integration`, `verifier.health-smoke`,
`verifier.coverage-threshold`. Expectations: `expectation.desired-gen-monotonic`, `expectation.device-reports-observed`,
`expectation.headless-timer`, `expectation.ttl-drops-not-queues`, `expectation.offline-refusal`,
`expectation.demand-driven-cadence`, `expectation.replace-sequence`, `expectation.gen-reseed`,
`expectation.audit-durable-row`, `expectation.health-json`.

### B1 — `[AGENT]` The pure reconciliation core + its tests (land this first)

**Action.** Create the host-testable pure functions — **no sockets, no `Date.now()` inside them, no stores** —
and their vitest suite. Type signatures are fixed by `spec/data-architecture/domain-models.ts`:

- **File `src/lib/server/reconcile.js`** implementing exactly these decisions:
  - `isGenApplied(applied_gen, gen)` — `applied_gen <= gen` is ignored by the board
    (`spec/api/device-protocols.md §3`).
  - `reseedGen(reportedAppliedGen)` → `reportedAppliedGen + 1` — a fresh server must never sit below the
    board's high-water mark (`spec/api/device-protocols.md §3.1`, memo §5.1). **This is risk R6.**
  - `isExpired(desired, nowEpochS)` — desired is dropped, never queued, on TTL
    (`spec/api/device-protocols.md §4.1`).
  - `resolveCommand({ requested, routine, panel })` → one of `set` | `noop` | `conflict` | `refuse_offline`,
    implementing **the conflict table verbatim** (`spec/api/device-protocols.md §5`, memo §5.5).
  - `nextPollMs({ pendingApply, activeCountdown, subscribers })` → 2000 if any true, else 5000, then clamped
    (`spec/api/device-protocols.md §6`, `state-layout.json` `cadence`).
- **File `src/lib/server/reconcile.test.js`** — the unit suite. It MUST assert:
  1. `reseedGen` in **both directions**: `applied_gen > gen` re-seeds to `applied_gen + 1`; a normal case
     re-seeds without going backwards (R6, `verifier.gen-reseed-test`).
  2. TTL: a desired slot past `expires_at` reads as `{action:'none'}` and is dropped (`expectation.ttl-drops-not-queues`).
  3. Conflict policy — all seven rows of `spec/api/device-protocols.md §5`: ambient+start→set; counting-X+start-X→`noop`
     `already_running`; counting-X+start-Y→`conflict{current_routine:X}`; counting+cancel→set cancel;
     ambient+cancel→`noop` `nothing_to_cancel`; handoff+cancel→set cancel; **unreachable+start→`refuse_offline`**.
  4. `nextPollMs` returns 2000 for each of the three demand inputs, 5000 for none (and respects the clamp for
     O5's values).
  5. **Event-vocabulary guard:** assert the routine vocabulary is exactly `{bathtime, booktime, cleanup}` and
     a `reset`/cancel is the D button — `verifier.event-vocabulary` (`expectation.four-events-only`).
  6. **Headless-timer guard:** `reconcile.js` contains **no `remaining_s` computation** — the server relays
     the board's figure (`expectation.headless-timer`).
- **File `src/lib/routines.json`** (the catalogue; see B3) — landed with B1 because `resolveCommand`'s routine
  vocabulary comes from it (`implementation-considerations §3.5`).

**Tool/mechanism:** `write`/`edit`; `shell`: `npx vitest run src/lib/server/reconcile.test.js`
(`.agents/.rules/testing_guidelines.md`: run focused tests on changed files).
**Dependencies:** none (pure). **Success condition:** the focused suite passes and `reconcile.js` imports no
`socket`/`fetch`/`Date.now`-as-time.

### B2 — `[AGENT]` The in-memory state store + audit log + secrets plumbing

**Action.** Create the process-local store and the append-only audit writer (the store is O1; default in §11 —
do not block on it).

- **File `src/lib/server/state.js`** — holds, per `spec/data-architecture/state-layout.json`:
  - `gen` (monotonic integer; written only by durable command edges), `desired` (`{gen, action, routine?, expires_at}`),
    `observed` (`{boot, fw, applied_gen, state, routine?, remaining_s?, rssi?, uptime_s?, received_at}`),
    `subscribers` (**a live count**, writer = the SSE route lifecycle), and `replace_sequence`
    (`{target_routine, cancelled_gen, started_at, abandons_at}` — server orchestration only).
  - Derived: `online = received_at is within the offline threshold` and `last_seen_s = now − received_at`
    (`spec/api/device-protocols.md §7`).
  - **Invariants to encode and test:** exactly one writer per direction; **no server-computed `remaining_s`**
    ever stored; `applied_gen` here is only a *mirror* (the board's flash is authoritative).
- **File `src/lib/server/audit.js`** — append-only writer. Rows match the columns in
  `spec/data-architecture/audit-log-schema.sql` (`seq, at, actor_email, door, action, routine, gen, outcome,
  applied_gen, panel_last_seen_s, panel_state_reported, detail`), outcomes ∈
  `{accepted, applied, expired, refused_offline, conflict, noop, shadowed}` (`spec/event-flow.md §4`).
  **INSERT/SELECT only — no UPDATE/DELETE** (except the bounded prune of O8, if chosen).
  - **Never log the device token, WiFi creds, the Access JWT, or any credential.** The Access *email* may be
    logged (display/audit only) (`implementation-considerations §7.6`).
  - The `detail` field records **what the poll last reported and when**, so a heap failure is distinguishable
    from a link failure (`spec/api/device-protocols.md §8.5`, R15).
- **File `src/lib/server/config.js`** — reads env with defaults: `DEVICE_TOKEN`, `DESIRED_TTL_S`,
  `OFFLINE_THRESHOLD_S`, `NEXT_POLL_MIN_MS`, `NEXT_POLL_MAX_MS`, `AUDIT_LOG_PATH` (values from §11 decisions).
  **Fail fast** if `DEVICE_TOKEN` is unset in a non-dev run — never fall back to a committed default
  (`implementation-considerations §7.5`, AD-14).
- **File `.env.example`** — add the variable **names with no real values** (`.env` is never committed).

**Tool/mechanism:** `write`/`edit`; `doppler` CLI to create the `DEVICE_TOKEN` in `common`/`dev`
(`[MANUAL + AGENT]` for the secret value). **Dependencies:** B1. **Success condition:** unit tests for
`state.js` (liveness derivation, one-writer invariants) and `audit.js` (append round-trip; a scan for the token
string in the log returns nothing) pass.

### B3 — `[AGENT]` `routines.json` — single source of truth

**Action.** Create **`src/lib/routines.json`** (the design's `routines.json`) and a loader
`src/lib/server/routines.js`. Contents: the three routines with ids, labels, symbols — **id `cleanup`, label
"Cleanup"**, symbols `duck`/`book`/`toy-box` (`spec/data-architecture/state-layout.json` `routines`;
`implementation-considerations §8`; memo §12). **No component may hard-code a label or artwork path**
(`spec/ui/design-system.md §2`).
**Tool/mechanism:** `write`. **Dependencies:** — (lands before B1's vocabulary assertion and before the UI, §3.5).
**Success condition:** a `verifier.schema-lint`-style check asserts the JSON has exactly the three ids and that
no `.svelte` file contains a literal routine label (see D5).

### B4 — `[AGENT]` `GET /device/poll` — the shared wire + **the fake-board `curl` loop** (first-class artifact)

**Action.** Implement the one device request/response exactly, then drive it with `curl` on a loop.

- **File `src/routes/device/poll/+server.js`** — a `GET` handler:
  - Parses and **validates every query parameter** and **never echoes input into the response**
    (`implementation-considerations §7.7`): `token` (compare to env — **401** if missing/wrong),
    `boot` (≤16), `fw` (≤16), `applied_gen` (≥0), `state` ∈ `{ambient,prompt,countdown,handoff}`,
    optional `routine` ∈ `{bathtime,booktime,cleanup}`, `remaining_s` (≥0), `rssi` (≤0), `uptime_s` (≥0).
    Malformed → **422** (`spec/api/galactic-unicorn-remote-openapi.yaml` `/device/poll`).
  - On a valid poll, in order: (1) **if `boot` differs from the last seen → clear pending desired** and audit
    `action='boot'` (`spec/api/device-protocols.md §3.2`, memo §5.6); (2) record `observed` with `received_at`;
    (3) if this is the **first** poll, **seed `gen = applied_gen + 1`**; (4) if the reported `applied_gen >= gen`,
    mark the command applied and audit `outcome='applied'` (`spec/event-flow.md §2`); (5) advance a
    `replace_sequence` if `state == ambient && applied_gen >= cancelled_gen`; (6) compute `next_poll_ms`;
    (7) respond `{gen, action, routine?, next_poll_ms}` — a few hundred bytes (`spec/api/device-protocols.md §1`).
  - **Response is tiny and the route never stalls** (R3).
  - **The board's poll is the free liveness signal** — no heartbeat message, no liveness endpoint (§7).
- **File `scripts/fake-board.sh`** — **the fake board: a first-class Phase B artifact.** A `curl` loop that:
  - emits the full query string (`token`, `boot`, `fw`, `applied_gen`, `state`, `routine`, `remaining_s`, `rssi`, `uptime_s`);
  - reads `next_poll_ms` from the JSON response and sleeps that long (so it exercises the server-owned cadence);
  - **applies** the desired state: on `action:'start'` it moves `state` ambient→prompt→countdown and **bumps
    `applied_gen` to the returned `gen`**; on `action:'cancel'` it returns to `ambient`; on `none` it idles;
  - supports scripted scenarios via flags/env (e.g. `--dead-window N` to stop polling for N seconds, so the
    TTL-expiry path is reproducible; `--boot <id>` to force a reboot).

**Tool/mechanism:** `write`/`edit`; `shell`: run the dev server (`npm run dev`) and, in a second shell,
`bash scripts/fake-board.sh`. **Dependencies:** B1, B2. **Success condition (the Phase B proof):**
with the script running, a `curl -XPOST /api/start` (B5) transitions `state`/`routine` and the script's
`applied_gen` advances; `/device/poll` returns `next_poll_ms:2000` while pending and `5000` when idle; the
sequence is observable in the audit log. **No firmware is involved.**

### B5 — `[AGENT]` The command surfaces: `POST /api/start | /api/cancel | /api/replace`

**Action.** Implement the three browser commands, resolving conflicts **before** setting anything
(`spec/api/device-protocols.md §5`; `spec/flows/command-round-trip-sequence.md`, `spec/flows/replace-conflict-sequence.md`).

- **`src/routes/api/start/+server.js`** — validate body (`{routine}` ∈ routine ids, `additionalProperties:false`;
  unknown → **422** without echoing it). Call `resolveCommand`. Then:
  - offline → **503** `{error:"panel_offline", last_seen_s}` and audit `refused_offline` (**nothing set**);
  - already-running → **noop** ("already running"), audit `noop`;
  - different routine counting down → **409** `{error:"conflict", current_routine, offers:["replace"]}`, audit
    `conflict` (**nothing set**);
  - ambient → `gen++`, set `desired={gen, action:'start', routine, expires_at: now+TTL}`, audit `accepted`,
    **202** `DesiredAck` — **"accepted, not done"** (AD-16, memo §9.1).
- **`src/routes/api/cancel/+server.js`** — set desired `cancel` (cancel **is** the D button; live in
  PROMPT/COUNTDOWN/HANDOFF); ambient → noop. **Silent** — no sound anywhere on the phone or panel
  (`spec/flows/replace-conflict-sequence.md §3`, memo §11.13). Offline → **503**, nothing set.
- **`src/routes/api/replace/+server.js`** — the **only** way to switch routines. Begin a `replace_sequence`
  (`cancelled_gen = current gen`, `abandons_at = now+TTL`), set desired `cancel`; the poll handler (B4, step 5)
  advances to `start <target>` **only when the board reports `state: ambient` AND `applied_gen >= cancelled_gen`**
  — the wait is on the *reported* state, never on a timer. If the panel goes offline past `abandons_at`, the
  sequence abandons and audits `expired`. **Never a silent switch** (AD-8, memo §5.5).
- **`src/lib/server/commands.js`** (shared handler helpers) — one implementation used by all three routes.

**Tool/mechanism:** `write`/`edit`; `shell`: `curl -XPOST` against the dev server alongside B4's fake board.
**Dependencies:** B1, B2, B4. **Success condition:** the round-trip of `spec/flows/command-round-trip-sequence.md §1`
and the replace sequence of `spec/flows/replace-conflict-sequence.md §2` reproduce end-to-end against the fake
board, with the audit log showing `accepted → applied` (or `expired`) rows.

### B6 — `[AGENT]` `GET /api/state` (snapshot + fallback) and `GET /health` (keep)

**Action.**
- **`src/routes/api/state/+server.js`** — returns the `StateSnapshot` (`{panel: observed∪liveness, desired,
  routines, door?}`) per the OpenAPI `StateSnapshot`. `remaining_s` is **relayed verbatim** — never recomputed
  (AD-1, memo §5.3). This is also the **2 s fallback** if SSE misbehaves (O3, §11).
- **`src/routes/health/+server.js`** — **already exists; do not change.** It returns `{"status":"ok"}` JSON.
  It is a **three-consumer contract**: Dockerfile `HEALTHCHECK`, Homepage widget, Buildkite image-smoke
  (`implementation-considerations §8`, AD-17). **Do not "correct" it to `/healthz`.**

**Tool/mechanism:** `write`/`edit`; `shell`: `curl -s localhost:3000/api/state | jq` and
`curl -s localhost:3000/health`. **Dependencies:** B2, B4. **Success condition:** `/api/state` validates against
the OpenAPI schema shape; `/health` returns `{"status":"ok"}` and the container still turns **healthy**.

### B7 — `[AGENT]` `hooks.server.js` — surface trust and routing guard

**Action.** **File `src/hooks.server.js`**: attach the **door kind** (`tunnel` | `tailnet` | `lan`) used by
`StateSnapshot.door` and the audit `door` column, per the formal surface-trust rule (**O7**, §11).
**Hard rules it must satisfy regardless of O7's resolution:**
- **`Cf-Access-Authenticated-User-Email` is never an authorisation input** unless the `Cf-Access-Jwt-Assertion`
  is verified against Cloudflare's Access certs; it is used for **display and audit only** (AD-16, memo §8.3,
  `spec/flows/door-routing-sequence.md §3`). There are **no privilege tiers** for it to gate.
- **`/device/*` is never routed by the tunnel** — that is enforced at the tunnel ingress (A3), but the server
  must not itself add a public path to `/device/*` or `/health`.
- **Never log a secret** (`implementation-considerations §7.6`).

**Tool/mechanism:** `write`/`edit`; `shell`: send a request with a forged `Cf-Access-Authenticated-User-Email`
and assert it changes **nothing** except the displayed/audited door email. **Dependencies:** B1–B6.
**Success condition:** a test/`curl` proves the forged header grants nothing; the door kind is correct for
tunnel/tailnet/LAN requests (§11 O7).

### B8 — `[AGENT]` Backend integration tests + coverage gates

**Action.** Replace the generated `tests/smoke.test.js` (it asserts on the counter demo) and write
`curl`-equivalent route integration tests under **vitest** (`implementation-considerations §10.4`):
`/device/poll` with each `action` and malformed params; `/api/start` (conflict/offline/no-op/set);
`/api/cancel`; `/api/replace` (the full cancel→wait→start sequence, including abandon); `/api/state`;
`/health`. Keep a health-endpoint assertion (`implementation-considerations §10.5`).
**Tool/mechanism:** `write`/`edit`; `shell`: `npm test` (runs `vitest --coverage`).
**Dependencies:** B1–B7. **Success condition:** `npm test` is green **and** coverage clears
statements 80 / branches 50 / functions 80 / lines 80 (`verifier.coverage-threshold`).

### B9 — `[AGENT]` Keep the CI pipeline honest (no change unless required)

**Action.** Confirm `.buildkite/pipeline.yml` still runs `npm ci → build → lint → test` and the image-smoke
step that polls the **declared healthcheck** and gates publish. **If edited, preserve the
`trap 'exit 143' TERM INT` and the cleanup ordering** — the mac-studio disk-leak regression (R21,
`implementation-considerations §5.9`). **Do not add a deploy step.** `docker_smoke` must be able to fail a
publish if `/health` 404s (`expectation.image-smoke-gates-publish`).
**Tool/mechanism:** `edit`; `buildkite` MCP (`get_pipeline`, `list_builds`, `read_logs`) to confirm the three
steps exist and the build is green. **Dependencies:** B6. **Success condition:** a push produces a green build
whose `docker_smoke` polls `/health` and whose `docker_publish` runs **only on `main`**.

### Phase B success criteria

- The two slots, `gen`, TTL, audit log, `next_poll_ms`, and `/device/poll` are **drivable by `curl` on a loop**
  (`scripts/fake-board.sh`), reproducing start/cancel/replace/TTL-expiry/boot-change scenarios.
- Reconciliation is **proven under vitest** (`verifier.unit-reconcile`, `verifier.gen-reseed-test`,
  `verifier.route-integration`), with coverage gates green.
- **No dependency on the firmware.** This phase is complete and demonstrable with the service alone.

---

## 6. Phase C — The firmware (**separate repo — external, not planned here**)

**Memo phase C. Owner: the firmware repo. Out of scope for this repo** (`description §3.1`, `implementation-considerations §1`).
The firmware (Galactic Unicorn / Pico W, MicroPython) implements `lib/remote.py` etc. and its **own** pytest +
ruff suite. **The only shared thing is the HTTP contract in `spec/api/device-protocols.md`.**

- **`[MANUAL]`** — hand the firmware repo the frozen contract `spec/api/device-protocols.md` (paths, query
  params, `gen`/`applied_gen`/`next_poll_ms`, TTL, the four events, `/health`). It shares **no code, no schema
  module, no test vector** (`implementation-considerations §8`).
- **B and C are independent by construction** — either can proceed without the other (`implementation-considerations §3.3`, memo §13).
- **Regression test owned by C:** the panel behaves perfectly with **this service switched off**
  (`expectation.panel-works-with-service-dead`, `verifier.panel-off-regression`) — this repo must never make
  the panel depend on the server (standing invariant §13.8).
- **Do not** write firmware code, a board endpoint, or an inbound listener in this repo. **Nothing ever dials
  the board** (`expectation.no-inbound-to-board`).

---

## 7. Phase 3 — Client / UI (**memo Phase D**)

**Memo phase D.** Success criterion (memo §13): *the mirror, the three symbols, the one Cancel, SSE + fallback
**tested through the tunnel**, and the honest "sent vs done" states — **§9.1 is the acceptance criterion***.*
**Prerequisite: Phase A (the door) is complete** (`implementation-considerations §3.2`), and **`routines.json`
exists** (§3.5).

**Authority:** `spec/ui/design-system.md` (mandatory for all UI code), `spec/ui/wireframes/remote-ui.excalidraw`,
`spec/event-flow.md §3`, `spec/flows/command-round-trip-sequence.md`.
**Traceability:** `job.remote-ui`, `job.browser-events`; verified by `verifier.sse-tunnel`,
`verifier.route-integration`, `verifier.event-vocabulary`; expectations: `expectation.routine-start-parity`,
`expectation.cancel-is-reset`, `expectation.sent-vs-done`, `expectation.same-ui-both-doors`,
`expectation.routines-single-source`.

### D1 — `[AGENT]` The UI shell and the four controls

**Action.** Replace the generated counter demo:
- **`src/routes/+page.svelte`** — mobile-first, deliberately small ("a remote, not a control panel"):
  header (with "signed in as …" **only when the Access email is present** — display only);
  **the mirror** (state + routine + `remaining_s` **interpolated locally between polls and re-synced on each
  poll**, HANDOFF briefly as "BATHTIME!"); **exactly four controls**: three routine buttons carrying the panel
  symbols (duck / book / toy-box) with labels **from `routines.json`**, and **one big Cancel** mapping to D.
  **No durations, no `+2 min`, no settings, no sound.**
- **`src/routes/+page.server.js`** (or the layout) — pass `door`/email through for display/audit only.
- Design tokens from `spec/ui/design-system.md §2` (green = go; **red for Cancel only**, else unused; amber for
  "sending…"/conflict; `--tap-min ≥ 56 px`, Cancel ≥ 72 px). **Never colour alone** — every state carries a word.

**Tool/mechanism:** `svelte` MCP (`list-sections` → `get-documentation` for runes; `svelte-autofixer` before
saving); `read_image` on the wireframes; `write`/`edit`.
**Dependencies:** B1–B7, A complete. **Success condition:** `@testing-library/svelte` component tests render
four controls, the mirror, and the badge; `npm run check` (svelte-check) passes.

### D2 — `[AGENT]` The "sent vs done" states (the one hard UX rule)

**Action.** Implement the interaction states of `spec/ui/design-system.md §4–§5` and
`spec/flows/device-desired-state-state-machine.md §2`:
- `pressing` → optimistic *press*, **never optimistic success** (dim green);
- `sending…` → amber + "sent…" — this is what a `202` `DesiredAck` means (**accepted, not done**);
- `confirmed` → green flash + "confirmed", **only when the received `applied_gen` advances to the command's
  `gen`** (never on a receipt, never on `202`);
- `failed/expired` → amber + **"the panel didn't answer (last seen 3m ago)"**, plainly — the wording never
  diagnoses heap-vs-link (`spec/event-flow.md §4`, R15);
- `offline` → controls **disabled or loudly caveated** while `panel.online` is false;
- `conflict` → an inline affordance "booktime is running — **Replace**" (a real dialog/inline disclosure with
  focus moved to it) → `POST /api/replace`.
- **Confirm only from `applied_gen`** (transition `sending → confirmed` has no other edge;
  `spec/flows/device-desired-state-state-machine.md §3`).

**Tool/mechanism:** `write`/`edit`; `svelte-autofixer`; `shell`: vitest component tests driving a mocked
`applied_gen` advance and a mocked TTL expiry. **Dependencies:** D1. **Success condition:** component tests
assert a `202` shows "sending…" and **does not** show "confirmed" until `applied_gen` advances; expiry shows
the honest wording; offline disables the controls.

### D3 — `[AGENT]` `GET /api/events` — SSE + the 2 s polling fallback

**Action.** **File `src/routes/api/events/+server.js`** — a `ReadableStream` route (`adapter-node` must **not**
buffer it). Required headers, verbatim (`spec/event-flow.md §3`, AD-11, R7, R18):

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

- **Heartbeat** SSE comment `:hb` **every ~15 s** (proxied connections idle out ~100 s).
- **Frame types (closed set):** `state` (a `StateSnapshot`), `audit` (a row); **unknown frame names must be
  ignored, not errored** (`spec/event-flow.md §3.1`).
- **Subscriber count must be LIVE** — increment on connect, decrement on disconnect, feeding `next_poll_ms`;
  **never** "a page was loaded" (`expectation.demand-driven-cadence`, memo §11.7).
- Emit a `state` frame **on connect** (so a late joiner paints), then on observed/desired/liveness change.
- **Client fallback:** a 2 s poll of `GET /api/state` (O3), **indistinguishable to the user**; a client that
  misses frames **re-syncs from `/api/state`** (the stream is a convenience, not a source of truth).

**Tool/mechanism:** `write`/`edit`; `shell`: `curl -N http://localhost:3000/api/events` and confirm the headers,
the `:hb` cadence, and that `adapter-node` streams (a stale mirror is R18).
**Dependencies:** B6. **Success condition:** local `curl -N` shows a live stream with heartbeats; the subscriber
count visibly changes `next_poll_ms` on the fake board's next poll.

### D4 — `[MANUAL + AGENT]` Test SSE **through the tunnel** (Phase D acceptance)

**Action.** With Phase A live, load `/` at `https://home-display.fintechnick.com` on the wife's phone (cellular)
and confirm the **live mirror** updates over SSE (heartbeat survives the Cloudflare idle window), and that the
2 s fallback kicks in if SSE is blocked — **indistinguishable to the user** (`implementation-considerations §3.8`, R7).
**Tool/mechanism:** browser + `curl -N` through the tunnel; `[MANUAL]` on the phone.
**Dependencies:** A, D1–D3. **Success condition:** mirror stays live over the tunnel for >2 minutes (past the
~100 s proxy idle); the four controls work from a cellular, off-tailnet phone.

### D5 — `[AGENT]` UI tests, a11y, and the no-hard-coded-label check

**Action.** Component tests for the four controls and the mirror; **WCAG 2.1 AA** checks (contrast on the dark
palette; `<button>` semantics; mirror is an `aria-live="polite"` region; full keyboard order = DOM order;
visible focus; `prefers-reduced-motion` honoured). Add a **schema-lint** check that no `.svelte` file hard-codes
a routine label or artwork path and that ids/labels come only from `routines.json` (`verifier.schema-lint`,
`expectation.routines-single-source`).
**Tool/mechanism:** `write`/`edit`; `shell`: `npm test`, `npm run check`.
**Dependencies:** D1–D3. **Success condition:** tests + a11y checks green; the label scan finds nothing.

### Phase D success criteria

- The mirror, the three symbols, the one Cancel, SSE + fallback **tested through the tunnel**, and the honest
  "sent vs done" states — **`spec/ui/design-system.md §5` is the acceptance criterion**.
- The same UI is reachable on the tailnet with **no auth in the way** (`expectation.same-ui-both-doors`).
- **Cancel is silent** on the panel; the phone carries the acknowledgement (`expectation.cancel-is-reset`).

---

## 8. Phase 4 — Integration

**Goal:** wire the whole thing together — the UI, the service, the fake board, and the real door — and prove
the end-to-end round trip and the regressions. **Memo phase D/E overlap.**
**Traceability:** `verifier.route-integration`, `verifier.sse-tunnel`, `verifier.no-inbound-review`,
`verifier.deployment-review`, `verifier.openapi-conformance`.

| Step | Action | Tool / mechanism | Actor | Success condition |
|---|---|---|---|---|
| I1 | **Fake-board end-to-end:** run the UI + `scripts/fake-board.sh`; drive start / cancel / replace / TTL-expiry / boot-change and watch the audit log | `shell` (`npm run dev`, `bash scripts/fake-board.sh`, `curl`) | `[AGENT]` | Every scenario of `spec/flows/command-round-trip-sequence.md` and `spec/flows/replace-conflict-sequence.md` reproduces; audit rows show `accepted→applied` / `expired` |
| I2 | **OpenAPI conformance:** confirm the implemented surfaces match `spec/api/galactic-unicorn-remote-openapi.yaml` and the one-program route set | `shell` (route listing + schema check) | `[AGENT]` | All eight surfaces present (`/`, `/api/state`, `/api/events`, `/api/start`, `/api/cancel`, `/api/replace`, `/device/poll`, `/health`); no extra public surface (`verifier.openapi-conformance`) |
| I3 | **Deployment-contract review:** confirm the published `0.0.0.0:3009:3000` mapping and the shared `/health` path are aligned across Dockerfile, `docker-compose.yml`, Homepage widget and CI | `shell` (`docker compose config`), `buildkite` MCP | `[AGENT]` | `grep "0.0.0.0:3009:3000" docker-compose.yml` matches; Dockerfile `HEALTHCHECK` + Homepage widget + CI smoke all poll `/health` (`verifier.deployment-review`, `expectation.health-alignment`) |
| I4 | **No-inbound review:** inspect the component graph — nothing dials the board; the panel holds no dependency on the server | `read` (`spec/topology/component-graph.mmd`) + code review | `[AGENT]` | Every arrow touching the board points **from** the board (`verifier.no-inbound-review`) |
| I5 | **Security review:** the device token is LAN-only defence in depth; the identity header is never authorisation; no secret is logged | `shell` (grep logs/token), code review | `[AGENT]` | A token-string scan of logs/audit finds nothing; the forged-header test (B7) grants nothing (`verifier.security-review`) |
| I6 | **Single-container check:** confirm there is exactly one replica and no load balancer | `read` (`docker-compose.yml`), review | `[AGENT]` | One service, one container — two replicas would each hold their own `gen` (R20, `capacity/load-model.md §6`) |
| I7 | **Seed the local dev store separately:** the audit log path for dev is distinct from production; `.env` is not committed | `shell` (`git status`, `.gitignore`) | `[AGENT]` | No `.env` in git; `AUDIT_LOG_PATH` is dev-local (`implementation-considerations §2` analog; repo hygiene) |

---

## 9. Phase 5 — Validation (**memo Phase E** — polish & hold)

**Goal:** production validation, the critical regression, and the deferred polish/hold items.
**Traceability:** `verifier.health-smoke`, `verifier.ci-gates`, `verifier.panel-off-regression`,
`verifier.surface-trust-review`; expectations: `expectation.panel-works-with-service-dead`,
`expectation.image-smoke-gates-publish`, `expectation.ci-only-deploy`, `expectation.access-is-perimeter`.

| Step | Action | Tool / mechanism | Actor | Success condition |
|---|---|---|---|---|
| V1 | **CI/quality gates:** a push produces a green Buildkite build (`build` → `docker_smoke` → `docker_publish`) | `buildkite` MCP (`list_builds`, `read_logs`) | `[AGENT]` | `verifier.ci-gates`, `verifier.coverage-threshold`, `verifier.health-smoke` all pass; publish is `main`-only `linux/amd64` |
| V2 | **Image smoke gates publish:** confirm a container that 404s `/health` fails the build before the push | `buildkite` MCP / local `docker build`+`run` | `[AGENT]` | `expectation.image-smoke-gates-publish` |
| V3 | **Deploy through CI only.** No manual deploy command exists or is run. Watchtower recreates the container on the `main` push; rollback is pinning the SHA tag in `docker-compose.yml` | `buildkite` MCP; NAS Watchtower | `[MANUAL]` | `expectation.ci-only-deploy`; ADR-0004; `.agents/.rules/git_guidelines.md` |
| V4 | **The critical regression (memo §13):** stop the service container; confirm **every button and every countdown on the panel is unchanged** | NAS + physical panel | `[MANUAL]` | `expectation.panel-works-with-service-dead` — the whole point of the architecture |
| V5 | **Public-door validation:** wife's phone on cellular starts the same countdown a physical press starts (same tune, same timing), and the phone honestly says whether the panel did it | phone + panel | `[MANUAL]` | `expectation.routine-start-parity`, `expectation.sent-vs-done` (`description §1.2#1`) |
| V6 | **Honest-failure validation:** issue a command during a network dead window (`scripts/fake-board.sh --dead-window` against the real panel via a firewall/`iptables` test, or against the fake board) and confirm it **fails visibly and never fires late** | `curl` + UI | `[MANUAL + AGENT]` | `expectation.ttl-drops-not-queues` (`description §1.2#3`) |
| V7 | **Surface-trust review:** tunnel-vs-tailnet trust; `/device/*` never routed; email is display/audit only | browser/`curl` through the tunnel | `[MANUAL + AGENT]` | `verifier.surface-trust-review`; `/device/poll` → 404 through the tunnel; `/health` not routed |
| V8 | **Phase E polish (deferred, non-blocking):** audit-log surfacing; panel-health history (the data already exists); PWA (**only if** O9 is adopted — then re-verify the Access session per A9) | `write`/`edit`; phone | `[MANUAL + AGENT]` | Each is a **hold**, not a v1 requirement; `+2 min` stays a **hold** (needs an `extend` event — out of scope) |

---

## 10. Open decisions to settle before/during this work

`implementation-considerations §11` lists these as **genuinely open — do not invent a resolution and present it
as settled.** For each: the plan's **recommended default**, a one-line rationale, and **where it must be
recorded**. New settlements become **new ADRs 0008+** under `spec/docs/adr/` (D1–D7 already occupy 0001–0007).

| # | Open decision | Recommended default | Rationale | Record in |
|---|---|---|---|---|
| **O1** | Persistence backing store for desired/observed/`gen` + audit log (in-memory + append-only file vs SQLite) | **In-memory state + append-only JSONL file** (`AUDIT_LOG_PATH`) whose rows match `audit-log-schema.sql` | State is a mirror that may legally vanish on restart; the log is the only durable artifact and is ~2 MB/year (`capacity/load-model.md §3–§4`) | ADR + `config.js` (`AUDIT_LOG_PATH`) |
| **O2** | Device-token transport on `/device/poll` (query param vs header) | **`?token=` query parameter** (the spec's proposal) | The request is already a query-parameter GET; adds no header machinery to MicroPython | ADR; pinned in `spec/api/device-protocols.md` §1 (already proposes it) |
| **O3** | SSE fallback endpoint shape | **Poll `GET /api/state` as-is** at 2 s | One snapshot shape, one client code path; no second route to keep in sync | Config (`pollFallbackMs`) + ADR |
| **O4** | Offline threshold (the cut-off behind `panel.online`) | **`OFFLINE_THRESHOLD_S = 15`** (≈3× the 5 s idle interval) | Tolerates one missed idle poll without flapping; still flags a dead window within a glance | Config + ADR |
| **O5** | Server-side `next_poll_ms` clamp values | **`NEXT_POLL_MIN_MS = 1000`, `NEXT_POLL_MAX_MS = 10000`** | The board's own floors/ceilings live in `config.py`; the server only bounds what it emits | Config + ADR |
| **O6** | Exact TTL constant ("~45 s" is approximate) | **`DESIRED_TTL_S = 45`** exactly | 45 s ≈ 15 poll intervals: rides out a hiccup, far too short to be wrong later | Config + ADR |
| **O7** | Formal surface-trust rule (tunnel vs tailnet predicate in `hooks.server.js`) | **Minimal v1:** door kind derived from `Cf-Access-Jwt-Assertion`/email **presence**, used for **display/audit only**; full JWT verification against Cloudflare Access certs is an **explicit deferral** with a `TODO` — nothing is ever granted from the header | The identity-header trap is inert because there are no privilege tiers (`description §3.4`); verifying JWTs adds cert-rotation machinery for zero authorisation benefit | ADR + explicit deferral note in `hooks.server.js` |
| **O8** | Audit-log retention / rotation policy | **Keep all rows** (≈2 MB/year); ship a documented bounded-prune hook, disabled by default | The decision is about utility, not space; a prune is a bounded operation, never a row mutation | ADR + `audit.js` prune hook |
| **O9** | Whether the UI ships as a **PWA** | **Defer** (not v1-critical); if adopted, re-verify the Access session (A9) | Cheap for an iOS-first household but risks the Access-session trap (`flows/door-routing-sequence.md §6`) | ADR / explicit deferral |
| **O10** | Whether route handlers move to **TypeScript** | **Keep JavaScript (`.js`) + JSDoc typedefs** for v1 | The verified scaffold is `.js`; `svelte-check` still validates JSDoc; adopting `.ts` now adds build config churn with no user-visible benefit | ADR |
| **O11** | **E2E (Playwright)** adoption | **Defer**; cover the sent-vs-done states with vitest + `@testing-library/svelte` and the D4 tunnel check | The one case that would justify Playwright is D2/D4, already covered at lower cost | ADR / explicit deferral |

**Recording rule (`implementation-considerations §11`):** each decision is settled by **an ADR under
`spec/docs/adr/` (0008+), a config value, or an explicit deferral** — never left ambiguous. When the spec or an
ADR changes, re-run `specdag validate --strict` on `spec/dependency-map.yaml` (`specdag` CLI) and, if the DAG
changed, `specdag summary`.

---

## 11. Standing invariants (fail a review if violated)

From `implementation-considerations §13` — every one of these is checked by a named step above:

1. **The panel is the only timer.** No server-computed countdown is ever surfaced or stored as truth. → B1 test 6, B6.
2. **Nothing dials the board.** No inbound listener; the server never pushes. → I4.
3. **The remote mimics the buttons and nothing else.** Four events; no fifth. → B1 test 5, D5.
4. **Pending state expires; it never queues.** → B1 test 2, B5, V6.
5. **"Sent" is never presented as "done."** → D2, V5.
6. **`/device/*` is never routed by the tunnel; nothing else is either.** → A3, A8, B7, I3, V7.
7. **The Access identity header is never an authorisation input.** → B7, I5, V7.
8. **The board works identically with this service dead.** → V4.

---

## 12. Definition of done (whole plan)

- **Phase A:** the door admits the wife on cellular with an emailed code; a stranger gets 403; `/device/*` is 404.
- **Phase B:** start/cancel/replace/TTL/boot scenarios reproduce against `scripts/fake-board.sh`; the reconcile
  suite passes under vitest; coverage gates green; `npm test`'s `build`/`lint`/`test` chain is green in CI.
- **Phase D:** the four controls and the live mirror work over SSE **through the tunnel**; the sent-vs-done
  states are honest; the same UI is on the tailnet with no auth.
- **Phase E/Validation:** a green Buildkite build gates publish on the image smoke; the panel is unchanged with
  the service stopped; every open decision (O1–O11) is recorded as an ADR, a config value, or an explicit
  deferral.

**The thing not to do (`implementation-considerations §12`, memo §13):** wire all four at once and then debug a
phone that shows a happy toast while a dark panel sits in the living room. Phases B and C exist to make that
diagnosis impossible to arrive at.
