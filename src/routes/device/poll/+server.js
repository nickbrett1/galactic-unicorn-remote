/**
 * `GET /device/poll` — B4. The shared wire contract with the firmware repo.
 *
 * One request does three things (`spec/api/device-protocols.md` §1): the board
 * reports observed state, the server answers with desired state, and the server
 * sets the cadence via `next_poll_ms`. Nothing here depends on the firmware — a
 * `curl` loop (`scripts/fake-board.sh`) is the Phase B stand-in for the board.
 *
 * Every query parameter is validated and input is never echoed into the response
 * (`implementation-considerations §7.7`). The response is tiny and the route never
 * stalls (R3).
 */

import { appendAudit } from "../../../lib/server/audit.js";
import { config } from "../../../lib/server/config.js";
import { jsonResponse } from "../../../lib/server/http.js";
import {
  isExpired,
  isGenApplied,
  nextPollMs,
  PANEL_STATES,
} from "../../../lib/server/reconcile.js";
import { isRoutineId } from "../../../lib/server/routines.js";
import {
  clearDesired,
  clearReplaceSequence,
  getDesired,
  getGen,
  getLiveness,
  getObserved,
  getReplaceSequence,
  getSubscriberCount,
  hasPolled,
  nowEpochS,
  recordObserved,
  seedGenFromBoard,
  setDesired,
} from "../../../lib/server/state.js";

const MAX_STRING = 16;

/** Strict integer: optional leading '-', digits only. Returns null when invalid. */
function parseIntStrict(raw) {
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

function intAtLeast(raw, min) {
  const value = parseIntStrict(raw);
  if (value === null || value < min) return null;
  return value;
}

function intAtMost(raw, max) {
  const value = parseIntStrict(raw);
  if (value === null || value > max) return null;
  return value;
}

function stringAtMost(raw, max) {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > max)
    return null;
  return raw;
}

/**
 * Validate the query string into an `Observed` report. Returns a `detail` NAMING
 * the offending parameter (never its value) when anything is malformed.
 *
 * @param {URLSearchParams} params
 * @returns {{ok: true, report: object} | {ok: false, detail: string}}
 */
function parsePollReport(params) {
  const boot = stringAtMost(params.get("boot"), MAX_STRING);
  if (boot === null) return { ok: false, detail: "boot" };

  const fw = stringAtMost(params.get("fw"), MAX_STRING);
  if (fw === null) return { ok: false, detail: "fw" };

  const appliedGen = intAtLeast(params.get("applied_gen"), 0);
  if (appliedGen === null) return { ok: false, detail: "applied_gen" };

  const state = params.get("state");
  if (!PANEL_STATES.includes(state)) return { ok: false, detail: "state" };

  const report = { boot, fw, applied_gen: appliedGen, state };

  const routine = params.get("routine");
  if (routine !== null) {
    if (!isRoutineId(routine)) return { ok: false, detail: "routine" };
    report.routine = routine;
  }

  const remainingRaw = params.get("remaining_s");
  if (remainingRaw !== null) {
    const value = intAtLeast(remainingRaw, 0);
    if (value === null) return { ok: false, detail: "remaining_s" };
    report.remaining_s = value;
  }

  const rssiRaw = params.get("rssi");
  if (rssiRaw !== null) {
    const value = intAtMost(rssiRaw, 0);
    if (value === null) return { ok: false, detail: "rssi" };
    report.rssi = value;
  }

  const uptimeRaw = params.get("uptime_s");
  if (uptimeRaw !== null) {
    const value = intAtLeast(uptimeRaw, 0);
    if (value === null) return { ok: false, detail: "uptime_s" };
    report.uptime_s = value;
  }

  return { ok: true, report };
}

/** Audit a device row, filling observational columns from the just-recorded poll. */
function auditDevice({
  action,
  outcome,
  routine = null,
  gen = null,
  detail = null,
  nowS,
}) {
  const observed = getObserved();
  const liveness = getLiveness(nowS);
  appendAudit({
    door: "device",
    actor_email: null,
    action,
    routine,
    gen,
    outcome,
    applied_gen: observed?.applied_gen ?? null,
    panel_last_seen_s: liveness.last_seen_s,
    panel_state_reported: observed?.state ?? null,
    detail,
  });
}

