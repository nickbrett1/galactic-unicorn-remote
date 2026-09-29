/**
 * `POST /api/message` — scroll a short message across the panel's idle screen.
 *
 * **Idle-only.** The message is refused unless the panel is reachable AND
 * reporting `ambient` (503 offline, 409 `panel_busy` while counting down). A
 * 202 means **accepted, not done**: the board confirms by reporting the `id` it
 * is drawing, and the UI goes "sending…" → "showing" only on that
 * (`design-system.md` §5, `device-protocols.md` §3).
 */

import { runMessage } from "../../../lib/server/commands.js";

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request, locals }) {
  return runMessage(request, locals?.door);
}
