/**
 * D3 — the SSE route, `GET /api/events` (`spec/event-flow.md` §3).
 *
 * Proves the no-buffer headers are verbatim, that a `state` frame is emitted on
 * connect, that the `:hb` heartbeat fires, that the subscriber count is LIVE and
 * feeds `next_poll_ms`, and that audit rows fan out — before the tunnel step (D4)
 * ever runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getEvents } from "../src/routes/api/events/+server.js";
import { GET as poll } from "../src/routes/device/poll/+server.js";
import { appendAudit, resetAuditSeq } from "../src/lib/server/audit.js";
import { clearSubscribers, subscriberCount } from "../src/lib/server/events.js";
import { getSubscriberCount, resetState } from "../src/lib/server/state.js";

const TOKEN = "test-device-token";
const door = { kind: "tunnel", email: "ts.akhtar@gmail.com" };

function openStream() {
  const response = getEvents({ locals: { door } });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  return { response, reader, decoder };
}

async function readFrame(reader, decoder) {
  const { value } = await reader.read();
  return decoder.decode(value);
}

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

beforeEach(() => {
  vi.useFakeTimers();
  resetState();
  resetAuditSeq();
  clearSubscribers();
});

afterEach(() => {
  clearSubscribers();
  vi.useRealTimers();
});

describe("GET /api/events", () => {
  it("sets the no-buffer headers verbatim", () => {
    const { response, reader } = openStream();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    reader.cancel();
  });

  it("emits a state frame on connect and tracks a LIVE subscriber count", async () => {
    expect(subscriberCount()).toBe(0);
    const { reader, decoder } = openStream();

    // Live on connect — this is what feeds next_poll_ms.
    expect(subscriberCount()).toBe(1);
    expect(getSubscriberCount()).toBe(1);

    const frame = await readFrame(reader, decoder);
    expect(frame).toContain("event: state");
    const payload = JSON.parse(frame.split("data: ")[1]);
    expect(payload.type).toBe("state");
    expect(payload.state.routines).toHaveLength(3);

    await reader.cancel();
    expect(subscriberCount()).toBe(0);
    expect(getSubscriberCount()).toBe(0);
  });

  it("keeps the subscriber count live and feeds next_poll_ms = 2000", async () => {
    const { reader } = openStream();
    const response = await poll({ url: pollUrl() });
    const body = await response.json();
    expect(body.next_poll_ms).toBe(2000);

    await reader.cancel();
    const idle = await (await poll({ url: pollUrl() })).json();
    expect(idle.next_poll_ms).toBe(5000);
  });

  it("sends a comment heartbeat every ~15 s", async () => {
    const { reader, decoder } = openStream();
    await readFrame(reader, decoder); // consume the connect frame

    await vi.advanceTimersByTimeAsync(15_000);
    const frame = await readFrame(reader, decoder);
    expect(frame).toContain(":hb");

    await reader.cancel();
  });

  it("fans out audit rows as audit frames", async () => {
    const { reader, decoder } = openStream();
    await readFrame(reader, decoder); // connect frame

    appendAudit({
      door: "tunnel",
      action: "start",
      routine: "bathtime",
      outcome: "accepted",
    });

    const frame = await readFrame(reader, decoder);
    expect(frame).toContain("event: audit");
    const payload = JSON.parse(frame.split("data: ")[1]);
    expect(payload).toMatchObject({ type: "audit", outcome: "accepted" });

    await reader.cancel();
  });

  it("never lets a dead subscriber break a write path", async () => {
    const { reader } = openStream();
    await reader.cancel();
    expect(() =>
      appendAudit({
        door: "tunnel",
        action: "cancel",
        outcome: "noop",
      }),
    ).not.toThrow();
    expect(subscriberCount()).toBe(0);
  });
});
