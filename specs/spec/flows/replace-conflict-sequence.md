# Flow — replacing a running countdown (never a silent switch)

The one place the server does something the panel cannot. Source: memo §3, §5.5; it exercises
`POST /api/replace`.

## 1. Why this lives on the server

If the phone wants to replace a running countdown, the **server** asks for cancel, waits for the
board to report it happened, then asks for start (memo §3). One device, one poll loop — the race is
trivial, and the alternative (an authority-priority field in the firmware) would put adult reasoning
into the toddler-facing state machine.

The panel therefore gains **no notion of "a remote override"** and keeps its simple, child-proof
rules. A remote "book time" while bathtime counts down does nothing on the panel.

## 2. Sequence

```mermaid
sequenceDiagram
    autonumber
    actor P as Phone
    participant S as Service
    participant B as Board
    participant L as Audit log

    Note over B: state = countdown, routine = bathtime
    P->>S: POST /api/start {routine:"booktime"}
    S->>L: action=start routine=booktime outcome=conflict
    S-->>P: 409 {error:"conflict", current_routine:"bathtime", offers:["replace"]}
    Note over P: UI shows the conflict and offers "Replace" explicitly

    P->>S: POST /api/replace {routine:"booktime"}
    S->>S: begin replace_sequence{target:booktime, cancelled_gen:G, abandons_at: now+45s}
    S->>S: desired = {gen:G, action:"cancel"}   (cancel == the D button)

    loop poll (~2000)
        B->>S: GET /device/poll?...&applied_gen=G&state=countdown&routine=bathtime&remaining_s=180
        S-->>B: {gen:G, action:"cancel", next_poll_ms:2000}
        B->>B: apply cancel (D) — silent, works in PROMPT/COUNTDOWN/HANDOFF
        B->>S: GET /device/poll?...&applied_gen=G&state=ambient
    end

    S->>S: state==ambient AND applied_gen>=G => advance
    S->>L: action=cancel gen=G outcome=applied
    S->>S: gen++ ; desired = {gen:G+1, action:"start", routine:"booktime"}
    Note over S: The rename changes D from a bare cancel<br/>to a reset mid-sequence — exactly one writer per direction

    loop poll
        B->>S: GET /device/poll?...&applied_gen=G&state=ambient
        S-->>B: {gen:G+1, action:"start", routine:"booktime", next_poll_ms:2000}
        B->>B: apply start booktime
        B->>S: GET /device/poll?...&applied_gen=G+1&state=prompt&routine=booktime
    end

    S->>L: action=replace routine=booktime gen=G+1 outcome=applied
    S-->>P: (SSE) panel.routine=booktime -> "confirmed"

    opt the panel goes away mid-sequence (offline past abandons_at)
        S->>S: abandon replace_sequence
        S->>L: action=replace outcome=expired
        S-->>P: (SSE) "the panel didn't answer (last seen …)" — plainly
    end
```

## 3. Rules this flow encodes

| Rule | Source |
|---|---|
| A remote cancel **is** `D`; `D` is live in PROMPT, COUNTDOWN and HANDOFF. | memo §3 |
| Replace is **cancel → wait for `state: ambient` reported → start**. The wait is on the *reported* state, not on a timer. | memo §5.5 |
| The switch is **never silent**: the conflict is shown and replace is a separate, explicit action. | memo §5.5, memo §9 |
| "start X when X is already running" is a **no-op** shown as "already running", not a new command. | memo §5.5 |
| "cancel from ambient" is a **no-op**. | memo §5.5 |
| Abandonment is loud: the UI reports the panel offline rather than leaving a half-done sequence. | memo §9.1 |
| No `extend` event is invented. `+2 min` is deferred precisely because it would need one. | memo §12 |

## 4. Open decision touched

The TTL / abandonment window is the same ~45 s constant as everywhere else; the exact value is an
**open decision** (description.md §6.4).
