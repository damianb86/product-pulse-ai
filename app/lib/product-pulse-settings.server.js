import prisma from "../db.server";
import { invalidateProductPulseDashboardAndAnalyticsCache } from "./product-pulse-cache.server";
import {
  PRODUCT_PULSE_DEFAULT_HTML_STYLE_PRESET,
  normalizeProductPulseHtmlStyle,
  validateProductPulseHtmlStyle,
} from "./product-pulse-html-style-presets";

export const PRODUCT_PULSE_SETTINGS_SOURCE_KEY = "__productpulse_settings";
export const PRODUCT_PULSE_MIN_LOOKBACK_DAYS = 10;
export const PRODUCT_PULSE_MAX_LOOKBACK_DAYS = 365;
export const PRODUCT_PULSE_MIN_RISK_THRESHOLD = 10;
export const PRODUCT_PULSE_MIN_MOMENTUM_THRESHOLD = 50;
export const PRODUCT_PULSE_BATCH_MODE_COOLDOWN_HOURS = 24;
export const PRODUCT_PULSE_BATCH_MODE_COOLDOWN_MS = PRODUCT_PULSE_BATCH_MODE_COOLDOWN_HOURS * 60 * 60 * 1000;

export const DEFAULT_PRODUCT_PULSE_SETTINGS = {
  risk: {
    minimumScore: 18,
    mediumThreshold: 55,
    highThreshold: 75,
  },
  momentum: {
    minimumScore: 70,
  },
  analysis: {
    lookbackDays: 60,
  },
  htmlStyle: {
    preset: PRODUCT_PULSE_DEFAULT_HTML_STYLE_PRESET,
    customTemplate: "",
  },
  processing: {
    batchMode: {
      strategy: "auto_when_out_of_credits",
      active: false,
      activatedAt: null,
      lastFreeBatchDiagnosisAt: null,
      nextFreeBatchDiagnosisAt: null,
      lastFreeBatchJobId: null,
      lastFreeBatchProductGid: null,
      cooldownHours: PRODUCT_PULSE_BATCH_MODE_COOLDOWN_HOURS,
    },
  },
};

export async function getProductPulseSettings(shop) {
  if (!shop) return normalizeProductPulseSettings();
  const record = await prisma.productPulseSource.findUnique({
    where: {
      shop_sourceKey: {
        shop,
        sourceKey: PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
      },
    },
  });

  return normalizeProductPulseSettings(record?.config);
}

export async function updateProductPulseSettings(shop, formData) {
  const parsed = parseSettingsFormData(formData);
  const currentSettings = await getProductPulseSettings(shop);
  const validation = validateProductPulseSettings(parsed);
  if (validation) {
    return {
      status: "validation_error",
      message: validation,
      settings: normalizeProductPulseSettings(parsed),
    };
  }

  const settings = normalizeProductPulseSettings({
    ...parsed,
    processing: currentSettings.processing,
  });
  await prisma.productPulseSource.upsert({
    where: {
      shop_sourceKey: {
        shop,
        sourceKey: PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
      },
    },
    create: {
      shop,
      sourceKey: PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
      category: "settings",
      name: "ProductPulse Settings",
      connected: true,
      active: true,
      available: true,
      health: "configured",
      coverageWeight: 0,
      config: settings,
    },
    update: {
      connected: true,
      active: true,
      available: true,
      health: "configured",
      config: settings,
    },
  });
  invalidateProductPulseDashboardAndAnalyticsCache(shop);

  return {
    status: "success",
    message: "Settings saved.",
    settings,
    action: { id: "save-product-pulse-settings" },
    invalidateDashboardCache: true,
  };
}

export function normalizeProductPulseSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const risk = source.risk && typeof source.risk === "object" ? source.risk : {};
  const momentum = source.momentum && typeof source.momentum === "object" ? source.momentum : {};
  const analysis = source.analysis && typeof source.analysis === "object" ? source.analysis : {};
  const htmlStyle = source.htmlStyle && typeof source.htmlStyle === "object" ? source.htmlStyle : {};
  const processing = source.processing && typeof source.processing === "object" ? source.processing : {};

  const minimumScore = clampInteger(
    risk.minimumScore,
    PRODUCT_PULSE_MIN_RISK_THRESHOLD,
    90,
    DEFAULT_PRODUCT_PULSE_SETTINGS.risk.minimumScore,
  );
  const mediumThreshold = clampInteger(
    risk.mediumThreshold,
    minimumScore + 1,
    95,
    Math.max(DEFAULT_PRODUCT_PULSE_SETTINGS.risk.mediumThreshold, minimumScore + 1),
  );
  const highThreshold = clampInteger(
    risk.highThreshold,
    mediumThreshold + 1,
    100,
    Math.max(DEFAULT_PRODUCT_PULSE_SETTINGS.risk.highThreshold, mediumThreshold + 1),
  );

  return {
    risk: {
      minimumScore,
      mediumThreshold,
      highThreshold,
    },
    momentum: {
      minimumScore: clampInteger(
        momentum.minimumScore,
        PRODUCT_PULSE_MIN_MOMENTUM_THRESHOLD,
        100,
        DEFAULT_PRODUCT_PULSE_SETTINGS.momentum.minimumScore,
      ),
    },
    analysis: {
      lookbackDays: clampInteger(
        analysis.lookbackDays,
        PRODUCT_PULSE_MIN_LOOKBACK_DAYS,
        PRODUCT_PULSE_MAX_LOOKBACK_DAYS,
        DEFAULT_PRODUCT_PULSE_SETTINGS.analysis.lookbackDays,
      ),
    },
    htmlStyle: normalizeProductPulseHtmlStyle(htmlStyle),
    processing: normalizeProductPulseProcessingSettings(processing),
  };
}

export function normalizeProductPulseProcessingSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const batchMode = source.batchMode && typeof source.batchMode === "object" ? source.batchMode : {};
  const defaults = DEFAULT_PRODUCT_PULSE_SETTINGS.processing.batchMode;
  return {
    batchMode: {
      strategy: "auto_when_out_of_credits",
      active: Boolean(batchMode.active),
      activatedAt: optionalIsoString(batchMode.activatedAt) || defaults.activatedAt,
      lastFreeBatchDiagnosisAt: optionalIsoString(batchMode.lastFreeBatchDiagnosisAt) || defaults.lastFreeBatchDiagnosisAt,
      nextFreeBatchDiagnosisAt: optionalIsoString(batchMode.nextFreeBatchDiagnosisAt) || defaults.nextFreeBatchDiagnosisAt,
      lastFreeBatchJobId: optionalString(batchMode.lastFreeBatchJobId) || defaults.lastFreeBatchJobId,
      lastFreeBatchProductGid: optionalString(batchMode.lastFreeBatchProductGid) || defaults.lastFreeBatchProductGid,
      cooldownHours: PRODUCT_PULSE_BATCH_MODE_COOLDOWN_HOURS,
    },
  };
}

export function getProductPulseBatchModeSummary(settings = {}, pointBalance = null, now = new Date()) {
  const normalizedSettings = normalizeProductPulseSettings(settings);
  const configured = normalizedSettings.processing.batchMode;
  const availableCredits = Number(pointBalance?.available ?? pointBalance?.balance ?? 0);
  const outOfCredits = Number.isFinite(availableCredits) ? availableCredits < 1 : false;
  const activatedAt = configured.activatedAt || (outOfCredits ? toIso(now) : null);
  const lastFreeBatchDiagnosisAt = configured.lastFreeBatchDiagnosisAt || null;
  const nextFreeBatchDiagnosisAt = lastFreeBatchDiagnosisAt
    ? toIso(new Date(new Date(lastFreeBatchDiagnosisAt).getTime() + PRODUCT_PULSE_BATCH_MODE_COOLDOWN_MS))
    : null;
  const nextDate = nextFreeBatchDiagnosisAt ? new Date(nextFreeBatchDiagnosisAt) : null;
  const canStartFreeBatchAnalysis = outOfCredits && (!nextDate || nextDate.getTime() <= now.getTime());

  return {
    strategy: configured.strategy,
    active: outOfCredits,
    reason: outOfCredits ? "out_of_credits" : "credits_available",
    availableCredits: Number.isFinite(availableCredits) ? availableCredits : 0,
    activatedAt,
    cooldownHours: PRODUCT_PULSE_BATCH_MODE_COOLDOWN_HOURS,
    lastFreeBatchDiagnosisAt,
    nextFreeBatchDiagnosisAt,
    canStartFreeBatchAnalysis,
    lastFreeBatchJobId: configured.lastFreeBatchJobId || null,
    lastFreeBatchProductGid: configured.lastFreeBatchProductGid || null,
    message: outOfCredits
      ? "ProductPulse is letting this store run Product Diagnosis without credits through the free Batch queue. These no-charge analyses do not consume credits, but only one can be started every 24 hours and results may take up to 24 hours to complete."
      : "",
  };
}

export function withProductPulseBatchModeSummary(pointSummary, settings = {}, now = new Date()) {
  if (!pointSummary) return pointSummary;
  return {
    ...pointSummary,
    batchMode: getProductPulseBatchModeSummary(settings, pointSummary.balance, now),
  };
}

