-- Append-only audit log for galactic-unicorn-remote.
--
-- Source: memo §7.3 — "Desired + observed + gen + a small append-only log of
-- (when, who, action, did-it-land). Cheap, and it answers the two questions
-- that will actually be asked: 'did it work?' and 'did we already start
-- bathtime?'"
--
-- The memos do NOT specify the store (an append-only JSONL file and SQLite are
-- both consistent with "a small append-only log"); this is an OPEN DECISION
-- (description.md §6.4). This DDL pins the COLUMNS and the append-only
-- invariant, which are store-independent. If the file-based option is chosen,
-- each row is one JSON object with these fields.
--
-- It is deliberately NOT a relational store for state: desired/observed/gen are
-- a handful of scalars held by one process (see state-layout.json). This schema
-- exists only for the audit trail.
--
-- The board is single-threaded and a curl loop is the Phase B substitute for it
-- (memo §13), so write volume is trivial — a few rows per command, forever.

CREATE TABLE IF NOT EXISTS audit_log (
    -- Monotonic per row. Ordering within a process; the log is not an ordering
    -- primitive across the wire, only a record.
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Wall-clock at write. Recorded on the SERVER, for the audit trail only —
    -- nothing in the reconciliation model depends on time except the TTL
    -- (memo §5.1).
    at              TEXT    NOT NULL,          -- ISO-8601, UTC

    -- WHO. On the public door this is the Cloudflare Access email, for display
    -- and audit ONLY — it is never an authorisation input unless the Access JWT
    -- is verified, because the same app is reachable on the LAN and the tailnet
    -- where nothing strips a forged header (memo §8.3). Use NULL for the
    -- device poll and for tailnet/LAN requests.
    actor_email     TEXT,

    -- Which surface the request arrived through: 'tunnel' | 'tailnet' | 'lan'
    -- | 'device'. Mirrors StateSnapshot.door.kind.
    door            TEXT    NOT NULL
                    CHECK (door IN ('tunnel','tailnet','lan','device','server')),

    -- WHAT was attempted. 'start' | 'cancel' | 'replace' | 'none' for commands;
    -- device rows use 'poll' / 'boot' / 'applied' events.
    action          TEXT    NOT NULL,

    -- The routine, when the action carries one.
    routine         TEXT    CHECK (routine IN ('bathtime','booktime','cleanup','reset')),

    -- The desired-state counter this action produced or observed. NULL for
    -- purely observational rows.
    gen             INTEGER,

    -- DID IT LAND. This is the column that answers "did it work?", so it must
    -- distinguish accepted-not-done from done (memo §9.1).
    outcome         TEXT    NOT NULL
                    CHECK (outcome IN (
                        'accepted',      -- desired set; awaiting the board (NOT done)
                        'applied',       -- board reported applied_gen >= gen
                        'expired',       -- TTL elapsed with no applied_gen advance
                        'refused_offline', -- refused before setting anything (memo §5.5)
                        'conflict',      -- offered replace; nothing set
                        'noop',          -- already true / cancelling from ambient
                        'shadowed'       -- superseded by a newer command
                    )),

    -- The board's gen high-water mark at the time of the row, so "did we
    -- already start bathtime?" is answerable from the log alone.
    applied_gen     INTEGER,

    -- What the board last reported, and when — recorded because the panel's
    -- failure to answer may be a HEAP problem, not a network one, and "the poll
    -- failed" must be diagnosable rather than guessed at (memo §9.1, §11.15).
    panel_last_seen_s     INTEGER,
    panel_state_reported  TEXT,               -- 'ambient'|'prompt'|'countdown'|'handoff'

    -- Free-form, already human-rendered context for the next person. NEVER put a
    -- token or a credential in here (memo §10).
    detail          TEXT
);

-- Read patterns: "the recent trail" and "the trail for a routine / gen". Both
-- are tiny-table scans; a single index on `at` is enough.
CREATE INDEX IF NOT EXISTS idx_audit_at      ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_routine ON audit_log (routine, at DESC);

-- Append-only: enforced by policy in code (INSERT and SELECT only). No UPDATE,
-- no DELETE — except for the OPEN retention/rotation decision (description.md
-- §6.4), which, if implemented, must be a bounded prune, never a mutation of a
-- row.

-- Boot-id changes are logged here (memo §5.6), which informally makes this
-- service the panel's health monitor (memo §12.5):
--   action='boot', detail='boot id changed 9f3c1a22 -> 71ab04de'
