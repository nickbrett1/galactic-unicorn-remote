/**
 * The SSE subscriber registry — D3 (`spec/event-flow.md` §3).
 *
 * Kept deliberately tiny and dependency-free so `state.js` (and `audit.js`) can
 * broadcast to it without an import cycle: this module imports nothing, and each
 * subscriber is a `send(message)` callback *created by the events route*, which
 * is the only place that knows how to build a `StateSnapshot` for its own door.
 *
 * Two responsibilities, and only two:
 *  - a LIVE registry of connected subscribers (one entry per open `/api/events`
 *    response) — the route owns increment/decrement of the state store's count;
 *  - fan-out of `state` and `audit` frames to those subscribers.
 *
 * A dead subscriber must never break a write path, so every fan-out call is
 * guarded: a throw removes that subscriber and moves on (`implementation-
 * considerations §8` — the stream is a convenience, never a source of truth).
 */

/** @typedef {(message: {event: 'state'} | {event: 'audit', row: object}) => void} Subscriber */

/** The heartbeat cadence: comfortably inside the ~100 s Cloudflare idle window. */
export const HEARTBEAT_MS = 15_000;

/**
 * Serialise one SSE frame. The `audit` payload carries a discriminating `type`,
 * mirroring the shapes in `spec/event-flow.md` §3.1.
 *
 * @param {'state' | 'audit'} event
 * @param {{type: string}} data
 */
export function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** @type {Set<Subscriber>} */
const subscribers = new Set();

/**
 * Register a subscriber and return its unsubscribe hook.
 *
 * @param {Subscriber} send
 * @returns {() => void}
 */
export function addSubscriber(send) {
  subscribers.add(send);
  return () => subscribers.delete(send);
}

/** The number of subscribers currently connected (a LIVE count). */
export function subscriberCount() {
  return subscribers.size;
}

/** Test/dev hook: drop every subscriber. */
export function clearSubscribers() {
  subscribers.clear();
}

/** @param {{event: 'state'} | {event: 'audit', row: object}} message */
function emit(message) {
  for (const send of [...subscribers]) {
    try {
      send(message);
    } catch {
      subscribers.delete(send);
    }
  }
}

/** Fan out a `state` frame (a `StateSnapshot`, per-subscriber door). */
export function broadcastState() {
  emit({ event: "state" });
}

/**
 * Fan out an `audit` frame (one audit row). Called from the audit writer so
 * every decided outcome reaches the UI, whatever path produced it.
 *
 * @param {object} row
 */
export function broadcastAudit(row) {
  emit({ event: "audit", row });
}
