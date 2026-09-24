/**
 * Pure display formatters for the remote UI — D1/D2.
 *
 * Kept free of Svelte and of the DOM so the mirror's wording is host-testable
 * (`spec/ui/design-system.md` §5). Nothing here computes a countdown as truth:
 * `remaining_s` arrives relayed from the board and is only *interpolated* between
 * polls (memo §5.3, invariant 1 of `plan §11`).
 */

/**
 * "panel: last seen …". Seconds under a minute; whole minutes above it, matching
 * the design's "last seen 3m ago" wording (`design-system.md` §4–§5).
 *
 * @param {number | null | undefined} lastSeenS
 * @returns {string}
 */
export function formatLastSeen(lastSeenS) {
  if (lastSeenS === null || lastSeenS === undefined) return "never seen";
  const seconds = Math.max(0, Math.floor(lastSeenS));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

/**
 * `m:ss` for the mirror, or `null` when the board has not reported a figure.
 * Interpolation happens in the component; this only formats a value in seconds.
 *
 * @param {number | null | undefined} seconds
 * @returns {string | null}
 */
export function formatCountdown(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * The routine label for an id, from the catalogue — never a literal in a
 * component (`design-system.md` §2).
 *
 * @param {ReadonlyArray<{id: string, label: string}>} routines
 * @param {string | null | undefined} id
 * @returns {string | null}
 */
export function labelForRoutine(routines, id) {
  if (!id) return null;
  return routines.find((routine) => routine.id === id)?.label ?? null;
}

/**
 * The mirror's headline: the routine name, HANDOFF briefly shouting it, or
 * "Ambient". Returns the raw text plus whether it should be rendered as a shout
 * so the component can apply `prefers-reduced-motion` styling.
 *
 * @param {{state?: string, routine?: string | null}} panel
 * @param {ReadonlyArray<{id: string, label: string}>} routines
 * @returns {{text: string, shout: boolean}}
 */
export function mirrorHeadline(panel, routines) {
  const label = labelForRoutine(routines, panel?.routine);
  switch (panel?.state) {
    case "prompt":
    case "countdown":
      return { text: label ?? "Panel starting", shout: false };
    case "handoff":
      return {
        text: label ? `${label.toUpperCase()}!` : "HANDOFF!",
        shout: true,
      };
    default:
      return { text: "Ambient", shout: false };
  }
}

/**
 * A one-word state word so colour is never the only signal (WCAG 2.1 AA,
 * `design-system.md` §6).
 *
 * @param {string | undefined} state
 * @returns {string}
 */
export function stateWord(state) {
  switch (state) {
    case "prompt":
      return "Starting";
    case "countdown":
      return "Counting down";
    case "handoff":
      return "Done";
    default:
      return "Idle";
  }
}
