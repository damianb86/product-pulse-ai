import { describe, expect, it } from "vitest";
import {
  getQuickScanMinimumRiskScore,
  getRiskLabelForScore,
  getStatusLabelForScore,
  normalizeProductPulseSettings,
  validateProductPulseSettings,
} from "../../app/lib/product-pulse-settings.server";

describe("ProductPulse settings", () => {
  it("normalizes default settings", () => {
    const settings = normalizeProductPulseSettings();

    expect(settings.risk).toEqual({
      minimumScore: 50,
      mediumThreshold: 55,
      highThreshold: 75,
    });
    expect(settings.diagnosis.maxQueuedPerSubmission).toBe(25);
  });

  it("uses custom risk thresholds for labels and status", () => {
    const settings = normalizeProductPulseSettings({
      risk: {
        minimumScore: 40,
        mediumThreshold: 60,
        highThreshold: 82,
      },
    });

    expect(getQuickScanMinimumRiskScore(settings)).toBe(40);
    expect(getRiskLabelForScore(59, settings)).toBe("Low");
    expect(getRiskLabelForScore(60, settings)).toBe("Medium");
    expect(getRiskLabelForScore(82, settings)).toBe("High");
    expect(getStatusLabelForScore(82, false, settings)).toBe("Needs attention");
  });

  it("rejects invalid risk threshold ordering", () => {
    expect(validateProductPulseSettings({
      risk: {
        minimumScore: 70,
        mediumThreshold: 65,
        highThreshold: 90,
      },
      diagnosis: {
        maxQueuedPerSubmission: 10,
      },
    })).toMatch(/Medium risk/);

    expect(validateProductPulseSettings({
      risk: {
        minimumScore: 40,
        mediumThreshold: 70,
        highThreshold: 65,
      },
      diagnosis: {
        maxQueuedPerSubmission: 10,
      },
    })).toMatch(/High risk/);
  });
});
