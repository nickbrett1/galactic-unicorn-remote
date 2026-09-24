/**
 * `GET /api/events` — D3. Server-Sent Events, and the 2 s `/api/state` polling
 * fallback on the client (O3, `spec/event-flow.md` §3).
 *
 * The route returns a `ReadableStream` that `@sveltejs/adapter-node` must **not**
 * buffer, so the no-buffering headers are mandatory and verbatim
 * (`implementation-considerations §8`, R18). A stale mirror is the failure mode:
 * the whole point of the UI is perceived liveness (memo §11.7).
 *
 *  - **Heartbeat** `:hb` every ~15 s, because proxied connections (Cloudflare)
 *    idle out around 100 s.
 *  - **Frame types (a closed set):** `state` (a `StateSnapshot`) and `audit` (a
 *    row). Unknown names are ignored by clients, never errored.
 *  - **Subscriber count is LIVE** — incremented on connect, decremented on
 *    disconnect, and it feeds `next_poll_ms` (`device-protocols.md` §6). It must
 *    never mean "a page was loaded" (memo §11.7).
 *  - A `state` frame is emitted **on connect** so a late joiner paints at once.
 */

import {
  addSubscriber,
  HEARTBEAT_MS,
  sseFrame,
} from "../../../lib/server/events.js";
import { buildStateSnapshot, LAN_DOOR } from "../../../lib/server/snapshot.js";
import {
  decrementSubscribers,
  incrementSubscribers,
} from "../../../lib/server/state.js";

/** @type {import('@sveltejs/kit').RequestHandler} */
export function GET({ locals }) {
  const door = locals?.door ?? LAN_DOOR;
  const encoder = new TextEncoder();
  /** @type {() => void} */
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      incrementSubscribers();

      const send = (message) => {
        // A closed controller throws; treat it as a disconnect so a dead
        // subscriber can never break the write path that fanned out to it.
        try {
          if (message.event === "state") {
            const state = buildStateSnapshot({ door });
            controller.enqueue(
              encoder.encode(sseFrame("state", { type: "state", state })),
            );
          } else {
            controller.enqueue(
              encoder.encode(
                sseFrame("audit", { type: "audit", ...message.row }),
              ),
            );
          }
        } catch {
          cleanup();
        }
      };

      const removeSubscriber = addSubscriber(send);
      // Paint on connect, so a late joiner is never blank.
      send({ event: "state" });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":hb\n\n"));
        } catch {
          cleanup();
          return;
        }
        // Keep the relayed liveness fresh between polls without inventing a
        // countdown: this re-sends the board's own figures.
        send({ event: "state" });
      }, HEARTBEAT_MS);

      let cleaned = false;
      cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        removeSubscriber();
        decrementSubscribers();
      };
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
