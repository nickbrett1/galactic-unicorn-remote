# The device protocol — the shared board ↔ server contract

**In scope for this repo.** The board's firmware (`lib/remote.py`, `lib/routine.py`, the pure
reconcile function) is a **separate repo** and out of scope; the HTTP contract they share **is** in
scope and is pinned here. Sources: memo §3, §5, §6, §7.2; stack-memo §1, §3.

The contract is **purely HTTP**. The board does one `GET` with query parameters and parses a few
hundred bytes of JSON. It shares **no code, no schema module and no test vector** with the server —
which is exactly why the service could move from FastAPI to SvelteKit late and cheaply, with no
firmware change (stack-memo §1).

---

## 1. The one request, the one response

```
GET /device/poll
      ?token=<device token>
      &boot=<boot id>
      &fw=<firmware version>
      &applied_gen=<n>
      &state=<ambient|prompt|countdown|handoff>
      &routine=<bathtime|booktime|cleanup>   # only in countdown/handoff
      &remaining_s=<n>                       # only in countdown/handoff
      &rssi=<dBm>
      &uptime_s=<n>
      &wedge=<tally>                         # the board's own failure tally
      &reset_cause=<n>                       # how the PREVIOUS boot ended
      &temp_c=<n>                            # whole degrees C, sent WITH condition
      &condition=<sun|partly|cloud|fog|rain|snow|thunder>   # the board's own sky
      &message_id=<n>                        # the idle banner the board is drawing, if any
```

```jsonc
// 200 OK — desired state AND the cadence
{ "gen": 18, "action": "start", "routine": "bathtime", "next_poll_ms": 2000 }

// 200 OK — with an idle banner live, the board also scrolls this text
{ "gen": 18, "action": "none", "next_poll_ms": 2000,
  "message": { "id": 4, "text": "Dinner in ten" } }
```

- **Request is a `GET` with query parameters** — no body to serialise, and `urequests.get` is the call
  the board already makes (memo §5.1).
- **Response is a few hundred bytes.** The board applies a **hard byte cap on every read** and
  `gc.collect()`s before the request; the largest contiguous heap block is 16 KB (memo §16, §6.3).
- **`action` ∈ `start` | `cancel` | `none`.** `none` is a valid, idempotent answer: nothing should be
  true that isn't. It is what the server returns when there is no desired state or the TTL expired.
- **`message` is idle-screen content, not a fifth device event.** When present it carries a short text
  the board scrolls across the **idle (AMBIENT) screen** — the one screen the panel has for content —
  plus a monotonic `id`. It is deliberately *not* a `gen` command: it moves no counter and touches no
  slot the board reconciles a button against. It travels the way the weather does, relayed on the
  poll the board already makes, and the board acknowledges it by reporting the `id` it is drawing as
  `message_id`. Absent means "no banner" — the normal idle screen. A banner can only be set while the
  panel is idle (refused otherwise, §3.0) and is dropped the moment it expires or the board reports it
  has left AMBIENT.
- **`token`** is a shared secret, defence in depth only. Its exact transport (query parameter vs
  header) is an **open decision** (description.md §6.4); this spec proposes the query parameter above
  because the request is already a query-parameter GET and it adds nothing to MicroPython. It is
  **never** a real boundary — anyone on the LAN could press the physical button (memo §10).
- **The server validates every query parameter and never echoes input into the response** (memo §10).

The server's machine-readable view of this endpoint is
`api/galactic-unicorn-remote-openapi.yaml` → `GET /device/poll`.

---

## 2. The four events — the whole of the remote's vocabulary

`lib/remote.py` produces **exactly four events**, and nothing else (memo §3):

| Event | Physical equivalent | Panel behaviour |
|---|---|---|
| `bathtime` | ROUTINE button A | starts the bathtime lead-in countdown |
| `booktime` | ROUTINE button B | starts the booktime lead-in countdown |
| `cleanup` | ROUTINE button C | starts the cleanup lead-in countdown |
| `reset` | **D** | cancels, in PROMPT, COUNTDOWN and HANDOFF |

