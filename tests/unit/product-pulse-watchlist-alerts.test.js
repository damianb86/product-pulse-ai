import process from "node:process";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/email.server", () => ({
  sendProductPulseEmail: vi.fn(),
}));

import { __productPulseWatchlistAlertsTestHooks } from "../../app/lib/product-pulse-watchlist-alerts.server";

const baseSettings = {
  alertsEnabled: true,
  alertRecipients: ["ops@example.com"],
  summarySchedule: "daily_digest_8am",
  triggerRule: "new_or_rising_risk",
};

const emailLinkEnvKeys = [
  "PRODUCT_PULSE_APP_URL",
  "PRODUCT_PULSE_CRON_APP_URL",
  "SHOPIFY_APP_URL",
  "APP_URL",
  "PRODUCT_PULSE_SHOPIFY_APP_HANDLE",
  "SHOPIFY_ADMIN_APP_HANDLE",
  "SHOPIFY_APP_HANDLE",
];

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  Object.entries(snapshot).forEach(([key, value]) => {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
}

describe("ProductPulse watchlist alert helpers", () => {
  it("does not notify new-or-rising-risk for order-only growth", () => {
    const decision = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: baseSettings,
      reports: [{
        status: "changed",
        changeCount: 1,
        sourceChangeCount: 1,
        sourceChanges: [{ id: "new-orders", label: "New orders", tone: "green" }],
        changes: [],
        previous: { riskScore: 24, primaryIssue: "No primary issue" },
        current: { riskScore: 24, riskLabel: "Low", primaryIssue: "No primary issue" },
      }],
    });

    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe("trigger_rule_not_met:new_or_rising_risk");
  });

  it("notifies new-or-rising-risk for concrete issue evidence", () => {
    const decision = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: baseSettings,
      reports: [{
        status: "changed",
        changeCount: 2,
        sourceChangeCount: 1,
        sourceChanges: [{ id: "new-returns", label: "New returns", tone: "orange" }],
        changes: [],
        previous: { riskScore: 24, primaryIssue: "No primary issue" },
        current: { riskScore: 24, riskLabel: "Low", primaryIssue: "Sizing confusion" },
      }],
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.reason).toBe("new_or_rising_risk");
  });

  it("notifies risk-score-increase only when risk rises", () => {
    const rising = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: { ...baseSettings, triggerRule: "risk_score_increase" },
      reports: [{
        changeCount: 1,
        sourceChangeCount: 0,
        sourceChanges: [],
        changes: [{ id: "risk-score", direction: "up" }],
        previous: { riskScore: 31 },
        current: { riskScore: 46, riskLabel: "Low" },
      }],
    });
    const falling = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: { ...baseSettings, triggerRule: "risk_score_increase" },
      reports: [{
        changeCount: 1,
        sourceChangeCount: 0,
        sourceChanges: [],
        changes: [{ id: "risk-score", direction: "down" }],
        previous: { riskScore: 46 },
        current: { riskScore: 31, riskLabel: "Low" },
      }],
    });

    expect(rising.shouldSend).toBe(true);
    expect(falling.shouldSend).toBe(false);
  });

  it("notifies medium-or-high-risk for a high-risk baseline without repeating unchanged high risk", () => {
    const baseline = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: { ...baseSettings, triggerRule: "medium_or_high_risk" },
      reports: [{
        status: "baseline",
        changeCount: 0,
        sourceChangeCount: 0,
        sourceChanges: [],
        changes: [],
        current: { riskScore: 81, riskLabel: "High" },
      }],
    });
    const unchanged = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: { ...baseSettings, triggerRule: "medium_or_high_risk" },
      reports: [{
        status: "unchanged",
        changeCount: 0,
        sourceChangeCount: 0,
        sourceChanges: [],
        changes: [],
        current: { riskScore: 81, riskLabel: "High" },
      }],
    });

    expect(baseline.shouldSend).toBe(true);
    expect(unchanged.shouldSend).toBe(false);
  });

  it("forces manual scan emails even when trigger settings would normally skip them", () => {
    const decision = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: {
        ...baseSettings,
        summarySchedule: "none",
        triggerRule: "new_issue_only",
      },
      metadata: { forceEmail: true, triggeredBy: "watchlist-manual-run" },
      reports: [{
        status: "unchanged",
        changeCount: 0,
        sourceChangeCount: 0,
        sourceChanges: [],
        changes: [],
        current: { riskScore: 20, riskLabel: "Low" },
      }],
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.reason).toBe("manual_watchlist_run");
  });

  it("does not send forced manual scan emails when email alerts are disabled", () => {
    const decision = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: {
        ...baseSettings,
        alertsEnabled: false,
      },
      metadata: { forceEmail: true, triggeredBy: "watchlist-manual-run" },
      reports: [],
    });

    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe("watchlist_alerts_disabled");
  });

  it("still requires a recipient for forced manual scan emails", () => {
    const decision = __productPulseWatchlistAlertsTestHooks.buildWatchlistAlertDecision({
      settings: { ...baseSettings, alertRecipients: [] },
      metadata: { forceEmail: true, triggeredBy: "watchlist-manual-run" },
      reports: [],
    });

    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe("no_watchlist_alert_recipients");
  });

  it("puts concrete source changes before calculated context in the email", () => {
    const email = __productPulseWatchlistAlertsTestHooks.buildWatchlistRunEmail({
      shop: "demo.myshopify.com",
      settings: baseSettings,
      decision: { reason: "any_watch_change", label: "Any watched product change" },
      metadata: { productGids: ["gid://shopify/Product/1"] },
      reports: [{
        productTitle: "GEN EchoLock Voice Safe",
        status: "changed",
        headline: "New orders: 1 order.",
        narrative: "Since the previous Watchlist run, the product had one new order.",
        sourceChanges: [{ id: "new-orders", label: "New orders", value: "1 order", delta: "+4 units", detail: "Matte Black." }],
        changes: [
          { id: "primary-issue", label: "Primary issue", delta: "Changed", from: "Voice setup", to: "No primary issue" },
          { id: "risk-score", label: "Risk score", delta: "-11", direction: "down", from: "50", to: "39" },
        ],
      }],
      jobs: [],
    });

    expect(email.text.indexOf("Concrete changes")).toBeLessThan(email.text.indexOf("Secondary calculated context"));
    expect(email.text).toContain("Since the previous Watchlist run");
    expect(email.text).toContain("New orders");
    expect(email.text).toContain("Primary issue: Voice setup -> No primary issue");
    expect(email.html).toContain("Voice setup");
    expect(email.html).toContain("No primary issue");
    expect(email.html).toContain("Previous &rarr; New");
  });

  it("renders the Watchlist email as a compact product summary with links, images, and no-change rows", () => {
    const previousEnv = snapshotEnv(emailLinkEnvKeys);
    process.env.SHOPIFY_APP_URL = "https://productpulse.example.com";
    process.env.SHOPIFY_ADMIN_APP_HANDLE = "product-pulse-ai";

    try {
      const email = __productPulseWatchlistAlertsTestHooks.buildWatchlistRunEmail({
        shop: "demo.myshopify.com",
        settings: baseSettings,
        decision: { reason: "manual_watchlist_run", label: "Manual Watchlist run completed" },
        metadata: { productGids: ["gid://shopify/Product/1", "gid://shopify/Product/2"] },
        reports: [
          {
            id: "run-1",
            productGid: "gid://shopify/Product/1",
            productTitle: "GEN LiftAir Inflatable Standing Desk",
            handle: "gen-liftair-inflatable-standing-desk",
            imageUrl: "https://cdn.example.com/desk.png",
            status: "changed",
            headline: "New orders: 3 orders.",
            narrative: "Captured 3 new orders and 2 negative reviews.",
            sourceChanges: [
              { id: "new-orders", label: "New orders", value: "3 orders", delta: "+23 units", tone: "green" },
              { id: "new-reviews", label: "New reviews", value: "2 reviews", delta: "Negative", tone: "orange" },
            ],
            changes: [
              { id: "primary-issue", label: "Primary issue", delta: "Changed", from: "Buyer confusion", to: "Instability and returns" },
              { id: "momentum-score", label: "Sales Momentum", delta: "+9/100", direction: "up", from: "62/100", to: "71/100" },
              { id: "risk-score", label: "Product risk", delta: "+4", direction: "up", from: "68", to: "72" },
            ],
          },
          {
            id: "run-2",
            productGid: "gid://shopify/Product/2",
            productTitle: "GEN Quiet Product",
            handle: "gen-quiet-product",
            imageUrl: "https://cdn.example.com/quiet.png",
            status: "unchanged",
            headline: "No meaningful changes detected",
            narrative: "No new source changes were detected.",
            sourceChanges: [],
            changes: [],
          },
        ],
        jobs: [],
      });

      expect(email.html).toContain("ProductPulse AI");
      expect(email.html).not.toContain("ai-assistant-icon-gradient.png");
      expect(email.html).toContain("gw-watchlist-brand-icon");
      expect(email.html).toContain("aria-label=\"Watchlist\"");
      expect(email.html).toContain("Product change summary");
      expect(email.html).toContain("GEN LiftAir Inflatable Standing Desk");
      expect(email.html).toContain("GEN Quiet Product");
      expect(email.html).toContain("No changes");
      expect(email.html).toContain("Buyer confusion");
      expect(email.html).toContain("Instability and returns");
      expect(email.html).toContain("62/100");
      expect(email.html).toContain("71/100");
      expect(email.html).toContain("https://cdn.example.com/desk.png");
      expect(email.html).toContain("https://admin.shopify.com/store/demo/apps/product-pulse-ai/app/watchlist");
      expect(email.html).toContain("https://admin.shopify.com/store/demo/apps/product-pulse-ai/app/watchlist/gen-liftair-inflatable-standing-desk?runId=run-1");
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it("falls back to the app host with explicit shop context when the Shopify Admin app handle is not configured", () => {
    const previousEnv = snapshotEnv(emailLinkEnvKeys);
    process.env.SHOPIFY_APP_URL = "https://productpulse.example.com";
    delete process.env.PRODUCT_PULSE_SHOPIFY_APP_HANDLE;
    delete process.env.SHOPIFY_ADMIN_APP_HANDLE;
    delete process.env.SHOPIFY_APP_HANDLE;

    try {
      const email = __productPulseWatchlistAlertsTestHooks.buildWatchlistRunEmail({
        shop: "demo.myshopify.com",
        settings: baseSettings,
        decision: { reason: "manual_watchlist_run", label: "Manual Watchlist run completed" },
        metadata: { productGids: ["gid://shopify/Product/1"] },
        reports: [{
          id: "run-1",
          productGid: "gid://shopify/Product/1",
          productTitle: "GEN LiftAir Inflatable Standing Desk",
          handle: "gen-liftair-inflatable-standing-desk",
          status: "changed",
          headline: "New orders: 3 orders.",
          narrative: "Captured 3 new orders.",
          sourceChanges: [{ id: "new-orders", label: "New orders", value: "3 orders", delta: "+23 units" }],
          changes: [],
        }],
        jobs: [],
      });

      expect(email.html).toContain("https://productpulse.example.com/app/watchlist/gen-liftair-inflatable-standing-desk?runId=run-1&amp;shop=demo.myshopify.com");
      expect(email.html).toContain("https://productpulse.example.com/app/watchlist?shop=demo.myshopify.com");
    } finally {
      restoreEnv(previousEnv);
    }
  });
});
