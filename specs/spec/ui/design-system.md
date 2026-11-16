# UI design system — the remote

Mobile-first, deliberately small — **it is a remote, not a control panel** (memo §9). Sources:
memo §9, §9.1, §12; default conventions (WCAG 2.1 AA, semantic HTML, keyboard, mobile-first).

## 1. Mandatory UI rules

1. **One control per routine, plus one Cancel, mirroring the panel.** The three routines the panel
   has caps for carry the same symbols — duck, book, toy-box — and the remote-only **Shoes On**
   carries a shoe; then **one Cancel**. The phone and the panel teach the same mapping for everything
   the panel has; the remote-only routine is the single deliberate addition, and a panel whose
   firmware does not know it is not offered it at all (memo §9). Nothing *else* is a button, save the one deliberate addition below: the **idle-only
   message composer** (§10), which is idle-screen content rather than a panel button and, being
   idle-only, is absent from every other state.
2. **A live mirror**: current state, routine, counting-down time (interpolated locally between polls),
   and HANDOFF showing briefly as "BATHTIME!" (memo §9).
3. **Cancel is one big button.** Large target; it is the panicked button, and it maps exactly to `D`
   (memo §9).
4. **A conflict affordance** rather than a silent switch (memo §5.5, §9).
5. **No `+2 min`, no settings.** Those would be features the panel does not have (memo §9). The one
   exception is the **countdown length** (T6): a 1/2/3/5/10-minute chooser (default 5) — *data alongside
   the `start`*, not a new event, offered the same way the routine buttons are. It changes only how
   long a remote-started countdown runs; it is not a setting, is not persisted, and a physical press
   is unaffected (`device-protocols.md` §3).
6. **The "sent vs done" rule is mandatory, not polish** — see §5.

## 2. Design tokens — the house theme, installed

The palette is **not this app's to invent**. It is the `@nb` theme from the ui-registry
(`registry/versions/v1.18.0/theme.json`), written into `src/app.css` by the installer, plus exactly
one rule of this app's own at the bottom of that file. Colours keep the **house language**: green
means go, red is an exception. Do not replicate the panel's full ramp — the phone is a remote, not a
second display (memo §9).

| Token | Value intent | Use here |
|---|---|---|
| `--bg` | slate ground (`#0b1220`), darker than the phone's bezel edge | page background, and the ink on a filled `--ok`/`--bad` key |
| `--bg-raised` | a translucent lift of the ground | `.card`: the mirror, the conflict prompt, the status notice |
| `--bg-sunken` | the ground *below* the page | the LED matrix the idle screen is drawn on |
| `--bg-overlay` | the ground made nearly opaque | the sticky top bar of `app-shell` |
| `--line` / `--line-strong` | hairlines that are tints, not greys | card borders, the segmented control's frame |
| `--ink` | high-contrast off-white | body text, routine labels |
| `--ink-dim` | one step down | the countdown figures |
| `--ink-muted` | muted | "last seen 2 s ago", secondary labels |
| `--ink-faint` | faintest | the unlit pixels of the LED matrix |
| `--ink-strong` | the top of the ramp | the routine name on HANDOFF |
| `--accent` | the house link (sky-400, `#38bdf8`) | the weather reading on the idle screen |
| `--ok` / `--ok-bg` | green (`#34d399`) | routine keys, CONFIRMED, "showing on the panel" |
| `--warn` / `--warn-bg` | amber (`#fb923c`) | "sending…", a conflict, the offline notice |
| `--bad` / `--bad-bg` | red (`#f87171`) | Cancel *only* — red is otherwise unused (memo §9), so it reads as an exception |
| `--radius` / `--radius-sm` / `--radius-pill` | 8 / 6 / 999 px | one visual grammar |
| `--mono` | tabular figures | every number: the countdown, the message counter |
| `--tap` | **56 px**, raised from the theme's 44 px | every control; Cancel is full-width and taller still |

1.18.0 raised the chroma one step: the 300-weight pastels were measurable (ink 15:1) but read as
grey on a phone in a dark room, so the semantic hues are now the 400s and the tints are denser. The
ink ramp is untouched. `theme-color` in `app.html` follows `--bg` — browser chrome that keeps the old
navy above a page that has moved on leaves a visible seam at the top of the screen.

The one app-level override is `:root { --tap: 56px }`: a theme token set to *this* device's role —
wet hands, arm's length — rather than a new colour. Nothing else is redeclared, so the app cannot
drift from the house look.

Theme **classes** come with the theme and are the only styling vocabulary: `.card`, `.pill`, `.seg`
(+ `.seg.tap`, a segmented control that owns its row), `.btn` (+ `.primary`), `.notice` (+ `.warn`),
`.micro`, `.section-title`, `.lede`, `.quiet`, `.muted`, `.num`, `mark`.

### 2.1 The blocks this screen is made of

The UI is assembled from published, pinned ui-registry blocks — vendored verbatim into
`src/lib/components/nb/` and checked against `.nb-registry.json` (1.18.0) by
`scripts/check-nb-blocks.mjs`. Editing one here is a bug; upgrade the pin instead.