The remote is **not a feature** — it is a second producer of the button events the state machine
already handles (memo §0, §3):

```
        physical buttons --+
                           +--> lib/buttons.py --> event (A|B|C|D) --> lib/routine.py
        lib/remote.py -----+
```

Because the remote is only an event producer, everything the toddler-proofing work established holds
unchanged **for free** (memo §3):

- ROUTINE buttons are **inert during COUNTDOWN** — a remote "book time" while bathtime counts down
  does nothing on the panel: no silent switch, no lost countdown.
- **D is live in every active state**, so a remote cancel works from PROMPT, COUNTDOWN and HANDOFF.
- Cancel stays **silent**; a remote cancel must not play a tune.
- PROMPT plays the routine's tune, so a **phone-triggered countdown sounds identical** to one started
  at the panel. The child must not be able to tell the difference.

**Scope follows from this.** The honest statement of v1 is: *the phone can press A, B, C and D.*
Every capability the panel does not have the remote cannot have either without inventing a new event.
`+2 min` is deferred for exactly this reason: it needs a new `extend` event, not a button mimic
(memo §12).

**One deliberate exception — the countdown length (T6).** A parent may choose **1, 3, 5 or 10
minutes** for a *remote-started* countdown (default 5). This is not a fifth event: the length is
**data riding alongside the `start`** the way `routine` already does, so the board's event
vocabulary, the panel's child-proofing rules, `gen`, TTL and boot-id clearing are all untouched. It
is fenced exactly like the idle banner (§3.0): bounded (four values), inert (it starts nothing the
routine button would not), per-command and **never persisted**. A physical press sends no length at all and so keeps the
routine's own `routines.json` `minutes` — byte-identical to the button it mimics.

**This is why conflict handling lives on the server (§5 below).** The panel keeps its simple,
child-proof rules and gains no notion of "a remote override". If the phone wants to replace a running
countdown, the *server* orchestrates cancel → wait → start.

---

## 3. Two slots, one counter

```jsonc
// the server holds (desired):
{ "gen": 18, "action": "start", "routine": "bathtime", "minutes": 3, "expires_at": <server epoch> }

// the board reports on every poll (observed):
{ "boot": "9f3c1a22", "fw": "0.2.0", "applied_gen": 18,
  "state": "countdown", "routine": "bathtime", "remaining_s": 214,
  "rssi": -41, "uptime_s": 3820,
  "wedge": "heap0.link0.other0.cy0.rec0.pk0", "reset_cause": 1,
  "temp_c": 18, "condition": "partly", "message_id": 4 }
```

The **banner slot** (below) is the one idle-screen *content* slot the server holds alongside the
desired slot, and `message_id` is the board's acknowledgement of it — not a `gen` and not an event.

- **`gen` is a monotonic counter both sides agree on** (memo §5.1). The board persists `applied_gen`
  to flash (a few writes a day — wear is a non-issue) and **ignores anything `<= applied_gen`**.
- **`minutes` is the remote-chosen countdown length — on a `start` only** (T6). One of
  `1 | 3 | 5 | 10`, default `5`; data alongside the `start`, never a fifth event, so it moves no `gen` and is never
  persisted. The board applies it to the countdown it starts; **absent (or invalid) falls back to the
  routine's own `routines.json` `minutes`**, which is what a physical press does. The server always
  sends an explicit integer — the board's fall-back exists only for an older server.
- **No clock is involved on either side.** This keeps v1.5 §6's "the countdown must not depend on
  NTP" true by construction. There is no `expires_at` comparison on the board at all — the TTL is a
  **server-side** construct.
- **`remaining_s` is the board's figure**, from the same `ticks_ms` countdown v1.5 §6 built. The
  server relays it and the browser interpolates between polls. The server **does no timing at all**
  (memo §5.3).
