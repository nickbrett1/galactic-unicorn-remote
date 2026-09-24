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
```

```jsonc
// 200 OK — desired state AND the cadence
{ "gen": 18, "action": "start", "routine": "bathtime", "next_poll_ms": 2000 }
```

- **Request is a `GET` with query parameters** — no body to serialise, and `urequests.get` is the call
  the board already makes (memo §5.1).
- **Response is a few hundred bytes.** The board applies a **hard byte cap on every read** and
  `gc.collect()`s before the request; the largest contiguous heap block is 16 KB (memo §16, §6.3).
- **`action` ∈ `start` | `cancel` | `none`.** `none` is a valid, idempotent answer: nothing should be
  true that isn't. It is what the server returns when there is no desired state or the TTL expired.
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
Every capability the panel does not have — extending a countdown, editing durations — the remote
cannot have either without inventing a new event. `+2 min` is deferred for exactly this reason: it
needs a new `extend` event, not a button mimic (memo §12).

**This is why conflict handling lives on the server (§5 below).** The panel keeps its simple,
child-proof rules and gains no notion of "a remote override". If the phone wants to replace a running
countdown, the *server* orchestrates cancel → wait → start.

---

## 3. Two slots, one counter

```jsonc
// the server holds (desired):
{ "gen": 18, "action": "start", "routine": "bathtime", "expires_at": <server epoch> }

// the board reports on every poll (observed):
{ "boot": "9f3c1a22", "fw": "0.2.0", "applied_gen": 18,
  "state": "countdown", "routine": "bathtime", "remaining_s": 214,
  "rssi": -41, "uptime_s": 3820 }
```

- **`gen` is a monotonic counter both sides agree on** (memo §5.1). The board persists `applied_gen`
  to flash (a few writes a day — wear is a non-issue) and **ignores anything `<= applied_gen`**.
- **No clock is involved on either side.** This keeps v1.5 §6's "the countdown must not depend on
  NTP" true by construction. There is no `expires_at` comparison on the board at all — the TTL is a
  **server-side** construct.
- **`remaining_s` is the board's figure**, from the same `ticks_ms` countdown v1.5 §6 built. The
  server relays it and the browser interpolates between polls. The server **does no timing at all**
  (memo §5.3).
- **`next_poll_ms` is server-set**, one integer in a body the board already parses (memo §5.1, §6.3.5).

### 3.1 Restart safety, both directions

- A **fresh server** re-seeds `gen` from the `applied_gen` the board reports, **plus one**, so it can
  never sit below the board's high-water mark (memo §5.1).
- The **board** re-reports `applied_gen` from flash after its own reboot.
- **Neither side can wedge the other**, which a clock-based scheme could not promise. Getting this
  wrong wedges the system silently: the panel ignores everything and merely looks "offline"
  (memo §11.6).

### 3.2 New `boot` id clears pending desired

The **server clears pending desired state the moment it sees a new `boot` id** (memo §5.6). Two
independent guards make "the panel reboots and immediately re-runs the last command" impossible:
this clearing, and the persisted `applied_gen`. The server logs boot-id changes, which informally
makes this service the panel's health monitor (memo §5.6, §11.5).

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
`config.py` (memo §5.1, §6.3.5). The server computes it from three things it already knows:

| Condition | `next_poll_ms` |
|---|---|
| desired not yet applied (`gen > applied_gen`) | ~2000 |
| a countdown or HANDOFF is active | ~2000 |
| **a live SSE subscriber is connected** | ~2000 |
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
