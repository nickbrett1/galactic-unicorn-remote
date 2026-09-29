/**
 * The remote's server load — D1. Supplies the first paint (`StateSnapshot` plus
 * the routine catalogue) and the door for **display only** (`design-system.md`
 * §3; memo §8.3). The door email is shown as "signed in as …" when present and
 * never authorises anything.
 */

import { config } from "../lib/server/config.js";
import { buildStateSnapshot, LAN_DOOR } from "../lib/server/snapshot.js";

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
  const door = locals?.door ?? LAN_DOOR;
  return {
    snapshot: buildStateSnapshot({ door }),
    door: { kind: door.kind, email: door.email ?? null },
    // The banner's length bound, so the composer's `maxlength` matches the
    // server's rule without the browser importing a server module.
    messageMaxLen: config.messageMaxLen,
  };
}
