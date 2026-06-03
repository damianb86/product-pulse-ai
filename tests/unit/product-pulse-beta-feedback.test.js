/* eslint-env node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reportCreate: vi.fn(),
  preferenceFindMany: vi.fn(),
  preferenceUpsert: vi.fn(),
  transaction: vi.fn(),
  sendProductPulseEmail: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    betaFeedbackReport: {
      create: mocks.reportCreate,
    },
    betaFeedbackPanelPreference: {
      findMany: mocks.preferenceFindMany,
      upsert: mocks.preferenceUpsert,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../../app/email.server", () => ({
  sendProductPulseEmail: mocks.sendProductPulseEmail,
}));

const {
  getBetaFeedbackClientConfig,
  isBetaFeedbackEnabled,
} = await import("../../app/lib/beta-feedback-config.server");

const {
  createBetaFeedbackReport,
  getBetaFeedbackPreferencesForPage,
  recordBetaFeedbackPanelHide,
  sanitizeBetaFeedbackContext,
} = await import("../../app/lib/beta-feedback.server");

const session = {
  shop: "shop-a.myshopify.com",
  userId: 42,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
};

describe("ProductPulse beta feedback layer", () => {
  beforeEach(() => {
    mocks.reportCreate.mockReset().mockImplementation(({ data }) => Promise.resolve({
      id: "feedback-1",
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      ...data,
    }));
    mocks.preferenceFindMany.mockReset().mockResolvedValue([]);
    mocks.preferenceUpsert.mockReset().mockImplementation(({ create, update }) => Promise.resolve({
      id: "preference-1",
      updatedAt: new Date("2026-05-29T12:00:00.000Z"),
      ...(create || {}),
      ...(update || {}),
    }));
    mocks.transaction.mockReset().mockImplementation((operations) => Promise.all(operations));
    mocks.sendProductPulseEmail.mockReset().mockResolvedValue({});
  });

  it("is fully feature flagged for client config", () => {
    expect(isBetaFeedbackEnabled({})).toBe(true);
    expect(isBetaFeedbackEnabled({ PRODUCT_PULSE_BETA_FEEDBACK_ENABLED: "false" })).toBe(false);
    expect(isBetaFeedbackEnabled({ PRODUCT_PULSE_BETA_FEEDBACK_ENABLED: "true" })).toBe(true);
    expect(isBetaFeedbackEnabled({ BETA_FEEDBACK_ENABLED: "false" })).toBe(false);
    expect(isBetaFeedbackEnabled({ PRODUCT_PULSE_BETA_FEEDBACK_ENABLED: "", BETA_FEEDBACK_ENABLED: "false" })).toBe(false);
    expect(getBetaFeedbackClientConfig({ session }, { PRODUCT_PULSE_BETA_FEEDBACK_ENABLED: "false" })).toEqual({ enabled: false });
    expect(getBetaFeedbackClientConfig({ session }, { PRODUCT_PULSE_BETA_FEEDBACK_ENABLED: "true", NODE_ENV: "test" })).toMatchObject({
      enabled: true,
      shop: "shop-a.myshopify.com",
      user: {
        id: "42",
        email: "ada@example.com",
        name: "Ada Lovelace",
      },
      environment: "test",
    });
  });

  it("redacts sensitive context before storing feedback", async () => {
    await createBetaFeedbackReport({
      session,
      payload: {
        category: "wrong_value",
        severity: "high",
        message: "The risk score looks wrong.",
        pagePath: "/app/products/hat",
        panelId: "product.riskHistory",
        panelLabel: "Product risk over time",
        context: {
          accessToken: "secret-token",
          cookie: "session=secret",
          metric: { name: "Risk", value: 82 },
          product: { title: "Wool hat" },
        },
      },
    });
    await flushQueuedEmail();

    expect(mocks.reportCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shop: "shop-a.myshopify.com",
        userKey: "42",
        category: "wrong_value",
        severity: "high",
        panelId: "product.riskHistory",
        panelLabel: "Product risk over time",
        context: expect.objectContaining({
          accessToken: "[redacted]",
          cookie: "[redacted]",
          metric: { name: "Risk", value: 82 },
        }),
      }),
    });
  });

  it("emails beta feedback to the beta recipient and configured contact email", async () => {
    const previousBetaRecipient = process.env.BETA_FEEDBACK_RECIPIENT;
    const previousContactEmail = process.env.CONTACT_EMAIL;
    process.env.BETA_FEEDBACK_RECIPIENT = "owner@example.com";
    process.env.CONTACT_EMAIL = "support@example.com";

    try {
      await createBetaFeedbackReport({
        session,
        payload: {
          category: "bug_error",
          severity: "high",
          message: "The product detail chart is clipped.",
          pagePath: "/app/products/hat",
          panelId: "product.momentum",
          panelLabel: "Sales Momentum",
          context: { route: { path: "/app/products/hat" } },
        },
      });
      await flushQueuedEmail();

      expect(mocks.sendProductPulseEmail).toHaveBeenCalledWith(expect.objectContaining({
        type: "beta_feedback",
        to: "owner@example.com,support@example.com",
        requiredRecipientEnv: "BETA_FEEDBACK_RECIPIENT and/or CONTACT_EMAIL",
      }));
    } finally {
      restoreEnvValue("BETA_FEEDBACK_RECIPIENT", previousBetaRecipient);
      restoreEnvValue("CONTACT_EMAIL", previousContactEmail);
    }
  });

  it("stores and exposes panel hide preferences separately from reports", async () => {
    const previousBetaRecipient = process.env.BETA_FEEDBACK_RECIPIENT;
    const previousContactEmail = process.env.CONTACT_EMAIL;
    process.env.BETA_FEEDBACK_RECIPIENT = "owner@example.com";
    process.env.CONTACT_EMAIL = "support@example.com";

    try {
      const preference = await recordBetaFeedbackPanelHide({
        session,
        payload: {
          pageKey: "/app/products/hat",
          pagePath: "/app/products/hat",
          panelId: "product.evidenceBySource",
          panelLabel: "Evidence by Source",
          reason: "data_looks_wrong",
          reasonMessage: "The review counts do not match.",
          context: {
            paymentDetails: "4111",
            evidence: { sourceCount: 3 },
          },
        },
      });

      expect(mocks.preferenceUpsert).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          shop_userKey_pageKey_panelId: {
            shop: "shop-a.myshopify.com",
            userKey: "42",
            pageKey: "/app/products/hat",
            panelId: "product.evidenceBySource",
          },
        },
        create: expect.objectContaining({
          hidden: true,
          hideReason: "data_looks_wrong",
          context: expect.objectContaining({
            paymentDetails: "[redacted]",
            evidence: { sourceCount: 3 },
          }),
        }),
      }));
      expect(mocks.reportCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: "panel_hide",
          source: "panel-hide",
          panelId: "product.evidenceBySource",
        }),
      });
      expect(preference).toMatchObject({
        panelId: "product.evidenceBySource",
        hidden: true,
        hasHideReason: true,
      });
      await flushQueuedEmail();
      expect(mocks.sendProductPulseEmail).toHaveBeenCalledWith(expect.objectContaining({
        type: "beta_feedback",
        to: "owner@example.com,support@example.com",
        message: expect.stringContaining("Panel hidden: Evidence by Source"),
      }));
    } finally {
      restoreEnvValue("BETA_FEEDBACK_RECIPIENT", previousBetaRecipient);
      restoreEnvValue("CONTACT_EMAIL", previousContactEmail);
    }
  });

  it("returns page-scoped preferences for the current user", async () => {
    mocks.preferenceFindMany.mockResolvedValue([{
      id: "pref-1",
      pageKey: "/app/analytics",
      panelId: "analytics.risk-vs-margin-impact",
      panelLabel: "Risk vs. margin impact",
      hidden: true,
      hideReason: "not_relevant",
      updatedAt: new Date("2026-05-29T12:00:00.000Z"),
    }]);

    await expect(getBetaFeedbackPreferencesForPage({ session, pageKey: "/app/analytics" })).resolves.toEqual([{
      id: "pref-1",
      pageKey: "/app/analytics",
      panelId: "analytics.risk-vs-margin-impact",
      panelLabel: "Risk vs. margin impact",
      hidden: true,
      hasHideReason: true,
      hideReason: "not_relevant",
      updatedAt: "2026-05-29T12:00:00.000Z",
    }]);
  });

  it("keeps oversized context bounded", () => {
    const context = sanitizeBetaFeedbackContext({
      text: "x".repeat(60_000),
    });

    expect(JSON.stringify(context).length).toBeLessThanOrEqual(24_000);
    expect(context.truncated || context.text.length < 60_000).toBeTruthy();
  });
});

function flushQueuedEmail() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function restoreEnvValue(key, value) {
  if (value == null) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
