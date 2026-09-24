/**
 * Runtime configuration — read from the environment, with the plan's §11
 * recommended defaults baked in as *defaults* (never as a committed secret).
 *
 * Fail-fast rule (`implementation-considerations §7.5`, AD-14): the device token
 * is a **NAS environment value**, never a committed default. In a non-dev,
 * non-test run the process refuses to start without `DEVICE_TOKEN`. In
 * development/test the token is empty and every `/device/poll` is refused (401),
 * so no committed default can ever become a working credential.
 *
 * Open decisions embodied (pending ratification):
 *  - **O1** — `AUDIT_LOG_PATH`: in-memory state + an append-only JSONL audit file.
 *  - **O4** — `OFFLINE_THRESHOLD_S = 15`.
 *  - **O5** — `NEXT_POLL_MIN_MS = 1000`, `NEXT_POLL_MAX_MS = 10000`.
 *  - **O6** — `DESIRED_TTL_S = 45`.
 */

const env = process.env.NODE_ENV ?? "development";
/** Dev and test may run without a token; every other run must supply one. */
const isDevOrTest = env === "development" || env === "test";

/**
 * Read a finite numeric env var, falling back to the documented default.
 * @param {string} name
 * @param {number} fallback
 */
function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const deviceToken = process.env.DEVICE_TOKEN ?? "";

/**
 * Fail-fast guard, called from the server's `init` hook (when the process
 * actually starts serving) — NOT at module import, because SvelteKit's
 * post-build analysis imports these modules and a build must not require a
 * runtime secret.
 *
 * @param {{deviceToken: string, isDevOrTest: boolean}} [cfg]
 */
export function assertRuntimeConfig(cfg = config) {
  if (!cfg.deviceToken && !cfg.isDevOrTest) {
    throw new Error(
      "DEVICE_TOKEN is not set. It is a NAS environment value (Doppler common/dev|prd), " +
        "never a committed default. See .env.example; set it before starting the service.",
    );
  }
  return cfg;
}

/** Frozen runtime configuration. */
export const config = Object.freeze({
  /** Shared LAN-only device token (defence in depth; never a real boundary). */
  deviceToken,
  /** O6 — pending desired state is dropped after this many seconds (memo §5.4). */
  desiredTtlS: readNumber("DESIRED_TTL_S", 45),
  /** O4 — the cut-off behind `panel.online` (≈3× the 5 s idle poll). */
  offlineThresholdS: readNumber("OFFLINE_THRESHOLD_S", 15),
  /** O5 — server-side `next_poll_ms` clamp bounds. */
  nextPollMinMs: readNumber("NEXT_POLL_MIN_MS", 1000),
  nextPollMaxMs: readNumber("NEXT_POLL_MAX_MS", 10000),
  /** O1 — append-only JSONL audit log destination. */
  auditLogPath: process.env.AUDIT_LOG_PATH ?? "data/audit.jsonl",
  /** True for development/test; false in any production run. */
  isDevOrTest,
});
