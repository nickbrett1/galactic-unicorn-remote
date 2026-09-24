/**
 * D2/D5 — pure UI logic: the mirror formatters and the command-status reducer.
 * Everything the acceptance criterion depends on is here, host-testable.
 */

import { describe, expect, it } from "vitest";

import catalogue from "../src/lib/routines.json";
import {
  formatCountdown,
  formatLastSeen,
  labelForRoutine,
  mirrorHeadline,
  stateWord,
} from "../src/lib/ui/format.js";
import {
  initialStatus,
  isBusy,
  reduceStatus,
  statusText,
  statusTone,
} from "../src/lib/ui/command.js";

const ROUTINES = catalogue.routines;

describe("formatLastSeen", () => {
  it("reads seconds under a minute and minutes above it", () => {
    expect(formatLastSeen(null)).toBe("never seen");
    expect(formatLastSeen(undefined)).toBe("never seen");
    expect(formatLastSeen(2.7)).toBe("2 s ago");
    expect(formatLastSeen(180)).toBe("3m ago");
    expect(formatLastSeen(-5)).toBe("0 s ago");
  });
});

describe("formatCountdown", () => {
  it("formats m:ss and pads the seconds", () => {
    expect(formatCountdown(null)).toBeNull();
    expect(formatCountdown(214)).toBe("3:34");
    expect(formatCountdown(34)).toBe("0:34");
    expect(formatCountdown(-1)).toBe("0:00");
  });
});

describe("labelForRoutine", () => {
  it("resolves the label from the catalogue only", () => {
    expect(labelForRoutine(ROUTINES, "cleanup")).toBe("Cleanup");
    expect(labelForRoutine(ROUTINES, "nope")).toBeNull();
    expect(labelForRoutine(ROUTINES, null)).toBeNull();
  });
});

describe("mirrorHeadline", () => {
  it("names the routine while prompt/countdown, shouts on handoff", () => {
    expect(mirrorHeadline({ state: "ambient" }, ROUTINES)).toEqual({
      text: "Ambient",
      shout: false,
    });
    expect(
      mirrorHeadline({ state: "prompt", routine: "booktime" }, ROUTINES),
    ).toEqual({
      text: "Booktime",
      shout: false,
    });
    expect(
      mirrorHeadline({ state: "countdown", routine: "cleanup" }, ROUTINES),
    ).toEqual({
      text: "Cleanup",
      shout: false,
    });
    expect(
      mirrorHeadline({ state: "handoff", routine: "bathtime" }, ROUTINES),
    ).toEqual({
      text: "BATHTIME!",
      shout: true,
    });
    expect(mirrorHeadline({ state: "handoff" }, ROUTINES).text).toBe(
      "HANDOFF!",
    );
    expect(mirrorHeadline({ state: "prompt" }, ROUTINES).text).toBe(
      "Panel starting",
    );
  });
});

describe("stateWord", () => {
  it("gives every state a word so colour is never the only signal", () => {
    expect(stateWord("prompt")).toBe("Starting");
    expect(stateWord("countdown")).toBe("Counting down");
    expect(stateWord("handoff")).toBe("Done");
    expect(stateWord("ambient")).toBe("Idle");
    expect(stateWord(undefined)).toBe("Idle");
  });
});

