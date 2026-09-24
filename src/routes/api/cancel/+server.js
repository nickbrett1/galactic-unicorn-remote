/**
 * `POST /api/cancel` — B5. Cancel is the D button: live in PROMPT, COUNTDOWN and
 * HANDOFF; a no-op from AMBIENT; silent everywhere (memo §3, §11.13). The phone,
 * not the living room, carries the acknowledgement.
 */

import { runCancel } from "../../../lib/server/commands.js";

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request, locals }) {
  return runCancel(request, locals?.door);
}
