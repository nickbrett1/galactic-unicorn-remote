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
| Phase 4 — Integration | **DONE (this run)** | see below |
| Phase 5 — Validation (E) | **V1/V2 done, V4/V5 PASSED**; V3/V6/V7 `[MANUAL]` | see below |
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

**V4 — the critical regression: the panel is unchanged with the service dead — PASSED (2026-09-26).**

The earlier note that "V4 can be run today even though Phase C is unbuilt" was true but hollow: no board had ever
polled (boot `null`, `applied_gen 0`), so stopping the service *could not* have changed the panel. Phase C now
polls — the board is in the loop — so this is the **real** V4.

Run, in order, driven by the nas-goose A2A agent (all panel work `[MANUAL]`, by the operator):

- **Baseline** (16:12:03Z): `boot 3f7c646d`, `fw 0.1.27`, `state ambient`, `online true`, `applied_gen 0`.
- **Stop**: `docker stop galactic-unicorn-remote` → `Exited (0)`; NAS-side `GET /health` → `000` (dead).
- **Operator sequence on the panel**: each routine cap pressed in turn (each started its countdown normally);
  the other two caps inert while one counted down; the silent cancel cancelled immediately; one countdown ran to
  HANDOFF and returned to ambient.
- **Finding**: "a slight freeze during the countdown" — not a hard hang, and it recovered on its own. So the
  panel was **fully usable with the service dead**, which is the expectation; the freeze is recorded as an
  observation, not a failure.
- **Restart**: `docker start` → `Up`, `health_from_nas=200`; `boot` still `3f7c646d` and `uptime_s` had kept
  counting (**the board never rebooted** — it rode the outage, as designed), `last_seen_s 1`, `applied_gen 0`,
  `state ambient`. No late action fired after the service returned.

What V4 proves: the physical controls and the countdown are **board-local**; the server is not in the control
path, so its death changes nothing the child touches. It is the invariant the whole reconciliation design rests
on — the board is willing to be *told*, never *dependent*.

Caveat to chase: the "slight freeze". Hypothesis (unverified) — the poll's synchronous socket read and the
`gc.collect()` before each request block the display loop while the request is in flight, and the effect is more
visible when the target is unreachable. Worth a look in the firmware's `lib/remote.py` (e.g. bound the read,
feed the WDT, avoid GC on the countdown path). Not a regression; a follow-up.

**V5 — a phone start is a physical press — PASSED (2026-09-26).**

Run against the live panel with the board polling. The whole point of the reconciliation design is that the
remote is a **second producer of the same four button events**, not a parallel control path, so this test is
about *equivalence*, not about the remote "working".

The sequence, from the wire:

- `POST /api/start {"routine":"bathtime"}` → **202** `{"gen":2,"action":"start","ttl_s":45}`.
- The panel stayed **ambient for ~4 s** (the poll cadence), then announced **PROMPT**, then went to
  **countdown bathtime**, `remaining_s 295` — i.e. a 5-minute countdown, exactly as a cap press.
- A **second** start mid-countdown → **409** `{"error":"conflict","current_routine":"bathtime","offers":["replace"]}`
  — never a silent switch, same as the physical rule that the other caps are inert while one runs.
- Observed end-to-end latency ≈ **5 s**, which is simply the idle `next_poll_ms`, not a defect.

**The one observation, chased and settled.** The operator asked "I didn't see the bath time animation?" — a
fair question, because the physical press appears to show an animation. Investigation in the firmware repo
proved there is no difference to see: a remote start is converted at `lib/routine.py:112-124` into exactly the
tuple `("press", cap)` that a button handler produces, and from there it takes the identical PROMPT/HANDOFF
render path. The only animation-like draw, `icons.draw_icon` (`lib/routine.py:259`), is reached *via state*,
never by the producer — so no producer can produce a different visual. What the operator actually missed is
that the **PROMPT announce is brief (~1–2 s)** and easy to lose under ~5 s of poll latency. Operator confirmed
"it worked." No defect; recorded as a UX note, not a failure.

**Still open in Phase 5:** V3, V6 (dead-window honesty — never fires late), V7 are `[MANUAL]` and need the
panel; V6 is runnable because the board polls. V8 is the deferred polish/hold list, and V2's negative case
still wants one run on a host with Docker.

## Side addition — the Homepage tile (`/tile`) and the NAS dashboard entry (2026-09-26)

Not a phase from `plan.md`: a household-dashboard affordance requested once the panel was polling live.

**Service — read-only tile.** New page `/tile` (`src/routes/tile/+page.server.js`, `+page.svelte`): the §3
mirror with the controls removed — headline + interpolated countdown + state word + the three routine caps as
inert chips. Wording comes only from `$lib/ui/format.js`, labels/artwork only from `routines.json`. It is a
**page, not an endpoint** — the sealed eight-endpoint API set is unchanged. The palette tokens moved from
`+page.svelte` into `src/app.css` (loaded once by `+layout.svelte`) so both surfaces share one source;
`tests/ui-lint.test.js` now reads `src/app.css` for the contrast check. Documented in
`specs/spec/ui/design-system.md` §9.

Gates (last run): `npm run build` pass · `npm run check` 0/0 · `npm run lint` 0 errors (23 warnings, the
usual sonarjs/security) · `npx vitest run --coverage` **31 files/… all green**, coverage stmts 94.13 / branch
85.8 / funcs 92.21 / lines 95.13 (gates 80/50/80/80). New `tests/ui-tile.test.js` (6 tests) pins "no controls",
the countdown-only-while-counting rule, the single active chip, and the SSE follow.

**NAS — Homepage (`services.yaml`, applied by the nas-goose A2A agent).** A `Galactic Unicorn` tile now sits
in the **Activity** group, in alphabetical order (DeepSeek Balance · **Galactic Unicorn** · GitHub Weekly ·
Network Health · Top MCP Tools): `href` is `https://home-display.fintechnick.com` (the drill-in) and the widget
is an **iframe of `http://nas:3009/tile`** — the DeepSeek-Balance pattern, so the tile paints the live mirror
in the house palette rather than a raw field list. A second, health-only tile under **Services** came from
Docker auto-discovery; the `homepage.*` labels were removed from **both** the NAS compose and this repo's
`docker-compose.yml`, so the duplicate is gone. NAS backups: `services.yaml.bak{,2,3}.<ts>`. Repo: PRs #1
(`/tile`) and #2 (compose labels + `deploy/homepage-services.yaml`).

**Liveness snapshot at the time (proof Phase C works).** `/api/state` from the NAS:
`panel {boot 3c7d31ff, fw 0.1.27, state ambient, online true, last_seen_s 1, threshold_s 15}`; cadence
interlock confirmed earlier (a live `curl -N /api/events` subscriber dropped `last_seen_s` from ~19 to 1).

## Tile refinements, and the firmware v0.1.28 changes (2026-09-26)

Two strands finished together: three dashboard-driven refinements to the tile (this repo), and two
household-driven changes to the panel's own behaviour (the firmware repo, delivered by OTA).

### The tile refinements — PR #5, merged `a4ad5c3`, build 31 passed

Requested after the tile had been live for a day and the operator had been reading it in anger:

1. **The liveness line is gone from the tile.** "panel: last seen 2 s ago" is noise at a glance — the point of
   the tile is *what the panel is doing*, not the heartbeat's exact age. It stays on the drill-in (§5) where
   there is room to explain it; the tile's `data-online` attribute still carries the same fact for styling.
2. **The trailing black space is gone.** The tile was `min-height: 100%`, so it stretched to whatever the iframe
   gave it and the remainder was painted black. It is now content-sized, and the deploy snippet's iframe height
   tightened from `h-80 md:h-[24rem] lg:h-[26rem]` to `h-44 md:h-48` so the frame matches the content.
3. **"Ambient IDLE" became a picture of the panel + `IDLE`.** Two things were wrong with the old idle state:
   the word "Ambient" told the reader nothing they did not already know, and a big green block read as a
   *status lamp* rather than as *the panel*. Both surfaces now render a small inline picture of the panel —
   the real 53x11 matrix, the way the hardware looks when nothing is running, with **one lit pixel in the
   top-left** — beside the single word `IDLE`. It answers "what is this thing and what does idle look like?"
   in the space the word "Ambient" used to waste.

