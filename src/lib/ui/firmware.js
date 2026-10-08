/**
 * Which countdown lengths a *given panel* can honour — T6.1 stopgap.
 *
 * The remote may offer a length (`$lib/minutes.js`) that the panel's firmware is
 * too old to understand. A pre-`0.1.51` board rejects `10` and silently falls
 * back to the routine's own `routines.json` minutes (the routine default, 5), so
 * offering the button made "select 10" start a 5-minute timer.
 *
 * Until every panel is on `0.1.51` (see NOTES T6.1 in the board repo), the remote
 * greys out any length the panel it is talking to cannot honour, so the UI never
 * offers a choice that would be quietly downgraded. The catalogue in
 * `$lib/minutes.js` stays the source of truth for what the *service* accepts;
 * this module only narrows it to what the *reported firmware* supports.
 *
 * Pure and DOM-free so it is unit-testable (`tests/ui-logic.test.js`).
 */

import { MINUTES_CHOICES } from "../minutes.js";

/** The board firmware that first accepted a 10-minute countdown (board `0.1.51`). */
export const TEN_MINUTES_SINCE = "0.1.51";

/**
 * Parse a `major.minor.patch` firmware string into numbers. Any non-numeric or
 * missing segment reads as 0, so `"0.1.51"` > `"0.1.50"` and an unknown/absent
 * `fw` (`"dev"`, `null`) sorts below every real release.
 *
 * @param {string | null | undefined} version
 * @returns {number[]}
 */
function parse(version) {
  if (typeof version !== "string") return [0, 0, 0];
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Compare two firmware versions: negative when `a < b`, 0 when equal, positive
 * when `a > b`.
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {number}
 */
export function compareFirmware(a, b) {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * The countdown lengths a panel reporting `fw` can actually honour. A panel at
 * `TEN_MINUTES_SINCE` or newer supports the full `MINUTES_CHOICES`; an older (or
 * unknown) one supports all but `10`, matching its `lib/reconcile.py`.
 *
 * @param {string | null | undefined} fw the panel's reported firmware version
 * @returns {number[]}
 */
export function availableMinutes(fw) {
  if (compareFirmware(fw, TEN_MINUTES_SINCE) >= 0) return [...MINUTES_CHOICES];
  return MINUTES_CHOICES.filter((minutes) => minutes < 10);
}
