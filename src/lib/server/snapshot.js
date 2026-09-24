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

import { isExpired } from "./reconcile.js";
import { getRoutines } from "./routines.js";
import {
  getDesired,
  getGen,
  getLiveness,
  getObserved,
  nowEpochS,
} from "./state.js";

/** The fallback door when no `hooks.server.js` classification is attached. */
export const LAN_DOOR = Object.freeze({ kind: "lan", email: null });

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
        ...(observed.routine !== undefined
          ? { routine: observed.routine }
          : {}),
        ...(observed.remaining_s !== undefined
          ? { remaining_s: observed.remaining_s }
          : {}),
        ...(observed.rssi !== undefined ? { rssi: observed.rssi } : {}),
        ...(observed.uptime_s !== undefined
          ? { uptime_s: observed.uptime_s }
          : {}),
      }
    : { boot: null, fw: null, applied_gen: 0, state: "ambient" };

  const desired = getDesired();
  const desiredView =
    desired && !isExpired(desired, nowS)
      ? { ...desired }
      : { gen: getGen(), action: "none", expires_at: 0 };

  return {
    panel: { ...observedFields, ...liveness },
    desired: desiredView,
    routines: getRoutines(),
    door: { kind: door.kind, email: door.email ?? null },
  };
}
