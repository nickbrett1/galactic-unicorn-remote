/**
 * The wedge watchdog suite: the cipher, the framing, and the decision table.
 *
 * All four units are pure, which is the point — the plug itself is not on the
 * bench, so the only things that can be checked here are the bytes on the wire
 * and the policy that decides when to send them. Anything requiring a real
 * relay belongs to the board.
 */

import { describe, expect, it } from "vitest";

import {
  buildKasaCommand,
  decideWedgeAction,
  kasaDecrypt,
  kasaEncrypt,
  parseKasaResponse,
  relayCommand,
  tryReadKasaFrame,
} from "./powercycle.js";

describe("kasa cipher", () => {
  it("round-trips a command body", () => {
    const text = JSON.stringify(relayCommand(true));
    expect(kasaDecrypt(kasaEncrypt(text))).toBe(text);
  });

  it("is an autokey XOR, not a fixed XOR (byte 0 carries the key forward)", () => {
    // Two identical plaintexts must not encrypt identically at different
    // positions, which is what makes it a cipher rather than an XOR mask.
    const once = kasaEncrypt("aa");
    expect(once[0]).not.toBe(once[1]);
  });

  it("leaves a single 0x00 byte as 0xAB (the seed)", () => {
    expect(kasaEncrypt("\0")[0]).toBe(0xab);
  });
});

describe("kasa framing", () => {
  it("prefixes the body with its big-endian length", () => {
    const command = relayCommand(false);
    const frame = buildKasaCommand(command);
    const declared = frame.readUInt32BE(0);
    expect(declared).toBe(frame.length - 4);
    expect(parseKasaResponse(frame)).toEqual(command);
  });

  it("sets the relay on and off with 1 and 0", () => {
    expect(relayCommand(true)).toEqual({
      system: { set_relay_state: { state: 1 } },
    });
    expect(relayCommand(false)).toEqual({
      system: { set_relay_state: { state: 0 } },
    });
  });
});

describe("tryReadKasaFrame (TCP reassembly)", () => {
  // A real reply, framed the way the plug frames one: length, then body.
  const reply = { system: { set_relay_state: { err_code: 0 } } };
  const frame = buildKasaCommand(reply);

  it("returns the parsed value once a whole frame has arrived", () => {
    expect(tryReadKasaFrame(frame)).toEqual({ complete: true, value: reply });
  });

  it("asks for more when the length header is itself split", () => {
    expect(tryReadKasaFrame(frame.subarray(0, 2))).toEqual({
      complete: false,
      need: 2,
    });
  });

  it("asks for the missing tail when the body arrives in pieces", () => {
    const half = 4 + Math.floor((frame.length - 4) / 2);
    const res = tryReadKasaFrame(frame.subarray(0, half));
    expect(res.complete).toBe(false);
    expect(res.need).toBe(frame.length - half);
    // …and completes when the rest of the stream shows up.
    expect(tryReadKasaFrame(frame)).toEqual({ complete: true, value: reply });
  });

  it("ignores trailing bytes past the declared frame", () => {
    const padded = Buffer.concat([frame, Buffer.from([1, 2, 3])]);
    expect(tryReadKasaFrame(padded)).toEqual({ complete: true, value: reply });
  });
});

describe("decideWedgeAction", () => {
  const base = {
    enabled: true,
    online: false,
    quietForS: 300,
    lastCycleAgoS: null,
    cyclesThisWedge: 0,
    maxCycles: 2,
    strayS: 180,
    cooldownS: 600,
  };
  const decide = (over) => decideWedgeAction({ ...base, ...over });

  it("cycles when quiet past the threshold", () => {
    expect(decide({})).toEqual({
      action: "cycle",
      reason: "quiet-past-threshold",
    });
  });

  it("never cycles while the panel is online, however long we have waited", () => {
    expect(decide({ online: true, quietForS: 99999 }).action).toBe("none");
  });

  it("does not cycle when disabled, even when wedged", () => {
    expect(decide({ enabled: false })).toEqual({
      action: "none",
      reason: "disabled",
    });
  });

  it("treats a gap inside the cadence as normal, not a wedge", () => {
    expect(decide({ quietForS: 179 })).toEqual({
      action: "none",
      reason: "within-cadence",
    });
  });

  it("does not cycle a board that has never polled", () => {
    expect(decide({ quietForS: null })).toEqual({
      action: "none",
      reason: "never-polled",
    });
  });

  it("enforces the cool-down between cycles", () => {
    expect(decide({ lastCycleAgoS: 599, cyclesThisWedge: 1 })).toEqual({
      action: "none",
      reason: "cool-down",
    });
    expect(decide({ lastCycleAgoS: 600, cyclesThisWedge: 1 }).action).toBe(
      "cycle",
    );
  });

  it("stops once the per-wedge budget is spent", () => {
    expect(decide({ cyclesThisWedge: 2, lastCycleAgoS: 9999 })).toEqual({
      action: "none",
      reason: "cycle-budget-spent",
    });
  });
});
