# ADR 0006 — browser sync is SSE with a 2 s polling fallback

- **Status:** accepted
- **Date:** 2026-09-24
- **Decider:** design phase (galactic-unicorn-remote)
- **Source:** memo §0, §8, §11.8; stack-memo §2

## Context

The browser must show a live mirror of the panel (state, routine, remaining time, liveness) plus the
honest "sent vs done" states. The panel itself is the source of truth and polls the server; the
browser needs to see what the panel reported. Options: polling only, WebSockets, or SSE.

## Decision

**SSE** for browser ↔ server sync (`GET /api/events`), with a **2 s polling fallback** that is
**indistinguishable to the user** if SSE misbehaves. The device ↔ server channel remains the device's
own poll response (it is not a push channel).

## Rationale

- The traffic is **one-directional server → browser**: the browser never needs to push a stream back,
  and its writes are four ordinary `POST`s. SSE is the lighter fit — it is plain HTTP, it traverses
  the Cloudflare tunnel without a protocol upgrade, and it needs no handshake library.
- A live subscriber count is a **cadence input**: "someone is watching" drops `next_poll_ms` to 2 s,
  so opening the page itself is the signal of intent (memo §6.3.5). That count must come from a live
  subscriber, not from "a page was loaded" (memo §11.7).
- WebSockets would buy bidirectional messaging the UI does not need and add framing/keepalive work on
  both ends.
- A fallback is mandatory because SSE through a proxy can misbehave; the UI must degrade without the
  user noticing, and it re-syncs from `GET /api/state`.

## Consequences

- **Must be implemented carefully** (memo §11.7):
  - `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`;
  - a comment heartbeat every ~15 s (proxied connections idle out around 100 s);
  - the SvelteKit route returns a `ReadableStream` and **`adapter-node` must not buffer it**
    (stack-memo §2);
  - **tested through the tunnel early, in Phase D**.
- **The stream is not a source of truth:** a client that misses frames re-syncs from `/api/state`, and
  unknown frame names must be ignored rather than errored (forward compatibility).
- **Follow-on:** whether the fallback polls `GET /api/state` as-is or a compact route is an **open
  decision** (implementation-considerations §11 O3).
