# Load model — sizing, rates and retention

**The honest headline: this system's scale is one device and two people.** The numbers below exist to
prove that no part of the design needs a queue, a cache, a database tier or a rate limiter — not
because there is load.

Sources: memo §4, §5.1, §6.3.5, §7.3, §11.2; stack-memo §5.

## 1. Actors and cardinality

| Actor | Count | Concurrency | Notes |
|---|---|---|---|
| Devices (panels) | **1** | 1 poll loop | "With exactly one device there is no ordering pressure worth buying a queue for" (memo §5.2) |
| Public-door users (tunnel) | 1 (the wife) | 1 session, ~1 week | Access free tier: up to 50 users |
| Tailnet users | 1 (Nick) | 1 session | no auth in the way |
| Browsers total | ≤ 2 | ≤ 2 SSE subscribers | each browser tab is one subscriber |
| CI | 1 build per push | — | mac-studio-linux queue |

## 2. Request rates

### 2.1 Device poll (the only sustained traffic)

| Regime | `next_poll_ms` | Polls/s | Polls/hour | Bytes/poll (req + ~200 B resp) | Bytes/hour |
|---|---|---|---|---|---|
| Idle (no pending apply, no countdown, no viewer) | 5000 | 0.2 | 720 | ~700 B | **~0.5 MB** |
| Active (pending apply **or** countdown/HANDOFF **or** a live SSE subscriber) | 2000 | 0.5 | 1800 | ~700 B | **~1.3 MB** |

- **Worst case ~1.5 MB/hour, ~35 MB/day, ~13 GB/year.** On a LAN, over plaintext HTTP, this is
  nothing.
- The memo is explicit that the interval is **a ceiling on how stale an empty house may be, not a
  knob to optimise**: relaxing idle to 15 s would "save" bandwidth that costs nothing while making
  "open the site, press Start" visibly slow (memo §11.2).
- **Opening the page raises the rate**: the cadence is 2 s while a viewer is connected, because
  opening the page *is* the signal of intent (memo §6.3.5).

### 2.2 Browser traffic

| Source | Rate | Notes |
|---|---|---|
| `GET /` | once per session | static shell |
| `GET /api/state` | once at paint, then only as the SSE fallback (2 s if SSE misbehaves — memo §11.8) | ~2 KB |
| `GET /api/events` | 1 long-lived SSE stream per tab | heartbeat comment ~every 15 s (memo §11.7) |
| `POST /api/{start,cancel,replace}` | human-initiated; a handful per day | writes |

**Commands are the rarest thing in the system.** Realistic upper bound: a few per day. The
reconciliation model exists for *correctness* under a flaky link, not for throughput.

### 2.3 Per-command write amplification

One command produces at most: 1 desired state write + 1 audit row (`accepted`) + 1 audit row
(`applied` or `expired`). A **replace** additionally: 1 audit `conflict` row + `cancel` applied +
`start` accepted + `start` applied → ~6 rows. Still trivial.

## 3. State size (in memory)

| Slot | Size |
|---|---|
| `desired` | one object, ~150 bytes |
| `observed` | one object, ~250 bytes |
| `gen`, `applied_gen`, `subscribers` | 3 integers |
| `replace_sequence` | one optional object |
| SSE subscribers | ≤ 2 sockets |

**Total working set: well under 1 KB.** There is no dataset, no index, no cache, and no reason for
one. Holding a transcript/state cache here would be the architectural regression to avoid — the
analogue of the "hub is a router, not a store" rule in the neighbouring project.

## 4. Retention

| Data | Retention | Rationale |
|---|---|---|
| desired / observed | none — mirror only | re-seeded/replaced by the next poll |
| `gen` | within the process | re-seeded from `applied_gen + 1` on a fresh process (memo §5.1) |
| **audit log** | **OPEN DECISION** (description.md §6.4) | memo §7.3 asks for "a small append-only log" of *(when, who, action, did-it-land)* and gives no number |

Sizing for the audit log at a deliberately pessimistic **100 rows/day** (~60 bytes/row in a compact
append-only file): **~2 MB/year.** Even a decade is negligible. Because it grows so slowly, the
retention decision is about *utility* ("how far back do we want to answer 'did it work?'") rather
than space — which is why it is left open rather than guessed.

Boot-id changes and network-window churn are also log rows (memo §5.6), so the log incidentally
carries the panel's health history. Surfacing that is a later, cheap addition (memo §11.5).

## 5. Bound on the parser (memo §10)

| Surface | Bound |
|---|---|
| Device read (board side) | hard byte cap on the response; `gc.collect()` before the request; largest contiguous heap block on the board is **16 KB** (memo §16, §6.3) |
| Device poll (server side) | every query parameter validated; the server **never echoes input into the response** |
| `next_poll_ms` | server-generated and clamped; the board applies its own floors/ceilings from `config.py` |
| SSE | one stream per tab; heartbeat keeps proxied connections alive (~100 s idle limit — memo §11.7) |

## 6. Capacity conclusions

1. **No queue, no broker, no rate limiter, no database tier is warranted.** The single-device,
   single-writer-per-direction model makes reconciliation sufficient (memo §5.2).
2. **No horizontal scaling.** One container; Watchtower recreates it on a new image. State is a
   mirror and is allowed to vanish on restart (with the `gen` re-seed rule). **Do not put this
   behind a load balancer or run two replicas** — two replicas would each have their own `gen` and
   their own view of `applied_gen`, which is exactly the wedge §11.6 warns about.
3. **Storage: the audit log is the only durable artifact**, and it is measured in megabytes per
   decade.
4. **The real bottleneck is not throughput, it is the board's heap and the network windows of
   minutes** (memo §6.2, §11.15) — a firmware problem, handled by the byte cap and the pre-request
   `gc.collect()` on the board, and by honest UI on the server.