export function parseSettingsFormData(formData) {
  return {
    risk: {
      minimumScore: formDataNumber(formData, "minimumScore"),
      mediumThreshold: formDataNumber(formData, "mediumThreshold"),
      highThreshold: formDataNumber(formData, "highThreshold"),
    },
    momentum: {
      minimumScore: formDataNumber(formData, "momentumMinimumScore"),
    },
    analysis: {
      lookbackDays: formDataNumber(formData, "analysisLookbackDays"),
    },
    htmlStyle: {
      preset: String(formData.get("htmlStylePreset") || "").trim(),
      customTemplate: String(formData.get("htmlStyleCustomTemplate") || "").trim(),
    },
  };
}

export function validateProductPulseSettings(input = {}) {
  const risk = input.risk || {};
  const momentum = input.momentum || {};
  const analysis = input.analysis || {};
  const htmlStyle = input.htmlStyle || {};
  const minimumScore = Number(risk.minimumScore);
  const mediumThreshold = Number(risk.mediumThreshold);
  const highThreshold = Number(risk.highThreshold);
  const momentumMinimumScore = Number(momentum.minimumScore ?? DEFAULT_PRODUCT_PULSE_SETTINGS.momentum.minimumScore);
  const lookbackDays = Number(analysis.lookbackDays ?? DEFAULT_PRODUCT_PULSE_SETTINGS.analysis.lookbackDays);

  if (![minimumScore, mediumThreshold, highThreshold].every(Number.isFinite)) {
    return "Risk thresholds must be valid numbers.";
  }
  if (minimumScore < PRODUCT_PULSE_MIN_RISK_THRESHOLD || minimumScore > 90) {
    return `Minimum Catalog Scan score must be between ${PRODUCT_PULSE_MIN_RISK_THRESHOLD} and 90.`;
  }
  if (mediumThreshold <= minimumScore) {
    return "Medium risk must start above the minimum Catalog Scan score.";
  }
  if (highThreshold <= mediumThreshold) {
    return "High risk must start above medium risk.";
  }
  if (highThreshold > 100) {
    return "High risk threshold cannot be higher than 100.";
  }
  if (
    !Number.isFinite(momentumMinimumScore)
    || momentumMinimumScore < PRODUCT_PULSE_MIN_MOMENTUM_THRESHOLD
    || momentumMinimumScore > 100
  ) {
    return `Sales Momentum inclusion threshold must be between ${PRODUCT_PULSE_MIN_MOMENTUM_THRESHOLD} and 100.`;
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays < PRODUCT_PULSE_MIN_LOOKBACK_DAYS || lookbackDays > PRODUCT_PULSE_MAX_LOOKBACK_DAYS) {
    return `Analysis lookback must be between ${PRODUCT_PULSE_MIN_LOOKBACK_DAYS} and ${PRODUCT_PULSE_MAX_LOOKBACK_DAYS} days.`;
  }
  const htmlStyleValidation = validateProductPulseHtmlStyle(htmlStyle);
  if (htmlStyleValidation) return htmlStyleValidation;

  return "";
}

export function getRiskLabelForScore(score, settings) {
  const risk = normalizeProductPulseSettings(settings).risk;
  if (score >= risk.highThreshold) return "High";
  if (score >= risk.mediumThreshold) return "Medium";
  return "Low";
}

export function getRiskToneForScore(score, settings) {
  const risk = normalizeProductPulseSettings(settings).risk;
  if (score >= risk.highThreshold) return "critical";
  if (score >= risk.mediumThreshold) return "warning";
  return "success";
}

export function getRiskFilterValueForScore(score, settings) {
  return getRiskLabelForScore(score, settings).toLowerCase();
}

export function getStatusLabelForScore(score, resolved = false, settings) {
  if (resolved) return "Resolved";
  const risk = normalizeProductPulseSettings(settings).risk;
  if (score >= risk.highThreshold) return "Needs attention";
  if (score >= risk.mediumThreshold) return "Monitor";
  return "Good";
}

export function getStatusFilterValueForScore(score, resolved = false, settings) {
  if (resolved) return "resolved";
  const risk = normalizeProductPulseSettings(settings).risk;
  if (score >= risk.highThreshold) return "needs-attention";
  if (score >= risk.mediumThreshold) return "monitor";
  return "good";
}

export function getQuickScanMinimumRiskScore(settings) {
  return normalizeProductPulseSettings(settings).risk.minimumScore;
}

export function getQuickScanMinimumMomentumScore(settings) {
  return normalizeProductPulseSettings(settings).momentum.minimumScore;
}

export function getAnalysisLookbackDays(settings) {
  return normalizeProductPulseSettings(settings).analysis.lookbackDays;
}

function formDataNumber(formData, key) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : undefined;
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function optionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function optionalIsoString(value) {
  const normalized = optionalString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
