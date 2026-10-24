/**
 * Which countdown lengths a *given panel* can honour — T6.1 stopgap.
 *
 * The remote may offer a length (`$lib/minutes.js`) that the panel's firmware is
 * too old to understand. A pre-`0.1.51` board rejects `10` and silently falls
 * back to the routine's own `routines.json` minutes (the routine default, 5), so
 * offering the button made "select 10" start a 5-minute timer; a pre-`0.1.52`
 * board does the same for `2`.
 *
 * Until every panel is on the firmware that honours a length (see NOTES T6.1 /
 * T6.2 in the board repo), the remote greys out any length the panel it is
 * talking to cannot honour, so the UI never offers a choice that would be quietly
 * downgraded. The catalogue in `$lib/minutes.js` stays the source of truth for
 * what the *service* accepts; this module only narrows it to what the *reported
 * firmware* supports.
 *
 * Pure and DOM-free so it is unit-testable (`tests/ui-logic.test.js`).
 */

import { MINUTES_CHOICES } from "../minutes.js";

/** The board firmware that first accepted a 10-minute countdown (board `0.1.51`). */
export const TEN_MINUTES_SINCE = "0.1.51";

/** The board firmware that first accepted a 2-minute countdown (board `0.1.52`). */
export const TWO_MINUTES_SINCE = "0.1.52";

/**
 * The earliest firmware that honours each length the remote offers, for the
 * lengths that were added after T6. A length with no entry here (1, 3, 5) is as
 * old as the feature itself and every panel that can run it at all honours it.
 */
const MINUTES_SINCE = Object.freeze({
  2: TWO_MINUTES_SINCE,
  10: TEN_MINUTES_SINCE,
});

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
 * The countdown lengths a panel reporting `fw` can actually honour, so the UI
 * offers exactly the set the connected board's `lib/reconcile.py` accepts. A
 * panel too old to know a length would silently downgrade it to the routine's
 * own minutes, so the button is withheld rather than offered as a lie.
 *
 * @param {string | null | undefined} fw the panel's reported firmware version
 * @returns {number[]}
 */
export function availableMinutes(fw) {
  return MINUTES_CHOICES.filter((minutes) => {
    const since = MINUTES_SINCE[minutes];
    return since === undefined || compareFirmware(fw, since) >= 0;
  });
}

/*
 * The same honesty rule, one step further: a routine the panel's firmware
 * cannot know. `shoes` is remote-only (the panel has A/B/C plus D for cancel),
 * and a board older than 0.1.54 has `ROUTINE_IDS` without it — its
 * `reconcile.event_for_desired` drops the start without a word while the poll
 * still reports "applied", so the button would promise a timer that never
 * starts. Withhold it rather than offer a lie, exactly as `availableMinutes`
 * does for a length.
 */

/** The board firmware that first knows the remote-only `shoes` routine (board `0.1.54`). */
export const SHOES_SINCE = "0.1.54";

/** The earliest firmware that knows each routine added after the original three. */
const ROUTINE_SINCE = Object.freeze({
  shoes: SHOES_SINCE,
});

/**
 * The routines a panel reporting `fw` can actually start, in catalogue order.
 * A routine with no entry in `ROUTINE_SINCE` is as old as the remote itself.
 *
 * @param {ReadonlyArray<{id: string}>} routines the catalogue from `snapshot.routines`
 * @param {string | null | undefined} fw the panel's reported firmware version
 * @returns {ReadonlyArray<{id: string}>}
 */
export function availableRoutines(routines, fw) {
  return routines.filter((routine) => {
    const since = ROUTINE_SINCE[routine.id];
    return since === undefined || compareFirmware(fw, since) >= 0;
  });
}
