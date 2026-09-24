# plan-progress.md — galactic-unicorn-remote

Lightweight progress record. Authority: `specs/plan.md`, `specs/spec/implementation-considerations.md`.

## Phase status

| Phase | State | Notes |
|---|---|---|
| Phase 0 — Prerequisites | assumed done / `[MANUAL]` | not executed here |
| Phase 1 — Repository bootstrap | already complete | verified scaffold untouched (health route, adapter-node, port 3000) |
| **Phase A — The Door** | **`[MANUAL]` — NOT DONE** | NAS/Cloudflare infra; out of this run's scope |
| **Phase 2 — Backend (B1–B9)** | **DONE (this run)** | see below |
| Phase 3 — Client / UI (D1–D5) | **DONE (this run)** — D4 `[MANUAL]` pending | see below |
| Phase 4 — Integration | not started | |
| Phase 5 — Validation (E) | not started | |
| Phase C — Firmware | separate repo | out of scope |

## Phase 2 — Backend (B1–B9)

| Step | State | Evidence |
|---|---|---|
| B1 pure reconcile core + tests | done | `src/lib/server/reconcile.js`, `reconcile.test.js` |
| B2 state store + audit + config | done | `state.js`, `audit.js`, `config.js`, `.env.example` |
| B3 `routines.json` + loader | done | `src/lib/routines.json`, `src/lib/server/routines.js` |
| B4 `/device/poll` + fake board | done | `src/routes/device/poll/+server.js`, `scripts/fake-board.sh` |
| B5 command surfaces | done | `src/routes/api/{start,cancel,replace}/+server.js`, `commands.js` |
| B6 `/api/state` + keep `/health` | done | `src/routes/api/state/+server.js`; `health/+server.js` unchanged |
| B7 `hooks.server.js` surface trust | done | door kind attached; Access header display/audit only |
| B8 backend integration tests + gates | done | `tests/backend.test.js` (replaces `tests/smoke.test.js`) |
| B9 keep CI honest | verified, no change | `.buildkite/pipeline.yml` already build→lint→test, healthcheck smoke, main-only publish, TERM/INT traps |

### Gates (last run)

- `npm run build` — pass
- `npm run lint` — pass (0 errors; 11 warnings, all non-blocking sonarjs/security)
- `npm test` — 84 passed; coverage stmts 96.59 / branch 88.44 / funcs 97.10 / lines 97.26 (gates 80/50/80/80)

### Proof executed

- vitest: pure reconcile suite (gen both directions, TTL drop, all seven conflict rows, cadence+clamp,
  four-event vocabulary guard, headless-timer guard) + store/audit unit suites + route integration suite.
- LIVE: `npm run dev` + `bash scripts/fake-board.sh` + `curl -XPOST /api/start` → gen seeded, ack
  `202 {gen,action:start}`, board applied, `/api/state` online, audit `accepted → applied`; conflict and
  422 paths exercised; no token in the log.

## Phase 3 — Client / UI (D1–D5)

| Step | State | Evidence |
|---|---|---|
| D1 UI shell + four controls | done | `src/routes/+page.svelte`, `+page.server.js`; labels/artwork from `routines.json`; mirror + "signed in as …" |
| D2 "sent vs done" states | done | `src/lib/ui/command.js` reducer + component; `tests/ui-logic.test.js`, `tests/ui-page.test.js` |
| D3 `GET /api/events` SSE + 2 s fallback | done | `src/routes/api/events/+server.js`, `src/lib/server/events.js`, `src/lib/server/snapshot.js`; `tests/events.test.js`; LIVE `curl -N` |
| D4 SSE through the tunnel | **`[MANUAL]` — pending** | needs Phase A (the door); not attempted |
| D5 UI tests, a11y, no-hard-coded-label check | done | `tests/ui-lint.test.js` (label/id/artwork scan + WCAG AA contrast), `npm run check` |

### Gates (last run)

- `npm run build` — pass
- `npm run lint` — pass (0 errors; 19 warnings, all non-blocking sonarjs/security)
- `npm run check` (svelte-check) — 0 errors, 0 warnings
- `npm test` — 121 passed; coverage stmts 95.95 / branch 87.64 / funcs 94.36 / lines 96.86 (gates 80/50/80/80)

### Proof executed

- vitest: formatter/reducer suites; page component suite (four controls, mirror live region, a `202` shows
  "sending…" and confirms ONLY after `applied_gen` advances, honest TTL wording, offline disables, focused
  Replace affordance, fallback poll); SSE route suite (verbatim no-buffer headers, live subscriber count,
  connect frame, `:hb`, audit fan-out, dead-subscriber safety); schema-lint/contrast suite.
- LIVE: built server (`node build/index.js`, `DEVICE_TOKEN` set) — `curl -N /api/events` showed the connect
  `state` frame, an observed-change `state` frame, and `:hb` at ~15 s; `next_poll_ms` read 5000 with no
  subscriber and 2000 with a live `curl -N` subscriber.

### Notes / open items from this phase

- `routines.json` gained an `artwork` field (the symbol identity channel), so no component hard-codes a
  label **or** an artwork path; `StateSnapshot.routines` therefore carries `artwork` too (forward-compatible).
- `buildStateSnapshot` was extracted from `api/state` into `src/lib/server/snapshot.js` so `/api/state` and
  `/api/events` paint from one identical object; `state.js`/`audit.js` gained a guarded broadcast hook
  (`events.js`) — no Phase B decision changed.

## Outstanding / `[MANUAL]`

- **A0/B2** — create `DEVICE_TOKEN` in Doppler `common`/`dev` and `common`/`prd` (the service fails fast at
  startup if it is missing in a non-dev run).
- **Phase A** — Cloudflare tunnel + Access (the door), `/device/*` → 404 ingress rule.
- **D4** — SSE through the tunnel (`home-display.fintechnick.com`, cellular phone) is `[MANUAL]` and needs
  Phase A live; **not attempted** (mirror stays live past the ~100 s proxy idle, 2 s fallback indistinguishable).
- **B9** — a real push/main build is needed to confirm the green CI build; not run (no deploy/push allowed).
- Open decisions O1–O11 implemented at their recommended defaults, each marked in-code as pending
  ratification; ADRs (`specs/spec/docs/adr/0008+`) are a later step.
