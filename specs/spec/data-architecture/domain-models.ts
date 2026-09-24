/**
 * Core serialization types for galactic-unicorn-remote (SvelteKit 5 / Node).
 *
 * This is the TypeScript face of the wire contract in `api/device-protocols.md`
 * (the board's side of it) and of the browser API in
 * `api/galactic-unicorn-remote-openapi.yaml`. It is a design artefact: the
 * implementing phase may place it as `src/lib/types.ts` (or split it into
 * `src/lib/server/*` and a shared client module) — the split is not fixed here.
 *
 * Nothing in this file is shared with the firmware repo. The board's Python has
 * no schema module, no shared test vector, and nothing but the HTTP wire format
 * in common (stack-memo §1). That is deliberate and load-bearing: it is why the
 * service could move from FastAPI to SvelteKit with no firmware change.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Routine ids. `routines.json` is the single source of truth for ids AND labels (memo §12). */
export type RoutineId = 'bathtime' | 'booktime' | 'cleanup';

/** The four events the remote can produce — it mimics the buttons and nothing else (memo §3). */
export type DeviceEvent = RoutineId | 'reset';

/** The panel's own state machine states, as REPORTED BY THE BOARD. The server never invents them. */
export type PanelState = 'ambient' | 'prompt' | 'countdown' | 'handoff';

/** The action carried in the desired-state slot. `none` is a valid, idempotent no-op. */
export type DesiredAction = 'start' | 'cancel' | 'none';

/** Which door a request arrived through — for display and audit, never authorisation (memo §8.3). */
export type DoorKind = 'tunnel' | 'tailnet' | 'lan';

/** A routine as exposed to the UI, sourced from `routines.json`. */
export interface Routine {
  id: RoutineId;
  /** e.g. "Cleanup" for id `cleanup` — never hard-coded in a component. */
  label: string;
  /** The panel's symbol artwork — the only identity channel on both surfaces (duck / book / toy-box). */
  symbol: string;
}

// ---------------------------------------------------------------------------
// The two slots (memo §5.1) — one writer per direction (memo §2)
// ---------------------------------------------------------------------------

/**
 * The DESIRED-state slot. Written only by a browser command; read only by the
 * device poll. The server holds a mirror, not a clock (memo §5.3) — nothing in
 * here is a countdown.
 */
export interface Desired {
  /** Monotonic counter both sides agree on. The board ignores anything <= its applied_gen. */
  gen: number;
  action: DesiredAction;
  routine?: RoutineId;
  /** Server epoch seconds at which this slot is dropped. ~45 s from set (memo §5.4). */
  expires_at: number;
}

/**
 * The OBSERVED-state slot. Written only by the device poll; read only by the UI
 * and the audit log. These are exactly the fields the board reports.
 */
export interface Observed {
  /** Opaque boot id, new on every panel boot. A change clears pending desired (memo §5.6). */
  boot: string;
  fw: string;
  /** Highest gen the board has applied, persisted to its flash. */
  applied_gen: number;
  state: PanelState;
  routine?: RoutineId;
  /** The BOARD's own countdown (ticks_ms-based), relayed verbatim. Never recomputed here (memo §5.3). */
  remaining_s?: number;
  rssi?: number;
  uptime_s?: number;
}

/**
 * Liveness, derived from the poll itself — "last seen Ns ago" IS the poll
 * (memo §4). Free, and the input to the "sent vs done" rule (memo §9.1).
 */
export interface PanelLiveness {
  online: boolean;
  last_seen_s: number;
  /** OPEN DECISION: the offline cut-off (description.md §6.4). */
  threshold_s?: number;
}

// ---------------------------------------------------------------------------
// Browser API (OpenAPI: galactic-unicorn-remote-openapi.yaml)
// ---------------------------------------------------------------------------

export interface StateSnapshot {
  /** Observed ∪ Liveness. */
  panel: Observed & PanelLiveness;
  desired: Desired;
  routines: Routine[];
  door?: { kind: DoorKind; email: string | null };
}

