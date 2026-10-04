/**
 * The process-local state store — B2 (O1: in-memory state + an append-only audit file).
 *
 * Holds, per `spec/data-architecture/state-layout.json`:
 *  - `gen` (monotonic; written only by durable command edges and the first-poll seed)
 *  - `desired` (the browser→board slot)
 *  - `observed` (the board→server slot)
 *  - `subscribers` (a LIVE count, written by the SSE route lifecycle)
 *  - `replaceSequence` (server-side orchestration only)
 *
 * Invariants encoded here (one writer per direction, memo §2):
 *  - only `setDesired`/`clearDesired` write the desired slot;
 *  - only `recordObserved` writes the observed slot;
 *  - the server never computes or stores a countdown — `observed` merely mirrors
 *    the board's own `remaining_s` figure (memo §5.3);
 *  - `gen` is monotonic within the process and re-seeded from the board's
 *    `applied_gen + 1` on the first poll, so it can never sit below the board's
 *    high-water mark (memo §5.1, R6).
 *
 * State is a mirror and may legally vanish on restart; the audit log is the only
 * durable artefact (O1).
 */

import { config } from "./config.js";
import { broadcastState } from "./events.js";
import { reseedGen } from "./reconcile.js";

function initialState() {
  return {
    gen: 0,
    desired: null,
    observed: null,
    subscribers: 0,
    replaceSequence: null,
    polled: false,
    /**
     * The idle banner slot — `{ id, text, expires_at }` or null. Distinct from
     * `desired` and from `gen`: a message is idle-screen *content* (relayed on
     * every poll, like the weather), not a fifth device event, so it moves no
     * counter the board reconciles against (`device-protocols.md` §3).
     */
    message: null,
    /** Monotonic banner revision. Lets the board restart the marquee on a NEW text. */
    messageSeq: 0,
  };
}

let state = initialState();

/** Test/dev hook: return the store to a pristine process-local state. */
export function resetState() {
  state = initialState();
}

/** Wall-clock seconds. Time is used ONLY for the TTL and liveness — nothing else (memo §5.1). */
export function nowEpochS() {
  return Math.floor(Date.now() / 1000);
}

export function getGen() {
  return state.gen;
}

export function getDesired() {
  return state.desired;
}

export function getObserved() {
  return state.observed;
}

export function hasPolled() {
  return state.polled;
}

export function getSubscriberCount() {
  return state.subscribers;
}

export function getReplaceSequence() {
  return state.replaceSequence;
}

/**
 * Write the desired slot (the phone→board direction). Increments `gen`, which is
 * the only thing that ever advances it on a command edge.
 *
 * `minutes` is the remote-selectable countdown length (T6): a whole number of
 * minutes, one of `MINUTES_CHOICES`, carried **alongside** the `start` event the
 * way `routine` is. It is per-command data, never a fifth event and never a
 * persisted setting, so it is only ever written on a `start` (`device-protocols`
 * §3). Absent means "the board's own routine default".
 *
 * @param {{
 *   action: 'start' | 'cancel',
 *   routine?: string,
 *   minutes?: number,
 *   ttlS?: number,
 *   nowS?: number,
 * }} input
 */
export function setDesired({
  action,
  routine,
  minutes,
  ttlS = config.desiredTtlS,
  nowS = nowEpochS(),
}) {
  state.gen += 1;
  state.desired = {
    gen: state.gen,
    action,
    ...(routine ? { routine } : {}),
    ...(action === "start" && minutes !== undefined ? { minutes } : {}),
    expires_at: nowS + ttlS,
  };
  broadcastState();
  return state.desired;
}

export function clearDesired() {
  state.desired = null;
  broadcastState();
}

export function getMessage() {
  return state.message;
}

/**
 * Write the idle banner slot (the phone→board idle-screen content). It carries
 * its own monotonic `id` and a server-side `expires_at`; it never touches `gen`.
 *
 * @param {{text: string, ttlS?: number, nowS?: number}} input
 */
export function setMessage({
  text,
  ttlS = config.messageTtlS,
  nowS = nowEpochS(),
}) {
  state.messageSeq += 1;
  state.message = {
    id: state.messageSeq,
    text,
    expires_at: nowS + ttlS,
  };
  broadcastState();
  return state.message;
}

export function clearMessage() {
  state.message = null;
  broadcastState();
}

/**
 * Write the observed slot (the board→server direction). `received_at` is the free
 * liveness heartbeat: "last seen Ns ago" IS the poll (memo §4).
 *
 * @param {object} report the validated poll report
 * @param {number} [nowS]
 */
export function recordObserved(report, nowS = nowEpochS()) {
  state.observed = { ...report, received_at: nowS };
  state.polled = true;
  broadcastState();
  return state.observed;
}

/**
 * First-poll seed: `gen = applied_gen + 1`, never going backwards. Only called on
 * the first poll of the process (memo §5.1, `device-protocols.md` §3.1).
 *
 * @param {number} reportedAppliedGen
 */
export function seedGenFromBoard(reportedAppliedGen) {
  state.gen = Math.max(state.gen, reseedGen(reportedAppliedGen));
  return state.gen;
}

/**
 * Begin the cancel → wait → start orchestration for a routine switch. `cancelled_gen`
 * is the gen of the cancel we are about to send; `abandons_at` is its TTL.
 *
 * `target_minutes` is the countdown length the requested switch asked for (T6),
 * held here because the actual `start` is not sent until the panel reports
 * `ambient`; without it a replace would silently drop the chosen length and fall
 * back to the routine default.
 *
 * @param {{target_routine: string, target_minutes?: number, ttlS?: number, nowS?: number}} input
 */
export function beginReplaceSequence({
  target_routine,
  target_minutes,
  ttlS = config.desiredTtlS,
  nowS = nowEpochS(),
}) {
  state.replaceSequence = {
    target_routine,
    ...(target_minutes !== undefined ? { target_minutes } : {}),
    cancelled_gen: state.gen,
    started_at: nowS,
    abandons_at: nowS + ttlS,
  };
  return state.replaceSequence;
}

export function clearReplaceSequence() {
  state.replaceSequence = null;
}

export function incrementSubscribers() {
  state.subscribers += 1;
  return state.subscribers;
}

export function decrementSubscribers() {
  state.subscribers = Math.max(0, state.subscribers - 1);
  return state.subscribers;
}

/**
 * Derive liveness from the most recent poll (`device-protocols.md` §7). Nothing is
 * stored here — it is computed on read, so it is never stale-but-cached.
 *
 * @param {number} [nowS]
 * @param {number} [thresholdS]
 */
export function getLiveness(
  nowS = nowEpochS(),
  thresholdS = config.offlineThresholdS,
) {
  if (!state.observed) {
    return { online: false, last_seen_s: null, threshold_s: thresholdS };
  }
  const last_seen_s = Math.max(0, nowS - state.observed.received_at);
  return {
    online: last_seen_s <= thresholdS,
    last_seen_s,
    threshold_s: thresholdS,
  };
}
