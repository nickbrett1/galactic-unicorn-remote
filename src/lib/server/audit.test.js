/**
 * B2 — the append-only audit log's unit suite: append round-trip, monotonic seq,
 * and the secret-hygiene guarantee that a token can never reach the log.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  appendAudit,
  AUDIT_DOORS,
  AUDIT_OUTCOMES,
  buildAuditRow,
  planAuditPrune,
  readAuditLog,
  resetAuditSeq,
} from "./audit.js";

let dir;
let logPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gur-audit-"));
  logPath = join(dir, "audit.jsonl");
  resetAuditSeq();
});

describe("append round-trip", () => {
  it("writes one JSON object per line with the schema's columns", () => {
    const row = appendAudit(
      {
        door: "lan",
        action: "start",
        routine: "bathtime",
        gen: 18,
        outcome: "accepted",
        applied_gen: 17,
        panel_last_seen_s: 2,
        panel_state_reported: "ambient",
        detail: "accepted, not done",
      },
      logPath,
    );

    expect(row.seq).toBe(1);
    expect(row.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(row).sort()).toEqual(
      [
        "action",
        "actor_email",
        "applied_gen",
        "at",
        "detail",
        "door",
        "gen",
        "outcome",
        "panel_last_seen_s",
        "panel_state_reported",
        "routine",
        "seq",
      ].sort(),
    );

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(row);
  });

  it("increments seq monotonically and reads back in order", () => {
    appendAudit({ door: "device", action: "poll", outcome: "noop" }, logPath);
    appendAudit({ door: "device", action: "boot", outcome: "noop" }, logPath);
    appendAudit(
      { door: "tunnel", action: "cancel", outcome: "applied" },
      logPath,
    );

    const rows = readAuditLog(logPath);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.action)).toEqual(["poll", "boot", "cancel"]);
  });

  it("appends (never rewrites) across calls", () => {
    appendAudit({ door: "lan", action: "start", outcome: "accepted" }, logPath);
    appendAudit({ door: "lan", action: "start", outcome: "applied" }, logPath);
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("returns an empty log for a missing file", () => {
    expect(readAuditLog(join(dir, "nope.jsonl"))).toEqual([]);
  });
});

describe("row construction and vocabularies", () => {
  it("fills defaults for omitted optional columns", () => {
    const row = buildAuditRow({
      door: "server",
      action: "poll",
      outcome: "noop",
    });
    expect(row.actor_email).toBeNull();
    expect(row.routine).toBeNull();
    expect(row.gen).toBeNull();
    expect(row.applied_gen).toBeNull();
    expect(row.detail).toBeNull();
  });

  it("has the closed outcome set of event-flow.md §4", () => {
    expect([...AUDIT_OUTCOMES]).toEqual([
      "accepted",
      "applied",
      "expired",
      "refused_offline",
      "conflict",
      "noop",
      "shadowed",
    ]);
  });

  it("has the audit door set of audit-log-schema.sql", () => {
    expect([...AUDIT_DOORS]).toEqual([
      "tunnel",
      "tailnet",
      "lan",
      "device",
      "server",
    ]);
  });
});

describe("secret hygiene — never log a credential", () => {
  it("drops anything not in the column whitelist from a caller's object", () => {
    const row = appendAudit(
      {
        door: "device",
        action: "poll",
        outcome: "noop",
        // A careless caller passing the token must not leak it into the log.
        token: "super-secret-device-token",
        DeviceToken: "super-secret-device-token",
        detail: "poll ok",
      },
      logPath,
    );
    expect(row).not.toHaveProperty("token");
    expect(row).not.toHaveProperty("DeviceToken");
  });

  it("leaves no token string anywhere in the file", () => {
    appendAudit({ door: "device", action: "boot", outcome: "noop" }, logPath);
    appendAudit(
      {
        door: "device",
        action: "poll",
        outcome: "noop",
        token: "super-secret-device-token",
      },
      logPath,
    );
    const raw = readFileSync(logPath, "utf8");
    expect(raw.includes("super-secret-device-token")).toBe(false);
  });
});

describe("retention (O8) is a bounded, disabled-by-default hook", () => {
  it("prunes nothing by default", () => {
    appendAudit({ door: "lan", action: "start", outcome: "accepted" }, logPath);
    expect(planAuditPrune({ path: logPath })).toBe(0);
    expect(readAuditLog(logPath)).toHaveLength(1);
  });
});
