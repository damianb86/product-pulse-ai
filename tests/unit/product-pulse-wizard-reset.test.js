import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_PULSE_WATCHLIST_WIZARD_STORAGE_KEY,
  PRODUCT_PULSE_WIZARD_STORAGE_KEY,
  resetProductPulseWizardCompletions,
} from "../../app/utils/product-pulse-wizard-reset";

describe("ProductPulse wizard reset", () => {
  it("clears onboarding and watchlist wizard completion after privacy deletion", () => {
    const wizardReset = vi.fn();
    const watchlistWizardReset = vi.fn();
    window.localStorage.setItem(PRODUCT_PULSE_WIZARD_STORAGE_KEY, "true");
    window.localStorage.setItem(PRODUCT_PULSE_WATCHLIST_WIZARD_STORAGE_KEY, "true");
    window.addEventListener("productpulse:wizard-reset", wizardReset);
    window.addEventListener("productpulse:watchlist-wizard-reset", watchlistWizardReset);

    resetProductPulseWizardCompletions();

    expect(window.localStorage.getItem(PRODUCT_PULSE_WIZARD_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PRODUCT_PULSE_WATCHLIST_WIZARD_STORAGE_KEY)).toBeNull();
    expect(wizardReset).toHaveBeenCalledOnce();
    expect(watchlistWizardReset).toHaveBeenCalledOnce();

    window.removeEventListener("productpulse:wizard-reset", wizardReset);
    window.removeEventListener("productpulse:watchlist-wizard-reset", watchlistWizardReset);
  });
});
