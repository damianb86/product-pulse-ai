import prisma from "../db.server";

export const PRODUCT_PULSE_SETTINGS_SOURCE_KEY = "__productpulse_settings";
export const PRODUCT_PULSE_MAX_QUEUED_DIAGNOSES = 500;

export const DEFAULT_PRODUCT_PULSE_SETTINGS = {
  risk: {
    minimumScore: 18,
    mediumThreshold: 55,
    highThreshold: 75,
  },
  diagnosis: {
    maxQueuedPerSubmission: 25,
    useOpenAiBatchForDiagnostics: false,
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
  const validation = validateProductPulseSettings(parsed);
  if (validation) {
    return {
      status: "validation_error",
      message: validation,
      settings: normalizeProductPulseSettings(parsed),
    };
  }

  const settings = normalizeProductPulseSettings(parsed);
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

  return {
    status: "success",
    message: "Settings saved.",
    settings,
  };
}

export function normalizeProductPulseSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const risk = source.risk && typeof source.risk === "object" ? source.risk : {};
  const diagnosis = source.diagnosis && typeof source.diagnosis === "object" ? source.diagnosis : {};

  const minimumScore = clampInteger(risk.minimumScore, 0, 90, DEFAULT_PRODUCT_PULSE_SETTINGS.risk.minimumScore);
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
    diagnosis: {
      maxQueuedPerSubmission: clampInteger(
        diagnosis.maxQueuedPerSubmission,
        1,
        PRODUCT_PULSE_MAX_QUEUED_DIAGNOSES,
        DEFAULT_PRODUCT_PULSE_SETTINGS.diagnosis.maxQueuedPerSubmission,
      ),
      useOpenAiBatchForDiagnostics: Boolean(diagnosis.useOpenAiBatchForDiagnostics),
    },
  };
}

export function parseSettingsFormData(formData) {
  return {
    risk: {
      minimumScore: formDataNumber(formData, "minimumScore"),
      mediumThreshold: formDataNumber(formData, "mediumThreshold"),
      highThreshold: formDataNumber(formData, "highThreshold"),
    },
    diagnosis: {
      maxQueuedPerSubmission: formDataNumber(formData, "maxQueuedPerSubmission"),
      useOpenAiBatchForDiagnostics: String(formData.get("useOpenAiBatchForDiagnostics") || "") === "on",
    },
  };
}

export function validateProductPulseSettings(input = {}) {
  const risk = input.risk || {};
  const diagnosis = input.diagnosis || {};
  const minimumScore = Number(risk.minimumScore);
  const mediumThreshold = Number(risk.mediumThreshold);
  const highThreshold = Number(risk.highThreshold);
  const maxQueuedPerSubmission = Number(diagnosis.maxQueuedPerSubmission);

  if (![minimumScore, mediumThreshold, highThreshold].every(Number.isFinite)) {
    return "Risk thresholds must be valid numbers.";
  }
  if (minimumScore < 0 || minimumScore > 90) {
    return "Minimum QuickScan score must be between 0 and 90.";
  }
  if (mediumThreshold <= minimumScore) {
    return "Medium risk must start above the minimum QuickScan score.";
  }
  if (highThreshold <= mediumThreshold) {
    return "High risk must start above medium risk.";
  }
  if (highThreshold > 100) {
    return "High risk threshold cannot be higher than 100.";
  }
  if (!Number.isFinite(maxQueuedPerSubmission) || maxQueuedPerSubmission < 1 || maxQueuedPerSubmission > PRODUCT_PULSE_MAX_QUEUED_DIAGNOSES) {
    return `Max queued diagnoses must be between 1 and ${PRODUCT_PULSE_MAX_QUEUED_DIAGNOSES}.`;
  }

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

function formDataNumber(formData, key) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : undefined;
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
