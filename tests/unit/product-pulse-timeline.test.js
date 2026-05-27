/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));

const { __productPulseTimelineTestHooks } = await import("../../app/lib/product-pulse-timeline.server.js");

describe("ProductPulse timeline event helpers", () => {
  it("creates risk and momentum events for meaningful score changes", () => {
    const events = __productPulseTimelineTestHooks.buildTimelineEventsForScoreHistoryPair({
      shop: "peak-outfitters.myshopify.com",
      product: {
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
        handle: "cooling-pillow",
      },
      previous: {
        id: "history-1",
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
        source: "quickscan",
        riskScore: 48,
        confidence: 72,
        primaryIssue: "Product quality",
        metrics: { productMomentumScore: 44, refundAmount: 125 },
        recordedAt: "2026-05-01T10:00:00.000Z",
      },
      current: {
        id: "history-2",
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
        source: "quickscan",
        riskScore: 61,
        confidence: 78,
        primaryIssue: "Product quality",
        metrics: { productMomentumScore: 58, refundAmount: 180 },
        recordedAt: "2026-05-02T10:00:00.000Z",
      },
    });

    expect(events.map((event) => event.eventType)).toContain("risk_score_increased");
    expect(events.map((event) => event.eventType)).toContain("momentum_increased");
    expect(events.find((event) => event.eventType === "risk_score_increased")).toMatchObject({
      category: "risk",
      beforeValue: { riskScore: 48, riskLabel: "Low" },
      afterValue: { riskScore: 61, riskLabel: "Medium" },
    });
  });

  it("does not create noisy metric-change events for small deltas", () => {
    const events = __productPulseTimelineTestHooks.buildTimelineEventsForScoreHistoryPair({
      shop: "peak-outfitters.myshopify.com",
      product: { productGid: "gid://shopify/Product/1", productTitle: "Cooling Pillow" },
      previous: {
        id: "history-1",
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
        source: "quickscan",
        riskScore: 48,
        metrics: { productMomentumScore: 44, refundAmount: 125 },
        recordedAt: "2026-05-01T10:00:00.000Z",
      },
      current: {
        id: "history-2",
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
        source: "quickscan",
        riskScore: 51,
        metrics: { productMomentumScore: 49, refundAmount: 140 },
        recordedAt: "2026-05-02T10:00:00.000Z",
      },
    });

    expect(events.map((event) => event.eventType)).toEqual(["quickscan_completed"]);
  });

  it("creates watchlist source-change events from change reports", () => {
    const events = __productPulseTimelineTestHooks.buildTimelineEventsForWatchActivity({
      shop: "peak-outfitters.myshopify.com",
      product: { productGid: "gid://shopify/Product/1", productTitle: "Cooling Pillow", handle: "cooling-pillow" },
      activity: {
        id: "watch-activity-1",
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
        eventType: "watch_change_report",
        title: "Watchlist changes detected",
        detail: "Negative reviews and return pressure changed.",
        createdAt: "2026-05-03T10:00:00.000Z",
        metadata: {
          report: {
            status: "changed",
            title: "Watchlist changes detected",
            summary: "Two source groups changed.",
            current: { riskScore: 64 },
            sourceChanges: [
              { id: "review-evidence", source: "reviews", detail: "New negative review detected.", value: "+2" },
              { id: "return-reasons", source: "returns", detail: "Top return reason changed.", value: "Fit" },
            ],
          },
        },
      },
    });

    expect(events.map((event) => event.eventType)).toEqual([
      "watchlist_changes_detected",
      "new_reviews_detected",
      "new_returns_detected",
    ]);
  });

  it("normalizes and groups frontend-ready events by day", () => {
    const normalized = [
      __productPulseTimelineTestHooks.normalizeTimelineEvent({
        id: "event-1",
        eventType: "risk_score_increased",
        category: "risk",
        source: "ProductPulse",
        title: "Risk increased",
        occurredAt: new Date("2026-05-02T10:00:00.000Z"),
        severityTone: "warning",
        importance: 70,
        metadata: {},
      }, { handle: "cooling-pillow" }),
      __productPulseTimelineTestHooks.normalizeTimelineEvent({
        id: "event-2",
        eventType: "recommended_action_applied",
        category: "action",
        source: "ProductPulse",
        title: "Action applied",
        occurredAt: new Date("2026-05-02T12:00:00.000Z"),
        severityTone: "info",
        importance: 56,
        metadata: { recommendationId: "fix-copy" },
      }, { handle: "cooling-pillow" }),
    ];

    const groups = __productPulseTimelineTestHooks.groupTimelineEventsByDay(normalized);

    expect(groups).toHaveLength(1);
    expect(groups[0].events).toHaveLength(2);
    expect(normalized[1].cta).toMatchObject({ type: "action", label: "Open action" });
  });

  it("aggregates diagnosis issue changes and does not repeat previously seen issues", () => {
    const diagnoses = [
      diagnosisRow("diagnosis-1", "2026-05-01T10:00:00.000Z", ["Fit issue", "Color mismatch"]),
      diagnosisRow("diagnosis-2", "2026-05-02T10:00:00.000Z", ["Fit issue", "Color mismatch", "Quality defect", "Quality defect"]),
      diagnosisRow("diagnosis-3", "2026-05-03T10:00:00.000Z", ["Fit issue", "Color mismatch", "Quality defect"]),
      diagnosisRow("diagnosis-4", "2026-05-04T10:00:00.000Z", ["Fit issue"]),
      diagnosisRow("diagnosis-5", "2026-05-05T10:00:00.000Z", ["Fit issue"]),
    ];

    const events = __productPulseTimelineTestHooks.buildTimelineEventsForDiagnosisRows(diagnoses, {
      shop: "peak-outfitters.myshopify.com",
      product: { productGid: "gid://shopify/Product/1", productTitle: "Cooling Pillow" },
    });

    expect(events.map((event) => event.title)).not.toContain("Full diagnosis completed");
    expect(events.map((event) => event.title)).not.toContain("Recommended action created");
    expect(events.filter((event) => event.eventType === "new_issues_detected")).toHaveLength(1);
    expect(events.find((event) => event.eventType === "new_issues_detected")).toMatchObject({
      title: "New issue detected",
      afterValue: { issues: ["Quality defect"] },
      metadata: { issueCount: 1 },
    });
    expect(events.filter((event) => event.eventType === "issues_resolved")).toHaveLength(1);
    expect(events.find((event) => event.eventType === "issues_resolved")).toMatchObject({
      title: "Issues no longer detected",
      beforeValue: { issues: ["Color mismatch", "Quality defect"] },
      metadata: { issueCount: 2 },
    });
  });
});

function diagnosisRow(id, completedAt, issueLabels = []) {
  return {
    id,
    productGid: "gid://shopify/Product/1",
    productTitle: "Cooling Pillow",
    status: "Completed",
    riskScore: 64,
    confidence: 82,
    likelyCause: issueLabels[0] || "No issue",
    issues: issueLabels.map((label) => ({
      issue: label,
      label,
      issueCode: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      suggestedAction: `Review ${label}`,
    })),
    recommendations: [
      { id: "fix-copy", label: "Fix copy", type: "PDP copy", priority: "High" },
    ],
    completedAt,
    createdAt: completedAt,
  };
}
