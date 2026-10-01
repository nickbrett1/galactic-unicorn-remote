/**
 * The idle screen's weather — the shared formatter and the firmware's own glyph
 * masks (P: the one indicator both surfaces draw).
 *
 * Kept free of Svelte and of the DOM, exactly like `format.js`, so the wording
 * and the artwork are host-testable and the remote at `/` and the tile at
 * `/tile` import the SAME module — the tile cannot drift from the remote, and
 * neither can drift from the panel.
 *
 * WHERE THIS COMES FROM. The board owns the reading and the pictures: it polls
 * Open-Meteo itself (`lib/weather.py`), classifies a WMO code into one of seven
 * conditions, and reports the `temp_c` + `condition` pair on the poll it already
 * makes. The service relays them verbatim and never calls a weather API of its
 * own — if each surface fetched its own weather, the page and the panel could
 * disagree about a sky that is only happening once.
 *
 * THE GLYPHS ARE PORTS, NOT LOOKALIKES. The masks below are copied cell for cell
 * from the firmware's `lib/icons.py` (11 rows tall; every glyph is 11 wide
 * except `cloud`, which is 22). Each non-'.' cell is drawn as a block, and the
 * per-condition palettes are the firmware's `ambient.WEATHER_PENS`. Redrawing
 * them here as "close enough" icons is exactly what this file exists to prevent:
 * the phone and the panel must show the same picture.
 *
 * INK SYMBOLS (firmware `_draw_frame`): 'X' body, 'L' lit top, 'S' shade, 'O'
 * accent (the sun in `partly`, the drops / flakes / bolt elsewhere, and the
 * cloud's flank rim). A palette is a `[body, lit, shade, accent]` tuple.
 */

/** The seven conditions the board's `classify` can produce, in glyph order. */
export const WEATHER_CONDITIONS = Object.freeze([
  "sun",
  "partly",
  "cloud",
  "fog",
  "rain",
  "snow",
  "thunder",
]);

/**
 * The words for those names. The board draws one wordless shape; the remote and
 * the tile add the word so colour/artwork is never the only signal (WCAG 2.1 AA,
 * `design-system.md` §6).
 */
const WEATHER_LABELS = Object.freeze({
  sun: "Sunny",
  partly: "Partly cloudy",
  cloud: "Cloudy",
  fog: "Fog",
  rain: "Rain",
  snow: "Snow",
  thunder: "Thunderstorm",
});

/**
 * The label for a condition, or `null` when it is not one of the seven. A
 * `null` label is how the indicator knows to render nothing.
 *
 * @param {string | null | undefined} condition
 * @returns {string | null}
 */
export function weatherLabel(condition) {
  return WEATHER_LABELS[condition] ?? null;
}

/**
 * The temperature as the panel draws it — "-5C", "0C", "18C" (firmware
 * `lib/weather.py:format_temp`). The font that draws it has no degree glyph, and
 * a whole degree is all the panel needs to say.
 *
 * @param {number | null | undefined} tempC
 * @returns {string | null}
 */
export function weatherTemp(tempC) {
  if (!Number.isInteger(tempC)) return null;
  return `${tempC}C`;
}

// -- the ports of lib/icons.py ----------------------------------------------
//
// Transcribed verbatim. Do not "tidy" a mask: an extra or missing cell changes
// the picture the panel shows.

/* eslint-disable sonarjs/no-duplicate-string -- glyph masks and palettes are data, not logic */

const CLOUD_TOP = [
  "...LL.LL...",
  "..LLLLLLL..",
  ".XXXXXXXXX.",
  "XXXXXXXXXXX",
  "SSSSSSSSSSS",
  "SSSSSSSSSSS",
];

const SUN = [
  ".....L.....",
  ".....L.....",
  "..L.LLL.L..",
  "...LLLLL...",
  "..LLLLLLL..",
  "XXXXXXXXXXX",
  "..SSSSSSS..",
  "...SSSSS...",
  "..S.SSS.S..",
  ".....S.....",
  ".....S.....",
];

// Sun in the accent ink (amber), cloud in the body/lit/shade greys.
const PARTLY = [
  "..O........",
  ".OOO.......",
  "OOOOO......",
  ".OOO.......",
  "..O..LLL...",
  "....LLLLL..",
  "...LLLLLLL.",
  "..XXXXXXXXX",
  ".XXXXXXXXXX",
  "XXXXXXXXXXX",
  "SSSSSSSSSSS",
];

// The cloud is the one shaded glyph, and the one glyph wider than the row
// (22 px): a wide silhouette of uneven terraces, lit on top and shadowed
// underneath, with a quiet grey rim on the flanks.
//
// The underside is a solid shaded BASE - two full rows, inset one column each
// side and drawn as a single run per row - with the row above it left as body
// ink between the lit flanks. Transcribed cell for cell from `lib/icons.py`
// `_CLOUD`; do not "tidy" it, the phone must show the panel's own picture.
const CLOUD = [
  "......................",
  "......................",
  "....LLLL..............",
  "...LLLLLLL....LLL.....",
  "...OXXXXLO..LLLLLLL...",
  "...OXXXXXXLLLLXXXLO...",
  "LLLXXXXXXXLLXXXXXXXLLL",
  "OLLXXXXXXXXXXXXXXXXLLO",
  ".SSSSSSSSSSSSSSSSSSSS.",
  ".SSSSSSSSSSSSSSSSSSSS.",
  "......................",
];

