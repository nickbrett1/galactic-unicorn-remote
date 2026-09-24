import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@testing-library/jest-dom/vitest";

// Tests must run locally without secrets (the real DEVICE_TOKEN is a NAS
// environment value in Doppler). config.js reads these at import time, so they
// are set here, before any test module is loaded.
process.env.DEVICE_TOKEN ??= "test-device-token";
process.env.DESIRED_TTL_S ??= "45";
process.env.OFFLINE_THRESHOLD_S ??= "15";
process.env.NEXT_POLL_MIN_MS ??= "1000";
process.env.NEXT_POLL_MAX_MS ??= "10000";

// Never write the audit log into the repo during tests.
process.env.AUDIT_LOG_PATH ??= join(
  mkdtempSync(join(tmpdir(), "gur-test-audit-")),
  "audit.jsonl",
);
