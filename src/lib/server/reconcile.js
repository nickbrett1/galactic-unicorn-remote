/**
 * The pure reconciliation core — B1.
 *
 * Everything the service decides about `gen`, TTL, the conflict policy and the
 * poll cadence lives here as pure functions: **no sockets, no timers, no
 * stores, and no countdown computation** (invariant 1 of `plan §11`; the server
 * relays the board's own countdown figure and does no timing — memo §5.3).
 *
 * Sources: `spec/api/device-protocols.md` §3–§6; `spec/data-architecture/domain-models.ts`.
 *
 * Open decisions embodied here (pending ratification; ADRs are a later step):
 *  - **O5** — the server-side `next_poll_ms` clamp bounds. Defaults are the
 *    plan's recommended values; they are pure defaults so this module stays
 *    free of `config.js`/env reads.
 *  - **O6** — the exact TTL constant lives in `config.js` (`DESIRED_TTL_S`);
 *    this module only compares against a slot's own `expires_at`.
 */

import { ROUTINE_IDS } from "./routines.js";

/** The four device events the remote can produce — three routines plus `reset` (D). */
export const DEVICE_EVENTS = Object.freeze([...ROUTINE_IDS, "reset"]);

/** The panel's own states, as REPORTED BY THE BOARD. The server never invents them. */
export const PANEL_STATES = Object.freeze([
  "ambient",
  "prompt",
  "countdown",
  "handoff",
]);

/** The actions a desired slot may carry. `none` is a valid, idempotent no-op. */
export const DESIRED_ACTIONS = Object.freeze(["start", "cancel", "none"]);

/** States in which the panel is doing something (D — and so a remote cancel — is live in all three). */
export const ACTIVE_STATES = Object.freeze(["prompt", "countdown", "handoff"]);

// O5 (pending ratification): server-side clamp bounds for `next_poll_ms`.
export const NEXT_POLL_MIN_MS_DEFAULT = 1000;
export const NEXT_POLL_MAX_MS_DEFAULT = 10000;
/** ~2000 ms on demand: something is pending, a countdown is active, or a viewer is connected. */
export const NEXT_POLL_FAST_MS = 2000;
/** ~5000 ms idle: a ceiling on how stale an empty house may be, not a knob (memo §11.2). */
export const NEXT_POLL_IDLE_MS = 5000;

/**
 * `applied_gen <= gen` is ignored by the board (`device-protocols.md` §3), so the
 * command has landed once the board reports `applied_gen >= gen`.
 *
 * @param {number} appliedGen
 * @param {number} gen
 * @returns {boolean}
 */
export function isGenApplied(appliedGen, gen) {
  return appliedGen >= gen;
}

/**
 * A fresh server re-seeds its `gen` from the board's reported `applied_gen` plus
 * one, so it can never sit below the board's high-water mark (memo §5.1). This is
 * risk R6: getting it wrong wedges the system silently.
 *
 * @param {number} reportedAppliedGen
 * @returns {number}
 */
export function reseedGen(reportedAppliedGen) {
  return reportedAppliedGen + 1;
}

/**
 * Pending desired state is dropped — never queued, never fired late — once its
 * TTL has elapsed (`device-protocols.md` §4.1; memo §5.4). Expiry is a
 * server-side construct; the board never compares `expires_at`.
 *
 * @param {{expires_at: number} | null | undefined} desired
 * @param {number} nowEpochS
 * @returns {boolean}
 */
export function isExpired(desired, nowEpochS) {
  if (!desired) return true;
  return nowEpochS >= desired.expires_at;
}

/**
 * The conflict table of `device-protocols.md` §5, verbatim, as a decision function.
 *
 * @param {{
 *   requested: 'start' | 'cancel' | 'replace',
 *   routine?: string,
 *   panel: {state?: string, routine?: string, online?: boolean, last_seen_s?: number | null},
 * }} input
 * @returns {
 *   | {kind: 'set', action: 'start' | 'cancel', routine?: string}
 *   | {kind: 'noop', reason: 'already_running' | 'nothing_to_cancel'}
 *   | {kind: 'conflict', current_routine: string}
 *   | {kind: 'refuse_offline', last_seen_s: number | null}
 * }
 */
export function resolveCommand({ requested, routine, panel }) {
  const safePanel = panel ?? {};

  // Unreachable + start X → refuse BEFORE setting anything (memo §5.5). The same
  // holds for cancel and replace: nothing is ever set into a dead window.
  if (safePanel.online === false) {
    return {
      kind: "refuse_offline",
      last_seen_s: safePanel.last_seen_s ?? null,
    };
  }

  const state = safePanel.state;
  const active = ACTIVE_STATES.includes(state);
  const activeRoutine = safePanel.routine;

  if (requested === "start") {
    if (state === "ambient") return { kind: "set", action: "start", routine };
    if (active && activeRoutine === routine) {
      return { kind: "noop", reason: "already_running" };
    }
    if (active && activeRoutine && activeRoutine !== routine) {
      return { kind: "conflict", current_routine: activeRoutine };
    }
    // Active but the board reported no routine: let the panel decide (it treats a
    // routine event as inert mid-countdown). Setting is honest; nothing is lost.
    return { kind: "set", action: "start", routine };
  }

  if (requested === "cancel") {
    // Cancel is the D button: live in PROMPT, COUNTDOWN and HANDOFF; a no-op in AMBIENT.
    if (state === "ambient") {
      return { kind: "noop", reason: "nothing_to_cancel" };
    }
    return { kind: "set", action: "cancel" };
  }

  if (requested === "replace") {
    // Replace is the only way to switch routines. It needs a *different* routine
    // actually running; otherwise there is nothing to replace.
    if (!active) return { kind: "noop", reason: "nothing_to_cancel" };
    if (activeRoutine === routine) {
      return { kind: "noop", reason: "already_running" };
    }
    return { kind: "set", action: "cancel" };
  }

  throw new Error(`resolveCommand: unknown requested action "${requested}"`);
}

/**
 * Server-directed, demand-driven cadence (`device-protocols.md` §6): ~2000 ms if
 * any demand input is true, ~5000 ms otherwise, then clamped (O5).
 *
 * @param {{
 *   pendingApply?: boolean,
 *   activeCountdown?: boolean,
 *   subscribers?: number,
 *   minMs?: number,
 *   maxMs?: number,
 * }} [input]
 * @returns {number}
 */
export function nextPollMs(input = {}) {
  const {
    pendingApply = false,
    activeCountdown = false,
    subscribers = 0,
    minMs = NEXT_POLL_MIN_MS_DEFAULT,
    maxMs = NEXT_POLL_MAX_MS_DEFAULT,
  } = input;

  const demand =
    Boolean(pendingApply) || Boolean(activeCountdown) || subscribers > 0;
  const raw = demand ? NEXT_POLL_FAST_MS : NEXT_POLL_IDLE_MS;

  return Math.min(Math.max(raw, minMs), maxMs);
}

/**
 * Map a desired slot to the device event it produces. A `cancel` is the `reset`
 * (D) event — there is no fifth event (invariant 3 of `plan §11`).
 *
 * @param {{action: string, routine?: string}} desired
 * @returns {string | null}
 */
export function eventForDesired(desired) {
  if (!desired || desired.action === "none") return null;
  if (desired.action === "cancel") return "reset";
  return desired.routine ?? null;
}