Done through the shared formatter seam, not by duplicating markup: `mirrorHeadline` gained an `idle` flag and
both `/` and `/tile` branch on it, so the two surfaces cannot drift. `tests/ui-tile.test.js` was updated to
assert the new idle state (IDLE + the panel picture, and explicitly *no* "last seen"), and
`specs/spec/ui/design-system.md` §9 was corrected to match — it had claimed the tile shows the liveness line.

### The firmware changes — cleanup 3 → 5 min, and a ta-da instead of an alarm

Both in the firmware repo, both reported from the kitchen rather than found by a test:

- **Cleanup is 5 minutes, not 3.** The operator noticed cleanup counting down to 3. That was *by design* —
  `routines.json` has said 3 since commit `cbe3804`, alongside bathtime/booktime at 5 — so this was a change,
  not a bug: the shorter cap made cleanup feel rushed next to the other two. Now 5, matching them.
- **The completion sound is a ta-da, not an alarm.** The old `DONE_SOUND` was a 13-note repeated **square** wave
  with a hard envelope — technically a fanfare, perceptually an alarm. It is now a warm 5-note
  `G4–C5–E5–G5–C6` phrase with the last note held (0.95 s), on a **triangle** wave with a gentler ADSR
  (`attack 0.04, decay 0.08, sustain 0.85, release 0.25, volume 0.75`). The firmware's `tests/test_sound.py`
  gained two cases pinning the intent — `case_no_alarm` (no note shorter than 0.14 s, no immediate repeats) and
  `case_configured_triangle` (TRIANGLE, volume 0.75) — 14/14 pass, and the host-side
  `scripts/render-fanfare.py` preview was updated so what you hear on the Mac matches the board
  (`/tmp/fanfare.wav`: 5 notes, 1.55 s, peak 0.37 of full scale — no clipping).

### Shipping, and the OTA pickup that has not landed yet

The refinements shipped the normal way: PR #5 → merged to `main` (`a4ad5c3`) → build **31** passed → the
`main`-only `linux/amd64` image went to GHCR. Watchtower had **not** yet recreated the NAS container (it was
still `Created 15:21:46Z`, and `/tile` still served the old markup — "panel: last seen 2 s ago" and
"Ambient"), so the deploy was driven directly instead: `docker compose pull && up -d` on the NAS via the
nas-goose agent, new container `Created 17:12:13Z`. Verified on the NAS host: `/health` → `200 {"status":"ok"}`,
`grep -c 'last seen' /tile` → **0**, `/tile` → **IDLE**. The NAS `services.yaml` one-liner
(`classes: h-44 md:h-48`, backup `services.yaml.bak.20260926-130924`) was applied in the same pass.

**The firmware has not been picked up yet, and the diagnosis is worth writing down.** Release **v0.1.28** was
published `16:47:30Z` (`firmware.pack` 139210 B, `manifest.json` 2251 B); `releases/latest/download/manifest.json`
from here resolves to it (`302 → /releases/download/v0.1.28/manifest.json`, `cache-control: no-cache`). The board
is still on **`fw 0.1.27`** at 17:20Z, boot `3f7c646d`, `uptime_s 4739` (booted ~16:01Z) — and *continuous
uptime is itself the proof* that no apply happened, because a successful apply calls `_reset()` and would have
rebooted the board.

The retry logic explains the first miss and not the rest. `update_checked_at` is armed at loop start (~boot) and
re-armed per attempt (`main.py:444-461`), so the cadence was ≈16:16:20, 16:31:20, **16:46:20**, 17:01:20,
17:16:20 — the third attempt landed ~70 s *before* the release, which is the intrinsic "armed at boot, 15-min
cadence, no wall clock" near-miss. But attempts at 17:01 and 17:16 should both have seen v0.1.28 and did not.
Deferral is ruled out: ambient is neither COUNTDOWN nor HANDOFF, and `remote.busy()` is false; and a deferral
would not consume the interval anyway. So it is a **join or fetch failure** (`check_for_update` swallows and
logs, keeping current firmware), or a stale manifest — and the one line that separates them is
`no update: 0.1.27 is already running` in the board's own `update.log`: present ⇒ the fetch succeeded and served
the old manifest; **absent** ⇒ the failure is earlier. That file is only reachable over **USB serial** — the
board is a pure outbound client (exactly one `socket.socket()` in the tree, immediately `.connect()`; no bind,
no listen, no webREPL), and the server has **no** channel to nudge an update: the poll response the board reads
is `{gen, next_poll_ms, action, routine, expires_at}` and `DESIRED_ACTIONS` is closed. The server can *defer* a
check, never bring one forward. Next attempt ≈17:31; if it does not land, the options are a power-cycle (which
re-runs `boot.py`'s update check) or plugging in USB to read `update.log` — there is no remote way in.

## The OTA failure, diagnosed — the board cannot do TLS (2026-09-26/27)

The 15-minute retries above kept failing, so the board was plugged back into the Mac and probed
directly over the serial REPL. The result is not a bug in the retry logic, a bad manifest, or a
heap problem. It is one measured fact:

> **This board cannot complete a TLS handshake.**

What was measured, from the board itself (v0.1.28-era code, `fw 0.1.27`):

| Probe | Result |
|---|---|
| `getaddrinfo("github.com")` | ok — `140.82.112.3` in 17 ms |
| `TCP :443` connect | ok — 16 ms |
| LAN plain HTTP (`192.168.1.2:3009/health`) | ok |
| Internet plain HTTP (`http://example.com`) | ok — 559 B / 95 ms |
| **every HTTPS attempt** | **fails instantly as `OSError(12,)` in ~51 ms, or blocks past the 8 s watchdog and hard-resets (`reset_cause=3`)** |
| heap | not the cause — ~25 KB TLS buffers allocate fine, 64 KB contiguous allocates |

The board's own `update.log` (89,282 bytes, read over USB) is consistent: **zero** occurrences of the
then-latest version, and **103** occurrences of `no update: 0.1.27 is already running`. It had never
once read a manifest, because it could never get far enough to read one. `lib/net.py`'s
`classify_failure` also mislabels the instant `OSError(12,)` as `heap` — worth fixing for the record,
but a side issue.

Two aggravators compounded it and are now fixed too:

1. **`machine.WDT(timeout=30000)` was never honoured** — the fuse fires under 11 s regardless. So
   `NETWORK_TIMEOUT_MS = 30000` was a fiction: any check slower than ~8 s was a *reboot*, not a
   deferred check.
2. **`BOOT_WIFI_ATTEMPTS = 1`** lost the coin-flip boot join.

### The fix, all three parts

**FIX 2 (the structural one) — take TLS out of the board's update path.** Stop making the one device
that cannot do TLS the device that must. The **service** fetches the release over HTTPS on the board's
behalf and serves it over plain HTTP:

- Service: **new** `src/lib/server/firmware.js` (mirror + cache + sha256 verification) and
  `src/routes/firmware/[file]/+server.js` (`GET /firmware/{file}`), plus `config.js` /
  `.env.example` keys `FIRMWARE_UPSTREAM_BASE` (default `releases/latest/download`),
  `FIRMWARE_CACHE_TTL_S` (300) and `FIRMWARE_LOCAL_DIR` (the "serve and pack from disk" escape hatch).
- Firmware: `config.UPDATE_MANIFEST_URL` → `http://192.168.1.2:3009/firmware/manifest.json`, and a new
  `UPDATE_TIMEOUT_S = 3` that bounds **every** socket op of a fetch.

The trust story is unchanged, which is the point: the manifest still carries the pack sha256 (and one
per file), the service refuses to serve bytes that do not match it, and the board still verifies both
before anything reaches its live tree. TLS was only ever protecting "these bytes are the release's" —
the hash still does that, on the board. What the mirror added: the board no longer needs a working TLS
stack to be updatable.

**FIX 3 — the watchdog window is now honest.** Deleted `NETWORK_TIMEOUT_MS = 30000` (a fiction — see
aggravator 1). `lib/watchdog.py` now exports `WDT_MAX_MS = TIMEOUT_MS` and `clamp_timeout_ms()`, and
`arm()` clamps every request to the real ceiling, so a caller can no longer ask for a window the
hardware will not grant. `main._run_update_check` no longer widens/restores a fuse that never existed;
the update path is made *short* (plain HTTP, literal IP, 3 s per socket op) rather than *protected* by
a fuse the RP2040 ignores. `tests/test_watchdog.py` pins the new policy (no `NETWORK_TIMEOUT_MS`,
clamps at the ceiling, passes smaller through, rejects junk).

**The transport had to be rewritten for boundedness.** `urequests` owns its socket and this board's
`usocket` exposes no `setdefaulttimeout`, so it could not be bounded — and an unbounded read is
exactly what tripped the fuse. It is replaced in the update path by `lib/net.py:http_get`, a raw
socket with `settimeout` that bounds connect *and* every read, streams large bodies through a `sink`,
and takes a `read_cap`. New host tests: `tests/test_net_http.py` (7/7, against a real local
`HTTPServer`) and `tests/test_updater_fetch.py` (7/7 — fetch, refuse-https, non-200, sha256
reject, full apply-stamps-version-and-archives-rollback, same-version no-op).

**FIX 1 — the USB deploy.** `boot.py` and `lib/updater.py` are excluded from the pack, so only a USB
deploy over the Mac's serial can change them; v0.1.28 plus these three fixes were pushed that way
(see below).

### Service gates (this run, `/firmware/*`)

| Gate | Result |
|---|---|
| `npm run build` | ✓ (route emitted: `endpoints/firmware/_file_/_server.js`) |
| `npm run check` (svelte-check) | 0 errors, 0 warnings |
| `npm run lint` (prettier + eslint) | 0 errors (30 pre-existing warnings) |
| `npx vitest run --coverage` | **147 passed / 11 files**; stmts 94.58 %, branches 86.54 %, funcs 92.85 %, lines 95.65 % |
| new: `firmware.test.js` (10), `firmware-route.test.js` (7) | both green — serves, verifies, 404 shapes, 502 on sha256 mismatch / cold upstream miss, stale-served on a blip, one upstream fetch per check, local-dir mode never calls fetch |

`firmware.js` 96.7 % stmts / 100 % funcs, `+server.js` 100 % / 100 %.

## The ENOSPC was a full flash, not a big update (2026-09-27)

`OSError(28,), ENOSPC` on every update was **not** the update's flash peak. It was a full
filesystem. The board's flash FS is only **768 KB** (`os.statvfs` lies — it reported 16 MB and
was treated as unreliable for two sessions). What was on it:

