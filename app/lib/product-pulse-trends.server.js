const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BUCKET_COUNT = 7;

export function buildDatedSignalTrend(events = [], options = {}) {
  const bucketCount = Math.max(3, Number(options.bucketCount || DEFAULT_BUCKET_COUNT));
  const dateField = options.dateField || "createdAt";
  const valueField = options.valueField || "value";
  const minBucketDays = Math.max(1, Number(options.minBucketDays || 1));
  const minBucketMs = minBucketDays * DAY_MS;
  const normalizedEvents = normalizeTrendEvents(events, { dateField, valueField });

  if (!normalizedEvents.length) {
    return {
      values: [],
      buckets: [],
      meta: {
        bucketCount,
        sourceEventCount: 0,
        totalSignalUnits: 0,
        observedDays: 0,
      },
    };
  }

  const eventTimes = normalizedEvents.map((event) => event.time);
  const earliest = Math.min(...eventTimes);
  const latest = Math.max(...eventTimes);
  const observedSpan = Math.max(latest - earliest, 0);
  const shortWindow = observedSpan < bucketCount * minBucketMs;
  const range = shortWindow
    ? buildShortObservedRange(latest, bucketCount, minBucketMs)
    : buildAdaptiveObservedRange(earliest, latest, bucketCount);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    startAt: new Date(range.start + index * range.bucketMs).toISOString(),
    endAt: new Date(range.start + (index + 1) * range.bucketMs).toISOString(),
    value: 0,
  }));

  normalizedEvents.forEach((event) => {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((event.time - range.start) / range.bucketMs)));
    buckets[index].value += event.value;
  });

  const rawValues = buckets.map((bucket) => roundTrendValue(bucket.value));
  const visualValues = buildVisualTrendValues(rawValues, { shortWindow });
  const smoothedValues = smoothTrendValues(visualValues);
  const values = normalizeTrendValues(smoothedValues);

  return {
    values,
    buckets: buckets.map((bucket, index) => ({
      ...bucket,
      rawValue: rawValues[index],
      value: values[index],
    })),
    meta: {
      bucketCount,
      sourceEventCount: normalizedEvents.length,
      totalSignalUnits: roundTrendValue(rawValues.reduce((total, value) => total + value, 0)),
      observedDays: Math.max(1, Math.ceil(observedSpan / DAY_MS)),
      startAt: buckets[0]?.startAt,
      endAt: buckets[buckets.length - 1]?.endAt,
      shortWindow,
    },
  };
}

export function buildRiskTrendFromSignalTrend(signalTrend = [], riskScore = 0, fallbackTrend = []) {
  const values = (Array.isArray(signalTrend) ? signalTrend : []).map(Number).filter((value) => Number.isFinite(value));
  const score = Number(riskScore || 0);
  const max = Math.max(...values, 0);

  if (values.length && max > 0 && score > 0) {
    const floor = Math.min(Math.round(score * 0.18), 18);
    return values.map((value) => clamp(Math.round(floor + (value / max) * (score - floor)), 0, 100));
  }

  return Array.isArray(fallbackTrend) ? fallbackTrend : [];
}

export function buildIssueTrendMap(events = [], options = {}) {
  const issueField = options.issueField || "issueCode";
  const grouped = new Map();

  events.forEach((event) => {
    const issueCode = String(event?.[issueField] || "").trim();
    if (!issueCode) return;
    if (!grouped.has(issueCode)) grouped.set(issueCode, []);
    grouped.get(issueCode).push(event);
  });

  return Object.fromEntries(Array.from(grouped.entries()).map(([issueCode, issueEvents]) => {
    const trend = buildDatedSignalTrend(issueEvents, options);
    return [issueCode, {
      trend: trend.values,
      trendMeta: trend.meta,
    }];
  }));
}

function normalizeTrendEvents(events, { dateField, valueField }) {
  return (Array.isArray(events) ? events : [])
    .map((event) => {
      const time = new Date(event?.[dateField] || event?.createdAt || event?.occurredAt).getTime();
      if (!Number.isFinite(time)) return null;
      return {
        time,
        value: Math.max(Number(event?.[valueField] ?? event?.quantity ?? 1) || 1, 0),
      };
    })
    .filter(Boolean);
}

function buildShortObservedRange(latest, bucketCount, bucketMs) {
  const latestDayStart = startOfUtcDay(latest);
  return {
    start: latestDayStart - (bucketCount - 1) * bucketMs,
    bucketMs,
  };
}

function buildAdaptiveObservedRange(earliest, latest, bucketCount) {
  const end = latest + 1;
  return {
    start: earliest,
    bucketMs: Math.max((end - earliest) / bucketCount, 1),
  };
}

function startOfUtcDay(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function smoothTrendValues(values) {
  if (values.length < 3) return values;
  return values.map((value, index) => {
    const previous = values[index - 1] || 0;
    const next = values[index + 1] || 0;
    return roundTrendValue(previous * 0.18 + value * 0.64 + next * 0.18);
  });
}

function buildVisualTrendValues(values, { shortWindow = false } = {}) {
  if (!shortWindow || values.length < 3) return values;
  const max = Math.max(...values, 0);
  if (max <= 0) return values;
  const firstPositiveIndex = values.findIndex((value) => value > 0);
  if (firstPositiveIndex <= 1) return values;

  return values.map((value, index) => {
    if (value > 0) return value;
    const progress = (index + 1) / (firstPositiveIndex + 1);
    const eased = progress ** 1.65;
    return roundTrendValue(max * 0.08 + max * 0.28 * eased);
  });
}

function normalizeTrendValues(values) {
  const max = Math.max(...values, 0);
  if (max <= 0) return values.map(() => 0);
  return values.map((value) => Math.round((value / max) * 100));
}

function roundTrendValue(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
