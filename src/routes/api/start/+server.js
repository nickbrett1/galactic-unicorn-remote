/**
 * `POST /api/start` — B5. Asks the panel to start a routine.
 *
 * Resolves the conflict table before setting anything: offline refuses (503),
 * already-running is a no-op (200), a different routine counting down is a
 * conflict (409 with an explicit replace offer). A 202 means **accepted, not
 * done** (memo §9.1).
 */

import { runStart } from "../../../lib/server/commands.js";

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request, locals }) {
  return runStart(request, locals?.door);
}
