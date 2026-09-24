# ADR 0003 — the service binds `0.0.0.0:3009`, and is deliberately LAN-exposed

- **Status:** accepted
- **Date:** 2026-09-24
- **Decider:** design phase (galactic-unicorn-remote)
- **Source:** memo §7.1, §7.5; stack-memo §4

## Context

The house pshelf convention binds services **loopback-only** (`127.0.0.1:<port>:3000`) because only
the Cloudflare tunnel and the tailnet need to reach them. Applying that convention here would be a
mistake: **a Pico W on the LAN is a real client with no Tailscale.**

Design memo v2.4's first draft (§8.1/§8.5) said to bind the NAS LAN IP
(`192.168.1.2:3009`). The stack addendum corrected this.

## Decision

The container listens on **`3000`** (`adapter-node`'s default) and is published as
**`0.0.0.0:3009:3000`** — LAN-exposed, **not** loopback, and **not pinned to a single interface**.
Surfaces are split by **policy and routing**, not by interface.

## Rationale

- Only the LAN can reach it either way, so naming one interface buys nothing — and it **breaks at
  container start if the NAS's lease ever moves**, which is exactly the fragility the memo's §12.12
  is about.
- The deliberate intent is preserved: **this service cannot be loopback-only**, because the board has
  no Tailscale.
- Splitting by policy rather than interface is what makes `/device/*` and `/health` LAN-only while
  `/` and `/api/*` are public — and only `/` and `/api/*` are routed by the tunnel (memo §8.4).

## Consequences

- **Positive:** the board reaches the service on a plain LAN address; no per-interface fragility when
  the NAS's lease moves; one bind for all three populations.
- **Negative:** the service is reachable from anywhere on the home LAN. Accepted: anyone on the LAN
  could press the physical button anyway, and the scope is start/cancel only (memo §10). The
  **device token** is defence in depth, not a boundary.
- **What is still pinned (and is a separate obligation):** the **NAS's address** — DHCP reservation
  or DSM static IP for `192.168.1.2` — because the board's `config.py` dials
  `http://192.168.1.2:3009` as a literal. This is a router/DSM change, not a bind change
  (memo §11.12).
- **Regression guard:** never "correct" this back to `127.0.0.1`. A regeneration that omits the
  `docker-container` configuration falls back to `publishPort: "3000:3000"` — also wrong, because it
  loses the 3009 mapping the board and the Homepage href depend on (stack-memo §8). See
  implementation-considerations §8.
