export const PRODUCT_PULSE_WIZARD_STORAGE_KEY = "productPulse.onboardingWizard.completed.v1";
export const PRODUCT_PULSE_WATCHLIST_WIZARD_STORAGE_KEY = "productPulse.watchlistWizard.completed.v1";

export function resetProductPulseWizardCompletions() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(PRODUCT_PULSE_WIZARD_STORAGE_KEY);
    window.localStorage.removeItem(PRODUCT_PULSE_WATCHLIST_WIZARD_STORAGE_KEY);
  } catch {
    // Ignore storage failures; mounted wizards still receive the reset events below.
  }

  window.dispatchEvent(new CustomEvent("productpulse:wizard-reset"));
  window.dispatchEvent(new CustomEvent("productpulse:watchlist-wizard-reset"));
}
