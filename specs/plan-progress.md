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

## B9 follow-up — the first real main-branch build (2026-09-24)

Builds 1–11 had all been red, which is why GHCR held no image and the NAS could not pull one. Two
independent causes, both fixed:

- **Build 10** — `npm test` failed 3 of 121 specs in `tests/ui-page.test.js`, and only in CI. The
  devcontainer runs Node 24; the build step runs `node:22-bookworm`. `act` flushes the microtask queue
  once, and the POST handler's `fetch` → `Response.json()` handshake needs more turns than that on
  undici's stream machinery under Node 22, so three specs asserted an intermediate state that had not
  been painted. The component is correct in both; `click()` now drains pending microtasks explicitly
  (`flushAsync()`). Verified 121/121 under Node 22 *and* Node 24.
- **Build 11** — the `docker_smoke` step failed: it starts the container with **no environment**, and
  `config.js` refuses to start in a non-dev run without `DEVICE_TOKEN` (`implementation-considerations`
  §7.5, AD-14), while the Dockerfile's runtime stage sets `NODE_ENV=production`. The container exited on
  boot, so it never reached the healthcheck, and publish is gated behind that step. The spec's fail-fast
  is kept; `.buildkite/pipeline.yml` now supplies a throwaway `DEVICE_TOKEN` to the smoke container only.
  **This is a divergence from the generated pipeline** — a genproj regeneration supplies no environment
  and would reintroduce the failure, so the reason is commented at the call site.

Neither was a defect in the service: build 10's `build`+`lint` steps passed, and build 11's `build` and
`docker_smoke`'s image build both passed.

## Phase A — state after build 12 (2026-09-24)

The image now exists. Build 12 (`a660235`) is the first green build: build → image smoke → publish, all
passed, and GHCR holds `ghcr.io/nickbrett1/galactic-unicorn-remote:latest` (manifest list
`sha256:27774a8fb7e5bed884c02463bca5ee271d36a2bde4f94c3b6f9edcf4ffef2be8`) plus the per-commit tag.

**Blocking the NAS deploy — the GHCR package is private.** An anonymous pull token is refused
(`https://ghcr.io/token?scope=repository:nickbrett1/galactic-unicorn-remote:pull` → 401, while a
known-public control returns 200), and the package page 404s anonymously, although the repository itself
is public (200 anonymously). The generated `docker-compose.yml` comment — "for public packages no registry
credentials are required on the host" — assumes the package follows the repo's visibility, and the
Dockerfile's `org.opencontainers.image.source` label is documented as making that automatic. It has not.
Either the package is made public (GitHub package settings) or the NAS holds a `read:packages` credential
for `docker login ghcr.io`; until then Watchtower cannot pull and the container cannot start.

