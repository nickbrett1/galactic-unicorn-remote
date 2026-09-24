/**
 * D5 — schema-lint and accessibility checks.
 *
 * 1. `routines.json` is the single source of truth: exactly three routines, and
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

/** Every `.svelte` file under `src/`. */
function svelteFiles() {
  return readdirSync(join(root, "src"), { recursive: true })
    .filter((entry) => entry.endsWith(".svelte"))
    .map((entry) => join(root, "src", entry));
}

const svelteSources = svelteFiles().map((file) => ({
  file,
  source: readFileSync(file, "utf8"),
}));

describe("routines.json — the single source of truth", () => {
  it("has exactly the three routines, with the shared labels", () => {
    expect(routines.map((r) => r.id)).toEqual([
      "bathtime",
      "booktime",
      "cleanup",
    ]);
    expect(routines.map((r) => r.label)).toEqual([
      "Bathtime",
      "Booktime",
      "Cleanup",
    ]);
    expect(routines.map((r) => r.symbol)).toEqual(["duck", "book", "toy-box"]);
    for (const routine of routines) {
      expect(typeof routine.artwork).toBe("string");
      expect(routine.artwork.length).toBeGreaterThan(0);
    }
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

/** Relative luminance of an `#rrggbb` colour. */
function luminance(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4]
    .map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull the `--c-*` tokens out of the page's stylesheet. */
function tokens() {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  const found = {};
  for (const [, name, hex] of page.matchAll(
    /(--c-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g,
  )) {
    found[name] = hex;
  }
  return found;
}

describe("WCAG 2.1 AA contrast on the dark palette", () => {
  const t = tokens();

  it("defines the full token set", () => {
    for (const name of [
      "--c-bg",
      "--c-surface",
      "--c-text",
      "--c-muted",
      "--c-go",
      "--c-go-dim",
      "--c-warn",
      "--c-danger",
      "--c-on",
    ]) {
      expect(t[name], `missing ${name}`).toBeTruthy();
    }
  });

  it("meets 4.5:1 for every foreground/background pairing the UI uses", () => {
    const pairs = [
      ["text on background", t["--c-text"], t["--c-bg"]],
      ["text on surface", t["--c-text"], t["--c-surface"]],
      ["muted on surface", t["--c-muted"], t["--c-surface"]],
      ["label on routine button", t["--c-on"], t["--c-go"]],
      ["label on pressed button", t["--c-on"], t["--c-go-dim"]],
      ["label on cancel", t["--c-on"], t["--c-danger"]],
      ["warn on surface", t["--c-warn"], t["--c-surface"]],
      ["confirmed on background", t["--c-go"], t["--c-bg"]],
    ];
    for (const [label, fg, bg] of pairs) {
      expect(
        contrast(fg, bg),
        `${label}: ${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
