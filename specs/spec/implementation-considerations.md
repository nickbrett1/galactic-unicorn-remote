# Implementation considerations — the constraint ledger

Read with particular care by the plan-generation phase. Every item that constrains implementation is
here. Cite as `implementation-considerations §N`.

Sources: `memos/galactic-unicorn-remote-v1` (memo) and `memos/galactic-unicorn-remote-stack`
(stack-memo). Where they disagree on stack/bind/`/health`, **stack-memo wins** (memo-1 §8.1/§8.2/
§8.5 and its §7.1 prose are superseded by stack-memo §2 and §4).

---

## §1 Scope boundaries — what this repo is, and what it is not

**In this repo (the NAS service):**

- The SvelteKit 5 / Node (`adapter-node`) program: the UI (`src/routes/+page.svelte`) and the API
  (`+server.js` endpoints) — one program, one language (stack-memo §1, §2).
- The **shared HTTP contract** the board must honour: paths, query params, JSON request/response
  shapes, `gen`, `applied_gen`, `next_poll_ms`, the ~45 s TTL, the four events, `/health` and
  `/device/poll` (memo §5.1, §6.1, §7.2).
- The server-side reconcile logic (TTL, `gen` ordering, conflict policy, `next_poll_ms`) and its
  **vitest** suite (stack-memo §5).
- Behaviour behind the public door: never route `/device/*`, never trust the Access identity header
  as authorisation (memo §8.3, §8.4).

**Out of this repo, and the reason:**

| Out of scope | Reason |
|---|---|
| Firmware internals: `lib/remote.py`, `lib/routine.py`, the pure reconcile function, `lib/net.py`, `config.py`, `config_secrets.py` | **separate repo**; only the wire contract is shared (memo §6, §7.1) |
| The board's pytest/ruff suite | separate suite, tests a different pure function; neither replaces the other (memo §6.4, stack-memo §5) |
| `cloudflared` container, tunnel, Access application, hostname DNS | Phase A infrastructure on the NAS / Cloudflare, not code (memo §8.1, §13) |
| NAS DHCP reservation / static IP | router/DSM change; a prerequisite, not a repo artifact (memo §11.12) |
| `+2 min` / extend / duration editing / settings / privilege tiers | would need a new `extend` event and a feature the panel does not have (memo §9, §12) |
| MQTT / phase-3 ambient cards | no broker exists; phase 3 (memo §1) |
| The phase-4 orchestrator | name deliberately kept free (memo §7.1) |
| Editing the NAS's Homepage `services.yaml` | host config; the generated snippet is `deploy/homepage-services.yaml` |

---

## §2 Verified ground truth already in this repo — do not contradict

Verified by inspection on 2026-09-24:

1. **SvelteKit 5 + `@sveltejs/adapter-node`** — `svelte.config.js` imports `adapter` from
   `@sveltejs/adapter-node` and calls `adapter()`. **Not `adapter-auto`** (stack-memo §2).
2. Build output `build/`; runtime image `CMD ["node","build/index.js"]`; multi-stage
   `node:22-slim`; runtime stage copies `/app/build` only; `EXPOSE 3000`.
3. **Container port 3000; compose publishes `0.0.0.0:3009:3000`**; container name
   `galactic-unicorn-remote`; Watchtower label; Homepage `customapi` widget at
   `http://localhost:3009/health` (`docker-compose.yml`).
4. **`src/routes/health/+server.js` returns `{"status":"ok"}` as JSON** — deliberately, because the
   Homepage widget parses JSON (memo §11.17; stack-memo §3).
5. **CI is Buildkite** (`.buildkite/pipeline.yml`): `npm ci → build → lint → test(vitest)`; then an
   image-smoke step that polls the **declared healthcheck**; then publish to GHCR `linux/amd64` on
   `main` only, credentials from Doppler `common/prd` `GHCR_UPDATE_TOKEN` via `$DOPPLER_TOKEN`.
6. The Buildkite step runs on the **`mac-studio-linux` queue** with `platform: linux/arm64`
   (the fleet is Apple silicon) while the **published image is `linux/amd64`** (stack-memo §5).
7. **Tests are vitest** (+ `@testing-library/svelte`), `environment: jsdom`, globals, setup file
   `src/test-setup.js`, junit reporter to `./reports/junit.xml`.
