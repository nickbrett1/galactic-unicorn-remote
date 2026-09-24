# Flow — the command round trip ("sent" is not "done")

The transaction this service exists for. Source: memo §5, §6.3.5, §9.1. It exercises
`POST /api/start` and `GET /device/poll`.

## 1. Sequence

```mermaid
sequenceDiagram
    autonumber
    actor P as Phone (browser)
    participant S as Service (SvelteKit/Node)
    participant B as Board (Pico W)
    participant L as Audit log

    Note over P,S: Painted from a prior GET /api/state;<br/>remaining_s interpolated locally between polls
    P->>S: POST /api/start {routine:"bathtime"}
    S->>S: resolveCommand(...) — the conflict table of memo §5.5
    alt panel offline
        S->>L: action=start outcome=refused_offline
        S-->>P: 503 {error:"panel_offline", last_seen_s:180}
        Note over P: UI refuses BEFORE setting anything, and says so
    else panel ambient
        S->>S: gen++ ; desired = {gen, action:"start", routine, expires_at: now+45s}
        S->>L: action=start gen=N outcome=accepted
        S-->>P: 202 {gen:N, action:"start", routine:"bathtime", ttl_s:45}
        Note over P: state = "sending…" — NOT "done"
    else panel counting down a DIFFERENT routine
        S-->>P: 409 {error:"conflict", current_routine:"booktime", offers:["replace"]}
        Note over P,S: see replace-conflict-sequence.md — never a silent switch
    end

    loop every next_poll_ms (~2000 while pending)
        B->>S: GET /device/poll?token=..&boot=..&applied_gen=17&state=ambient&..
        S->>S: record observed (received_at, boot, applied_gen, state…)
        S->>S: compute next_poll_ms (pending apply => 2000)
        S-->>B: {gen:N, action:"start", routine:"bathtime", next_poll_ms:2000}
        B->>B: gen N > applied_gen 17 => apply `start bathtime` (= button A)
        B->>B: persist applied_gen = N to flash
        Note over B: PROMPT plays the routine's tune —<br/>identical to a physical press
        B->>S: GET /device/poll?...&applied_gen=N&state=prompt&routine=bathtime&remaining_s=300
        S->>S: applied_gen N >= gen N => CONFIRM
        S->>L: action=start gen=N outcome=applied
        S-->>P: (SSE) state frame: panel.state=prompt, panel.online=true
        Note over P: "sending…" -> "confirmed" — the panel did it
    end

    opt TTL expires with no applied_gen advance (board was unreachable)
        S->>S: drop desired (never queue it)
        S->>L: action=start gen=N outcome=expired
        S-->>P: (SSE) frame; UI: "the panel didn't answer (last seen 3m ago)"
    end
```

## 2. What the sequence is careful about

| Rule | Where enforced | Why |
|---|---|---|
| **Accepted ≠ done.** `202` means desired was set. | `DesiredAck` vs the applied transition | The worst possible diagnosis is two people concluding the *panel* is broken when the panel is fine (memo §9.1). |
| Confirmation is **`applied_gen`, not a receipt** | server compares reported `applied_gen` to `gen` | The board reports what it actually did; there is no ack message to lose (memo §5.1, §5.2). |
| **Offline refuses before setting anything** | `resolveCommand` → `refuse_offline` | A command that will expire is never accepted (memo §5.5). |
| The countdown never comes from the server | UI interpolates `observed.remaining_s` | A server-computed countdown drifts and eventually gets quoted as truth (memo §5.3, §11.4). |
| The board works if the service dies mid-sequence | n/a — the panel never depended on it | Phase C's critical regression test (memo §13). |
| A dead window loses the command **and says so** | TTL expiry → audit `expired` + UI wording | Not eliminated by design; handled in the wording (memo §5.4, §11.1). |

## 3. Latency budget (memo §4, §6.3.5)

- **Phone → panel, best case:** one poll interval — ~2 s on demand (a live SSE subscriber already
  holds the cadence at fast).
- **Worst case:** one poll interval past the TTL, at which point the command is reported lost rather
  than being silently applied late.
- Opening the page is itself the signal of intent: the cadence drops to 2 s as soon as a viewer is
  connected, before any button is pressed (memo §6.3.5).

## 4. Related

- `replace-conflict-sequence.md` — the branch this flow defers to.
- `device-desired-state-state-machine.md` — what the board does with `{action, routine}`.
- `event-flow.md` — the SSE frames the browser receives.
