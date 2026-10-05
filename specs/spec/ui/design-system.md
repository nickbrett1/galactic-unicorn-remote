# UI design system — the remote

Mobile-first, deliberately small — **it is a remote, not a control panel** (memo §9). Sources:
memo §9, §9.1, §12; default conventions (WCAG 2.1 AA, semantic HTML, keyboard, mobile-first).

## 1. Mandatory UI rules

1. **Exactly four *panel* controls, mirroring the panel.** Three routine buttons carrying the same
   symbols as the physical caps — duck, book, toy-box — and **one Cancel**. The phone and the panel
   teach the same mapping; the consistency is free and it is why v1.5 §4d's artwork is reusable here
   (memo §9). Nothing *else* is a button, save the one deliberate addition below: the **idle-only
   message composer** (§10), which is idle-screen content rather than a panel button and, being
   idle-only, is absent from every other state.
2. **A live mirror**: current state, routine, counting-down time (interpolated locally between polls),
   and HANDOFF showing briefly as "BATHTIME!" (memo §9).
3. **Cancel is one big button.** Large target; it is the panicked button, and it maps exactly to `D`
   (memo §9).
4. **A conflict affordance** rather than a silent switch (memo §5.5, §9).
5. **No `+2 min`, no settings.** Those would be features the panel does not have (memo §9). The one
   exception is the **countdown length** (T6): a 1/3/5/10-minute chooser (default 5) — *data alongside
   the `start`*, not a new event, offered the same way the routine buttons are. It changes only how
   long a remote-started countdown runs; it is not a setting, is not persisted, and a physical press
   is unaffected (`device-protocols.md` §3).
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

The **idle-only message composer** (§10) sits below Cancel, and only while the panel is idle — a
secondary input + Send row that is absent in every other state, since a scroll over a countdown
would mean nothing.

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
| `not_idle` | `--c-warn` + "the panel isn't idle — messages only show when it is"; **no** Replace | §10.3 — the answer to a message sent off-idle |

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
- **Semantic HTML first**: the four panel controls are `<button>` elements, and so is the idle-only
  Send (§10); the mirror is a live region (`aria-live="polite"`) so state changes are announced; the
  conflict affordance is a real dialog or an inline disclosure, with focus moved to it.
- **Full keyboard navigation**: the four panel controls are in DOM order = visual order; normal
  tab/enter operation; a visible focus ring (the composer, when present, follows them, §10.5).
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
network work at runtime is `GET /api/state`, the SSE stream and the four routine `POST`s (plus the
idle-only message `POST`, §10), so the budget is
not at risk. The SSE route must be genuinely streamed (`no-cache`, `X-Accel-Buffering: no`,
heartbeat ~15 s) or the perceived liveness — the whole point of the UI — degrades to a stale mirror
(memo §11.7).

## 8. What is deliberately absent

Settings, `+2 min`, history browsers, multi-panel selection, privilege tiers, admin
surfaces, theming, sound (the phone is silent by design — cancel stays silent on the panel, and the
phone carries the acknowledgement, memo §11.13; a phone that beeped in a nursery would be its own
bug).

## 9. The glanceable tile (`/tile`) — read-only

The household dashboard (Homepage on the NAS) embeds the panel's state as a small tile. It is served by
this same service, at `/tile`, so the tile and the drill-in share **one origin, one palette and one set of
formatters** — the tile is the mirror of §3 with the controls removed.

- **Read-only by construction.** It has **no buttons** — the "four panel controls" rule (§1) holds on `/`
  (there, plus the idle-only composer of §10), and `/tile` is the one surface where *nothing* is a button.
  Controls live behind the click-through to `/`.
- **Same wording as the remote.** Headline, countdown and state word all come from `$lib/ui/format.js`, so the
  tile can only ever say what the remote says. Routine labels and artwork come from the catalogue on `data`;
  nothing is hard-coded (§2).
- **Liveness is on the drill-in, not the tile.** The tile answers "what is the panel doing" at a glance, so the
  "panel: last seen …" heartbeat lives on `/` (§5) where there is room to explain it; the tile still carries
  `data-online` for its own styling.
- **Idle is a picture, centred.** When nothing is running the headline is a small inline drawing of the panel
  itself — a 53x11 LED matrix with one lit pixel in the top-left, the way the hardware looks when idle — beside
  the single word `IDLE`. It is centred in the card (`.mirror.idle`) because it is a badge, not a line of text;
  every other state stays left-aligned. Note "Ambient" is deliberately not used: it told the reader nothing.
  The drawing is inline SVG — no external artwork (§2, `tests/ui-lint.test.js`).
