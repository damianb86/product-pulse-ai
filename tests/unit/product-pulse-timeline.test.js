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
        eventType: "recommended_action_created",
        category: "action",
        source: "ProductPulse",
        title: "Action created",
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
});
