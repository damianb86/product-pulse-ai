import { describe, expect, it } from "vitest";
import {
  buildDatedSignalTrend,
  buildIssueTrendMap,
  buildRiskTrendFromSignalTrend,
} from "../../app/lib/product-pulse-trends.server";

describe("ProductPulse trend modeling", () => {
  it("builds an adaptive trend from the actual dated signal range", () => {
    const trend = buildDatedSignalTrend([
      { createdAt: "2026-05-01T12:00:00.000Z", value: 4 },
      { createdAt: "2026-05-04T12:00:00.000Z", value: 1 },
      { createdAt: "2026-05-07T12:00:00.000Z", value: 5 },
    ]);

    expect(trend.values).toHaveLength(7);
    expect(trend.meta.sourceEventCount).toBe(3);
    expect(trend.values[0]).toBeGreaterThan(trend.values[3]);
    expect(trend.values[6]).toBeGreaterThan(trend.values[3]);
    expect(trend.meta.observedDays).toBe(6);
  });

  it("creates a gentle recent rise when all evidence is fresh", () => {
    const trend = buildDatedSignalTrend([
      { createdAt: "2026-05-12T09:00:00.000Z", value: 6 },
    ]);

    expect(trend.values[0]).toBeGreaterThan(0);
    expect(trend.values.slice(1).every((value, index) => value >= trend.values[index])).toBe(true);
    expect(trend.values[5]).toBeGreaterThan(trend.values[4]);
    expect(trend.values[6]).toBe(100);
    expect(trend.meta.shortWindow).toBe(true);
  });

  it("keeps issue trends isolated by issue code", () => {
    const trends = buildIssueTrendMap([
      { createdAt: "2026-05-01T12:00:00.000Z", value: 1, issueCode: "fit_sizing" },
      { createdAt: "2026-05-07T12:00:00.000Z", value: 3, issueCode: "fit_sizing" },
      { createdAt: "2026-05-04T12:00:00.000Z", value: 5, issueCode: "quality_defect" },
    ]);

    expect(trends.fit_sizing.trend).toHaveLength(7);
    expect(trends.quality_defect.trend).toHaveLength(7);
    expect(trends.fit_sizing.trend).not.toEqual(trends.quality_defect.trend);
  });

  it("scales risk trend from observed signal pressure instead of a flat baseline", () => {
    const riskTrend = buildRiskTrendFromSignalTrend([0, 15, 100, 20, 80], 84);

    expect(riskTrend).toEqual([15, 25, 84, 29, 70]);
  });
});
