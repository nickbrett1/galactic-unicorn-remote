/**
 * The command-status reducer — D2, the one hard UX rule (`design-system.md` §5,
 * `flows/device-desired-state-state-machine.md` §2–§3).
 *
 * Pure and DOM-free so the rule is provable under vitest: a press goes
 * `pressing → sending → confirmed`, and **the only edge into `confirmed` is the
 * board reporting a new `applied_gen`** — never a `202`, never a receipt
 * (memo §9.1). A command that misses its TTL reads as `expired`, plainly, and
 * the wording never diagnoses heap-vs-link (`event-flow.md` §4, R15).
 */

import { formatLastSeen } from "./format.js";

/** @typedef {{kind: 'idle'}} Idle */
/** @typedef {{kind: 'pressing', action: string, routine: string|null}} Pressing */
/** @typedef {{kind: 'sending', gen: number, action: string, routine: string|null, expiresAt: number}} Sending */
/** @typedef {{kind: 'confirmed', action: string, routine: string|null}} Confirmed */
/** @typedef {{kind: 'expired', action: string, routine: string|null, lastSeenS: number|null}} Expired */
/** @typedef {{kind: 'conflict', currentRoutine: string|null, requested: string|null}} Conflict */
/** @typedef {{kind: 'noop', action: string, reason: string}} Noop */
/** @typedef {{kind: 'offline', lastSeenS: number|null}} Offline */
/** @typedef {{kind: 'error'}} ErrorState */
/** @typedef {Idle|Pressing|Sending|Confirmed|Expired|Conflict|Noop|Offline|ErrorState} CommandStatus */

/** @returns {Idle} */
export function initialStatus() {
  return { kind: "idle" };
}

/** Is the UI mid-command (so the four controls should not accept a second one)? */
export function isBusy(status) {
  return status.kind === "pressing" || status.kind === "sending";
}

/**
 * Apply one event to the command status. Pure: same inputs → same output.
 *
 * @param {CommandStatus} status
 * @param {object} event
 * @returns {CommandStatus}
 */
export function reduceStatus(status, event) {
  switch (event.type) {
    case "press":
      return {
        kind: "pressing",
        action: event.action,
        routine: event.routine ?? null,
      };
    case "response":
      return onResponse(event);
    case "snapshot":
      return onSnapshot(status, event.snapshot, event.nowMs);
    case "reset":
      return initialStatus();
    default:
      return status;
  }
}

/** @param {{httpStatus: number, body: any, action: string, routine: string|null}} event */
function onResponse({ httpStatus, body, action, routine }) {
  if (httpStatus === 202 && body && typeof body.gen === "number") {
    return {
      kind: "sending",
      gen: body.gen,
      action,
      routine: routine ?? body.routine ?? null,
      expiresAt: body.expires_at ?? 0,
    };
  }
  if (httpStatus === 409) {
    return {
      kind: "conflict",
      currentRoutine: body?.current_routine ?? null,
      requested: routine ?? null,
    };
  }
  if (httpStatus === 503) {
    return { kind: "offline", lastSeenS: body?.last_seen_s ?? null };
  }
  if (httpStatus === 200) {
    return { kind: "noop", action, reason: body?.reason ?? "noop" };
  }
  return { kind: "error" };
}

/**
 * Fold a `StateSnapshot` into the status. This is the ONLY place `sending` can
 * become `confirmed`, and it requires `applied_gen >= gen` (memo §9.1).
 *
 * @param {CommandStatus} status
 * @param {any} snapshot
 * @param {number} nowMs
 * @returns {CommandStatus}
 */
function onSnapshot(status, snapshot, nowMs) {
  const panel = snapshot?.panel ?? {};

  if (status.kind === "sending") {
    if (
      typeof panel.applied_gen === "number" &&
      panel.applied_gen >= status.gen
    ) {
      return {
        kind: "confirmed",
        action: status.action,
        routine: status.routine,
      };
    }
    const nowS = Math.floor(nowMs / 1000);
    if (status.expiresAt && nowS >= status.expiresAt) {
      return {
        kind: "expired",
        action: status.action,
        routine: status.routine,
        lastSeenS: panel.last_seen_s ?? null,
      };
    }
    return status;
  }

  // A conflict affordance is only meaningful while something is actually
  // running; once the panel is back to ambient there is nothing to replace.
  if (status.kind === "conflict" && panel.state === "ambient") {
    return initialStatus();
  }

  return status;
}

/**
 * The plain-language state word shown beside a control, so colour is never the
 * only signal (`design-system.md` §6). `null` means "no word" (idle / transient
 * press).
 *
 * @param {CommandStatus} status
 * @returns {string | null}
 */
export function statusText(status) {
  switch (status.kind) {
    case "sending":
      return "sending…";
    case "confirmed":
      return "confirmed";
    case "expired":
      return `the panel didn't answer (last seen ${formatLastSeen(status.lastSeenS)})`;
    case "offline":
      return `panel offline (last seen ${formatLastSeen(status.lastSeenS)})`;
    case "noop":
      return status.reason === "nothing_to_cancel"
        ? "nothing to cancel"
        : "already running";
    case "error":
      return "couldn't send — try again";
    default:
      return null;
  }
}

/** The visual tone for a control/status, mapped to a design token by the view. */
export function statusTone(status) {
  switch (status.kind) {
    case "sending":
    case "expired":
    case "conflict":
    case "noop":
      return "warn";
    case "confirmed":
      return "go";
    case "offline":
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}
