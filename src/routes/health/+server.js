// Health check endpoint used by the container HEALTHCHECK and Homepage widget.
// The body is JSON, not a bare "ok": Homepage's `customapi` widget parses it
// as JSON, so a plain-text reply makes the dashboard tile error.
export function GET() {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
