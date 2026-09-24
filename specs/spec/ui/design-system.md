# UI design system — the remote

Mobile-first, deliberately small — **it is a remote, not a control panel** (memo §9). Sources:
memo §9, §9.1, §12; default conventions (WCAG 2.1 AA, semantic HTML, keyboard, mobile-first).

## 1. Mandatory UI rules

1. **Exactly four controls, mirroring the panel.** Three routine buttons carrying the same symbols as
   the physical caps — duck, book, toy-box — and **one Cancel**. The phone and the panel teach the
   same mapping; the consistency is free and it is why v1.5 §4d's artwork is reusable here
   (memo §9). No more controls. Nothing else is a button.
2. **A live mirror**: current state, routine, counting-down time (interpolated locally between polls),
   and HANDOFF showing briefly as "BATHTIME!" (memo §9).
3. **Cancel is one big button.** Large target; it is the panicked button, and it maps exactly to `D`
   (memo §9).
4. **A conflict affordance** rather than a silent switch (memo §5.5, §9).
5. **No durations, no `+2 min`, no settings.** Those would be features the panel does not have
   (memo §9).
6. **The "sent vs done" rule is mandatory, not polish** — see §5.

## 2. Design tokens

Colours keep the **house language**: **green means go, red unused**. Do not replicate the panel's full
ramp — the phone is a remote, not a second display (memo §9).

| Token | Value intent | Use |
|---|---|---|
| `--c-bg` | near-black, matches the panel's dark surround | page background |
| `--c-surface` | slightly lifted dark | the mirror panel |
| `--c-go` | **green** (the house "go") | routine buttons, CONFIRMED |
| `--c-go-dim` | dimmed green | button pressed / send-sending |
| `--c-text` | high-contrast off-white | body text (AA on `--c-bg`) |
| `--c-muted` | mid grey | "last seen 2 s ago", secondary labels |
| `--c-warn` | amber | "sending…", conflict offer |
| `--c-danger` | **genuinely red** | Cancel *only* — red is otherwise unused (memo §9), so it reads as an exception |
| `--radius` / `--space-*` | a small 4/8 px scale | one visual grammar |
| `--tap-min` | **≥ 56 px** | every control; Cancel ≥ 72 px tall |

Typography: one sans family, a system stack; display sizes so "BATHTIME" is legible at arm's length
in a dim room. No icon font — the symbol artwork is the identity channel (memo §12).

**Symbols come from `routines.json`** (the single source of truth for ids and labels; id `cleanup`,
label "Cleanup" on both surfaces — memo §12). No component hard-codes a label or an artwork path.

## 3. Layout

```
┌──────────────────────────────┐
│  Home Display                │   header; Access email shown only when
│  signed in as ts.akhtar@…    │   present (display/audit — never auth, memo §8.3)
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │   MIRROR               │  │   state + routine + remaining_s
│  │   ● panel: seen 2s ago │  │   remaining_s interpolated locally,
│  │   BATHTIME   3:34      │  │   re-synced on every poll (memo §5.3)
│  └────────────────────────┘  │
│                              │
│  [ 🦆 ]    [ 📖 ]   [ 🧸 ]   │   three routine buttons, panel symbols,
│  Bathtime  Booktime  Cleanup │   labels from routines.json
│                              │
│  ┌────────────────────────┐  │
│  │        CANCEL          │  │   one big button; maps to D; red
│  └────────────────────────┘  │
└──────────────────────────────┘
```

HANDOFF renders briefly as the routine name + "!" ("BATHTIME!") — the only place the mirror shouts,
mirroring the panel's announcement (memo §9).

## 4. Interaction states per control

| State | Rendering | Rule source |
|---|---|---|
| `idle` | normal, enabled | — |
| `pressing` | `--c-go-dim`, immediate | optimistic *press*, never optimistic *success* |
| `sending…` | `--c-warn` + a spinner + "sent…" text | memo §9.1 |
| `confirmed` | `--c-go` flash + "confirmed" | only when `applied_gen` advanced |
| `failed/expired` | `--c-warn` + "the panel didn't answer (last seen 3m ago)" | memo §9.1 |
| `offline` | controls **disabled** or loudly caveated | memo §9.1 |
| `conflict` | an inline affordance: "booktime is running — **Replace**" | memo §5.5 |

## 5. The one hard UX rule (memo §9.1)

**"Sent" is not "done."** A command can be accepted by the server and never reach the panel. Under a
naive design the phone shows a happy toast, the panel does nothing, and two people conclude the
*panel* is broken — the worst possible diagnosis, aimed at the one device that is hardest to debug.

Mandatory therefore:

- **Panel liveness shown continuously** ("panel: last seen 2 s ago"), from the free poll-derived
  heartbeat.
- A press goes **sending… → confirmed**, and only confirms when the device reports the new
  `applied_gen`.
- If it does not land inside the TTL: **"the panel didn't answer (last seen 3m ago)"**, plainly.
- Offline ⇒ the UI is disabled or loudly caveated, rather than accepting a command that will expire.
- The outcome is logged either way, so "it didn't work" becomes a record rather than an argument.

Because the panel's failure to answer may be a **heap** problem and not a network one, the wording
never diagnoses the cause for the user — it states what is known (see `event-flow.md` §4).

## 6. Accessibility and platform (default conventions apply)

- **WCAG 2.1 AA**: contrast checked on the dark palette for `--c-text`, `--c-go`, `--c-warn`,
  `--c-danger`; never colour alone — every state carries a word ("confirmed", "sending…", "offline").
- **Semantic HTML first**: the four controls are `<button>` elements; the mirror is a live region
  (`aria-live="polite"`) so state changes are announced; the conflict affordance is a real dialog or
  an inline disclosure, with focus moved to it.
- **Full keyboard navigation**: the four controls are in DOM order = visual order; normal tab/enter
  operation; a visible focus ring.
- **Mobile-first responsive**: designed for a one-handed phone in a dim hallway; landscape must not
  break the four targets. `viewport-fit` and a large tap target for Cancel.
- **No child-facing surface**: nothing here is ever shown to the child (memo §12).
- **Reduced motion**: honour `prefers-reduced-motion` for the confirmation flash and the HANDOFF
  "shout".
- **PWA: maybe.** Cheap, and an iOS-first household. **Not v1-critical** (memo §9). If it is added,
  it must not assume the Access session survives in a home-screen web-app on iOS — verify in Phase A,
  with a Safari bookmark as the fallback (memo §8.5).

## 7. Performance (default conventions)

Baseline ≥ 90 where Lighthouse CI is configured. The page is tiny and static-shelled; the only
network work at runtime is `GET /api/state`, the SSE stream and the four `POST`s, so the budget is
not at risk. The SSE route must be genuinely streamed (`no-cache`, `X-Accel-Buffering: no`,
heartbeat ~15 s) or the perceived liveness — the whole point of the UI — degrades to a stale mirror
(memo §11.7).

## 8. What is deliberately absent

Settings, durations, `+2 min`, history browsers, multi-panel selection, privilege tiers, admin
surfaces, theming, sound (the phone is silent by design — cancel stays silent on the panel, and the
phone carries the acknowledgement, memo §11.13; a phone that beeped in a nursery would be its own
bug).
