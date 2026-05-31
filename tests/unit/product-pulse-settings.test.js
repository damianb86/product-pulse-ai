import { describe, expect, it } from "vitest";
import { PRODUCT_PULSE_CUSTOM_HTML_STYLE_PRESET } from "../../app/lib/product-pulse-html-style-presets";
import {
  getQuickScanMinimumRiskScore,
  getQuickScanMinimumMomentumScore,
  getAnalysisLookbackDays,
  getRiskLabelForScore,
  getStatusLabelForScore,
  normalizeProductPulseSettings,
  validateProductPulseSettings,
} from "../../app/lib/product-pulse-settings.server";

describe("ProductPulse settings", () => {
  it("normalizes default settings", () => {
    const settings = normalizeProductPulseSettings();

    expect(settings.risk).toEqual({
      minimumScore: 18,
      mediumThreshold: 55,
      highThreshold: 75,
    });
    expect(settings.momentum).toEqual({ minimumScore: 70 });
    expect(settings.diagnosis).toBeUndefined();
    expect(settings.analysis.lookbackDays).toBe(60);
    expect(settings.htmlStyle).toEqual({ preset: "productpulse-current", customTemplate: "" });
  });

  it("uses custom risk thresholds for labels and status", () => {
    const settings = normalizeProductPulseSettings({
      risk: {
        minimumScore: 40,
        mediumThreshold: 60,
        highThreshold: 82,
      },
      momentum: {
        minimumScore: 76,
      },
    });

    expect(getQuickScanMinimumRiskScore(settings)).toBe(40);
    expect(getQuickScanMinimumMomentumScore(settings)).toBe(76);
    expect(getAnalysisLookbackDays(settings)).toBe(60);
    expect(getRiskLabelForScore(59, settings)).toBe("Low");
    expect(getRiskLabelForScore(60, settings)).toBe("Medium");
    expect(getRiskLabelForScore(82, settings)).toBe("High");
    expect(getStatusLabelForScore(82, false, settings)).toBe("Needs attention");
  });

  it("clamps saved thresholds to the configured minimums", () => {
    const settings = normalizeProductPulseSettings({
      risk: {
        minimumScore: 0,
        mediumThreshold: 20,
        highThreshold: 80,
      },
      momentum: {
        minimumScore: 12,
      },
    });

    expect(settings.risk.minimumScore).toBe(10);
    expect(settings.momentum.minimumScore).toBe(50);
    expect(getQuickScanMinimumRiskScore(settings)).toBe(10);
    expect(getQuickScanMinimumMomentumScore(settings)).toBe(50);
  });

  it("rejects invalid risk threshold ordering", () => {
    expect(validateProductPulseSettings({
      risk: {
        minimumScore: 9,
        mediumThreshold: 60,
        highThreshold: 90,
      },
    })).toMatch(/between 10 and 90/);

    expect(validateProductPulseSettings({
      risk: {
        minimumScore: 70,
        mediumThreshold: 65,
        highThreshold: 90,
      },
    })).toMatch(/Medium risk/);

    expect(validateProductPulseSettings({
      risk: {
        minimumScore: 40,
        mediumThreshold: 70,
        highThreshold: 65,
      },
    })).toMatch(/High risk/);
  });

  it("rejects invalid momentum inclusion thresholds", () => {
    expect(validateProductPulseSettings({
      risk: {
        minimumScore: 40,
        mediumThreshold: 60,
        highThreshold: 80,
      },
      momentum: {
        minimumScore: 49,
      },
    })).toMatch(/between 50 and 100/);

    expect(validateProductPulseSettings({
      risk: {
        minimumScore: 40,
        mediumThreshold: 60,
        highThreshold: 80,
      },
      momentum: {
        minimumScore: 101,
      },
    })).toMatch(/Sales Momentum inclusion/);
  });

  it("normalizes and validates the analysis lookback window", () => {
    const settings = normalizeProductPulseSettings({
      analysis: { lookbackDays: 500 },
    });

    expect(settings.analysis.lookbackDays).toBe(365);
    expect(validateProductPulseSettings({
      risk: {
        minimumScore: 40,
        mediumThreshold: 60,
        highThreshold: 80,
      },
      analysis: {
        lookbackDays: 4,
      },
    })).toMatch(/Analysis lookback/);
  });

  it("normalizes and validates HTML injection style settings", () => {
    const settings = normalizeProductPulseSettings({
      htmlStyle: {
        preset: PRODUCT_PULSE_CUSTOM_HTML_STYLE_PRESET,
        customTemplate: "<section {{ATTRIBUTES}}><h3>{{TITLE}}</h3>{{CONTENT_HTML}}</section>",
      },
    });

    expect(settings.htmlStyle).toEqual({
      preset: PRODUCT_PULSE_CUSTOM_HTML_STYLE_PRESET,
      customTemplate: "<section {{ATTRIBUTES}}><h3>{{TITLE}}</h3>{{CONTENT_HTML}}</section>",
    });
    expect(validateProductPulseSettings({
      risk: { minimumScore: 40, mediumThreshold: 60, highThreshold: 80 },
      htmlStyle: {
        preset: PRODUCT_PULSE_CUSTOM_HTML_STYLE_PRESET,
        customTemplate: "<section>No replacement marker</section>",
      },
    })).toMatch(/CONTENT_HTML/);
  });
});
