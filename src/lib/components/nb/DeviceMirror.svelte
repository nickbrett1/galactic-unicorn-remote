<script>
  /**
   * DeviceMirror — a live mirror of a remote device.
   *
   * Lifted from galactic-unicorn-remote, where the page is not a dashboard about
   * a device but a *second view of the device itself*: the panel's own screen,
   * its countdown, the word for its state, and how long ago it last spoke. The
   * phone never computes the countdown — it relays the board's `remaining_s`
   * and interpolates between polls — so the card's job is to be honest about
   * *freshness*, not to be a clock.
   *
   * Why this is not `status-view` or `meter-strip`: a status lane is a bucket of
   * records, and a meter is a ratio against a ceiling. Neither can say "this is
   * what the hardware is drawing right now", which is the whole of this shape.
   *
   * Slots and props:
   *   `screen`    -- the device's own picture, when it has one (an idle screen,
   *                  a chart, a face). Replaces the headline rather than sitting
   *                  above it, because on the device it *is* the headline.
   *   `liveness`  -- `{ label, seen }`; `seen` is already formatted ("2 s ago")
   *                  because only the caller knows its poll cadence. Omit the
   *                  whole object on a glanceable surface that has no room to
   *                  explain it (`compact` does this too).
   *   `countdown` -- a formatted string, never a number: the block does not own
   *                  a clock, and a caller that formats "3:34" has already
   *                  decided how the passage of time is shown.
   *   `banner`    -- a line the device is currently displaying alongside its
   *                  screen (a scrolling message), not a command's status.
   *   `centered`  -- centre the picture in the card, for a widget whose screen
   *                  is a badge rather than a left-aligned report.
   */
  let {
    name = "device",
    online = true,
    liveness = null,
    state = "",
    headline = "",
    shout = false,
    countdown = "",
    stateWord = "",
    banner = "",
    compact = false,
    centered = false,
    live = true,
    screen,
  } = $props();

  const hasScreen = $derived(Boolean(screen));
</script>

<section
  class="card mirror"
  class:compact
  class:idle={hasScreen}
  class:centered={hasScreen && centered}
  class:shout
  class:handoff={state === "handoff"}
  data-state={state || undefined}
  data-online={online}
  aria-live={live ? "polite" : undefined}
>
  {#if liveness && !compact}
    <p class="liveness" class:stale={!online}>
      <span class="dot" aria-hidden="true"></span>
      {liveness.label ?? name}: last seen {liveness.seen}
    </p>
  {/if}

  {#if hasScreen}
    <div class="screen">{@render screen()}</div>
  {:else if headline}
    <p class="headline">{headline}</p>
  {/if}

  {#if countdown}
    <p class="countdown num">{countdown}</p>
  {/if}

  {#if stateWord}
    <p class="stateword micro">{stateWord}</p>
  {/if}

  {#if banner}
    <p class="banner">scrolling: “{banner}”</p>
  {/if}
</section>

<style>
  .mirror {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .liveness {
    margin: 0;
    color: var(--ink-muted);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--ok);
    display: inline-block;
    flex: none;
  }
  .liveness.stale .dot {
    background: var(--bad);
  }

  .screen {
    display: block;
  }

  /* A picture is a badge, not a line of prose: centre it when the caller says
     the surface is a widget. The remote keeps its picture left-aligned. */
  .mirror.centered {
    align-items: center;
    text-align: center;
  }

  .headline {
    margin: 0;
    font-size: clamp(2rem, 12vw, 3rem);
    font-weight: 700;
    line-height: 1.05;
    overflow-wrap: anywhere;
  }
  .compact .headline {
    font-size: clamp(1.5rem, 9vw, 2.2rem);
  }
  .shout .headline {
    color: var(--ok);
  }
  .handoff .headline {
    animation: shout 0.6s ease-in-out 2;
  }
  @keyframes shout {
    50% {
      transform: scale(1.06);
    }
  }

  .countdown {
    margin: 0;
    font-size: clamp(1.6rem, 9vw, 2.4rem);
  }
  .compact .countdown {
    font-size: clamp(1.3rem, 7vw, 1.9rem);
  }

  .stateword {
    margin: 0;
  }

  .banner {
    margin: 0;
    color: var(--ink-muted);
    font-size: 13px;
  }

  @media (prefers-reduced-motion: reduce) {
    .handoff .headline {
      animation: none;
    }
  }
</style>
