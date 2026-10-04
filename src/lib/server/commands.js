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

import { DEFAULT_MINUTES, isValidMinutes } from "../minutes.js";
import { appendAudit } from "./audit.js";
import { config } from "./config.js";
import { jsonResponse } from "./http.js";
import {
  canShowMessage,
  isValidMessageText,
  resolveCommand,
} from "./reconcile.js";
import { isRoutineId } from "./routines.js";
import {
  beginReplaceSequence,
  getGen,
  getLiveness,
  getObserved,
  nowEpochS,
  setDesired,
  setMessage,
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
 * Validate a command body: `{routine, minutes?}`, `additionalProperties: false`,
 * and no echoing of a rejected value (memo §10).
 *
 * `minutes` is optional (T6): absent means the routine's own default, and a
 * present value must be one of `MINUTES_CHOICES` (1, 3 or 5). The server always
 * resolves it to an explicit integer so the board never has to guess — the
 * board's fall-back exists only for an older server.
 *
 * @returns {Promise<{ok: true, routine: string, minutes: number} | {ok: false}>}
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
  if (Object.keys(body).some((key) => key !== "routine" && key !== "minutes"))
    return { ok: false };
  if (!isRoutineId(body.routine)) return { ok: false };
  let minutes = DEFAULT_MINUTES;
  if (body.minutes !== undefined) {
    if (!isValidMinutes(body.minutes)) return { ok: false };
    minutes = body.minutes;
  }
  return { ok: true, routine: body.routine, minutes };
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
  if (desired.action === "start" && desired.minutes !== undefined) {
    body.minutes = desired.minutes;
  }
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
    minutes: parsed.minutes,
    nowS,
  });
  auditRow({
    action: "start",
    outcome: "accepted",
    routine: parsed.routine,
    gen: desired.gen,
    door,
    nowS,
    detail: `minutes=${parsed.minutes}`,
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
  beginReplaceSequence({
    target_routine: parsed.routine,
    target_minutes: parsed.minutes,
    nowS,
  });
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

/**
 * Validate a banner body: `{text}` only, `additionalProperties: false`, and a
 * printable-ASCII string inside the length bound. Returns an error CODE, never
 * an echo of the offending value (memo §10).
 *
 * @returns {Promise<{ok: true, text: string} | {ok: false, error: string}>}
 */
async function readMessageBody(request, maxLen) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "invalid_body" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false, error: "invalid_body" };
  if (Object.keys(body).some((key) => key !== "text"))
    return { ok: false, error: "invalid_body" };
  if (!isValidMessageText(body.text, maxLen))
    return { ok: false, error: "invalid_message" };
  return { ok: true, text: body.text };
}

/**
 * `POST /api/message {text}` — scroll a short message across the panel's idle
 * screen. **Idle-only**: a message is refused unless the panel is reachable AND
 * reporting `ambient`, because the board draws it on the one screen it has for
 * content, and a scroll has no meaning over a running countdown.
 *
 * Not a fifth device event and not a `gen` command: the banner is relayed on
 * every poll like the weather, and the board confirms it by reporting the `id`
 * it is drawing (`device-protocols.md` §3).
 *
 * @param {Request} request
 * @param {{kind: string, email: string|null}} [door]
 */
export async function runMessage(request, door) {
  const parsed = await readMessageBody(request, config.messageMaxLen);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 422);

  const nowS = nowEpochS();
  const panel = panelView(nowS);

  if (panel.online === false) {
    auditRow({
      action: "message",
      outcome: "refused_offline",
      door,
      nowS,
      detail: "panel offline; nothing set",
    });
    return jsonResponse(
      { error: "panel_offline", last_seen_s: panel.last_seen_s ?? null },
      503,
    );
  }

  // Idle-only. The board's own screen is the reason, and the server enforces it
  // here so the phone is told plainly rather than left waiting out a TTL.
  if (!canShowMessage(panel)) {
    auditRow({
      action: "message",
      outcome: "conflict",
      door,
      nowS,
      detail: `panel is not idle (state=${panel.state ?? "unknown"})`,
    });
    return jsonResponse(
      { error: "panel_busy", state: panel.state ?? null },
      409,
    );
  }

  const message = setMessage({ text: parsed.text, nowS });
  auditRow({
    action: "message",
    outcome: "accepted",
    door,
    nowS,
    detail: `id=${message.id} text=${parsed.text}`,
  });
  return jsonResponse(
    {
      id: message.id,
      expires_at: message.expires_at,
      ttl_s: config.messageTtlS,
    },
    202,
  );
}

/** Re-exported for route modules that only need the current gen. */
export { getGen };
