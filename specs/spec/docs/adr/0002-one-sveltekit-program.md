# ADR 0002 — the frontend and the API are one SvelteKit program

- **Status:** accepted
- **Date:** 2026-09-24
- **Decider:** design phase (galactic-unicorn-remote)
- **Source:** memo §0, §7.1; stack-memo §1, §2

## Context

Phase 2's service could have been a separate API (the v1.5 design implied FastAPI/Python) with a
separate frontend artefact mounted and served by it. The default conventions do not require that
split, but the stack guidance treats a web frontend and a backend service as distinct concerns.

## Decision

**One SvelteKit 5 program on Node** (`@sveltejs/adapter-node`) serves both the UI and the API, as
`+server.js` endpoints. There is **no separate frontend build artefact** and **no separate API
framework**.

## Rationale

The device contract is purely HTTP and the firmware shares **no code, no schema module and no test
vector** with the server. With nothing shared, the only real argument for Python was "the board is
MicroPython, so one language is nice" — and it buys nothing when the two never share a line. Once it
is gone:

- the app and the API are one program in one language;
- `adapter-node` is the well-trodden deployment path for a container;
- one toolchain in the devcontainer instead of two.

The `svelte`-vs-`sveltekit` question was never independent: it follows from who owns the server. Once
Node owns the server you *want* the server routes, SSR is moot behind a tunnel, and SvelteKit is the
natural fit.

## Consequences

- **Positive:** no artefact skew between the page and the feed it parses; one place to add a route;
  one language for the service's tests.
- **Negative:** the board is Python and the service is Node, so there are **two languages in the
  project**. Nothing is shared, so nothing has to be kept in sync — but it is a real thing to know
  when moving between the two repos.
- **Boundary:** SSE must be a route returning a `ReadableStream`, and `adapter-node` must not buffer
  it (memo §11.7; stack-memo §2).