8. **Coverage thresholds in `vite.config.js`:** statements 80 / branches 50 / functions 80 /
   lines 80.
9. **Lint** is `prettier --check . && eslint .`; ESLint + `eslint-plugin-sonarjs` +
   `eslint-plugin-security` (`eslint.config.js`). A pre-commit hook runs `lint-staged`.
10. Doppler is wired: `doppler.yaml` → shared project `common`, config `dev`; the devcontainer
    toolchain includes the `doppler` CLI (README, stack-memo §8).
11. `src/routes/+page.svelte` is the generated counter demo and `tests/smoke.test.js` asserts on it —
    **both will be replaced** by the remote UI and its tests.
12. `package.json` scripts: `test` (= `vitest --coverage`), `build`, `lint`, `check`
    (`svelte-kit sync && svelte-check`), `dev`, `preview`.

---

## §3 Ordering dependencies

1. **Repo scaffolded via genproj before any application code.** Done. Do not re-run generation
   without re-supplying the `docker-container` configuration verbatim — without it the generator
   falls back to `publishPort: "3000:3000"`, silently undoing the LAN bind and the port the board's
   `config.py` literal dials (stack-memo §8).
2. **Phase A (the door) before Phase D (the real UI).** The tunnel + Access + a static "hello" page
   is the cheapest place to discover a policy problem; no app, no board, no code (memo §13).
3. **Phase B (service, with a fake board) before Phase C (firmware).** The service must be drivable
   by `curl` on a loop. Phases B and C are **independent by construction** — the service is Node, the
   board is Python, and nothing is shared but the HTTP contract — so either can proceed without the
   other (memo §13; stack-memo §7).
4. **Within Phase B, the reconciliation logic lands before the UI.** It is host-testable, so prove it
   under vitest where it costs nothing to be wrong (memo §13).
5. **`routines.json` (single source of truth) before the UI controls**, because no label or artwork
   may be hard-coded (memo §12).
6. **The NAS's address is pinned before the board is benched against it** — the board's `config.py`
   holds `http://192.168.1.2:3009` as a literal (memo §11.12).
7. **`/health` exists before CI smoke can pass.** It already does. If the path is ever changed, the
   Dockerfile `HEALTHCHECK`, the Homepage widget and the route must change together (§8 below).
8. **SSE is tested through the tunnel in Phase D**, before the UI is considered done (memo §11.7).

---

## §4 Tooling decisions

| Decision | Value | Source |
|---|---|---|
| Runtime | Node 22 (`node:22-slim`), ESM (`"type": "module"`) | Dockerfile, package.json |
| Framework | SvelteKit 5 / Svelte 5, `@sveltejs/adapter-node` | stack-memo §2 |
| Server routes | `+server.js` `GET`/`POST` returning `Response`; SSE is a route returning a `ReadableStream` that `adapter-node` must **not** buffer | stack-memo §2 |
| Package manager | npm, pinned `npm@11.19.1` (`packageManager` + `engine-strict`) | package.json, .npmrc |
| Tests | **vitest** + `@testing-library/svelte` | stack-memo §5 |
| Lint/format | ESLint + sonarjs + security; Prettier; `lint-staged` on pre-commit | eslint.config.js |
| Types | TypeScript is a devDependency but the tree is `.js`/`.svelte`; `svelte-check` is available (`npm run check`). Whether route handlers move to `.ts` is an **implementation judgement call**; the wire types are supplied in `spec/data-architecture/domain-models.ts` | package.json |
| Secrets | **Doppler** (`common`/`dev` locally, `common`/`prd` for the GHCR token) | doppler.yaml, stack-memo §8 |
| Container | multi-stage Dockerfile; `HEALTHCHECK` polls `http://127.0.0.1:3000/health` | Dockerfile |
| Orchestration | Synology Container Manager project / `docker compose`; Watchtower auto-update | docker-compose.yml, deploy/README.md |

---

## §5 CI/CD and deployment

1. **CI is Buildkite**, not CircleCI (default conventions name CircleCI). The pipeline and its
   **GitHub webhook** are created during generation. On any hand-made or regenerated repo, **check
   the webhook first — without it a push triggers nothing at all** (stack-memo §5).
2. **Quality gates block merge/deploy:** `npm ci → npm run build → npm run lint → npm test`
   (coverage thresholds from `vite.config.js`), then the image smoke test, then publish.
