/**
 * B2 — the in-memory store's unit suite: liveness derivation and the one-writer
 * invariants (memo §2; `state-layout.json`).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { config } from "./config.js";
import {
  beginReplaceSequence,
  clearDesired,
  clearReplaceSequence,
  decrementSubscribers,
  getDesired,
  getGen,
  getLiveness,
  getObserved,
  getReplaceSequence,
  getSubscriberCount,
  hasPolled,
  incrementSubscribers,
  recordObserved,
  resetState,
  seedGenFromBoard,
  setDesired,
} from "./state.js";

const POLL = {
  boot: "9f3c1a22",
  fw: "0.2.0",
  applied_gen: 17,
  state: "ambient",
};

beforeEach(() => {
  resetState();
});

describe("the desired slot — one writer (the phone)", () => {
  it("starts empty with gen 0", () => {
    expect(getGen()).toBe(0);
    expect(getDesired()).toBeNull();
  });

  it("increments gen monotonically on every command edge", () => {
    const first = setDesired({
      action: "start",
      routine: "bathtime",
      nowS: 1000,
    });
    expect(first.gen).toBe(1);
    expect(getGen()).toBe(1);

    const second = setDesired({ action: "cancel", nowS: 1001 });
    expect(second.gen).toBe(2);
    expect(getGen()).toBe(2);
    expect(getDesired().action).toBe("cancel");
  });

  it("stamps expires_at from the TTL constant (O6)", () => {
    const desired = setDesired({
      action: "start",
      routine: "cleanup",
      nowS: 500,
    });
    expect(desired.expires_at).toBe(500 + config.desiredTtlS);
  });

  it("carries no routine on a cancel and clears cleanly", () => {
    const desired = setDesired({ action: "cancel", nowS: 10 });
    expect(desired.routine).toBeUndefined();
    clearDesired();
    expect(getDesired()).toBeNull();
    // gen does not move back when the slot is cleared.
    expect(getGen()).toBe(1);
  });
});

describe("the observed slot — one writer (the board)", () => {
  it("is empty until the first poll", () => {
    expect(getObserved()).toBeNull();
    expect(hasPolled()).toBe(false);
  });

  it("records exactly what the board reported, plus received_at", () => {
    recordObserved(
      { ...POLL, state: "countdown", routine: "bathtime", remaining_s: 214 },
      2000,
    );
    const observed = getObserved();
    expect(observed).toMatchObject({
      boot: "9f3c1a22",
      applied_gen: 17,
      state: "countdown",
      routine: "bathtime",
      received_at: 2000,
    });
    // The countdown is the BOARD's figure, mirrored verbatim — never recomputed.
    expect(observed.remaining_s).toBe(214);
    expect(hasPolled()).toBe(true);
  });
});

describe("liveness comes free from the poll", () => {
  it("is offline with no poll yet", () => {
    expect(getLiveness(3000)).toEqual({
      online: false,
      last_seen_s: null,
      threshold_s: config.offlineThresholdS,
    });
  });

  it("derives last_seen_s and flips offline past the threshold (O4)", () => {
    recordObserved(POLL, 1000);
    expect(getLiveness(1002)).toEqual({
      online: true,
      last_seen_s: 2,
      threshold_s: config.offlineThresholdS,
    });
    expect(getLiveness(1000 + config.offlineThresholdS).online).toBe(true);
    expect(getLiveness(1001 + config.offlineThresholdS).online).toBe(false);
  });

  it("never reports a negative last_seen_s", () => {
    recordObserved(POLL, 1000);
    expect(getLiveness(900).last_seen_s).toBe(0);
  });
});

describe("gen re-seed on the first poll (R6)", () => {
  it("seeds from the board's high-water mark", () => {
    seedGenFromBoard(17);
    expect(getGen()).toBe(18);
  });

  it("never goes backwards once seeded", () => {
    seedGenFromBoard(17); // gen = 18
    seedGenFromBoard(3); // a late/stale report must not lower gen
    expect(getGen()).toBe(18);
  });

  it("seeds an empty board to 1", () => {
    seedGenFromBoard(0);
    expect(getGen()).toBe(1);
  });
});

describe("replace sequence — server-side orchestration only", () => {
  it("records the cancelled_gen at the current gen and clears cleanly", () => {
    setDesired({ action: "start", routine: "bathtime", nowS: 100 }); // gen = 1
    const seq = beginReplaceSequence({ target_routine: "booktime", nowS: 100 });
    expect(seq).toMatchObject({
      target_routine: "booktime",
      cancelled_gen: 1,
      started_at: 100,
      abandons_at: 100 + config.desiredTtlS,
    });
    expect(getReplaceSequence()).toEqual(seq);
    clearReplaceSequence();
    expect(getReplaceSequence()).toBeNull();
  });
});

describe("subscribers — a LIVE count", () => {
  it("increments and decrements, never below zero", () => {
    expect(getSubscriberCount()).toBe(0);
    incrementSubscribers();
    incrementSubscribers();
    expect(getSubscriberCount()).toBe(2);
    decrementSubscribers();
    expect(getSubscriberCount()).toBe(1);
    decrementSubscribers();
    decrementSubscribers();
    expect(getSubscriberCount()).toBe(0);
  });
});
