/**
 * `GET /api/state` — B6. The coherent snapshot the UI paints from, and the 2 s
 * polling fallback if SSE misbehaves (O3).
 *
 * `panel.remaining_s` is the board's own figure relayed verbatim — the server
 * computes no countdown (memo §5.3). The `door` is display/audit only.
 */

import { jsonResponse } from "../../../lib/server/http.js";
import { isExpired } from "../../../lib/server/reconcile.js";
import { getRoutines } from "../../../lib/server/routines.js";
import {
  getDesired,
  getGen,
  getLiveness,
  getObserved,
  nowEpochS,
} from "../../../lib/server/state.js";

const LAN_DOOR = Object.freeze({ kind: "lan", email: null });

/** Build the StateSnapshot for the response. */
function buildStateSnapshot({ door = LAN_DOOR, nowS = nowEpochS() } = {}) {
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

/** @type {import('@sveltejs/kit').RequestHandler} */
export function GET({ locals }) {
  return jsonResponse(buildStateSnapshot({ door: locals?.door ?? LAN_DOOR }));
}
