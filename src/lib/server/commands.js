/**
 * Shared command-surface helpers — B5.
 *
 * One implementation, used by `POST /api/start | /api/cancel | /api/replace`.
 * Every command resolves the conflict table FIRST (`device-protocols.md` §5) and
 * only then touches state; a command is **accepted, not done** (memo §9.1).
 *
 * Nothing here computes a countdown and nothing sets state into a dead window:
 * an offline panel is refused before anything is written (memo §5.5).
 */

import { appendAudit } from "./audit.js";
import { config } from "./config.js";
import { jsonResponse } from "./http.js";
import { resolveCommand } from "./reconcile.js";
import { isRoutineId } from "./routines.js";
import {
  beginReplaceSequence,
  getGen,
  getLiveness,
  getObserved,
  nowEpochS,
  setDesired,
} from "./state.js";

/** The panel as the conflict table sees it: last observed report ∪ derived liveness. */
function panelView(nowS) {
  const observed = getObserved();
  const liveness = getLiveness(nowS);
  return { ...(observed ?? {}), ...liveness };
}

/**
 * Append one audit row, filling the observational columns from the current poll
 * so a heap failure is distinguishable from a link failure (R15, memo §11.15).
 */
function auditRow({
  action,
  outcome,
  routine = null,
  gen = null,
  door,
  detail = null,
  nowS,
}) {
  const observed = getObserved();
  const liveness = getLiveness(nowS);
  return appendAudit({
    door: mapDoor(door),
    actor_email: door?.email ?? null,
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

/** Map a request's door to the audit-log `door` column. */
function mapDoor(door) {
  const kind = door?.kind;
  if (kind === "tunnel" || kind === "tailnet" || kind === "lan") return kind;
  return "server";
}

/**
 * Validate a command body: `{routine}` in `routines.json`, `additionalProperties:
 * false`, and no echoing of a rejected value (memo §10).
 *
 * @returns {Promise<{ok: true, routine: string} | {ok: false}>}
 */
async function readRoutineBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false };
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false };
  if (Object.keys(body).some((key) => key !== "routine")) return { ok: false };
  if (!isRoutineId(body.routine)) return { ok: false };
  return { ok: true, routine: body.routine };
}

/** The DesiredAck body: accepted, NOT done. */
function desiredAck(desired, extraRoutine) {
  const body = {
    gen: desired.gen,
    action: desired.action,
    expires_at: desired.expires_at,
    ttl_s: config.desiredTtlS,
  };
  const routine = desired.routine ?? extraRoutine;
  if (routine) body.routine = routine;
  return body;
}

/** @param {{decision: object, action: string, routine: string|null, door: object, nowS: number}} args */
function respondRefused({ action, routine, door, nowS, decision }) {
  auditRow({
    action,
    outcome: "refused_offline",
    routine,
    door,
    nowS,
    detail: "panel offline; nothing set",
  });
  return jsonResponse(
    { error: "panel_offline", last_seen_s: decision.last_seen_s },
    503,
  );
}

/**
 * `POST /api/start {routine}` — the command round trip (`flows/command-round-trip-sequence.md`).
 * @param {Request} request
 * @param {{kind: string, email: string|null}} [door]
 */
export async function runStart(request, door) {
  const parsed = await readRoutineBody(request);
  if (!parsed.ok) return jsonResponse({ error: "invalid_body" }, 422);

  const nowS = nowEpochS();
  const decision = resolveCommand({
    requested: "start",
    routine: parsed.routine,
    panel: panelView(nowS),
  });

  if (decision.kind === "refuse_offline") {
    return respondRefused({
      action: "start",
      routine: parsed.routine,
      door,
      nowS,
      decision,
    });
  }
  if (decision.kind === "noop") {
    auditRow({
      action: "start",
      outcome: "noop",
      routine: parsed.routine,
      door,
      nowS,
      detail: decision.reason,
    });
    return jsonResponse({ status: "noop", reason: decision.reason }, 200);
  }
  if (decision.kind === "conflict") {
    auditRow({
      action: "start",
      outcome: "conflict",
      routine: parsed.routine,
      door,
      nowS,
      detail: `current_routine=${decision.current_routine}`,
    });
    return jsonResponse(
      {
        error: "conflict",
        current_routine: decision.current_routine,
        offers: ["replace"],
      },
      409,
    );
  }

  const desired = setDesired({
    action: "start",
    routine: parsed.routine,
    nowS,
  });
  auditRow({
    action: "start",
    outcome: "accepted",
    routine: parsed.routine,
    gen: desired.gen,
    door,
    nowS,
  });
  return jsonResponse(desiredAck(desired), 202);
}

