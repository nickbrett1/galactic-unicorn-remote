/**
 * `GET /firmware/[file]` — the board's update channel, over plain HTTP.
 *
 * Serves `manifest.json` and the pack the manifest names. This is not part of
 * the device protocol (`api/device-protocols.md`): the board does not poll it,
 * it fetches it on its own slow timer. It is here because **the board cannot do
 * TLS** (2026-09-26 root-cause memo), so the service terminates HTTPS for it and
 * speaks plain HTTP on the LAN — the one transport this board has ever got to
 * work. See `src/lib/server/firmware.js` for the full reasoning.
 *
 * LAN-only in intent, exactly like `/device/poll`: the board reaches it at
 * `http://192.168.1.2:3009/firmware/*` and never through the tunnel. `[file]`
 * is a single path segment, so it cannot traverse; anything other than the two
 * artifact names the manifest describes is a 404.
 *
 * No token. The firmware artifacts are public on GitHub today, and the board's
 * update path has never carried a credential — adding one here would mean a
 * firmware change (and a USB deploy) to use it, for no gain. Exposure is
 * therefore the same as the public release this mirrors.
 */

import {
  getFirmwareManifest,
  getFirmwarePack,
  MANIFEST_NAME,
} from "../../../lib/server/firmware.js";
import { jsonResponse } from "../../../lib/server/http.js";

/** A pack name we will even consider looking up: one segment, no traversal. */
const PACK_NAME = /^[A-Za-z0-9._-]+\.pack$/;

/** Plain, cacheless headers: the board has no cache and must always see the current release. */
function artifactHeaders(contentType) {
  return {
    "content-type": contentType,
    // The board re-checks every ~15 minutes and the content changes only when a
    // release is cut; caching it in a proxy would only delay a firmware update.
    "cache-control": "no-store",
  };
}

function notFound() {
  return jsonResponse(
    { error: "not_found", detail: "unknown firmware artifact" },
    404,
  );
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ params }) {
  const file = params.file;
  // Cheap shape check first: a wrong name must not cost an upstream fetch.
  if (file !== MANIFEST_NAME && !PACK_NAME.test(file)) return notFound();

  try {
    if (file === MANIFEST_NAME) {
      const body = await getFirmwareManifest();
      return new Response(body, {
        headers: artifactHeaders("application/json"),
      });
    }

    const pack = await getFirmwarePack(file);
    if (!pack) return notFound();
    return new Response(pack.body, {
      headers: artifactHeaders("application/octet-stream"),
    });
  } catch (err) {
    // Upstream unreachable and nothing cached, or a pack that failed its
    // sha256. Never a 200 with a body the board would reject: report it, keep
    // the board on its current firmware, and let the next check try again.
    return jsonResponse(
      { error: "firmware_unavailable", detail: err?.message ?? String(err) },
      502,
    );
  }
}
