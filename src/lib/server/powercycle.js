/**
 * The wedge watchdog: power-cycle a deaf panel, from the one place that can.
 *
 * **Why it lives in the service.** The CYW43 "deaf radio" wedge (2026-09-26/27
 * memos) leaves the board reporting `status=3(up)`, a valid lease and a healthy
 * `rssi` while every socket operation fails `OSError(110) ETIMEDOUT` — and a
 * host ping gets 100 % loss. The board cannot clear it and, more to the point,
 * **cannot ask anyone to clear it**: the radio it would ask over is the thing
 * that is broken. So the recovery has to be driven from outside the board, and
 * the natural owner is the service, because the board already talks to it every
 * few seconds.
 *
 * **The signal is the poll.** `/device/poll` records `received_at` on every
 * request, and `getLiveness()` derives `last_seen_s` from it on read. A wedged
 * panel stops polling, so "no poll for N seconds" is a wedge detector the
 * service already has, with nothing new to deploy on the board. That same
 * transition is the *instrumentation*: the quiet→recovered edges are recorded,
 * so the timeline of when the window closed and reopened is a record rather
 * than a recollection.
 *
 * **Why a relay and not `radio_reset`.** The board's own `radio_reset` clears
 * the wedge sometimes (observed 14:33) and not others, which makes it useless
 * as a guarantee. A power-cycle is the thing that always works, so it is the
 * LAST resort, not the first: it costs a reboot, a wifi join and the panel's
 * state, so it is gated behind a long quiet period, a cool-down, and a per-wedge
 * budget. Once the budget is spent the monitor stops trying — a board that is
 * unplugged, moved or re-flashed must not be power-cycled every ten minutes
 * forever.
 *
 * **Off, wait, on** — not a toggle. The switch is set to `off`, held for
 * `POWER_CYCLE_OFF_MS`, then set to `on`, so the cycle is correct whether the
 * plug is on or off when we start (a toggle on an already-off plug does
 * nothing). The gap must be long enough for the Pico's regulator to drop and
 * the CYW43 to lose its state, which is why the default is seconds and not a
 * blip.
 *
 * Disabled by default: with `POWER_CYCLE_ENABLED` unset, `startPowerCycleMonitor`
 * starts nothing and the service behaves exactly as before.
 */

import net from "node:net";

import { appendAudit } from "./audit.js";
import { config } from "./config.js";
import { getLiveness, nowEpochS } from "./state.js";

/**
 * TP-Link's fixed port for the HS100/Kasa protocol.
 *
 * This plug (HS100(US) hw 1.0, sw 1.2.6) speaks the protocol over **TCP**, not
 * UDP: 9999 accepts a TCP connection and replies to the same 4-byte-length +
 * XOR frame, while UDP/9999 and the 20002 discovery port stay silent. Verified
 * 2026-09-27 from both mac-studio and this service's container (routing to
 * 192.168.1.0/24 works from the container). Sending the frame over TCP is the
 * only framing that gets an answer, so the transport is TCP.
 */
export const KASA_PORT = 9999;

/**
 * Encrypt a Kasa command body. The scheme is an autokey XOR seeded with 0xAB:
 * each output byte is the running key XORed with the plaintext byte, and the
 * key then becomes that output. Pure, so the framing is unit-testable without a
 * plug on the bench.
 *
 * @param {string} text
 * @returns {Buffer}
 */
export function kasaEncrypt(text) {
  const out = Buffer.alloc(text.length);
  let key = 0xab;
  for (let i = 0; i < text.length; i += 1) {
    key ^= text.charCodeAt(i);
    out[i] = key;
  }
  return out;
}

/**
 * Decrypt a Kasa response body. The inverse of `kasaEncrypt`: the key becomes
 * the *ciphertext* byte after each step, not the plaintext one.
 *
 * @param {Buffer} buf
 * @returns {string}
 */
export function kasaDecrypt(buf) {
  const out = Buffer.alloc(buf.length);
  let key = 0xab;
  for (let i = 0; i < buf.length; i += 1) {
    out[i] = key ^ buf[i];
    key = buf[i];
  }
  return out.toString("utf8");
}

/**
 * Frame a command: a 4-byte big-endian length, then the encrypted JSON.
 *
 * @param {object} command
 * @returns {Buffer}
 */