describe("command status — the sent-vs-done reducer", () => {
  it("starts idle and treats a press as an optimistic press, not success", () => {
    const pressed = reduceStatus(initialStatus(), {
      type: "press",
      action: "start",
      routine: "bathtime",
    });
    expect(pressed).toEqual({
      kind: "pressing",
      action: "start",
      routine: "bathtime",
    });
    expect(isBusy(pressed)).toBe(true);
    expect(isBusy(initialStatus())).toBe(false);
  });

  it("maps a 202 to sending — accepted, not done", () => {
    const status = reduceStatus(initialStatus(), {
      type: "response",
      httpStatus: 202,
      body: { gen: 5, expires_at: 1000 },
      action: "start",
      routine: "bathtime",
    });
    expect(status).toEqual({
      kind: "sending",
      gen: 5,
      action: "start",
      routine: "bathtime",
      expiresAt: 1000,
    });
  });

  it("maps 409 to a conflict offer, 503 to offline, 200 to noop, else error", () => {
    expect(
      reduceStatus(initialStatus(), {
        type: "response",
        httpStatus: 409,
        body: { current_routine: "booktime" },
        action: "start",
        routine: "bathtime",
      }),
    ).toEqual({
      kind: "conflict",
      currentRoutine: "booktime",
      requested: "bathtime",
    });

    expect(
      reduceStatus(initialStatus(), {
        type: "response",
        httpStatus: 503,
        body: { last_seen_s: 200 },
        action: "cancel",
        routine: null,
      }),
    ).toEqual({ kind: "offline", lastSeenS: 200 });

    expect(
      reduceStatus(initialStatus(), {
        type: "response",
        httpStatus: 200,
        body: { reason: "already_running" },
        action: "start",
        routine: "bathtime",
      }),
    ).toEqual({ kind: "noop", action: "start", reason: "already_running" });

    expect(
      reduceStatus(initialStatus(), {
        type: "response",
        httpStatus: 0,
        body: null,
        action: "start",
        routine: "bathtime",
      }),
    ).toEqual({ kind: "error" });
  });

  it("confirms ONLY from applied_gen, and expires only on the TTL", () => {
    const sending = {
      kind: "sending",
      gen: 5,
      action: "start",
      routine: "bathtime",
      expiresAt: 1000,
    };

    const stillSending = reduceStatus(sending, {
      type: "snapshot",
      snapshot: { panel: { applied_gen: 4, last_seen_s: 1 } },
      nowMs: 900_000,
    });
    expect(stillSending).toBe(sending);

    const confirmed = reduceStatus(sending, {
      type: "snapshot",
      snapshot: { panel: { applied_gen: 5, last_seen_s: 1 } },
      nowMs: 900_000,
    });
    expect(confirmed).toEqual({
      kind: "confirmed",
      action: "start",
      routine: "bathtime",
    });

    const expired = reduceStatus(sending, {
      type: "snapshot",
      snapshot: { panel: { applied_gen: 4, last_seen_s: 180 } },
      nowMs: 1000 * 1000,
    });
    expect(expired).toEqual({
      kind: "expired",
      action: "start",
      routine: "bathtime",
      lastSeenS: 180,
    });
  });

  it("clears a conflict once the panel is back to ambient", () => {
    const conflict = {
      kind: "conflict",
      currentRoutine: "booktime",
      requested: "bathtime",
    };
    const cleared = reduceStatus(conflict, {
      type: "snapshot",
      snapshot: { panel: { state: "ambient", applied_gen: 9 } },
      nowMs: 0,
    });
    expect(cleared).toEqual({ kind: "idle" });

    const kept = reduceStatus(conflict, {
      type: "snapshot",
      snapshot: { panel: { state: "countdown", applied_gen: 9 } },
      nowMs: 0,
    });
    expect(kept).toBe(conflict);
  });

  it("resets to idle and ignores unknown events", () => {
    const sending = {
      kind: "sending",
      gen: 5,
      action: "start",
      routine: null,
      expiresAt: 1000,
    };
    expect(reduceStatus(sending, { type: "reset" })).toEqual({ kind: "idle" });
    expect(reduceStatus(sending, { type: "wat" })).toBe(sending);
  });

  it("gives every status a word and a tone", () => {
    expect(statusText({ kind: "idle" })).toBeNull();
    expect(statusText({ kind: "sending" })).toBe("sending…");
    expect(statusText({ kind: "confirmed" })).toBe("confirmed");
    expect(statusText({ kind: "expired", lastSeenS: 180 })).toBe(
      "the panel didn't answer (last seen 3m ago)",
    );
    expect(statusText({ kind: "offline", lastSeenS: null })).toBe(
      "panel offline (last seen never seen)",
    );
    expect(
      statusText({
        kind: "noop",
        action: "cancel",
        reason: "nothing_to_cancel",
      }),
    ).toBe("nothing to cancel");
    expect(
      statusText({ kind: "noop", action: "start", reason: "already_running" }),
    ).toBe("already running");
    expect(statusText({ kind: "error" })).toBe("couldn't send — try again");

    expect(statusTone({ kind: "sending" })).toBe("warn");
    expect(statusTone({ kind: "confirmed" })).toBe("go");
    expect(statusTone({ kind: "offline" })).toBe("danger");
    expect(statusTone({ kind: "idle" })).toBe("neutral");
  });
});
