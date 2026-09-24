/**
 * The remote's server load — D1. Supplies the first paint (`StateSnapshot` plus
 * the routine catalogue) and the door for **display only** (`design-system.md`
 * §3; memo §8.3). The door email is shown as "signed in as …" when present and
 * never authorises anything.
 */

import { buildStateSnapshot, LAN_DOOR } from "../lib/server/snapshot.js";

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
  const door = locals?.door ?? LAN_DOOR;
  return {
    snapshot: buildStateSnapshot({ door }),
    door: { kind: door.kind, email: door.email ?? null },
  };
}
