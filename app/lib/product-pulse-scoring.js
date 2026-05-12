export const SOURCE_WEIGHTS = {
  shopifyProducts: 18,
  shopifyOrders: 18,
  shopifyReturns: 18,
  judgemeReviews: 14,
  chatmeReviews: 10,
  csvReviews: 8,
  supportTickets: 8,
  pdpQuestions: 6,
};

export function calculateCoverageScore(sources) {
  const totalWeight = sources.reduce((sum, source) => sum + source.weight, 0);
  if (!totalWeight) return 0;

  const connectedWeight = sources
    .filter((source) => source.connected)
    .reduce((sum, source) => sum + source.weight, 0);

  return Math.round((connectedWeight / totalWeight) * 100);
}

export function getCoverageState(score) {
  if (score >= 75) {
    return {
      tone: "success",
      label: "Strong coverage",
      message: "Product, return and review signals are enough for high-confidence diagnosis.",
    };
  }

  if (score >= 45) {
    return {
      tone: "warning",
      label: "Partial coverage",
      message: "The scan can run, but more sources will improve confidence and recommendations.",
    };
  }

  return {
    tone: "critical",
    label: "Low coverage",
    message: "Connect reviews or returns before relying on diagnosis recommendations.",
  };
}

export function calculateRiskScore(metrics) {
  const returnComponent = clamp(metrics.returnRate * 2.2, 0, 35);
  const refundComponent = clamp(metrics.refundRate * 2.5, 0, 25);
  const reviewComponent = clamp((5 - metrics.reviewRating) * 12, 0, 24);
  const issueComponent = clamp(metrics.issueCount * 4, 0, 16);
  return Math.round(clamp(returnComponent + refundComponent + reviewComponent + issueComponent, 0, 100));
}

export function calculateImpactScore(metrics) {
  const revenue = clamp(metrics.revenueAtRisk / 1000, 0, 50);
  const margin = clamp(metrics.marginAtRisk / 800, 0, 30);
  const volume = clamp(metrics.signalCount * 1.5, 0, 20);
  return Math.round(clamp(revenue + margin + volume, 0, 100));
}

export function getRiskTone(score) {
  if (score >= 75) return "critical";
  if (score >= 55) return "warning";
  if (score >= 35) return "info";
  return "success";
}

export function getRiskLabel(score) {
  if (score >= 75) return "High risk";
  if (score >= 55) return "Watch";
  if (score >= 35) return "Emerging";
  return "Healthy";
}

export function validateCreditBalance(availableCredits, requestedProducts = 1) {
  if (!Number.isInteger(requestedProducts) || requestedProducts < 1) {
    return { valid: false, message: "Choose at least one product to diagnose." };
  }

  if (availableCredits < requestedProducts) {
    return {
      valid: false,
      message: `Diagnosis needs ${requestedProducts} credit${requestedProducts === 1 ? "" : "s"}, but only ${availableCredits} are available.`,
    };
  }

  return { valid: true, message: "Credits available." };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