| Item | Bytes | What it was |
|---|---|---|
| `:spacetest.bin` | **348,160** | the abandoned write-until-fail free-space probe; the board reset mid-probe, so it was never removed |
| `:prev/` + `prev.json` | **~170,000** | a rollback slot left behind after the release it judged was rolled back |
| `*_tmp.py`, `ntp-probe.txt` | ~4,000 | REPL scratch from earlier sessions |

Free was **120 KB** — smaller than the **171,845-byte** pack — so `_download` failed with
`OSError(28)` before unpacking anything. Clearing the leftovers took free to **483 KB**, and the
next boot then ran `applied 0.1.33 (171845 bytes, 16 files)`. The OTA mechanism was fine; the flash
was full. (PR #7's peak reduction is still a real improvement, just not the cause.)

The release tree itself was already correct: **all 16 manifest files hash-identical** on the board
(`main.py e000531d`, `config.py 8d876b70`, `lib/net.py 19ea59d6`, `lib/remote.py 6f2a0cad`, …), and
v0.1.33 is now the running firmware.

**Two firmware bugs fixed** (`lib/updater.py`, USB-deployed — it is excluded from the pack):
one leftover pack is enough to turn one ENOSPC into a permanent loop, so `_update` now sweeps
`:incoming.pack` + `:next/` before spending any flash and `check_for_update` cleans up on failure
(previously only `_run` did); and `_recover` now drops the `:prev/` slot once the release is proven
(`boot-ok == version`), instead of leaking it forever. New host tests: `test_recover.py` 5/5,
`test_updater_fetch.py` 8/8, full firmware suite green.

**Rollback fragility, still open:** the good release was rolled back twice as "it never came up",
because `main.py` writes `boot-ok.txt` only after 10 s of loop (`BOOT_OK_SOAK_MS = 10000`, > the 8 s
watchdog) and the protocol gives a release exactly one chance. One flaky first boot — a low-heap
`MemoryError`, a radio wedge, or a reset inside the window — discards a release that is fine.

**Still open (the blocker):** the board is back in the deaf-radio wedge + WDT reset loop —
`poll failed … OSError(110,) link=True status=3`, `radio cycle did not recover the radio`, and it is
network-unreachable (`ping 192.168.1.63` → 100 % loss) while reporting link up. `radio_reset` cleared
this once (14:33, reported success) but not now. See `/tmp/HANDOFF-radio.md`.

## The OTA path is proved end-to-end, and the in-loop check had a heap bug (2026-09-27, session 3)

The sweep fix merged as **77c5bfc** (PR `fix/updater-sweep-staging`), a lint fix followed
(**f1bf659**, ruff `PLR1730` at `lib/remote.py:604`, which is what broke Buildkite #55/#56), and
Buildkite **#57 went green**. The Release step then cut **v0.1.34** on its own — the pack hash had
changed because `lib/remote.py` changed (boot.py / lib/updater.py are excluded from the pack).

**v0.1.34 taken over OTA, on the real board.** The board's boot-time check (boot.py, fresh heap)
applied it: `applied 0.1.34 (172775 bytes, 16 files)`, new boot id, and — this is the fix being
exercised — the next boot's `_recover` cleared the pending attempt and **dropped the rollback
slot**. Read back over the raw REPL:

| file / slot | value | meaning |
| --- | --- | --- |
| `version.txt` | `0.1.34` | running release |
| `boot-ok.txt` | `0.1.34` | soaked 10 s and proved itself |
| `boot-try.txt` | **absent** | `_recover` cleared it on the next boot |
| `:prev/`, `prev.json` | **absent** | the ~170 KB slot is no longer leaked |
| `:next/`, `:incoming.pack` | absent | staging swept |
| free | **479232 / 786432** | back to healthy (was 236 KB in the ENOSPC spiral) |

So the ENOSPC spiral is closed on hardware, not just in host tests.

**New bug found: the IN-LOOP update check cannot allocate.** Its turn came 15 min after the loop
started and failed:

```
update: update check failed, keeping current firmware: MemoryError('memory allocation failed, allocating 3840 bytes',)
```

while `gc.mem_free()` read **93488**. The check fits under the fuse (that was the earlier fix) but
not under a *fragmented* heap: the loop holds the display, engine and remote live, so the ~2.2 KB
manifest fetch/parse cannot get one contiguous block. The **same check at boot.py** (fresh heap)
fetches that manifest fine — which is exactly why an update could always land at boot but never
from the running app. Fixed with one `gc.collect()` before the check in `main.py:_run_update_check`
(the same thing `_attach_remote` already does, and the reason it does it). Full firmware suite green,
ruff clean; merged **8d20976**, Buildkite **#58/#59 green**, Release cut **v0.1.35** (pack changed:
`main.py` is in the pack).

**v0.1.35 taken over OTA too.** `applied 0.1.35 (173397 bytes, 16 files)`, `fw=0.1.35`,
`free=121232`, NTP synced on attempt 1. And the fix is confirmed on the board: the next in-loop
check, 15 min after the loop started, logged

```
update: no update: 0.1.35 is already running
```

— it completed the fetch/parse, with **no MemoryError**. That line is the first time the running
app's update check has ever got as far as reading the manifest.

**The radio is still the wildcard.** The immediate v0.1.35 attempt failed first
(`update failed, keeping current firmware: OSError(110,)`, `ntp: attempt 3/3 failed
([Errno 110] ETIMEDOUT)`) while the board reported `status=3(up) ip=192.168.1.63 rssi=-39` — and
`ping 192.168.1.63` from the host was 100 % loss. Minutes later the same board answered ping and the
same boot check applied the pack. So the wedge is **intermittent, not terminal**: the update path
works whenever the radio has a window, but nothing yet predicts the window. Driving the board's
REPL needs `mpremote`'s Ctrl-C to land, which it does not while `main.py` is looping; a direct
pyserial `Ctrl-C` + `Ctrl-D` (and a raw-REPL peek) does, and the armed 8 s watchdog then resets the
board a few seconds later — the soft reset that lands an update.

## A release now gets several boots, and the updater finally went over USB (2026-09-27, session 4)

**The rollback fragility is fixed — priority #1.** The old protocol rolled a release back on the
*first* boot where `_recover` saw `boot-try == version` and `boot-ok != version`. One bad boot was
enough, and a boot that merely *looked* bad (a slow radio join, an in-loop update that applied, a
Ctrl-C) could cost a perfectly good release. The rule now gives it several:

| constant | value | meaning |
| --- | --- | --- |
| `BOOT_FAILS_MAX` | 3 | judged boots a release gets before rollback |
| `boot-fails.txt` | counter | spent one per judged boot, cleared on proof / rollback |

`_mark_attempt` (which runs in `updater.run()`'s `finally`, so it is counted on every boot path)
spends one boot; `_recover` only rolls back once the counter has reached `BOOT_FAILS_MAX`; the proven
path and `_rollback` both clear it. `tests/test_recover.py` drives the real `_recover`/`_mark_attempt`
pair across boots and asserts the rollback lands at `MAX + 1` (and that a late `boot-ok` still keeps
the release). Merged **a2075b6** → **1ded1a3**, Buildkite **#60 green**, Release cut **v0.1.36**
(`main.py` is in the pack, so the hash changed).

**`lib/updater.py` is excluded from the pack, so the fix could not be delivered over OTA — it had to
go over USB.** This is the deploy that had been failing for two sessions: `mpremote` cannot interrupt
`main.py`'s loop (its Ctrl-C does not land), and every pyserial approach fought an 8 s hardware fuse
— `main.py` feeds the watchdog from the render loop, Ctrl-C stops that loop, and the fuse fires
~6–8 s later, usually mid-transfer.

**The lever that unsticks it: a feeder thread.** In the REPL, start a `_thread` that pets the fuse,
and the window is gone:

```
import _thread, machine, time
def _feed():
    w = machine.WDT(timeout=8000)
    while True:
        w.feed()
        time.sleep(0.4)
_thread.start_new_thread(_feed, ())
```

Measured: a 12 s sleep in the REPL after starting it returned `ALIVE_AFTER_12S` — no reset. With that,
`/tmp/push.py` writes the file as 18 idempotent `:up_N` chunks (`wb`, so a retried chunk cannot
double-append — the old lost-ack bug is impossible by construction), concatenates on the board,
streams a sha256 over the result, and only on a match does `os.rename(':updater.new', 'lib/updater.py')`
and sweep. Two heap lessons from the first attempts: `hashlib.sha256(open(f).read())` on a 27 KB file
raises `MemoryError` even with a healthy `gc.mem_free()` — the hash must be streamed in 1 KB reads —
and this MicroPython's `hashlib` has no `hexdigest()`, so it is `ubinascii.hexlify(h.digest())`.

**Landed and verified on the board:**

| check | result |
| --- | --- |
| board-concat sha | `430de2fd…` == host sha |
| `lib/updater.py` after rename | `430de2fd…` (was `71a3284e…`) |
| `updater.BOOT_FAILS_MAX` | `3` — the new constant is live |
| `:up_*` / `:updater.new` | `leftover_ups 0`, `tmp_left False` |
| free | 225280 → **450560** (53 stale chunk files swept) |
| boot after | `fw=0.1.36`, `boot-ok=0.1.36`, `boot-try`/`boot-fails` absent |

So the temp-file cleanup and the deploy were the same pass, and the board was left running normally
(`update: no update: 0.1.36 is already running`, watchdog armed at 8000 ms).

**Also fixed: a successful in-loop update was being written up as a crash.** An apply calls
`updater._reset()` → `machine.soft_reset()`, which asks for the reboot by *raising* `SystemExit`.
`boot.py` had a clause for that; `main.py` did not, so every successful in-loop apply fell into the
`BaseException` handler and wrote `crash.log` with `File "/lib/updater.py", line 370, in _reset /
SystemExit:` — poisoning the one file kept for finding out why the loop really died. Fixed in
**77113cf**, which re-raises rather than swallowing, and that difference is measured, not assumed:

```
>>> try: machine.soft_reset()
... except SystemExit: print('CAUGHT')
CAUGHT
>>>          # still at the REPL — catching SystemExit CANCELS the reboot
```

`boot.py` can swallow it because `boot.py` then falls through and runs the freshly-applied `main.py`;
in `main.py` there is nothing after the block, so swallowing would cancel the reboot, end the module
and leave the board at the REPL with the loop gone (the watchdog hard-resetting it 8 s later).

**Debt this session added to the list:** `boot.py`'s `except SystemExit: pass` still carries a comment
saying the exception "asks for the reboot that starts the firmware it just applied" — measured, no
reboot happens there; the fall-through to `main.py` is what runs the new tree (with `config` left
stale in `sys.modules`, since only `main.py` is re-read). That comment needs a USB deploy to correct,
so it is batched for the next one.

**v0.1.37 taken over OTA and stuck** (the fix shipped from CI, not from this desk). The Release
step cut **v0.1.37** (`firmware.pack: 174992 bytes, 16 files`, and `main.py` is in the pack list —
`boot.py`/`lib/updater.py` are not). The service's manifest cache rolled over to the new release and
the board's boot check applied it while the radio had a window:

```
update: applied 0.1.37 (174992 bytes, 16 files)
unicorn: BOOT galactic-unicorn / rp2040 fw=0.1.37
```

The download took ~12 s — over the 8 s fuse — which is why `_download` feeds the watchdog. Read back
after the soak and then after the next boot (which ran `_recover`):

| marker | first read | after next boot |
| --- | --- | --- |
| `version.txt` | 0.1.37 | 0.1.37 |
| `boot-ok.txt` | 0.1.37 | 0.1.37 |
| `boot-try.txt` | 0.1.37 | **absent** — `_recover` cleared it |
| `:prev/`, `prev.json` | present (4 top-level: 3 files + `lib/`) | **absent** — slot dropped |
| free | 204800 | **446464** |

So the release proved itself on the following boot and gave its ~170 KB back: the protocol working as
designed, on hardware, for a release shipped through CI.

One caveat on the SystemExit fix, for the record: it cannot be hardware-verified yet. The board that
applied 0.1.37 in-loop-on-boot was still running **0.1.36's** `main.py`, so the handler that would
have written the false `crash.log` was the *old* one. The fix protects applies made *by* 0.1.37+, so
the first real exercise is the next release applied by a running 0.1.37 (its in-loop check), and the
signal to look for is a clean reboot with `crash.log` left absent.

## The wedge watchdog: recovery from outside the board (2026-09-27, session 4)

The CYW43 "deaf radio" wedge is now the only thing blocking unattended updates, and it has a
property that decides the whole design: the board **cannot ask for its own recovery** — the radio it
would ask over is the broken part. So the power-cycle had to be driven from outside, and the service
is the natural owner because the board already polls it every few seconds. `/device/poll` records
`received_at`, `getLiveness()` derives `last_seen_s`, and a wedge is simply "no poll for N seconds" —
a detector that already existed, with **nothing new to deploy on the board**.

`src/lib/server/powercycle.js` adds:

  * the Kasa (TP-Link) legacy protocol — autokey-XOR cipher, 4-byte length framing, relay command —
    as pure functions, so the bytes are unit-testable without a plug on the bench;
  * `decideWedgeAction`, the pure decision table: disabled and online are answered *before* any clock
    is consulted, then a quiet threshold, a per-wedge cycle budget and a cool-down;
  * the monitor, started from `hooks.server.js`'s `init` — an interval that is a no-op unless
    `POWER_CYCLE_ENABLED` is set, so build analysis arms nothing.

**A power-cycle is the last resort, not the first.** `radio_reset` clears the wedge sometimes
(observed 14:33) and not others, so it cannot be a guarantee; a cycle always works but costs a reboot,
a wifi join and the panel's state, so it waits 180 s of quiet (well past the 15 s offline threshold,
so the board's own retries get a real chance), is budgeted at 2 per wedge, and is held to a 600 s
cool-down so a board still booting is not cut again. It is ordered **off, hold, on** rather than a
toggle, so it is correct whatever state the plug was in. The same two edges are the instrumentation
the plan asked for: `wedge went quiet` and `wedge recovered after Ns quiet` are written to the audit
log, turning "when did the window close" from a recollection into a record.

159/159 service tests pass (12 new), prettier and eslint clean (warnings only, the same
`detect-object-injection` class the existing `readNumber` already produces).

**Not yet enabled, and why.** A read-only `get_sysinfo` sweep of `192.168.1.0/24:9999` from both the
dev container and mac-studio found no Kasa device, so the plug is either not powered, not on this
subnet, or a different model. `KASA_HOST` therefore has to be supplied; the documented env file now
carries the whole block (`POWER_CYCLE_ENABLED`, `KASA_HOST`, `KASA_PORT`, `POWER_CYCLE_STALE_S`,
`POWER_CYCLE_COOLDOWN_S`, `POWER_CYCLE_MAX`, `POWER_CYCLE_OFF_MS`, `POWER_CYCLE_CHECK_MS`), and
turning it on is a two-line change once the address is known.

## The plug is at 192.168.1.66 — and it speaks TCP, not UDP (2026-09-27, session 5)

With the address supplied, the plug answered immediately — but not over the transport the monitor was
written for, which is the kind of thing only a live probe finds:

| probe from mac-studio | result |
| --- | --- |
| `ping 192.168.1.66` | 0 % loss, 2.9 ms — the host is up |
| ARP | `50:c7:bf:74:77:35` — TP-Link OUI |
| UDP `9999` `get_sysinfo`, ×3 | **silent** (all three) |
| UDP discovery `20002` / `9999` | **silent** |
| TCP `9999` connect | **open** |
| TLS handshake on `9999` (1.2 and 1.3) | 0 bytes read — not TLS |
| **legacy XOR frame over TCP `9999`** | **answers**: `{"system":{"get_sysinfo":{...,"model":"HS100(US)"}}}` |

So the same 4-byte-length + XOR framing the module already had comes back over **TCP** while UDP is
dead, and `get_sysinfo` decodes to a real device:

```
alias       : Galactic Unicorn
model       : HS100(US)
sw_ver      : 1.2.6 Build 200727 Rel.120528
hw_ver      : 1.0
mac         : 50:C7:BF:74:77:35
relay_state : 1        # on, and the board has been up ~23 h
```

The first sweep "found nothing" for a duller reason too: the dev container sits on `192.168.215.0/24`
and never could reach `192.168.1.0/24` — but the **service container can**, which is the vantage that
matters, and it reaches the plug at `192.168.1.66:9999` as well. So the monitor's own network view is
sound; only the transport was wrong.

`powercycle.js` was fixed to speak TCP: `dgram` → `net`, connect, write the frame, and reassemble the
reply from the stream. The reassembly is a pure helper, `tryReadKasaFrame(buf)`, so the split-header
and split-body cases are unit-tested without a socket — 4 new tests, 163/163. Verified live: a
throwaway vitest probe drove `kasaCommand` against the real plug from the service container and read
`HS100(US)` / `err_code 0`. `docker-compose.yml` now forwards the eight `POWER_CYCLE_*`/`KASA_*` vars
with safe defaults, because Compose passes nothing it is not told to and the arming has to be a
NAS-side `.env` change.

**Arming it** was a two-line change once the address was known — see below.

### Armed (2026-09-27, same session)

The write path was proven without cutting power first: `relayCommand(true)` sent to the already-on
plug returned `{"system":{"set_relay_state":{"err_code":0}}}` and `relay_state` stayed `1` — the exact
command `powerCycle()` sends, accepted and a no-op. Then it was armed on the NAS.

- main got the fix (merge `3030a36`); Buildkite **#44 passed** (`build` → `docker_smoke` →
  `docker_publish`) and published `ghcr.io/nickbrett1/galactic-unicorn-remote:latest` at 19:10:48 UTC.
- The NAS project `/volumeUSB1/usbshare/docker/galactic-unicorn-remote` (a plain compose project, not
  a git checkout) had its `environment:` block and `.env` set for the watchdog, then was recreated:
  container env now carries `POWER_CYCLE_ENABLED=1`, `KASA_HOST=192.168.1.66`, `KASA_PORT=9999`,
  `POWER_CYCLE_STALE_S=180`, `POWER_CYCLE_COOLDOWN_S=600`, `POWER_CYCLE_MAX=2`,
  `POWER_CYCLE_OFF_MS=5000`, `POWER_CYCLE_CHECK_MS=15000`, with `DEVICE_TOKEN` intact.
- Startup logs `[powercycle] watching: cycle 192.168.1.66 after 180s quiet, cool-down 600s, max
  2/wedge`; `/health` is `{"status":"ok"}`.
- The container image ID (`sha256:ab08f758…`) **equals** the published `latest` (built 19:10:48,
  recreated 19:18:44), so it is the TCP build and not a stale pull.

So the last-resort recovery is live and watching. It stays a no-op until the board is silent for 180 s;
the first genuine wedge is the first real exercise, and the `wedge went quiet` / `wedge recovered`
edges it writes to the audit log are the instrumentation to read afterwards.

## Board-side instrumentation: the wedge journal (2026-09-27, session 5)

The watchdog closes the loop from *outside*, but the service can only ever see **that** the panel went
quiet — the poll heartbeat stops. **Why** it went quiet is board-side knowledge the service cannot
reach, and the board cannot shout it over the radio that is broken. Two more things conspire to
destroy the evidence: the REPL scrolls away, and a CYW43 wedge usually ends in a **WDT hard reset**
(`reset_cause=3`, a latch) that takes RAM counters with it.

So the board now keeps its own bounded flash trace, `lib/wedge.py`, in the same shape as the existing
`lib/wifihealth.py`:

  * a **header per boot** (lazily, on the first event) naming the boot id and reset cause, so a reset
    loop reads as a wall of headers rather than one ambiguous session;
  * a **line per failed poll** — `cause` (`classify_failure`'s heap/link/other verdict), the
    exception, `heap_free`, `link`, `status`, engine `state`, and the running failure count;
  * a **line each time a radio cycle is requested and each time its outcome is known**
    (recovered / not);
  * a **recovery line** naming the length of the run that just ended.

A healthy board writes nothing — events are failures and cycles, not the poll cadence.

The part that crosses the boundary: the journal also keeps **per-boot counters** (class tallies,
cycles attempted/recovered, peak run, runs) and `remote.py` carries a compact summary of them back
over the wire. `reconcile.build_report` grew an optional `wedge` field and `poll_path` emits it, so
the **next successful poll** hands the service the board's own account of the same quiet window. The
service stores it unparsed (`/device/poll` accepts the param, `recordObserved` keeps it) — only the
board can classify its own failures, so the service relays the string rather than interpreting it.

7 new host tests in `tests/test_wedge.py` (header per boot, class counts and run/peak, cycle scoring,
the summary shape, the recovery line, the byte cap, and never-raises), picked up automatically by the
CI glob; 13/13 firmware test files pass. `ruff`/`pytest` green expected on the pipeline. The service
side adds one accepted param and two tests (164/164). Firmware on main `60dc536`.

## Multi-boot rollback: verified on real hardware (2026-09-27, session 6)

The last firmware behaviour that existed only as host tests. `tests/test_recover.py` drives the real
`_recover`/`_mark_attempt` pair 8/8, but no board boot had ever been forced to fail `BOOT_FAILS_MAX`
times, so the counting and the `MAX+1` rollback were unproven on the device.

The test laid out a genuine protocol state on the board and let the board heal itself:

  * `:prev/main.py` + `prev.json` held the board's **own** running `main.py` (sha `951ab68…`, the same
    bytes the service mirror serves), so the tree the rollback lands is genuinely runnable;
  * `version.txt=0.1.38`, `boot-ok.txt=0.1.37` — a "pending" release that has NOT proved itself;
  * `main.py` was replaced with a **poison** release: it appends its state to `rb_trace.log`, arms the
    8 s watchdog and hangs, so the board resets ITSELF with no one touching it (each reset is
    `reset_cause=3`, a WDT hard reset);
  * `UPDATE_MANIFEST_URL` was pointed at a dead port for the window — the mirror still reports
    `0.1.37`, so a live fetch would downgrade-apply over the test. Recovery (phase 1) runs regardless.

The durable per-boot trace (immune to the USB re-enumeration each reset causes) came back:

    POISON_BOOT version.txt=0.1.38 boot-ok.txt=0.1.37 boot-try.txt=0.1.38 boot-fails.txt=1
    POISON_BOOT version.txt=0.1.38 boot-ok.txt=0.1.37 boot-try.txt=0.1.38 boot-fails.txt=2
    POISON_BOOT version.txt=0.1.38 boot-ok.txt=0.1.37 boot-try.txt=0.1.38 boot-fails.txt=3

i.e. the release ran three judged boots, the counter advancing one per boot exactly as
`_mark_attempt` intends, and never wrote `boot-ok`. The **next** boot rolled back:

    update: rolled back from 0.1.38 (it did not come up in 3 boots) to 0.1.37

and came up as the good `main.py` (`unicorn: BOOT … fw=0.1.37`, `reset_cause=3`). Final durable state
matches every branch: `version=0.1.37`, `boot-ok=0.1.37` (proven again by the restored loop's soak),
`boot-try.txt`/`boot-fails.txt` **gone**, `:prev`/`prev.json` **gone**, no `bad.txt` (no blacklist).
Board restored: `config.py` re-read, test files removed, `main.py` sha `951ab68…`, 472 KB free, no
leftover `:up_*`/`:main*` temp files.

So the boot-side sequence — `boot.py` → `updater.run()` → `_recover()` (phase 1, before any network)
→ `_mark_attempt()` in the `finally` — is now proven end to end on the device, across real resets,
for the decision that matters: a flaky first boot is survived, and a release that cannot prove itself
on `BOOT_FAILS_MAX` boots is rolled back on the boot after.

## 0.1.38 is on the board; the wedge journal is live (2026-09-27, session 6)

The board was still on 0.1.37, so the wedge journal was shipped but not running. It is now deployed
and the instrumentation is live, confirmed from both ends:

  * `boot.py` applied it: `update: applied 0.1.38 (184354 bytes, 17 files)`, rebooting into
    `unicorn: BOOT galactic-unicorn / rp2040 fw=0.1.38`;
  * `version.txt=0.1.38`, `boot-ok=0.1.38` (proven after the soak), `lib/wedge.py` present
    (sha `1f266b56…`), `wifi.log` header now `fw=0.1.38`;
  * the service sees `panel.fw=0.1.38, online=true, last_seen_s=6` — the board is polling again.

Surfaced the tally on the read side too: `buildStateSnapshot` now relays `observed.wedge` verbatim
(like `remaining_s`), so the board's own account of a quiet window is visible in `/api/state` without
the server parsing it. `tests/backend.test.js` asserts it end to end; 164/164.

**Incident, recorded because it is the kind of thing this board punishes.** Restoring `config.py`
after the rollback test, the cleanup wrote
`open('config.py','w').write(open('config.py.bak').read())` — Python truncates `config.py` when the
`open(...,'w')` is evaluated, before the read, so a missing/empty backup would have left it 0 bytes;
it did. With an empty `config.py`, `updater._run` sees no `UPDATE_ENABLED` and returns before
recovery *and* the update — the board silently stopped polling (the service showed `last_seen_s` at
~1001 s) and no update could ever land. Recovered from the release pack itself:
`config.py` carries **no secrets** (they live in the gitignored `config_secrets.py`, which the pack
never touches), so the pack's `config.py` was restored to the board by USB — sha `8d876b70…`,
identical to the manifest — and the next boot applied 0.1.38. The lesson: never write a file from a
reader of the same file in one expression; and a packed `config.py` is the recovery source of truth.

### The wire path, closed end to end (same session)

Redeployed the NAS container onto the new image (`ab08f758… → aad139fc…`, via nas-goose; `.env`
untouched, `POWER_CYCLE_ENABLED=1`/`KASA_HOST=192.168.1.66` preserved, `/health` ok, startup log now
reads `max 2/wedge`). With that, `/api/state` shows the board's own tally live:

    panel.fw = 0.1.38   online = true   last_seen_s = 5   uptime_s = 354
    panel.wedge = 'heap0.link0.other6.cy2.rec2.pk3'

So the whole path is proven on hardware: `lib/wedge.py` journals on the board → `remote.py` emits
`wedge=` on the poll → `/device/poll` accepts it → `recordObserved` stores it → `buildStateSnapshot`
relays it → `/api/state`. And the tally is not a placeholder: 6 classified poll failures, 2 radio
cycles attempted, **2 recovered**, peak run 3 — the deaf-radio wedge is occurring and the deferred
cycle is recovering it about as often as it fires.

### The in-loop SystemExit fix, verified on hardware (2026-09-27, session 6)

`main.py` gained an `except SystemExit:` clause in `77113cf` (shipped in v0.1.37) so that an update
which applies *while the loop is running* — `check_for_update` → `_update` → `_reset` →
`machine.soft_reset()`, which asks for the reboot by RAISING `SystemExit` — is not written up by the
`BaseException` handler as "MAIN DIED". It was never exercised on hardware: 0.1.38 was applied by
`boot.py`, which has had its own `SystemExit` clause since the beginning. This is the task that was
left open, and it is now done.

**Method.** Staged a synthetic release on the LAN mirror and let the *running loop* pick it up, so
`boot.py` never touches it — no reboot from us, no GitHub release, no firmware change. Used the
service's documented operator escape hatch: `FIRMWARE_LOCAL_DIR=/fwstage` (plus a `:ro` bind mount)
makes `/firmware/*` read from disk instead of mirroring the release. The manifest's version was
bumped so the board's in-loop check finds `version != local`; the pack was built from the real 0.1.38
pack, so the applied bytes are identical to what is running.

**Observed — twice, independently** (second run after clearing a stale `crash.log`), on the console:

    update: applied 0.1.99 (897 bytes, 1 files)
    unicorn: reboot to finish an update - not a crash, crash.log left alone
    MPY: soft reboot
    update: no update: 0.1.99 is already running
    unicorn: BOOT galactic-unicorn / rp2040 fw=0.1.99

and then the same for `0.1.100`. No `MAIN DIED` on either. **`crash.log` is ABSENT** — the assertion
holds on real hardware. (Before the repeat, a *stale* `crash.log` from the `config.py`=0-bytes
incident was present; its content was that `AttributeError`, not a `SystemExit`, so the in-loop apply
had never written it — but it was deleted first so the check is judged against a clean slate.)

**Restored.** The applied label was synthetic and the pack carried only `routines.json`
(byte-identical), so the tree was genuine 0.1.38 throughout. Afterwards: `version.txt`/`boot-ok.txt`
back to `0.1.38`, the test's rollback slot and counters cleared, and `main.py` / `config.py` /
`lib/wedge.py` re-hashed against the 0.1.38 manifest (`951ab681…` / `8d876b70…` / `1f266b56…`) — all
match. The mirror was returned to upstream (`FIRMWARE_*` removed, `fwstage/` deleted, serves 0.1.38).

### …and the reason it took narrowing: a real bug, the in-loop check OOMs on a full release

With the real 17-file release staged, the in-loop check failed **three times in a row**, identically:

    update: update check failed, keeping current firmware:
    MemoryError('memory allocation failed, allocating 4352 bytes',)

It is not the manifest text: a 2377-byte manifest and an 1854-byte *minified* one both failed with the
**same 4352 bytes**, while a 250-byte manifest + 897-byte pack applied cleanly. So the allocation
tracks the pack / file set, not the manifest size. Consequence: **in-loop OTA of a real release is
effectively broken on this board** — only `boot.py`'s check (fresh heap, ~120 KB free, no live display
yet) can apply a full release, which is exactly why the `SystemExit` clause went unnoticed for
releases. `_run_update_check` already `gc.collect()`s before the fetch, so this is not the documented
fragmentation fix, half-done.

Next step to pin it: `check_for_update` logs only `repr(exc)`, so the traceback must come from a
USB-deployed `lib/updater.py` (excluded from the pack, so no OTA needed). Prime suspects, both run
only for a multi-file release and both absent from the 1-file case that succeeded: `_archive_current`
reads every managed file **whole** into RAM (`data = fh.read()`; the biggest packed files are
`main.py` 29968 B, `remote.py` 27629 B, `net.py` 24824 B), and `_unpack` builds a 17-entry expected
map. 4352 matches no packed file size exactly, so the allocation is still unpinned. Also noted while
watching: the deaf-radio wedge (`OSError(110)`/`(104)`, `isconnected()` True with a valid lease)
drives the deferred cycle every few minutes, and the first `_attach_remote` after a boot can still
`MemoryError` at 640 bytes before the built-in retry recovers it.

## The board is on the plug; `reset_cause` goes on the wire (2026-09-28, session 7)

The board is now powered from the Kasa at `192.168.1.66` and **not** from the mac-studio, which
retires the one caveat the watchdog carried from the start: with the USB cable in, VBUS diode-ORs
into VSYS and the relay's off-window does nothing — the recovery would have been decorative for as
long as the board was also on the bench.

**A deliberate one-off cycle, and the plug is real.** The plug was driven through the same protocol
`powercycle.js` uses (off → hold 5 s → on) and the board watched through `/api/state` every 2 s:

    plug      relay_state 1 -> (OFF 02:23:19.8, ON 02:23:24.9) -> 1 ; on_time 5169 s -> 4 s
    board     boot e7eebbf4 -> 57b3060c ; uptime_s 756 -> 0 ; online false for ~6 s at last_seen 23 s
    firmware  0.1.40 before and after

`on_time` resetting is the proof the relay genuinely toggled (a toggle on an already-on plug would
have left it running), and the boot-id change with `uptime_s` back to 0 is a real cold boot, not a
wifi rejoin — dead ~22 s end to end, ~17 s of that power-on to first poll. `fw` stayed 0.1.40, so it
cold-booted onto the OTA-applied pack: the radio-recovery throttle is **live**, confirmed against the
mirror (0.1.40's pack carries `config.py` and `lib/remote.py`; `boot.py` and `lib/updater.py` are
still USB-only). Wedge tally after: `heap0.link0.other0.cy0.rec0.pk0`.

One operational note worth keeping: a **manual** off-window longer than `POWER_CYCLE_STALE_S` (180 s)
also reads as a wedge to the monitor, which cannot tell a bench test from a real one. Ad-hoc cycles
stay under three minutes, as this one did.

**The gap this exposed: `reset_cause` was not observable off-board.** It is not in the poll contract,
and now that the plug occupies the only micro-USB port there is no console to read it on either — so
"is the WDT latch cleared?" was unanswerable exactly when it started to matter. The fix is to let the
board **say** it on the next successful poll, the same trick `lib/wedge.py` already uses to get its
account of a quiet window across a radio that is broken.

Firmware (`galactic-unicorn`): `remote._reset_cause()` reads `machine.reset_cause()` **once**, at
`Remote.__init__` — it is a latch about the *previous* boot and cannot change while we run, so it is
not re-read per poll; absence of the call is `None`, not an error. `reconcile.build_report` grew an
optional `reset_cause` field on the existing reuse-safe pattern (cleared when not supplied, 0 kept as
a value), and `poll_path` emits it when present. 5 new host tests: 3 in `tests/test_reconcile.py`
(carried, zero-is-a-value, cleared on reuse) and 2 in `tests/test_remote.py` (path carries it, path
omits it when unknown). Firmware suites green.

Server: `/device/poll` accepts an optional, bounded `reset_cause` (0–15; MicroPython's ladder is
1 PWRON, 2 HARD, 3 WDT, 4 SOFT, 5 DEEPSLEEP, so the bound is room, not a guess) and stores it
verbatim; `buildStateSnapshot` relays it as `panel.reset_cause`; the type and the pinned contract are
brought in line. While adding the optional-int parse the shared shape was factored into
`readOptionalInt` (also folding `remaining_s`/`rssi`/`uptime_s`), which removed a
`sonarjs/cognitive-complexity` warning rather than adding one. 2 new tests; 166/166.

**Left honestly open.** (1) Whether the deaf-radio wedge was ever a real hardware state or partly an
artefact of the USB console — every wedge seen in the debugging sessions followed a console
interrupt, and the console is now gone, so the suspected trigger is no longer present. (2) The
in-loop OTA of a *full* release still OOMs (previous entry); a firmware change therefore lands via
`boot.py`'s check on a reboot, which is also the path 0.1.40 took.

### Addendum: the plug gives reboots, not deployments

0.1.41 was released (pack 191289 B, 17 files) and the mirror serves it, but the board stayed on
0.1.40 through **both** routes. It was power-cycled from the plug and came back clean (boot
`57b3060c` -> `fccc36d1`, wedge zeroed) still on 0.1.40 — so `boot.py`'s check did **not** apply a
full release either, which is not what the earlier entry assumed. Then, with the release waiting and
the mirror up, uptime ran past `UPDATE_RETRY_MS` (15 min) with no reset and no apply: the in-loop
`check_for_update` did not land it, which is the known full-release OOM rather than a missing fetch
(same host:port as the poll, so the manifest is reachable).

So the plug is a reliable **reboot** button — twice out of twice, relay `on_time` resetting both
times — but not a deployment path. Getting `reset_cause` live needs a USB deploy of the pack-
included `lib/remote.py` and `lib/reconcile.py`, which means moving the cable back to the mac-studio
and giving the plug's socket up. Until then `panel.reset_cause` stays absent, and the field's whole
purpose — seeing a `WDT_RESET` without a console — is still prospective.

### Closed: `panel.reset_cause` is on the wire

The USB deploy landed (`lib/remote.py` 7998d618…, 33451 B; `lib/reconcile.py` 7ef62bec…, 13256 B,
verified by board-side sha256) and the board's console banner confirmed the read:
`wifi: === boot fw=0.1.40 reset_cause=3 free=99168 ===`. But `/api/state` still showed no
`reset_cause`, because the NAS container was still the **pre-change** image — `parsePollReport` of
that build simply ignores the unknown query parameter.

The reason was not the board: the registry *had* the new image
(`ghcr.io/nickbrett1/galactic-unicorn-remote@sha256:78b5f3cc…`, built 2026-09-28T11:19Z) while the
running container was pinned to the previous one (`…@sha256:5a4e7c53…`, 2026-09-27T21:39Z, matching
commit `718502d`). Watchtower had **not** recreated it, despite the
`com.centurylinklabs.watchtower.enable=true` label and both `watchtower` and `watchtower-nick`
up and healthy for two days. It was ~14 h stale. That is the second time the label has not produced
a recreate, and it is worth not relying on: `docker compose up -d` in
`/volumeUSB1/usbshare/docker/galactic-unicorn-remote` (NAS ssh is on port **2222**, not 22) pulled
`78b5f3cc…` and recreated the container in one step.

Result, end to end and stable across repeated polls:

    panel.fw=0.1.40  panel.boot=bfa2bf22  panel.online=true  panel.reset_cause=3

`reset_cause=3` is `WDT_RESET` — the latch says the **previous** boot ended in the watchdog. That
boot followed the clean power cycle of the previous entry, i.e. an ordinary running boot, not a
deliberate `machine.reset()`. So the render loop blocked past the 8 s watchdog on a normal uptime,
and the new field surfaced it on its first outing: the exact thing it was built to make visible
without a console is now visible without one.

One loop still open: the board runs 0.1.40 with only the two USB-deployed files from 0.1.41, so the
tree is a hybrid. A future full release still needs `boot.py` (excluded from the pack) to apply it,
and that path did not work in the previous entry's test.

## In-loop OTA of a full release was never a heap problem (2026-09-28, session 8)

The carried item read "in-loop OTA of a *full* release OOMs (`MemoryError`) while a one-file pack
applies". That is not what the board says. `cat :update.log` on the board shows the same failure
repeated for the 0.1.41 release, and it is not the heap at all:

    File "/lib/updater.py", line 731, in _update
    File "/lib/updater.py", line 420, in _unpack
    OSError: 28

`OSError(28)` is ENOSPC, in the write of `:next/`. The `MemoryError` was a real failure too but it
belongs to the *manifest* fetch (already mitigated by the `gc.collect()` in `_run_update_check`), and
it had been carried forward as if it explained the pack.

The arithmetic is the whole story, and it was measurable from the outside. The pack is 191289 B (47
blocks of 4096) and the files it carries total 190934 B (47 blocks). The old shape downloaded the
pack to `:incoming.pack` and unpacked it afterwards, so live + pack + `:next` were resident at once:
94 of the board's 98 free blocks, leaving four. Four is not headroom littlefs can commit metadata
in, which is exactly why the failure landed *inside* `_unpack` and not at the end. A one-file pack
applied fine because 47 blocks of that peak went away with it - and that is the way out, because the
pack was always the one part that is re-downloadable.

**The fix** (`galactic-unicorn` 01107f6, plus 28d3438 for a lint gate): `_download` + `_unpack`
become `_stage` + `_PackSink`, a small state machine over the length-prefixed records, and the body
is written straight into `:next/` as it arrives. The pack never lands on flash. The usual argument
for the two-step - verify the pack before unpacking it - does not survive the ordering that actually
matters: nothing touches a live file either way and `:next` is discarded on any failure, so a bad
pack costs a wasted download whether the sha is checked first or last. Kept: the per-file sha
against the manifest, the manifest's file LIST against what the pack actually carried, the read cap,
the fuse feed throughout, and the "a non-200 is reported as an HTTP status, not as a pack error"
rule, now via a drain wrapper so an error page cannot put "truncated pack" in the log when the
server said 500.

Measured on the host before shipping it, exact high-water mark by snapshotting the tree after every
mutating syscall, both versions driven end to end against the real 0.1.41 on the LAN mirror:

    old  applied 0.1.41   live=233662  peak=+373586
    new  applied 0.1.41   live=233662  peak=+193089

191 KB less resident at the peak - the whole pack. On the board that is 94 of 98 free blocks
becoming 47 of 98. Tests: the two `_download` cases become four `_stage` cases (streams and verifies
every file; refuses a wrong pack sha, a truncated body, and a pack missing a file the manifest
promised - the last is the only one the LIST check can catch, and the suite had no coverage for it).
12/12, and every other firmware suite still green.

### Confirmed on the board: the board took a full OTA release by itself

`lib/updater.py` was USB-deployed (board sha `95edbd3e…`, 42721 B - it is pack-EXCLUDED by design, so
this is the only way it ever moves), the board rebooted, and its own check landed the release. First
time a full 17-file release has reached this board over the air.

    update.log   applied 0.1.41 (191289 bytes, 17 files)
                 no update: 0.1.41 is already running
    version.txt  0.1.41        boot-ok.txt  0.1.41
    :prev :next :incoming.pack   all absent; crash.log absent
    free blocks  103 of 192

And the tree is the release, not something that merely claims a version: every one of the 17 files on
the board hashes to the manifest's sha256 (`main.py` 951ab681…, `lib/net.py`, `lib/wedge.py` and the
14 others - 17/17). The rollback slot was dropped after the boot, as `_recover` is meant to.

