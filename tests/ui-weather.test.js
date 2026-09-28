/**
 * P — the shared weather helper (`$lib/ui/weather.js`).
 *
 * The module is pure and DOM-free, so the wording AND the ported glyph masks are
 * pinned here: if the mask stops matching the firmware's `lib/icons.py`, the
 * phone stops drawing what the panel draws — which is the one thing this module
 * exists to prevent.
 */

import { describe, expect, it } from "vitest";

import {
  WEATHER_CONDITIONS,
  WEATHER_PENS,
  weatherIcon,
  weatherLabel,
  weatherTemp,
} from "../src/lib/ui/weather.js";

describe("weatherLabel", () => {
  it("names all seven conditions and nothing else", () => {
    expect([...WEATHER_CONDITIONS]).toEqual([
      "sun",
      "partly",
      "cloud",
      "fog",
      "rain",
      "snow",
      "thunder",
    ]);
    expect(WEATHER_CONDITIONS.map(weatherLabel)).toEqual([
      "Sunny",
      "Partly cloudy",
      "Cloudy",
      "Fog",
      "Rain",
      "Snow",
      "Thunderstorm",
    ]);
    expect(weatherLabel("hail")).toBeNull();
    expect(weatherLabel(null)).toBeNull();
    expect(weatherLabel(undefined)).toBeNull();
  });
});

describe("weatherTemp", () => {
  it("draws a whole degree with a trailing C; negative and zero are normal", () => {
    expect(weatherTemp(18)).toBe("18C");
    expect(weatherTemp(0)).toBe("0C");
    expect(weatherTemp(-5)).toBe("-5C");
  });

  it("refuses anything that is not a whole number", () => {
    expect(weatherTemp(3.5)).toBeNull();
    expect(weatherTemp("18")).toBeNull();
    expect(weatherTemp(null)).toBeNull();
    expect(weatherTemp(undefined)).toBeNull();
  });
});

describe("weatherIcon — the firmware masks, ported", () => {
  it("draws nothing for anything but the seven conditions", () => {
    expect(weatherIcon("hail")).toBeNull();
    expect(weatherIcon(null)).toBeNull();
  });

  it("is 11x11 per glyph, except the cloud which is 22 wide", () => {
    expect(weatherIcon("sun")).toMatchObject({ width: 11, height: 11 });
    expect(weatherIcon("cloud")).toMatchObject({ width: 22, height: 11 });
    expect(weatherIcon("rain")).toMatchObject({ width: 11, height: 11 });
  });

  it("keeps the firmware's frame counts — only rain animates", () => {
    for (const condition of WEATHER_CONDITIONS) {
      const frames = weatherIcon(condition).frames;
      expect(frames.length, condition).toBe(condition === "rain" ? 3 : 1);
    }
  });

  it("run-length-encodes a row, merging same-ink cells and skipping blanks", () => {
    // lib/icons.py `_SUN` row 5 is eleven body cells: one run, the full width.
    const sunRow = weatherIcon("sun").frames[0].filter((rect) => rect.y === 5);
    expect(sunRow).toEqual([
      { x: 0, y: 5, w: 11, fill: WEATHER_PENS.sun.body },
    ]);
  });

  it("maps each ink symbol to the condition's palette (cloud row 7)", () => {
    // lib/icons.py `_CLOUD` row 7 is "OLLXXXXXXXXXXXXXXXXLLO": accent, two lit,
    // sixteen body, two lit, accent — the exact run breakdown the panel blits.
    const row = weatherIcon("cloud").frames[0].filter((rect) => rect.y === 7);
    expect(row).toEqual([
      { x: 0, y: 7, w: 1, fill: WEATHER_PENS.cloud.accent },
      { x: 1, y: 7, w: 2, fill: WEATHER_PENS.cloud.lit },
      { x: 3, y: 7, w: 16, fill: WEATHER_PENS.cloud.body },
      { x: 19, y: 7, w: 2, fill: WEATHER_PENS.cloud.lit },
      { x: 21, y: 7, w: 1, fill: WEATHER_PENS.cloud.accent },
    ]);
  });

  it("keeps every rect inside the glyph", () => {
    for (const condition of WEATHER_CONDITIONS) {
      const icon = weatherIcon(condition);
      for (const frame of icon.frames) {
        expect(frame.length, condition).toBeGreaterThan(0);
        for (const rect of frame) {
          expect(rect.w, condition).toBeGreaterThanOrEqual(1);
          expect(rect.x, condition).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w, condition).toBeLessThanOrEqual(icon.width);
          expect(rect.y, condition).toBeGreaterThanOrEqual(0);
          expect(rect.y, condition).toBeLessThan(icon.height);
        }
      }
    }
  });

  it("paints each condition in its own four-ink palette", () => {
    for (const condition of WEATHER_CONDITIONS) {
      const pens = Object.values(WEATHER_PENS[condition]);
      expect(pens).toHaveLength(4);
      const used = new Set(
        weatherIcon(condition)
          .frames.flat()
          .map((rect) => rect.fill),
      );
      for (const fill of used) expect(pens).toContain(fill);
    }
  });
});
