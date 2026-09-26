<script>
  /**
   * The glanceable tile — a **read-only mirror** for the Homepage dashboard.
   *
   * It shows exactly what the drill-in mirror shows (state, routine, the
   * locally-interpolated countdown, the liveness heartbeat) and nothing that can
   * be pressed: it is an embed, not a remote (`spec/ui/design-system.md` §1, §9).
   * All wording comes from the shared pure formatters, so the tile cannot drift
   * from the remote's language; routine labels and artwork come only from the
   * catalogue on `data`.
   */
  import { onMount, untrack } from "svelte";
  import {
    formatCountdown,
    mirrorHeadline,
    stateWord,
  } from "$lib/ui/format.js";

  let { data } = $props();

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

<main class="tile" data-online={online} data-state={snapshot.panel.state}>
  <section
    class="mirror"
    aria-live="polite"
    class:shout={headline.shout}
    class:handoff={snapshot.panel.state === "handoff"}
  >
    {#if headline.idle}
      <!-- The idle headline is a picture of the panel itself: a 53x11 LED
           matrix, dark body, one lit pixel in the top-left. Inline only —
           no external artwork (`tests/ui-lint.test.js`). -->
      <svg
        class="panel"
        viewBox="0 0 53 11"
        role="img"
        aria-label="Panel: idle, top-left pixel lit"
      >
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
    {:else}
      <p class="headline">{headline.text}</p>
    {/if}
    {#if snapshot.panel.state === "countdown" && countdownText}
      <p class="countdown">{countdownText}</p>
    {/if}
    <p class="stateword">{stateWordText}</p>
  </section>

  <ul class="chips">
    {#each routines as routine (routine.id)}
      <li
        class="chip"
        data-routine={routine.id}
        class:active={routine.id === snapshot.panel.routine}
      >
        <span class="art" aria-hidden="true">{routine.artwork}</span>
        <span class="label">{routine.label}</span>
      </li>
    {/each}
  </ul>
</main>

<style>
  .tile {
    box-sizing: border-box;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .panel {
    display: block;
    width: 100%;
    max-width: 180px;
    height: auto;
    aspect-ratio: 53 / 11;
  }

  .mirror {
    background: var(--c-surface);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .headline {
    margin: 0;
    font-size: clamp(1.5rem, 9vw, 2.2rem);
    font-weight: 700;
    line-height: 1.05;
    word-break: break-word;
  }
  .countdown {
    margin: 0;
    font-size: clamp(1.3rem, 7vw, 1.9rem);
    font-variant-numeric: tabular-nums;
  }
  .stateword {
    margin: 0;
    color: var(--c-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .mirror.shout .headline {
    color: var(--c-go);
  }

  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-1);
  }
  .chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 6px;
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-muted);
    opacity: 0.5;
  }
  .chip.active {
    background: var(--c-go);
    color: var(--c-on);
    opacity: 1;
  }
  .chip .art {
    font-size: 1.5rem;
    line-height: 1;
  }
  .chip .label {
    font-size: 0.75rem;
    font-weight: 600;
  }

  @media (prefers-reduced-motion: reduce) {
    .mirror.handoff .headline {
      animation: none;
    }
  }
</style>
