# Traceability audit — galactic-unicorn-remote (NAS service)

**Scope:** audit of `spec/dependency-map.yaml` (ESDD Spec-DAG) against `description.md`, per the
`validate-spec` recipe. Read `description.md` in full, `spec/implementation-considerations.md` §1–§13,
`spec/event-flow.md`, and the two memos' derived constraints (memo v2.4 + stack addendum, stack wins
on stack / bind / `/health`).

**Result:** all five specdag checks exit 0; every goal and success criterion in `description.md`
traces `goal → intent → expectation → verifier` with no unresolved gaps; every artifact/contract `ref`
resolves to a file on disk. One modelling reconciliation was required (contracts cannot source a
`verified_by` edge under `--strict` — see §5).

DAG: 97 nodes (17 intent, 32 expectation, 2 contract, 21 artifact, 9 job, 15 verifier), 146 edges.

---

## 1. Goals → intents

Every goal / success criterion / in-scope capability stated in `description.md` maps to one intent.
Nothing is invented that a memo does not state.

| # | Goal / requirement (description.md) | Intent node |
|---|---|---|
| G1 | Start and cancel bathtime/booktime/cleanup from a phone (§1, §1.2#1) | `intent.remote-countdown-control` |
| G2 | The remote adds no new panel behaviour — a second producer of the four button events (§1, AD-2) | `intent.button-parity` |
| G3 | With the service stopped, every button/countdown on the panel is unchanged (§1.2#2, §13.8) | `intent.panel-independence` |
| G4 | A second, off-tailnet phone via Cloudflare Tunnel gated on her email (§1, §1.1, AD-9/10) | `intent.public-door` |
| G5 | A command during a network dead window fails visibly, never fires late (§1.2#3, AD-6) | `intent.honest-failure` |
| G6 | The UI distinguishes "sent" from "the panel did it" (AD-16, §1.2#1) | `intent.honest-confirmation` |
| G7 | Phone asks replace → cancel → wait ambient → start; never a silent switch (AD-8) | `intent.replace-no-silent-switch` |
| G8 | Reconciliation server: desired state + monotonic `gen`; device reconciles and reports `applied_gen` (§1, AD-3/4/5) | `intent.device-reconciliation` |
| G9 | The server owns cadence via `next_poll_ms`, driven by demand (AD-7, §2 panel) | `intent.server-owned-cadence` |
| G10 | `/health` is a shared contract: HEALTHCHECK, Homepage widget, CI smoke (AD-17, §2 operator/CI) | `intent.health-contract` |
| G11 | CI is Buildkite; CI-only deploy; Watchtower auto-update; publish gates on image smoke (§2, §5, AD-20) | `intent.ci-delivery` |
| G12 | Two authentications, two purposes; plaintext LAN deliberate; never trust the identity header (§1.1, §7, AD-14/15) | `intent.two-door-security` |
| G13 | Container 3000, published `0.0.0.0:3009` so the board's literal dials it (§1.1, §6.1, AD-13) | `intent.lan-reachability` |
| G14 | Every command's outcome is a durable append-only record (event-flow §4, §8) | `intent.audit-outcomes` |
| G15 | No auto-resume after a boot; `gen` re-seeded from `applied_gen+1` (AD-19, R6) | `intent.no-auto-resume` |
| G16 | `routines.json` is the single source of truth for ids/labels (AD-18) | `intent.routines-sot` |
| G17 | One SvelteKit program on Node serves UI + API (§1, AD-12) | `intent.single-program` |

---

## 2. Trace table — goal → intent → expectation → verifier

Every intent has ≥1 expectation; every expectation is verified by ≥1 verifier. No expectation is
orphaned, no verifier verifies nothing (confirmed by `specdag summary`).

| Goal | Intent | Expectation | Verifier(s) |
|---|---|---|---|
| G1 | `intent.remote-countdown-control` | `expectation.routine-start-parity` | `verifier.route-integration`, `verifier.sse-tunnel` |
| G1 | `intent.remote-countdown-control` | `expectation.cancel-is-reset` | `verifier.route-integration` |
| G1/G2 | `intent.remote-countdown-control` | `expectation.four-events-only` | `verifier.event-vocabulary` |
| G2 | `intent.button-parity` | `expectation.no-new-panel-behaviour` | `verifier.event-vocabulary` |
| G2 | `intent.button-parity` | `expectation.routine-inert-during-countdown` | `verifier.event-vocabulary`, `verifier.unit-reconcile` |
| G3 | `intent.panel-independence` | `expectation.panel-works-with-service-dead` | `verifier.panel-off-regression` |
| G3 | `intent.panel-independence` | `expectation.no-inbound-to-board` | `verifier.no-inbound-review` |
| G4 | `intent.public-door` | `expectation.access-email-gate` | `verifier.surface-trust-review` |
| G4 | `intent.public-door` | `expectation.same-ui-both-doors` | `verifier.surface-trust-review` |
| G5 | `intent.honest-failure` | `expectation.ttl-drops-not-queues` | `verifier.unit-reconcile` |
| G5 | `intent.honest-failure` | `expectation.offline-refusal` *(status: partial)* | `verifier.unit-reconcile` |
| G6 | `intent.honest-confirmation` | `expectation.sent-vs-done` | `verifier.sse-tunnel`, `verifier.route-integration` |
| G7 | `intent.replace-no-silent-switch` | `expectation.replace-sequence` | `verifier.unit-reconcile`, `verifier.route-integration` |
| G8 | `intent.device-reconciliation` | `expectation.desired-gen-monotonic` | `verifier.unit-reconcile`, `verifier.gen-reseed-test` |
| G8 | `intent.device-reconciliation` | `expectation.device-reports-observed` | `verifier.route-integration` |
| G8 | `intent.device-reconciliation` | `expectation.headless-timer` | `verifier.unit-reconcile`, `verifier.no-inbound-review` |
| G9 | `intent.server-owned-cadence` | `expectation.demand-driven-cadence` | `verifier.unit-reconcile` |
| G10 | `intent.health-contract` | `expectation.health-json` | `verifier.route-integration`, `verifier.health-smoke` |
| G10 | `intent.health-contract` | `expectation.health-alignment` | `verifier.health-smoke`, `verifier.deployment-review` |
| G11 | `intent.ci-delivery` | `expectation.quality-gates` | `verifier.ci-gates`, `verifier.coverage-threshold` |
| G11 | `intent.ci-delivery` | `expectation.image-smoke-gates-publish` | `verifier.health-smoke` |
| G11 | `intent.ci-delivery` | `expectation.publish-main-amd64` | `verifier.ci-gates` |
| G11 | `intent.ci-delivery` | `expectation.ci-only-deploy` | `verifier.ci-gates` |
| G12 | `intent.two-door-security` | `expectation.access-is-perimeter` | `verifier.surface-trust-review` |
| G12 | `intent.two-door-security` | `expectation.device-token-defence` | `verifier.security-review`, `verifier.route-integration` |
| G12 | `intent.two-door-security` | `expectation.header-not-authz` | `verifier.security-review`, `verifier.surface-trust-review` |
| G12 | `intent.two-door-security` | `expectation.no-secret-logs` | `verifier.security-review` |
| G13 | `intent.lan-reachability` | `expectation.publish-0.0.0.0-3009` | `verifier.deployment-review` |
| G14 | `intent.audit-outcomes` | `expectation.audit-durable-row` | `verifier.schema-lint` |
| G15 | `intent.no-auto-resume` | `expectation.gen-reseed` | `verifier.gen-reseed-test` |
| G16 | `intent.routines-sot` | `expectation.routines-single-source` | `verifier.schema-lint`, `verifier.event-vocabulary` |
| G17 | `intent.single-program` | `expectation.one-program` | `verifier.openapi-conformance`, `verifier.ci-gates` |

---

## 3. Scope-boundary check

`description.md` §3 declares nine items out of scope. The DAG claims **no job** for any of them.
In-scope service/API components that support the out-of-scope work **are** present (the toddler-stripe
pattern: out-of-scope client, in-scope API).

| Out of scope (description §3) | Job in DAG? | In-scope support that IS modelled |
|---|---|---|
| Board firmware internals (`lib/*.py`, `config.py`) | none ✓ | `contract.device-wire` (device-protocols.md), `job.device-poll-endpoint`, `artifact.flow-device-state-machine`, `artifact.domain-models` |
| Board pytest/ruff suite (separate suite) | none ✓ | — (verification of the panel is `verifier.panel-off-regression`, run in the firmware repo/Phase C) |
| `+2 min` / extend | none ✓ | `expectation.four-events-only` pins the vocabulary at four events |
| Duration editing / settings / privilege tiers | none ✓ | `expectation.no-new-panel-behaviour`, `expectation.header-not-authz` |
| Phase-4 orchestrator | none ✓ | — |
| MQTT / phase-3 ambient cards | none ✓ | `artifact.event-flow` records that no broker exists; `expectation.no-inbound-to-board` |
| `cloudflared` / tunnel / Access provisioning | none ✓ | `intent.public-door` + `verifier.surface-trust-review` (behave correctly *behind* the door) |
| NAS address pinning (DHCP/static) | none ✓ | `expectation.publish-0.0.0.0-3009`, `artifact.deployment-targets` |
| Homepage dashboard config | none ✓ | `expectation.health-json` / `health-alignment` (the widget is a consumer of the shared `/health`) |

The single out-of-scope-but-shared surface — **the HTTP contract** (`/device/poll`, JSON shapes,
`gen`, `applied_gen`, `next_poll_ms`, `/health`) — is modelled as first-class contracts:
`contract.device-wire` and `contract.openapi`.

---

## 4. Artifact existence check

Every `artifact`/`contract` `ref` resolves under `spec/` (specdag `validate` enforces this; it passed).
All 23 non-description spec files are represented:

- `topology/component-graph.mmd`, `topology/deployment-targets.md`
- `api/galactic-unicorn-remote-openapi.yaml` (contract), `api/device-protocols.md` (contract)
- `data-architecture/state-layout.json`, `audit-log-schema.sql`, `domain-models.ts`
- `flows/command-round-trip-sequence.md`, `replace-conflict-sequence.md`, `door-routing-sequence.md`,
  `device-desired-state-state-machine.md`, `panel-lifecycle-state-machine.md`
- `ui/design-system.md`, `ui/wireframes/remote-ui.excalidraw`
- `capacity/load-model.md`, `event-flow.md`, `implementation-considerations.md`
- `docs/adr/0001…0007`
- `spec/dependency-map.yaml` itself is the map; `description.md` is the audit source (outside `spec/`).

---

## 5. Gaps found and reconciliations

1. **Contract nodes cannot source a `verified_by` edge (strict rule).** The recipe's shorthand
   "artifact/contract/job → verifier (`verified_by`)" is stricter in the tool: `verified_by` must
   link **artifact/event/job → verifier**; a `contract` may only be a *target*
   (`job → contract` via `consumes`). *Fix:* contracts are consumed by the job that implements them
   (`job.sveltekit-service → contract.openapi`, `job.device-poll-endpoint → contract.device-wire`),
   and the implementing job (or the artifact it derives from) carries the `verified_by` edge to the
   verifier. No expectation lost a verifier and no check was weakened.
2. **Node type field is `type`, not `kind`.** `graph.kind` is separate. Corrected during authoring;
   documented here so the schema is not re-discovered.
3. **`expectation.offline-refusal` is marked `status: partial`** on purpose: the *behaviour* (the
   server refuses to set desired while the panel is offline, memo §5.5) is settled, but the **exact
   offline threshold is open decision O4**. Modelling it as fully `accepted` would over-claim a
   resolved contract that the memos leave open.
4. **Open decisions are not modelled as resolved contracts.** O1–O8 (persistence store, device-token
   transport, SSE fallback shape, offline threshold, server clamp values, exact TTL, surface-trust
   rule, audit retention) appear only as the *artifacts/flows that flag them*; no intent/expectation
   asserts a specific resolution. `contract.device-wire` and `contract.openapi` deliberately carry the
   open items as *open* (e.g. `?token=` is marked a proposal in `api/device-protocols.md`), matching
   `implementation-considerations.md` §11.

5. **Mermaid label safety.** Two titles originally contained double quotes, which `specdag render`
   escapes as `\"` — not valid inside a mermaid quoted label. The titles were reworded so the rendered
   `spec/dependency-map.mmd` contains no escaped quotes and renders cleanly.

No unresolved gaps remain. No goal is missing an intent; no intent lacks an expectation; no
expectation lacks a verifier; no out-of-scope item has a job; no in-scope shared contract is absent.
