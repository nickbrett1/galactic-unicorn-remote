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

/**
 * Read a boolean env var. Only the usual truthy spellings are true: a typo like
 * `POWER_CYCLE_ENABLED=yes-please` must not silently arm a power-cycling
 * watchdog, and it must not silently disable one the operator thinks is on.
 *
 * @param {string} name
 * @param {boolean} fallback
 */
function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
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
  /**
   * How long an idle banner message stays live on the poll. Longer than the
   * command TTL because a message is *content* (it loops while it is up), not a
   * one-shot edge that must not fire late. It is still a server-side construct —
   * the board never compares `expires_at` (`device-protocols.md` §3).
   */
  messageTtlS: readNumber("MESSAGE_TTL_S", 120),
  /** The longest banner message accepted, in characters (`device-protocols.md` §3). */
  messageMaxLen: readNumber("MESSAGE_MAX_LEN", 60),
  /** O4 — the cut-off behind `panel.online` (≈3× the 5 s idle poll). */
  offlineThresholdS: readNumber("OFFLINE_THRESHOLD_S", 15),
  /** O5 — server-side `next_poll_ms` clamp bounds. */
  nextPollMinMs: readNumber("NEXT_POLL_MIN_MS", 1000),
  nextPollMaxMs: readNumber("NEXT_POLL_MAX_MS", 10000),
  /** O1 — append-only JSONL audit log destination. */
  auditLogPath: process.env.AUDIT_LOG_PATH ?? "data/audit.jsonl",
  /**
   * Where `/firmware/*` mirrors from. The board cannot do TLS (the 2026-09-26
   * root-cause memo), so the service fetches the release over HTTPS on its
   * behalf. `releases/latest/download` is the one URL that needs no version —
   * the same property the firmware relied on when it fetched GitHub itself.
   */
  firmwareUpstreamBase:
    process.env.FIRMWARE_UPSTREAM_BASE ??
    "https://github.com/nickbrett1/galactic-unicorn/releases/latest/download",
  /**
   * How long a fetched manifest is trusted before it is re-fetched. The board
   * checks every ~15 minutes, so this only bounds how quickly a new release
   * becomes visible to it; the pack itself is cached by sha256, so a release
   * costs exactly one upstream download. Default 300 s.
   */
  firmwareCacheTtlS: readNumber("FIRMWARE_CACHE_TTL_S", 300),
  /**
   * When set, serve the firmware artifacts from this directory instead of
   * mirroring upstream (the operator escape hatch — "the service serves and
   * packs"). Empty (the default) means mirror the release.
   */
  firmwareLocalDir: process.env.FIRMWARE_LOCAL_DIR ?? "",
  /**
   * The wedge watchdog (`powercycle.js`). Off by default: the monitor is a
   * no-op unless this is set, so importing the module on a build machine arms
   * nothing. Turn it on only where a KASA_HOST is reachable.
   */
  powerCycleEnabled: readBool("POWER_CYCLE_ENABLED", false),
  /** The HS100's LAN address. Required when `powerCycleEnabled`. */
  kasaHost: process.env.KASA_HOST ?? "",
  /** TP-Link's fixed UDP port; overridable only for a test double. */
  kasaPort: readNumber("KASA_PORT", 9999),
  /**
   * Quiet for this long before the panel is judged wedged. Well past the poll
   * cadence and `offlineThresholdS` (15 s), because a cycle costs a reboot: the
   * board's own retries must have had a real chance first. Default 180 s.
   */
  powerCycleStaleS: readNumber("POWER_CYCLE_STALE_S", 180),
  /**
   * Minimum gap between cycles, so a board that is slow to rejoin after a
   * cycle is not cycled again while it is still booting. Default 600 s.
   */
  powerCycleCooldownS: readNumber("POWER_CYCLE_COOLDOWN_S", 600),
  /** Cycles allowed per wedge. Spent, the monitor stops until the panel is back. */
  powerCycleMax: readNumber("POWER_CYCLE_MAX", 2),
  /** How long the relay is held off. Must drop the regulator and the CYW43. */
  powerCycleOffMs: readNumber("POWER_CYCLE_OFF_MS", 5000),
  /** Monitor period. Cheap: one in-memory liveness read unless something is wrong. */
  powerCycleCheckMs: readNumber("POWER_CYCLE_CHECK_MS", 15000),
  /** True for development/test; false in any production run. */
  isDevOrTest,
});
