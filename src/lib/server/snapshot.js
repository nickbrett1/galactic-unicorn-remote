/**
 * The `StateSnapshot` builder — B6/D3. Shared by `GET /api/state` (the 2 s
 * polling fallback, O3) and every `state` frame on `GET /api/events` (the SSE
 * stream), so the two are byte-for-byte the same object and a client cannot tell
 * which one painted it (`spec/event-flow.md` §3).
 *
 * `panel.remaining_s` is the board's own figure relayed **verbatim** — the server
 * computes no countdown (memo §5.3, invariant 1 of `plan §11`). The `door` is
 * display/audit only (memo §8.3).
 */

import { isExpired, isMessageLive } from "./reconcile.js";
import { getRoutines } from "./routines.js";
import {
  getDesired,
  getGen,
  getLiveness,
  getMessage,
  getObserved,
  nowEpochS,
} from "./state.js";

/** The fallback door when no `hooks.server.js` classification is attached. */
export const LAN_DOOR = Object.freeze({ kind: "lan", email: null });

/**
 * The observed fields the board MAY or may not report — every one is relayed
 * **verbatim** and omitted when absent. The server never parses or re-derives
 * any of them: `wedge` and `reset_cause` are the board's own diagnosis of
 * itself, `condition`/`temp_c` are the sky it read, `message_id` is the banner
 * it admits to drawing, and `remaining_s` is its own countdown
 * (`device-protocols.md` §3; memo §5.3).
 */
const OPTIONAL_OBSERVED = Object.freeze([
  "routine",
  "remaining_s",
  "rssi",
  "uptime_s",
  "wedge",
  "reset_cause",
  "condition",
  "temp_c",
  "message_id",
]);

/** @param {object} observed @returns {object} the present optional fields, nothing else */
function relayOptional(observed) {
  const out = {};
  for (const key of OPTIONAL_OBSERVED) {
    if (observed[key] !== undefined) out[key] = observed[key];
  }
  return out;
}

/**
 * Build the current `StateSnapshot` (OpenAPI `StateSnapshot`).
 *
 * @param {{door?: {kind: string, email: string|null}, nowS?: number}} [options]
 */
export function buildStateSnapshot({
  door = LAN_DOOR,
  nowS = nowEpochS(),
} = {}) {
  const observed = getObserved();
  const liveness = getLiveness(nowS);

  const observedFields = observed
    ? {
        boot: observed.boot,
        fw: observed.fw,
        applied_gen: observed.applied_gen,
        state: observed.state,
        ...relayOptional(observed),
      }
    : { boot: null, fw: null, applied_gen: 0, state: "ambient" };

  const desired = getDesired();
  const desiredView =
    desired && !isExpired(desired, nowS)
      ? { ...desired }
      : { gen: getGen(), action: "none", expires_at: 0 };

  // The live idle banner, or null. Expiry is a server-side construct, so an
  // expired slot reads as "no message" here, exactly as an expired desired slot
  // reads as `action: none` above (`device-protocols.md` §3).
  const message = getMessage();
  const messageView = isMessageLive(message, nowS) ? { ...message } : null;

  return {
    panel: { ...observedFields, ...liveness },
    desired: desiredView,
    message: messageView,
    routines: getRoutines(),
    door: { kind: door.kind, email: door.email ?? null },
  };
}
