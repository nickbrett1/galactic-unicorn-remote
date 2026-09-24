/**
 * B1 — the pure reconciliation core's unit suite.
 *
 * This is the suite the plan requires before anything else: `gen` in both
 * directions (R6), TTL drop-not-queue, the seven-row conflict table verbatim,
 * the demand-driven cadence, the four-event vocabulary guard, and the
 * headless-timer guard. Everything here is pure — no sockets, no stores.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEVICE_EVENTS,
  eventForDesired,
  isExpired,
  isGenApplied,
  NEXT_POLL_FAST_MS,
  NEXT_POLL_IDLE_MS,
  nextPollMs,
  resolveCommand,
  reseedGen,
} from "./reconcile.js";
import { ROUTINE_IDS } from "./routines.js";

describe("gen ordering (R6)", () => {
  it("treats applied_gen >= gen as applied and applied_gen < gen as not", () => {
    expect(isGenApplied(18, 18)).toBe(true);
    expect(isGenApplied(19, 18)).toBe(true);
    expect(isGenApplied(17, 18)).toBe(false);
  });

  it("re-seeds a fresh server above the board's high-water mark (applied_gen > gen)", () => {
    // The server starts at 0; the board already applied 17 — the server must not
    // sit below it, or the board silently ignores every future command.
    expect(reseedGen(17)).toBe(18);
  });

  it("re-seeds without ever going backwards in the normal case", () => {
    for (const applied of [0, 1, 5, 100]) {
      expect(reseedGen(applied)).toBeGreaterThan(applied);
    }
    expect(reseedGen(0)).toBe(1);
  });
});

describe("TTL — dropped, never queued", () => {
  const desired = {
    gen: 4,
    action: "start",
    routine: "bathtime",
    expires_at: 1000,
  };

  it("reads an undesired slot as expired", () => {
    expect(isExpired(null, 0)).toBe(true);
    expect(isExpired(undefined, 0)).toBe(true);
  });

  it("is not expired before its deadline", () => {
    expect(isExpired(desired, 999)).toBe(false);
  });

  it("is expired at and past its deadline", () => {
    expect(isExpired(desired, 1000)).toBe(true);
    expect(isExpired(desired, 1045)).toBe(true);
  });

  it("hands the poll a slot that reads as action 'none' once expired", () => {
    // The poll route drops the slot and answers action:'none'. Here we assert the
    // decision the route makes from this function.
    const action = isExpired(desired, 1045) ? "none" : desired.action;
    expect(action).toBe("none");
  });
});

describe("conflict policy — the seven rows of device-protocols.md §5, verbatim", () => {
  const ambient = { state: "ambient", online: true, last_seen_s: 1 };
  const countingX = {
    state: "countdown",
    routine: "bathtime",
    online: true,
    last_seen_s: 1,
  };
  const counting = { state: "countdown", online: true, last_seen_s: 1 };
  const handoff = {
    state: "handoff",
    routine: "bathtime",
    online: true,
    last_seen_s: 1,
  };

  it("row 1: ambient + start X -> set start X", () => {
    expect(
      resolveCommand({
        requested: "start",
        routine: "bathtime",
        panel: ambient,
      }),
    ).toEqual({
      kind: "set",
      action: "start",
      routine: "bathtime",
    });
  });

  it("row 2: counting X + start X -> noop already_running", () => {
    expect(
      resolveCommand({
        requested: "start",
        routine: "bathtime",
        panel: countingX,
      }),
    ).toEqual({
      kind: "noop",
      reason: "already_running",
    });
  });

  it("row 3: counting X + start Y -> conflict current_routine X", () => {
    expect(
      resolveCommand({
        requested: "start",
        routine: "booktime",
        panel: countingX,
      }),
    ).toEqual({
      kind: "conflict",
      current_routine: "bathtime",
    });
  });

  it("row 4: counting + cancel -> set cancel", () => {
    expect(resolveCommand({ requested: "cancel", panel: counting })).toEqual({
      kind: "set",
      action: "cancel",
    });
  });

  it("row 5: ambient + cancel -> noop nothing_to_cancel", () => {
    expect(resolveCommand({ requested: "cancel", panel: ambient })).toEqual({
      kind: "noop",
      reason: "nothing_to_cancel",
    });
  });

  it("row 6: handoff + cancel -> set cancel (D is live in HANDOFF)", () => {
    expect(resolveCommand({ requested: "cancel", panel: handoff })).toEqual({
      kind: "set",
      action: "cancel",
    });
  });

  it("row 7: unreachable + start X -> refuse_offline, nothing set", () => {
    expect(
      resolveCommand({
        requested: "start",
        routine: "bathtime",
        panel: { state: "ambient", online: false, last_seen_s: 180 },
      }),
    ).toEqual({ kind: "refuse_offline", last_seen_s: 180 });
  });

  it("refuses to set anything into a dead window, for cancel and replace too", () => {
    const offline = {
      state: "countdown",
      routine: "bathtime",
      online: false,
      last_seen_s: 5,
    };
    expect(resolveCommand({ requested: "cancel", panel: offline }).kind).toBe(
      "refuse_offline",
    );
    expect(
      resolveCommand({
        requested: "replace",
        routine: "booktime",
        panel: offline,
      }).kind,
    ).toBe("refuse_offline");
  });

  it("treats a routine press during PROMPT of the same routine as already_running", () => {
    const prompt = {
      state: "prompt",
      routine: "bathtime",
      online: true,
      last_seen_s: 1,
    };
    expect(
      resolveCommand({
        requested: "start",
        routine: "bathtime",
        panel: prompt,
      }),
    ).toEqual({
      kind: "noop",
      reason: "already_running",
    });
  });

  it("replace with a different routine running begins a cancel", () => {
    expect(
      resolveCommand({
        requested: "replace",
        routine: "booktime",
        panel: countingX,
      }),
    ).toEqual({
      kind: "set",
      action: "cancel",
    });
  });

  it("replace with the same routine running needs no replace", () => {
    expect(
      resolveCommand({
        requested: "replace",
        routine: "bathtime",
        panel: countingX,
      }),
    ).toEqual({
      kind: "noop",
      reason: "already_running",
    });
  });

  it("replace with nothing running has nothing to replace", () => {
    expect(
      resolveCommand({
        requested: "replace",
        routine: "bathtime",
        panel: ambient,
      }),
    ).toEqual({
      kind: "noop",
      reason: "nothing_to_cancel",
    });
  });

  it("rejects an unknown requested action", () => {
    expect(() =>
      resolveCommand({ requested: "extend", panel: ambient }),
    ).toThrow();
  });
});

describe("nextPollMs — demand-driven cadence", () => {
  it("returns 2000 for each of the three demand inputs", () => {
    expect(nextPollMs({ pendingApply: true })).toBe(NEXT_POLL_FAST_MS);
    expect(nextPollMs({ activeCountdown: true })).toBe(NEXT_POLL_FAST_MS);
    expect(nextPollMs({ subscribers: 1 })).toBe(NEXT_POLL_FAST_MS);
  });

  it("returns 5000 when none of them is true", () => {
    expect(nextPollMs({})).toBe(NEXT_POLL_IDLE_MS);
    expect(
      nextPollMs({
        pendingApply: false,
        activeCountdown: false,
        subscribers: 0,
      }),
    ).toBe(NEXT_POLL_IDLE_MS);
  });

  it("respects O5's clamp values", () => {
    // Idle 5000 sits inside the default band unchanged.
    expect(nextPollMs({ minMs: 1000, maxMs: 10000 })).toBe(5000);
    // A raised floor clamps the idle value up.
    expect(nextPollMs({ minMs: 4000, maxMs: 10000 })).toBe(5000);
    expect(nextPollMs({ minMs: 6000, maxMs: 10000 })).toBe(6000);
    // A lowered ceiling clamps the on-demand value down.
    expect(nextPollMs({ pendingApply: true, minMs: 1000, maxMs: 1500 })).toBe(
      1500,
    );
  });
});

describe("event-vocabulary guard — the remote mimics the buttons and nothing else", () => {
  it("has exactly the three routine ids", () => {
    expect([...ROUTINE_IDS].sort()).toEqual([
      "bathtime",
      "booktime",
      "cleanup",
    ]);
  });

  it("has exactly four device events: the three routes plus reset", () => {
    expect([...DEVICE_EVENTS]).toEqual([
      "bathtime",
      "booktime",
      "cleanup",
      "reset",
    ]);
    expect(DEVICE_EVENTS).toHaveLength(4);
  });

  it("maps a cancel to the reset (D) event and nothing else", () => {
    expect(eventForDesired({ action: "cancel" })).toBe("reset");
    expect(eventForDesired({ action: "start", routine: "cleanup" })).toBe(
      "cleanup",
    );
    expect(eventForDesired({ action: "none" })).toBeNull();
    expect(eventForDesired(null)).toBeNull();
  });
});

describe("headless-timer guard", () => {
  it("contains no remaining_s computation — the server relays the board's figure", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/server/reconcile.js"),
      "utf8",
    );
    expect(source.includes("remaining_s")).toBe(false);
  });
});
