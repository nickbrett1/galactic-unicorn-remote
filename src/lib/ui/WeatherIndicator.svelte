<script>
  /**
   * The idle screen's weather indicator — P. One component, imported by BOTH
   * surfaces (`/` and `/tile`), so the tile cannot drift from the remote.
   *
   * The reading arrives from the board as a PAIR (`condition` + `temp_c`) and is
   * drawn from the firmware's OWN masks via `$lib/ui/weather.js` — the same 7
   * glyphs the panel draws, not lookalike icons. With no reading (the normal
   * "the board has no weather yet" case, not a failure) it renders NOTHING:
   * there is deliberately no placeholder, because anything that looks like
   * weather when there is none would be a lie the panel does not tell.
   *
   * The service never fetches a weather API itself — it relays what the board
   * already read, so the page and the panel cannot disagree about the sky.
   */
  import { weatherIcon, weatherLabel, weatherTemp } from "$lib/ui/weather.js";

  /**
   * `chip` (default) is the standalone dark chip. `screen` draws the same
   * glyph and value with no chrome, centred on top of the idle card's picture
   * of the panel — because the weather IS what the panel shows on its screen,
   * so it belongs inside the drawing rather than below it.
   *
   * @type {{condition?: string | null, tempC?: number | null, variant?: 'chip' | 'screen'}} */
  let { condition = null, tempC = null, variant = "chip" } = $props();

  const label = $derived(weatherLabel(condition));
  const temp = $derived(weatherTemp(tempC));
  const icon = $derived(weatherIcon(condition));

  // A half a pair has no glyph behind it: the board always sends both or
  // neither, so a lone half draws nothing rather than guessing at the other.
  const shown = $derived(label !== null && temp !== null && icon !== null);
</script>

{#if shown}
  <span
    class="weather {variant}"
    role="img"
    aria-label={`${label}, ${temp}`}
    data-condition={condition}
  >
    <svg
      class="glyph"
      viewBox={`0 0 ${icon.width} ${icon.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {#each icon.frames[0] as run}
        <rect x={run.x} y={run.y} width={run.w} height="1" fill={run.fill} />
      {/each}
    </svg>
    <span class="temp" aria-hidden="true">{temp}</span>
  </span>
{/if}

<style>
  /* A small dark chip, like the panel's own surround, so the glyph's lit /
     shade steps read the way they do on the hardware. The colours of the
     picture come from the firmware palettes in `$lib/ui/weather.js`. */
  .weather {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: var(--radius);
    background: var(--c-bg);
    border: 1px solid rgb(255 255 255 / 0.08);
  }

  .glyph {
    display: block;
    height: 20px;
    width: auto;
  }

  .temp {
    color: rgb(150, 190, 212);
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }

  /* `screen`: no chip chrome — the glyph and value are drawn ON the panel
     picture, centred, so they read as the panel's own screen content. The
     absolute fill is what centres them against the panel frame behind. */
  .weather.screen {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
  }

  .weather.screen .glyph {
    height: 62%;
    /* Never taller than the frame it sits in, even if the glyph is 11 rows. */
    max-height: 100%;
  }

  .weather.screen .temp {
    font-size: clamp(0.85rem, 3.2vw, 1.15rem);
  }
</style>