- **The idle screen's weather is the panel's own.** When the board has a reading it relays `temp_c` +
  `condition` on the poll it already makes (it polls Open-Meteo itself — `device-protocols.md` §3), and
  that reading is drawn **inside the idle card's picture of the panel** — centred on the 53x11 matrix,
  as the panel itself draws it — from the **same 7 glyph masks the firmware draws** (`lib/icons.py`), in
  the firmware's own palettes, ported cell-for-cell into `$lib/ui/weather.js`. It is *inside* the panel
  picture, not a chip below it, because the weather is what the panel's screen is showing. One
  `WeatherIndicator` component is imported by both `/` and `/tile` (its `variant="screen"` drops the
  standalone chip chrome), so the tile cannot drift from the remote — and neither can drift from the
  panel. With **no reading it renders nothing** — no placeholder that looks like weather — and it appears
  on the idle screen only, the one state the panel draws the weather in.
- **The three routine caps appear as inert chips**, the active one filled with `--c-go` and the rest dimmed —
  the same symbol language as the buttons, with no affordance to press.
- **Not an API surface.** `/tile` is a page; it adds no route. (The one surface added since memo §6's
  route set is the idle-only `POST /api/message`, §10 — the tile touches neither.)
- The tokens for both surfaces live in `src/app.css` (loaded by `+layout.svelte`), which is what
  `tests/ui-lint.test.js` reads for the WCAG AA contrast check.

## 10. The idle-only message composer

The one deliberate addition to the "four panel controls" rule (§1). It sends a **short line of text
to scroll across the panel's idle screen** — "Dinner in ten", "Bath's ready". It is *idle-screen
content*, not a panel button: it maps to no cap, it runs no routine, and it never touches the
reconcile loop (`device-protocols.md` §3.0).

### 10.1 Idle-only, at every layer

The feature exists only while the panel is showing its idle screen. This is enforced where it is
cheapest, not merely hidden in the markup:

- **The composer is rendered only when the panel is idle** — `online && state === "ambient"`
  (`+page.svelte` derives `showComposer`). Offline or counting down, it is absent, not disabled.
- **The server refuses it anyway.** `POST /api/message` returns **503 `panel_offline`** when the panel
  is offline and **409 `panel_busy`** when it is not idle (`commands.js::runMessage`, gated by
  `canShowMessage`). The markup short-circuit is a courtesy; the server is the rule.
- **The board draws it only in `AMBIENT`.** A message that is up when the panel leaves idle is dropped
  server-side ("dropped: panel left the idle screen"), so it can never reappear over a countdown.

A message is therefore *naturally* ephemeral: the composer appears and vanishes with the panel's own
state, with no mode for the user to get stuck in.

### 10.2 The control

- **An input and a Send button**, inside a `<form>`, below the routine buttons and Cancel, visible
  **only** in idle. It is not a fifth big button — it is a smaller, secondary row (a `1fr auto` grid)
  that reads as "extra", because it is.
- **Bounded to the server's own limit.** `maxlength` comes from `messageMaxLen` (from
  `config.messageMaxLen`, default 60 — `+page.server.js`), so the field cannot compose something the
  server will reject on length. Send is **disabled while empty** (after the same `trim()` the server
  applies) or while another send is in flight.
- **Printable ASCII only** (0x20–0x7e, ≥ 1 visible char) — the panel's LED font has no glyph for
  anything else, so the server rejects newlines and non-ASCII (422 `invalid_message`). The UI does not
  need to say this up front; it does not accept what the panel cannot draw.
- **The value is never echoed back.** The live-banner line shows the *panel's* acknowledged text
  (§10.3), never a copy of what the user typed — the panel is the only authority on what is showing.

### 10.3 "Showing on the panel" — the sent-vs-done rule still holds (§5)

The banner is a slot with its own monotonic `id`, not a `gen`, and its 202 is an *acceptance*, not a
*done*. So the composer follows §5 exactly, with the acknowledgement swapped in:

- **Sent** → `sending…` (`--c-warn`), exactly like a routine press.
- **Confirmed** → "showing on the panel" (`--c-go`), and **only** when the board reports the same
  `message_id` this phone sent (`ui/command.js` confirms on `panel.message_id === status.messageId`).
  The reduced state is `idle`, not `confirmed`, until then.
- **A busy 409 is `not_idle`, not a conflict.** A routine 409 means "another routine is running —
  Replace?" (§4). A message 409 means "there is no idle screen to put this on", so it reads
  **"the panel isn't idle — messages only show when it is"** (`--c-warn`) and offers **no Replace
  button** — there is nothing to replace; the composer will simply not be there once the state frame
  lands.
- **Offline** → "the panel didn't answer…" as in §5; the composer is gone on the next frame regardless.

### 10.4 The live banner line

While a message is up, the mirror shows a small line — *scrolling: "Dinner in ten"* — sourced from the
`message` slot on `GET /api/state` (server-side `expires_at`), and shown **only while idle**, matching
the panel. It is the same read-only relay as the weather chip (§9): the phone reports what the panel
is drawing, and stops reporting it the moment the panel does.

### 10.5 Accessibility

Inherits §6 wholesale — the Send button is a real `<button>`, the field has a `<label>` (visually
hidden where the row is too tight for it), the confirmation and the refusal are announced through the
same `aria-live="polite"` mirror region, and the whole row is keyboard-reachable and honour
`prefers-reduced-motion` (the "scrolling:" line is *static text*, so it costs nothing to reduce).