- **`next_poll_ms` is server-set**, one integer in a body the board already parses (memo §5.1, §6.3.5).

- **`wedge` and `reset_cause` are board-side facts, relayed verbatim.** Neither is parsed, recomputed
  or interpreted by the service. `wedge` is the board's own tally of poll failures and radio cycles
  (firmware `lib/wedge.py`); `reset_cause` is `machine.reset_cause()` — **how the previous boot
  ended** — read once per boot. `1` is a cold start (`PWRON_RESET`) and `3` is the watchdog latch
  (`WDT_RESET`) that upstream work chased for days. The service sits on the far side of the radio the
  board cannot shout over, so a field carried back on the next **successful** poll is the only way
  either one is ever visible from off-board; without it, telling a cold start from a watchdog reset
  needs a USB console, and a panel that is powered from a smart plug has no console port left.

- **`temp_c` and `condition` are the idle screen's weather, relayed verbatim.** The board polls
  Open-Meteo itself (`lib/weather.py`), classifies a WMO code into one of seven conditions, and
  reports the reading it is drawing. The service **must not** call a weather API of its own: a page
  and a panel each fetching their own could disagree about a sky that is only happening once, so the
  reading is carried on the poll the board already makes and merely passed through. The two travel as
  a **pair** — a temperature with no condition has no glyph behind it, and a condition with no
  temperature has no number — so a lone half is a `422` naming the missing field, and both absent is
  the normal "the board has no reading yet", not a failure. The remote page and the Homepage tile
  render the same indicator from the same relayed pair (and the same glyph masks as the firmware), so
  neither can drift from the panel.

### 3.0 The idle banner slot (idle-only content)

A parent can ask the panel to **scroll a short message across its idle screen**. This is the one
capability the remote adds that is not a button mimic, and it is fenced accordingly:

- **Idle-only, at every layer.** The server refuses to set a banner unless the panel is reachable AND
  reporting `ambient` (`POST /api/message` → 503 offline, 409 `panel_busy` otherwise); the UI offers
  the composer only on the idle screen; and the board draws it only in AMBIENT. A scroll over a
  running countdown would say nothing true, so it never happens.
- **Content, not an event.** A banner is *what should be on the idle screen*, so it is relayed on
  every poll (like `temp_c`/`condition`) and carries a monotonic `id`. It is **not** a fifth entry in
  the four-event vocabulary, moves no `gen`, and is invisible to the reconcile loop.
- **Server-side expiry, no board clock.** The banner has its own `expires_at` (server construct,
  `MESSAGE_TTL_S`), and the server stops sending it once it lapses; the board never compares a time.
  A banner is also dropped the instant the board reports it has left AMBIENT, so it cannot reappear
  stale after a countdown.
- **Confirmed by the board.** The board reports the `id` it is currently scrolling as `message_id`;
  the UI goes "sending…" → "showing on the panel" only when that id matches — the same
  sent-vs-done rule the four panel controls obey (§9.1).
- **Bounded and inert.** Text is short (≤ `MESSAGE_MAX_LEN`), printable ASCII only, and is never
  echoed into a response.

### 3.1 Restart safety, both directions

- A **fresh server** re-seeds `gen` from the `applied_gen` the board reports, **plus one**, so it can
  never sit below the board's high-water mark (memo §5.1).
- The **board** re-reports `applied_gen` from flash after its own reboot.
- **Neither side can wedge the other**, which a clock-based scheme could not promise. Getting this
  wrong wedges the system silently: the panel ignores everything and merely looks "offline"
  (memo §11.6).

### 3.2 New `boot` id clears pending desired (and the banner)

The **server clears pending desired state the moment it sees a new `boot` id** (memo §5.6). Two
independent guards make "the panel reboots and immediately re-runs the last command" impossible:
this clearing, and the persisted `applied_gen`. The **banner slot is cleared alongside it** — a
message that was scrolling before a reboot must not resume on a panel nobody is watching. The server
logs boot-id changes, which informally makes this service the panel's health monitor
(memo §5.6, §11.5).

