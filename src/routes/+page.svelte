<script>
  /**
   * The remote — D1/D2/D3.
   *
   * Mobile-first and deliberately small: "a remote, not a control panel"
   * (`spec/ui/design-system.md`). Exactly four controls (three routine buttons
   * plus one Cancel), a live mirror, and the honest "sent vs done" states.
   *
   * All of the wiring lives in pure helpers (`$lib/ui/format.js`,
   * `$lib/ui/command.js`) so the one hard UX rule is unit-testable. Routine ids,
   * labels and artwork come ONLY from the catalogue on `data` — nothing here
   * hard-codes a label or a path (`design-system.md` §2).
   */
  import { onMount, untrack } from "svelte";
  import { formatCountdown, formatLastSeen, mirrorHeadline, stateWord, labelForRoutine } from "$lib/ui/format.js";
  import { initialStatus, isBusy, reduceStatus, statusText, statusTone } from "$lib/ui/command.js";

  let { data } = $props();

  const routines = $derived(data.snapshot.routines);

  // The mirror paints from the last `StateSnapshot`; SSE keeps it live and the
  // 2 s `/api/state` poll is the indistinguishable fallback (memo §11.7).
  let snapshot = $state(untrack(() => data.snapshot));
  let syncAt = $state(Date.now());
  let nowMs = $state(Date.now());

  // The command's life: sending… → confirmed, and confirmed ONLY from applied_gen.
  let status = $state(initialStatus());
  let replaceBtn = $state(null);

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

  async function sendCommand(action, routine = null) {
    // Optimistic PRESS, never optimistic success (`design-system.md` §4).
    dispatch({ type: "press", action, routine });
    const url =
      action === "cancel"
        ? "/api/cancel"
        : action === "replace"
          ? "/api/replace"
          : "/api/start";
    const body = action === "cancel" ? {} : { routine };
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

  // A confirmation (or a small notice) flashes, then clears itself.
  $effect(() => {
    if (
      status.kind === "confirmed" ||
      status.kind === "noop" ||
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
    <p class="routine">{headline.text}</p>
    {#if snapshot.panel.state === "countdown" && countdownText}
      <p class="countdown">{countdownText}</p>
    {/if}
    <p class="stateword">{stateWordText}</p>
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
          onclick={() => sendCommand("replace", status.requested)}
        >
          Replace
        </button>
        <button type="button" class="keep" onclick={() => dispatch({ type: "reset" })}>
          Keep
        </button>
      </div>
    </div>
  {/if}

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
          onclick={() => sendCommand("start", routine.id)}
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