| Block | What it is on this screen |
|---|---|
| `app-shell` | the sticky, opaque top bar: "Home Display" and the Access email |
| `device-mirror` | the mirror: freshness heartbeat, the LED idle screen (slot), headline, relayed countdown, state word, live banner |
| `command-pad` | one key per routine (glyph + tone) plus the full-width Cancel, with busy/confirmed states; on `/tile` the same pad `readonly` is the legend |
| `message-bar` | the idle-only composer: one line, the server's limit, a pending Send |
| `confirm-prompt` | the 409 as a question: Replace / Keep, with focus handed to Replace |

What is *not* a block and stays in the app: `src/lib/ui/PanelScreen.svelte`, because it is a picture
of this panel (a 53×11 LED matrix) and not a layout — it is handed to `device-mirror` through its
`screen` slot.

Typography: one sans family, a system stack; display sizes so "BATHTIME" is legible at arm's length
in a dim room. No icon font — the symbol artwork is the identity channel (memo §12).

**Symbols come from `routines.json`** (the single source of truth for ids and labels; id `cleanup`,
label "Cleanup" on both surfaces — memo §12). No component hard-codes a label or an artwork path.

## 3. Layout

```
┌────────────────────────────────────┐
│ Home Display                       │  app-shell: sticky, opaque top bar;
│ signed in as ts.akhtar@…           │  Access email only when present
├────────────────────────────────────┤  (display/audit — never auth, memo §8.3)
│ ┌────────────────────────────────┐ │
│ │ ● panel: last seen 2 s ago     │ │  device-mirror: liveness = how fresh
│ │ ┌────────────────────────────┐ │ │  the board is; the screen below is
│ │ │ ▦ 53×11 LED matrix         │ │ │  the slot — the panel's own idle
│ │ │                   ☁ 18°    │ │ │  drawing, passed in by the app
│ │ └────────────────────────────┘ │ │
│ │        Bathtime                │ │  headline (idle) or BATHTIME! (handoff)
│ │        3:34                    │ │  countdown: relayed, interpolated
│ │ COUNTING DOWN                  │ │  state word — the state in words
│ └────────────────────────────────┘ │
│                                    │
│  [ 1 ][ 2 ][ 3 ][ 5 ][ 10 ]        │  .seg.tap: countdown length (T6),
│                                    │  owns its row, 56 px targets
│ ┌──────────┬──────────┬──────────┐ │
│ │    🦆    │    📖    │    🧸    │ │  command-pad: one key per routine
│ │ Bathtime │ Booktime │ Cleanup  │ │  (glyph + label from routines.json)
│ ├──────────┴──────────┴──────────┤ │
│ │             ✕ Cancel           │ │  full-width, `--bad`; maps to D
│ └────────────────────────────────┘ │
│ ┌──────────────────────────────┬─┐ │
│ │ Message for the panel…       │→│ │  message-bar: idle only, server's
│ └──────────────────────────────┴─┘ │  limit, Send pending until acked
└────────────────────────────────────┘
```

HANDOFF renders briefly as the routine name + "!" ("BATHTIME!") — the only place the mirror shouts,
mirroring the panel's announcement (memo §9).

The **idle-only message composer** (§10) sits below Cancel, and only while the panel is idle — a
secondary input + Send row that is absent in every other state, since a scroll over a countdown
would mean nothing. A 409 replaces nothing on this screen: `confirm-prompt` is drawn *above* the pad
with Replace focused, and the pressed key is left untouched until the reader answers.

## 4. Interaction states per control

| State | Rendering | Rule source |
|---|---|---|
| `idle` | normal, enabled | — |
| `pressing` | `--ok-bg`, immediate | optimistic *press*, never optimistic *success* |
| `sending…` | `--warn` + a spinner + "sent…" text | memo §9.1 |
| `confirmed` | `--ok` flash + "confirmed" | only when `applied_gen` advanced |
| `failed/expired` | `--warn` + "the panel didn't answer (last seen 3m ago)" | memo §9.1 |
| `offline` | controls **disabled** or loudly caveated | memo §9.1 |
| `conflict` | an inline affordance: "booktime is running — **Replace**" | memo §5.5 |
| `not_idle` | `--warn` + "the panel isn't idle — messages only show when it is"; **no** Replace | §10.3 — the answer to a message sent off-idle |

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

- **WCAG 2.1 AA**: contrast checked on the dark palette for `--ink`, `--ok`, `--warn`,
  `--bad`; never colour alone — every state carries a word ("confirmed", "sending…", "offline").
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
- **The routine caps appear as inert chips**, the active one filled with `--ok` and the rest dimmed —
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

- **Sent** → `sending…` (`--warn`), exactly like a routine press.
- **Confirmed** → "showing on the panel" (`--ok`), and **only** when the board reports the same
  `message_id` this phone sent (`ui/command.js` confirms on `panel.message_id === status.messageId`).
  The reduced state is `idle`, not `confirmed`, until then.
- **A busy 409 is `not_idle`, not a conflict.** A routine 409 means "another routine is running —
  Replace?" (§4). A message 409 means "there is no idle screen to put this on", so it reads
  **"the panel isn't idle — messages only show when it is"** (`--warn`) and offers **no Replace
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
