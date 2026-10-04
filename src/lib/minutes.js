/**
 * The countdown lengths a remote start may ask for — T6.
 *
 * A remote-started countdown may be **1, 3 or 5 minutes**; the default is **5**.
 * The choice rides *alongside* the `start` event on the desired slot (the way
 * `routine` already does): it adds no fifth device event, moves no `gen`, and is
 * never persisted anywhere (`device-protocols.md` §3).
 *
 * This module is the one place the two ends of the remote meet — the server's
 * validation and the UI's selector both read it, so the offered buttons and the
 * accepted values cannot drift. The *board* mirrors the same rule in
 * `lib/reconcile.py` (`MINUTES_CHOICES` / `DEFAULT_MINUTES`); a physical press
 * sends no `minutes` at all and so keeps the routine's own `routines.json`
 * value, byte-identical to a button press.
 */

/** The permitted countdown lengths, in whole minutes. */
export const MINUTES_CHOICES = Object.freeze([1, 3, 5]);

/** The length a remote start uses when the UI offers no choice. */
export const DEFAULT_MINUTES = 5;

/**
 * Is `value` a permitted countdown length? Only the exact integers 1, 3 and 5 —
 * a float or a string is not, and the caller must never coerce one in. (JSON
 * numbers arrive already parsed; `1.0` and `1` are indistinguishable in JS, and
 * the board treats a non-integer as absent, so both ends land on the default.)
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidMinutes(value) {
  return MINUTES_CHOICES.includes(value);
}
