/**
 * `GET /firmware/[file]` — the route over the mirror.
 *
 * The route is the boundary the board actually meets, so this exercises the
 * handler (not the mirror directly): the shape check must short-circuit before
 * any fetch, the two artifact names must be served with plain cacheless
 * headers, and every failure must be an honest non-200 rather than a body the
 * board would only discover was wrong after downloading it.
 */

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../routes/firmware/[file]/+server.js";
import { resetFirmwareCache } from "./firmware.js";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const PACK = Buffer.from("PACK-BYTES");
const MANIFEST = JSON.stringify({
  version: "9.9.9",
  pack: { file: "firmware.pack", sha256: sha256(PACK) },
});

function call(file) {
  return GET({ params: { file } });
}

function upstreamFetch({ manifest = MANIFEST, pack = PACK } = {}) {
  return vi.fn(async (url) => {
    const name = String(url).split("/").pop();
    if (name === "manifest.json")
      return new Response(manifest, { status: 200 });
    if (name === "firmware.pack") return new Response(pack, { status: 200 });
    return new Response("no", { status: 404 });
  });
}

beforeEach(() => {
  // The route shares the mirror's in-process cache; each case starts cold.
  resetFirmwareCache();
  vi.stubEnv("FIRMWARE_LOCAL_DIR", "");
  vi.stubEnv(
    "FIRMWARE_UPSTREAM_BASE",
    "https://example.test/releases/latest/download",
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /firmware/[file]", () => {
  it("serves the manifest as JSON, uncached", async () => {
    vi.stubGlobal("fetch", upstreamFetch());
    const res = await call("manifest.json");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(MANIFEST);
  });

  it("serves the pack as octet-stream", async () => {
    vi.stubGlobal("fetch", upstreamFetch());
    const res = await call("firmware.pack");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("PACK-BYTES");
  });

  it("404s an unknown name without touching upstream", async () => {
    const fetchMock = upstreamFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("secrets.txt");

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s a path-traversal attempt (single segment only)", async () => {
    const fetchMock = upstreamFetch();
    vi.stubGlobal("fetch", fetchMock);
    // SvelteKit would not route a slash into [file], but the shape check is the
    // guarantee we own: reject anything that is not a bare *.pack name.
    const res = await call("..%2fmanifest.json");

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s a pack the manifest does not name", async () => {
    vi.stubGlobal("fetch", upstreamFetch());
    const res = await call("older.pack");

    expect(res.status).toBe(404);
  });

  it("502s when upstream is unreachable and nothing is cached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    );
    const res = await call("manifest.json");

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("firmware_unavailable");
  });

  it("502s a pack that fails its sha256 rather than serving it", async () => {
    vi.stubGlobal("fetch", upstreamFetch({ pack: Buffer.from("TAMPERED") }));
    const res = await call("firmware.pack");

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("firmware_unavailable");
  });
});
