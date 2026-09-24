# plan-progress.md — galactic-unicorn-remote

Lightweight progress record. Authority: `specs/plan.md`, `specs/spec/implementation-considerations.md`.

## Phase status

| Phase | State | Notes |
|---|---|---|
| Phase 0 — Prerequisites | assumed done / `[MANUAL]` | not executed here |
| Phase 1 — Repository bootstrap | already complete | verified scaffold untouched (health route, adapter-node, port 3000) |
| **Phase A — The Door** | **`[MANUAL]` — NOT DONE** | NAS/Cloudflare infra; out of this run's scope |
| **Phase 2 — Backend (B1–B9)** | **DONE (this run)** | see below |
| Phase 3 — Client / UI (D1–D5) | not started | correctly deferred |
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

## Outstanding / `[MANUAL]`

- **A0/B2** — create `DEVICE_TOKEN` in Doppler `common`/`dev` and `common`/`prd` (the service fails fast at
  startup if it is missing in a non-dev run).
- **Phase A** — Cloudflare tunnel + Access (the door), `/device/*` → 404 ingress rule.
- **B9** — a real push/main build is needed to confirm the green CI build; not run (no deploy/push allowed).
- Open decisions O1–O11 implemented at their recommended defaults, each marked in-code as pending
  ratification; ADRs (`specs/spec/docs/adr/0008+`) are a later step.
