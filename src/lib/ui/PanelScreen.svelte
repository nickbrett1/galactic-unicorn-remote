<script>
  /**
   * The panel's own idle screen, drawn inline.
   *
   * A 53x11 LED matrix: dark body, one lit pixel in the top-left, and — when the
   * board has a reading — the firmware's own weather glyphs centred on it. This
   * is a picture of *this* device, not a layout, so it lives in the app rather
   * than the registry; `DeviceMirror` takes it through its `screen` slot.
   *
   * There is deliberately no external artwork: the drawing is part of the page,
   * so it cannot 404 and cannot drift from the firmware's matrix shape.
   * `$props.id()` keeps the dot pattern's id unique if the picture ever appears
   * twice on one page (it is rendered on `/` and `/tile`).
   */
  import WeatherIndicator from "./WeatherIndicator.svelte";

  let { condition = null, tempC = null, maxWidth = "220px" } = $props();

  const dots = $props.id();
</script>

<span
  class="panel"
  role="img"
  aria-label="Panel: idle, top-left pixel lit"
  style="max-width: {maxWidth}"
>
  <svg class="grid" viewBox="0 0 53 11" aria-hidden="true" focusable="false">
    <defs>
      <pattern
        id={dots}
        width="1"
        height="1"
        patternUnits="userSpaceOnUse"
      >
        <circle cx="0.5" cy="0.5" r="0.16" fill="var(--ink-faint)" />
      </pattern>
    </defs>
    <rect
      x="0.25"
      y="0.25"
      width="52.5"
      height="10.5"
      rx="1.5"
      fill="var(--bg-sunken)"
      stroke="var(--ink-faint)"
      stroke-width="0.5"
    />
    <rect
      x="0.25"
      y="0.25"
      width="52.5"
      height="10.5"
      rx="1.5"
      fill="url(#{dots})"
      opacity="0.25"
    />
    <rect x="0.25" y="0.25" width="1" height="1" fill="var(--ink-strong)" />
  </svg>
  <!-- The idle panel IS the panel's weather screen, so the same reading the
       hardware is drawing is drawn inside the picture. No reading renders
       nothing (firmware lib/weather.py). -->
  <WeatherIndicator variant="screen" {condition} {tempC} />
</span>

<style>
  .panel {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 53 / 11;
  }

  .panel .grid {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
