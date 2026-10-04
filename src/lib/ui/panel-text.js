/**
 * The panel's alphabet — the idle banner is drawn on the panel's LED matrix,
 * whose font has no glyph for anything outside printable ASCII, space (0x20)
 * through tilde (0x7e) (`reconcile.js`'s `PRINTABLE_ASCII`; `design-system.md`
 * §10.2). "The UI does not accept what the panel cannot draw," so the composer
 * runs everything through here before it ever reaches the server.
 *
 * A phone keyboard substitutes typographic characters for the ASCII a person
 * typed — a straight `'` becomes a curly `’`, `--` becomes an em dash — and the
 * server rejects any of those with a 422. Rather than drop the character (which
 * would turn "It’s" into "Its"), the common substitutions are folded back to
 * their ASCII spelling first; only genuinely undrawable characters (emoji, other
 * scripts) are then removed.
 */

/** Typographic characters a keyboard or autocorrect substitutes for plain ASCII. */
const SUBSTITUTIONS = Object.freeze([
  ["\u2018", "'"], // ‘
  ["\u2019", "'"], // ’
  ["\u201C", '"'], // “
  ["\u201D", '"'], // ”
  ["\u2013", "-"], // –
  ["\u2014", "-"], // —
  ["\u2026", "..."], // …
  ["\u00A0", " "], // non-breaking space
]);

/**
 * Fold a message to the printable-ASCII the panel can draw. Undrawable
 * characters are dropped; the caller never has to name them.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function toPanelText(raw) {
  if (typeof raw !== "string") return "";
  let text = raw;
  for (const [from, to] of SUBSTITUTIONS) text = text.replaceAll(from, to);
  return text.replace(/[^\x20-\x7e]/g, "");
}

/**
 * Does `text` draw as written? Used only to tell the sender *why* a paste was
 * trimmed; anything that survives `toPanelText` is drawable by construction.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function isPanelText(text) {
  return typeof text === "string" && /^[\x20-\x7e]*$/.test(text);
}