3. **The image-smoke step polls the DECLARED healthcheck and gates publish.** A container that 404s
   its own health endpoint never turns healthy, so **every build fails before the push**
   (memo §11.17; stack-memo §6). The step also fails when the container exits rather than serving.
4. **Publish is `main`-only, `linux/amd64`**, skipped if the commit is already in the registry
   (positive answer only — "could not ask" must never read as "already published").
5. **GHCR credentials resolve at run time from Doppler** (`common`/`prd`, `GHCR_UPDATE_TOKEN` via
   `$DOPPLER_TOKEN`). They are **never** in the repo and never in the agent's `environment` hook,
   where every job on the fleet could read them. The publish step therefore **depends on that
   Doppler secret existing** (stack-memo §8; deploy/README.md).
6. **Deployments are CI-only.** `.agents/.rules/git_guidelines.md` forbids manual deploy commands
   (`wrangler deploy`, `npm run deploy`, or any deployment command). The deploy is the CI publish →
   Watchtower recreate chain; no step in a plan may run one.
7. **Watchtower recreates the container on every push to `main`**, so a broken build can reach the
   NAS. Rollback is pinning the SHA tag in `docker-compose.yml` (deploy/README.md §4).
8. **Do not add a second replica or a load balancer.** Two replicas would each hold their own `gen`
   and their own view of `applied_gen` — the silent wedge of memo §11.6 (see capacity/load-model §6).
9. The pipeline template already addresses the mac-studio disk-leak class (`trap 'exit 143' TERM INT`
   plus removal of the per-commit smoke image). **Preserve that ordering and those traps** when
   editing the pipeline — the cleanup-ordering bug (2026-09-23) is a known regression.

---

## §6 Conventions deviations requiring ADRs

No conventions file was supplied → default development conventions apply, with these documented
deviations. Each has a short ADR under `spec/docs/adr/`.

| # | Deviation | Default convention it departs from | ADR |
|---|---|---|---|
| D1 | **CI is Buildkite**, not CircleCI | "CircleCI is the sanctioned pipeline" | `0001-buildkite-not-circleci.md` |
| D2 | **The frontend and the API are ONE SvelteKit program** — no separate frontend artefact, no separate API framework | stack guidance implies separate artefacts | `0002-one-sveltekit-program.md` |
| D3 | **The service binds `0.0.0.0:3009`** — deliberately LAN-exposed, not loopback-only | house pshelf loopback convention (`127.0.0.1:<port>`) | `0003-lan-bind-0.0.0.0-3009.md` |
| D4 | **Deployments are CI-only**; no manual deploy command | general "deploy" step in the default pipeline | `0004-ci-only-deployment.md` |
| D5 | **Plaintext HTTP on the LAN is deliberate** | security-first bias (encrypt in transit) | `0005-plaintext-http-on-lan.md` |
| D6 | **Browser sync is SSE with a 2 s polling fallback** | not a listed convention; a new technology-class decision | `0006-sse-with-poll-fallback.md` |
| D7 | **Secrets: Doppler + NAS environment values; the device token is never a committed default** | broadly aligned, but the public-repo + device-secret combination needs saying | `0007-secrets-via-doppler-env.md` |

Per the decision order for ambiguity (**security → testability → accessibility → approved stack →
edge performance → simplicity**), several of these are deliberate *security/testability* trades:
D3 and D5 accept a weaker network posture to make a real device work (testability), while the
security answer is carried by scope (start/cancel only) and by Access at the perimeter.

---

## §7 Security and secrets

1. **Two authentications, two purposes.** Cloudflare Access is the *public perimeter* (email OTP).
   The **device token** is defence in depth for a LAN-only endpoint, not a real boundary: anyone
   already on the LAN could start a countdown *by pressing the physical button*, so the asset is
   worth almost nothing. Include it mainly so that a future mistake — routing `/device/*` through the
   tunnel — is not immediately exploitable (memo §10).
2. **Plaintext on the LAN, deliberately.** 1.5 s of TLS per poll to protect "start bathtime" on a
   home network is a bad trade (memo §10). **Do not describe any of it as secure.**
3. **No privilege tiers.** Nothing in the UI can change durations, read files, or reach a shell — by
   scope decision, not just by omission. That is what makes the identity-header trap inert
   (memo §8.3, §10).
