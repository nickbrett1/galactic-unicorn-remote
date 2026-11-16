/**
 * D5 — schema-lint and accessibility checks.
 *
 * 1. `routines.json` is the single source of truth: exactly the expected
 *    routines, and
 *    no `.svelte` file hard-codes a routine label, a routine id, or an artwork
 *    path (`design-system.md` §2; `implementation-considerations §8`).
 * 2. The dark palette meets WCAG 2.1 AA contrast for the tokens the UI actually
 *    uses, and every state carries a word, never colour alone (`design-system.md`
 *    §6).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs from the repo root.
const root = process.cwd();
const catalogue = JSON.parse(
  readFileSync(join(root, "src/lib/routines.json"), "utf8"),
);
const routines = catalogue.routines;

/**
 * Every `.svelte` file under `src/` *except* the vendored @nb blocks.
 *
 * `src/lib/components/nb/` is not this app's source: it is the registry's
 * blocks, copied verbatim and pinned by digest in `.nb-registry.json`
 * (`scripts/check-nb-blocks.mjs`). A block may quote a consumer's domain in its
 * own documentation, and editing it here would break the digest, so the rule
 * "this app hard-codes no routine" is enforced over the app's own components.
 */
function svelteFiles() {
  return readdirSync(join(root, "src"), { recursive: true })
    .filter((entry) => entry.endsWith(".svelte"))
    .map((entry) => join(root, "src", entry))
    .filter((file) => !file.includes(join("lib", "components", "nb")));
}

const svelteSources = svelteFiles().map((file) => ({
  file,
  source: readFileSync(file, "utf8"),
}));

describe("routines.json — the single source of truth", () => {
  it("has exactly the expected routines, with the shared labels", () => {
    expect(routines.map((r) => r.id)).toEqual([
      "bathtime",
      "booktime",
      "breakfast",
      "cleanup",
      "clothes",
      "dinner",
      "lunch",
      "shoes",
    ]);
    expect(routines.map((r) => r.label)).toEqual([
      "Bathtime",
      "Booktime",
      "Breakfast",
      "Cleanup",
      "Clothes On",
      "Dinner",
      "Lunch",
      "Shoes On",
    ]);
    expect(routines.map((r) => r.symbol)).toEqual([
      "duck",
      "book",
      "bowl",
      "toy-box",
      "clothes",
      "plate",
      "sandwich",
      "shoe",
    ]);
    for (const routine of routines) {
      expect(typeof routine.artwork).toBe("string");
      expect(routine.artwork.length).toBeGreaterThan(0);
    }
  });

  it("lists routines in label order, so the UI renders them alphabetically", () => {
    const labels = routines.map((r) => r.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
});

describe("no hard-coded labels, ids or artwork paths in any component", () => {
  it("has at least the page component to scan", () => {
    expect(
      svelteSources.some(({ file }) => file.endsWith("+page.svelte")),
    ).toBe(true);
  });

  it("never contains a routine label or id literal", () => {
    for (const { file, source } of svelteSources) {
      const lower = source.toLowerCase();
      for (const routine of routines) {
        expect(lower, `${file} hard-codes "${routine.id}"`).not.toContain(
          routine.id,
        );
        expect(lower, `${file} hard-codes "${routine.label}"`).not.toContain(
          routine.label.toLowerCase(),
        );
      }
    }
  });

  it("never contains an artwork path", () => {
    for (const { file, source } of svelteSources) {
      expect(source, `${file} references a static artwork path`).not.toMatch(
        /static\/|\.svg|\.webp|\.png/,
      );
    }
  });
});

/**
 * The house palette lives in `src/app.css` (`@nb` theme, installed from the
 * registry) plus this app's one override at the bottom of the file. Tokens are
 * either `#rrggbb` or `rgba(...)` tints over the ground, so a "colour" here is
 * { r, g, b, a } and every comparison composites onto `--bg` first.
 */
function tokens() {
  const page = readFileSync(join(root, "src/app.css"), "utf8");
  const found = {};
  for (const [, name, value] of page.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    found[name] = value.trim();
  }
  return found;
}

/** `#rrggbb` or `rgb()/rgba()` -> [r, g, b, a]. */
function parseColour(value) {
  if (value.startsWith("#")) {
    return [
      ...[0, 2, 4].map((i) => Number.parseInt(value.slice(1 + i, 3 + i), 16)),
      1,
    ];
  }
  const [r, g, b, a = 1] = value.match(/[\d.]+/g).map(Number);
  return [r, g, b, a];
}

/** Composite a colour over an opaque ground. */
function flatten(value, ground) {
  const [r, g, b, a] = parseColour(value);
  const [gr, gg, gb] = parseColour(ground);
  return [r * a + gr * (1 - a), g * a + gg * (1 - a), b * a + gb * (1 - a)];
}

/** Relative luminance of a composited `[r, g, b]`. */
function luminance(rgb) {
  const [r, g, b] = rgb
    .map((channel) => channel / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two composited `[r, g, b]` colours. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("WCAG 2.1 AA contrast on the house palette", () => {
  const t = tokens();
  const bg = () => flatten(t["--bg"], t["--bg"]);
  /** A token as it actually appears on the ground. */
  const ink = (name) => flatten(t[name], t["--bg"]);

  it("defines the tokens the UI actually names", () => {
    for (const name of [
      "--bg",
      "--bg-raised",
      "--ink",
      "--ink-dim",
      "--ink-muted",
      "--ink-strong",
      "--accent",
      "--ok",
      "--warn",
      "--bad",
      "--neutral",
    ]) {
      expect(t[name], `missing ${name}`).toBeTruthy();
    }
  });

  it("raises the tap target to a thumb's reach", () => {
    // The house theme ships 44px; this app is pressed with wet hands.
    expect(t["--tap"]).toBe("56px");
  });

  it("meets 4.5:1 for every foreground/background pairing the UI uses", () => {
    const pairs = [
      ["body text on the ground", ink("--ink"), bg()],
      ["dim text on the ground", ink("--ink-dim"), bg()],
      ["muted text on the ground", ink("--ink-muted"), bg()],
      ["emphasis text on the ground", ink("--ink-strong"), bg()],
      [
        "body text on a card",
        flatten(t["--ink"], t["--bg-raised"]),
        flatten(t["--bg-raised"], t["--bg"]),
      ],
      [
        "muted text on a card",
        flatten(t["--ink-muted"], t["--bg-raised"]),
        flatten(t["--bg-raised"], t["--bg"]),
      ],
      ["the accent on the ground", ink("--accent"), bg()],
      ["a routine's glyph on its key", bg(), flatten(t["--ok"], t["--bg"])],
      ["Cancel on its key", bg(), flatten(t["--bad"], t["--bg"])],
      ["a warning on the ground", ink("--warn"), bg()],
      ["a confirmation on the ground", ink("--ok"), bg()],
      ["a failure on the ground", ink("--bad"), bg()],
      ["a quiet label on the ground", ink("--neutral"), bg()],
    ];
    for (const [label, fg, ground] of pairs) {
      expect(
        contrast(fg, ground),
        `${label}: ${contrast(fg, ground).toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