/** @param {URLSearchParams} params @returns {Response} */
export function GET({ url }) {
  const token = url.searchParams.get("token");
  // Defence in depth only; never a real boundary (memo §10). Never echo the token.
  if (!config.deviceToken || token !== config.deviceToken) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const parsed = parsePollReport(url.searchParams);
  if (!parsed.ok) {
    return jsonResponse(
      { error: "invalid_parameter", detail: parsed.detail },
      422,
    );
  }

  const nowS = nowEpochS();
  const report = parsed.report;
  const previousBoot = getObserved()?.boot;
  const firstPoll = !hasPolled();

  // (1) A new boot id clears pending desired BEFORE this poll's response is
  // computed — the panel must never re-run the last command after a reboot (§3.2).
  if (previousBoot !== undefined && previousBoot !== report.boot) {
    clearDesired();
    clearReplaceSequence();
    auditDevice({
      action: "boot",
      outcome: "noop",
      nowS,
      detail: `boot id changed ${previousBoot} -> ${report.boot}`,
    });
  }

  // (2) Record observed (received_at is the free liveness heartbeat).
  recordObserved(report, nowS);

  // (3) First poll of this process: seed gen from the board's high-water mark.
  if (firstPoll) seedGenFromBoard(report.applied_gen);

  const replaceSeq = getReplaceSequence();
  const desired = getDesired();

  if (replaceSeq) {
    // (5) Advance the replace sequence only on the REPORTED state, never a timer.
    if (
      report.state === "ambient" &&
      isGenApplied(report.applied_gen, replaceSeq.cancelled_gen)
    ) {
      auditDevice({
        action: "cancel",
        outcome: "applied",
        gen: replaceSeq.cancelled_gen,
        nowS,
        detail: "replace: cancel landed",
      });
      clearDesired();
      const started = setDesired({
        action: "start",
        routine: replaceSeq.target_routine,
        nowS,
      });
      clearReplaceSequence();
      auditDevice({
        action: "replace",
        outcome: "accepted",
        routine: replaceSeq.target_routine,
        gen: started.gen,
        nowS,
        detail: "replace: starting target routine",
      });
    } else if (nowS >= replaceSeq.abandons_at) {
      // The panel went away mid-sequence: abandon loudly (memo §9.1).
      auditDevice({
        action: "replace",
        outcome: "expired",
        routine: replaceSeq.target_routine,
        gen: replaceSeq.cancelled_gen,
        nowS,
        detail:
          "replace abandoned: panel did not report ambient before the TTL",
      });
      clearDesired();
      clearReplaceSequence();
    }
  } else if (desired && desired.action !== "none") {
    if (isGenApplied(report.applied_gen, desired.gen)) {
      // (4) The command landed — the only thing that ever confirms "done".
      auditDevice({
        action: desired.action,
        outcome: "applied",
        routine: desired.routine ?? null,
        gen: desired.gen,
        nowS,
        detail: "board reported applied_gen >= gen",
      });
      clearDesired();
    } else if (isExpired(desired, nowS)) {
      // TTL: dropped, never queued, never fired late (memo §5.4).
      auditDevice({
        action: desired.action,
        outcome: "expired",
        routine: desired.routine ?? null,
        gen: desired.gen,
        nowS,
        detail: "desired TTL elapsed with no applied_gen advance",
      });
      clearDesired();
    }
  }

  const pending = getDesired();
  const pendingApply = Boolean(pending && pending.action !== "none");
  const activeCountdown =
    report.state === "countdown" || report.state === "handoff";

  // (6) Demand-driven cadence.
  const nextMs = nextPollMs({
    pendingApply,
    activeCountdown,
    subscribers: getSubscriberCount(),
    minMs: config.nextPollMinMs,
    maxMs: config.nextPollMaxMs,
  });

  // (7) The tiny response. Never echoes input.
  const body = {
    gen: getGen(),
    action: pending && pending.action !== "none" ? pending.action : "none",
    next_poll_ms: nextMs,
  };
  if (pending && pending.action !== "none" && pending.routine) {
    body.routine = pending.routine;
  }

  return jsonResponse(body, 200);
}
