/**
 * D5 — the remote UI component tests (`@testing-library/svelte`).
 *
 * These prove the phase's acceptance criterion: a `202` reads "sending…" and
 * **never** "confirmed" until the board reports the new `applied_gen`; a TTL miss
 * reads plainly; the panel going offline disables the controls; and the conflict
 * affordance is a real, focused disclosure that posts `/api/replace`
 * (`design-system.md` §5, `flows/device-desired-state-state-machine.md` §2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/svelte";

import Page from "../src/routes/+page.svelte";
import catalogue from "../src/lib/routines.json";

const ROUTINES = catalogue.routines;

/** A controllable EventSource so tests can drive server frames. */
class MockEventSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    MockEventSource.last = this;
  }
  addEventListener(type, callback) {
    const list = this.listeners[type] ?? [];
    list.push(callback);
    this.listeners[type] = list;
  }
  emit(type, data) {
    for (const callback of this.listeners[type] ?? []) callback(data);
  }
  close() {
    this.closed = true;
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeSnapshot(panel = {}) {
  return {
    panel: {
      boot: "b1",
      fw: "0.2.0",
      applied_gen: 0,
      state: "ambient",
      online: true,
      last_seen_s: 2,
      threshold_s: 15,
      ...panel,
    },
    desired: { gen: 0, action: "none", expires_at: 0 },
    routines: ROUTINES,
    door: { kind: "tunnel", email: "ts.akhtar@gmail.com" },
  };
}

function renderPage({ panel = {}, email = "ts.akhtar@gmail.com" } = {}) {
  return render(Page, {
    props: {
      data: {
        snapshot: makeSnapshot(panel),
        door: { kind: "tunnel", email },
      },
    },
  });
}

/** Emit a `state` frame from the (mocked) SSE stream. */
async function emitState(panel) {
  await act(() => {
    MockEventSource.last.emit("state", {
      data: JSON.stringify({ type: "state", state: makeSnapshot(panel) }),
    });
  });
}

/** Click a button and flush the async POST handler. */
async function click(element) {
  await act(async () => {
    await fireEvent.click(element);
  });
}

const future = () => Math.floor(Date.now() / 1000) + 45;

let fetchMock;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", MockEventSource);
  MockEventSource.last = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("D1 — the shell and exactly four controls", () => {
  it("renders three routine buttons and one Cancel, labelled from routines.json", () => {
    renderPage();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    for (const routine of ROUTINES) {
      expect(screen.getByRole("button", { name: routine.label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    // No durations, no +2 min, no settings — nothing else is a button.
    expect(screen.queryByText(/\+2/)).toBeNull();
  });

  it("shows the Access email only when it is present (display only)", () => {
    const { container } = renderPage({ email: "ts.akhtar@gmail.com" });
    expect(container.textContent).toContain("signed in as ts.akhtar@gmail.com");
  });

  it("omits the signed-in line when no email is present", () => {
    const { container } = renderPage({ email: null });
    expect(container.textContent).not.toContain("signed in as");
  });

  it("renders the mirror as a live region with the panel's relayed liveness", () => {
    const { container } = renderPage();
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(container.textContent).toContain("panel: last seen 2 s ago");
    expect(container.textContent).toContain("Ambient");
  });

  it("shouts the routine in HANDOFF", () => {
    const { container } = renderPage({
      panel: { state: "handoff", routine: "bathtime", applied_gen: 3 },
    });
    expect(container.textContent).toContain("BATHTIME!");
  });
});

describe("D2 — sent is never done", () => {
  it("a 202 shows 'sending…' and does NOT show 'confirmed'", async () => {
    renderPage();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { gen: 5, action: "start", routine: "bathtime", expires_at: future() },
        202,
      ),
    );

    await click(screen.getByRole("button", { name: "Bathtime" }));

    expect(screen.getByText("sending…")).toBeTruthy();
    expect(screen.queryByText("confirmed")).toBeNull();
  });

  it("confirms only once applied_gen reaches the command's gen", async () => {
    renderPage();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { gen: 5, action: "start", routine: "bathtime", expires_at: future() },
        202,
      ),
    );
    await click(screen.getByRole("button", { name: "Bathtime" }));

    // The panel has not applied it yet.
    await emitState({
      state: "countdown",
      routine: "bathtime",
      applied_gen: 4,
    });
    expect(screen.getByText("sending…")).toBeTruthy();
    expect(screen.queryByText("confirmed")).toBeNull();

    // Now it has.
    await emitState({
      state: "countdown",
      routine: "bathtime",
      applied_gen: 5,
    });
    expect(screen.getByText("confirmed")).toBeTruthy();
    expect(screen.queryByText("sending…")).toBeNull();
  });

  it("reports a TTL miss honestly, without diagnosing the cause", async () => {
    renderPage();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { gen: 5, action: "start", routine: "bathtime", expires_at: future() },
        202,
      ),
    );
    await click(screen.getByRole("button", { name: "Bathtime" }));

    await act(() => {
      vi.advanceTimersByTime(46_000);
    });

    const text = document.body.textContent;
    expect(text).toContain("the panel didn't answer");
    expect(text).toMatch(/last seen \d+/);
  });

  it("disables the controls while the panel is offline", () => {
    renderPage({ panel: { online: false, last_seen_s: 300 } });
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    expect(document.body.textContent).toContain("panel is offline");
  });

  it("offers Replace instead of a silent switch, focus moved to it", async () => {
    renderPage();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "conflict",
          current_routine: "booktime",
          offers: ["replace"],
        },
        409,
      ),
    );

    await click(screen.getByRole("button", { name: "Bathtime" }));

    expect(document.body.textContent).toContain("is running — start instead?");
    const replace = screen.getByRole("button", { name: "Replace" });
    expect(document.activeElement).toBe(replace);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ gen: 6, action: "cancel", expires_at: future() }, 202),
    );
    await click(replace);
    const [url, options] = fetchMock.mock.calls.at(-1);
    expect(url).toBe("/api/replace");
    expect(JSON.parse(options.body)).toEqual({ routine: "bathtime" });
  });

  it("treats an offline refusal as a caveat, not a success", async () => {
    renderPage();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "panel_offline", last_seen_s: 200 }, 503),
    );
    await click(screen.getByRole("button", { name: "Cleanup" }));
    expect(document.body.textContent).toContain("panel offline");
  });
});

describe("D3 — SSE stream and the polling fallback", () => {
  it("paints from a state frame and ignores unknown frame names", async () => {
    renderPage();
    await act(() => {
      MockEventSource.last.emit("totally-unknown", { data: "{}" });
    });
    await emitState({
      state: "countdown",
      routine: "cleanup",
      remaining_s: 100,
      applied_gen: 2,
    });
    expect(document.body.textContent).toContain("Cleanup");
    expect(document.body.textContent).toContain("1:40");
  });

  it("falls back to a 2 s /api/state poll when the stream errors", async () => {
    renderPage();
    fetchMock.mockResolvedValue(
      jsonResponse(makeSnapshot({ state: "ambient" }), 200),
    );

    await act(() => {
      MockEventSource.last.onerror?.();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/state");

    const callsBefore = fetchMock.mock.calls.filter(
      ([u]) => u === "/api/state",
    ).length;
    await act(() => {
      vi.advanceTimersByTime(2_000);
    });
    const callsAfter = fetchMock.mock.calls.filter(
      ([u]) => u === "/api/state",
    ).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});
