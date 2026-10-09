<script>
  /**
   * The remote — D1/D2/D3.
   *
   * Mobile-first and deliberately small: "a remote, not a control panel"
   * (`spec/ui/design-system.md`). Four controls (three routine buttons plus one
   * Cancel), one countdown-length chooser (1/3/5/10 min, default 5 — T6), a live
   * mirror, and the honest "sent vs done" states.
   *
   * All of the wiring lives in pure helpers (`$lib/ui/format.js`,
   * `$lib/ui/command.js`) so the one hard UX rule is unit-testable. Routine ids,
   * labels and artwork come ONLY from the catalogue on `data` — nothing here
   * hard-codes a label or a path (`design-system.md` §2).
   */
  import { onMount, untrack } from "svelte";
  import { DEFAULT_MINUTES } from "$lib/minutes.js";
  import { availableMinutes } from "$lib/ui/firmware.js";
  import { formatCountdown, formatLastSeen, mirrorHeadline, stateWord, labelForRoutine } from "$lib/ui/format.js";
  import { initialStatus, isBusy, reduceStatus, statusText, statusTone } from "$lib/ui/command.js";
  import { toPanelText } from "$lib/ui/panel-text.js";
  import WeatherIndicator from "$lib/ui/WeatherIndicator.svelte";

  let { data } = $props();

  const routines = $derived(data.snapshot.routines);

  // The countdown length a start (or a replace) asks for: 1, 3, 5 or 10 minutes,
  // default 5. It rides ALONGSIDE the routine event — the panel still only
  // ever gets the four button events; this is the length, not a fifth one.
  let minutes = $state(DEFAULT_MINUTES);

  // The mirror paints from the last `StateSnapshot`; SSE keeps it live and the
  // 2 s `/api/state` poll is the indistinguishable fallback (memo §11.7).
  let snapshot = $state(untrack(() => data.snapshot));
  let syncAt = $state(Date.now());
  let nowMs = $state(Date.now());

  // The lengths the *connected panel* can honour (T6.1 stopgap). A board older
  // than 0.1.51 would silently downgrade a 10-minute ask to its routine default,
  // so never offer a length it cannot do — better no button than a lie. Unknown
  // `fw` errs safe the same way; only a panel that reports >= 0.1.51 gets 10.
  let offeredMinutes = $derived(availableMinutes(snapshot?.panel?.fw));

  // Never leave the chooser on a length the panel dropped out from under it: if
  // a stale selection is no longer offered (e.g. the panel reverted, or was
  // swapped for an older one) fall back to the default.
  $effect(() => {
    if (!offeredMinutes.includes(minutes)) minutes = DEFAULT_MINUTES;
  });

  // The command's life: sending… → confirmed, and confirmed ONLY from applied_gen.
  let status = $state(initialStatus());
  let replaceBtn = $state(null);

  // The idle banner composer. A message only ever shows on the idle screen, so
  // the composer is offered only while the panel is idle and reachable.
  let messageText = $state("");
  const messageMaxLen = $derived(data.messageMaxLen ?? 60);

  let lastSeenS = $derived(
    snapshot?.panel?.last_seen_s == null
      ? null
      : snapshot.panel.last_seen_s + (nowMs - syncAt) / 1000,
  );
  let online = $derived(
    lastSeenS !== null && snapshot?.panel?.threshold_s != null
      ? lastSeenS <= snapshot.panel.threshold_s
      : false,
  );

  // remaining_s is relayed from the board and interpolated locally, re-synced on
  // every poll — the server never computes a countdown (memo §5.3).
  let remaining = $derived.by(() => {
    const base = snapshot?.panel?.remaining_s;
    if (base === null || base === undefined) return null;
    return Math.max(0, base - (nowMs - syncAt) / 1000);
  });
  let countdownText = $derived(formatCountdown(remaining));
  let headline = $derived(mirrorHeadline(snapshot?.panel ?? {}, routines));
  let stateWordText = $derived(stateWord(snapshot?.panel?.state));

  let busy = $derived(isBusy(status));
  let disabled = $derived(!online || busy);
  // Idle = the panel's own reported state, the one screen the message draws on.
  let idle = $derived(snapshot?.panel?.state === "ambient");
  let showComposer = $derived(online && idle);
  // A banner the server is holding live — shown for the benefit of a second
  // phone (the sender confirms through the command status instead).
  let liveBanner = $derived(idle ? (snapshot?.message?.text ?? null) : null);
  let statusWord = $derived(statusText(status));
  let tone = $derived(statusTone(status));
  let conflictCurrentLabel = $derived(
    status.kind === "conflict"
      ? (labelForRoutine(routines, status.currentRoutine) ?? "Another routine")
      : "",
  );

  function dispatch(event) {
    status = reduceStatus(status, event);
  }

  function applySnapshot(next) {
    if (!next) return;
    snapshot = next;
    syncAt = Date.now();
    dispatch({ type: "snapshot", snapshot: next, nowMs: Date.now() });
  }

  async function sendCommand(action, routine = null, minutesChoice = null) {
    // Optimistic PRESS, never optimistic success (`design-system.md` §4).
    dispatch({ type: "press", action, routine });
    const url =
      action === "cancel"
        ? "/api/cancel"
        : action === "replace"
          ? "/api/replace"
          : "/api/start";
    // A cancel carries nothing; a start/replace carries the routine and the
    // chosen length (defaulted server-side too, so an old client is honest).
    const body =
      action === "cancel"
        ? {}
        : { routine, ...(minutesChoice ? { minutes: minutesChoice } : {}) };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      let parsed = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      dispatch({
        type: "response",
        httpStatus: response.status,
        body: parsed,
        action,
        routine,
        nowMs: Date.now(),
      });
    } catch {
      dispatch({
        type: "response",
        httpStatus: 0,
        body: null,
        action,
        routine,
        nowMs: Date.now(),
      });
    }
  }

  async function sendMessage() {
    const text = messageText.trim();
    if (!text) return;
    // Optimistic PRESS, never optimistic success — same rule as a routine.
    dispatch({ type: "press", action: "message", routine: null });
    try {
      const response = await fetch("/api/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      let parsed = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      if (response.status === 202) messageText = "";
      dispatch({
        type: "response",
        httpStatus: response.status,
        body: parsed,
        action: "message",
        routine: null,
        nowMs: Date.now(),
      });
    } catch {
      dispatch({
        type: "response",
        httpStatus: 0,
        body: null,
        action: "message",
        routine: null,
        nowMs: Date.now(),
      });
    }
  }

  // A confirmation (or a small notice) flashes, then clears itself.
  $effect(() => {
    if (
      status.kind === "confirmed" ||
      status.kind === "noop" ||
      status.kind === "not_idle" ||
      status.kind === "invalid" ||
      status.kind === "error"
    ) {
      const timer = setTimeout(() => dispatch({ type: "reset" }), 2400);
      return () => clearTimeout(timer);
    }
  });

  // The conflict affordance is a real disclosure: focus moves to its action.
  $effect(() => {
    if (status.kind === "conflict" && replaceBtn) replaceBtn.focus();
  });

  onMount(() => {
    const clock = setInterval(() => {
      nowMs = Date.now();
      // Re-evaluate a command in flight so a TTL miss is reported even if the
      // stream goes quiet: "the panel didn't answer", plainly (memo §9.1).
      if (status.kind === "sending") {
        dispatch({ type: "snapshot", snapshot, nowMs: Date.now() });
      }
    }, 1000);

    let source = null;
    let poll = null;

    function startPolling() {
      if (poll) return;
      const pump = async () => {
        try {
          const response = await fetch("/api/state");
          if (response.ok) applySnapshot(await response.json());
        } catch {
          // Keep trying: the stream is a convenience, not a source of truth.
        }
      };
      pump();
      poll = setInterval(pump, 2000);
    }
    function stopPolling() {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    }

    if (typeof EventSource !== "undefined") {
      source = new EventSource("/api/events");
      source.addEventListener("state", (event) => {
        try {
          applySnapshot(JSON.parse(event.data).state);
        } catch {
          // A malformed frame is ignored, never fatal.
        }
      });
      // Unknown frame names are ignored, not errored (forward compatibility).
      source.addEventListener("audit", () => {});
      source.onopen = () => stopPolling();
      source.onerror = () => startPolling();
    } else {
      startPolling();
    }

    return () => {
      clearInterval(clock);
      stopPolling();
      source?.close();
    };
  });
</script>

<svelte:head>
  <title>Home Display</title>
  <meta name="theme-color" content="#0b0e0d" />
</svelte:head>

<main class="remote" data-online={online}>
  <header class="head">
    <h1>Home Display</h1>
    {#if data.door?.email}
      <p class="signed-in">signed in as {data.door.email}</p>
    {/if}
  </header>

  <section
    class="mirror"
    aria-live="polite"
    class:shout={headline.shout}
    class:handoff={snapshot.panel.state === "handoff"}
    data-state={snapshot.panel.state}
  >
    <p class="liveness" class:stale={!online}>
      <span class="dot" aria-hidden="true"></span>
      panel: last seen {formatLastSeen(lastSeenS)}
    </p>
    {#if headline.idle}
      <!-- The idle headline is a picture of the panel itself: a 53x11 LED
           matrix, dark body, one lit pixel in the top-left. Inline only —
           no external artwork (`tests/ui-lint.test.js`). The panel's own idle
           screen shows the weather, so the reading is drawn INSIDE this
           picture (§9), not below it. -->
      <span class="panel" role="img" aria-label="Panel: idle, top-left pixel lit">
        <svg class="grid" viewBox="0 0 53 11" aria-hidden="true" focusable="false">
          <defs>
            <pattern
              id="panel-dots"
              width="1"
              height="1"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="0.5" cy="0.5" r="0.16" fill="var(--c-muted)" />
            </pattern>
          </defs>
          <rect
            x="0.25"
            y="0.25"
            width="52.5"
            height="10.5"
            rx="1.5"
            fill="var(--c-surface)"
            stroke="var(--c-muted)"
            stroke-width="0.5"
          />
          <rect
            x="0.25"
            y="0.25"
            width="52.5"
            height="10.5"
            rx="1.5"
            fill="url(#panel-dots)"
            opacity="0.25"
          />
          <rect x="0.25" y="0.25" width="1" height="1" fill="var(--c-text)" />
        </svg>
        <!-- The idle panel IS the panel's weather screen, so the same reading
             the hardware is drawing is drawn inside the picture (idle only — a
             countdown draws the routine, not the sky). No reading renders
             nothing (firmware lib/weather.py, design-system.md §9). -->
        <WeatherIndicator
          variant="screen"
          condition={snapshot.panel?.condition}
          tempC={snapshot.panel?.temp_c}
        />
      </span>
    {:else}
      <p class="routine">{headline.text}</p>
    {/if}
    {#if snapshot.panel.state === "countdown" && countdownText}
      <p class="countdown">{countdownText}</p>
    {/if}
    <p class="stateword">{stateWordText}</p>
    {#if liveBanner}
      <p class="banner">scrolling: “{liveBanner}”</p>
    {/if}
  </section>

  {#if !online}
    <p class="caveat" role="alert">
      The panel is offline — controls are disabled until it's seen again.
    </p>
  {/if}

  {#if status.kind === "conflict"}
    <div class="conflict" role="alertdialog" aria-labelledby="conflict-msg">
      <p id="conflict-msg">{conflictCurrentLabel} is running — start instead?</p>
      <div class="conflict-actions">
        <button
          type="button"
          class="replace"
          bind:this={replaceBtn}
          onclick={() => sendCommand("replace", status.requested, minutes)}
        >
          Replace
        </button>
        <button type="button" class="keep" onclick={() => dispatch({ type: "reset" })}>
          Keep
        </button>
      </div>
    </div>
  {/if}

  <!-- The countdown length a start asks for. Rendered from `$lib/minutes.js`
       narrowed by `$lib/ui/firmware.js` to what the connected panel can honour,
       so the offered buttons and the accepted values cannot drift. It is a
       chooser, not a routine: the panel still receives only the four button
       events. -->
  <div class="minutes" role="group" aria-label="Timer length">
    {#each offeredMinutes as choice (choice)}
      <button
        type="button"
        class="minute"
        class:selected={minutes === choice}
        aria-pressed={minutes === choice}
        disabled={disabled}
        onclick={() => (minutes = choice)}
      >
        {choice} min
      </button>
    {/each}
  </div>

  <ul class="controls">
    {#each routines as routine (routine.id)}
      <li>
        <button
          type="button"
          class="routine"
          data-routine={routine.id}
          disabled={disabled}
          class:in-flight={status.routine === routine.id && busy}
          class:confirmed={status.kind === "confirmed" && status.routine === routine.id}
          onclick={() => sendCommand("start", routine.id, minutes)}
        >
          <span class="art" aria-hidden="true">{routine.artwork}</span>
          <span class="label">{routine.label}</span>
        </button>
      </li>
    {/each}
  </ul>

  <button
    type="button"
    class="cancel"
    disabled={disabled}
    class:in-flight={busy && status.action === "cancel"}
    onclick={() => sendCommand("cancel")}
  >
    Cancel
  </button>

  {#if showComposer}
    <!-- The message composer. It draws on the panel's idle screen, so it is
         offered only while the panel is idle: a scroll over a running countdown
         would mean nothing (design-system.md §10). -->
    <form
      class="message"
      aria-label="Scroll a message across the panel"
      onsubmit={(event) => {
        event.preventDefault();
        sendMessage();
      }}
    >
      <label class="sr-only" for="panel-message">Message for the panel</label>
      <input
        id="panel-message"
        type="text"
        maxlength={messageMaxLen}
        placeholder="Message for the panel"
        value={messageText}
        oninput={(event) => {
          // Accept only what the panel can draw (design-system.md §10.2): a
          // phone keyboard's curly quotes and dashes are folded back to ASCII,
          // and anything the LED font has no glyph for is dropped here, so the
          // server never has to refuse a message that looked fine to type.
          const clean = toPanelText(event.currentTarget.value);
          // Write it back even when it matches the previous value: a dropped
          // character (e.g. an emoji) leaves `messageText` unchanged, and
          // without this the field would still show what it just refused.
          if (clean !== event.currentTarget.value)
            event.currentTarget.value = clean;
          messageText = clean;
        }}
      />
      <button
        type="submit"
        class="send"
        disabled={busy || messageText.trim().length === 0}
        class:in-flight={busy && status.action === "message"}
      >
        Send
      </button>
    </form>
  {/if}

  {#if statusWord}
    <p class="status" role="status" data-tone={tone}>{statusWord}</p>
  {/if}
</main>

<style>
  /* Tokens and the base body live in `src/app.css` (loaded by `+layout.svelte`)
     so the read-only tile at `/tile` shares them — `design-system.md` §2. */

  .remote {
    box-sizing: border-box;
    max-width: 30rem;
    margin: 0 auto;
    min-height: 100dvh;
    padding: max(var(--space-2), env(safe-area-inset-top)) var(--space-2)
      calc(var(--space-2) + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1);
  }
  .head h1 {
    font-size: 1.15rem;
    margin: 0;
    letter-spacing: 0.02em;
  }
  .signed-in {
    margin: 0;
    color: var(--c-muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mirror {
    background: var(--c-surface);
    border-radius: var(--radius);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .liveness {
    margin: 0;
    color: var(--c-muted);
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c-go);
    display: inline-block;
  }
  .liveness.stale .dot {
    background: var(--c-danger);
  }
  .panel {
    position: relative;
    display: block;
    width: 100%;
    max-width: 220px;
    aspect-ratio: 53 / 11;
  }
  .panel .grid {
    display: block;
    width: 100%;
    height: 100%;
  }
  .routine {
    margin: 0;
    font-size: clamp(2rem, 12vw, 3rem);
    font-weight: 700;
    line-height: 1.05;
    word-break: break-word;
  }
  .countdown {
    margin: 0;
    font-size: clamp(1.6rem, 9vw, 2.4rem);
    font-variant-numeric: tabular-nums;
  }
  .stateword {
    margin: 0;
    color: var(--c-muted);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .mirror.shout .routine {
    color: var(--c-go);
  }
  .mirror.handoff .routine {
    animation: shout 0.6s ease-in-out 2;
  }
  @keyframes shout {
    50% {
      transform: scale(1.06);
    }
  }

  .caveat {
    margin: 0;
    color: var(--c-warn);
    font-weight: 600;
  }

  .controls {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-1);
  }
  .controls li {
    display: flex;
  }

  .minutes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    gap: var(--space-1);
  }
  .minute {
    background: var(--c-surface);
    color: var(--c-text);
    border: 1px solid var(--c-muted);
    font-weight: 600;
    min-height: var(--tap-min);
  }
  .minute.selected {
    background: var(--c-text);
    color: var(--c-bg);
    border-color: var(--c-text);
  }

  button {
    font: inherit;
    border: 0;
    cursor: pointer;
    border-radius: var(--radius);
    min-height: var(--tap-min);
    width: 100%;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  button:focus-visible {
    outline: 3px solid var(--c-text);
    outline-offset: 3px;
  }

  .routine {
    background: var(--c-go);
    color: var(--c-on);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: var(--space-1);
  }
  .routine .art {
    font-size: 2rem;
    line-height: 1;
  }
  .routine .label {
    font-size: 0.95rem;
    font-weight: 600;
  }
  .routine.in-flight {
    background: var(--c-go-dim);
  }
  .routine.confirmed {
    background: var(--c-go);
    animation: confirm 0.7s ease-out;
  }
  @keyframes confirm {
    0% {
      box-shadow: 0 0 0 0 var(--c-go);
    }
    100% {
      box-shadow: 0 0 0 14px transparent;
    }
  }

  .cancel {
    background: var(--c-danger);
    color: var(--c-on);
    min-height: 72px;
    font-size: 1.3rem;
    font-weight: 800;
    letter-spacing: 0.12em;
  }
  .cancel.in-flight {
    background: var(--c-warn);
  }

  .status {
    margin: auto 0 0;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius);
    text-align: center;
    font-weight: 600;
    background: var(--c-surface);
  }
  .status[data-tone="warn"] {
    color: var(--c-warn);
  }
  .status[data-tone="go"] {
    color: var(--c-go);
  }
  .status[data-tone="danger"] {
    color: var(--c-danger);
  }

  .banner {
    margin: 0;
    color: var(--c-muted);
    font-size: 0.9rem;
  }

  .message {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-1);
  }
  .message input {
    font: inherit;
    color: var(--c-text);
    background: var(--c-surface);
    border: 1px solid var(--c-muted);
    border-radius: var(--radius);
    padding: 0 var(--space-2);
    min-height: var(--tap-min);
    min-width: 0;
  }
  .message input::placeholder {
    color: var(--c-muted);
  }
  .message input:focus-visible {
    outline: 3px solid var(--c-text);
    outline-offset: 2px;
  }
  .message .send {
    width: auto;
    padding: 0 var(--space-2);
    background: var(--c-go);
    color: var(--c-on);
    font-weight: 700;
  }
  .message .send.in-flight {
    background: var(--c-go-dim);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .conflict {
    background: var(--c-surface);
    border: 2px solid var(--c-warn);
    border-radius: var(--radius);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .conflict p {
    margin: 0;
    color: var(--c-warn);
    font-weight: 600;
  }
  .conflict-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
  }
  .replace {
    background: var(--c-warn);
    color: var(--c-on);
    font-weight: 700;
  }
  .keep {
    background: var(--c-surface);
    color: var(--c-text);
    border: 1px solid var(--c-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .mirror.handoff .routine,
    .routine.confirmed {
      animation: none;
    }
  }
</style>
