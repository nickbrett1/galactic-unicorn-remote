<script>
  /**
   * The remote — D1/D2/D3.
   *
   * Mobile-first and deliberately small: "a remote, not a control panel"
   * (`spec/ui/design-system.md`). One press per routine (the panel's own
   * buttons, plus the remote-only one) and one Cancel, one countdown-length
   * chooser (default 5 — T6), a live mirror, and the honest "sent vs done"
   * states. A routine or a length the connected panel's firmware cannot honour
   * is withheld, never offered as a lie.
   *
   * The shapes are the registry's, the logic is the app's: `AppShell` frames the
   * page, `DeviceMirror` relays what the panel is showing, `CommandPad` is the
   * keypad, `MessageBar` the idle-screen composer, and `ConfirmPrompt` the 409
   * decision. All of the wiring lives in pure helpers (`$lib/ui/format.js`,
   * `$lib/ui/command.js`) so the one hard UX rule is unit-testable. Routine ids,
   * labels and artwork come ONLY from the catalogue on `data` — nothing here
   * hard-codes a label or a path (`design-system.md` §2).
   */
  import { onMount, untrack } from "svelte";
  import { DEFAULT_MINUTES } from "$lib/minutes.js";
  import { availableMinutes, availableRoutines } from "$lib/ui/firmware.js";
  import { formatCountdown, formatLastSeen, mirrorHeadline, stateWord, labelForRoutine } from "$lib/ui/format.js";
  import { initialStatus, isBusy, reduceStatus, statusText, statusTone } from "$lib/ui/command.js";
  import { toPanelText } from "$lib/ui/panel-text.js";
  import AppShell from "$lib/components/nb/AppShell.svelte";
  import DeviceMirror from "$lib/components/nb/DeviceMirror.svelte";
  import CommandPad from "$lib/components/nb/CommandPad.svelte";
  import MessageBar from "$lib/components/nb/MessageBar.svelte";
  import ConfirmPrompt from "$lib/components/nb/ConfirmPrompt.svelte";
  import PanelScreen from "$lib/ui/PanelScreen.svelte";

  /* global __NB_BUILD__ */

  let { data } = $props();

  // Which build is on screen. `__NB_BUILD__` is the commit the image was built
  // from, baked in by vite's `define`; a checkout or a test run says "dev". Seven
  // characters is enough to compare against `git log` and short enough for a
  // 10px micro-label; the full sha is in the `title`.
  const buildLabel = __NB_BUILD__.slice(0, 7);

  // How long the SSE stream may go silent before the 2 s `/api/state` poll takes
  // over. While this page is a live subscriber the board polls every ~2 s, so a
  // stream that has delivered nothing for several seconds is stalled, not idle.
  const STALE_STREAM_MS = 6000;

  const routines = $derived(data.snapshot.routines);

  // The countdown length a start (or a replace) asks for: 1, 2, 3, 5 or 10
  // minutes, default 5. It rides ALONGSIDE the routine event — the panel still only
  // ever gets the four button events; this is the length, not a fifth one.
  let minutes = $state(DEFAULT_MINUTES);

  // The mirror paints from the last `StateSnapshot`; SSE keeps it live and the
  // 2 s `/api/state` poll is the indistinguishable fallback (memo §11.7).
  let snapshot = $state(untrack(() => data.snapshot));
  let syncAt = $state(Date.now());
  let nowMs = $state(Date.now());

  // The routine buttons the *connected panel* can start. The remote-only
  // routine landed in board 0.1.55; a board older than that drops the start
  // without a word, so the button is withheld rather than offered as a lie
  // (the same rule `offeredMinutes` applies to a length).
  let offeredRoutines = $derived(
    availableRoutines(routines, snapshot?.panel?.fw),
  );

  // The lengths the *connected panel* can honour (T6.1/T6.2 stopgap). A board
  // older than 0.1.51 would silently downgrade a 10-minute ask to its routine
  // default, one older than 0.1.52 would do the same for 2 minutes, one older
  // than 0.1.57 for 20 minutes, and one older than 0.1.58 for 15 minutes, so
  // never offer a length it cannot do — better no button than a lie. Unknown
  // `fw` errs safe the same way; 10 needs >= 0.1.51, 2 needs >= 0.1.52,
  // 20 needs >= 0.1.57 and 15 needs >= 0.1.58.
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

  // The pad is the routines the panel can start, plus the one big Cancel.
  // Cancel maps to the panel's `D` — it is a command, so it shares the keypad,
  // but it is not a routine and has no catalogue entry.
  let padItems = $derived([
    ...offeredRoutines.map((routine) => ({
      id: routine.id,
      label: routine.label,
      icon: routine.artwork,
      tone: "ok",
    })),
    { id: "cancel", label: "Cancel", icon: "✕", tone: "bad", span: "full", tall: true },
  ]);

  // Which pad target is in flight, and which one just landed. Ids, not booleans:
  // the pad has to light the one command the status is about.
  let busyId = $derived(
    busy
      ? status.action === "cancel"
        ? "cancel"
        : (status.routine ?? null)
      : null,
  );
  let confirmedId = $derived(
    status.kind === "confirmed" ? status.routine : null,
  );

  // The theme's tones are roles (ok/warn/bad/accent); the command reducer still
  // speaks the app's words (go/danger). One mapping, in the view.
  let noticeTone = $derived(
    tone === "go" ? "ok" : tone === "danger" ? "bad" : tone,
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

  function pressPad(item) {
    if (item.id === "cancel") sendCommand("cancel");
    else sendCommand("start", item.id, minutes);
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
    let watchdog = null;

    // When the EVENT STREAM last actually painted a frame (0 = none yet). An
    // open `EventSource` is NOT proof the stream is flowing: a buffering proxy
    // or a stalled tunnel (Cloudflare) holds the connection open and sends
    // nothing, and `onerror` may never fire. Stopping the poll on `onopen` —
    // as this used to — meant that a silent-but-open stream froze the mirror,
    // so a perfectly healthy panel drifted past the offline threshold and read
    // as "offline". Prove the stream is live before trusting it, and take it
    // back when it goes quiet again.
    let lastFrameAt = 0;

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
          lastFrameAt = Date.now();
        } catch {
          // A malformed frame is ignored, never fatal.
        }
      });
      // Unknown frame names are ignored, not errored (forward compatibility).
      source.addEventListener("audit", () => {});
      source.onerror = () => startPolling();
      // Poll from the first moment: until the stream delivers a frame, the poll
      // IS the source of truth. While a subscriber (this page) is connected the
      // board polls every ~2 s, so a silence longer than a few seconds is a
      // stall, not a healthy quiet.
      startPolling();
      watchdog = setInterval(() => {
        if (lastFrameAt && Date.now() - lastFrameAt <= STALE_STREAM_MS) {
          stopPolling();
        } else {
          startPolling();
        }
      }, STALE_STREAM_MS);
    } else {
      startPolling();
    }

    return () => {
      clearInterval(clock);
      if (watchdog) clearInterval(watchdog);
      stopPolling();
      source?.close();
    };
  });