export function buildKasaCommand(command) {
  const body = kasaEncrypt(JSON.stringify(command));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Parse a framed response, skipping the 4-byte length header.
 *
 * @param {Buffer} buf
 * @returns {object}
 */
export function parseKasaResponse(buf) {
  return JSON.parse(kasaDecrypt(buf.subarray(4)));
}

/**
 * Try to read one complete frame out of an accumulating TCP receive buffer.
 *
 * TCP is a stream: the 4-byte length header and the body can arrive split
 * across `data` events, so the caller buffers until this says `complete`. Pure,
 * so the split-frame case is unit-testable without a socket.
 *
 * @param {Buffer} buf
 * @returns {{complete: false, need: number} | {complete: true, value: object}}
 */
export function tryReadKasaFrame(buf) {
  if (buf.length < 4) return { complete: false, need: 4 - buf.length };
  const len = buf.readUInt32BE(0);
  if (buf.length < 4 + len)
    return { complete: false, need: 4 + len - buf.length };
  return { complete: true, value: parseKasaResponse(buf.subarray(0, 4 + len)) };
}

/**
 * The relay command. `state` is 1 for on, 0 for off.
 *
 * @param {boolean} on
 * @returns {object}
 */
export function relayCommand(on) {
  return { system: { set_relay_state: { state: on ? 1 : 0 } } };
}

/**
 * The wedge policy, pure so the whole decision table is testable.
 *
 * The order of the checks is the safety property: "disabled" and "online" are
 * answered before any clock is consulted, so no window or budget can cause a
 * cycle while the panel is actually talking to us.
 *
 * @param {object} input
 * @param {boolean} input.enabled
 * @param {boolean} input.online
 * @param {number|null} input.quietForS   seconds since the last poll, or null
 * @param {number|null} input.lastCycleAgoS seconds since the last cycle, or null
 * @param {number} input.cyclesThisWedge
 * @param {number} input.maxCycles
 * @param {number} input.strayS   quiet long enough to be a wedge, not cadence
 * @param {number} input.cooldownS  minimum gap between cycles
 * @returns {{action: 'none'|'cycle', reason: string}}
 */
export function decideWedgeAction({
  enabled,
  online,
  quietForS,
  lastCycleAgoS,
  cyclesThisWedge,
  maxCycles,
  strayS,
  cooldownS,
}) {
  if (!enabled) return { action: "none", reason: "disabled" };
  if (online) return { action: "none", reason: "online" };
  if (quietForS === null) return { action: "none", reason: "never-polled" };
  if (quietForS < strayS) return { action: "none", reason: "within-cadence" };
  if (cyclesThisWedge >= maxCycles) {
    return { action: "none", reason: "cycle-budget-spent" };
  }
  if (lastCycleAgoS !== null && lastCycleAgoS < cooldownS) {
    return { action: "none", reason: "cool-down" };
  }
  return { action: "cycle", reason: "quiet-past-threshold" };
}

/**
 * Send one command to the plug and resolve with its parsed reply.
 *
 * TCP, so the reply must be reassembled from the stream: connect, write the
 * framed command, then accumulate `data` until a whole frame is present.
 */
export function kasaCommand(
  command,
  { host, port = KASA_PORT, timeoutMs = 4000 },
) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    let buf = Buffer.alloc(0);
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("kasa: no reply (timeout)")),
      timeoutMs,
    );
    socket.once("error", (err) => finish(err));
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const res = tryReadKasaFrame(buf);
      if (res.complete) finish(null, res.value);
    });
    socket.once("connect", () => socket.write(buildKasaCommand(command)));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Off, hold, on. Throws if either command fails, so a failure is one line in
 * the log rather than a half-applied state nobody noticed.
 *
 * @param {{host: string, port?: number, offMs: number}} opts
 */
export async function powerCycle({ host, port = KASA_PORT, offMs }) {
  await kasaCommand(relayCommand(false), { host, port });
  await sleep(offMs);
  await kasaCommand(relayCommand(true), { host, port });
  return true;
}