/**
 * A command was ACCEPTED, not done. The UI must not present this as success;
 * it goes "sending…" → confirmed only when the device reports the new
 * applied_gen (memo §9.1).
 */
export interface DesiredAck {
  gen: number;
  action: DesiredAction;
  routine?: RoutineId;
  expires_at?: number;
  ttl_s?: number;
}

/** Returned when a different routine is already counting down. Nothing was set. */
export interface Conflict {
  error: 'conflict';
  current_routine: RoutineId;
  /** The UI shows the conflict and offers replace explicitly. Never a silent switch (memo §5.5). */
  offers: Array<'replace'>;
}

/** Returned when the panel is offline: the UI refuses BEFORE setting anything (memo §5.5). */
export interface PanelOffline {
  error: 'panel_offline';
  last_seen_s: number;
}

export interface ApiError {
  error: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Device wire (the SHARED contract — api/device-protocols.md)
// ---------------------------------------------------------------------------

/** What the board sends, as parsed from the GET query string. */
export interface DevicePollReport {
  token: string;
  boot: string;
  fw: string;
  applied_gen: number;
  state: PanelState;
  routine?: RoutineId;
  remaining_s?: number;
  rssi?: number;
  uptime_s?: number;
}

/** What the server answers: desired state AND the cadence (memo §5.1, §6.3.5). */
export interface DevicePollResponse {
  gen: number;
  action: DesiredAction;
  routine?: RoutineId;
  /** ~5000 idle, ~2000 on demand. Server-generated and clamped. */
  next_poll_ms: number;
}

// ---------------------------------------------------------------------------
// SSE frames (see event-flow.md)
// ---------------------------------------------------------------------------

export type SseEventName = 'state' | 'audit';

export interface SseStateFrame {
  type: 'state';
  state: StateSnapshot;
}

export interface SseAuditFrame {
  type: 'audit';
  seq: number;
  at: string;
  action: string;
  routine?: RoutineId;
  outcome: AuditOutcome;
}

export type SseFrame = SseStateFrame | SseAuditFrame;

export type AuditOutcome =
  | 'accepted'
  | 'applied'
  | 'expired'
  | 'refused_offline'
  | 'conflict'
  | 'noop'
  | 'shadowed';

// ---------------------------------------------------------------------------
// The pure functions this repo owns and tests (vitest; stack-memo §5)
//
// Signatures are illustrative — the implementing phase may reshape them — but
// the SET of decisions is not optional: these are the `gen`, TTL, conflict and
// cadence rules the memos settle (memo §5.5, §6.3.5), and the reason the
// service's suite exists at all.
// ---------------------------------------------------------------------------

/** `applied_gen <= g` is ignored by the board; used to decide what to apply/confirm. */
export type IsGenApplied = (applied_gen: number, gen: number) => boolean;

/** A fresh server must never sit below the board's high-water mark (memo §5.1). */
export type ReseedGen = (reportedAppliedGen: number) => number;

/** Desired is dropped, never queued, on expiry (memo §5.4). */
export type IsExpired = (desired: Desired, nowEpochS: number) => boolean;

/** The conflict table of memo §5.5, as a decision function. */
export type ResolveCommand = (input: {
  requested: DesiredAction | 'replace';
  routine?: RoutineId;
  panel: Observed & PanelLiveness;
}) =>
  | { kind: 'set'; action: DesiredAction; routine?: RoutineId }
  | { kind: 'noop'; reason: 'already_running' | 'nothing_to_cancel' }
  | { kind: 'conflict'; current_routine: RoutineId }
  | { kind: 'refuse_offline'; last_seen_s: number };

/** Demand-driven cadence (memo §6.3.5). */
export type NextPollMs = (input: {
  pendingApply: boolean;
  activeCountdown: boolean;
  subscribers: number;
}) => number;