**Also outstanding on the NAS** (from the NAS agent's live memo, `memos/W75XRR96cxRsVuCqxAsNXo`):
`cloudflared` is not stood up — no Cloudflare tunnel token is available to the NAS and neither is a
Doppler `common/*` token, so that is a dashboard/human action; the tunnel ingress rules and Access policy
(§8.1/§8.4) are unapplied for the same reason; and 192.168.1.2 is *assigned* but `BOOTIF=dhcp`-reserved is
unconfirmed. The device token on the NAS was generated locally (`openssl rand -hex 32`) because Doppler
`common` is not readable from there — that is a working stopgap, not the intended source.

## Phase A follow-up — memory limits, and where cloudflared lives (2026-09-24)

The Phase A check of the running containers turned up one gap: the house convention on the NAS is a
`mem_limit` in the compose file, and `galactic-unicorn-remote` had none (`HostConfig.Memory` = 0). The
watchtower label and all four `homepage.*` labels were already correct, and the service is registered in
Homepage's own config (`config/services.yaml:408`), so memory was the only thing missing.

- `docker-compose.yml`: added `mem_limit: 512m`. Generous for a service that holds a state mirror plus the
  audit log; it is a ceiling, not a reservation, so it costs nothing at rest.
- `deploy/cloudflared.compose.yml` (new): the tunnel connector, version-controlled rather than living only
  on the NAS. Two decisions are recorded in the file rather than left implicit:
  - `mem_limit: 128m` — a connector is a few tens of MB resident, so the ceiling never bites in normal
    operation; it exists so a leak cannot grow unbounded.
  - **No watchtower label.** It is the only container here deliberately left out of Watchtower. A
    Watchtower recreate (or a self-update) restarts the connector and drops a registered connection, and
    the tunnel is infrastructure that should be updated on purpose — the same reasoning that put
    `--no-autoupdate` on the command line. The app container keeps its watchtower label; the tunnel does
    not get one.
- `deploy/README.md`: §9/§10 document the tunnel (remotely managed, outbound-only, no published ports) and
  the memory-limit convention.

**Applied and verified on the NAS** (`memos/THurnfcjrto8SktaVzx48o`). Both caps are live:

| Container | `HostConfig.Memory` | Compose file on the NAS |
|---|---|---|
| `galactic-unicorn-remote` | 536870912 (512m) | `/volumeUSB1/usbshare/docker/galactic-unicorn-remote/docker-compose.yml` |
| `cloudflared` | 134217728 (128m) | `/volumeUSB1/usbshare/docker/cloudflared/compose.yaml` |

Both recreated; after the recreate the app answers `GET /health` → 200 `{"status":"ok"}` and `cloudflared`
logs four registered connections (connIndex 0–3, quic) with preflight "Environment is healthy" and no errors
(the tunnel drops for a second or two on recreate, which is the one cost of the change). Neither file gained
a watchtower label — see the `cloudflared.compose.yml` header for why the tunnel is deliberately the one
container left out of Watchtower.

Note that the NAS keeps its own copy of each compose file (Container Manager needs a local one) and there is
**no git clone on the NAS**, so edits land twice: in this repo, and by hand on the NAS. The app's file was
previously hand-refreshed from `docker-compose.yml` at commit `cec5eca`; the `mem_limit` line is a manual
edit on top, so a future hand-copy of the repo file keeps it only because the repo now carries it too.

## Phase A — the Access application exists (2026-09-24)

Created in the dashboard; verified from outside, unauthenticated, with no session cookie.

**The hostname is protected, and nothing leaks around it.** Every path probed — `/`, `/api/state`,
`/device/poll`, `/health`, and a deliberately nonexistent `/nope-nonexistent` — returns the same
`302` to `https://bemstudios.cloudflareaccess.com/cdn-cgi/access/login/home-display.fintechnick.com?...`
with the same app audience (`kid=665cc7a602ece5e9d06a35ca6603190dbde99038887535a4279196fbfcfca12d`),
and the response carries `www-authenticate: Cloudflare-Access` plus a `CF_AppSession` cookie. Two things
that matter fall out of that:

- **There is no bypass rule.** `/health` and `/device/*` are *not* excepted, so the public surface cannot
  reach the device endpoint or the local probe even if someone guesses the path. (The board is unaffected:
  it dials `192.168.1.2:3009` directly and never traverses the edge, which is the whole point of §8.4.)
- **One application covers the hostname**, not several overlapping ones — the audience is identical on
  every path.

**The login page is exactly the intended shape:** title "Log in to home-display", a single email field and
"Send login code" — One-time PIN, no account to create, nothing to install (§8.1).

**Session duration is still the 24 h default.** `set-cookie: CF_AppSession=...; Expires=<now + 24 h>`
(repeated on two separate requests, so it is the setting and not a transient). §8.1 asks for about a week:
change it in the app's *Session Duration* so it is a once-in-a-while event rather than a daily one.

**Cosmetic:** the app is named `home-display` (the hostname) rather than "Home Display". Only the Access
application name is visible to a signed-in user, so this is the string she sees on the login card.

**Not verifiable from outside, and worth knowing:** whether the Allow rule lists the two household emails
and nothing else. Cloudflare deliberately does not disclose it — POSTing an unknown address to the OTP
endpoint returns the same `302` back to the code-entry page as an allowed one would, precisely so the
endpoint cannot be used to enumerate who has access. So the "a stranger's email gets refused" half of the
acceptance criterion needs the two-minute human test: request a code for a non-household address, confirm
no mail arrives and the code step refuses it.

### Phase A acceptance — the door works (2026-09-24)

With the mis-typed email corrected the code arrives and login succeeds; `home-display.fintechnick.com` is
reachable from a phone/browser that has never been on the tailnet. Unauthenticated, every path still
returns the same `302` to the Access login, so the door is closed to everyone else.

**The blocker was a Cloudflare Worker route, and it is worth writing down because the symptom was
misleading.** Signed in, the hostname served the *existing website* rather than this app. The tunnel was
correct throughout — its startup log lists `home-display.fintechnick.com → http://192.168.1.2:3009`, the
app answered on `3009`, and DNS was not at fault. A Worker route on that hostname was running before the
origin, so the tunnel never received the request.

**Why it looked like an Access problem and was not:** Access is evaluated at the edge, keyed on the
hostname, *before* an origin is selected. So "it asked me to log in" proves Access works and says nothing
about where the request is forwarded afterwards. The failure was invisible until *after* login — the
hardest place to see it from, because everything up to that point looked correct. For anything else put
behind this zone, the lesson is: a hostname can be correctly tunnelled, correctly protected, and still
served by something else entirely, and the only reliable check is what the *origin* returns —
`GET /health` answering `{"status":"ok"}` rather than a website 404.

**Also corrected here:** the pre-auth `CF_AppSession` cookie's `Expires` (a flat 24 h on every probe) is
**not** a read of the app's Session Duration — it is minted per unauthenticated hit to carry the login
flow. The earlier note in this file treating it as the setting was wrong; the post-login cookie is the one
to read.

## Phase 4 — Integration (2026-09-24)

Run against a live dev server with `scripts/fake-board.sh` driving `/device/poll`. **One real defect found and
fixed** (I1); the rest verified.

**I1 — fake-board end-to-end.** The round trip reproduces the spec's flows. Audit trail from one run, in order:

- `accepted → applied` — `start bathtime` (202, `gen:2`) then `applied` on the next poll, `detail: "board reported applied_gen >= gen"`.
- `noop` — `start bathtime` again while it counts down → **200** `{"status":"noop","reason":"already_running"}`.
- `conflict` — `start cleanup` mid-bathtime → **409** `{"error":"conflict","current_routine":"bathtime","offers":["replace"]}`. Never a silent switch.
- `replace` — **202**, and the log shows it as a two-phase sequence driven by *reported* state, not a timer:
  `cancel … applied ("replace: cancel landed")` → `replace … accepted ("replace: starting target routine")`. The board went countdown-bathtime → ambient → countdown-cleanup.
- `expired` — TTL elapse with the board away: `accepted`, then `expired` (`"desired TTL elapsed with no applied_gen advance"`). **Dropped, never queued, never fired late** (§5.4).
- `refused_offline` — a command with `last_seen_s: 71` → **503** `{"error":"panel_offline"}`, and nothing was written (§5.5).
- boot change — logged as `action: boot, detail: "boot id changed … -> …"`, which is the informal panel-health monitor (§5.6).

**The defect: a reboot discarded a pending command with no row.** The boot-change branch runs *before* the
apply/expire checks, so a command accepted just before the panel rebooted was cleared leaving only the `boot`
row. The phone would say "the panel didn't answer" while the audit log implied nothing had ever been asked —
precisely the argument §9.1 exists to prevent, and the one thing the log is meant to settle. Both slots
(desired and an in-flight replace) are now closed out as `expired` before they are cleared
(`src/routes/device/poll/+server.js`), with a regression test. Verified live: `accepted → expired
("discarded: panel rebooted before the command landed") → boot`. The plain TTL path was already correct.

**I2 — OpenAPI conformance.** Exactly the eight declared surfaces, no more and no fewer: `/`, `/api/state`,
`/api/events`, `/api/start`, `/api/cancel`, `/api/replace`, `/device/poll`, `/health` — declared set and
implemented set are identical in both directions (`verifier.openapi-conformance`).

**I3 — deployment contract.** `0.0.0.0:3009:3000` present in `docker-compose.yml`; the Dockerfile
`HEALTHCHECK` fetches `127.0.0.1:3000/health`; the Homepage widget polls `localhost:3009/health`; the CI smoke
step polls the **declared** healthcheck (`docker inspect .State.Health`), so all four agree on `/health` and
the smoke step still gates publish (`expectation.health-alignment`).

**I4 — no-inbound review.** In `spec/topology/component-graph.mmd` exactly one edge touches the board and it
points **from** it: `board -- "outbound HTTP GET ~2s/5s, plaintext, LAN only" --> DEV`. Nothing dials the panel.

**I5 — security review.** A token-string scan of the audit log and the server/board logs finds nothing — the
token is compared on `/device/poll` and never echoed. `door` is threaded into the command path **only** to fill
the audit row (`mapDoor`); no branch reads it, so the identity header grants nothing (§8.3, O7 deferral intact).

**I6 — single container.** One service (`app`), no `replicas`/`deploy` key — two replicas would each hold their
own `gen` (R20).

**I7 — repo hygiene.** The only tracked dotenv file is `.env.example`; `.env`, `.env.*` and `data/` are ignored,
so the audit log stays dev-local.

Caveat: `docker` is not installed in the devcontainer, so I3/I6 read the compose file rather than a
`docker compose config` resolve.

## Phase 5 — Validation, the two agent steps (2026-09-25)

**V1 — CI/quality gates.** Build **19** (`0fbf3bb`, the first to carry the Phase 4 audit fix and its
regression test) is green end to end: `build` (install → build → lint → `CI=true npm test`) → `docker_smoke`
→ `docker_publish`. Publish is `main`-only and `linux/amd64`, and it resolved `GHCR_UPDATE_TOKEN` from
Doppler `common/prd` rather than the agent's environment hook.

**V2 — the image smoke gates publish.** Verified structurally: `docker_publish` declares
`depends_on: [build, docker_smoke]`, and the smoke step polls the image's **declared** healthcheck, treating
both "not healthy after 30 attempts" and "container exited" as `exit 1` (dumping its logs, so an exit is never
mistaken for a slow start). A container that 404s `/health` therefore cannot reach the push.
The negative case was **not** executed: this devcontainer has no `docker`, so the gate is confirmed by its
wiring and its pass/fail branches rather than by a deliberately broken image. Running that once on a host with
Docker is a cheap, worthwhile follow-up.

**Still open in Phase 5:** V3–V7 are `[MANUAL]` and need the NAS and the physical panel. **V4 (the critical
regression — the panel is unchanged with the service dead) is the one that matters**, and it can be run today
even though Phase C is unbuilt. V5/V6 need the firmware. V8 is the deferred polish/hold list.
