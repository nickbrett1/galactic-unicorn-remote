/**
 * `GET /api/state` — B6. The coherent snapshot the UI paints from, and the 2 s
 * polling fallback if SSE misbehaves (O3).
 *
 * `panel.remaining_s` is the board's own figure relayed verbatim — the server
 * computes no countdown (memo §5.3). The `door` is display/audit only.
 */

import { jsonResponse } from "../../../lib/server/http.js";
import { buildStateSnapshot, LAN_DOOR } from "../../../lib/server/snapshot.js";

/** @type {import('@sveltejs/kit').RequestHandler} */
export function GET({ locals }) {
  return jsonResponse(buildStateSnapshot({ door: locals?.door ?? LAN_DOOR }));
}