/** Audit a wedge/cycle row. Never throws: bookkeeping must not stop the monitor. */
function note(action, detail, outcome = "noop") {
  const nowS = nowEpochS();
  const live = getLiveness(nowS);
  try {
    appendAudit({
      door: "device",
      actor_email: null,
      action,
      routine: null,
      gen: null,
      outcome,
      applied_gen: null,
      panel_last_seen_s: live.last_seen_s,
      panel_state_reported: null,
      detail,
    });
  } catch (err) {
    console.warn("[powercycle] audit failed:", err?.message ?? err);
  }
}

/** Per-wedge bookkeeping. In-memory: a service restart starts a fresh budget. */
const mon = {
  wasOnline: null,
  quietSinceS: null,
  cycles: 0,
  lastCycleAtS: null,
  timer: null,
};

/**
 * One pass of the monitor. Exported so it can be driven deterministically by a
 * test (and so a manual tick is one call at the REPL of a running service).
 */
export async function tick() {
  const nowS = nowEpochS();
  const live = getLiveness(nowS);
  if (live.last_seen_s === null)
    return { action: "none", reason: "never-polled" };

  if (live.online) {
    if (mon.wasOnline === false) {
      const quiet = mon.quietSinceS === null ? null : nowS - mon.quietSinceS;
      note(
        "wedge",
        `panel recovered after ${quiet}s quiet (${mon.cycles} power-cycle(s) this wedge)`,
      );
      mon.quietSinceS = null;
      mon.cycles = 0;
      mon.lastCycleAtS = null;
    }
    mon.wasOnline = true;
    return { action: "none", reason: "online" };
  }

  if (mon.wasOnline === null || mon.wasOnline === true) {
    mon.wasOnline = false;
    mon.quietSinceS = nowS;
    mon.cycles = 0;
    mon.lastCycleAtS = null;
    note("wedge", `panel went quiet (no poll for ${live.last_seen_s}s)`);
  }

  const decision = decideWedgeAction({
    enabled: config.powerCycleEnabled,
    online: false,
    quietForS: nowS - mon.quietSinceS,
    lastCycleAgoS: mon.lastCycleAtS === null ? null : nowS - mon.lastCycleAtS,
    cyclesThisWedge: mon.cycles,
    maxCycles: config.powerCycleMax,
    strayS: config.powerCycleStaleS,
    cooldownS: config.powerCycleCooldownS,
  });

  if (decision.action !== "cycle") return decision;

  mon.cycles += 1;
  mon.lastCycleAtS = nowS;
  note(
    "power",
    `power-cycling ${config.kasaHost}:${config.kasaPort} after ${nowS - mon.quietSinceS}s quiet ` +
      `(cycle ${mon.cycles}/${config.powerCycleMax})`,
    "applied",
  );
  try {
    await powerCycle({
      host: config.kasaHost,
      port: config.kasaPort,
      offMs: config.powerCycleOffMs,
    });
  } catch (err) {
    note("power", `power-cycle FAILED: ${err?.message ?? err}`, "expired");
  }
  return decision;
}

/**
 * Start the monitor. Idempotent, and a no-op unless `POWER_CYCLE_ENABLED` is
 * set — so importing this module on a build machine arms nothing.
 *
 * @returns {boolean} true when the timer was started
 */
export function startPowerCycleMonitor() {
  if (!config.powerCycleEnabled) return false;
  if (mon.timer) return false;
  if (!config.kasaHost) {
    console.warn("[powercycle] enabled but KASA_HOST is unset - not starting");
    return false;
  }
  console.log(
    `[powercycle] watching: cycle ${config.kasaHost} after ` +
      `${config.powerCycleStaleS}s quiet, cool-down ${config.powerCycleCooldownS}s, ` +
      `max ${config.powerCycleMax}/wedge`,
  );
  mon.timer = setInterval(() => {
    tick().catch((err) =>
      console.warn("[powercycle] tick failed:", err?.message ?? err),
    );
  }, config.powerCycleCheckMs);
  // Do not hold the event loop open on this account alone.
  mon.timer.unref?.();
  return true;
}

/** Test/dev hook: stop the monitor and forget the per-wedge bookkeeping. */
export function stopPowerCycleMonitor() {
  if (mon.timer) clearInterval(mon.timer);
  mon.timer = null;
  mon.wasOnline = null;
  mon.quietSinceS = null;
  mon.cycles = 0;
  mon.lastCycleAtS = null;
}