**No auto-resume, deliberately:** a countdown that reappears after the child has moved on is worse
than one that quietly ended (memo §5.6).

---

## 4. Why reconciliation, and not a command queue

A queue needs **acks, ordering, retry-on-not-acked and duplicate suppression** — four things.
Reconciliation needs **one comparison** and gets idempotence for free (memo §5.2): a lost response, a
duplicated poll, or a reconnect mid-exchange all converge on the same place, because the device is
told *what should be true*, not *what to do next*. With exactly one device there is no ordering
pressure worth buying a queue for.

### 4.1 TTL, not a queue — and the honest failure mode

A lead-in countdown exists to say *"bathtime in five minutes"*. Started four minutes late it says
something false, to a three-year-old, at the wrong moment. So pending desired state **expires after
~45 s** and is dropped on the floor (memo §5.4). A command arriving during a dead window **does not
queue up and fire later** — it fails, and the UI says so (memo §9.1). 45 s ≈ 15 poll intervals:
generous enough to ride out a hiccup, far too short to be wrong later.

**The exact TTL constant is an open decision** (description.md §6.4); treat ~45 s as the design
intent.

---

## 5. The conflict policy the server enforces

The panel's rules are ground truth, so the server resolves (memo §5.5):

| Panel is… | Phone asks for… | Server does |
|---|---|---|
| ambient | start X | set desired: start X |
| counting down X | start X | **nothing** — already true; UI shows "already running" |
| counting down X | start Y | UI shows the conflict and offers **"replace"** explicitly; replace = cancel, wait for `state: ambient` reported, then start. **Never a silent switch.** |
| counting down | cancel | set desired: cancel (= D) |
| ambient | cancel | nothing |
| handoff | cancel | works — D is live in HANDOFF |
| **unreachable** | start X | UI refuses *before* setting anything, and says the panel is offline |

---

## 6. The cadence (server-directed, demand-driven)

Every poll response carries `next_poll_ms`; the board obeys it, clamped by the floors in its
`config.py` (memo §5.1, §6.3.5). The server computes it from four things it already knows:

| Condition | `next_poll_ms` |
|---|---|
| desired not yet applied (`gen > applied_gen`) | ~2000 |
| a countdown or HANDOFF is active | ~2000 |
| **a live SSE subscriber is connected** | ~2000 |
| **a live banner is up** (§3.0) | ~2000 |
| none of the above | **~5000** |

Opening the page is itself the signal of intent, so the panel is already polling fast when a button
is tapped. Read "anyone watching" from a **live subscriber count**, not from "a page was loaded"
(memo §11.7).

**The interval is a *ceiling on how stale an empty house may be*, not a knob to optimise**
(memo §11.2). Relaxing idle to 15 s would "save" bandwidth that costs nothing while making "open the
site, press Start" visibly slow.

**The server's clamp values are an open decision** (description.md §6.4); the board-side floors and
ceilings live in the board's `config.py` (memo §6.3.5, §11.10).

---

## 7. Liveness comes free from the poll

There is no heartbeat message and no separate liveness endpoint: "last seen Ns ago" **is** the poll
(memo §4). The server derives `panel.online` / `panel.last_seen_s` from the most recent poll and
surfaces them in `GET /api/state` and over SSE. The UI shows it continuously, and it is what makes
the "sent vs done" rule enforceable (memo §9.1). The offline cut-off is an open decision
(description.md §6.4).

---

## 8. The invariant the board must satisfy (and which shapes this contract)

Stated in the firmware memo as an invariant, and relevant to the server because the server must not
assume otherwise (memo §6.3):

> **No network operation may delay a frame of an active countdown, and no network operation may fail
> for a reason the panel has to guess at.**

Consequences that touch the contract:

1. The poll gets a tight budget (~1–1.5 s) — `socket.settimeout` / `select`, with a capped read.
   The measured precedent is a ~30 s stall in the existing update path (memo §11.3).
