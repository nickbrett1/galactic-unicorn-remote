# ADR 0005 — plaintext HTTP on the LAN is deliberate

- **Status:** accepted
- **Date:** 2026-09-24
- **Decider:** design phase (galactic-unicorn-remote)
- **Source:** memo §10; memo §6.2

## Context

The default conventions, and the decision order for ambiguity (**security first**), bias toward
encrypting traffic in transit. The board's link to the NAS could be TLS.

## Decision

The **board ↔ NAS link is plaintext HTTP**, deliberately. No TLS between the panel and the service.
**Do not describe any of this as secure.**

## Rationale

- **1.5 s of TLS per poll to protect "start bathtime" on a home network is a bad trade.** TLS on a
  Pico W costs handshake time on every poll, and the poll has a tight budget that must not endanger a
  frame of an active countdown (memo §6.3).
- The project has already made the same call for its OTA updater (`CERT_NONE`), so this is consistent
  rather than novel.
- The asset is worth almost nothing: the payload is a routine name, and anyone on the LAN could start
  a countdown by pressing the physical button (memo §10).
- The security posture is carried elsewhere: **Cloudflare Access** is the public perimeter, the
  **scope decision** (start/cancel only, no privilege tiers, nothing that can read files or reach a
  shell) means there is nothing worth stealing, and the **device token** is defence in depth so that a
  future routing mistake is not immediately exploitable.

## Consequences

- **Positive:** minimal board-side cost; no certificate lifecycle on a microcontroller; the poll stays
  well inside its time budget.
- **Negative:** traffic on the home LAN is readable and the device token is not confidential to
  anyone who can sniff the LAN. Explicitly accepted.
- **Guard:** the token is **never** in the OTA pack, never a committed default, and never logged —
  this repo is public, so the device token is a **NAS environment value** (implementation-
  considerations §7.5).
- **Where TLS *is* used:** the public door (HTTPS at the Cloudflare edge). Only the LAN hop is
  plaintext.
