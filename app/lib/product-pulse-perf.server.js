const PERF_LOG_ENV = "PRODUCT_PULSE_PERF_LOGS_ENABLED";
const DEFAULT_SLOW_MS = 500;

export function createProductPulsePerfLogger(name, context = {}) {
  const enabled = process.env[PERF_LOG_ENV] !== "false";
  const startedAt = nowMs();
  let previousAt = startedAt;
  const marks = [];

  const logger = {
    mark(stage, data = {}) {
      if (!enabled) return;
      const currentAt = nowMs();
      marks.push({
        stage,
        deltaMs: roundMs(currentAt - previousAt),
        totalMs: roundMs(currentAt - startedAt),
        ...getMemorySnapshot(),
        ...data,
      });
      previousAt = currentAt;
    },
    done(data = {}) {
      if (!enabled) return;
      const totalMs = roundMs(nowMs() - startedAt);
      const payload = {
        name,
        totalMs,
        ...getMemorySnapshot(),
        ...sanitizeContext(context),
        ...data,
        marks,
      };
      const method = totalMs >= Number(process.env.PRODUCT_PULSE_PERF_SLOW_MS || DEFAULT_SLOW_MS)
        ? "warn"
        : "info";
      console[method]("[product-pulse-perf]", payload);
    },
    fail(error, data = {}) {
      if (!enabled) return;
      console.error("[product-pulse-perf]", {
        name,
        totalMs: roundMs(nowMs() - startedAt),
        ...getMemorySnapshot(),
        ...sanitizeContext(context),
        ...data,
        error: error instanceof Error ? error.message : String(error || "unknown_error"),
        marks,
      });
    },
  };

  return logger;
}

export async function measureProductPulseStep(perf, stage, callback, data = {}) {
  const startedAt = nowMs();
  try {
    return await callback();
  } finally {
    perf?.mark(stage, {
      durationMs: roundMs(nowMs() - startedAt),
      ...data,
    });
  }
}

function sanitizeContext(context = {}) {
  return {
    route: context.route,
    shop: context.shop,
  };
}

function getMemorySnapshot() {
  const memory = process.memoryUsage();
  return {
    heapUsedMb: toMb(memory.heapUsed),
    heapTotalMb: toMb(memory.heapTotal),
    rssMb: toMb(memory.rss),
    externalMb: toMb(memory.external),
  };
}

function nowMs() {
  return performance.now();
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function toMb(value) {
  return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
}
