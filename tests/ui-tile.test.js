/**
 * The read-only tile — component tests (`@testing-library/svelte`).
 *
 * The tile is the Homepage embed: it must mirror the same state as the remote
 * but expose **no controls at all** (`design-system.md` §9). These tests pin
 * that: the wording matches the remote's, the countdown only shows while
 * counting down, the running routine is the only highlighted chip, and nothing
 * is a button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/svelte";

import Tile from "../src/routes/tile/+page.svelte";
import catalogue from "../src/lib/routines.json";

const ROUTINES = catalogue.routines;

/** A controllable EventSource so tests can drive server frames. */
class MockEventSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.listeners = {};
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
  close() {}
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
  };
}

function renderTile(panel = {}) {
  return render(Tile, { props: { data: { snapshot: makeSnapshot(panel) } } });
}

beforeEach(() => {
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the tile mirrors the remote, read-only", () => {
  it("renders no controls at all", () => {
    renderTile();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the ambient headline and a liveness line", () => {
    renderTile();
    expect(screen.getByText("Ambient")).toBeInTheDocument();
    expect(screen.getByText(/last seen/)).toBeInTheDocument();
  });

  it("shows the routine headline and countdown only while counting down", () => {
    const { container } = renderTile({
      state: "countdown",
      routine: "bathtime",
      remaining_s: 200,
    });
    expect(container.querySelector(".headline").textContent).toBe("Bathtime");
    expect(screen.getByText("Counting down")).toBeInTheDocument();
    expect(container.querySelector(".countdown").textContent).toMatch(
      /^\d+:\d\d$/,
    );
  });

  it("marks only the running routine's chip as active", () => {
    const { container } = renderTile({
      state: "countdown",
      routine: "cleanup",
    });
    const active = container.querySelectorAll(".chip.active");
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("data-routine")).toBe("cleanup");
  });

  it("renders one chip per catalogue routine", () => {
    const { container } = renderTile();
    expect(container.querySelectorAll(".chip")).toHaveLength(ROUTINES.length);
  });

  it("follows the SSE stream", async () => {
    renderTile();
    await act(() => {
      MockEventSource.last.emit("state", {
        data: JSON.stringify({
          type: "state",
          state: makeSnapshot({ state: "handoff", routine: "booktime" }),
        }),
      });
    });
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
});
