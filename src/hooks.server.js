/**
 * `hooks.server.js` — B7. Surface trust and the routing guard.
 *
 * The service is reachable through three doors: the Cloudflare tunnel (public,
 * Access-gated), the tailnet (no auth), and the LAN (the board + a local
 * browser). The door kind is attached to `event.locals.door` and used for
 * **display and audit only** (`StateSnapshot.door`, the audit `door` column).
 *
 * Hard rules (memo §8.3; `plan §11`):
 *  - `Cf-Access-Authenticated-User-Email` is NEVER an authorisation input. It is
 *    display/audit only. There are no privilege tiers for it to gate, which is
 *    what makes the identity-header trap inert.
 *  - The server must not itself add a public path to `/device/*` or `/health`;
 *    they stay LAN-only and are never routed by the tunnel (enforced at the
 *    tunnel ingress, A3).
 *  - Never log a secret. (The email may be logged.)
 *
 * O7 (pending ratification): the minimal v1 rule below derives the door kind from
 * the *presence* of the Access headers. Full JWT verification against Cloudflare's
 * Access certs is an explicit deferral — see the deferral note below. Nothing is
 * ever granted on the strength of the header.
 */

import { config, assertRuntimeConfig } from "./lib/server/config.js";

/** Hostname of a request URL, lower-cased, or null when unparseable. */
function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify a request's door. Pure and side-effect free so it is trivially testable.
 *
 * @param {Request} request
 * @returns {{kind: 'tunnel' | 'tailnet' | 'lan', email: string | null}}
 */
export function classifyDoor(request) {
  const email = request.headers.get("cf-access-authenticated-user-email");
  const jwt = request.headers.get("cf-access-jwt-assertion");

  // Presence of either Access header means the request came through the tunnel.
  // NOTE (O7 deferral): the email here is display/audit only. Verifying the JWT
  // against Cloudflare's Access certs is a deliberate later step; it would add
  // cert-rotation machinery for zero authorisation benefit, because no tier
  // depends on it.
  if (jwt || email) {
    return { kind: "tunnel", email: email ?? null };
  }

  const host = hostOf(request.url);
  if (host && (host.endsWith(".ts.net") || host === "nas")) {
    return { kind: "tailnet", email: null };
  }

  return { kind: "lan", email: null };
}

/**
 * Runs once when the server starts (not during build analysis). Fail fast: the
 * device token is a NAS environment value, never a committed default (§7.5).
 */
export function init() {
  assertRuntimeConfig(config);
}

/**
 * Deferral note (O7): verifying `Cf-Access-Jwt-Assertion` against Cloudflare's
 * Access certs is deliberately NOT done in v1. The header is never an
 * authorisation input; nothing here grants a capability from it.
 *
 * @type {import('@sveltejs/kit').Handle}
 */
export async function handle({ event, resolve }) {
  event.locals.door = classifyDoor(event.request);
  return resolve(event);
}
