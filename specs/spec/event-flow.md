# Event flow — the event vocabulary

Two families of "event" exist in this project, and they must not be conflated:

| Family | Where | Cardinality | Defined by |
|---|---|---|---|
| **Device events** | inside the firmware's state machine | exactly **4** | memo §3; shared vocabulary, but produced by the board |
| **Wire/UI events** | `GET /api/events` (SSE) | a closed set of frame types | this repo |

There is no message bus, no queue and no event broker anywhere in the design (memo §5.2).

---

## 1. The four device events (the remote's entire vocabulary)

`lib/remote.py` produces **exactly four events** — `bathtime`, `booktime`, `cleanup`, `reset` — and
nothing else. This is the whole of v1's scope: *"start a timer and cancel only — just mimic the
buttons"* (memo §3). They are **not** events on the wire as such: the board carries them as the
`action` + `routine` of a desired-state application, and as the panel state it reports back.

```jsonc
// The trigger the server sends, as desired state:
{ "gen": 18, "action": "start",  "routine": "bathtime" }   // => device event `bathtime` (button A)
{ "gen": 18, "action": "start",  "routine": "booktime" }   // => device event `booktime`  (button B)
{ "gen": 18, "action": "start",  "routine": "cleanup"  }   // => device event `cleanup`   (button C)
{ "gen": 19, "action": "cancel" }                          // => device event `reset`     (button D)
```

| Event | Physical key | Effect on the panel | Semantics |
|---|---|---|---|
| `bathtime` | A | start the bathtime lead-in countdown | PROMPT plays the routine's tune; identical to a physical press (memo §3) |
| `booktime` | B | start the booktime lead-in countdown | as above |
| `cleanup` | C | start the cleanup lead-in countdown | as above; id `cleanup`, label "Cleanup" on both surfaces (memo §12) |
| `reset` | **D** | cancel | live in PROMPT, COUNTDOWN and HANDOFF; silent; a no-op in AMBIENT |

**Invariants:**

1. ROUTINE events (`bathtime`/`booktime`/`cleanup`) are **inert during COUNTDOWN**. A remote
   "book time" while bathtime runs does nothing on the panel — no silent switch, no lost countdown.
2. `reset` is live in **every active state** (PROMPT, COUNTDOWN, HANDOFF).
3. `reset` stays **silent** — a remote cancel must not play a tune; the phone carries the
   acknowledgement instead (memo §3, §11.13).
4. **No fifth event exists, and inventing one is out of scope.** `+2 min` would need an `extend`
   event, which is exactly why it is deferred (memo §12).

**No event ordering, retries, acks or dedup are carried by this vocabulary** — the reconciliation
model supplies all of that with one comparison (memo §5.2). See `api/device-protocols.md`.

---

## 2. Observed-state report (the board's other wire content)

Not an event — a snapshot, sent on every poll. Frame content is the `Observed` type in
`data-architecture/domain-models.ts`:

```jsonc
{ "boot": "9f3c1a22", "fw": "0.2.0", "applied_gen": 18,
  "state": "countdown", "routine": "bathtime", "remaining_s": 214,
  "rssi": -41, "uptime_s": 3820 }
```

Two of these fields are event-*like* because a change in them is meaningful and is logged:

| Field change | Meaning | Server action |
|---|---|---|
| `boot` differs from the last seen value | the panel rebooted | **clear pending desired**, audit `action='boot'`, mirror to AMBIENT (memo §5.6) |
| `applied_gen` reaches the current `gen` | the command landed | audit `outcome='applied'`; the UI may confirm (memo §9.1) |
| `state` changes | progress through the state machine | mirror update; cadence input (memo §6.3.5) |

---

## 3. Browser wire events — SSE on `GET /api/events`

A SvelteKit `+server.js` route returning a `ReadableStream`; `adapter-node` must not buffer it
(stack-memo §2). Required headers and behaviour (memo §11.7):

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

- **Heartbeat:** an SSE comment (`:hb`) every **~15 s**, because proxied connections idle out around
  100 s (memo §11.7).
- **Fallback:** a 2 s poll of `GET /api/state`, **indistinguishable to the user** if SSE misbehaves.
  The exact fallback route shape is an **open decision** (description.md §6.4).
- **Subscriber count** feeds `next_poll_ms`, and must come from a **live** subscriber count, not from
  "a page was loaded" (memo §11.7).
- **Tested through the tunnel early, in Phase D** (memo §11.7, §13).

### 3.1 Frame types (a closed set)

| `event:` name | `data:` payload | Emitted when |
|---|---|---|
| `state` | the `StateSnapshot` (see OpenAPI) | on connect, then on every observed-state change / desired change / liveness change |
| `audit` | an audit row (see `audit-log-schema.sql`) | when a command's outcome is decided (`accepted` / `applied` / `expired` / `conflict` / `refused_offline` / `noop` / `shadowed`) |
| *(comment)* `:hb` | — | every ~15 s |

```text
event: state
data: {"type":"state","state":{"panel":{"boot":"9f3c1a22","fw":"0.2.0","applied_gen":18,"state":"countdown","routine":"bathtime","remaining_s":214,"online":true,"last_seen_s":2},"desired":{"gen":18,"action":"start","routine":"bathtime","expires_at":1758720045},"routines":[{"id":"bathtime","label":"Bathtime","symbol":"duck"},{"id":"booktime","label":"Booktime","symbol":"book"},{"id":"cleanup","label":"Cleanup","symbol":"toy-box"}],"door":{"kind":"tunnel","email":"ts.akhtar@gmail.com"}}}

event: audit
data: {"type":"audit","seq":41,"at":"2026-09-24T14:20:03Z","action":"start","routine":"bathtime","outcome":"applied"}

:hb
```

- Unknown frame names must be **ignored, not errored** (forward compatibility).
- A client that misses frames **re-syncs from `GET /api/state`** — the stream is a convenience, not a
  source of truth.
- The `door.email` field is **display/audit only** (memo §8.3); the UI shows it as "signed in as …"
  and never derives a capability from it.

---

## 4. Logging / audit events

Every command's outcome is a durable row (`audit-log-schema.sql`), which is what turns "it didn't
work" into a record rather than an argument (memo §7.3, §9.1):

| `action` | `outcome` values | Answer it supports |
|---|---|---|
| `start` | `accepted`, `applied`, `expired`, `refused_offline`, `conflict`, `noop`, `shadowed` | "did it work?" |
| `cancel` | as above (`noop` when nothing was running) | "did the cancel land?" |
| `replace` | `accepted`, `applied`, `expired`, `conflict` | "did the switch happen, and was it asked for?" |
| `boot` | `noop` (informational) | "when did the panel reboot?" (memo §5.6) |
| `poll` (optional summary) | — | network-window churn, and **what the poll last reported and when** (memo §9.1, §11.15) |

**Never logged:** the device token, WiFi credentials, the Access JWT, or any credential (memo §10).
The Access **email** may be logged, for display and audit only.

---

## 5. What "event" deliberately does not mean here

- **Not a command queue.** There is no ack, no retry-on-not-acked, no duplicate suppression — the
  device is told *what should be true*, and every path converges (memo §5.2).
- **Not a durable stream.** SSE frames are ephemeral; a reconnect may miss them and re-syncs from
  `/api/state`.
- **Not a bus.** Nothing subscribes to the board except the server, and the board subscribes to
  nothing (memo §2, §4).
- **Not MQTT.** Replaced by polling for the trigger path; MQTT remains the right answer for phase-3
  ambient cards, which are out of scope here (memo §1).
