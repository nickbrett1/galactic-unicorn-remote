/**
 * The append-only audit log — B2.
 *
 * One JSON object per line, with exactly the columns of
 * `spec/data-architecture/audit-log-schema.sql`. **INSERT/SELECT only** — no
 * UPDATE, no DELETE (an optional bounded prune is a documented hook, O8, disabled
 * by default; see `planAuditPrune`).
 *
 * Secret hygiene (`implementation-considerations §7.6`): the writer builds each
 * row from an explicit field whitelist, so a device token, WiFi credential or the
 * Access JWT can never ride along in a caller's object. Only the Access **email**
 * may be logged, for display/audit.
 *
 * Rows are the only durable artefact of this service (O1): state may legally
 * vanish on restart; the log answers "did it work?" and "did we already start
 * bathtime?".
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

/** The closed set of outcomes (`event-flow.md` §4). */
export const AUDIT_OUTCOMES = Object.freeze([
  "accepted",
  "applied",
  "expired",
  "refused_offline",
  "conflict",
  "noop",
  "shadowed",
]);

/** Which surface a row concerns (`audit-log-schema.sql` door CHECK). */
export const AUDIT_DOORS = Object.freeze([
  "tunnel",
  "tailnet",
  "lan",
  "device",
  "server",
]);

let seq = 0;

/** Test/dev hook: restart the in-process sequence counter. */
export function resetAuditSeq() {
  seq = 0;
  return seq;
}

/**
 * Build an audit row from an explicit field whitelist. `seq` is monotonic within
 * the process. Anything the caller passes that is not in the whitelist (a token,
 * a JWT) is dropped.
 *
 * @param {{
 *   door: string,
 *   action: string,
 *   outcome: string,
 *   actor_email?: string | null,
 *   routine?: string | null,
 *   gen?: number | null,
 *   applied_gen?: number | null,
 *   panel_last_seen_s?: number | null,
 *   panel_state_reported?: string | null,
 *   detail?: string | null,
 *   at?: string,
 * }} input
 */
export function buildAuditRow(input) {
  seq += 1;
  return {
    seq,
    at: input.at ?? new Date().toISOString(),
    actor_email: input.actor_email ?? null,
    door: input.door,
    action: input.action,
    routine: input.routine ?? null,
    gen: input.gen ?? null,
    outcome: input.outcome,
    applied_gen: input.applied_gen ?? null,
    panel_last_seen_s: input.panel_last_seen_s ?? null,
    panel_state_reported: input.panel_state_reported ?? null,
    detail: input.detail ?? null,
  };
}

/**
 * Append one row to the JSONL file and return it.
 *
 * @param {Parameters<typeof buildAuditRow>[0]} input
 * @param {string} [path]
 */
export function appendAudit(input, path = config.auditLogPath) {
  const row = buildAuditRow(input);
  writeRow(row, path);
  return row;
}

/** @param {object} row @param {string} path */
function writeRow(row, path) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}

/**
 * Read the log back (for tests and the audit-surface hold). Missing file → [].
 *
 * @param {string} [path]
 * @returns {Array<object>}
 */
export function readAuditLog(path = config.auditLogPath) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * O8 (pending ratification): a bounded prune hook. **Disabled by default** — the
 * plan keeps all rows (≈2 MB/year). When enabled it only ever removes whole lines
 * older than a cut-off; it never mutates a row.
 *
 * @param {{path?: string, before?: string}} [options]
 * @returns {number} the number of rows removed (always 0 until O8 is ratified)
 */
export function planAuditPrune() {
  // The prune is deliberately not implemented in v1 (decision O8). This hook
  // exists so the retention policy has a named, bounded home: when adopted it
  // removes whole lines older than a cut-off and never mutates a row.
  return 0;
}
