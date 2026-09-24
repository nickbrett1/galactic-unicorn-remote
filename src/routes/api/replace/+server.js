/**
 * `POST /api/replace` — B5. The only way to switch routines. Begins the
 * cancel → wait-for-`ambient` → start sequence; the poll handler advances it.
 * Never a silent switch (memo §5.5, `flows/replace-conflict-sequence.md`).
 */

import { runReplace } from "../../../lib/server/commands.js";

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request, locals }) {
  return runReplace(request, locals?.door);
}