### The reset-loop was the console, not a new fault

During the deploy the board looked like it was reset-looping: every boot reported
`reset_cause=3`, and the USB CDC re-enumerated under a new node. It is an artefact of the debugging
itself, and it is worth writing down so it is not chased again. Attaching to the board means Ctrl-C,
which kills the render loop; the loop is what feeds the fuse, so 8 s later the watchdog cuts the
board down - and `machine.reset_cause()` on the *next* boot dutifully reports 3. One console session
therefore plants one WDT latch on the following boot, which is also why an earlier session read
`reset_cause=3` after a clean power cycle and concluded the render loop had blocked: that reading was
most likely this same planted latch. The wedge tally in that window shows the radio doing its job
(`other3.cy1.rec1` - three link timeouts, one cycle attempted, one recovered), not a second fault.

`lib/updater.py` still needs one more USB deploy so the board's copy matches HEAD (`28d3438` adds
only a `# noqa: SIM115` and its reason); behaviour is identical.

## The planted latch retired itself on the next clean boot (2026-09-28, session 8)

The console-plants-a-latch reading was left as probable, not proven, because the earlier ordering could
not be reconstructed. It is proven now, by the board saying so unprompted. With the USB cable handed
back to the Kasa plug - no console attached, no Ctrl-C anywhere near the render loop - the board's next
boot reports `reset_cause=1`, `PWRON_RESET`, on a brand-new boot id:

    boot=2e8ba5c0 fw=0.1.41 rc=1 uptime=105 online=True wedge=heap0.link0.other0.cy0.rec0.pk0
    boot=2e8ba5c0 fw=0.1.41 rc=1 uptime=125 online=True wedge=heap0.link0.other0.cy0.rec0.pk0
    boot=2e8ba5c0 fw=0.1.41 rc=1 uptime=145 online=True wedge=heap0.link0.other0.cy0.rec0.pk0

