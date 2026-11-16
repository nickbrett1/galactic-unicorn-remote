<script>
  /**
   * The glanceable tile — a **read-only mirror** for the Homepage dashboard.
   *
   * It shows exactly what the drill-in mirror shows (state, routine, the
   * locally-interpolated countdown) and nothing that can be pressed: it is an
   * embed, not a remote (`spec/ui/design-system.md` §1, §9). All wording comes
   * from the shared pure formatters, so the tile cannot drift from the remote's
   * language; routine labels and artwork come only from the catalogue on `data`.
   *
   * Both shapes are the registry's: `DeviceMirror` with `compact` (no liveness
   * line, a widget has no room to explain it) and `CommandPad` with `readonly`
   * — the same keypad as the remote, with the active routine lit and no press
   * affordance.
   */
  import { onMount, untrack } from "svelte";
  import {
    formatCountdown,
    mirrorHeadline,
    stateWord,
  } from "$lib/ui/format.js";
  import DeviceMirror from "$lib/components/nb/DeviceMirror.svelte";
  import CommandPad from "$lib/components/nb/CommandPad.svelte";
  import PanelScreen from "$lib/ui/PanelScreen.svelte";

  let { data } = $props();

  // How long the SSE stream may go silent before the 2 s `/api/state` poll takes
  // over. While this tile is a live subscriber the board polls every ~2 s, so a
  // stream that has delivered nothing for several seconds is stalled, not idle.
  const STALE_STREAM_MS = 6000;

  const routines = $derived(data.snapshot.routines);

  // Painted from the last `StateSnapshot`; SSE keeps it live and the 2 s
  // `/api/state` poll is the indistinguishable fallback (`design-system.md` §7).
  let snapshot = $state(untrack(() => data.snapshot));
  let syncAt = $state(Date.now());
  let nowMs = $state(Date.now());

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

  // `remaining_s` is relayed from the board and only interpolated here — the
  // server never computes a countdown (`design-system.md` §3).
  let remaining = $derived.by(() => {
    const base = snapshot?.panel?.remaining_s;
    if (base === null || base === undefined) return null;
    return Math.max(0, base - (nowMs - syncAt) / 1000);
  });
  let countdownText = $derived(formatCountdown(remaining));
  let headline = $derived(mirrorHeadline(snapshot?.panel ?? {}, routines));
  let stateWordText = $derived(stateWord(snapshot?.panel?.state));

  // The routine caps as a legend, never buttons.
  let legend = $derived(
    routines.map((routine) => ({
      id: routine.id,
      label: routine.label,
      icon: routine.artwork,
    })),
  );

  function applySnapshot(next) {
    if (!next) return;
    snapshot = next;
    syncAt = Date.now();
  }

  onMount(() => {
    const clock = setInterval(() => {
      nowMs = Date.now();
    }, 1000);

    let source = null;
    let poll = null;
    let watchdog = null;

    // When the EVENT STREAM last actually painted a frame (0 = none yet). An
    // open `EventSource` is NOT proof the stream is flowing: a buffering proxy
    // or a stalled tunnel holds the connection open and sends nothing, and
    // `onerror` may never fire. Stopping the poll on `onopen` let a
    // silent-but-open stream freeze the mirror, so a healthy panel drifted past
    // the offline threshold and read as "offline". Prove the stream is live
    // before trusting it, and take it back when it goes quiet again.
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
      source.onerror = () => startPolling();
      // Poll from the first moment: until the stream delivers a frame, the poll
      // IS the source of truth. While this tile is a live subscriber the board
      // polls every ~2 s, so a silence longer than a few seconds is a stall.
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

<main class="tile" data-online={online} data-state={snapshot.panel.state}>
  {#snippet panelScreen()}
    <PanelScreen
      maxWidth="180px"
      condition={snapshot.panel?.condition}
      tempC={snapshot.panel?.temp_c}
    />
  {/snippet}

  <DeviceMirror
    name="panel"
    {online}
    compact
    centered
    state={snapshot.panel.state}
    headline={headline.text}
    shout={headline.shout}
    countdown={snapshot.panel.state === "countdown" ? (countdownText ?? "") : ""}
    stateWord={stateWordText}
    screen={headline.idle ? panelScreen : undefined}
  />

  <!-- The routine caps appear as inert chips, the active one lit — the same
       symbol language as the remote's pad, with no affordance to press. -->
  <CommandPad
    items={legend}
    readonly
    columns={3}
    busyId={snapshot.panel.routine}
    label="Routines"
  />
</main>

<style>
  .tile {
    box-sizing: border-box;
    max-width: 24rem;
    margin: 0 auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