4. **Never trust `Cf-Access-Authenticated-User-Email` as an authorisation input** unless the
   `Cf-Access-Jwt-Assertion` is verified against Cloudflare's Access certs — because the same app is
   reachable on the LAN and the tailnet, where nothing strips a forged header. Use it for **display
   and audit only** (memo §8.3).
5. **The device token and WiFi credentials stay out of the pack and out of the public repo.** This
   repo is **public too**, so its device token is a **NAS environment value, never a committed
   default** (memo §10). `.env` is never committed; `.env.example` carries no real values.
6. **Never log secrets.** Not the device token, not the Access JWT, never a credential. The Access
   email may be logged (display/audit) (memo §10).
7. **Bound the parser.** The board caps every read; the server **validates every query parameter and
   never echoes input into the response**; `next_poll_ms` is server-generated and clamped
   (memo §10).
8. **Never proxy DSM.** The tunnel's catch-all must not point at the NAS admin UI (memo §8.4,
   `flows/door-routing-sequence.md` §2).
9. **GitGuardian is deliberately not selected** — the capability still hard-depends on CircleCI,
   which would drag CircleCI back into a Buildkite-only repo (the same reasoning as the roost memo
   §11.2 item 3). Secret hygiene is carried by Doppler + `.gitignore` + not committing defaults.

---

## §8 Contracts that must not drift

Three shared contracts. Each is "change one, change both/all".

| Contract | Consumers | Rule |
|---|---|---|
| **`/health`** (path + JSON body) | Dockerfile `HEALTHCHECK`, Homepage `customapi` widget, Buildkite image-smoke step (which **gates publish**) | Body must stay JSON with a `status` field; the path must exist on whatever the healthcheck declares. The scaffold's `/health` + `{"status":"ok"}` is consistent — **do not "correct" it to `/healthz`**. A `/healthz` override inherited from the Python template was hit once during generation (memo §11.17; stack-memo §3, §6). |
| **The device wire** (`/device/poll` query params + response) | this repo and the firmware repo, which share no code | Shapes, field names, `gen` semantics, `applied_gen`, `next_poll_ms`, TTL are pinned in `spec/api/device-protocols.md`. A change here is a firmware change. |
| **The published port** (`0.0.0.0:3009:3000`) | the board's `config.py` literal `http://192.168.1.2:3009`; the Homepage href `http://nas:3009/` | Container listens on 3000; host publishes 3009 on all interfaces (stack-memo §4). |

Also load-bearing and easy to break silently:

- **`routines.json` is the single source of truth** for ids and labels (id `cleanup`, label
  "Cleanup"); no hard-coded labels or artwork paths (memo §12).
- **SSE no-buffering headers + heartbeat**: `text/event-stream`, `no-cache`,
  `X-Accel-Buffering: no`, a comment every ~15 s. `adapter-node` must not buffer the route
  (memo §11.7; stack-memo §2).

---

## §9 Risks and mitigations

Numbering follows memo §11. R = risk; M = mitigation to implement here.

| # | Risk | Mitigation in this repo |
|---|---|---|
| R1 | A command during a dead window silently does nothing | TTL (~45 s) drops it + honest UI wording (memo §5.4, §9.1). **Not eliminated — deal with it in the wording.** |
| R2 | Poll interval vs latency (~5 s idle is marginal for cancel) | server-directed `next_poll_ms`, 2 s on demand; **do not optimise idle upward** (memo §6.3.5, §11.2). |
| R3 | A poll must never block a frame | board-side; but the server must keep responses tiny and never stall the poll route (memo §6.3). |
| R4 | `remaining` must come from the board | the server relays `observed.remaining_s` and computes no countdown (memo §5.3). |
| R5 | Panel health not yet surfaced | data already held; a later cheap addition (memo §11.5). |
| R6 | The `gen` high-water mark, both directions — get it wrong and the system wedges **silently** (the panel merely looks "offline") | `gen` re-seed from `applied_gen + 1`; board persists `applied_gen`; **unit-test both directions under vitest** (memo §5.1, §11.6). |
| R7 | SSE through Cloudflare needs a heartbeat; proxied connections idle ~100 s | ~15 s comment, no-buffer headers, 2 s fallback, **test through the tunnel in Phase D**; subscriber count must be live (memo §11.7). |
| R8 | A home-screen web-app may not share Safari's Access session | verify in Phase A; Safari bookmark fallback (memo §8.5). |
| R9 | The tunnel's catch-all is a foot-gun (DSM exposure) | explicitly two ingress rules and nothing else (memo §8.4). |
| R10 | `config.py` is in the pack — on-device tunables are not durable | board-side; the server-side clamp is the only server-side control (memo §11.10). |
| R11 | `cloudflared` is not installed on the NAS — Phase A is a new deployment | named as a Phase A prerequisite (memo §11.11). |
| R12 | Addresses — **the NAS's address is the one that must be pinned**; the board's reservation is not required by this protocol (the server identifies it by token + boot id) | duplicate as an operational prerequisite (memo §11.12). |
| R13 | Remote cancel is silent and should stay silent | the phone carries the acknowledgement; do not add a sound (§9.1, memo §11.13). |
| R14 | The child may learn the phone does it | out of scope, noted (memo §11.14). |
| R15 | A network error may not be a network error (heap, not link) | log **what the poll last reported and when**, not just that it is quiet (memo §11.15, §9.1). |
| R16 | A USB deploy of a `lib/` module does nothing until reboot | firmware-side; named so the bench session is not spent debugging an unloaded file (memo §11.16). |
| R17 | **The health path is a shared contract** — a container that 404s it never turns healthy and **every build fails before publish** | keep `/health` + JSON body + Dockerfile healthcheck + Homepage widget aligned (§8; memo §11.17). |

