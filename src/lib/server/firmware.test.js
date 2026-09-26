/**
 * The `/firmware/*` mirror's unit suite.
 *
 * The board cannot do TLS (2026-09-26 root-cause memo), so the service fetches
 * the release over HTTPS on its behalf and serves it over plain HTTP. What must
 * hold, whatever the source:
 *
 *  - the manifest is what the board gets, byte for byte;
 *  - the pack is only served when it matches the manifest's sha256 — a
 *    corrupted mirror must never look like a 200 to the board;
 *  - upstream being briefly unreachable must not lose a channel we already have
 *    (serve the stale copy), and a cold miss must surface as an error, not a
 *    fabricated one;
 *  - a matching request costs one upstream fetch (the manifest is cached).
 *
 * Everything here stubs `fetch` (upstream mode) or points at a temp directory
 * (`FIRMWARE_LOCAL_DIR`), so no test touches the network.
 */

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const PACK = Buffer.from("PACK-BYTES-\u0000\u0001\u0002-not-really-a-pack");
const MANIFEST = JSON.stringify({
  version: "9.9.9",
  pack: { file: "firmware.pack", sha256: sha256(PACK) },
});

/** Upstream fetch that answers the two artifact names. */
function upstreamFetch({ manifest = MANIFEST, pack = PACK } = {}) {
  return vi.fn(async (url) => {
    const name = String(url).split("/").pop();
    if (name === "manifest.json") {
      return new Response(manifest, { status: 200 });
    }
    if (name === "firmware.pack") {
      return new Response(pack, { status: 200 });
    }
    return new Response("no", { status: 404 });
  });
}

/** Import a fresh copy of the module with the given env applied. */
async function load(env = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./firmware.js");
}

let dirs = [];
async function tempDirWith(files) {
  const dir = await mkdtemp(join(tmpdir(), "firmware-src-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body);
  }
  return dir;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe("upstream mode (the default)", () => {
  it("serves the manifest the upstream returned", async () => {
    vi.stubGlobal("fetch", upstreamFetch());
    const { getFirmwareManifest } = await load({
      FIRMWARE_LOCAL_DIR: "",
      FIRMWARE_UPSTREAM_BASE: "https://example.test/releases/latest/download",
    });

    const body = await getFirmwareManifest();
    expect(body.toString("utf8")).toBe(MANIFEST);
  });

  it("serves the pack when it matches the manifest's sha256", async () => {
    vi.stubGlobal("fetch", upstreamFetch());
    const { getFirmwarePack } = await load({
      FIRMWARE_LOCAL_DIR: "",
      FIRMWARE_UPSTREAM_BASE: "https://example.test/releases/latest/download",
    });

    const pack = await getFirmwarePack("firmware.pack");
    expect(pack.name).toBe("firmware.pack");
    expect(Buffer.compare(pack.body, PACK)).toBe(0);
  });

  it("refuses a pack whose bytes do not match the manifest", async () => {
    // Upstream served a different pack than the manifest describes. We must not
    // hand the board bytes it will reject on its own hash check.
    vi.stubGlobal("fetch", upstreamFetch({ pack: Buffer.from("TAMPERED") }));
    const { getFirmwarePack } = await load({
      FIRMWARE_LOCAL_DIR: "",
      FIRMWARE_UPSTREAM_BASE: "https://example.test/releases/latest/download",
    });

    await expect(getFirmwarePack("firmware.pack")).rejects.toThrow(
      /sha256 mismatch/,
    );
  });

  it("caches the manifest so a check costs one upstream fetch", async () => {
    const fetchMock = upstreamFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { getFirmwareManifest, getFirmwarePack } = await load({
      FIRMWARE_LOCAL_DIR: "",
      FIRMWARE_UPSTREAM_BASE: "https://example.test/releases/latest/download",
    });

    await getFirmwareManifest();
    await getFirmwarePack("firmware.pack");
    await getFirmwarePack("firmware.pack");

    const manifestCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith("manifest.json"),
    );
    expect(manifestCalls).toHaveLength(1);
  });

  it("serves the stale copy when upstream goes away", async () => {
    const fetchMock = upstreamFetch();
    vi.stubGlobal("fetch", fetchMock);
    // TTL 0 so the second read always tries to refresh.
    const { getFirmwareManifest } = await load({
      FIRMWARE_LOCAL_DIR: "",
      FIRMWARE_CACHE_TTL_S: "0",
      FIRMWARE_UPSTREAM_BASE: "https://example.test/releases/latest/download",
    });

    await getFirmwareManifest();
    fetchMock.mockRejectedValue(new Error("upstream down"));

    const body = await getFirmwareManifest();
    expect(body.toString("utf8")).toBe(MANIFEST);
  });

  it("propagates a cold miss (nothing cached)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const { getFirmwareManifest } = await load({
      FIRMWARE_LOCAL_DIR: "",
      FIRMWARE_UPSTREAM_BASE: "https://example.test/releases/latest/download",
    });

    await expect(getFirmwareManifest()).rejects.toThrow(/HTTP 503/);
  });

  it("rejects a manifest with no version", async () => {
    vi.stubGlobal(
      "fetch",
      upstreamFetch({ manifest: JSON.stringify({ pack: {} }) }),
    );
    const { getFirmwareManifest } = await load({
      FIRMWARE_LOCAL_DIR: "",
      FIRMWARE_UPSTREAM_BASE: "https://example.test/releases/latest/download",
    });

    await expect(getFirmwareManifest()).rejects.toThrow(/no version/);
  });

  it("404s (null) a name the manifest does not describe", async () => {
    vi.stubGlobal("fetch", upstreamFetch());
    const { getFirmwarePack } = await load({
      FIRMWARE_LOCAL_DIR: "",
      FIRMWARE_UPSTREAM_BASE: "https://example.test/releases/latest/download",
    });

    expect(await getFirmwarePack("something-else.pack")).toBeNull();
  });
});

describe("local-dir mode (the operator escape hatch)", () => {
  it("serves from disk and never contacts upstream", async () => {
    const dir = await tempDirWith({
      "manifest.json": MANIFEST,
      "firmware.pack": PACK,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getFirmwareManifest, getFirmwarePack, isLocalSource } = await load({
      FIRMWARE_LOCAL_DIR: dir,
    });

    expect(isLocalSource()).toBe(true);
    expect((await getFirmwareManifest()).toString("utf8")).toBe(MANIFEST);
    expect(
      Buffer.compare((await getFirmwarePack("firmware.pack")).body, PACK),
    ).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still verifies the pack sha256 against the manifest", async () => {
    const dir = await tempDirWith({
      "manifest.json": MANIFEST,
      "firmware.pack": Buffer.from("a different pack entirely"),
    });
    const { getFirmwarePack } = await load({ FIRMWARE_LOCAL_DIR: dir });

    await expect(getFirmwarePack("firmware.pack")).rejects.toThrow(
      /sha256 mismatch/,
    );
  });
});