</script>

<svelte:head>
  <title>Home Display</title>
  <!-- No `theme-color` here: `app.html` owns it, so the browser chrome and
       `--bg` cannot disagree. A second copy is what let the old navy sit above
       the new ground. -->
</svelte:head>

<AppShell
  title="Home Display"
  subtitle={data.door?.email ? `signed in as ${data.door.email}` : ""}
  footer={buildFooter}
>
  {#snippet buildFooter()}
    <span class="micro" title={__NB_BUILD__}>build {buildLabel}</span>
  {/snippet}
  <div class="remote" data-online={online}>
    {#snippet panelScreen()}
      <PanelScreen
        condition={snapshot.panel?.condition}
        tempC={snapshot.panel?.temp_c}
      />
    {/snippet}

    <DeviceMirror
      name="panel"
      {online}
      liveness={{ label: "panel", seen: formatLastSeen(lastSeenS) }}
      state={snapshot.panel.state}
      headline={headline.text}
      shout={headline.shout}
      countdown={snapshot.panel.state === "countdown" ? (countdownText ?? "") : ""}
      stateWord={stateWordText}
      banner={liveBanner ?? ""}
      screen={headline.idle ? panelScreen : undefined}
    />

    {#if !online}
      <p class="notice warn" role="alert">
        The panel is offline — controls are disabled until it's seen again.
      </p>
    {/if}

    {#if status.kind === "conflict"}
      <ConfirmPrompt
        message="{conflictCurrentLabel} is running — start instead?"
        confirmLabel="Replace"
        cancelLabel="Keep"
        tone="warn"
        bind:element={replaceBtn}
        onconfirm={() => sendCommand("replace", status.requested, minutes)}
        oncancel={() => dispatch({ type: "reset" })}
      />
    {/if}

    <!-- The countdown length a start asks for. A `.seg` that owns the row and
         every target is a thumb (`.seg.tap`): one choice from a closed set, not
         a routine. The panel still receives only the button events. -->
    <div class="seg tap" role="group" aria-label="Timer length">
      {#each offeredMinutes as choice (choice)}
        <button
          type="button"
          class:on={minutes === choice}
          aria-pressed={minutes === choice}
          disabled={disabled}
          onclick={() => (minutes = choice)}
        >
          {choice} min
        </button>
      {/each}
    </div>

    <CommandPad
      items={padItems}
      label="Routines"
      disabled={disabled}
      busyId={busyId}
      confirmedId={confirmedId}
      onpress={pressPad}
    />

    {#if showComposer}
      <!-- The message composer. It draws on the panel's idle screen, so it is
           offered only while the panel is idle: a scroll over a running countdown
           would mean nothing (design-system.md §10). -->
      <MessageBar
        bind:value={messageText}
        label="Message for the panel"
        placeholder="Message for the panel"
        maxLength={messageMaxLen}
        submitLabel="Send"
        sanitize={toPanelText}
        disabled={busy}
        pending={busy && status.action === "message"}
        onsubmit={sendMessage}
      />
    {/if}

    {#if statusWord}
      <p class="status notice {noticeTone}" role="status">{statusWord}</p>
    {/if}
  </div>
</AppShell>

<style>
  .remote {
    box-sizing: border-box;
    max-width: 30rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: calc(8px + var(--safe-bottom));
  }

  /* The status line is the last thing in the flow; push it to the bottom when
     the viewport leaves room, like the old page did. */
  .remote :global(.status) {
    margin-top: auto;
    text-align: center;
    font-size: 13px;
  }
</style>
