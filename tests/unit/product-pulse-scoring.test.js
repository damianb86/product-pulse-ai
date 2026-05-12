import { describe, expect, it } from "vitest";
import {
  calculateCoverageScore,
  calculateImpactScore,
  calculateRiskScore,
  getCoverageState,
  validateCreditBalance,
} from "../../app/lib/product-pulse-scoring";
import { defaultView } from "../fixtures/product-pulse-fixtures";

describe("ProductPulse scoring", () => {
  it("calculates deterministic source coverage from connected weights", () => {
    expect(calculateCoverageScore(defaultView.sources)).toBe(76);
    expect(getCoverageState(76).label).toBe("Strong coverage");
  });

  it("calculates product risk without AI-provided numeric metrics", () => {
    const risk = calculateRiskScore({
      returnRate: 20,
      refundRate: 10,
      reviewRating: 3.2,
      issueCount: 5,
    });

    expect(risk).toBe(98);
  });

  it("caps impact score to a bounded range", () => {
    expect(calculateImpactScore({ revenueAtRisk: 100000, marginAtRisk: 40000, signalCount: 100 })).toBe(100);
  });

  it("blocks diagnosis when credits are insufficient", () => {
    expect(validateCreditBalance(0, 1)).toMatchObject({ valid: false });
    expect(validateCreditBalance(2, 1)).toMatchObject({ valid: true });
  });
});
