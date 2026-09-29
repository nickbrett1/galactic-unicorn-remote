/**
 * B8 — backend route integration tests.
 *
 * These are the `curl`-equivalent requests from `implementation-considerations
 * §10.4`: each route's exported handler is driven directly with `Request`
 * objects / handler args (no live server needed). The health-endpoint assertion
 * from the old generated smoke test is kept.
 *
 * No firmware is involved anywhere.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { GET as getHealth } from "../src/routes/health/+server.js";
import { GET as poll } from "../src/routes/device/poll/+server.js";
import { GET as getState } from "../src/routes/api/state/+server.js";
import { POST as postStart } from "../src/routes/api/start/+server.js";
import { POST as postCancel } from "../src/routes/api/cancel/+server.js";
import { POST as postReplace } from "../src/routes/api/replace/+server.js";
import { POST as postMessage } from "../src/routes/api/message/+server.js";
import { classifyDoor, handle, init } from "../src/hooks.server.js";
import { assertRuntimeConfig, config } from "../src/lib/server/config.js";
import {
  beginReplaceSequence,
  getDesired,
  getGen,
  getMessage,
  getObserved,
  nowEpochS,
  recordObserved,
  resetState,
  setDesired,
  setMessage,
} from "../src/lib/server/state.js";

const TOKEN = "test-device-token";
const TUNNEL = { kind: "tunnel", email: "ts.akhtar@gmail.com" };

/** Build a `/device/poll` URL with sensible defaults. */
function pollUrl(overrides = {}) {
  const params = new URLSearchParams({
    token: TOKEN,
    boot: "b1",
    fw: "0.2.0",
    applied_gen: "0",
    state: "ambient",
    ...overrides,
  });
  return new URL(`http://lan.test/device/poll?${params.toString()}`);
}