const FOG = [
  "...........",
  "..LLLLLLLL.",
  "...........",
  "XXXXXXXXX..",
  "...........",
  "..XXXXXXXX.",
  "...........",
  "SSSSSSSSS..",
  "...........",
  "..SSSSSSSS.",
  "...........",
];

// rain is the one ANIMATED glyph: the shortened cloud with three one-pixel
// streams falling a row per frame. Three frames, cycled by the firmware.
const RAIN_STREAM = "..O..O..O..";
const RAIN_BLANK = "...........";
const RAIN = [0, 1, 2].map((offset) => [
  ...CLOUD_TOP,
  ...[0, 1, 2, 3, 4].map((row) =>
    offset <= row && row < offset + 3 ? RAIN_STREAM : RAIN_BLANK,
  ),
]);

const SNOW = [
  ...CLOUD_TOP,
  "..O.O.O.O..",
  "...........",
  ".O.O.O.O.O.",
  "...........",
  "..O.O.O.O..",
];

const THUNDER = [
  ...CLOUD_TOP,
  "...OO......",
  "..OO.......",
  "..OOOOO....",
  "....OO.....",
  "....O......",
];

/** The frames per condition, each an array of equal-length rows. */
const WEATHER_GLYPHS = {
  sun: [SUN],
  partly: [PARTLY],
  cloud: [CLOUD],
  fog: [FOG],
  rain: RAIN,
  snow: [SNOW],
  thunder: [THUNDER],
};

// -- the ports of ambient.WEATHER_PENS --------------------------------------

/** `rgb(r, g, b)` from a firmware `[r, g, b]` triple. */
function rgb([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

/** One palette: `[body, lit, shade, accent]` triples, resolved to CSS colours. */
function penSet([body, lit, shade, accent]) {
  return {
    body: rgb(body),
    lit: rgb(lit),
    shade: rgb(shade),
    accent: rgb(accent),
  };
}

/**
 * One palette per condition, `[body, lit, shade, accent]` — the firmware's
 * `ambient.WEATHER_PENS`. A condition we do not know falls back to the cloud
 * palette (and the cloud glyph), so nothing ever draws in a bare single ink.
 */
export const WEATHER_PENS = Object.freeze({
  sun: penSet([
    [170, 140, 32],
    [170, 140, 32],
    [170, 140, 32],
    [170, 140, 32],
  ]),
  partly: penSet([
    [120, 150, 170],
    [160, 190, 205],
    [55, 85, 110],
    [185, 145, 25],
  ]),
  cloud: penSet([
    [119, 145, 158],
    [123, 150, 165],
    [55, 84, 106],
    [84, 88, 95],
  ]),
  fog: penSet([
    [70, 110, 140],
    [110, 150, 180],
    [35, 65, 95],
    [70, 110, 140],
  ]),
  rain: penSet([
    [85, 120, 150],
    [125, 160, 190],
    [40, 70, 100],
    [0, 140, 200],
  ]),
  snow: penSet([
    [110, 140, 160],
    [170, 195, 210],
    [60, 90, 115],
    [200, 225, 235],
  ]),
  thunder: penSet([
    [80, 105, 130],
    [120, 150, 175],
    [38, 62, 88],
    [210, 185, 40],
  ]),
});

/* eslint-enable sonarjs/no-duplicate-string */

/** Which palette slot each ink symbol uses (firmware `_draw_frame`). */
const INK_PEN = { X: "body", L: "lit", S: "shade", O: "accent" };

/**
 * One frame as run-length rects: consecutive cells of the SAME ink become one
 * `{x, y, w, fill}` rect, which is exactly how the firmware blits a row. The
 * fill is resolved through the condition's palette.
 */
function frameRects(frame, pens) {
  const rects = [];
  frame.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ink = row[x];
      if (!INK_PEN[ink]) {
        x += 1;
        continue;
      }
      let width = 1;
      while (x + width < row.length && row[x + width] === ink) width += 1;
      rects.push({ x, y, w: width, fill: pens[INK_PEN[ink]] });
      x += width;
    }
  });
  return rects;
}

/**
 * The glyph for a condition: its pixel dimensions and each frame as run-length
 * rects ready to drop into inline SVG. Returns `null` for anything that is not
 * one of the seven, so an unknown reading draws nothing.
 *
 * `frames` is a faithful port of the firmware's frame list — `rain` carries
 * three, the rest one. The indicator paints the first frame; the rest are kept
 * so the port stays complete (and testable) rather than lossy.
 *
 * @param {string | null | undefined} condition
 * @returns {{width: number, height: number, frames: Array<Array<{x:number,y:number,w:number,fill:string}>>} | null}
 */
export function weatherIcon(condition) {
  const frames = WEATHER_GLYPHS[condition];
  if (!frames) return null;
  const pens = WEATHER_PENS[condition] ?? WEATHER_PENS.cloud;
  return {
    width: frames[0][0].length,
    height: frames[0].length,
    frames: frames.map((frame) => frameRects(frame, pens)),
  };
}