/**
 * `POST /api/cancel` — the D button. Silent; a no-op from ambient.
 * @param {Request} request
 * @param {{kind: string, email: string|null}} [door]
 */
export async function runCancel(request, door) {
  const nowS = nowEpochS();
  const decision = resolveCommand({
    requested: "cancel",
    panel: panelView(nowS),
  });

  if (decision.kind === "refuse_offline") {
    return respondRefused({
      action: "cancel",
      routine: null,
      door,
      nowS,
      decision,
    });
  }
  if (decision.kind === "noop") {
    auditRow({
      action: "cancel",
      outcome: "noop",
      door,
      nowS,
      detail: decision.reason,
    });
    return jsonResponse({ status: "noop", reason: decision.reason }, 200);
  }

  const desired = setDesired({ action: "cancel", nowS });
  auditRow({
    action: "cancel",
    outcome: "accepted",
    gen: desired.gen,
    door,
    nowS,
  });
  return jsonResponse(desiredAck(desired), 202);
}

/**
 * `POST /api/replace {routine}` — the ONLY way to switch routines. Begins a
 * cancel → wait-for-`ambient` → start sequence. Never a silent switch (memo §5.5).
 * @param {Request} request
 * @param {{kind: string, email: string|null}} [door]
 */
export async function runReplace(request, door) {
  const parsed = await readRoutineBody(request);
  if (!parsed.ok) return jsonResponse({ error: "invalid_body" }, 422);

  const nowS = nowEpochS();
  const decision = resolveCommand({
    requested: "replace",
    routine: parsed.routine,
    panel: panelView(nowS),
  });

  if (decision.kind === "refuse_offline") {
    return respondRefused({
      action: "replace",
      routine: parsed.routine,
      door,
      nowS,
      decision,
    });
  }
  if (decision.kind === "noop") {
    // Nothing running (nothing_to_cancel) or the requested routine is already the
    // one running (already_running) — either way there is nothing to replace.
    const current =
      decision.reason === "already_running" ? parsed.routine : null;
    auditRow({
      action: "replace",
      outcome: "noop",
      routine: parsed.routine,
      door,
      nowS,
      detail: decision.reason,
    });
    return jsonResponse(
      { error: "conflict", current_routine: current, offers: ["replace"] },
      409,
    );
  }
  if (decision.kind === "conflict") {
    auditRow({
      action: "replace",
      outcome: "conflict",
      routine: parsed.routine,
      door,
      nowS,
      detail: `current_routine=${decision.current_routine}`,
    });
    return jsonResponse(
      {
        error: "conflict",
        current_routine: decision.current_routine,
        offers: ["replace"],
      },
      409,
    );
  }

  // set: send the cancel that opens the sequence, then record the sequence's
  // `cancelled_gen` as THAT cancel's gen — so the board reporting
  // `applied_gen >= cancelled_gen` is exactly "the cancel landed".
  const desired = setDesired({ action: "cancel", nowS });
  beginReplaceSequence({ target_routine: parsed.routine, nowS });
  auditRow({
    action: "replace",
    outcome: "accepted",
    routine: parsed.routine,
    gen: desired.gen,
    door,
    nowS,
  });
  return jsonResponse(desiredAck(desired, parsed.routine), 202);
}

/** Re-exported for route modules that only need the current gen. */
export { getGen };