2. **No *join* during COUNTDOWN or HANDOFF — but the poll continues**, because withdrawing it would
   remove remote Cancel at the one moment it exists for. Continuing costs a bounded ~1–1.5 s in the
   loop, not risk to the timer (the countdown is `ticks_ms`-based and never touches the network).
3. The update check is deferred out of COUNTDOWN too.
4. Heap before network: `gc.collect()` before the request, a hard byte cap on the response, and no
   per-poll allocation in the reporting path.
5. A bad window's *symptom* can be reported as a network error when it is really the heap, so "the
   poll failed" must be logged with enough context to tell those apart (memo §6.2, §11.15). The
   server's job here is to **record what the poll last reported and when**, not just that it is quiet
   (memo §9.1).

---

## 9. The pure reconcile function — where it lives, and what is tested where

The board keeps the reconciliation decision **pure** — a function of `(desired, applied_gen,
current_state)` with **no sockets** — in its own module, and unit-tests it on the host under
**pytest** (memo §6.4). This matters more than usual because the board has **no emulator**: the pure
function is the only part of the firmware testable without a flash and a look.

This repo has its **own** suite, under **vitest**, testing its **own** pure functions — TTL, `gen`
ordering, conflict policy, `next_poll_ms` (stack-memo §5). **The two suites are separate and neither
replaces the other**: the board's tests a pure function in Python, the service's tests its own in
TypeScript.

> A green `ruff check` does not prove the board can parse the code — ruff's `py37` floor is well
> above MicroPython 1.19.1's subset. It is a lint, not a parser (memo §6.4).

---

## 10. Failure modes the server must render honestly

| Board situation | Wire evidence | Server / UI |
|---|---|---|
| Dead network window mid-run | poll stops arriving | `online: false`; a command is refused before being set (memo §5.5) |
| Command arrived during the window | desired set, TTL expires, `applied_gen` never advances | "the panel didn't answer (last seen 3m ago)" — plainly (memo §9.1) |
| Board rebooted | new `boot` id | pending desired cleared; change logged (memo §5.6) |
| Board's `gen` high-water ahead of server (fresh server) | `applied_gen > gen` | re-seed `gen = applied_gen + 1` (memo §5.1) |
| Heap failure, not link failure | poll fails while the radio is up with an address | logger records what the poll last reported and when (memo §11.15) |
| Duplicated or lost poll response | — | converge, because the device is told what should be true (memo §5.2) |

---

## 11. Adjacent, and *not* part of this contract: `/firmware/*`

The board also talks to the service for firmware updates, at
`http://192.168.1.2:3009/firmware/manifest.json` (and the pack it names) — but that is **not** this
protocol. It is a bare plain-HTTP `GET` on the board's own slow timer, not a poll; it carries no
token, no `gen` and no reconciliation, and the response is the release's own artifact, byte for byte.

It is here for one measured reason: the **board cannot complete a TLS handshake**. On 2026-09-26 the
board was probed directly and DNS, `TCP:443` and plain HTTP (even to the internet) all work, but
*every* HTTPS attempt fails instantly as `OSError(12,)` or blocks past the hardware watchdog and
hard-resets the panel — so the old GitHub-over-HTTPS manifest URL could never be read. The fix is
structural: the **service**, which has a working TLS stack, fetches the release over HTTPS on the
board's behalf and serves it over plain HTTP. The board's update path now talks only to the host it
already talks to every second.

The trust story is unchanged, and that is the point: the manifest still carries a sha256 for the pack
and one per file, the board still verifies both **before** anything reaches its live tree, and the
mirror refuses to serve bytes that do not match the manifest. The only thing TLS was ever protecting
here — that the manifest and pack are the release's — is still protected, by the hash, on the board.
See `src/lib/server/firmware.js`, `src/routes/firmware/[file]/+server.js` and the OpenAPI path
`GET /firmware/{file}`.
