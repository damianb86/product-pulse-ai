/* eslint-env node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const modelNames = [
    "aiAppDraftAuditLog",
    "aiAppDraftProposal",
    "aiActionAuditLog",
    "aiActionProposal",
    "aiConversationToolCall",
    "aiConversationMessage",
    "aiConversation",
    "aiUsageEvent",
    "betaFeedbackPanelPreference",
    "betaFeedbackReport",
    "productAction",
    "productTimelineEvent",
    "productRetentionSummary",
    "productRetentionSegmentDaily",
    "productRetentionDailyActivity",
    "productRetentionCohortCell",
    "productRetentionDailyCohort",
    "productRetentionRun",
    "productDiagnosis",
    "productRiskSnapshot",
    "productWatchActivity",
    "productWatchlistItem",
    "productWatchSettings",
    "productScoreHistory",
    "productPulseJobLog",
    "catalogSignalJob",
    "productPulseSource",
    "contactRequest",
    "session",
  ];
  const db = {};
  modelNames.forEach((modelName) => {
    db[modelName] = {
      count: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    };
  });
  return {
    authenticateAdmin: vi.fn(),
    db,
    sendContactEmail: vi.fn(),
  };
});

vi.mock("../../app/shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));

vi.mock("../../app/db.server", () => ({
  default: mocks.db,
}));

vi.mock("../../app/email.server", () => ({
  sendContactEmail: mocks.sendContactEmail,
}));

describe("Help route privacy actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdmin.mockResolvedValue({ session: { shop: "demo.myshopify.com" } });
    Object.values(mocks.db).forEach((model) => {
      model.count?.mockResolvedValue(0);
      model.deleteMany?.mockResolvedValue({ count: 1 });
    });
  });

  it("deletes app data without returning 500 when the privacy notification email fails", async () => {
    const { action } = await import("../../app/routes/app.help.jsx");
    const formData = new FormData();
    formData.set("intent", "privacy-data-delete");
    mocks.sendContactEmail.mockRejectedValue(new Error("SMTP not configured"));

    const result = await action({
      request: new Request("https://app.example.com/app/help.data", {
        method: "POST",
        body: formData,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      intent: "privacy-data-delete",
    });
    expect(mocks.db.productRiskSnapshot.deleteMany).toHaveBeenCalledWith({ where: { shop: "demo.myshopify.com" } });
    expect(mocks.db.session.deleteMany).toHaveBeenCalledWith({ where: { shop: "demo.myshopify.com" } });
    expect(mocks.sendContactEmail).toHaveBeenCalled();
  });

  it("skips optional missing storage targets during privacy deletion", async () => {
    const { action } = await import("../../app/routes/app.help.jsx");
    const formData = new FormData();
    formData.set("intent", "privacy-data-delete");
    mocks.db.betaFeedbackReport.deleteMany.mockRejectedValue(Object.assign(new Error("table does not exist"), { code: "P2021" }));

    const result = await action({
      request: new Request("https://app.example.com/app/help.data", {
        method: "POST",
        body: formData,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      intent: "privacy-data-delete",
    });
    expect(mocks.db.betaFeedbackReport.deleteMany).toHaveBeenCalledWith({ where: { shop: "demo.myshopify.com" } });
    expect(mocks.db.session.deleteMany).toHaveBeenCalledWith({ where: { shop: "demo.myshopify.com" } });
  });
});