Additional risks introduced by *this* repo's own choices:

| # | Risk | Mitigation |
|---|---|---|
| R18 | `adapter-node` buffering the SSE route would make the UI look broken (stale mirror) | assert streaming behaviour in a test; keep no-buffer headers; verify through the tunnel (stack-memo §2; memo §11.7). |
| R19 | An unsanitised query parameter echoed into a response or a log | validate every parameter; never echo input; never log the token (memo §10). |
| R20 | Two replicas each holding their own `gen` | single container; document the prohibition (capacity/load-model §6). |
| R21 | Losing the pipeline's cancellation traps reintroduces the mac-studio disk leak | preserve `trap 'exit 143' TERM INT` + cleanup ordering (§5.9). |

---

## §10 Testing strategy

1. **Suite:** vitest (+ `@testing-library/svelte`), jsdom, `src/test-setup.js`. `npm test` runs
   `vitest --coverage`.
2. **Coverage gates (hard, from `vite.config.js`):** statements **80** / branches **50** /
   functions **80** / lines **80**. CI runs `npm test`; a threshold miss fails the build.
3. **Unit-test the pure logic first** — the server's own TTL, `gen` ordering (both directions),
   conflict policy, `next_poll_ms`. This mirrors the firmware's discipline and is where the subtle
   bugs live (stack-memo §5; memo §6.4).
4. **Integration-test the routes** with `curl`-equivalent requests: `/device/poll` with each
   `action`, `/api/start` conflict/offline/no-op, `/api/replace` sequence, and `/health`.
5. **The generated `tests/smoke.test.js` must be replaced** — it asserts on the counter demo
   (§2.11). Its health-endpoint assertion is worth keeping in some form.
6. **Test scoping per repo convention:** `.agents/.rules/testing_guidelines.md` says to run focused
   tests on changed files (`npx vitest run <file>`), and the full suite only for shared changes or
   pre-commit validation.
7. **E2E (Playwright) is not present** in the scaffold. The default conventions want E2E "where
   applicable"; for a four-button PWA the cost/benefit is a **planning judgement call**, and the
   Phase D acceptance criterion (the "sent vs done" states) is the case that would justify it.
8. **Do not test the firmware here.** The board's suite is Python and separate; neither replaces the
   other (memo §6.4; stack-memo §5).
9. **A green `ruff check` does not prove the board can parse the code** — a lint is not a parser
   (memo §6.4). Not applicable to this repo, but stated so it is not transplanted as a false comfort.

---

## §11 Open decisions

The memos leave these genuinely open. **Do not invent a resolution**; each is flagged where touched
and must be settled (an ADR, a config value, or an explicit deferral) during planning.