Sampled through `/api/state` on the NAS. The same board, the same release, the same everything except
the console - and the WDT residue is simply gone. `reset_cause` is a latch about the *previous* boot,
so a console session's `3` is spent the moment a boot happens without one; the honest reading was
always one power cycle away. Nothing about the render loop, the watchdog, or the radio was ever at
fault, and the wedge tally stays all-zero across all three samples.

The 0.1.41 that this boot is running is also the OTA-landed one, so the power cycle is the final proof
that the release persisted: `version.txt` and `boot-ok.txt` survived plug power with the rollback slot
already dropped. Both open items from this session are closed, and `lib/updater.py` on the board now
matches HEAD (`0f68edcc…`, 43099 B, after `28d3438`), so no further USB deploy is outstanding.

## Side addition — the idle-only scrolling message (2026-09-28, session 9)

The board can now show a **short line of text scrolling across its idle screen** — "Dinner in ten",
"Bath's ready". Like the weather indicator, this is **not a phase from `plan.md`**: an affordance requested
once the panel was live. It is modelled as idle-screen **content**, not a device event (memo §3; there is
still no fifth event): a third slot with its own monotonic id and a server-side TTL, invisible to the
reconcile loop and to `gen`.

**Idle-only, at every layer.** `POST /api/message` returns 503 `panel_offline` when the panel is offline and
409 `panel_busy` when it is not idle (`commands.js::runMessage`, gated by `reconcile.js::canShowMessage`);
the composer in `+page.svelte` is rendered only while `online && state === 'ambient'`; and the board draws
the banner only in `AMBIENT`. The markup short-circuit is a courtesy — the server is the rule.

