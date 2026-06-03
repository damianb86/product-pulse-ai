const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

const DEFAULT_JOB_LEASE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_JOB_HEARTBEAT_MS = 60 * 1000;
const DEFAULT_WORKER_IDLE_SLEEP_MS = 5 * 1000;
const DEFAULT_WORKER_MAX_JOBS_PER_CYCLE = 1;

export function getProductPulseResourceConfig(env = process.env) {
  const leaseTtlMs = getIntegerEnv(env.PRODUCT_PULSE_JOB_LEASE_TTL_MS, {
    defaultValue: DEFAULT_JOB_LEASE_TTL_MS,
    min: 60_000,
    max: 60 * 60 * 1000,
  });
  const heartbeatMs = getIntegerEnv(env.PRODUCT_PULSE_JOB_HEARTBEAT_MS, {
    defaultValue: DEFAULT_JOB_HEARTBEAT_MS,
    min: 10_000,
    max: Math.max(10_000, Math.floor(leaseTtlMs / 2)),
  });

  return {
    inlineWorkersEnabled: getBooleanEnv(env.PRODUCT_PULSE_INLINE_WORKERS_ENABLED, true),
    workerIdleSleepMs: getIntegerEnv(env.PRODUCT_PULSE_WORKER_IDLE_SLEEP_MS, {
      defaultValue: DEFAULT_WORKER_IDLE_SLEEP_MS,
      min: 1_000,
      max: 5 * 60 * 1000,
    }),
    workerMaxJobsPerCycle: getIntegerEnv(env.PRODUCT_PULSE_WORKER_MAX_JOBS_PER_CYCLE, {
      defaultValue: DEFAULT_WORKER_MAX_JOBS_PER_CYCLE,
      min: 1,
      max: 10,
    }),
    jobLeaseTtlMs: leaseTtlMs,
    jobHeartbeatMs: heartbeatMs,
  };
}

export function getBooleanEnv(value, defaultValue = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (BOOLEAN_TRUE_VALUES.has(normalized)) return true;
  if (BOOLEAN_FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
}

function getIntegerEnv(value, { defaultValue, min, max }) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}
