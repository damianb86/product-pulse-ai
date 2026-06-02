import process from "node:process";

export const PRODUCT_PULSE_STARTER_PLAN = "ProductPulse Starter";

export function getConfiguredProductPulseStarterPlanAmount() {
  const cents = Number(process.env.PRODUCT_PULSE_STARTER_PLAN_PRICE_CENTS);
  const normalizedCents = Number.isFinite(cents) && cents > 0 ? cents : 900;
  return normalizedCents / 100;
}