**The slot.** `state.js` gains `message { id, text, expires_at }` + a `messageSeq` counter that moves **no
`gen`**; `reconcile.js` gains the pure rules (`isValidMessageText`, `isMessageLive`, `canShowMessage`) and a
fourth `nextPollMs` demand input (`messageActive`). `device/poll` relays a live banner to the board and
**drops it** on TTL elapse, on the board reporting anything other than `ambient` ("dropped: panel left the
idle screen"), or on a new boot id ("discarded: panel rebooted before the message landed") — so a banner can
never reappear stale over a countdown. `snapshot.js` exposes `message` on `StateSnapshot`; the board echoes
the id it is drawing back as `Observed.message_id`.

**Sent-vs-done still holds (memo §9.1).** The banner's 202 carries an `id`, not a `gen`; `ui/command.js`
confirms "showing on the panel" **only** when the reported `message_id` equals the id this phone sent. A
busy 409 is `not_idle` — "the panel isn't idle — messages only show when it is" — and, unlike a routine
conflict, offers **no Replace**.

**Validation.** Printable ASCII only (0x20–0x7e), ≥ 1 non-blank char, ≤ `MESSAGE_MAX_LEN` (default 60, from
`config.js`); newlines and non-ASCII are 422s because the panel's LED font has no glyph for them. The value
is **never echoed back** — the UI shows the panel's acknowledged text, never a copy of what was typed.

Gates (last run): `npx vitest run` **13 files / 213 tests all green** · `npm run lint` **0 errors** (47
warnings, the usual sonarjs/security, plus the pre-existing poll complexity) · `npm run check` **0 errors /
0 warnings** · prettier clean. Documented in `specs/spec/ui/design-system.md` §10, `api/device-protocols.md`
§3.0, the OpenAPI, `event-flow.md`, `state-layout.json`, `domain-models.ts` and `audit-log-schema.sql`.