| # | Open decision | Touched in | Notes |
|---|---|---|---|
| O1 | **Persistence backing store** for desired/observed/`gen` and the audit log (in-memory + append-only file vs SQLite) | `data-architecture/state-layout.json`, `audit-log-schema.sql` | memos specify the *contents* ("a small append-only log") but not the store (memo §7.3, §5.1) |
| O2 | **Device-token transport** on `/device/poll` (query parameter vs header) | `api/galactic-unicorn-remote-openapi.yaml` (`DeviceToken`), `api/device-protocols.md` §1 | this spec proposes `?token=` for the board's simplicity; memos say only "shared token" (memo §5.1, §7.2) |
| O3 | **SSE fallback endpoint shape** | `event-flow.md` §3 | whether the 2 s fallback polls `GET /api/state` as-is or a compact route (memo §11.8) |
| O4 | **Offline threshold** (the cut-off behind `panel.online`) | `domain-models.ts`, `flows/panel-lifecycle-state-machine.md` | a multiple of the idle poll interval; not specified (memo §5.5, §9.1) |
| O5 | **Server-side `next_poll_ms` clamp values** | `state-layout.json`, `api/device-protocols.md` §6 | the board's floors/ceilings live in `config.py`; the server's are unnamed (memo §6.3.5, §11.10) |
| O6 | **Exact TTL constant** | everywhere ~45 s appears | "~45 s ≈ 15 poll intervals" is the design intent (memo §0, §5.4) |
| O7 | **Formal surface-trust rule** | `flows/door-routing-sequence.md` §3 | the concrete predicate (header presence + JWT verification) by which a request is known to come from the tunnel vs the tailnet (memo §7.4, §8.3) |
| O8 | **Audit-log retention / rotation** | `audit-log-schema.sql`, `capacity/load-model.md` §4 | memo says "small"; no number |

Also left genuinely open by the memos and **not** design-blocking:

| # | Open | Note |
|---|---|---|
| O9 | Whether the UI ships as a **PWA** | "cheap, and an iOS-first household. Not v1-critical" (memo §9). If added, verify the Access session in the PWA (memo §8.5). |
| O10 | Whether route handlers move to **TypeScript** | the scaffold is JS; TS is available (`svelte-check`, `typescript` devDependency). An implementation judgement call. |
| O11 | **E2E (Playwright)** adoption | §10.7 above. |

---

## §12 Rollout mapping (phases are memo-fixed; this repo owns B and D)

| Phase | Owner | Success criterion | Notes |
|---|---|---|---|
| **A — the door, alone** | NAS/Cloudflare (not this repo) | her phone, on cellular, gets in with an emailed code; a stranger's email gets 403 | `cloudflared` install + tunnel + Access + static "hello" page; also verify the PWA/session question (memo §8.5, §13) |
| **B — the service, with a fake board** | **this repo** | the two slots, `gen`, TTL, audit log, `next_poll_ms`, and `/device/poll` driven by `curl` on a loop; reconciliation proven under **vitest** | the fake board is a `curl` loop; nothing here depends on the firmware (memo §13; stack-memo §7) |
| **C — the firmware** | firmware repo | the panel behaving perfectly with the service switched off (the critical regression test) + the poll's heap cost | separate repo; independent of B |
| **D — the real UI** | **this repo** | the mirror, the three symbols, the one Cancel, SSE + fallback **tested through the tunnel**, and the honest "sent vs done" states — **§9.1 is the acceptance criterion** | memo §13 |
| **E — polish** | both | audit-log surfacing, panel health, PWA, then `+2 min` as a hold | the data already exists for the audit surfacing and panel health (memo §5.6, §11.5) |

**The thing not to do** (memo §13): wire all four at once and then debug a phone that shows a happy
toast while a dark panel sits in the living room. Phases B and C exist to make that diagnosis
impossible to arrive at.

---

## §13 Standing invariants (fail a review if violated)

1. **The panel is the only timer.** No server-computed countdown is ever surfaced or stored as truth
   (memo §0, §5.3).
2. **Nothing dials the board.** No inbound listener is added to the panel, and the server never
   pushes to it (memo §2, §4).
3. **The remote mimics the buttons and nothing else.** Four events; no fifth (memo §0, §3, §12).
4. **Pending state expires; it never queues** (memo §5.4).
5. **"Sent" is never presented as "done"** (memo §9.1).
6. **`/device/*` is never routed by the tunnel; nothing else is either** (memo §8.4).
7. **The Access identity header is never an authorisation input** (memo §8.3).
8. **The board works identically with this service dead** — no design may make the panel depend on
   the server (memo §2, §13).