/** Drive a POST command route with a JSON body. */
function post(handler, body, door = TUNNEL) {
  const request = new Request("http://lan.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handler({ request, locals: { door } });
}

const pollReport = (overrides = {}) => ({
  boot: "b1",
  fw: "0.2.0",
  applied_gen: 0,
  state: "ambient",
  ...overrides,
});

beforeEach(() => {
  resetState();
});

describe("/health — the three-consumer contract", () => {
  it("returns JSON {status:'ok'} (Dockerfile HEALTHCHECK, Homepage widget, CI smoke)", async () => {
    const res = getHealth();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("/device/poll — auth and validation", () => {
  it("401s a missing or wrong token (and never echoes it)", async () => {
    const missing = poll({ url: pollUrl({ token: "" }) });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "unauthorized" });

    const wrong = poll({ url: pollUrl({ token: "nope" }) });
    expect(wrong.status).toBe(401);
  });

  it("422s malformed parameters, naming the parameter but never its value", async () => {
    const cases = [
      { boot: "" },
      { boot: "x".repeat(17) },
      { fw: "" },
      { applied_gen: "-1" },
      { applied_gen: "abc" },
      { state: "bogus" },
      { routine: "naptime" },
      { remaining_s: "-1" },
      { rssi: "5" },
      { uptime_s: "-2" },
      { wedge: "x".repeat(65) },
      { reset_cause: "-1" },
      { reset_cause: "16" },
      { reset_cause: "abc" },
      // the weather pair: a lone half, an unknown condition, a bad temperature
      { temp_c: "18" },
      { condition: "sun" },
      { condition: "hail", temp_c: "18" },
      { condition: "sun", temp_c: "abc" },
      { condition: "sun", temp_c: "3.5" },
      { condition: "sun", temp_c: "-101" },
      { condition: "sun", temp_c: "101" },
    ];
    for (const override of cases) {
      const res = poll({ url: pollUrl(override) });
      expect(res.status, JSON.stringify(override)).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("invalid_parameter");
      expect(body).not.toHaveProperty("token");
    }
  });

  it("accepts optional routine/remaining_s/rssi/uptime_s when well-formed", async () => {
    const res = poll({
      url: pollUrl({
        state: "countdown",
        routine: "bathtime",
        remaining_s: "214",
        rssi: "-41",
        uptime_s: "3820",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("relays the board's wedge tally verbatim (firmware lib/wedge.py)", async () => {
    const tally = "heap0.link2.other0.cy1.rec1.pk2";
    const res = poll({ url: pollUrl({ wedge: tally }) });
    expect(res.status).toBe(200);
    // Stored on the observed slot, unparsed: only the board can classify its
    // own failures, so the service relays the string and does not interpret it.
    expect(getObserved().wedge).toBe(tally);
  });

  it("relays the reset cause verbatim (firmware machine.reset_cause())", async () => {
    // 3 is WDT_RESET on this port: the latch the wedge work was chasing, which
    // used to be visible only on the USB console.
    const res = poll({ url: pollUrl({ reset_cause: "3" }) });
    expect(res.status).toBe(200);
    expect(getObserved().reset_cause).toBe(3);
  });

  it("rejects a bool-ish or out-of-range reset_cause", async () => {
    for (const raw of ["-1", "16", "yes", "3.5"]) {
      const res = poll({ url: pollUrl({ reset_cause: raw }) });
      expect(res.status, raw).toBe(422);
    }
  });

  it("relays the board's weather pair verbatim, negatives included", async () => {
    const res = poll({ url: pollUrl({ condition: "snow", temp_c: "-7" }) });
    expect(res.status).toBe(200);
    // Stored on the observed slot, unparsed: the board read the sky, the
    // service only passes the reading through (`device-protocols.md` §3).
    expect(getObserved().condition).toBe("snow");
    expect(getObserved().temp_c).toBe(-7);
  });

  it("accepts every condition name and the generous temperature bounds", async () => {
    const names = ["sun", "partly", "cloud", "fog", "rain", "snow", "thunder"];
    for (const condition of names) {
      expect(
        poll({ url: pollUrl({ condition, temp_c: "-100" }) }).status,
        condition,
      ).toBe(200);
      expect(
        poll({ url: pollUrl({ condition, temp_c: "100" }) }).status,
        condition,
      ).toBe(200);
    }
  });

  it("422s a half weather pair, naming the field that is missing", async () => {
    // A temperature with no condition has no glyph behind it; a condition with
    // no temperature has no number. Both are malformed, and the detail names
    // the missing field (never an echoed value).
    const noCondition = poll({ url: pollUrl({ temp_c: "18" }) });
    expect(noCondition.status).toBe(422);
    expect((await noCondition.json()).detail).toBe("condition");

    const noTemp = poll({ url: pollUrl({ condition: "sun" }) });
    expect(noTemp.status).toBe(422);
    expect((await noTemp.json()).detail).toBe("temp_c");
  });

  it("accepts a poll with no weather at all (no reading is normal)", async () => {
    const res = poll({ url: pollUrl({}) });
    expect(res.status).toBe(200);
    expect(getObserved()).not.toHaveProperty("condition");
    expect(getObserved()).not.toHaveProperty("temp_c");
  });

  it("seeds gen = applied_gen + 1 on the first poll (R6) and returns a tiny body", async () => {
    const res = poll({ url: pollUrl({ applied_gen: "17" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ gen: 18, action: "none", next_poll_ms: 5000 });
  });

  it("re-seeds without going backwards when the board's high-water mark lags", async () => {
    poll({ url: pollUrl({ applied_gen: "17", boot: "b1" }) });
    const res = poll({ url: pollUrl({ applied_gen: "3", boot: "b1" }) });
    const body = await res.json();
    expect(body.gen).toBe(18);
  });
});

describe("/device/poll — the command round trip", () => {
  it("delivers a pending start, then confirms it via applied_gen", async () => {
    // first poll: seed
    poll({ url: pollUrl({ boot: "b1" }) });

    // phone presses start
    const startRes = await post(postStart, { routine: "bathtime" });
    expect(startRes.status).toBe(202);

    // poll 1: desired is pending -> 2000ms, action start
    const pending = await poll({
      url: pollUrl({ boot: "b1", applied_gen: "1" }),
    });
    const pendingBody = await pending.json();
    expect(pendingBody).toMatchObject({
      action: "start",
      routine: "bathtime",
      next_poll_ms: 2000,
    });
    expect(pendingBody.gen).toBe(2);

    // the board applies it and reports back
    const applied = await poll({
      url: pollUrl({
        boot: "b1",
        applied_gen: "2",
        state: "prompt",
        routine: "bathtime",
      }),
    });
    const appliedBody = await applied.json();
    expect(appliedBody.action).toBe("none");
    expect(getDesired()).toBeNull();
  });

  it("drops an expired desired instead of queueing it", async () => {
    poll({ url: pollUrl({ boot: "b1" }) });
    // A desired slot whose TTL has already elapsed (server clock only).
    setDesired({
      action: "start",
      routine: "bathtime",
      nowS: nowEpochS() - 100,
    });

    const res = await poll({ url: pollUrl({ boot: "b1", applied_gen: "1" }) });
    const body = await res.json();
    expect(body.action).toBe("none");
    expect(getDesired()).toBeNull();
  });

  it("clears pending desired the moment it sees a new boot id (§3.2)", async () => {
    poll({ url: pollUrl({ boot: "b1" }) });
    await post(postStart, { routine: "bathtime" });
    expect(getDesired()).not.toBeNull();

    const res = await poll({ url: pollUrl({ boot: "b2" }) });
    const body = await res.json();
    expect(body.action).toBe("none");
    expect(getDesired()).toBeNull();
  });

  it("polls at 2000ms while a countdown is active and 5000ms when idle", async () => {
    poll({ url: pollUrl({ boot: "b1" }) });

    const idle = await poll({ url: pollUrl({ boot: "b1", state: "ambient" }) });
    expect((await idle.json()).next_poll_ms).toBe(5000);

    const counting = await poll({
      url: pollUrl({
        boot: "b1",
        state: "countdown",
        routine: "bathtime",
        remaining_s: "200",
      }),
    });
    expect((await counting.json()).next_poll_ms).toBe(2000);
  });
});

describe("/api/start — conflict, offline, no-op, set", () => {
  it("422s an unknown routine or extra properties without echoing them", async () => {
    expect((await post(postStart, { routine: "naptime" })).status).toBe(422);
    expect(
      (await post(postStart, { routine: "bathtime", extra: 1 })).status,
    ).toBe(422);
    expect((await post(postStart, {})).status).toBe(422);
  });

  it("202s a set from ambient (accepted, NOT done)", async () => {
    recordObserved(pollReport({ state: "ambient" }), nowEpochS());
    const res = await post(postStart, { routine: "bathtime" });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({
      action: "start",
      routine: "bathtime",
      ttl_s: 45,
    });
    expect(body.gen).toBe(getGen());
  });

  it("503s an offline panel and sets nothing", async () => {
    recordObserved(pollReport({ state: "ambient" }), nowEpochS() - 180);
    const res = await post(postStart, { routine: "bathtime" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "panel_offline",
      last_seen_s: 180,
    });
    expect(getDesired()).toBeNull();
  });

  it("200s a no-op when the requested routine is already running", async () => {
    recordObserved(
      pollReport({ state: "countdown", routine: "bathtime", remaining_s: 200 }),
      nowEpochS(),
    );
    const res = await post(postStart, { routine: "bathtime" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "noop",
      reason: "already_running",
    });
    expect(getDesired()).toBeNull();
  });

  it("409s a conflict with a different routine counting down", async () => {
    recordObserved(
      pollReport({ state: "countdown", routine: "bathtime", remaining_s: 200 }),
      nowEpochS(),
    );
    const res = await post(postStart, { routine: "booktime" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      current_routine: "bathtime",
      offers: ["replace"],
    });
    expect(getDesired()).toBeNull();
  });
});

describe("/api/cancel — the D button", () => {
  it("202s while counting down", async () => {
    recordObserved(
      pollReport({ state: "countdown", routine: "bathtime" }),
      nowEpochS(),
    );
    const res = await post(postCancel, null);
    expect(res.status).toBe(202);
    expect((await res.json()).action).toBe("cancel");
  });

  it("200s a no-op from ambient", async () => {
    recordObserved(pollReport({ state: "ambient" }), nowEpochS());
    const res = await post(postCancel, null);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "noop",
      reason: "nothing_to_cancel",
    });
  });

  it("503s an offline panel", async () => {
    recordObserved(
      pollReport({ state: "countdown", routine: "bathtime" }),
      nowEpochS() - 180,
    );
    const res = await post(postCancel, null);
    expect(res.status).toBe(503);
    expect(getDesired()).toBeNull();
  });
});

describe("/api/replace — cancel → wait → start, never a silent switch", () => {
  it("begins the sequence, then advances when the board reports ambient", async () => {
    // panel is counting down bathtime; first poll seeds gen = 1.
    poll({
      url: pollUrl({
        boot: "b1",
        applied_gen: "0",
        state: "countdown",
        routine: "bathtime",
      }),
    });
    expect(getGen()).toBe(1);

    const replaceRes = await post(postReplace, { routine: "booktime" });
    expect(replaceRes.status).toBe(202);
    const replaceBody = await replaceRes.json();
    expect(replaceBody.action).toBe("cancel");
    // The sequence's cancelled_gen is this cancel's gen (2).
    expect(replaceBody.gen).toBe(2);

    // Board applies the cancel and reports ambient at applied_gen 2.
    const advance = await poll({
      url: pollUrl({ boot: "b1", applied_gen: "2", state: "ambient" }),
    });
    const body = await advance.json();
    expect(body).toMatchObject({
      action: "start",
      routine: "booktime",
      gen: 3,
    });

    // Board applies the start.
    const done = await poll({
      url: pollUrl({
        boot: "b1",
        applied_gen: "3",
        state: "prompt",
        routine: "booktime",
      }),
    });
    expect((await done.json()).action).toBe("none");
  });

  it("409s when nothing is running", async () => {
    recordObserved(pollReport({ state: "ambient" }), nowEpochS());
    const res = await post(postReplace, { routine: "booktime" });
    expect(res.status).toBe(409);
    expect(getDesired()).toBeNull();
  });

  it("409s when the requested routine is already running", async () => {
    recordObserved(
      pollReport({ state: "countdown", routine: "bathtime" }),
      nowEpochS(),
    );
    const res = await post(postReplace, { routine: "bathtime" });
    expect(res.status).toBe(409);
  });

  it("503s an offline panel", async () => {
    recordObserved(
      pollReport({ state: "countdown", routine: "bathtime" }),
      nowEpochS() - 180,
    );
    const res = await post(postReplace, { routine: "booktime" });
    expect(res.status).toBe(503);
  });

  it("abandons a sequence when the panel never reports ambient before the TTL", async () => {
    recordObserved(
      pollReport({ state: "countdown", routine: "bathtime" }),
      nowEpochS(),
    );
    // A sequence whose abandonment window has already closed.
    beginReplaceSequence({
      target_routine: "booktime",
      nowS: nowEpochS() - 100,
    });
    setDesired({ action: "cancel", nowS: nowEpochS() - 100 });

    const res = await poll({
      url: pollUrl({ boot: "b1", state: "countdown", routine: "bathtime" }),
    });
    const body = await res.json();
    expect(body.action).toBe("none");
    expect(getDesired()).toBeNull();
  });
});

describe("/api/message — the idle-only banner", () => {
  it("202s from idle and stores a banner with its own id (accepted, not done)", async () => {
    recordObserved(pollReport({ state: "ambient" }), nowEpochS());
    const res = await post(postMessage, { text: "Dinner in ten" });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ id: 1, ttl_s: config.messageTtlS });
    expect(getMessage().text).toBe("Dinner in ten");
    // It moves no gen: a message is idle-screen content, not a device command.
    expect(getGen()).toBe(0);
  });

  it("422s a bad body or text, never echoing the value", async () => {
    recordObserved(pollReport({ state: "ambient" }), nowEpochS());
    const badBodies = [
      null,
      {},
      { text: "x", extra: 1 },
      { text: "" },
      { text: "   " },
      { text: "a".repeat(config.messageMaxLen + 1) },
      { text: "two\nlines" },
      { text: "café" },
      { text: 42 },
    ];
    for (const body of badBodies) {
      const res = await post(postMessage, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      const parsed = await res.json();
      expect(parsed).not.toHaveProperty("text");
    }
    expect(getMessage()).toBeNull();
  });

  it("409s panel_busy while the panel is counting down, setting nothing", async () => {
    recordObserved(
      pollReport({ state: "countdown", routine: "bathtime", remaining_s: 200 }),
      nowEpochS(),
    );
    const res = await post(postMessage, { text: "Hello" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "panel_busy",
      state: "countdown",
    });
    expect(getMessage()).toBeNull();
  });

  it("503s an offline panel and sets nothing", async () => {
    recordObserved(pollReport({ state: "ambient" }), nowEpochS() - 180);
    const res = await post(postMessage, { text: "Hello" });
    expect(res.status).toBe(503);
    expect(getMessage()).toBeNull();
  });
});

describe("/device/poll — the idle banner relay", () => {
  it("relays a live banner and its board-reported id, and polls fast", async () => {
    poll({ url: pollUrl({ boot: "b1" }) });
    setMessage({ text: "Dinner in ten", nowS: nowEpochS() });

    const res = await poll({
      url: pollUrl({ boot: "b1", state: "ambient", message_id: "1" }),
    });
    const body = await res.json();
    expect(body.message).toEqual({ id: 1, text: "Dinner in ten" });
    // A live banner is demand: the board should fetch/expire it promptly.
    expect(body.next_poll_ms).toBe(2000);
    // The board's own admission of what it is drawing, relayed verbatim.
    expect(getObserved().message_id).toBe(1);
  });

  it("omits the banner and idles at 5000ms when there is none", async () => {
    poll({ url: pollUrl({ boot: "b1" }) });
    const res = await poll({ url: pollUrl({ boot: "b1", state: "ambient" }) });
    const body = await res.json();
    expect(body).not.toHaveProperty("message");
    expect(body.next_poll_ms).toBe(5000);
  });

  it("drops an expired banner instead of queueing it", async () => {
    poll({ url: pollUrl({ boot: "b1" }) });
    setMessage({ text: "Old", nowS: nowEpochS() - 1000 });

    const res = await poll({ url: pollUrl({ boot: "b1", state: "ambient" }) });
    const body = await res.json();
    expect(body).not.toHaveProperty("message");
    expect(getMessage()).toBeNull();
  });

  it("drops the banner the moment the panel leaves the idle screen", async () => {
    poll({ url: pollUrl({ boot: "b1" }) });
    setMessage({ text: "Dinner in ten", nowS: nowEpochS() });

    const res = await poll({
      url: pollUrl({
        boot: "b1",
        state: "countdown",
        routine: "bathtime",
        remaining_s: "200",
      }),
    });
    expect(await res.json()).not.toHaveProperty("message");
    expect(getMessage()).toBeNull();
  });

  it("clears a pending banner on a new boot id (§3.2)", async () => {
    const { readAuditLog } = await import("../src/lib/server/audit.js");
    poll({ url: pollUrl({ boot: "b1" }) });
    setMessage({ text: "Dinner in ten", nowS: nowEpochS() });
    const before = readAuditLog().length;

    const res = await poll({ url: pollUrl({ boot: "b2" }) });
    expect(await res.json()).not.toHaveProperty("message");
    expect(getMessage()).toBeNull();

    // Only the rows this scenario appended: the log is shared across cases.
    const rows = readAuditLog().slice(before);
    const discarded = rows.find(
      (r) => r.action === "message" && r.outcome === "expired",
    );
    expect(discarded).toBeTruthy();
    expect(discarded.detail).toMatch(/reboot/i);
  });

  it("422s a malformed message_id", async () => {
    for (const raw of ["-1", "abc", "1.5"]) {
      const res = poll({ url: pollUrl({ message_id: raw }) });
      expect(res.status, raw).toBe(422);
    }
  });
});

describe("/api/state — the snapshot and the 2 s fallback", () => {
  it("returns panel ∪ liveness, desired, the catalogue and the door", async () => {
    poll({
      url: pollUrl({
        boot: "b1",
        state: "countdown",
        routine: "cleanup",
        remaining_s: "42",
        wedge: "heap0.link1.other0.cy1.rec1.pk1",
        reset_cause: "3",
      }),
    });
    const res = getState({ locals: { door: TUNNEL } });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.panel).toMatchObject({
      boot: "b1",
      state: "countdown",
      routine: "cleanup",
      online: true,
      threshold_s: 15,
    });
    // relayed verbatim from the board, never recomputed
    expect(body.panel.remaining_s).toBe(42);
    // the board's own wedge tally, relayed verbatim (firmware lib/wedge.py)
    expect(body.panel.wedge).toBe("heap0.link1.other0.cy1.rec1.pk1");
    // how the previous boot ended, relayed verbatim (firmware machine.reset_cause())
    expect(body.panel.reset_cause).toBe(3);
    expect(body.routines).toHaveLength(3);
    expect(body.routines.map((r) => r.id)).toEqual([
      "bathtime",
      "booktime",
      "cleanup",
    ]);
    expect(body.door).toEqual({ kind: "tunnel", email: "ts.akhtar@gmail.com" });
  });

  it("relays the panel's weather pair into the snapshot", async () => {
    poll({ url: pollUrl({ condition: "rain", temp_c: "9" }) });
    const body = await getState({ locals: { door: TUNNEL } }).json();
    // The same reading the panel is drawing, passed straight through.
    expect(body.panel.condition).toBe("rain");
    expect(body.panel.temp_c).toBe(9);
  });

  it("omits the weather fields when the board has no reading", async () => {
    poll({ url: pollUrl({}) });
    const body = await getState({ locals: { door: TUNNEL } }).json();
    // Absent, not null: "no reading" is a normal state, and the UI renders
    // nothing for it rather than a placeholder.
    expect(body.panel).not.toHaveProperty("condition");
    expect(body.panel).not.toHaveProperty("temp_c");
  });

  it("carries the live banner and reads an expired one as null", async () => {
    setMessage({ text: "Dinner in ten", nowS: nowEpochS() });
    const live = await getState({ locals: {} }).json();
    expect(live.message).toMatchObject({ id: 1, text: "Dinner in ten" });

    setMessage({ text: "Old", nowS: nowEpochS() - 1000 });
    const expired = await getState({ locals: {} }).json();
    expect(expired.message).toBeNull();
  });

  it("relays the id of the banner the board reports it is drawing", async () => {
    poll({ url: pollUrl({ message_id: "4" }) });
    const body = await getState({ locals: {} }).json();
    expect(body.panel.message_id).toBe(4);
  });

  it("reads an empty desired slot as action 'none'", async () => {
    const body = await getState({
      locals: { door: { kind: "lan", email: null } },
    }).json();
    expect(body.desired.action).toBe("none");
    expect(body.panel.online).toBe(false);
  });

  it("reads an expired desired slot as action 'none' (drops, never queues)", async () => {
    setDesired({
      action: "start",
      routine: "bathtime",
      nowS: nowEpochS() - 100,
    });
    const body = await getState({ locals: {} }).json();
    expect(body.desired.action).toBe("none");
  });
});

describe("hooks — surface trust", () => {
  it("classifies a Cloudflare-tunnel request", () => {
    const request = new Request("http://lan.test/", {
      headers: { "cf-access-authenticated-user-email": "ts.akhtar@gmail.com" },
    });
    expect(classifyDoor(request)).toEqual({
      kind: "tunnel",
      email: "ts.akhtar@gmail.com",
    });
  });

  it("classifies a tailnet request by host", () => {
    expect(classifyDoor(new Request("http://nas.tail1234.ts.net/"))).toEqual({
      kind: "tailnet",
      email: null,
    });
  });

  it("classifies anything else as LAN", () => {
    expect(classifyDoor(new Request("http://192.168.1.2:3009/"))).toEqual({
      kind: "lan",
      email: null,
    });
  });

  it("attaches the door to event.locals and never grants anything from the header", async () => {
    const locals = {};
    const forged = new Request("http://lan.test/api/state", {
      headers: { "cf-access-authenticated-user-email": "attacker@example.com" },
    });
    const resolved = await handle({
      event: { request: forged, locals },
      resolve: async () => new Response("ok"),
    });
    expect(resolved.status).toBe(200);
    // The email is recorded for display/audit only; there is no capability to grant.
    expect(locals.door).toEqual({
      kind: "tunnel",
      email: "attacker@example.com",
    });

    // A forged email still cannot make an invalid command valid.
    const res = await post(postStart, { routine: "naptime" }, locals.door);
    expect(res.status).toBe(422);
  });

  it("fails fast on startup when the device token is missing in a non-dev run", () => {
    expect(() =>
      assertRuntimeConfig({ deviceToken: "", isDevOrTest: false }),
    ).toThrow(/DEVICE_TOKEN is not set/);
    expect(
      assertRuntimeConfig({ deviceToken: "", isDevOrTest: true }).deviceToken,
    ).toBe("");
    expect(
      assertRuntimeConfig({ deviceToken: "t", isDevOrTest: false }).deviceToken,
    ).toBe("t");
  });

  it("init() passes in the test environment (token present)", () => {
    expect(() => init()).not.toThrow();
  });
});

describe("audit trail", () => {
  it("records accepted → applied across the round trip", async () => {
    const { readAuditLog } = await import("../src/lib/server/audit.js");
    resetState();
    poll({ url: pollUrl({ boot: "b1" }) });
    await post(postStart, { routine: "cleanup" });
    await poll({
      url: pollUrl({
        boot: "b1",
        applied_gen: getGen(),
        state: "prompt",
        routine: "cleanup",
      }),
    });

    const rows = readAuditLog();
    const accepted = rows.find(
      (r) =>
        r.action === "start" &&
        r.outcome === "accepted" &&
        r.routine === "cleanup",
    );
    const applied = rows.find(
      (r) =>
        r.action === "start" &&
        r.outcome === "applied" &&
        r.routine === "cleanup",
    );
    expect(accepted).toBeTruthy();
    expect(applied).toBeTruthy();
    expect(applied.applied_gen).toBeGreaterThanOrEqual(applied.gen);
  });

  it("records a pending command as expired when a reboot discards it (§3.2 + §9.1)", async () => {
    const { readAuditLog } = await import("../src/lib/server/audit.js");
    resetState();
    poll({ url: pollUrl({ boot: "b1" }) });
    await post(postStart, { routine: "bathtime" });
    const gen = getGen();
    const before = readAuditLog().length;

    // The board returns on a NEW boot id, well inside the TTL, so the reboot
    // branch — not the TTL branch — is what discards the command.
    await poll({ url: pollUrl({ boot: "b2" }) });

    expect(getDesired()).toBeNull();
    // Only the rows this scenario appended: the log is shared across cases.
    const rows = readAuditLog().slice(before);
    const discarded = rows.find((r) => r.outcome === "expired");
    // The boot row alone would leave the command unaccounted for.
    expect(discarded).toBeTruthy();
    expect(discarded.action).toBe("start");
    expect(discarded.gen).toBe(gen);
    expect(discarded.detail).toMatch(/reboot/i);
    expect(rows.at(-1).action).toBe("boot");
  });
});
