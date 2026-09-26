/**
 * The firmware artifacts, served to the board over plain HTTP.
 *
 * **Why this exists** (2026-09-26 root-cause memo): the board cannot complete a
 * TLS handshake. Measured on the board, DNS and `TCP:443` are fine and plain
 * HTTP works even to the internet, but every HTTPS attempt either fails
 * instantly as `OSError(12,)` or blocks long enough to trip the hardware
 * watchdog and hard-reset the board. The firmware's update check used to fetch
 * `releases/latest/download/manifest.json` from GitHub — HTTPS — so it could
 * never read a manifest at all: the board's own `update.log` had zero
 * occurrences of the then-latest version and 103 occurrences of "no update: the
 * old version is already running". It had never once seen a manifest.
 *
 * **The shape of the fix**: stop making the one device that cannot do TLS the
 * device that must. The service — which has a working TLS stack — fetches the
 * release over HTTPS on the board's behalf, verifies it, and serves
 * `manifest.json` and the pack over plain HTTP under `/firmware/*`. The board
 * then talks only to the host it already talks to every second for the poll
 * (`http://192.168.1.2:3009`). No new trust is placed in the LAN: the manifest
 * still carries a sha256 for the pack and one per file, and the board verifies
 * both before anything reaches the live tree (`lib/updater.py`), exactly as it
 * did when GitHub was the source.
 *
 * **Two sources, one interface.** With `FIRMWARE_LOCAL_DIR` unset (the default)
 * this mirrors the upstream release. With it set, the artifacts are read from
 * that directory instead and upstream is never contacted — the operator escape
 * hatch for shipping a pack without a GitHub release (and what makes "the
 * service serves and packs" true without a second moving part: point it at a
 * directory of packed artifacts).
 *
 * The upstream fetch is cached (see `FIRMWARE_CACHE_TTL_S`) and a stale copy is
 * served if upstream is briefly unreachable, so a GitHub blip cannot turn into a
 * failed update check on the panel.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { config } from "./config.js";

/** The fixed name the board asks for, and the one the updater derives its base from. */
export const MANIFEST_NAME = "manifest.json";

/** Default pack name when the manifest does not say (it always does). */
const DEFAULT_PACK_NAME = "firmware.pack";

/** In-process caches. A single container, so no cross-process sharing is needed. */
let manifestCache = null; // { at: number, body: Buffer, json: object, stale?: boolean }
let packCache = null; // { sha: string, name: string, body: Buffer }
let manifestPending = null; // in-flight fetch, so a burst of polls is one upstream call
let packPending = null;

/** Test seam: forget everything cached. */
export function resetFirmwareCache() {
  manifestCache = null;
  packCache = null;
  manifestPending = null;
  packPending = null;
}

/** True when the artifacts are read from disk rather than mirrored from upstream. */
export function isLocalSource() {
  return Boolean(config.firmwareLocalDir);
}

function upstreamUrl(name) {
  const base = config.firmwareUpstreamBase.replace(/\/+$/, "");
  return `${base}/${name}`;
}

/**
 * Fetch one artifact from upstream over HTTPS. Follows the GitHub
 * `releases/latest/download/...` redirect to the asset.
 *
 * @param {string} name
 * @returns {Promise<Buffer>}
 */
async function fetchUpstream(name) {
  const response = await fetch(upstreamUrl(name), { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`upstream ${name}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function readLocal(name) {
  return readFile(join(config.firmwareLocalDir, name));
}

function parseManifest(body) {
  const json = JSON.parse(body.toString("utf8"));
  if (!json || typeof json !== "object" || typeof json.version !== "string") {
    throw new Error("manifest has no version");
  }
  return json;
}

/**
 * The manifest, from cache while fresh, else from the configured source.
 *
 * A failed upstream refresh with a cached copy present returns the cached copy
 * (`stale: true`) rather than failing: the panel must not lose its update
 * channel to a GitHub blip. Only a cold miss propagates the error.
 *
 * @returns {Promise<{body: Buffer, json: object, stale?: boolean}>}
 */
async function loadManifest() {
  const fresh =
    manifestCache &&
    Date.now() - manifestCache.at < config.firmwareCacheTtlS * 1000;
  if (fresh) return manifestCache;
  if (manifestPending) return manifestPending;

  manifestPending = (async () => {
    try {
      const body = isLocalSource()
        ? await readLocal(MANIFEST_NAME)
        : await fetchUpstream(MANIFEST_NAME);
      const json = parseManifest(body);
      manifestCache = { at: Date.now(), body, json };
      return manifestCache;
    } catch (err) {
      if (manifestCache) return { ...manifestCache, stale: true };
      throw err;
    } finally {
      manifestPending = null;
    }
  })();
  return manifestPending;
}

/**
 * The manifest body, exactly as it will be served to the board.
 *
 * @returns {Promise<Buffer>}
 */
export async function getFirmwareManifest() {
  return (await loadManifest()).body;
}

/**
 * The pack named by the manifest, verified against the manifest's sha256.
 *
 * @param {string} [name] the file the board asked for; must match the manifest
 * @returns {Promise<{body: Buffer, name: string} | null>} null when `name` is
 *   not the pack the manifest describes — the route turns that into a 404.
 */
export async function getFirmwarePack(name) {
  const manifest = await loadManifest();
  const described = manifest.json.pack ?? {};
  const packName = described.file ?? DEFAULT_PACK_NAME;
  if (name && name !== packName) return null;

  if (
    packCache &&
    packCache.sha === described.sha256 &&
    packCache.name === packName
  ) {
    return packCache;
  }
  if (packPending) return packPending;

  packPending = (async () => {
    try {
      const body = isLocalSource()
        ? await readLocal(packName)
        : await fetchUpstream(packName);
      const sha = createHash("sha256").update(body).digest("hex");
      if (described.sha256 && sha !== described.sha256) {
        // Refuse to serve bytes that do not match the manifest: the board would
        // download them, reject them on its own hash check and stay put, and we
        // would have hidden a corrupted mirror behind a 200.
        throw new Error(
          `pack sha256 mismatch: served ${sha}, manifest says ${described.sha256}`,
        );
      }
      packCache = { sha, name: packName, body };
      return packCache;
    } finally {
      packPending = null;
    }
  })();
  return packPending;
}
