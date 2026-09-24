/**
 * Tiny response helper. Every route validates its input and never echoes it back
 * (`implementation-considerations §7.7`, R19) — so responses here carry only
 * server-authored fields.
 */

/**
 * @param {unknown} body
 * @param {number} [status]
 * @returns {Response}
 */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
