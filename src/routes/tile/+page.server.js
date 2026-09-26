/**
 * The tile's server load.
 *
 * Same first paint as the remote (`StateSnapshot` + the routine catalogue) so
 * the tile can render before its first poll. The door is deliberately not
 * passed on: the tile is **display only** and shows no identity
 * (`spec/ui/design-system.md` §9).
 */

import { buildStateSnapshot, LAN_DOOR } from "../../lib/server/snapshot.js";

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
  const door = locals?.door ?? LAN_DOOR;
  return {
    snapshot: buildStateSnapshot({ door }),
  };
}
