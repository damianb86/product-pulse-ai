import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useActionData } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnalyticsScreen,
  BackgroundProcessesScreen,
  ConnectScreen,
  DashboardScreen,
  ProductDiagnosisScreen,
  ProductEvidenceReportScreen,
  ProductMetricTimelinesScreen,
  PlansCreditsScreen,
  ProductsScreen,
  SettingsScreen,
  WatchlistActivityScreen,
  WatchlistProductScreen,
  WatchlistScreen,
  __productPulseScreensTestHooks,
} from "../../app/components/ProductPulseScreens";
import { defaultView } from "../fixtures/product-pulse-fixtures";

const WIZARD_STORAGE_KEY = "productPulse.onboardingWizard.completed.v1";
const WATCHLIST_WIZARD_STORAGE_KEY = "productPulse.watchlistWizard.completed.v1";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(__productPulseScreensTestHooks.productDetailPanelCollapseStorageKey);
  window.localStorage.removeItem(__productPulseScreensTestHooks.watchRecentRunsWindowStorageKey);
  window.localStorage.removeItem(WIZARD_STORAGE_KEY);
  window.localStorage.removeItem(WATCHLIST_WIZARD_STORAGE_KEY);
  delete window.shopify;
});

function renderWithRouter(element, initialEntries = ["/"]) {
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries });
  return { ...render(<RouterProvider router={router} />), router };
}

function renderWithAction(element, action) {
  const router = createMemoryRouter([{ path: "/", element, action }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

function ProductsActionHarness({ data, filters }) {
  const actionData = useActionData();
  return <ProductsScreen data={data} filters={filters} actionData={actionData} />;
}

function ProductDiagnosisActionHarness({ data, product }) {
  const actionData = useActionData();
  return <ProductDiagnosisScreen data={data} product={product} actionData={actionData} />;
}

function makeTableProduct(overrides = {}) {
  return {
    title: "Resolve Linen Shirt",
    variant: "shirt",
    selected: false,
    risk: "Medium",
    riskTone: "warning",
    riskScore: 64,
    riskTrend: [52, 58, 64],
    signals: 12,
    signalTone: "orange",
    signalBars: [12, 28, 42, 30, 10],
    issue: "Fit & sizing",
    sources: [
      { key: "returns", label: "Returns", shortLabel: "RET", detail: "Shopify return units and return reasons." },
    ],
    sourceOverflow: 0,
    lastAnalysis: "Just now",
    lastAnalysisAt: "2026-05-23T12:00:00.000Z",
    href: "/app/products/resolve-linen-shirt",
    handle: "resolve-linen-shirt",
    productGid: "gid://shopify/Product/resolve-1",
    analysisDepth: "full",
    analysisLabel: "Full diagnosis",
    analysisDetail: "Product Diagnosis completed.",
    ...overrides,
  };
}

function makeProductsData(row) {
  return {
    ...defaultView,
    productTable: {
      ...(defaultView.productTable || {}),
      rows: [row],
      total: 1,
      totalAll: 1,
      totalPages: 1,
    },
    candidateProductTable: {
      ...(defaultView.candidateProductTable || {}),
      rows: [],
      total: 0,
      totalAll: 0,
      totalPages: 1,
    },
  };
}

function makeMetricTimelineProduct(overrides = {}) {
  const riskHistory = [
    {
      recordedAt: "2026-02-15T00:00:00.000Z",
      riskScore: 42,
      confidence: 74,
      financialExposure: 180,
      returnRate: 20,
      returnPressureScore: 22,
      returnPressureRate: 14,
      retentionHealthScore: 66,
      productMomentumScore: 35,
      refundLeakageScore: 18,
      evidenceStrengthScore: 4,
      customerSignalCount: 14,
      avgRating: 4.3,
      negativeReviewRate: 12,
      mainIssueIntensity: 28,
    },
    {
      recordedAt: "2026-03-01T00:00:00.000Z",
      riskScore: 48,
      confidence: 78,
      financialExposure: 260,
      returnRate: 25,
      returnPressureScore: 34,
      returnPressureRate: 18,
      retentionHealthScore: 72,
      productMomentumScore: 44,
      refundLeakageScore: 24,
      evidenceStrengthScore: 5,
      customerSignalCount: 16,
      avgRating: 4.1,
      negativeReviewRate: 18,
      mainIssueIntensity: 35,
    },
    {
      recordedAt: "2026-04-01T00:00:00.000Z",
      riskScore: 61,
      confidence: 83,
      financialExposure: 310,
      returnRate: 27.3,
      returnPressureScore: 47,
      returnPressureRate: 23,
      retentionHealthScore: 79,
      productMomentumScore: 86,
      refundLeakageScore: 31,
      evidenceStrengthScore: 6,
      customerSignalCount: 20,
      avgRating: 3.9,
      negativeReviewRate: 24,
      mainIssueIntensity: 42,
    },
    {
      recordedAt: "2026-05-29T00:00:00.000Z",
      riskScore: 70,
      confidence: 88,
      financialExposure: 430,
      returnRate: 35.7,
      returnPressureScore: 58,
      returnPressureRate: 31,
      retentionHealthScore: 93,
      productMomentumScore: 112,
      refundLeakageScore: 42,
      evidenceStrengthScore: 7,
      customerSignalCount: 31,
      avgRating: 3.6,
      negativeReviewRate: 34,
      mainIssueIntensity: 57,
    },
  ];

  return {
    ...defaultView.startHere,
    title: "Timeline Jacket",
    slug: "timeline-jacket",
    handle: "timeline-jacket",
    href: "/app/products/timeline-jacket",
    productGid: "gid://shopify/Product/timeline-jacket",
    riskScore: 70,
    riskTone: "warning",
    confidence: 88,
    analysisDepth: "full",
    metrics: {
      ...(defaultView.startHere.metrics || {}),
      monthlyOrderActivity: {
        months: [
          { key: "2026-02", label: "Feb 2026", shortLabel: "Feb", startAt: "2026-02-15T00:00:00.000Z", orders: 4, orderUnits: 5, revenue: 320, returnedOrders: 1, returnedUnits: 1, refundedOrders: 0, refundedUnits: 0, refundAmount: 0, returnRate: 20, refundRate: 0 },
          { key: "2026-03", label: "Mar 2026", shortLabel: "Mar", startAt: "2026-03-01T00:00:00.000Z", orders: 6, orderUnits: 8, revenue: 540, returnedOrders: 2, returnedUnits: 2, refundedOrders: 1, refundedUnits: 1, refundAmount: 80, returnRate: 25, refundRate: 12.5 },
          { key: "2026-04", label: "Apr 2026", shortLabel: "Apr", startAt: "2026-04-01T00:00:00.000Z", orders: 8, orderUnits: 11, revenue: 760, returnedOrders: 3, returnedUnits: 3, refundedOrders: 2, refundedUnits: 2, refundAmount: 140, returnRate: 27.3, refundRate: 18.2 },
          { key: "2026-05", label: "May 2026", shortLabel: "May", startAt: "2026-05-01T00:00:00.000Z", orders: 10, orderUnits: 14, revenue: 960, returnedOrders: 4, returnedUnits: 5, refundedOrders: 3, refundedUnits: 3, refundAmount: 210, returnRate: 35.7, refundRate: 21.4 },
        ],
        weeks: [
          { key: "2026-02-09", label: "Feb 9", shortLabel: "Feb 9", startAt: "2026-02-09T00:00:00.000Z", orders: 4, orderUnits: 5, revenue: 320, returnedOrders: 1, returnedUnits: 1, refundedOrders: 0, refundedUnits: 0, refundAmount: 0, returnRate: 20, refundRate: 0 },
          { key: "2026-03-02", label: "Mar 2", shortLabel: "Mar 2", startAt: "2026-03-02T00:00:00.000Z", orders: 6, orderUnits: 8, revenue: 540, returnedOrders: 2, returnedUnits: 2, refundedOrders: 1, refundedUnits: 1, refundAmount: 80, returnRate: 25, refundRate: 12.5 },
          { key: "2026-04-06", label: "Apr 6", shortLabel: "Apr 6", startAt: "2026-04-06T00:00:00.000Z", orders: 8, orderUnits: 11, revenue: 760, returnedOrders: 3, returnedUnits: 3, refundedOrders: 2, refundedUnits: 2, refundAmount: 140, returnRate: 27.3, refundRate: 18.2 },
          { key: "2026-05-25", label: "May 25", shortLabel: "May 25", startAt: "2026-05-25T00:00:00.000Z", orders: 10, orderUnits: 14, revenue: 960, returnedOrders: 4, returnedUnits: 5, refundedOrders: 3, refundedUnits: 3, refundAmount: 210, returnRate: 35.7, refundRate: 21.4 },
        ],
        summary: {
          totalOrders: 28,
          totalOrderUnits: 38,
          totalRevenue: 2580,
          totalReturnedOrders: 10,
          totalReturnedUnits: 11,
          totalRefundedOrders: 6,
          totalRefundedUnits: 6,
          totalRefundAmount: 430,
          returnRate: 28.9,
          refundRate: 15.8,
        },
      },
      riskHistory,
      productRetention: {
        summary: { retentionHealthScore: 93 },
        retentionHealthTrend: riskHistory.map((point, index) => ({
          date: point.recordedAt.slice(0, 10),
          retentionHealthScore: point.retentionHealthScore,
          sameProductRepurchaseRate90d: [0.18, 0.24, 0.31, 0.42][index],
        })),
      },
    },
    timeline: {
      summary: "Risk increased and one recommendation was applied after the latest Watchlist run.",
      filters: {
        categories: [
          { value: "risk", label: "Risk", count: 1 },
          { value: "action", label: "Actions", count: 1 },
          { value: "scan", label: "Scans", count: 1 },
        ],
        meaningfulImportance: 40,
      },
      events: [
        {
          id: "timeline-risk",
          eventType: "risk_score_increased",
          category: "risk",
          categoryLabel: "Risk",
          source: "ProductPulse score history",
          title: "Product risk increased",
          summary: "Risk moved from 58/100 to 70/100.",
          occurredAt: "2026-05-29T00:00:00.000Z",
          dayKey: "2026-05-29",
          dateLabel: "May 29, 2026",
          timeLabel: "12:00 AM",
          severityTone: "warning",
          tone: "orange",
          importance: 72,
          importanceLabel: "Meaningful",
          beforeValue: { riskScore: 58 },
          afterValue: { riskScore: 70 },
          metadata: { delta: 12 },
          icon: "alert-triangle",
          related: {},
          cta: { type: "link", label: "View metric timelines", href: "/app/products/timeline-jacket/metric-timelines" },
        },
        {
          id: "timeline-action",
          eventType: "recommended_action_applied",
          category: "action",
          categoryLabel: "Actions",
          source: "ProductPulse action",
          title: "Recommended action applied",
          summary: "Add fit note was applied.",
          occurredAt: "2026-05-29T01:00:00.000Z",
          dayKey: "2026-05-29",
          dateLabel: "May 29, 2026",
          timeLabel: "1:00 AM",
          severityTone: "info",
          tone: "blue",
          importance: 58,
          importanceLabel: "Meaningful",
          metadata: { sourceActionId: "fit-note" },
          icon: "check-circle",
          related: { recommendationId: "fit-note" },
          cta: { type: "action", label: "Open action" },
        },
        {
          id: "timeline-low",
          eventType: "quickscan_completed",
          category: "scan",
          categoryLabel: "Scans",
          source: "Shopify Catalog Scan",
          title: "Catalog Scan completed",
          summary: "Catalog Scan stored 58/100 risk.",
          occurredAt: "2026-05-28T01:00:00.000Z",
          dayKey: "2026-05-28",
          dateLabel: "May 28, 2026",
          timeLabel: "1:00 AM",
          severityTone: "neutral",
          tone: "slate",
          importance: 34,
          importanceLabel: "Low",
          metadata: {},
          icon: "search",
          related: {},
        },
      ],
    },
    ...overrides,
  };
}

function getSmoothPathEndpointYValues(path = "") {
  const coordinatePairs = [...String(path || "").matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  return coordinatePairs
    .filter((_, index) => index === 0 || index % 3 === 0)
    .map((point) => point.y);
}

describe("ProductPulse screens", () => {
  it("renders the Plans & Diagnosis Credits pricing and credit purchase page", () => {
    renderWithRouter(<PlansCreditsScreen />);

    expect(screen.getByRole("heading", { name: "Plans & Diagnosis Credits" })).toBeInTheDocument();
    expect(screen.queryByText("Monthly billing")).not.toBeInTheDocument();
    expect(screen.queryByText("1 diagnosis credit = 1 Product Diagnosis")).not.toBeInTheDocument();
    expect(screen.getByText(/running without paid billing/)).toBeInTheDocument();
    expect(screen.getByLabelText("Current usage")).toHaveTextContent("Free");
    expect(screen.getByLabelText("Current usage")).toHaveTextContent(/Monthly diagnosis credits\s*10/);
    expect(screen.getByLabelText("Current usage")).toHaveTextContent(/Used\s*0/);
    expect(screen.getByLabelText("Current usage")).toHaveTextContent(/Left\s*10/);
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Starter" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Growth" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Premium" })).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("Best value")).toBeInTheDocument();
    expect(screen.getByText("Included")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.getAllByText("Shopify Billing not enabled")).toHaveLength(4);
    expect(screen.getByText("Metric timeline")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.getByText("90 days")).toBeInTheDocument();
    expect(screen.getAllByText("360 days")).toHaveLength(5);
    expect(screen.getByText("Products monitored in Watchlist")).toBeInTheDocument();
    expect(screen.getByText("1 product")).toBeInTheDocument();
    expect(screen.getAllByText("5 products")).toHaveLength(2);
    expect(screen.getByText("10 products")).toBeInTheDocument();
    expect(screen.getByText("25 products")).toBeInTheDocument();
    expect(screen.getByText("50 products")).toBeInTheDocument();
    expect(screen.getByText("99 products")).toBeInTheDocument();
    expect(screen.getByText("Product Diagnosis").closest(".ppPlansFeatureCell").querySelector(".ppPlansIcon")).not.toBeInTheDocument();
    expect(screen.getByText("Exports")).toBeInTheDocument();
    expect(screen.getByText("CSV")).toBeInTheDocument();
    expect(screen.getByText("CSV, PDF")).toBeInTheDocument();
    expect(screen.getByText("CSV, PDF, Excel")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Priority email")).toBeInTheDocument();
    expect(screen.getAllByText("Priority + Chat")).toHaveLength(2);
    expect(screen.getByText("Dedicated")).toBeInTheDocument();
    expect(screen.queryByText("Community")).not.toBeInTheDocument();
    expect(screen.queryByText("API access")).not.toBeInTheDocument();
    expect(screen.queryByText("Seats")).not.toBeInTheDocument();
    expect(screen.queryByText("Watched products")).not.toBeInTheDocument();
    expect(screen.getByText("Extra diagnosis credit packs")).toBeInTheDocument();
    expect(screen.getByText(/Diagnosis credit-pack purchases are not available/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy .* diagnosis credits/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Current free plan" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Billing disabled" })).toHaveLength(4);
    screen.getAllByRole("button", { name: "Billing disabled" }).forEach((button) => {
      expect(button).toBeDisabled();
    });
    expect(screen.getByText("Which option fits best?")).toBeInTheDocument();
    expect(screen.getByText("Low usage")).toBeInTheDocument();
    expect(screen.getByText("Growing usage")).toBeInTheDocument();
    expect(screen.getByText("Heavy usage")).toBeInTheDocument();
    expect(screen.getByText("Billing information")).toBeInTheDocument();
    expect(screen.getByText("Shopify Billing required")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View diagnosis credits/ })).toHaveAttribute("href", "/app/plans-and-credits");
    expect(screen.getByText("Diagnosis credit activity")).toBeInTheDocument();
    expect(screen.getByText(/Latest Diagnosis Credits earned and spent/)).toBeInTheDocument();
    expect(screen.getByText("No diagnosis credit activity yet.")).toBeInTheDocument();
  });

  it("renders Plans & Diagnosis Credits ledger activity from point history", () => {
    renderWithRouter(<PlansCreditsScreen data={{
      pointSummary: {
        balance: { available: 85 },
        usage: { used: 4 },
        activity: [
          {
            id: "pack-1",
            title: "Extra diagnosis credit pack",
            detail: "25 beta diagnosis credits",
            direction: "credit",
            amountLabel: "+25 diagnosis credits",
            balanceAfterLabel: "85",
            timeLabel: "2m ago",
          },
          {
            id: "diagnosis-1",
            title: "Product Diagnosis",
            detail: "GEN QuietDesk Mini Fan",
            direction: "debit",
            amountLabel: "-1 diagnosis credit",
            balanceAfterLabel: "60",
            timeLabel: "1h ago",
          },
        ],
      },
    }} />);

    expect(screen.getByLabelText("Current usage")).toHaveTextContent(/Used\s*4/);
    expect(screen.getByLabelText("Current usage")).toHaveTextContent(/Left\s*85/);
    expect(screen.getByText("Extra diagnosis credit pack")).toBeInTheDocument();
    expect(screen.getByText("25 beta diagnosis credits")).toBeInTheDocument();
    expect(screen.getByText("+25 diagnosis credits")).toHaveClass("isCredit");
    expect(screen.getAllByText("Product Diagnosis").length).toBeGreaterThan(0);
    expect(screen.getByText("GEN QuietDesk Mini Fan")).toBeInTheDocument();
    expect(screen.getByText("-1 diagnosis credit")).toHaveClass("isDebit");
    expect(screen.getByText("85 left")).toBeInTheDocument();
    expect(screen.getByText("60 left")).toBeInTheDocument();
  });

  it("renders dashboard KPIs and start-here product", () => {
    renderWithRouter(<DashboardScreen data={defaultView} />);
    expect(screen.getByText(/Current product quality status/)).toBeInTheDocument();
    expect(screen.getByText("Products needing attention")).toBeInTheDocument();
    expect(screen.getByText("Pending recommended actions")).toBeInTheDocument();
    expect(screen.getByText("Issues resolved / Risk reduced")).toBeInTheDocument();
    expect(screen.getByText("Next best action")).toBeInTheDocument();
    expect(screen.getAllByText("Core Linen Trouser").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Add fit note").length).toBeGreaterThan(0);
    expect(screen.getByText(/ready to review for Core Linen Trouser/)).toBeInTheDocument();
    expect(screen.getByText("$21,000")).toBeInTheDocument();
    expect(screen.queryByText("Products to review")).not.toBeInTheDocument();
    expect(screen.getByText("Priority products")).toBeInTheDocument();
    expect(screen.getByText("Action queue")).toBeInTheDocument();
    expect(screen.getByText("Top active issue types")).toBeInTheDocument();
    expect(screen.getByText("Data coverage / scan coverage")).toBeInTheDocument();
    expect(screen.getByText("Total catalog")).toBeInTheDocument();
    expect(screen.getByText("Products in ProductPulse")).toBeInTheDocument();
    expect(screen.queryByText("Not scanned")).not.toBeInTheDocument();
    expect(screen.queryByText("View all recommended fixes")).not.toBeInTheDocument();
    expect(screen.queryByText("Signal source mix")).not.toBeInTheDocument();
    expect(screen.queryByText("Impact by collection")).not.toBeInTheDocument();
  });

  it("renders source coverage categories", () => {
    renderWithRouter(<ConnectScreen data={defaultView} />);
    expect(screen.getByRole("heading", { name: "Connect your sources" })).toBeInTheDocument();
    expect(screen.getByText("Judge.me Reviews")).toBeInTheDocument();
    expect(screen.getByText("Loox Reviews")).toBeInTheDocument();
    expect(screen.getByText("Yotpo Reviews")).toBeInTheDocument();
    expect(screen.getByText("Stamped Reviews")).toBeInTheDocument();
    expect(screen.getByText("Shopify Returns & Refunds")).toBeInTheDocument();
    expect(within(screen.getByText("Loox Reviews").closest("tr")).getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(within(screen.getByText("Yotpo Reviews").closest("tr")).getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(within(screen.getByText("Stamped Reviews").closest("tr")).getByRole("button", { name: "Coming soon" })).toBeDisabled();
    expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Always on").length).toBeGreaterThan(0);
    expect(screen.getByText("Data coverage")).toBeInTheDocument();
    expect(screen.getByText("Data coverage").querySelector("s-icon")).not.toBeInTheDocument();
    expect(screen.queryByText(/Need help connecting a source/i)).not.toBeInTheDocument();
    expect(screen.queryByText("View our setup guide")).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage rules")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Connection setup progress")).not.toBeInTheDocument();
  });

  it("does not show category ignore controls in Connect", () => {
    renderWithRouter(<ConnectScreen data={defaultView} />);
    expect(screen.getByLabelText("0% effective customer-signal coverage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ignore category" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use category" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ignored by merchant choice/)).not.toBeInTheDocument();
  });

  it("shows disabled CSV uploads as inactive rows", () => {
    renderWithRouter(<ConnectScreen data={{
      ...defaultView,
      connect: {
        records: [{
          sourceKey: "csvReviews",
          category: "reviews",
          connected: true,
          active: false,
          available: true,
          health: "disabled",
          config: { fileName: "CSV import", normalizedRowCount: 33 },
        }],
      },
    }} />);

    const csvRow = screen.getByText("CSV Upload").closest("tr");
    expect(csvRow).toHaveClass("isDisabled");
    expect(within(csvRow).getByText("Disabled")).toBeInTheDocument();
    expect(within(csvRow).getByText("CSV import disabled; ignored by Catalog Scan and Product Diagnosis.")).toBeInTheDocument();
    expect(within(csvRow).getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("connects Judge.me from the connection modal", async () => {
    renderWithRouter(<ConnectScreen data={defaultView} />);
    const judgeMeRow = screen.getByText("Judge.me Reviews").closest("tr");
    fireEvent.click(within(judgeMeRow).getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("heading", { name: "Judge.me Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Judge.me API settings" })).toHaveAttribute("href", "https://judge.me/settings?jump_to=judge.me+api");
    expect(screen.getByRole("link", { name: "Judge.me API documentation" })).toHaveAttribute("href", "https://judge.me/help/en/articles/8409180-judge-me-api");
    fireEvent.change(screen.getByLabelText("Private API token"), { target: { value: "judgeme_private_123456" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Judge.me Reviews" })).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getAllByText("Connected to Judge.me.")).toHaveLength(1));
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.getByLabelText("60% effective customer-signal coverage")).toBeInTheDocument();
  });

  it("connects Yotpo Reviews from the connection modal", async () => {
    renderWithRouter(<ConnectScreen data={{ ...defaultView, shop: "damian-xdcxxupp.myshopify.com" }} />);
    const yotpoRow = screen.getByText("Yotpo Reviews").closest("tr");
    fireEvent.click(within(yotpoRow).getByRole("button", { name: "Connect" }));
    const dialog = screen.getByRole("dialog", { name: "Yotpo Reviews" });
    expect(within(dialog).getByRole("heading", { name: "Yotpo Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Yotpo in Shopify" })).toHaveAttribute("href", "https://admin.shopify.com/store/damian-xdcxxupp/apps/yotpo-social-reviews");
    expect(screen.getByRole("link", { name: "Yotpo account settings" })).toHaveAttribute("href", "https://settings.yotpo.com/");
    expect(screen.getByRole("link", { name: "Find Store ID and API secret" })).toHaveAttribute("href", "https://support.yotpo.com/docs/finding-your-yotpo-app-key-and-secret-key-3");
    expect(screen.queryByRole("link", { name: "Yotpo API authentication" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reviews API documentation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Product reviews API documentation" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Store ID / App Key"), { target: { value: "yotpo_store_123456" } });
    fireEvent.change(screen.getByLabelText("API secret"), { target: { value: "yotpo_secret_123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getAllByText("Connected to Yotpo Reviews. Review API access verified.")).toHaveLength(1));
    expect(screen.getByLabelText("60% effective customer-signal coverage")).toBeInTheDocument();
  });

  it("connects Loox Reviews from the connection modal", async () => {
    renderWithRouter(<ConnectScreen data={{ ...defaultView, shop: "damian-xdcxxupp.myshopify.com" }} />);
    const looxRow = screen.getByText("Loox Reviews").closest("tr");
    fireEvent.click(within(looxRow).getByRole("button", { name: "Connect" }));
    const dialog = screen.getByRole("dialog", { name: "Loox Reviews" });
    expect(within(dialog).getByRole("heading", { name: "Loox Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Loox API Keys in Shopify" })).toHaveAttribute("href", "https://admin.shopify.com/store/damian-xdcxxupp/apps/loox-fashion-reviews");
    expect(screen.getByRole("link", { name: "Find publicStoreId and API key" })).toHaveAttribute("href", "https://help.loox.io/support/solutions/articles/501000356871-loox-reviews-api-and-webhooks");
    fireEvent.change(screen.getByLabelText("publicStoreId"), { target: { value: "loox_public_store_123456" } });
    expect(screen.getByRole("link", { name: "Open Loox API Keys in Shopify" })).toHaveAttribute("href", "https://admin.shopify.com/store/damian-xdcxxupp/apps/loox-fashion-reviews/merchant/loox_public_store_123456/settings/api-keys");
    expect(screen.queryByRole("link", { name: "Loox API documentation" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("API secret key"), { target: { value: "loox_secret_123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getAllByText("Connected to Loox Reviews. Review API access verified.")).toHaveLength(1));
    expect(screen.getByLabelText("60% effective customer-signal coverage")).toBeInTheDocument();
  });

  it("shows a CSV review preview before saving the upload", async () => {
    const csvPreview = {
      fileName: "reviews.csv",
      displayFileName: "CSV import",
      totalRows: 12,
      normalizedRowCount: 10,
      rejectedRowCount: 2,
      mapping: {
        product_handle: "Product Handle",
        shopify_product_id: null,
        rating: "Stars",
        review_title: "Title",
        review_body: "Review Body",
        review_date: "Created At",
        reviewer_name: "Reviewer",
        review_status: "Status",
      },
      productRelation: {
        status: "confirmed",
        label: "Shopify product handle confirmed",
        detail: "Matched Product Handle to Core Linen Trouser.",
      },
      previewRows: [
        {
          sourceRow: "2",
          productHandle: "core-linen-trouser",
          rating: "5",
          reviewTitle: "Great fit",
          reviewBody: "Soft fabric and accurate sizing.",
          reviewDate: "2026-05-01",
          reviewerName: "Ana",
          reviewStatus: "published",
        },
      ],
      normalizedFileName: "csv-review-import-20260523-120000-abcdef123456.normalized.csv",
      storageKey: "test-shop.myshopify.com",
    };

    renderWithRouter(<ConnectScreen
      data={{ ...defaultView, persistConnectState: true }}
      actionData={{ status: "csv_preview", providerKey: "csvReviews", csvPreview }}
    />);

    const dialog = await screen.findByRole("dialog", { name: "Review detected CSV data" });
    expect(within(dialog).getByText("Reviews ready")).toBeInTheDocument();
    expect(within(dialog).getByText("10")).toBeInTheDocument();
    expect(within(dialog).getByText("Product Handle")).toBeInTheDocument();
    expect(within(dialog).getByText("core-linen-trouser")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Accept and save CSV" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "View required CSV fields" }));
    expect(screen.getByRole("dialog", { name: "Structure review CSV files" })).toBeInTheDocument();
    expect(screen.getByText("product_handle")).toBeInTheDocument();
    expect(screen.getByText("shopify_product_id")).toBeInTheDocument();
  });

  it("renders product table tabs and switches between Product Diagnosis, candidates and resolved products", () => {
    const resolvedProduct = {
      title: "Resolved Linen Shirt",
      variant: "shirt",
      risk: "Low",
      riskTone: "success",
      riskScore: 22,
      riskTrend: [44, 33, 22],
      signals: 8,
      signalTone: "green",
      signalBars: [20, 18, 14],
      issue: "Resolved issue",
      sources: [{ key: "returns", label: "Returns", shortLabel: "RET" }],
      sourceOverflow: 0,
      status: "Resolved",
      statusTone: "success",
      lastAnalysis: "Just now",
      href: "/app/products/resolved-linen-shirt",
      handle: "resolved-linen-shirt",
      productGid: "gid://shopify/Product/resolved-1",
      resolvedAt: "2026-05-23T12:00:00.000Z",
      resolvedLabel: "Resolved May 23",
    };
    const data = {
      ...defaultView,
      resolvedProductTable: { rows: [resolvedProduct], total: 1, totalAll: 1, totalPages: 1, page: 1, rowsPerPage: 25, filterOptions: defaultView.productTable?.filterOptions || {} },
    };

    renderWithRouter(<ProductsScreen data={data} filters={{ query: "", risk: "all" }} />);
    const table = screen.getByTestId("products-table");
    expect(screen.getByRole("tab", { name: /Product Diagnosis/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Candidates/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Resolved/ })).toHaveAttribute("aria-selected", "false");
    expect(within(table).getByText("No Product Diagnosis results yet")).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(within(table).queryByText("Credits")).not.toBeInTheDocument();
    expect(screen.queryByTestId("products-candidates-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("products-resolved-table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Run Catalog Scan/ }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole("button", { name: "Find Shopify product" })).toHaveLength(1);
    const filtersSection = screen.getByLabelText("products filters").closest("s-section");
    expect(within(filtersSection).queryByText("Source")).not.toBeInTheDocument();
    const tabsCard = screen.getByRole("tablist", { name: "Product table views" }).closest(".ppProductsTableTabsCard");
    expect(filtersSection.compareDocumentPosition(tabsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabsCard.parentElement).toHaveClass("ppProductsTabbedTableGroup");

    fireEvent.click(screen.getByRole("tab", { name: /Candidates/ }));
    const candidatesTable = screen.getByTestId("products-candidates-table");
    expect(screen.queryByTestId("products-table")).not.toBeInTheDocument();
    expect(within(candidatesTable).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(within(candidatesTable).getByText("No candidates yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Find Shopify product" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Analyze selected (0)" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: /Resolved/ }));
    const resolvedTable = screen.getByTestId("products-resolved-table");
    expect(screen.queryByTestId("products-candidates-table")).not.toBeInTheDocument();
    expect(within(resolvedTable).getAllByRole("link", { name: /Resolved Linen Shirt/ }).length).toBeGreaterThan(0);
    expect(within(resolvedTable).getByText("Resolved May 23")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Product Diagnosis/ }));
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Find Shopify product" })[0]);
    expect(screen.getByRole("heading", { name: "Find Shopify product" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search by title, handle, product ID or SKU")).toBeInTheDocument();
    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
  });

  it("shows clear filters only when product filters are active", () => {
    renderWithRouter(<ProductsScreen data={defaultView} filters={{ query: "", risk: "high" }} />);
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/app/products");
  });

  it("renders the watchlist and opens the add watched product modal", () => {
    renderWithRouter(<WatchlistScreen
      data={{
        watchlist: {
          maxProducts: 99,
          watchedCount: 2,
          slotsAvailable: 97,
          rows: [
            {
              id: "watch-1",
              productGid: "gid://shopify/Product/1",
              title: "Nintendo New 3DS XL",
              sku: "N3DSXL-BLUE",
              handle: "nintendo-new-3ds-xl",
              status: "Watching",
              statusTone: "success",
              riskScore: 63,
              riskLabel: "Medium",
              riskTone: "warning",
              latestChange: "New product quality issue",
              latestChangeDetail: "Product quality signal detected",
              latestChangeTone: "orange",
              lastIssue: "Detected 6h ago",
              lastIssueDetail: "May 18, 2:02 AM",
              href: "/app/products/nintendo-new-3ds-xl",
              watchlistHref: "/app/watchlist/nintendo-new-3ds-xl",
              latestChangeReport: {
                status: "changed",
                title: "Watchlist changes detected",
                summary: "2 meaningful changes since the previous Watchlist run. Product risk increased from 58 to 63.",
                narrative: "Nintendo New 3DS XL picked up new return and review evidence since the last Watchlist scan.",
                headline: "New returns: 2 returned units · +2 return signals.",
                changeCount: 3,
                sourceChangeCount: 1,
                previousRunAt: "2026-05-16T10:00:00.000Z",
                currentRunAt: "2026-05-17T10:00:00.000Z",
                current: {
                  riskLabel: "Medium",
                  riskScore: 63,
                  confidence: 72,
                  primaryIssue: "Product quality",
                  returnRatePercent: 12,
                  productMomentumTier: "Rising",
                  productMomentumScore: 74,
                },
                sourceChanges: [{
                  id: "new-returns",
                  source: "returns",
                  label: "New returns",
                  value: "2 returned units",
                  delta: "+2 return signals",
                  direction: "up",
                  tone: "orange",
                  icon: "shopify-returns",
                  detail: "New return text sentiment: 2 negative, 0 neutral, 0 positive.",
                }],
                sections: [{
                  id: "risk",
                  title: "Risk and diagnosis",
                  tone: "purple",
                  changes: [{
                    id: "risk-score",
                    label: "Product risk",
                    from: "58",
                    to: "63",
                    delta: "+5",
                    direction: "up",
                    detail: "Product risk changed based on the latest stored evidence and score model.",
                  }],
                }],
                sourceInsights: [{
                  id: "return-evidence",
                  title: "Return evidence changed",
                  tone: "orange",
                  metric: "+2 returned units",
                  summary: "2 new return text signals were captured since the previous Watchlist report.",
                  bullets: ["New return sentiment: 2 negative, 0 neutral, 0 positive."],
                }],
                runReports: [
                  {
                    id: "overview-run-older",
                    status: "changed",
                    title: "Watchlist changes detected",
                    headline: "New orders: 1 order · +2 units.",
                    summary: "1 concrete source change since the previous Watchlist run.",
                    changeCount: 2,
                    sourceChangeCount: 1,
                    previousRunAt: "2026-05-15T10:00:00.000Z",
                    currentRunAt: "2026-05-16T10:00:00.000Z",
                    previous: { riskScore: 52, productMomentumScore: 61, marginAtRisk: 90, orderCount: 8, returnUnits: 1, refundAmount: 60, negativeReviewCount: 2 },
                    current: { riskLabel: "Medium", riskScore: 58, productMomentumScore: 66, marginAtRisk: 110, orderCount: 9, returnUnits: 1, refundAmount: 60, negativeReviewCount: 2, primaryIssue: "Demand shift" },
                    sourceChanges: [{
                      id: "new-orders",
                      source: "orders",
                      label: "New orders",
                      value: "1 order",
                      delta: "+2 units",
                      direction: "up",
                      tone: "green",
                      icon: "shopify-orders",
                    }],
                    sections: [],
                    changes: [],
                    sourceInsights: [],
                  },
                  {
                    id: "overview-run-latest",
                    status: "changed",
                    title: "Watchlist changes detected",
                    headline: "New returns: 2 returned units · +2 return signals.",
                    summary: "2 meaningful changes since the previous Watchlist run. Product risk increased from 58 to 63.",
                    changeCount: 3,
                    sourceChangeCount: 1,
                    previousRunAt: "2026-05-16T10:00:00.000Z",
                    currentRunAt: "2026-05-17T10:00:00.000Z",
                    previous: { riskScore: 58, productMomentumScore: 66, marginAtRisk: 110, orderCount: 9, returnUnits: 1, refundAmount: 60, negativeReviewCount: 2 },
                    current: { riskLabel: "Medium", riskScore: 63, productMomentumScore: 74, marginAtRisk: 210, orderCount: 11, returnUnits: 3, refundAmount: 120, negativeReviewCount: 5, primaryIssue: "Product quality" },
                    sourceChanges: [{
                      id: "new-returns",
                      source: "returns",
                      label: "New returns",
                      value: "2 returned units",
                      delta: "+2 return signals",
                      direction: "up",
                      tone: "orange",
                      icon: "shopify-returns",
                      detail: "New return text sentiment: 2 negative, 0 neutral, 0 positive.",
                    }],
                    sections: [{
                      id: "risk",
                      title: "Risk and diagnosis",
                      tone: "purple",
                      changes: [{
                        id: "risk-score",
                        label: "Product risk",
                        from: "58",
                        to: "63",
                        delta: "+5",
                        direction: "up",
                      }],
                    }],
                    changes: [{ id: "risk-score", label: "Product risk", sectionTitle: "Risk and diagnosis", direction: "up", delta: "+5" }],
                    sourceInsights: [],
                  },
                ],
              },
            },
            {
              id: "watch-2",
              productGid: "gid://shopify/Product/2",
              title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
              sku: "ART-REMBRANDT",
              status: "Paused",
              statusTone: "subdued",
              riskScore: 46,
              riskLabel: "Low",
              riskTone: "success",
              latestChange: "Watch signal captured",
              latestChangeDetail: "New issue",
              latestChangeTone: "green",
              lastIssue: "All clear",
              lastIssueDetail: "May 18, 9:10 AM",
              href: "/app/products/the-night-watch",
            },
          ],
          activities: [
            {
              id: "activity-1",
              icon: "plus",
              tone: "blue",
              title: "Product added to watchlist",
              detail: "Nintendo New 3DS XL",
              time: "Just now",
            },
          ],
          trend: {
            productTitle: "2 watched products",
            riskScore: 55,
            riskLabel: "Medium",
            series: [
              {
                productGid: "gid://shopify/Product/1",
                productTitle: "Nintendo New 3DS XL",
                href: "/app/products/nintendo-new-3ds-xl",
                color: "#3A6BFF",
                riskScore: 63,
                riskLabel: "Medium",
                path: "0,45 100,37",
              },
              {
                productGid: "gid://shopify/Product/2",
                productTitle: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
                href: "/app/products/the-night-watch",
                color: "#7C3AED",
                riskScore: 46,
                riskLabel: "Low",
                path: "0,56 100,54",
              },
              {
                productGid: "gid://shopify/Product/3",
                productTitle: "Canvas Field Bag",
                href: "/app/products/canvas-field-bag",
                color: "#0F766E",
                riskScore: 51,
                riskLabel: "Medium",
                path: "0,42 100,49",
              },
              {
                productGid: "gid://shopify/Product/4",
                productTitle: "Trail Coffee Mug",
                href: "/app/products/trail-coffee-mug",
                color: "#EA580C",
                riskScore: 39,
                riskLabel: "Low",
                path: "0,60 100,61",
              },
              {
                productGid: "gid://shopify/Product/5",
                productTitle: "Desk Cable Dock",
                href: "/app/products/desk-cable-dock",
                color: "#DB2777",
                riskScore: 72,
                riskLabel: "High",
                path: "0,34 100,28",
              },
              {
                productGid: "gid://shopify/Product/6",
                productTitle: "Studio Desk Lamp",
                href: "/app/products/studio-desk-lamp",
                color: "#64748B",
                riskScore: 44,
                riskLabel: "Low",
                path: "0,58 100,55",
              },
            ],
            calloutTitle: "Nintendo New 3DS XL is currently highest at 63/100",
            calloutDetail: "Each line shows saved risk score movement.",
          },
          settings: {
            scanCadenceValue: "3",
            scanCadenceLabel: "Every 3 days",
            alertRecipientCount: 2,
            alertRecipientsText: "ops@store.com, support@store.com",
            triggerRule: "new_or_rising_risk",
            triggerRuleLabel: "Notify on new issues or rising risk",
            summarySchedule: "daily_digest_8am",
            summaryScheduleLabel: "Daily digest at 8:00 AM",
            alertsEnabled: true,
            options: {
              cadence: [{ value: "3", label: "Every 3 days" }, { value: "7", label: "Weekly" }],
              triggerRules: [{ value: "new_or_rising_risk", label: "Notify on new issues or rising risk" }],
              summaries: [{ value: "daily_digest_8am", label: "Daily digest at 8:00 AM" }],
            },
          },
          mock: {},
        },
      }}
    />);

    expect(screen.getByText("Watched products")).toBeInTheDocument();
    expect(screen.getByText("2 / 99")).toBeInTheDocument();
    expect(screen.queryByText(/Automatic rescans run on your selected cadence/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Nintendo New 3DS XL").length).toBeGreaterThan(0);
    expect(screen.getByText("Recent watch activity")).toBeInTheDocument();
    expect(screen.getByText("Product added to watchlist")).toBeInTheDocument();
    expect(screen.queryByText("Digest / summary")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Summary")).not.toBeInTheDocument();
    expect(screen.getByText("Watchlist trend (risk activity)")).toBeInTheDocument();
    expect(screen.getByText("63 · Medium")).toBeInTheDocument();
    expect(screen.getByText("46 · Low")).toBeInTheDocument();
    const trendChart = screen.getByLabelText("Watchlist product risk trend");
    const trendLegend = screen.getByLabelText("Watched product trend legend");
    expect(trendChart.querySelectorAll(".ppWatchTrendLine")).toHaveLength(5);
    const hiddenTrendToggle = within(trendLegend).getByRole("button", { name: /Studio Desk Lamp/ });
    expect(hiddenTrendToggle).toHaveAttribute("aria-pressed", "false");
    expect(hiddenTrendToggle).toHaveClass("isDisabled");
    fireEvent.click(hiddenTrendToggle);
    expect(hiddenTrendToggle).toHaveAttribute("aria-pressed", "true");
    expect(hiddenTrendToggle).not.toHaveClass("isDisabled");
    expect(trendChart.querySelectorAll(".ppWatchTrendLine")).toHaveLength(6);
    fireEvent.click(within(trendLegend).getByRole("button", { name: /Nintendo New 3DS XL/ }));
    expect(trendChart.querySelectorAll(".ppWatchTrendLine")).toHaveLength(5);
    expect(screen.queryByRole("link", { name: "View Nintendo New 3DS XL" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Watchlist report for Nintendo New 3DS XL" })).toHaveAttribute("href", "/app/watchlist/nintendo-new-3ds-xl");
    expect(screen.queryByText("Watch signal captured")).not.toBeInTheDocument();
    expect(screen.getByText("Paused · automatic scans disabled")).toBeInTheDocument();
    expect(screen.queryByText("This product will be checked on the next watch run.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent runs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Changes since previous run/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /What changed/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Events from this run" })).toBeInTheDocument();
    expect(screen.getAllByText("New returns").length).toBeGreaterThan(0);
    expect(screen.queryByText("New orders")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View all changed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View all signals/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View all events/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select Watchlist run/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View Watchlist run May 16/ })).toHaveAttribute("href", "/app/watchlist?runId=2026-05-16T10%3A00%3A00.000Z");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "product" } });
    expect(screen.getByRole("combobox")).toHaveValue("product");
    expect(screen.queryByRole("link", { name: /learn more/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Nintendo New 3DS XL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move Nintendo New 3DS XL/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/app/watchlist/activity");
    fireEvent.click(screen.getByRole("button", { name: "Pause Nintendo New 3DS XL" }));
    expect(screen.getByRole("dialog", { name: "Pause watch" })).toBeInTheDocument();
    expect(screen.getByText(/stop automatic Watchlist scans/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Nintendo New 3DS XL from watchlist" }));
    expect(screen.getByRole("dialog", { name: "Remove watched product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from Watchlist" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Resume THE NIGHT WATCH | REMBRANDT VAN RIJN" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Watch settings" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Save settings")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ops@store.com, support@store.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Disable watch alerts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume all watches" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add watched product" }));
    expect(screen.getByRole("heading", { name: "Add watched product" })).toBeInTheDocument();
    expect(screen.getByText(/Only products with a completed Product Diagnosis are shown here/i)).toBeInTheDocument();
    expect(screen.getByText(/Candidates and Catalog Scan-only products must be diagnosed first/i)).toBeInTheDocument();
    expect(screen.getByText("Loading eligible products...")).toBeInTheDocument();
  });

  it("groups product-level reports under the same Watchlist run in the overview timeline", () => {
    const makeReport = ({ id, jobId, title, currentRunAt, changeLabel, productRisk }) => ({
      id,
      jobId,
      status: "changed",
      title: "Watchlist changes detected",
      headline: `${changeLabel}.`,
      summary: `${changeLabel} since the previous Watchlist run.`,
      changeCount: 2,
      sourceChangeCount: 1,
      previousRunAt: "2026-05-17T08:00:00.000Z",
      currentRunAt,
      previous: { riskScore: productRisk - 3, productMomentumScore: 50, marginAtRisk: 90, orderCount: 4, returnUnits: 0, refundAmount: 0, negativeReviewCount: 1 },
      current: { riskLabel: "Medium", riskScore: productRisk, productMomentumScore: 55, marginAtRisk: 110, orderCount: 5, returnUnits: 1, refundAmount: 0, negativeReviewCount: 2, primaryIssue: title },
      sourceChanges: [{
        id: "new-returns",
        source: "returns",
        label: "New returns",
        value: "1 returned unit",
        delta: "+1 return signal",
        direction: "up",
        tone: "orange",
        icon: "shopify-returns",
      }],
      sections: [{
        id: "risk",
        title: "Risk and diagnosis",
        tone: "purple",
        changes: [{
          id: "risk-score",
          label: "Product risk",
          from: String(productRisk - 3),
          to: String(productRisk),
          delta: "+3",
          direction: "up",
        }],
      }],
      changes: [{ id: "risk-score", label: "Product risk", sectionTitle: "Risk and diagnosis", direction: "up", delta: "+3" }],
      sourceInsights: [],
    });

    renderWithRouter(<WatchlistScreen
      data={{
        watchlist: {
          maxProducts: 99,
          watchedCount: 2,
          slotsAvailable: 97,
          selectedRunId: "global-watch-run-1",
          rows: [
            {
              id: "watch-alpha",
              productGid: "gid://shopify/Product/alpha",
              title: "GEN Grouped Alpha",
              handle: "gen-grouped-alpha",
              status: "Watching",
              riskScore: 61,
              riskLabel: "Medium",
              riskTone: "warning",
              latestChange: "Alpha return pressure",
              href: "/app/products/gen-grouped-alpha",
              watchlistHref: "/app/watchlist/gen-grouped-alpha",
              latestChangeReport: {
                ...makeReport({
                  id: "product-run-alpha",
                  jobId: "job-alpha",
                  title: "Alpha return pressure",
                  currentRunAt: "2026-05-17T10:12:00.000Z",
                  changeLabel: "Alpha return pressure",
                  productRisk: 61,
                }),
                runReports: [makeReport({
                  id: "product-run-alpha",
                  jobId: "job-alpha",
                  title: "Alpha return pressure",
                  currentRunAt: "2026-05-17T10:12:00.000Z",
                  changeLabel: "Alpha return pressure",
                  productRisk: 61,
                })],
              },
            },
            {
              id: "watch-beta",
              productGid: "gid://shopify/Product/beta",
              title: "GEN Grouped Beta",
              handle: "gen-grouped-beta",
              status: "Watching",
              riskScore: 58,
              riskLabel: "Medium",
              riskTone: "warning",
              latestChange: "Beta refund pressure",
              href: "/app/products/gen-grouped-beta",
              watchlistHref: "/app/watchlist/gen-grouped-beta",
              latestChangeReport: {
                ...makeReport({
                  id: "product-run-beta",
                  jobId: "job-beta",
                  title: "Beta refund pressure",
                  currentRunAt: "2026-05-17T10:41:00.000Z",
                  changeLabel: "Beta refund pressure",
                  productRisk: 58,
                }),
                runReports: [makeReport({
                  id: "product-run-beta",
                  jobId: "job-beta",
                  title: "Beta refund pressure",
                  currentRunAt: "2026-05-17T10:41:00.000Z",
                  changeLabel: "Beta refund pressure",
                  productRisk: 58,
                })],
              },
            },
          ],
          activities: [],
          runActivities: [{
            id: "global-watch-run-1",
            eventType: "watch_manual_scan_queued",
            title: "Manual Watchlist Product Diagnosis queued",
            detail: "2 Product Diagnosis queued from Watchlist.",
            createdAt: "2026-05-17T10:00:00.000Z",
            metadata: { jobIds: ["job-alpha", "job-beta"] },
          }],
          settings: { alertsEnabled: true, alertRecipientCount: 1, options: { cadence: [], triggerRules: [], summaries: [] } },
        },
      }}
    />);

    expect(screen.getAllByRole("link", { name: /View Watchlist run May 17/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /View Watchlist run May 17/ })).toHaveAttribute("href", "/app/watchlist?runId=global-watch-run-1");
    expect(screen.getAllByText("Alpha return pressure").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta refund pressure").length).toBeGreaterThan(0);
  });

  it("renders a dedicated product Watchlist report page", () => {
    renderWithRouter(<WatchlistProductScreen
      product={{
        id: "watch-1",
        productGid: "gid://shopify/Product/1",
        title: "Nintendo New 3DS XL",
        sku: "N3DSXL-BLUE",
        handle: "nintendo-new-3ds-xl",
        status: "Watching",
        riskScore: 63,
        riskLabel: "Medium",
        latestChangeDetail: "Product quality",
        href: "/app/products/nintendo-new-3ds-xl",
        latestChangeReport: {
          status: "changed",
          title: "Watchlist changes detected",
          summary: "2 meaningful changes since the previous Watchlist run. Product risk increased from 58 to 63.",
          narrative: "Nintendo New 3DS XL picked up new return and review evidence since the last Watchlist scan.",
          headline: "New returns: 2 returned units · +2 return signals.",
          changeCount: 3,
          previousRunAt: "2026-05-16T10:00:00.000Z",
          currentRunAt: "2026-05-17T10:00:00.000Z",
          previous: {
            riskScore: 58,
            confidence: 70,
            primaryIssue: "Product quality",
            estimatedImpact: 460,
            marginAtRisk: 180,
            revenueAtRisk: 680,
            returnRatePercent: 15,
            refundRatePercent: 9,
            signalCount: 45,
            productMomentumScore: 59,
            orderCount: 10,
            soldUnits: 16,
            salesAmount: 720,
            returnUnits: 1,
            refundUnits: 1,
            reviewCount: 4,
            negativeReviewCount: 3,
            evidenceDetails: {
              returns: { sentiment: { negative: 5 } },
              content: {
                descriptionWordCount: 28,
                contentQualityScore: 62,
                contentIssues: [{ label: "Care instructions" }, { label: "Sizing" }, { label: "Warranty" }],
              },
              reviews: { averageRating: 3.1 },
            },
          },
          current: {
            riskLabel: "Medium",
            riskScore: 63,
            confidence: 72,
            primaryIssue: "Product quality",
            estimatedImpact: 520,
            marginAtRisk: 210,
            revenueAtRisk: 760,
            returnRatePercent: 12,
            refundRatePercent: 6,
            signalCount: 47,
            productMomentumTier: "Rising",
            productMomentumScore: 74,
            orderCount: 11,
            soldUnits: 20,
            salesAmount: 1104,
            returnUnits: 3,
            refundUnits: 1,
            reviewCount: 7,
            negativeReviewCount: 5,
            evidenceDetails: {
              returns: { sentiment: { negative: 2 } },
              content: {
                descriptionWordCount: 58,
                contentQualityScore: 66,
                contentIssues: [{ label: "Warranty" }],
              },
              reviews: { averageRating: 3.8 },
            },
          },
          sourceChanges: [{
            id: "new-returns",
            source: "returns",
            label: "New returns",
            value: "2 returned units",
            delta: "+2 return signals",
            direction: "up",
            tone: "orange",
            icon: "shopify-returns",
            detail: "New return text sentiment: 2 negative, 0 neutral, 0 positive.",
            items: [
              {
                text: "The hinge still feels loose and the screen clicks after one day.",
                sentiment: "negative",
                reason: "Quality issue",
                createdAt: "2026-05-17T09:30:00.000Z",
              },
            ],
          }],
          history: [
            { id: "run-0", currentRunAt: "2026-05-11T10:00:00.000Z", riskScore: 56, returnRatePercent: 17, refundRatePercent: 9, productMomentumScore: 51, orderCount: 6, soldUnits: 10, returnUnits: 1, refundUnits: 1, salesAmount: 640, refundAmount: 86, signalCount: 36 },
            { id: "run-1", currentRunAt: "2026-05-12T10:00:00.000Z", riskScore: 58, returnRatePercent: 16, refundRatePercent: 8, productMomentumScore: 54, orderCount: 7, soldUnits: 12, returnUnits: 1, refundUnits: 1, salesAmount: 720, refundAmount: 90, signalCount: 38 },
            { id: "run-2", currentRunAt: "2026-05-13T10:00:00.000Z", riskScore: 59, returnRatePercent: 15, refundRatePercent: 8, productMomentumScore: 57, orderCount: 8, soldUnits: 13, returnUnits: 2, refundUnits: 1, salesAmount: 780, refundAmount: 92, signalCount: 40 },
            { id: "run-3", currentRunAt: "2026-05-14T10:00:00.000Z", riskScore: 60, returnRatePercent: 14, refundRatePercent: 7, productMomentumScore: 61, orderCount: 9, soldUnits: 15, returnUnits: 3, refundUnits: 2, salesAmount: 900, refundAmount: 98, signalCount: 42 },
            { id: "run-4", currentRunAt: "2026-05-15T10:00:00.000Z", riskScore: 62, returnRatePercent: 13, refundRatePercent: 7, productMomentumScore: 66, orderCount: 10, soldUnits: 17, returnUnits: 3, refundUnits: 2, salesAmount: 980, refundAmount: 120, signalCount: 44 },
            { id: "run-5", currentRunAt: "2026-05-16T10:00:00.000Z", riskScore: 58, returnRatePercent: 15, refundRatePercent: 9, productMomentumScore: 59, orderCount: 10, soldUnits: 16, returnUnits: 1, refundUnits: 1, salesAmount: 720, refundAmount: 140, signalCount: 45 },
            { id: "run-6", currentRunAt: "2026-05-17T10:00:00.000Z", riskScore: 63, returnRatePercent: 12, refundRatePercent: 6, productMomentumScore: 74, orderCount: 11, soldUnits: 20, returnUnits: 3, refundUnits: 1, salesAmount: 1104, refundAmount: 218, signalCount: 47, contentUpdated: true },
          ],
          sections: [{
            id: "risk",
            title: "Risk and diagnosis",
            tone: "purple",
            changes: [{
              id: "risk-score",
              label: "Product risk",
              from: "58",
              to: "63",
              delta: "+5",
              direction: "up",
              detail: "Product risk changed based on the latest stored evidence and score model.",
            }],
          }],
          sourceInsights: [{
            id: "return-evidence",
            title: "Return evidence changed",
            tone: "orange",
            metric: "+2 returned units",
            summary: "2 new return text signals were captured since the previous Watchlist report.",
            bullets: ["New return sentiment: 2 negative, 0 neutral, 0 positive."],
          }],
        },
      }}
    />);

    expect(screen.getByRole("heading", { name: "Product Watchlist" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Watchlist/i })).toHaveClass("ppProductBackButton");
    expect(screen.getByRole("heading", { name: "Nintendo New 3DS XL" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open product detail/i })).toHaveAttribute("href", "/app/products/nintendo-new-3ds-xl");
    expect(screen.getByText("Changes detected")).toBeInTheDocument();
    expect(screen.getAllByText("3 changes tracked").length).toBeGreaterThan(0);
    expect(screen.getByText("Watchlist run")).toBeInTheDocument();
    expect(screen.getByText("AI Watchlist insight")).toBeInTheDocument();
    expect(screen.getByText("Biggest changes")).toBeInTheDocument();
    expect(screen.getByText("Customer Language Analysis changes")).toBeInTheDocument();
    expect(screen.getByText("Returns language")).toBeInTheDocument();
    expect(screen.getByText("2 new return text signals were captured since the previous Watchlist report.")).toBeInTheDocument();
    expect(screen.getByText(/hinge still feels loose/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent runs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View Watchlist run May 17/ })).toHaveAttribute("href", "/app/watchlist/nintendo-new-3ds-xl?runId=run-6");
    expect(screen.getByRole("button", { name: "Show older Watchlist runs" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Show newer Watchlist runs" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Show older Watchlist runs" }));
    expect(screen.getByRole("link", { name: /View Watchlist run May 12/ })).toHaveAttribute("href", "/app/watchlist/nintendo-new-3ds-xl?runId=run-1");
    expect(screen.getByRole("button", { name: "Show newer Watchlist runs" })).not.toBeDisabled();
    expect(screen.getByText("Changes by category")).toBeInTheDocument();
    expect(screen.getByText("Demand & orders")).toBeInTheDocument();
    expect(screen.getByText("Customer friction")).toBeInTheDocument();
    expect(screen.getByText("Content & PDP")).toBeInTheDocument();
    expect(screen.getByText("Diagnosis & evidence")).toBeInTheDocument();
    expect(screen.getByText("Estimated Margin Exposure")).toBeInTheDocument();
    expect(screen.getByText("Reviews")).toBeInTheDocument();
    expect(screen.getByText("Previous snapshot")).toBeInTheDocument();
    expect(screen.getByText("Current snapshot")).toBeInTheDocument();
    expect(screen.getByText("Performance trends (rates & scores)")).toBeInTheDocument();
    expect(screen.getByText("Operational & commercial activity")).toBeInTheDocument();
    expect(screen.getAllByText("Across last 6 watchlist runs")).toHaveLength(2);
    expect(screen.getByText("Risk score (0-100)")).toBeInTheDocument();
    expect(screen.getByText("Refund amount ($)")).toBeInTheDocument();
    expect(screen.queryByText("Run history")).not.toBeInTheDocument();
    expect(screen.queryByText("Content updates")).not.toBeInTheDocument();
    expect(screen.queryByText("Viewing")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View full history/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("Risk score").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evidence signals").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Units sold").length).toBeGreaterThan(0);
    expect(screen.queryByText("What happened since the last run")).not.toBeInTheDocument();
    expect(screen.getAllByText("New returns").length).toBeGreaterThan(0);
    expect(screen.getByText("2 returned units · +2 return signals")).toBeInTheDocument();
    expect(screen.queryByText("Calculated product-state changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Return evidence changed")).not.toBeInTheDocument();
    expect(screen.queryByText("Previous run")).not.toBeInTheDocument();
    expect(screen.queryByText("Current product state")).not.toBeInTheDocument();
    expect(screen.queryByText("View details")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("shows a designed empty state for Watchlist product reports without stored content", () => {
    renderWithRouter(<WatchlistProductScreen
      product={{
        id: "watch-empty",
        productGid: "gid://shopify/Product/empty",
        title: "Quiet Product",
        handle: "quiet-product",
        latestChangeReport: {
          id: "empty-run",
          status: "unchanged",
          title: "No Watchlist data",
          summary: "",
          narrative: "",
          headline: "",
          changeCount: 0,
          previousRunAt: "",
          currentRunAt: "",
          previous: {},
          current: {},
          sourceChanges: [],
          sourceInsights: [],
          sections: [],
          history: [],
        },
      }}
    />);

    expect(screen.getByRole("link", { name: /Back to Watchlist/i })).toHaveClass("ppProductBackButton");
    expect(screen.getByLabelText("Empty Watchlist report")).toBeInTheDocument();
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("No Watchlist report data yet")).toBeInTheDocument();
    expect(screen.getAllByText(/Quiet Product/).length).toBeGreaterThan(0);
    expect(screen.queryByText("AI Watchlist insight")).not.toBeInTheDocument();
  });

  it("renders full watchlist activity history", () => {
    renderWithRouter(<WatchlistActivityScreen
      data={{
        watchlist: {
          maxProducts: 99,
          watchedCount: 1,
          slotsAvailable: 98,
          rows: [{ status: "Watching" }],
          activities: [
            { id: "a1", eventType: "product_added", icon: "plus", tone: "blue", title: "Product added to watchlist", detail: "Nintendo New 3DS XL", timestamp: "May 15, 10:20 AM" },
            { id: "a2", eventType: "watch_scan_completed", icon: "refresh", tone: "orange", title: "Watch scan updated product risk", detail: "Medium risk (63/100)", timestamp: "May 15, 10:30 AM" },
          ],
          groupedActivities: [
            {
              day: "Fri, May 15",
              items: [
                { id: "a1", icon: "plus", tone: "blue", title: "Product added to watchlist", detail: "Nintendo New 3DS XL", timestamp: "May 15, 10:20 AM" },
                { id: "a2", icon: "refresh", tone: "orange", title: "Watch scan updated product risk", detail: "Medium risk (63/100)", timestamp: "May 15, 10:30 AM" },
              ],
            },
          ],
        },
      }}
    />);

    expect(screen.getByRole("heading", { name: "Watch activity" })).toBeInTheDocument();
    expect(screen.getByText("All watch activity")).toBeInTheDocument();
    expect(screen.getByText("Watch scan updated product risk")).toBeInTheDocument();
  });

  it("renders the full background process history with active jobs, payload details, and logs", () => {
    const extraProcesses = Array.from({ length: 8 }, (_, index) => ({
      id: `job-extra-${index + 1}`,
      name: "Product Diagnosis",
      displayTitle: `Completed Product ${index + 1}`,
      displaySubtitle: "Product Diagnosis completed",
      status: "Completed",
      progress: 100,
      updatedAtIso: `2026-05-24T13:${String(49 - index).padStart(2, "0")}:00.000Z`,
      startedAtIso: `2026-05-24T13:${String(40 - index).padStart(2, "0")}:00.000Z`,
      executionStartedAtIso: `2026-05-24T13:${String(40 - index).padStart(2, "0")}:00.000Z`,
      finishedAtIso: `2026-05-24T13:${String(49 - index).padStart(2, "0")}:00.000Z`,
      elapsedMs: 540_000,
      logCount: 0,
      logs: [],
    }));

    const { container } = renderWithRouter(<BackgroundProcessesScreen
      data={{
        developmentMode: true,
        backgroundProcesses: {
          updatedAt: "2026-05-24T15:00:00.000Z",
          activeProcesses: [
            {
              id: "job-running",
              name: "Product Diagnosis",
              displayTitle: "GEN EchoLock Voice Safe",
              displaySubtitle: "Running Product Diagnosis",
              status: "Running",
              progress: 42,
              updatedAtIso: "2026-05-24T15:00:00.000Z",
              startedAtIso: "2026-05-24T14:59:00.000Z",
              executionStartedAtIso: "2026-05-24T14:59:00.000Z",
              elapsedMs: 60_000,
              productHref: "/app/products/gen-echolock-voice-safe",
              payloadItems: [{ label: "Product GID", value: "gid://shopify/Product/123" }],
              logCount: 1,
              logs: [{ id: "log-1", jobId: "job-running", level: "info", event: "product_diagnosis.started", message: "Diagnosis started.", createdAtIso: "2026-05-24T14:59:10.000Z" }],
            },
          ],
          processes: [
            {
              id: "job-running",
              name: "Product Diagnosis",
              displayTitle: "GEN EchoLock Voice Safe",
              displaySubtitle: "Running Product Diagnosis",
              status: "Running",
              progress: 42,
              updatedAtIso: "2026-05-24T15:00:00.000Z",
              startedAtIso: "2026-05-24T14:59:00.000Z",
              executionStartedAtIso: "2026-05-24T14:59:00.000Z",
              elapsedMs: 60_000,
              productHref: "/app/products/gen-echolock-voice-safe",
              payloadItems: [{ label: "Product GID", value: "gid://shopify/Product/123" }],
              logCount: 1,
              logs: [{ id: "log-1", jobId: "job-running", level: "info", event: "product_diagnosis.started", message: "Diagnosis started.", createdAtIso: "2026-05-24T14:59:10.000Z" }],
            },
            {
              id: "job-completed",
              name: "Shopify mock dataset",
              displayTitle: "Shopify mock dataset",
              displaySubtitle: "Controlled Shopify mock dataset created",
              status: "Completed",
              progress: 100,
              updatedAtIso: "2026-05-24T14:00:00.000Z",
              startedAtIso: "2026-05-24T13:50:00.000Z",
              executionStartedAtIso: "2026-05-24T13:50:00.000Z",
              finishedAtIso: "2026-05-24T14:00:00.000Z",
              elapsedMs: 600_000,
              payloadItems: [{ label: "Orders", value: "24" }, { label: "Returns", value: "7" }],
              logCount: 0,
              logs: [],
            },
            ...extraProcesses,
          ],
          logs: [{ id: "log-1", jobId: "job-running", level: "info", event: "product_diagnosis.started", message: "Diagnosis started.", createdAtIso: "2026-05-24T14:59:10.000Z" }],
          stats: {
            total: 12,
            active: 1,
            running: 1,
            queued: 0,
            completed: 11,
            failed: 0,
            logs: 1,
            kindCounts: { "Product Diagnosis": 11, "Shopify mock dataset": 1 },
          },
          pagination: {
            page: 1,
            pageSize: 10,
            total: 12,
            totalPages: 2,
            from: 1,
            to: 10,
            hasPrevious: false,
            hasNext: true,
          },
        },
      }}
    />);

    expect(screen.getByRole("heading", { name: "Background processes" })).toBeInTheDocument();
    expect(screen.getAllByText("GEN EchoLock Voice Safe").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open product/i })).toHaveAttribute("href", "/app/products/gen-echolock-voice-safe");
    expect(screen.getByText("Product GID")).toBeInTheDocument();
    expect(screen.getAllByText("product_diagnosis.started").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Shopify mock dataset").length).toBeGreaterThan(0);
    expect(screen.getByText("Current queue")).toBeInTheDocument();
    expect(screen.getByText("Showing 1-10 of 12 processes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute("href", "/app/background-processes?page=2");
    expect(container.querySelectorAll(".ppBackgroundProcessList .ppBackgroundProcessCard")).toHaveLength(10);
  });

  it("hides background process log UI outside development mode", () => {
    renderWithRouter(<BackgroundProcessesScreen
      data={{
        developmentMode: false,
        backgroundProcesses: {
          updatedAt: "2026-05-24T15:00:00.000Z",
          activeProcesses: [],
          processes: [
            {
              id: "job-completed",
              name: "Product Diagnosis",
              displayTitle: "GEN EchoLock Voice Safe",
              displaySubtitle: "Product Diagnosis completed",
              status: "Completed",
              progress: 100,
              updatedAtIso: "2026-05-24T15:00:00.000Z",
              startedAtIso: "2026-05-24T14:59:00.000Z",
              executionStartedAtIso: "2026-05-24T14:59:00.000Z",
              finishedAtIso: "2026-05-24T15:00:00.000Z",
              elapsedMs: 60_000,
              logCount: 1,
              logs: [{ id: "log-1", jobId: "job-completed", level: "info", event: "product_diagnosis.completed", message: "Done.", createdAtIso: "2026-05-24T15:00:00.000Z" }],
            },
          ],
          logs: [{ id: "log-1", jobId: "job-completed", level: "info", event: "product_diagnosis.completed", message: "Done.", createdAtIso: "2026-05-24T15:00:00.000Z" }],
          stats: {
            total: 1,
            active: 0,
            running: 0,
            queued: 0,
            completed: 1,
            failed: 0,
            logs: 1,
            kindCounts: { "Product Diagnosis": 1 },
          },
        },
      }}
    />);

    expect(screen.getByText("GEN EchoLock Voice Safe")).toBeInTheDocument();
    expect(screen.queryByText("Event logs")).not.toBeInTheDocument();
    expect(screen.queryByText("Latest events")).not.toBeInTheDocument();
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
    expect(screen.queryByText("product_diagnosis.completed")).not.toBeInTheDocument();
  });

  it("searches live Shopify products without resubmitting the same query loop", async () => {
    const action = vi.fn(async ({ request }) => {
      const formData = await request.formData();
      const query = String(formData.get("query") || "");
      return {
        status: "success",
        query,
        products: [{
          id: "gid://shopify/Product/123",
          title: "Vintage Denim Jacket",
          handle: "vintage-denim-jacket",
          status: "ACTIVE",
          detail: "Zuam / Outerwear",
          sku: "VDJ-1",
          imageUrl: null,
          imageAlt: null,
          variant: "shirt",
          existingSnapshot: false,
        }],
      };
    });

    renderWithAction(<ProductsScreen data={defaultView} filters={{ query: "", risk: "all" }} />, action);
    fireEvent.click(screen.getAllByRole("button", { name: "Find Shopify product" })[0]);
    fireEvent.change(screen.getByPlaceholderText("Search by title, handle, product ID or SKU"), { target: { value: "denim" } });

    await waitFor(() => expect(screen.getByText("Vintage Denim Jacket")).toBeInTheDocument());
    await new Promise((resolve) => { window.setTimeout(resolve, 450); });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("keeps the Shopify search modal open while adding multiple candidates", async () => {
    const action = vi.fn(async ({ request }) => {
      const formData = await request.formData();
      if (formData.get("_action") === "add-shopify-product-candidate") {
        return {
          status: "success",
          message: "Product was added to Candidates without running a diagnosis.",
          action: {
            id: "add-shopify-product-candidate",
            productGid: String(formData.get("productId") || ""),
          },
        };
      }
      return {
        status: "success",
        query: String(formData.get("query") || ""),
        products: [
          {
            id: "gid://shopify/Product/123",
            title: "Vintage Denim Jacket",
            handle: "vintage-denim-jacket",
            status: "ACTIVE",
            detail: "Zuam / Outerwear",
            sku: "VDJ-1",
            imageUrl: null,
            imageAlt: null,
            variant: "shirt",
            existingSnapshot: false,
          },
          {
            id: "gid://shopify/Product/456",
            title: "Denim Tote",
            handle: "denim-tote",
            status: "ACTIVE",
            detail: "Zuam / Bags",
            sku: "DT-1",
            imageUrl: null,
            imageAlt: null,
            variant: "bag",
            existingSnapshot: false,
          },
        ],
      };
    });

    renderWithAction(<ProductsScreen data={defaultView} filters={{ query: "", risk: "all" }} />, action);
    fireEvent.click(screen.getAllByRole("button", { name: "Find Shopify product" })[0]);
    fireEvent.change(screen.getByPlaceholderText("Search by title, handle, product ID or SKU"), { target: { value: "denim" } });

    await waitFor(() => expect(screen.getByText("Vintage Denim Jacket")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Candidates" })[0]);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: "Find Shopify product" })).toBeInTheDocument();
    expect(screen.getByText("Denim Tote")).toBeInTheDocument();
    expect(screen.getByLabelText(/Added to Candidates.*still run Product Diagnosis/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Run Product Diagnosis" })[0]).not.toBeDisabled();
  });

  it("renders settings controls for thresholds and lookback", () => {
    const { container } = renderWithRouter(<SettingsScreen data={{
      ...defaultView,
      settings: {
        risk: { minimumScore: 50, mediumThreshold: 55, highThreshold: 75 },
        momentum: { minimumScore: 72 },
        analysis: { lookbackDays: 120 },
        htmlStyle: {
          preset: "professional-card",
          customTemplate: "",
        },
      },
    }} />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Product risk thresholds")).toBeInTheDocument();
    const minimumQuickScanScore = screen.getByLabelText("Minimum Catalog Scan score");
    expect(minimumQuickScanScore).toHaveValue("50");
    expect(minimumQuickScanScore).toHaveAttribute("min", "0");
    expect(screen.getByLabelText("Medium risk starts at")).toHaveValue("55");
    expect(screen.getByLabelText("High risk starts at")).toHaveValue("75");
    expect(container.querySelector(".ppSettingsRiskPreview")).not.toBeInTheDocument();
    expect(container.querySelector(".ppSettingsRiskHandleLabels")).not.toBeInTheDocument();
    expect(screen.getByText("Sales Momentum inclusion")).toBeInTheDocument();
    const minimumMomentumScore = screen.getByLabelText("Minimum Sales Momentum score");
    expect(minimumMomentumScore).toHaveValue("72");
    expect(minimumMomentumScore).toHaveAttribute("min", "0");
    fireEvent.change(minimumQuickScanScore, { target: { value: "3" } });
    expect(minimumQuickScanScore).toHaveValue("10");
    fireEvent.change(minimumMomentumScore, { target: { value: "20" } });
    expect(minimumMomentumScore).toHaveValue("50");
    expect(screen.queryByLabelText("Minimum Sales Momentum exact value")).not.toBeInTheDocument();
    expect(screen.queryByText("Table defaults")).not.toBeInTheDocument();
    expect(screen.queryByText("Queue limits")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Max diagnoses queued at once")).not.toBeInTheDocument();
    expect(screen.getByText("Evidence lookback")).toBeInTheDocument();
    expect(screen.getByLabelText("Analysis lookback days")).toHaveValue("120");
    expect(screen.getByText("Product HTML injection style")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Professional card/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Custom HTML template")).toHaveAttribute("placeholder", expect.stringContaining("{{CONTENT_HTML}}"));
    expect(screen.getByTitle("Product HTML style preview")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to Products" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cost control")).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenAI Batch/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start wizard" })).not.toBeInTheDocument();
    expect(screen.queryByText("Create Shopify mock dataset")).not.toBeInTheDocument();
  });

  it("shows development-only wizard and mock dataset controls in development mode", async () => {
    window.localStorage.setItem(WIZARD_STORAGE_KEY, "true");
    window.localStorage.setItem(WATCHLIST_WIZARD_STORAGE_KEY, "true");
    const wizardStartEvents = [];
    const watchlistWizardStartEvents = [];
    const handleWizardStart = (event) => wizardStartEvents.push(event);
    const handleWatchlistWizardStart = (event) => watchlistWizardStartEvents.push(event);
    window.addEventListener("productpulse:wizard-start", handleWizardStart);
    window.addEventListener("productpulse:watchlist-wizard-start", handleWatchlistWizardStart);

    const { router } = renderWithRouter(<SettingsScreen data={{
      ...defaultView,
      developmentMode: true,
      settings: {
        risk: { minimumScore: 50, mediumThreshold: 55, highThreshold: 75 },
        momentum: { minimumScore: 72 },
        analysis: { lookbackDays: 120 },
        htmlStyle: {
          preset: "professional-card",
          customTemplate: "",
        },
      },
      mockDataset: {
        config: {
          productCount: 2,
          orderCount: 4,
          customerCount: 3,
          reviewCount: 8,
          evolutionOrderCount: 1,
          stages: {},
        },
      },
    }} />, ["/app/settings"]);

    expect(screen.getByText("Start onboarding wizard")).toBeInTheDocument();
    expect(screen.getByText("Create Shopify mock dataset")).toBeInTheDocument();
    expect(screen.getByText("Create products")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start wizard" }));

    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBeNull();
    expect(wizardStartEvents).toHaveLength(1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/dashboard"));

    fireEvent.click(screen.getByRole("button", { name: "Start Watchlist wizard" }));

    expect(window.localStorage.getItem(WATCHLIST_WIZARD_STORAGE_KEY)).toBeNull();
    expect(watchlistWizardStartEvents).toHaveLength(1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/watchlist"));

    window.removeEventListener("productpulse:wizard-start", handleWizardStart);
    window.removeEventListener("productpulse:watchlist-wizard-start", handleWatchlistWizardStart);
  });

  it("uses the Shopify save bar guard when the wizard tries to leave dirty Settings", async () => {
    const leaveConfirmation = vi.fn(() => Promise.resolve());
    window.shopify = {
      saveBar: {
        show: vi.fn(() => Promise.resolve()),
        hide: vi.fn(() => Promise.resolve()),
        leaveConfirmation,
      },
    };
    const allowedEvents = [];
    const handleAllowed = (event) => allowedEvents.push(event);
    window.addEventListener("productpulse:wizard-settings-leave-allowed", handleAllowed);

    renderWithRouter(<SettingsScreen data={{
      ...defaultView,
      settings: {
        risk: { minimumScore: 50, mediumThreshold: 55, highThreshold: 75 },
        momentum: { minimumScore: 72 },
        analysis: { lookbackDays: 120 },
        htmlStyle: {
          preset: "professional-card",
          customTemplate: "",
        },
      },
    }} />, ["/app/settings"]);

    fireEvent.change(screen.getByLabelText("Minimum Catalog Scan score"), { target: { value: "42" } });

    act(() => {
      window.dispatchEvent(new CustomEvent("productpulse:wizard-request-settings-leave"));
    });

    await waitFor(() => expect(leaveConfirmation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(allowedEvents).toHaveLength(1));

    window.removeEventListener("productpulse:wizard-settings-leave-allowed", handleAllowed);
  });

  it("shows a scan overlay when a catalog scan starts", async () => {
    const wizardEvents = [];
    const handleWizardEvent = (event) => wizardEvents.push(event.detail?.type);
    window.addEventListener("productpulse:wizard", handleWizardEvent);

    try {
      renderWithRouter(<ProductsScreen data={defaultView} filters={{ query: "", risk: "all" }} />);
      fireEvent.click(screen.getAllByRole("button", { name: /Run Catalog Scan/ })[0]);
      expect(screen.getByRole("heading", { name: "Confirm Catalog Scan" })).toBeInTheDocument();
      expect(screen.getByText("Catalog Scan costs 1.0 diagnosis credit and runs as a background job.")).toBeInTheDocument();
      expect(screen.getByText(/Products that already have a Product Diagnosis will be ignored/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Accept cost and run Catalog Scan" }));
      expect(screen.getByText("Catalog Scan running")).toBeInTheDocument();
      expect(screen.getByText(/backend job will keep running/)).toBeInTheDocument();
      expect(screen.queryByText(/8%/)).not.toBeInTheDocument();
      expect(wizardEvents).toContain("quick-scan-started");
      await waitFor(() => expect(wizardEvents).toContain("quick-scan-job-started"));
    } finally {
      window.removeEventListener("productpulse:wizard", handleWizardEvent);
    }
  });

  it("recommends uploading CSV reviews before Catalog Scan when no review CSV is configured", () => {
    const data = {
      ...defaultView,
      quickScanCsvReviews: { available: false, connected: false, active: false, rowCount: 0 },
    };

    renderWithRouter(<ProductsScreen data={data} filters={{ query: "", risk: "all" }} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Run Catalog Scan/ })[0]);
    expect(screen.getByRole("heading", { name: "Add CSV reviews before Catalog Scan?" })).toBeInTheDocument();
    expect(screen.getByText(/ProductPulse does not call your review provider during Catalog Scan/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload CSV first" })).toHaveAttribute("href", "/app/connect");
    expect(screen.queryByRole("heading", { name: "Confirm Catalog Scan" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue without CSV" }));
    expect(screen.getByRole("heading", { name: "Confirm Catalog Scan" })).toBeInTheDocument();
  });

  it("keeps the catalog scan action available when product rows exist", async () => {
    const data = {
      ...defaultView,
      persistProductJobs: false,
      productTable: {
        rows: [{
          title: "Linen Shirt",
          variant: "shirt",
          selected: false,
          risk: "High",
          riskTone: "critical",
          riskScore: 84,
          riskTrend: [62, 70, 84],
          status: "Needs attention",
          statusTone: "critical",
          signals: 184,
          signalTone: "red",
          signalBars: [42, 62, 82, 98, 72, 50, 22],
          issue: "Fit & sizing",
          sources: [
            { key: "returns", label: "Returns", shortLabel: "RET", detail: "Shopify return units and return reasons." },
            { key: "refunds", label: "Refunds", shortLabel: "REF", detail: "Shopify refunded units and refund amount." },
            { key: "products", label: "Products", shortLabel: "PDP", detail: "Shopify product metadata." },
          ],
          sourceOverflow: 0,
          lastAnalysis: "Just now",
          lastAnalysisAt: "2026-05-12T22:00:00.000Z",
          credits: 1,
          href: "/app/products/linen-shirt",
          handle: "linen-shirt",
          productGid: "gid://shopify/Product/1",
          diagnosisJob: {
            id: "job-product-diagnosis-1",
            status: "Running",
            displaySubtitle: "Running Product Diagnosis",
          },
          imageUrl: "https://cdn.example.com/linen-shirt.jpg",
          imageAlt: "Linen product",
          productMomentum: {
            score: 86,
            tier: "Hot",
            direction: "Accelerating",
            confidence: 88,
            confidenceLabel: "High confidence",
            inputs: {
              unitsLast30Days: 42,
              revenueLast30Days: 3240,
              weeklyUnitsLast4Weeks: [4, 8, 12, 18],
            },
            components: {
              currentVelocityScore: 91,
              growthScore: 78,
              catalogShareScore: 82,
              trendConsistencyScore: 88,
              recencyScore: 100,
            },
            catalog: { topCatalogPercent: 12 },
            display: {
              growthLabel: "+68%",
              growthPercent: 68,
              catalogPositionLabel: "Top 12%",
              trendLabel: "Sales increasing over the last 4 weeks",
              recommendedUse: "Add to Watchlist",
            },
          },
          signalDetails: {
            summary: "Fit & sizing risk score 84/100 from 184 signals.",
            bars: [
              { label: "Return rate", value: 62, detail: "Return rate contribution." },
              { label: "Refund rate", value: 82, detail: "Refund amount contribution." },
            ],
          },
        }],
        total: 1,
      },
    };
    renderWithRouter(<ProductsScreen data={data} filters={{ query: "", risk: "all" }} />);
    expect(screen.getAllByRole("button", { name: /Run Catalog Scan/ }).length).toBeGreaterThan(0);
    expect(screen.getByText("Linen Shirt").closest("a")).toHaveAttribute("href", "/app/products/linen-shirt");
    expect(screen.getByAltText("Linen product")).toHaveAttribute("src", "https://cdn.example.com/linen-shirt.jpg");
    expect(screen.getByText("Diagnosis running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze Linen Shirt" })).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnosis running for Linen Shirt")).toBeInTheDocument();
    expect(screen.getByText("Diagnosis running").closest("tr")).toHaveClass("isDiagnosing");
    const productRiskCell = screen.getByText("84").closest(".ppRiskScoreCell");
    expect(within(productRiskCell).getByText("High")).toBeInTheDocument();
    expect(productRiskCell.querySelector(".ppImpactLevelIndicator-high")).toBeInTheDocument();
    expect(productRiskCell.querySelectorAll(".ppImpactLevelBars .isActive")).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: "Product risk" })[0]);
    expect(screen.getByText("↓")).toBeInTheDocument();
    expect(screen.getAllByText("Evidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sales Momentum").length).toBeGreaterThan(0);
    const trendLink = screen.getByRole("link", { name: "Rising risk trend for Linen Shirt" });
    expect(within(trendLink).getByText("Rising")).toBeInTheDocument();
    expect(screen.getByText("Hot 87")).toBeInTheDocument();
    expect(screen.getByText("+68% 30d · Top 12%")).toBeInTheDocument();
    expect(screen.getByText("Strong · 3 sources")).toBeInTheDocument();
    const momentumLink = screen.getByRole("link", { name: "Open Sales Momentum for Linen Shirt" });
    const momentumWrap = momentumLink.closest(".ppMomentumPopoverWrap");
    fireEvent.mouseEnter(momentumWrap);
    await waitFor(() => expect(document.body.querySelector(".ppMomentumToast")).toHaveTextContent("Sales Momentum"));
    expect(screen.getByText((_, element) => element?.classList.contains("ppMomentumToastHero") && element.textContent.includes("Hot · 87/100"))).toBeInTheDocument();
    expect(screen.getByText("42 units")).toBeInTheDocument();
    expect(screen.getByText("$3,240 revenue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Watchlist" })).not.toBeInTheDocument();
    fireEvent.mouseLeave(momentumWrap);
    await waitFor(() => expect(document.body.querySelector(".ppMomentumToast")).not.toBeInTheDocument());
    const evidenceLink = screen.getByRole("link", { name: "Open evidence for Linen Shirt" });
    expect(evidenceLink).toHaveAttribute("href", "/app/products/linen-shirt/evidence");
    fireEvent.mouseEnter(evidenceLink);
    expect(await screen.findByText("Main issue")).toBeInTheDocument();
    expect(screen.getByText("Recommended action")).toBeInTheDocument();
    expect(await screen.findByText("Return rate contribution.")).toBeInTheDocument();
    expect(screen.getByLabelText("3 sources used for this product")).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByLabelText("3 sources used for this product"));
    expect(await screen.findByText("Sources used")).toBeInTheDocument();
    expect(screen.getByText("Returns")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("Shopify product metadata.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Linen Shirt" }));
    const analyzeSelectedButton = screen.getByRole("button", { name: "Analyze selected (1)" });
    expect(analyzeSelectedButton).toBeEnabled();
    expect(analyzeSelectedButton).toHaveClass("ppAnalyzeLinkButton-primary");
    fireEvent.click(screen.getByRole("button", { name: "More actions for Linen Shirt" }));
    expect(screen.getByRole("menuitem", { name: /View Product Diagnosis/ })).toHaveAttribute("href", "/app/products/linen-shirt");
    expect(screen.getByRole("menuitem", { name: "Copy handle" })).toBeInTheDocument();
    const watchlistAction = screen.getByRole("menuitem", { name: "Diagnosis required for Watchlist" });
    expect(watchlistAction).toBeDisabled();
    expect(watchlistAction).toHaveAttribute("title", "Run Product Diagnosis before adding this product to Watchlist.");
    expect(screen.getByRole("menuitem", { name: "Delete analysis" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Mark for review" })).not.toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menuitem", { name: "Delete analysis" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Linen Shirt" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete analysis" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete Product Diagnosis?" });
    expect(within(deleteDialog).getByText(/does not delete or modify the Shopify product/i)).toBeInTheDocument();
    expect(within(deleteDialog).getByText(/Find Shopify product/)).toBeInTheDocument();
    expect(within(deleteDialog).getByRole("button", { name: "Delete analysis" })).toBeInTheDocument();
  });

  it("shows remove from Watchlist in product row actions when already watched", () => {
    const data = {
      ...defaultView,
      productTable: {
        rows: [{
          title: "Watched Linen Shirt",
          variant: "shirt",
          risk: "Low",
          riskTone: "success",
          riskScore: 42,
          status: "Healthy",
          statusTone: "success",
          analysisDepth: "quickscan",
          analysisLabel: "Catalog Scan only",
          analysisDetail: "Preliminary Shopify scan only.",
          analysisTone: "info",
          analysisIcon: "search",
          signals: 2,
          signalTone: "green",
          signalBars: [20, 0, 0, 10, 0],
          issue: "Low risk",
          sources: [],
          sourceOverflow: 0,
          lastAnalysis: "Just now",
          href: "/app/products/watched-linen-shirt",
          handle: "watched-linen-shirt",
          productGid: "gid://shopify/Product/9",
          isWatched: true,
        }],
        total: 1,
      },
    };
    renderWithRouter(<ProductsScreen data={data} filters={{ query: "", risk: "all" }} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Watched Linen Shirt" }));
    expect(screen.getByRole("menuitem", { name: "Remove from Watchlist" })).toBeInTheDocument();
  });

  it("submits product row resolution actions and reflects the resolved state", async () => {
    const product = makeTableProduct();
    const data = makeProductsData(product);
    let submittedAction = null;
    let submittedProductId = null;
    const action = vi.fn(async ({ request }) => {
      const formData = await request.formData();
      submittedAction = String(formData.get("_action") || "");
      submittedProductId = String(formData.get("productId") || "");
      return {
        status: "success",
        message: "Resolve Linen Shirt was marked as resolved.",
        action: {
          id: submittedAction,
          payload: {
            productGid: submittedProductId,
            resolvedAt: "2026-05-23T12:00:00.000Z",
          },
        },
      };
    });

    renderWithAction(<ProductsActionHarness data={data} filters={{ query: "", risk: "all" }} />, action);
    const table = screen.getByTestId("products-table");
    expect(within(table).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Resolve Linen Shirt" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as resolved" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(submittedAction).toBe("mark-resolved");
    expect(submittedProductId).toBe(product.productGid);
    await waitFor(() => expect(screen.getByText("Resolved just now")).toBeInTheDocument());
    expect(screen.getByText("Resolved just now").closest("tr")).toHaveClass("isResolved");

    fireEvent.click(screen.getByRole("button", { name: "More actions for Resolve Linen Shirt" }));
    expect(screen.getByRole("menuitem", { name: "Mark unresolved" })).toBeInTheDocument();
  });

  it("links product detail to product metric timelines", () => {
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={makeMetricTimelineProduct()} />);
    const link = screen.getByRole("link", { name: "Metric timelines" });

    expect(link).toHaveAttribute("href", "/app/products/timeline-jacket/metric-timelines");
    expect(container.querySelector(".ppProductMetricTimelineIcon")).toHaveAttribute("src", "/assets/metric-timelines-icon.png");
  });

  it("does not render the product timeline panel on product detail", () => {
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={makeMetricTimelineProduct()} />);

    expect(container.querySelector(".ppProductTimelinePanel")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Product Timeline" })).not.toBeInTheDocument();
    expect(screen.queryByText("Risk increased and one recommendation was applied after the latest Watchlist run.")).not.toBeInTheDocument();
    expect(screen.queryByText("No timeline events yet. ProductPulse will start building this timeline as scans, watchlist runs, Shopify updates and recommendations occur.")).not.toBeInTheDocument();
  });

  it("renders aligned product metric timeline charts", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-27T01:00:00.000Z").getTime());
    window.localStorage.removeItem(__productPulseScreensTestHooks.productMetricTimelineOrderStorageKey);
    const product = makeMetricTimelineProduct();
    const { container } = renderWithRouter(<ProductMetricTimelinesScreen product={product} />);

    expect(screen.getByRole("heading", { name: "Metric timelines" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to product" })).toHaveClass("ppProductBackButtonStandalone");
    expect(screen.getByText(/Timeline Jacket/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByText("Compare: previous signal")).not.toBeInTheDocument();
    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
    expect(screen.queryByText(/All charts share the same timeline/)).not.toBeInTheDocument();
    [
      "Product events",
      "Product risk",
      "Weekly order activity",
      "Return rate",
      "Refund leakage",
      "Estimated Margin Exposure",
      "Retention health",
      "Sales Momentum",
      "Diagnosis confidence",
      "Evidence support",
      "Customer signals",
      "Average rating",
      "Negative review pressure",
      "Main issue",
    ].forEach((title) => {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    });

    const charts = Array.from(container.querySelectorAll(".ppMetricTimelineChart"));
    expect(charts).toHaveLength(14);
    expect(container.querySelectorAll(".ppMetricTimelineChartSvg")).toHaveLength(0);
    expect(container.querySelectorAll(".ppMetricTimelineSummary")).toHaveLength(14);
    expect(container.querySelectorAll(".ppMetricTimelineChartPlot .recharts-wrapper")).toHaveLength(14);
    expect(container.querySelectorAll(".ppMetricTimelinePoint")).toHaveLength(0);
    expect(container.querySelectorAll(".ppMetricTimelineDragHandle")).toHaveLength(0);
    expect(within(charts[0]).getByText("Risk score history")).toBeInTheDocument();
    expect(within(charts[0]).getByText("70 / 100")).toBeInTheDocument();
    expect(within(charts[0]).getByText("+9 vs Apr 1")).toBeInTheDocument();
    expect(within(charts[1]).getByText("Orders, returns, refunds, revenue by week")).toBeInTheDocument();
    expect(within(charts[1]).getByText("28 orders")).toBeInTheDocument();
    expect(charts[1].querySelectorAll(".recharts-bar")).toHaveLength(0);
    expect(within(charts[1]).getByText("Orders")).toBeInTheDocument();
    expect(within(charts[1]).getByText("Returns")).toBeInTheDocument();
    expect(within(charts[1]).getByText("Refunds")).toBeInTheDocument();
    expect(within(charts[1]).getByText("Revenue")).toBeInTheDocument();
    expect(within(charts[2]).getByText("Return rate and product friction")).toBeInTheDocument();
    expect(within(charts[2]).getByText("36%")).toBeInTheDocument();
    expect(within(charts[2]).getByText("Return pressure")).toBeInTheDocument();
    expect(within(charts[3]).getByText("Refunds vs revenue")).toBeInTheDocument();
    const eventChartElement = charts[charts.length - 1];
    expect(within(eventChartElement).getByText("Operational timeline markers")).toBeInTheDocument();
    expect(within(eventChartElement).getByText("3 events")).toBeInTheDocument();
    expect(within(eventChartElement).getByText("3 groups · Jun to May 29")).toBeInTheDocument();
    const chartTextLabels = Array.from(eventChartElement.querySelectorAll("text")).map((node) => node.textContent);
    expect(chartTextLabels).toEqual(expect.arrayContaining(["Jun", "May 29"]));
    expect(eventChartElement.querySelectorAll(".ppMetricTimelineEventMarker")).toHaveLength(3);
    expect(eventChartElement.querySelectorAll(".ppMetricTimelineLegendIcon")).toHaveLength(3);
    expect(eventChartElement.querySelector(".ppMetricTimelineLegendLine")).not.toBeInTheDocument();

    const detail = __productPulseScreensTestHooks.getProductDetailModel(product);
    const model = __productPulseScreensTestHooks.getProductMetricTimelineModel(detail);
    expect(model.charts.map((chart) => chart.key)).toEqual([
      "product-risk",
      "monthly-order-activity",
      "return-rate",
      "refund-leakage",
      "financial-exposure",
      "retention-health",
      "product-momentum",
      "diagnosis-confidence",
      "evidence-strength",
      "customer-signals",
      "average-rating",
      "negative-review-pressure",
      "main-issue",
      "product-events",
    ]);
    expect(model.rangeLabel).toBe("Jun to May 29");
    const eventChart = model.charts.find((chart) => chart.key === "product-events");
    expect(eventChart.kind).toBe("events");
    expect(eventChart.pinPosition).toBe("bottom");
    expect(eventChart.points.map((point) => point.title)).toEqual([
      "Catalog Scan completed",
      "Product risk increased",
      "Recommended action applied",
    ]);
    expect(new Set(eventChart.points.filter((point) => point.dayKey === "2026-05-29").map((point) => point.lane)).size).toBe(2);
    const groupedEvent = eventChart.points.find((point) => point.id === "timeline-risk");
    expect(groupedEvent.dayEventCount).toBe(2);
    expect(groupedEvent.dayEventGroups.map((group) => `${group.label}:${group.events.length}`)).toEqual(["Risk:1", "Actions:1"]);
    expect(groupedEvent.dayEventCategorySummaries).toBeUndefined();
    const orderActivityChart = model.charts.find((chart) => chart.key === "monthly-order-activity");
    expect(orderActivityChart.points.map((point) => point.label)).toEqual(["Feb 9", "Mar 2", "Apr 6", "May 25"]);
    expect(orderActivityChart.legendItems.map((item) => item.label)).toEqual(["Orders", "Returns", "Refunds", "Revenue", "Unresolved returns"]);
    expect(model.charts.every((chart) => chart.points.every((point) => point.time >= new Date("2025-06-01T00:00:00.000Z").getTime()))).toBe(true);
    expect(model.charts.find((chart) => chart.key === "product-risk").points.map((point) => point.label)).toEqual([
      "Feb 15, 2026",
      "Mar 1, 2026",
      "Apr 1, 2026",
      "May 29, 2026",
    ]);
    const returnRateChart = model.charts.find((chart) => chart.key === "return-rate");
    expect(returnRateChart.secondaryLine).toMatchObject({ label: "Return pressure" });
    expect(returnRateChart.legendItems.map((item) => item.label)).toEqual(["Return rate", "Return pressure"]);
    expect(returnRateChart.data.map((point) => point.secondaryValue)).toEqual([14, 18, 23, 31]);
    const retentionChart = model.charts.find((chart) => chart.key === "retention-health");
    expect(retentionChart.secondaryLine).toMatchObject({ label: "Same-product repurchase 90d" });
    expect(retentionChart.legendItems.map((item) => item.label)).toEqual(["Retention health", "Same-product repurchase 90d"]);
    expect(retentionChart.data.map((point) => point.secondaryValue)).toEqual([18, 24, 31, 42]);
  });

  it("reorders product metric timeline charts and persists the shared order locally", async () => {
    const storageKey = __productPulseScreensTestHooks.productMetricTimelineOrderStorageKey;
    window.localStorage.removeItem(storageKey);

    const product = makeMetricTimelineProduct();
    const firstRender = renderWithRouter(<ProductMetricTimelinesScreen product={product} />);
    const chartKeys = (container) => Array.from(container.querySelectorAll(".ppMetricTimelineChart"))
      .map((chart) => chart.getAttribute("data-metric-key"));

    expect(chartKeys(firstRender.container).slice(0, 3)).toEqual(["product-risk", "monthly-order-activity", "return-rate"]);
    expect(chartKeys(firstRender.container).at(-1)).toBe("product-events");
    expect(screen.getByRole("button", { name: "Move Product events up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Product events down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Product risk up" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move Weekly order activity up" }));

    await waitFor(() => expect(chartKeys(firstRender.container).slice(0, 3)).toEqual(["monthly-order-activity", "product-risk", "return-rate"]));
    expect(chartKeys(firstRender.container).at(-1)).toBe("product-events");
    expect(JSON.parse(window.localStorage.getItem(storageKey)).slice(0, 3)).toEqual(["monthly-order-activity", "product-risk", "return-rate"]);

    firstRender.unmount();
    const secondRender = renderWithRouter(<ProductMetricTimelinesScreen product={product} />);
    await waitFor(() => expect(chartKeys(secondRender.container).slice(0, 3)).toEqual(["monthly-order-activity", "product-risk", "return-rate"]));
    expect(chartKeys(secondRender.container).at(-1)).toBe("product-events");
    window.localStorage.removeItem(storageKey);
  });

  it("syncs metric timeline hover state to the nearest x-axis point", () => {
    const {
      assignProductMetricTimelineEventPlotTimes,
      getProductMetricTimelineEventTooltipItems,
      getProductMetricTimelineVisibleEventMarkers,
      getProductMetricTimelineClickTime,
      getProductMetricTimelineLockedTooltipIndex,
      getProductMetricTimelineLockedTooltipPoint,
      getProductMetricTimelineNearestSyncIndex,
      getProductMetricTimelineTooltipLockProps,
    } = __productPulseScreensTestHooks;
    const time = (value) => new Date(value).getTime();
    const ticks = [
      { value: time("2026-02-01T00:00:00.000Z"), index: 0 },
      { value: time("2026-03-01T00:00:00.000Z"), index: 1 },
      { value: time("2026-05-01T00:00:00.000Z"), index: 2 },
    ];

    expect(getProductMetricTimelineNearestSyncIndex(ticks, { activeLabel: String(time("2026-02-20T00:00:00.000Z")) })).toBe(1);
    expect(getProductMetricTimelineNearestSyncIndex(ticks, { activeLabel: time("2026-04-20T00:00:00.000Z") })).toBe(2);
    expect(getProductMetricTimelineNearestSyncIndex(ticks, { activeLabel: "2026-02-10T00:00:00.000Z" })).toBe(0);
    expect(getProductMetricTimelineNearestSyncIndex(ticks, { activeLabel: time("2026-08-01T00:00:00.000Z") })).toBeUndefined();
    expect(getProductMetricTimelineNearestSyncIndex(ticks, { activeLabel: "", activeTooltipIndex: 9 })).toBe(2);

    const sparseChart = {
      data: [
        { time: time("2026-02-01T00:00:00.000Z"), value: 12 },
        { time: time("2026-05-01T00:00:00.000Z"), value: 30 },
      ],
    };
    expect(getProductMetricTimelineLockedTooltipIndex(sparseChart, time("2026-04-20T00:00:00.000Z"))).toBe(1);
    expect(getProductMetricTimelineLockedTooltipIndex(sparseChart, time("2026-03-20T00:00:00.000Z"))).toBeUndefined();
    expect(getProductMetricTimelineLockedTooltipPoint(sparseChart, 1)).toMatchObject({ value: 30 });
    expect(getProductMetricTimelineClickTime(sparseChart, { activeLabel: time("2026-05-01T00:00:00.000Z") })).toBe(time("2026-05-01T00:00:00.000Z"));
    expect(getProductMetricTimelineClickTime(sparseChart, { activeTooltipIndex: 0 })).toBe(time("2026-02-01T00:00:00.000Z"));
    expect(getProductMetricTimelineTooltipLockProps(1)).toMatchObject({ active: true, defaultIndex: 1, trigger: "click" });
    expect(getProductMetricTimelineTooltipLockProps(undefined)).toEqual({});

    const closeEvents = assignProductMetricTimelineEventPlotTimes(
      [
        { id: "first", time: time("2025-08-01T00:00:00.000Z"), value: 1 },
        { id: "second", time: time("2025-08-02T00:00:00.000Z"), value: 1 },
        { id: "third", time: time("2025-08-03T00:00:00.000Z"), value: 1 },
      ],
      {
        minTime: time("2025-08-01T00:00:00.000Z"),
        maxTime: time("2025-08-31T00:00:00.000Z"),
      },
    );
    expect(closeEvents.map((event) => event.time)).toEqual([
      time("2025-08-01T00:00:00.000Z"),
      time("2025-08-02T00:00:00.000Z"),
      time("2025-08-03T00:00:00.000Z"),
    ]);
    expect(closeEvents.map((event) => event.plotTime)).toEqual(closeEvents.map((event) => event.time));
    expect(getProductMetricTimelineClickTime(
      { kind: "events", data: closeEvents },
      { activeLabel: closeEvents[1].plotTime, activeTooltipIndex: 1 },
    )).toBe(time("2025-08-02T00:00:00.000Z"));

    const denseDayMarkers = getProductMetricTimelineVisibleEventMarkers(
      Array.from({ length: 8 }, (_, index) => ({
        id: `event-${index}`,
        title: `Event ${index + 1}`,
        category: "watchlist",
        eventType: "watch_event",
        time: time("2025-08-03T10:00:00.000Z"),
        dayKey: "2025-08-03",
        dayLabel: "Aug 3",
        lane: Math.min(index + 1, 5),
        value: Math.min(index + 1, 5),
      })),
    );
    expect(denseDayMarkers).toHaveLength(5);
    expect(denseDayMarkers.at(-1)).toMatchObject({ isOverflowMarker: true, overflowCount: 4, value: 5 });
    expect(denseDayMarkers.every((event) => event.time === time("2025-08-03T10:00:00.000Z"))).toBe(true);

    expect(getProductMetricTimelineEventTooltipItems({
      dayEvents: [
        { id: "late", time: time("2025-08-03T10:00:00.000Z"), title: "Late event", category: "risk" },
        { id: "early", time: time("2025-08-03T08:00:00.000Z"), title: "Early event", category: "watchlist" },
        { id: "middle", time: time("2025-08-03T09:00:00.000Z"), title: "Middle event", category: "actions" },
      ],
    }).map((event) => event.id)).toEqual(["early", "middle", "late"]);
  });

  it("keeps the Watchlist Recent Runs window stable for the same run list", () => {
    const {
      getWatchRecentRunsSignature,
      readWatchRecentRunsWindowStart,
      saveWatchRecentRunsWindowStart,
    } = __productPulseScreensTestHooks;
    const rows = [
      { id: "run-1", label: "May 12" },
      { id: "run-2", label: "May 13" },
      { id: "run-3", label: "May 14" },
      { id: "run-4", label: "May 15" },
      { id: "run-5", label: "May 16" },
      { id: "run-6", label: "May 17" },
    ];
    const signature = getWatchRecentRunsSignature(rows);

    saveWatchRecentRunsWindowStart(signature, 1);

    expect(readWatchRecentRunsWindowStart(signature, 4, 4)).toBe(1);
    expect(readWatchRecentRunsWindowStart("different-runs", 4, 4)).toBe(4);
    window.localStorage.removeItem(__productPulseScreensTestHooks.watchRecentRunsWindowStorageKey);
  });

  it("renders Product Diagnosis evidence and draft actions", () => {
    const { container } = renderWithAction(
      <ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />,
      async () => ({
        status: "success",
        action: { id: "fit-note", label: "Add fit note" },
        actionRecordStatus: "dismissed",
      }),
    );
    expect(screen.getByText(/Sizing & fit expectations are not being met/)).toBeInTheDocument();
    expect(screen.getByText("$24,700")).toBeInTheDocument();
    expect(screen.getByText("$9,200 estimated margin exposure")).toBeInTheDocument();
    expect(screen.getAllByText(/Fit runs small around waist and inseam/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Add fit note").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Product Diagnosis completed/ })).toBeInTheDocument();
    expect(screen.getByText("Re-analyze")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Core Linen Trouser" }));
    const watchButton = screen.getByRole("menuitem", { name: "Add to Watchlist" });
    expect(watchButton).toBeInTheDocument();
    fireEvent.click(watchButton);
    expect(screen.getByRole("heading", { name: "Add watched product" })).toBeInTheDocument();
    expect(screen.getByText(/configured automatic cadence/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Explore and review the evidence behind each detected issue.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Returns" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Total returns")).toBeInTheDocument();
    expect(screen.getByText("Returns over time")).toBeInTheDocument();
    expect(screen.getByText("Top return reasons")).toBeInTheDocument();
    expect(screen.getByText("Recent return notes")).toBeInTheDocument();
    const returnsReport = container.querySelector(".ppShopifyReturnsReport");
    const reasonNotesGrid = returnsReport.querySelector(".ppReturnsReasonNotesGrid");
    expect(within(reasonNotesGrid).getByText("Top return reasons")).toBeInTheDocument();
    expect(within(reasonNotesGrid).getByText("Recent return notes")).toBeInTheDocument();
    expect(within(reasonNotesGrid).getByRole("columnheader", { name: "Note" })).toBeInTheDocument();
    expect(within(reasonNotesGrid).getByRole("columnheader", { name: "Date" })).toBeInTheDocument();
    expect(within(returnsReport).queryByText("Description words")).not.toBeInTheDocument();
    expect(within(returnsReport).queryByText("Content quality")).not.toBeInTheDocument();
    expect(within(returnsReport).queryByText("Product type")).not.toBeInTheDocument();
    expect(within(returnsReport).queryByText("Vendor")).not.toBeInTheDocument();
    expect(within(returnsReport).queryByText("View full report")).not.toBeInTheDocument();
    expect(within(returnsReport).queryByText(/See technical evidence/)).not.toBeInTheDocument();
    expect(within(returnsReport).getByRole("link", { name: "Open full report" })).toHaveAttribute("href", "/app/products/core-linen-trouser/evidence?source=Returns");
    fireEvent.click(screen.getByRole("tab", { name: "Reviews" }));
    expect(screen.getByText("Total reviews")).toBeInTheDocument();
    expect(screen.getByText("Negative reviews")).toBeInTheDocument();
    expect(screen.getByText("Review sentiment")).toBeInTheDocument();
    expect(screen.getByText("Latest negative review examples")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Refunds" }));
    expect(screen.getAllByText("Refund amount").length).toBeGreaterThan(0);
    expect(screen.getByText("Refund reasons / context")).toBeInTheDocument();
    expect(screen.getByText("Recent refund notes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add fit note" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit suggested text for Add fit note" }));
    fireEvent.change(screen.getAllByLabelText("Description text to apply")[0], { target: { value: "Updated fit guidance for shoppers." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Apply change" })[0]);
    expect(screen.getByRole("heading", { name: "Confirm product description update" })).toBeInTheDocument();
    expect(screen.getAllByText("Updated fit guidance for shoppers.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add fit note" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.getByText(/dismissed for this product/)).toBeInTheDocument();
    expect(screen.getByText("Completed and dismissed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Add fit note" })).toHaveTextContent("Dismissed");
    expect(screen.queryByRole("heading", { name: "Add fit note" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Add fit note" }));
    expect(screen.getByRole("heading", { name: "Add fit note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo dismiss" })).toBeInTheDocument();
  });

  it("deduplicates repeated return and refund notes in product and full evidence panels", () => {
    const repeatedRefundNote = "Warehouse refund memo repeated from Shopify";
    const repeatedReturnNote = "Customer return memo repeated from Shopify";
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        refundInsights: {
          ...(defaultView.startHere.metrics.refundInsights || {}),
          examples: [
            { reasonText: "Damage", noteText: repeatedRefundNote, text: repeatedRefundNote, sentiment: "negative", createdAt: "2026-05-13T12:00:00Z" },
            { reasonText: "Damage", noteText: repeatedRefundNote, text: repeatedRefundNote, sentiment: "negative", createdAt: "2026-05-14T12:00:00Z" },
            { reasonText: "Customer request", noteText: "Separate refund memo from Shopify", text: "Separate refund memo from Shopify", sentiment: "neutral", createdAt: "2026-05-15T12:00:00Z" },
          ],
        },
        textInsights: {
          ...(defaultView.startHere.metrics.textInsights || {}),
          returns: {
            ...(defaultView.startHere.metrics.textInsights?.returns || {}),
            examples: [
              { text: repeatedReturnNote, date: "May 13, 2026" },
              { text: repeatedReturnNote, date: "May 14, 2026" },
              { text: "Separate return memo from Shopify", date: "May 15, 2026" },
            ],
          },
        },
      },
    };

    const diagnosisRender = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const returnsReport = diagnosisRender.container.querySelector(".ppShopifyReturnsReport");
    expect(within(returnsReport).getAllByText(repeatedReturnNote)).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "Refunds" }));
    const refundReport = diagnosisRender.container.querySelector(".ppRefundEvidenceReport");
    expect(within(refundReport).getAllByText(repeatedRefundNote)).toHaveLength(1);
    expect(within(refundReport).getByText("Separate refund memo from Shopify")).toBeInTheDocument();
    diagnosisRender.unmount();

    const fullEvidenceRender = renderWithRouter(<ProductEvidenceReportScreen product={product} source="Refunds" />);
    const fullEvidenceRefundReport = fullEvidenceRender.container.querySelector(".ppRefundEvidenceReport");
    expect(within(fullEvidenceRefundReport).getAllByText(repeatedRefundNote)).toHaveLength(1);
  });

  it("puts storefront and Shopify Admin in product actions", () => {
    const product = {
      ...defaultView.startHere,
      shopifyAdminUrl: "https://admin.shopify.com/store/zuam/products/123",
      shopifyStorefrontUrl: "https://zuam.example.com/products/core-linen-trouser",
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.queryByRole("link", { name: "Open in Shopify Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View in Store" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Core Linen Trouser" }));
    expect(screen.getByRole("menuitem", { name: "View in Store" })).toHaveAttribute("href", product.shopifyStorefrontUrl);
    expect(screen.getByRole("menuitem", { name: "View in Shopify admin" })).toHaveAttribute("href", product.shopifyAdminUrl);
  });

  it("marks a product resolved from the detail actions menu", async () => {
    const product = {
      ...defaultView.startHere,
      resolvedAt: null,
    };
    let submittedAction = null;
    let submittedProductId = null;
    const action = vi.fn(async ({ request }) => {
      const formData = await request.formData();
      submittedAction = String(formData.get("_action") || "");
      submittedProductId = String(formData.get("productId") || "");
      return {
        status: "success",
        message: "Core Linen Trouser was marked as resolved.",
        action: {
          id: submittedAction,
          payload: {
            productGid: submittedProductId,
            resolvedAt: "2026-05-23T12:00:00.000Z",
          },
        },
      };
    });

    renderWithAction(<ProductDiagnosisActionHarness data={defaultView} product={product} />, action);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Core Linen Trouser" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as resolved" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(submittedAction).toBe("mark-resolved");
    expect(submittedProductId).toBe(product.id);

    const titleHeading = screen.getByRole("heading", { name: "Core Linen Trouser" }).closest(".ppProductTitleHeading");
    await waitFor(() => expect(within(titleHeading).getByText("Resolved")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "More actions for Core Linen Trouser" }));
    expect(screen.getByRole("menuitem", { name: "Mark unresolved" })).toBeInTheDocument();
  });

  it("restores a dismissed recommended action from the action modal", async () => {
    let submittedAction = null;
    let submittedActionId = null;
    const action = vi.fn(async ({ request }) => {
      const formData = await request.formData();
      submittedAction = String(formData.get("_action") || "");
      submittedActionId = String(formData.get("actionId") || "");
      return {
        status: "success",
        action: { id: submittedActionId, label: "Add fit note" },
        actionRecordStatus: "active",
      };
    });

    const product = {
      ...defaultView.startHere,
      actionHistory: [{
        id: "dismissed-fit-note",
        actionId: "fit-note",
        label: "Add fit note",
        status: "dismissed",
        appliedAt: "2026-05-14T10:00:00.000Z",
      }],
    };

    renderWithAction(<ProductDiagnosisScreen data={defaultView} product={product} />, action);
    fireEvent.click(screen.getByRole("button", { name: "Expand Add fit note" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo dismiss" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(submittedAction).toBe("restore-action");
    expect(submittedActionId).toBe("fit-note");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Expand Add fit note" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open recommended action Add fit note" })).toBeInTheDocument();
  });

  it("shows saved product risk history below return-rate prediction", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        riskHistory: [
          {
            id: "history-1",
            riskScore: 72,
            source: "quickscan",
            recordedAt: "2026-05-01T12:00:00.000Z",
            primaryIssue: "Initial return anomaly",
            returnRate: 12,
            refundRate: 4,
            negativeReviewCount: 1,
            reviewCount: 12,
            avgRating: 4.2,
            refundAmount: 20,
            signalCount: 24,
          },
          {
            id: "history-2",
            riskScore: 88,
            source: "full-diagnosis",
            recordedAt: "2026-05-10T18:10:00.000Z",
            primaryIssue: "Fit runs small around waist and inseam",
            returnRate: 25,
            refundRate: 6,
            negativeReviewCount: 3,
            reviewCount: 14,
            avgRating: 3.7,
            refundAmount: 30,
            signalCount: 36,
          },
          {
            id: "history-3",
            riskScore: 92,
            source: "watchlist-scan",
            recordedAt: "2026-05-17T18:10:00.000Z",
            primaryIssue: "Refund pressure increased after new returns",
            returnRate: 26,
            refundRate: 14,
            negativeReviewCount: 5,
            reviewCount: 16,
            avgRating: 3.2,
            refundAmount: 150,
            signalCount: 44,
          },
        ],
        returnRatePrediction: {
          observedPoints: [{ key: "2026-05-04", label: "May 4", orders: 4, returnedOrders: 1, smoothedReturnRate: 25 }],
          forecastPoints: [{ key: "2026-05-11", label: "May 11", predictedReturnRate: 24 }],
          summary: {
            totalOrders: 4,
            totalReturnedOrders: 1,
            totalOrderUnits: 4,
            totalReturnedUnits: 1,
            totalReturnRate: 25,
            confidence: "Medium",
          },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const historyPanel = container.querySelector(".ppProductRiskHistoryPanel");

    expect(historyPanel).toBeInTheDocument();
    expect(historyPanel.closest(".ppProductDetailPrimary")).toBeInTheDocument();
    expect(historyPanel.closest(".ppProductDetailSidebar")).not.toBeInTheDocument();
    const predictionPanel = container.querySelector(".ppProductReturnPredictionPanel");
    expect(predictionPanel).toBeInTheDocument();
    expect(Boolean(predictionPanel.compareDocumentPosition(historyPanel) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(within(historyPanel).getByText("Product risk over time")).toBeInTheDocument();
    expect(within(historyPanel).getByRole("button", { name: "Collapse Product risk over time" })).toBeInTheDocument();
    expect(historyPanel.querySelector(".ppProductRiskHistoryCurrent")).not.toBeInTheDocument();
    expect(within(historyPanel).getByText("+4 pts")).toBeInTheDocument();
    expect(within(historyPanel).getAllByText("Return rate spike").length).toBeGreaterThan(0);
    expect(within(historyPanel).getAllByText("Refund pressure increased").length).toBeGreaterThan(0);
    expect(within(historyPanel).getByText("Medium risk 55")).toBeInTheDocument();
    expect(within(historyPanel).getAllByText("3 saved scores · May 1, 2026 to May 17, 2026").length).toBeGreaterThan(0);
    expect(historyPanel.querySelectorAll(".ppProductRiskHistoryMilestoneRule").length).toBeGreaterThan(0);
    expect(within(historyPanel).queryByText("Fit runs small around waist and inseam")).not.toBeInTheDocument();

    const savedScoresCard = within(historyPanel).getByRole("button", { name: "Saved scores: 3. May 1, 2026 - May 17, 2026" });
    fireEvent.mouseEnter(savedScoresCard);
    const cardTooltip = screen.getAllByRole("tooltip").find((tooltip) => tooltip.classList.contains("ppProductRiskHistoryCardPopover"));
    expect(cardTooltip).toHaveTextContent("Saved scores");
    expect(cardTooltip).toHaveTextContent("May 1, 2026 - May 17, 2026");
    fireEvent.mouseLeave(savedScoresCard);

    const trendCard = within(historyPanel).getByRole("button", { name: "Consistent uptrend: +20 pts across 3 saved scores" });
    fireEvent.mouseEnter(trendCard);
    const footerTooltip = screen.getAllByRole("tooltip").find((tooltip) => tooltip.classList.contains("ppProductRiskHistoryCardPopover"));
    expect(footerTooltip).toHaveTextContent("Consistent uptrend");
    expect(footerTooltip).toHaveTextContent("+20 pts across 3 saved scores");
    fireEvent.mouseLeave(trendCard);

    const latestRiskPoint = within(historyPanel).getByRole("button", { name: "May 17, 2026: product risk 92 of 100" });
    fireEvent.mouseEnter(latestRiskPoint);
    expect(latestRiskPoint).toHaveClass("isActive");
    const riskTooltip = screen.getAllByRole("tooltip").find((tooltip) => tooltip.classList.contains("ppProductRiskHistoryPopover"));
    expect(riskTooltip).toHaveTextContent("Refund pressure increased");
    expect(riskTooltip).toHaveTextContent("Refund rate");
    expect(riskTooltip).toHaveTextContent("14%");
  });

  it("shows bimonthly month labels on long product risk history charts", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        riskHistory: [
          { id: "history-nov", riskScore: 62, source: "quickscan", recordedAt: "2025-11-01T12:00:00.000Z", primaryIssue: "Initial risk" },
          { id: "history-jan", riskScore: 68, source: "watchlist-scan", recordedAt: "2026-01-01T12:00:00.000Z", primaryIssue: "January risk" },
          { id: "history-mar", riskScore: 76, source: "watchlist-scan", recordedAt: "2026-03-01T12:00:00.000Z", primaryIssue: "March risk" },
          { id: "history-may", riskScore: 82, source: "full-diagnosis", recordedAt: "2026-05-01T12:00:00.000Z", primaryIssue: "May risk" },
        ],
      },
    };

    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const historyPanel = container.querySelector(".ppProductRiskHistoryPanel");
    const xTickLabels = Array.from(historyPanel.querySelectorAll(".ppProductRiskHistoryXTick text")).map((node) => node.textContent);

    expect(xTickLabels).toEqual(expect.arrayContaining(["Jan 26", "Mar 26"]));
  });

  it("uses spaced Product Events milestones on product risk history", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        riskHistory: [
          { id: "history-jan", riskScore: 48, source: "quickscan", recordedAt: "2026-01-01T12:00:00.000Z" },
          { id: "history-feb", riskScore: 54, source: "watchlist-scan", recordedAt: "2026-02-01T12:00:00.000Z" },
          { id: "history-mar", riskScore: 66, source: "watchlist-scan", recordedAt: "2026-03-01T12:00:00.000Z" },
          { id: "history-apr", riskScore: 72, source: "full-diagnosis", recordedAt: "2026-04-01T12:00:00.000Z" },
          { id: "history-may", riskScore: 80, source: "full-diagnosis", recordedAt: "2026-05-01T12:00:00.000Z" },
        ],
      },
      timeline: {
        events: [
          {
            id: "review-surge",
            eventType: "negative_review_surge",
            category: "reviews",
            title: "Negative review surge",
            summary: "Reviews became materially more negative.",
            occurredAt: "2026-01-10T10:00:00.000Z",
            severityTone: "critical",
            tone: "red",
            importance: 94,
          },
          {
            id: "cluster-top",
            eventType: "risk_score_increased",
            category: "risk",
            title: "Risk spike flagged",
            summary: "Most important event in the January cluster.",
            occurredAt: "2026-01-12T10:00:00.000Z",
            severityTone: "critical",
            tone: "red",
            importance: 95,
          },
          {
            id: "returns",
            eventType: "return_pressure_spike",
            category: "returns",
            title: "Return cluster detected",
            summary: "Returns increased materially.",
            occurredAt: "2026-03-05T10:00:00.000Z",
            severityTone: "warning",
            tone: "orange",
            importance: 88,
          },
          {
            id: "action",
            eventType: "recommended_action_applied",
            category: "action",
            title: "Recommended action applied",
            summary: "A remediation was applied.",
            occurredAt: "2026-04-10T10:00:00.000Z",
            severityTone: "info",
            tone: "blue",
            importance: 78,
          },
          {
            id: "nearby-action",
            eventType: "recommended_action_applied",
            category: "action",
            title: "Nearby action duplicate",
            summary: "Close to the selected action event.",
            occurredAt: "2026-04-13T10:00:00.000Z",
            severityTone: "info",
            tone: "blue",
            importance: 77,
          },
        ],
      },
    };

    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const historyPanel = container.querySelector(".ppProductRiskHistoryPanel");

    expect(historyPanel).toBeInTheDocument();
    expect(historyPanel.querySelectorAll(".ppProductRiskHistoryMilestoneRule")).toHaveLength(3);
    expect(within(historyPanel).getAllByText("Negative review surge").length).toBeGreaterThan(0);
    expect(within(historyPanel).getAllByText("Return cluster detected").length).toBeGreaterThan(0);
    expect(within(historyPanel).getAllByText("Recommended action applied").length).toBeGreaterThan(0);
    expect(within(historyPanel).queryByText("Risk spike flagged")).not.toBeInTheDocument();
    expect(within(historyPanel).queryByText("Nearby action duplicate")).not.toBeInTheDocument();
  });

  it("uses evidence events instead of score-only milestones on product risk history", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        riskHistory: [
          {
            id: "history-base",
            riskScore: 60,
            source: "quickscan",
            recordedAt: "2026-05-01T12:00:00.000Z",
            negativeReviewCount: 1,
            reviewCount: 10,
            returnUnits: 1,
            avgRating: 4.4,
          },
          {
            id: "history-reviews",
            riskScore: 60,
            source: "watchlist-scan",
            recordedAt: "2026-05-22T09:00:00.000Z",
            negativeReviewCount: 13,
            reviewCount: 22,
            returnUnits: 1,
            avgRating: 3.8,
          },
          {
            id: "history-returns",
            riskScore: 60,
            source: "watchlist-scan",
            recordedAt: "2026-05-22T18:00:00.000Z",
            negativeReviewCount: 13,
            reviewCount: 22,
            returnUnits: 9,
            avgRating: 3.8,
          },
        ],
      },
    };

    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const historyPanel = container.querySelector(".ppProductRiskHistoryPanel");

    expect(historyPanel).toBeInTheDocument();
    expect(within(historyPanel).getAllByText("12 new negative reviews").length).toBeGreaterThan(0);
    expect(within(historyPanel).queryByText("Risk score jumped")).not.toBeInTheDocument();
    expect(historyPanel.querySelectorAll(".ppProductRiskHistoryMilestoneRule")).toHaveLength(1);

    const reviewPoint = within(historyPanel).getAllByRole("button", { name: "May 22, 2026: product risk 60 of 100" })[0];
    fireEvent.mouseEnter(reviewPoint);
    const riskTooltip = screen.getAllByRole("tooltip").find((tooltip) => tooltip.classList.contains("ppProductRiskHistoryPopover"));
    expect(riskTooltip).toHaveTextContent("12 new negative reviews");
    expect(riskTooltip).toHaveTextContent("1 -> 13 negative reviews");
    expect(riskTooltip).toHaveTextContent("Negative reviews");
    expect(riskTooltip).toHaveTextContent("13");
  });

  it("does not promote a single new negative review to a risk history milestone", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        riskHistory: [
          {
            id: "history-base",
            riskScore: 60,
            source: "quickscan",
            recordedAt: "2026-05-01T12:00:00.000Z",
            negativeReviewCount: 1,
            reviewCount: 10,
            avgRating: 4.4,
          },
          {
            id: "history-single-review",
            riskScore: 60,
            source: "watchlist-scan",
            recordedAt: "2026-05-22T09:00:00.000Z",
            negativeReviewCount: 2,
            reviewCount: 11,
            avgRating: 4.1,
          },
        ],
      },
    };

    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const historyPanel = container.querySelector(".ppProductRiskHistoryPanel");

    expect(historyPanel).toBeInTheDocument();
    expect(within(historyPanel).queryByText("1 new negative review")).not.toBeInTheDocument();
    expect(historyPanel.querySelectorAll(".ppProductRiskHistoryMilestoneRule")).toHaveLength(0);
  });

  it("renders Sales Momentum in the product detail view", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productMomentum: {
          score: 86,
          tier: "Hot",
          direction: "Accelerating",
          confidence: 88,
          confidenceLabel: "High confidence",
          components: {
            currentVelocityScore: 91,
            growthScore: 78,
            catalogShareScore: 82,
            trendConsistencyScore: 88,
            recencyScore: 100,
          },
          inputs: {
            unitsLast30Days: 42,
            unitsPrevious30Days: 25,
            revenueLast30Days: 3240,
            weeklyUnitsLast4Weeks: [4, 8, 12, 18],
            weeklyUnitsLast8Weeks: [2, 3, 4, 6, 8, 12, 15, 18],
          },
          catalog: {
            topCatalogPercent: 12,
          },
          display: {
            growthPercent: 68,
            growthLabel: "+68%",
            catalogPositionLabel: "Top 12%",
            trendLabel: "Sales increasing over the last 4 weeks",
          },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const panel = container.querySelector(".ppProductMomentumPanel");
    const sidebar = panel.closest(".ppProductDetailSidebar");
    const sidebarPanels = Array.from(sidebar.children);
    const recommendedPanelIndex = sidebarPanels.findIndex((element) => element.classList.contains("ppRecommendedActionsPanel"));
    const momentumPanelIndex = sidebarPanels.findIndex((element) => element.classList.contains("ppProductMomentumPanel"));
    const basketPanelIndex = sidebarPanels.findIndex((element) => element.classList.contains("ppBasketContextPanel"));
    const gauge = panel.querySelector(".ppProductMomentumGauge");
    const weeklyChart = panel.querySelector(".ppProductMomentumWeeklyChart");
    const momentumCard = Array.from(container.querySelectorAll(".ppProductInsight-withArea"))
      .find((card) => card.textContent.includes("Sales Momentum"));

    expect(screen.getAllByText("Sales Momentum").length).toBeGreaterThan(0);
    expect(sidebar).toBeInTheDocument();
    expect(recommendedPanelIndex).toBe(0);
    expect(momentumPanelIndex).toBeGreaterThan(recommendedPanelIndex);
    expect(basketPanelIndex).toBeGreaterThan(momentumPanelIndex);
    expect(gauge.querySelector(".ppProductMomentumGaugeCenter strong")).toHaveTextContent(/\d+\s*\/\s*100/);
    expect(within(gauge).getByText("/ 100")).toBeInTheDocument();
    expect(gauge).toBeInTheDocument();
    expect(gauge.querySelector(".ppProductMomentumGaugeArc")).toBeInTheDocument();
    expect(gauge.querySelector(".ppProductMomentumNeedle")).toBeInTheDocument();
    expect(weeklyChart).toBeInTheDocument();
    expect(within(weeklyChart).getByText("Units sold")).toBeInTheDocument();
    expect(weeklyChart).toHaveAttribute("aria-label", expect.stringContaining("Last 4 weekly units"));
    ["W-3", "W-2", "W-1", "Now"].forEach((label) => {
      expect(within(weeklyChart).getByText(label)).toBeInTheDocument();
    });
    ["4", "8", "12", "18"].forEach((value) => {
      expect(within(weeklyChart).getByText(value)).toBeInTheDocument();
    });
    expect(weeklyChart.querySelector(".ppProductMomentumWeeklyBarGroup.isLatest")).toBeInTheDocument();
    expect(weeklyChart.querySelector(".ppProductMomentumWeeklyStar")).toBeInTheDocument();
    expect(within(panel).getByText("Commercial signal")).toBeInTheDocument();
    expect(within(panel).getByText("Accelerating")).toBeInTheDocument();
    expect(within(panel).getByText("Sales increasing over the last 4 weeks")).toBeInTheDocument();
    expect(within(momentumCard).getByText("Last 8 weekly units")).toBeInTheDocument();
    expect(within(momentumCard).getByText("Accelerating")).toBeInTheDocument();
    expect(within(momentumCard).queryByText("Hot")).not.toBeInTheDocument();
    ["0", "25", "50", "75", "100"].forEach((label) => {
      expect(within(gauge).getByText(label)).toBeInTheDocument();
    });
    ["Velocity", "Growth", "Catalog share", "Trend consistency", "Recency"].forEach((label) => {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    });
    fireEvent.mouseEnter(within(panel).getByRole("button", { name: "Explain Velocity momentum component" }));
    const momentumTooltip = document.body.querySelector(".ppProductMomentumComponentPopover");
    expect(momentumTooltip).toBeInTheDocument();
    expect(within(momentumTooltip).getByText("Velocity")).toBeInTheDocument();
    expect(within(momentumTooltip).getByText(/selling right now compared with the catalog/i)).toBeInTheDocument();
    expect(panel.querySelector(".ppProductMomentumTrendBars")).not.toBeInTheDocument();
    expect(within(panel).getByText("High confidence")).toBeInTheDocument();
    expect(within(panel).getByText("42 units · $3,240 revenue in the last 30 days")).toBeInTheDocument();
  });

  it("renders persisted product retention metrics in the product detail view", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productRetention: {
          run: {
            status: "completed",
            windowStartDate: "2024-01-01",
            windowEndDate: "2024-06-30",
            timezone: "America/New_York",
          },
          summary: {
            repeatPurchaseRate90d: 0.248,
            repeatPurchaseRate180d: 0.314,
            sameProductRepurchaseRate90d: 0.181,
            sameProductRepurchaseRate180d: 0.206,
            crossSellRetentionRate90d: 0.125,
            returningRevenueShare: 0.412,
            avgDaysToSecondPurchase: 38,
            medianDaysToSecondPurchase: 29,
            productLtv90Cents: 8600,
            productLtv180Cents: 11200,
            retentionHealthScore: 72,
            totalCustomersAnalyzed: 120,
            totalOrdersAnalyzed: 240,
            totalProductOrdersAnalyzed: 156,
            hasEnoughData: true,
            lowSampleWarning: false,
          },
          dailyRetentionTrend: [
            { date: "2024-01-01", cohortSize: 42, repeatPurchaseRate90d: 0.24, sameProductRepurchaseRate90d: 0.16, crossSellRetentionRate90d: 0.12, isMature90d: true },
            { date: "2024-02-01", cohortSize: 38, repeatPurchaseRate90d: 0.28, sameProductRepurchaseRate90d: 0.18, crossSellRetentionRate90d: 0.15, isMature90d: true },
          ],
          nextPurchaseOutcome: [
            { date: "2024-01-01", sameProductAgainPercent: 0.14, boughtAnotherProductPercent: 0.26, didNotReturnPercent: 0.6 },
            { date: "2024-02-01", sameProductAgainPercent: 0.18, boughtAnotherProductPercent: 0.22, didNotReturnPercent: 0.6 },
          ],
          cohortHeatmap: [0, 30, 60, 90, 120, 150].map((ageDay, index) => ({
            cohortDate: "2024-01-01",
            ageDay,
            cohortSize: 42,
            anyRepeatRate: [0, 0.31, 0.22, 0.18, 0.14, 0.12][index],
            sameProductRepeatRate: [0, 0.18, 0.14, 0.12, 0.1, 0.09][index],
            boughtOtherProductRate: [0, 0.13, 0.08, 0.07, 0.06, 0.05][index],
            cumulativeLtvCents: [4300, 5800, 7100, 8600, 9900, 11200][index],
            isObserved: true,
          })),
          timeToRepeatPurchase: [
            { ageDay: 0, anyRepeatCumulativeRate: 0, sameProductRepeatCumulativeRate: 0, boughtOtherProductCumulativeRate: 0 },
            { ageDay: 7, anyRepeatCumulativeRate: 0.04, sameProductRepeatCumulativeRate: 0.02, boughtOtherProductCumulativeRate: 0.02 },
            { ageDay: 14, anyRepeatCumulativeRate: 0.09, sameProductRepeatCumulativeRate: 0.05, boughtOtherProductCumulativeRate: 0.04 },
            { ageDay: 21, anyRepeatCumulativeRate: 0.13, sameProductRepeatCumulativeRate: 0.08, boughtOtherProductCumulativeRate: 0.05 },
            { ageDay: 30, anyRepeatCumulativeRate: 0.18, sameProductRepeatCumulativeRate: 0.11, boughtOtherProductCumulativeRate: 0.08 },
            { ageDay: 45, anyRepeatCumulativeRate: 0.22, sameProductRepeatCumulativeRate: 0.13, boughtOtherProductCumulativeRate: 0.1 },
            { ageDay: 60, anyRepeatCumulativeRate: 0.25, sameProductRepeatCumulativeRate: 0.15, boughtOtherProductCumulativeRate: 0.11 },
            { ageDay: 90, anyRepeatCumulativeRate: 0.29, sameProductRepeatCumulativeRate: 0.17, boughtOtherProductCumulativeRate: 0.13 },
            { ageDay: 120, anyRepeatCumulativeRate: 0.31, sameProductRepeatCumulativeRate: 0.18, boughtOtherProductCumulativeRate: 0.15 },
            { ageDay: 180, anyRepeatCumulativeRate: 0.32, sameProductRepeatCumulativeRate: 0.19, boughtOtherProductCumulativeRate: 0.16 },
          ],
          ltvCurve: [
            { ageDay: 0, cumulativeLtvCents: 4300, sameProductLtvCents: 4300, otherProductLtvCents: 0 },
            { ageDay: 30, cumulativeLtvCents: 5800, sameProductLtvCents: 3600, otherProductLtvCents: 2200 },
            { ageDay: 90, cumulativeLtvCents: 8600, sameProductLtvCents: 5100, otherProductLtvCents: 3500 },
            { ageDay: 180, cumulativeLtvCents: 11200, sameProductLtvCents: 5650, otherProductLtvCents: 5550 },
          ],
          retentionHealthTrend: [
            { date: "2024-01-01", retentionHealthScore: 68, repeatPurchaseRate90d: 0.24, productLtv90Cents: 7400, source: "cohort" },
            { date: "2024-02-01", retentionHealthScore: 72, repeatPurchaseRate90d: 0.28, productLtv90Cents: 8600, source: "cohort" },
          ],
          segments: [
            {
              segmentType: "customer_type_at_first_product_purchase",
              segmentValue: "new_to_store",
              cohortSize: 120,
              repeatPurchaseRate90d: 0.21,
              sameProductRepurchaseRate90d: 0.14,
              crossSellRetentionRate90d: 0.11,
              ltv90Cents: 7400,
              medianDaysToSecondPurchase: 33,
              isLowSampleSize: false,
            },
          ],
        },
      },
      recommendedActions: [
        {
          id: "create-repurchase-campaign",
          label: "Create repurchase campaign",
          type: "Retention campaign",
          effort: "Medium",
          status: "Ready",
          payload: {
            source: "product_retention",
            recommendationKind: "repurchase_campaign",
            retentionActionKind: "repurchase_campaign",
            retentionMetrics: {
              healthScore: 72,
              sameProductRepurchaseRate90d: 0.181,
              crossSellRetentionRate90d: 0.125,
              totalProductCohortCustomers: 120,
            },
            campaignPlan: {
              objective: "Increase repeat purchases from customers who already showed same-product repurchase behavior.",
              audience: "Customers who bought this product and have not purchased it again within the expected repeat window.",
              timing: "Start around 22 days after purchase.",
              messageAngle: "Remind customers why they bought it and when replacement makes sense.",
              offerIdea: "Start with a light reminder.",
              successMetric: "Same-product repurchase rate.",
              guardrail: "Do not run if quality risk rises.",
            },
            campaignBrief: "Objective: Increase repeat purchases from customers who already showed same-product repurchase behavior.",
            priorityGroup: "Retention opportunity",
            impact: "Medium",
            applicationRisk: "Low",
            confidence: "High",
          },
        },
      ],
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const panel = container.querySelector(".ppProductRetentionPanel");

    expect(panel).toBeInTheDocument();
    expect(within(panel).getByText("Product retention metrics")).toBeInTheDocument();
    expect(within(panel).getByText("31.4%")).toBeInTheDocument();
    expect(within(panel).getByText("18.1%")).toBeInTheDocument();
    expect(within(panel).getByText("29 days")).toBeInTheDocument();
    expect(within(panel).getByText("$86")).toBeInTheDocument();
    expect(within(panel).getByText("72/100")).toBeInTheDocument();
    expect(within(panel).getByText("120 product cohort customers")).toBeInTheDocument();
    expect(within(panel).getByText("LTV Breakdown")).toBeInTheDocument();
    expect(within(panel).getByText("Retention action readout")).toBeInTheDocument();
    expect(within(panel).getByText("Create repurchase campaign")).toBeInTheDocument();
    expect(within(panel).getByText("Repurchase")).toBeInTheDocument();
    expect(within(panel).queryByText("Retention segments")).not.toBeInTheDocument();
    expect(within(panel).queryByText("New to store")).not.toBeInTheDocument();
    const retentionMain = panel.querySelector(".ppProductRetentionMain");
    const retentionSideRail = panel.querySelector(".ppProductRetentionSideRail");
    const retentionMetricGrid = panel.querySelector(".ppRetentionMetricGrid");
    expect(retentionMain).toContainElement(retentionMetricGrid);
    expect(retentionSideRail).not.toContainElement(retentionMetricGrid);
    const ltvCard = within(panel).getByText("LTV Breakdown").closest(".ppRetentionChartCard");
    expect(retentionMain).toContainElement(ltvCard);
    expect([...retentionMain.children].indexOf(retentionMetricGrid)).toBeLessThan([...retentionMain.children].indexOf(ltvCard));
    expect(ltvCard).toHaveClass("ppRetentionLtvBreakdownCard");
    expect(within(ltvCard).getByRole("button", { name: "Show LTV breakdown as cumulative dollars" })).toHaveClass("isActive");
    expect(within(ltvCard).getByRole("button", { name: "Show LTV breakdown as share" })).toBeInTheDocument();
    expect(within(ltvCard).queryByText("Initial product (1st purchase)")).not.toBeInTheDocument();
    expect(panel.querySelector(".ppProductRetentionSideRail")).toBeInTheDocument();
    expect(within(panel).getByText("LTV contribution (180 days)")).toBeInTheDocument();
    expect(within(panel).getByText("Key insights")).toBeInTheDocument();
    expect(within(panel).queryByText("Retention by purchase cohort")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Time to repeat purchase")).not.toBeInTheDocument();
    expect(within(panel).queryByText("90-day retention trend")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Next purchase outcome")).not.toBeInTheDocument();
    expect(within(container.querySelector(".ppRiskSnapshotBlock")).queryByText("Retention health")).not.toBeInTheDocument();

    expect(ltvCard.querySelector(".recharts-wrapper")).toBeInTheDocument();
    expect(within(ltvCard).queryByRole("button", { name: /LTV Breakdown, .* days:/ })).not.toBeInTheDocument();

    fireEvent.click(within(ltvCard).getByRole("button", { name: "Show LTV breakdown as share" }));
    expect(within(ltvCard).getByRole("button", { name: "Show LTV breakdown as share" })).toHaveClass("isActive");
    expect(within(ltvCard).getByText("LTV contribution share")).toBeInTheDocument();
    expect(within(ltvCard).getByText("Initial product (1st purchase)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Retention" }));
    const retentionReport = container.querySelector(".ppRetentionEvidenceReport");
    expect(retentionReport).toBeInTheDocument();
    expect(within(retentionReport).getByText("Cohort customers")).toBeInTheDocument();
    expect(within(retentionReport).getByText("Retention by purchase cohort")).toBeInTheDocument();
    expect(within(retentionReport).getByText("Time to repeat purchase")).toBeInTheDocument();
    const repeatCard = within(retentionReport).getByText("Time to repeat purchase").closest(".ppRetentionChartCard");
    expect(repeatCard).toHaveClass("ppRetentionRepeatCard");
    expect(within(repeatCard).getByText("Cumulative repurchase rate")).toBeInTheDocument();
    expect(within(repeatCard).getByText("Days since first purchase")).toBeInTheDocument();
    expect(within(repeatCard).getByText(/Cumulative % of customers/)).toBeInTheDocument();
    expect(within(repeatCard).queryByText("Bought another product")).not.toBeInTheDocument();
    expect(repeatCard.querySelectorAll(".ppRetentionLinePoint").length).toBeLessThanOrEqual(8);
    expect(within(retentionReport).getByText("90-day retention trend")).toBeInTheDocument();
    expect(within(retentionReport).getByText("Next purchase outcome")).toBeInTheDocument();
    expect(within(retentionReport).getByText("Retention window")).toBeInTheDocument();
    expect(retentionReport.querySelector(".ppRetentionCohortTable")).toBeInTheDocument();
    expect(retentionReport.querySelectorAll(".ppRetentionLineSvg").length).toBeGreaterThanOrEqual(2);
    expect(within(retentionReport).queryByText("Retention segments")).not.toBeInTheDocument();

    const recommendedActions = Array.from(container.querySelectorAll(".ppRecommendedActionsPanel .ppCompactRecommendedAction"));
    const retentionAction = recommendedActions.find((item) => within(item).queryByText("Create repurchase campaign"));
    expect(retentionAction).toBeInTheDocument();
    fireEvent.click(retentionAction);
    const dialog = screen.getByRole("dialog", { name: /create repurchase campaign/i });
    expect(within(dialog).getByText("Campaign plan")).toBeInTheDocument();
    expect(within(dialog).getByText("Audience")).toBeInTheDocument();
    expect(within(dialog).getByText(/customers who bought this product/i)).toBeInTheDocument();
  });

  it("renders momentum weekly bars as empty tracks for zero weeks and a visible spike", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productMomentum: {
          score: 95,
          tier: "Hot",
          direction: "New spike",
          confidence: 74,
          confidenceLabel: "Medium confidence",
          components: {
            currentVelocityScore: 98,
            growthScore: 100,
            catalogShareScore: 100,
            trendConsistencyScore: 70,
            recencyScore: 100,
          },
          inputs: {
            unitsLast30Days: 9,
            unitsPrevious30Days: 0,
            revenueLast30Days: 935,
            weeklyUnitsLast4Weeks: [0, 0, 0, 9],
          },
          display: {
            growthLabel: "+100%",
            catalogPositionLabel: "Top 2%",
            trendLabel: "Sales increasing over the last 4 weeks",
          },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const panel = container.querySelector(".ppProductMomentumPanel");
    const momentumCard = Array.from(container.querySelectorAll(".ppProductInsight-withArea"))
      .find((card) => card.textContent.includes("Sales Momentum"));
    const linePath = momentumCard.querySelector(".ppProductInsightAreaLine").getAttribute("d");
    const pathNumbers = linePath.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const firstLineY = pathNumbers[1];
    const lastLineY = pathNumbers[pathNumbers.length - 1];
    const componentValues = Array.from(panel.querySelectorAll(".ppProductMomentumComponent strong"))
      .map((element) => Number(element.textContent));
    const needleTransform = panel.querySelector(".ppProductMomentumNeedle").style.transform;

    expect(panel.querySelector(".ppProductMomentumGauge")).toBeInTheDocument();
    expect(needleTransform).toContain("rotate(");
    const weeklyChart = panel.querySelector(".ppProductMomentumWeeklyChart");
    expect(weeklyChart).toBeInTheDocument();
    expect(within(weeklyChart).getByText("10")).toBeInTheDocument();
    expect(within(weeklyChart).queryByText("30")).not.toBeInTheDocument();
    expect(weeklyChart.querySelector(".ppProductMomentumWeeklyBarGroup.isLatest .ppProductMomentumWeeklyBar")).toHaveStyle({ height: "90%" });
    expect(weeklyChart.querySelector(".ppProductMomentumWeeklyStar")).toBeInTheDocument();
    expect(within(weeklyChart).getByText("9")).toBeInTheDocument();
    expect(within(panel).getByText("New activity")).toBeInTheDocument();
    expect(within(panel).getByText("Latest-week sales spike after quiet weeks")).toBeInTheDocument();
    expect(componentValues.every((value) => value < 100)).toBe(true);
    expect(within(momentumCard).getByText("Last 4 weekly units")).toBeInTheDocument();
    expect(firstLineY - lastLineY).toBeGreaterThan(10);
  });

  it("describes intermittent Sales Momentum activity instead of calling it stable", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productMomentum: {
          score: 52,
          tier: "Stable",
          direction: "Steady",
          confidence: 52,
          confidenceLabel: "Low confidence",
          components: {
            currentVelocityScore: 45,
            growthScore: 52,
            catalogShareScore: 44,
            trendConsistencyScore: 30,
            recencyScore: 38,
          },
          inputs: {
            unitsLast7Days: 0,
            unitsLast30Days: 1,
            unitsPrevious30Days: 1,
            revenueLast30Days: 95,
            weeklyUnitsLast4Weeks: [0, 1, 0, 0],
          },
          display: {
            growthLabel: "0%",
            catalogPositionLabel: "Catalog baseline pending",
            trendLabel: "Sales activity is stable over the last 4 weeks",
          },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const panel = container.querySelector(".ppProductMomentumPanel");

    expect(within(panel).getByText("Intermittent activity; no latest-week sales")).toBeInTheDocument();
    expect(within(panel).queryByText("Sales activity is stable over the last 4 weeks")).not.toBeInTheDocument();
  });

  it("renders monthly order activity for Product Diagnosis", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        monthlyOrderActivity: {
          windowDays: 365,
          months: [
            {
              key: "2026-04",
              label: "Apr 2026",
              shortLabel: "Apr",
              orders: 8,
              orderUnits: 10,
              revenue: 1200,
              returnedOrders: 2,
              returnedUnits: 2,
              refundedOrders: 1,
              refundedUnits: 1,
              refundAmount: 150,
              returnRate: 25,
              refundRate: 12.5,
            },
            {
              key: "2026-05",
              label: "May 2026",
              shortLabel: "May",
              orders: 4,
              orderUnits: 5,
              revenue: 650,
              returnedOrders: 1,
              returnedUnits: 1,
              refundedOrders: 0,
              refundedUnits: 0,
              refundAmount: 0,
              returnRate: 25,
              refundRate: 0,
            },
          ],
          summary: {
            totalOrders: 12,
            totalOrderUnits: 15,
            totalRevenue: 1850,
            totalReturnedOrders: 3,
            totalReturnedUnits: 3,
            totalRefundedOrders: 1,
            totalRefundedUnits: 1,
            totalRefundAmount: 150,
            returnRate: 25,
            refundRate: 8.33,
            maxOrders: 8,
          },
        },
        chartInterpretations: {
          interpretations: {
            monthlyOrderActivity: {
              text: "Orders are concentrated in April and May while returns appear in both months, so the merchant should read demand and post-purchase friction together.",
            },
          },
        },
        returnRefundRelationshipSummary: relationshipSummaryFixture({
          sold_units: 15,
          sold_orders: 12,
          returned_units: 3,
          returned_orders: 3,
          refunded_units: 2,
          refunded_orders: 2,
          returned_and_refunded_units: 1,
          returned_not_refunded_units: 2,
          refunded_without_return_units: 1,
          attributed_refund_amount: 150,
          refund_amount_with_return: 90,
          refund_amount_without_return: 60,
          total_product_revenue: 1850,
          relationship_match_confidence_avg: 0.9,
        }),
      },
    };
    const storageKey = __productPulseScreensTestHooks.productDetailPanelCollapseStorageKey;
    const { container, unmount } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const orderPanel = container.querySelector(".ppProductOrderActivityPanel");

    expect(orderPanel).toBeInTheDocument();
    expect(within(orderPanel).getByText("Monthly order activity")).toBeInTheDocument();
    expect(within(orderPanel).getByRole("button", { name: "Collapse Monthly order activity" })).toBeInTheDocument();
    expect(within(orderPanel).queryByText("365-day window")).not.toBeInTheDocument();
    expect(within(orderPanel).getAllByText("Total orders").length).toBeGreaterThan(0);
    expect(within(orderPanel).getAllByText("Returned units").length).toBeGreaterThan(0);
    expect(within(orderPanel).getAllByText("Refunded units").length).toBeGreaterThan(0);
    expect(within(orderPanel).queryByText("Cohort month")).not.toBeInTheDocument();
    expect(within(orderPanel).getByText("$150")).toBeInTheDocument();
    expect(within(orderPanel).getByText("Apr")).toBeInTheDocument();
    expect(within(orderPanel).getByText("May")).toBeInTheDocument();
    expect(within(orderPanel).getByText("Revenue")).toBeInTheDocument();
    expect(within(orderPanel).getByText("AI interpretation")).toBeInTheDocument();
    expect(within(orderPanel).getByText(/Orders are concentrated in April and May/)).toBeInTheDocument();
    expect(within(orderPanel.querySelector(".ppOrderActivityYAxisRight")).getByText("$1,200")).toBeInTheDocument();
    expect(orderPanel.querySelector(".ppOrderActivityLineRevenue")).toBeInTheDocument();
    expect(orderPanel.querySelector(".ppOrderActivityLineUnresolved")).toBeInTheDocument();
    expect(orderPanel.querySelectorAll(".ppOrderActivityBarRefunds")).toHaveLength(1);
    expect(orderPanel.querySelectorAll(".ppOrderActivityBarReturns")).toHaveLength(2);
    expect(orderPanel.querySelectorAll(".ppOrderActivityBarTotal")).toHaveLength(2);
    expect(orderPanel.querySelector(".ppOrderActivityBarShell")?.firstElementChild).toHaveClass("ppOrderActivityBarTotal");
    expect(within(orderPanel).queryByRole("button", { name: "Resolution" })).not.toBeInTheDocument();
    fireEvent.click(within(orderPanel).getByRole("button", { name: "Hide orders" }));
    expect(orderPanel.querySelectorAll(".ppOrderActivityBarTotal")).toHaveLength(0);
    fireEvent.click(within(orderPanel).getByRole("button", { name: "Show orders" }));
    expect(orderPanel.querySelectorAll(".ppOrderActivityBarTotal")).toHaveLength(2);
    fireEvent.click(within(orderPanel).getByRole("button", { name: "Hide revenue line" }));
    expect(orderPanel.querySelector(".ppOrderActivityLineRevenue")).not.toBeInTheDocument();
    fireEvent.click(within(orderPanel).getByRole("button", { name: "Show revenue line" }));
    expect(orderPanel.querySelector(".ppOrderActivityLineRevenue")).toBeInTheDocument();
    fireEvent.click(within(orderPanel).getByRole("button", { name: "Hide unresolved returns line" }));
    expect(orderPanel.querySelector(".ppOrderActivityLineUnresolved")).not.toBeInTheDocument();
    fireEvent.click(within(orderPanel).getByRole("button", { name: "Show unresolved returns line" }));
    expect(orderPanel.querySelector(".ppOrderActivityLineUnresolved")).toBeInTheDocument();
    fireEvent.click(within(orderPanel).getByRole("button", { name: "Collapse Monthly order activity" }));
    expect(within(orderPanel).getByRole("button", { name: "Expand Monthly order activity" })).toHaveAttribute("aria-expanded", "false");
    expect(orderPanel.querySelector(".ppProductPanelCollapseRegion")).toHaveAttribute("aria-hidden", "true");
    expect(within(orderPanel).getByText("AI interpretation")).toBeVisible();
    expect(within(orderPanel).getByText(/Orders are concentrated in April and May/)).toBeVisible();
    expect(JSON.parse(window.localStorage.getItem(storageKey))).toMatchObject({ monthlyOrderActivity: true });

    unmount();
    const nextProduct = {
      ...product,
      title: "GEN Other Order Product",
      handle: "gen-other-order-product",
    };
    const { container: nextContainer } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={nextProduct} />);
    const nextOrderPanel = nextContainer.querySelector(".ppProductOrderActivityPanel");

    expect(nextOrderPanel).toBeInTheDocument();
    expect(within(nextOrderPanel).getByRole("button", { name: "Expand Monthly order activity" })).toHaveAttribute("aria-expanded", "false");
    expect(nextOrderPanel.querySelector(".ppProductPanelCollapseRegion")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(within(nextOrderPanel).getByRole("button", { name: "Expand Monthly order activity" }));
    expect(JSON.parse(window.localStorage.getItem(storageKey) || "{}")).not.toHaveProperty("monthlyOrderActivity");
  });

  it("renders a small AI interpretation fallback when chart text is missing", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        chartInterpretations: null,
        diagnosisReport: null,
        monthlyOrderActivity: {
          windowDays: 90,
          months: [
            {
              key: "2026-05",
              label: "May 2026",
              shortLabel: "May",
              orders: 3,
              orderUnits: 4,
              revenue: 420,
              returnedOrders: 1,
              returnedUnits: 1,
              refundedOrders: 0,
              refundedUnits: 0,
              refundAmount: 0,
              returnRate: 25,
              refundRate: 0,
            },
          ],
          summary: {
            totalOrders: 3,
            totalOrderUnits: 4,
            totalRevenue: 420,
            totalReturnedOrders: 1,
            totalReturnedUnits: 1,
            totalRefundedOrders: 0,
            totalRefundedUnits: 0,
            totalRefundAmount: 0,
            returnRate: 25,
            refundRate: 0,
          },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const orderPanel = container.querySelector(".ppProductOrderActivityPanel");

    expect(orderPanel).toBeInTheDocument();
    expect(within(orderPanel).getByText("AI interpretation")).toBeInTheDocument();
    expect(within(orderPanel).getByText("No AI interpretation generated for this chart yet.")).toBeInTheDocument();
    expect(orderPanel.querySelector(".ppProductChartAiInterpretation-empty")).toBeInTheDocument();
  });

  it("renders relationship-aware top cards and return/refund resolution panel", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        soldUnits: 19,
        signalCount: 41,
        returnUnits: 6,
        refundUnits: 2,
        refundAmount: 84,
        salesAmount: 800,
        evidenceStrengthScore: 76,
        riskHistory: [
          { recordedAt: "2026-04-01T00:00:00.000Z", evidenceStrengthScore: 42 },
          { recordedAt: "2026-05-01T00:00:00.000Z", evidenceStrengthScore: 76 },
        ],
        returnRefundRelationshipSummary: relationshipSummaryFixture({
          sold_units: 19,
          sold_orders: 14,
          returned_units: 6,
          returned_orders: 5,
          refunded_units: 2,
          refunded_orders: 2,
          returned_and_refunded_units: 2,
          returned_not_refunded_units: 4,
          refunded_without_return_units: 0,
          exchange_or_replacement_units: 1,
          pending_return_units: 1,
          attributed_refund_amount: 84,
          refund_amount_with_return: 84,
          refund_amount_without_return: 0,
          total_product_revenue: 800,
          relationship_match_confidence_avg: 1,
        }),
        returnRefundRelationshipFactors: {
          hasRelationshipSummary: true,
          returnPressure: {
            returnRateUnits: 31.6,
            returnedAndRefundedUnits: 2,
            returnedNotRefundedUnits: 4,
          },
          refundLeakage: {
            refundRateRevenue: 10.5,
            attributedRefundAmount: 84,
            refundAmountWithReturn: 84,
            refundAmountWithoutReturn: 0,
            unattributedRefundAmount: 0,
            refundAttributionRate: 100,
          },
          financialExposure: {
            hasRelationshipSummary: true,
            confirmedRefundAmount: 84,
            estimatedFutureRefundFromReturnOnlyCases: 180,
            returnRelatedRiskAmount: 180,
            relationshipAdjustedRefundAmount: 264,
          },
          customerSignalBreakdown: {
            linkedReturnRefundCount: 2,
            returnOnlyCount: 4,
            refundOnlyCount: 0,
          },
        },
        financialExposureBreakdown: {
          hasRelationshipSummary: true,
          confirmedRefundAmount: 84,
          estimatedFutureRefundFromReturnOnlyCases: 180,
          returnRelatedRiskAmount: 180,
          relationshipAdjustedRefundAmount: 264,
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const riskSnapshot = container.querySelector(".ppRiskSnapshotBlock");
    const resolutionPanel = container.querySelector(".ppReturnRefundResolutionPanel");

    expect(within(riskSnapshot).getByText("Product friction")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("6 of 19 units returned")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("2 linked refunds · 4 return-only")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("$84 confirmed refunds")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("$180 return-related risk")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("With return $84 · Without $0")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("2 linked · 4 return-only · 0 refund-only · 18 negative reviews")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("76 / 100")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Based on 41 signals · strong refund attribution")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Resolution breakdown")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Return resolution mix")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("refund-only")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("refund-only cases")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Exchange/replace")).toBeInTheDocument();
    expect(riskSnapshot.querySelector(".ppResolutionBreakdownInsightCard")).toBeInTheDocument();
    const cards = Array.from(riskSnapshot.querySelectorAll(".ppProductInsight-withArea"));
    expect(cards[cards.length - 1]).toHaveClass("ppResolutionBreakdownInsightCard");

    expect(resolutionPanel).not.toBeInTheDocument();
  });

  it("derives review cards from provider aggregates when top-level review totals are missing", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        reviewCount: 0,
        negativeReviewCount: 0,
        negativeReviewRate: 0,
        avgRating: 0,
        reviewRating: 0,
        csvAverageRating: 2,
        csvReviewCount: 2,
        csvNegativeReviewCount: 1,
        judgeMeAverageRating: 4,
        judgeMeReviewCount: 2,
        judgeMeNegativeReviewCount: 0,
        reviewSourceStats: {
          csv: { reviewCount: 2, negativeReviewCount: 1, avgRating: 2, negativeReviewRate: 50 },
          judgeMe: { reviewCount: 2, negativeReviewCount: 0, avgRating: 4, negativeReviewRate: 0 },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const riskSnapshot = container.querySelector(".ppRiskSnapshotBlock");
    const averageRatingCard = within(riskSnapshot).getByText("Average rating").closest(".ppProductInsight");
    const negativeReviewCard = within(riskSnapshot).getByText("Negative review pressure").closest(".ppProductInsight");

    expect(averageRatingCard).toHaveTextContent("3 / 5");
    expect(averageRatingCard).toHaveTextContent("4 reviews analyzed");
    expect(averageRatingCard).toHaveTextContent("1 negative · 25% negative rate");
    expect(negativeReviewCard).toHaveTextContent("25%");
    expect(negativeReviewCard).toHaveTextContent("1 negative reviews");
    expect(negativeReviewCard).toHaveTextContent("4 total reviews");
  });

  it("keeps Return pressure sparkline aligned to cumulative returns instead of refund-only events", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        soldUnits: 8,
        returnUnits: 6,
        refundUnits: 1,
        returnRate: 75,
        refundRate: 12.5,
        riskHistory: [
          { recordedAt: "2025-11-30T23:59:59.999Z", returnRate: 0, refundRate: 0 },
          { recordedAt: "2026-03-31T23:59:59.999Z", returnRate: 0, refundRate: 0 },
          { recordedAt: "2026-05-22T17:33:45.550Z", returnRate: 50, refundRate: 8.3 },
          { recordedAt: "2026-05-22T17:38:44.158Z", returnRate: 75, refundRate: 12.5 },
        ],
        monthlyOrderActivity: {
          summary: {
            totalOrderUnits: 8,
            totalReturnedUnits: 6,
            totalRefundedUnits: 1,
            returnRate: 75,
            refundRate: 12.5,
          },
          months: [
            { key: "2025-06", shortLabel: "Jun", orderUnits: 0, returnedUnits: 0, refundedUnits: 0 },
            { key: "2025-07", shortLabel: "Jul", orderUnits: 0, returnedUnits: 0, refundedUnits: 0 },
            { key: "2025-08", shortLabel: "Aug", orderUnits: 0, returnedUnits: 0, refundedUnits: 0 },
            { key: "2025-09", shortLabel: "Sep", orderUnits: 0, returnedUnits: 0, refundedUnits: 0 },
            { key: "2025-10", shortLabel: "Oct", orderUnits: 0, returnedUnits: 0, refundedUnits: 0 },
            { key: "2025-11", shortLabel: "Nov", orderUnits: 2, returnedUnits: 2, refundedUnits: 0 },
            { key: "2025-12", shortLabel: "Dec", orderUnits: 1, returnedUnits: 1, refundedUnits: 0 },
            { key: "2026-01", shortLabel: "Jan", orderUnits: 1, returnedUnits: 1, refundedUnits: 0 },
            { key: "2026-02", shortLabel: "Feb", orderUnits: 1, returnedUnits: 1, refundedUnits: 0 },
            { key: "2026-03", shortLabel: "Mar", orderUnits: 1, returnedUnits: 1, refundedUnits: 0 },
            { key: "2026-04", shortLabel: "Apr", orderUnits: 1, returnedUnits: 0, refundedUnits: 0 },
            { key: "2026-05", shortLabel: "May", orderUnits: 1, returnedUnits: 0, refundedUnits: 1 },
          ],
        },
        returnRefundRelationshipSummary: relationshipSummaryFixture({
          sold_units: 8,
          returned_units: 6,
          refunded_units: 1,
          returned_and_refunded_units: 0,
          returned_not_refunded_units: 0,
          refunded_without_return_units: 1,
          exchange_or_replacement_units: 2,
          pending_return_units: 4,
          relationship_match_confidence_avg: 1,
        }),
        returnRefundRelationshipFactors: {
          hasRelationshipSummary: true,
          returnPressure: {
            score: 100,
            returnRateUnits: 75,
            returnedAndRefundedUnits: 0,
            returnedNotRefundedUnits: 0,
          },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const riskSnapshot = container.querySelector(".ppRiskSnapshotBlock");
    const returnPressureCard = within(riskSnapshot).getByText("Return pressure").closest(".ppProductInsight");
    const endpointYValues = getSmoothPathEndpointYValues(returnPressureCard.querySelector(".ppProductInsightAreaLine").getAttribute("d"));
    const lastY = endpointYValues[endpointYValues.length - 1];
    const previousY = endpointYValues[endpointYValues.length - 2];

    expect(returnPressureCard).toHaveTextContent("75%");
    expect(returnPressureCard).toHaveTextContent("6 of 8 units returned");
    expect(endpointYValues.length).toBeGreaterThan(8);
    expect(lastY).toBeCloseTo(previousY, 1);
  });

  it("keeps missing return/refund relationship details out of the product detail page", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        returnRefundRelationshipSummary: null,
        returnRefundRelationshipFactors: null,
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const resolutionPanel = container.querySelector(".ppReturnRefundResolutionPanel");

    expect(resolutionPanel).not.toBeInTheDocument();
  });

  it("renders purchase context cards, charts and product-card attribution notes", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        variantCount: 4,
        productPurchaseContextSummary: purchaseContextSummaryFixture({
          total_orders_containing_product: 18,
          total_units_sold: 26,
          solo_product_order_count: 13,
          multi_product_order_count: 5,
          single_unit_order_count: 12,
          multi_unit_order_count: 6,
          bulk_order_count: 1,
          multi_variant_order_count: 3,
          avg_product_quantity_per_order: 1.4,
          avg_distinct_products_per_order: 1.8,
          top_co_purchased_products: [{
            productId: "gid://shopify/Product/care-kit",
            title: "Care Kit",
            co_order_count: 6,
            co_order_rate: 0.333,
            affinity_score: 2.1,
          }],
          basket_context_interpretation: "AI basket interpretation says this item is mostly read as a standalone purchase, but companion products and variant choice still matter when judging downstream friction.",
          monthly_context: [
            { key: "2026-04", label: "Apr", orders_containing_product: 8, solo_product_orders: 6, multi_product_orders: 2, avg_product_quantity_per_order: 1.2 },
            { key: "2026-05", label: "May", orders_containing_product: 10, solo_product_orders: 7, multi_product_orders: 3, avg_product_quantity_per_order: 1.6 },
          ],
          purchase_context_confidence: 86,
          purchase_context_confidence_label: "High",
        }),
        productPurchaseContextFactors: {
          hasPurchaseContextSummary: true,
          productRisk: { soloAttributionRisk: 3 },
          diagnosisConfidence: { purchaseContextScore: 6 },
          financialExposure: { bulkQuantityExposure: 25 },
          returnPressure: {
            returnRateWhenBoughtAlone: 7,
            returnRateWhenBoughtWithOthers: 18,
            returnRateForMultiVariantOrders: 22,
          },
          customerSignalBreakdown: { primaryContext: "Mostly solo purchase context" },
        },
        productPurchaseContextScoringImpact: [
          "This product is usually bought alone, so negative signals are easier to attribute to the product.",
        ],
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const purchasePanel = container.querySelector(".ppBasketContextPanel");
    const riskSnapshot = container.querySelector(".ppRiskSnapshotBlock");

    expect(purchasePanel).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Basket context")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Solo purchase rate")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Bought with other products")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Basket purchases")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Multi-unit orders")).toBeInTheDocument();
    expect(within(purchasePanel).getAllByText("72.2%").length).toBeGreaterThan(0);
    expect(within(purchasePanel).getAllByText("27.8%").length).toBeGreaterThan(0);
    expect(within(purchasePanel).getAllByText("1.4").length).toBeGreaterThan(0);
    expect(within(purchasePanel).getByText("Avg qty / order")).toBeInTheDocument();
    expect(within(purchasePanel).getAllByText("16.7%").length).toBeGreaterThan(0);
    expect(purchasePanel.querySelectorAll(".ppBasketContextBarRow").length).toBeGreaterThanOrEqual(9);
    expect(within(purchasePanel).getByText("Single Unit")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Multiple Unit")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Bulk")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("67%")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("28%")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("5%")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("12 orders")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Orders with more than one unit, below the bulk threshold of 4 units.")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Single Variant")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Multiple Variant")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("83%")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("17%")).toBeInTheDocument();
    expect(within(purchasePanel).getAllByText("Orders where the customer bought more than one variant of this product.").length).toBeGreaterThan(0);
    expect(within(purchasePanel).getByText("Strongest co-purchase")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Care Kit")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("AI interpretation")).toBeInTheDocument();
    expect(within(purchasePanel).getByText(/AI basket interpretation says this item is mostly read as a standalone purchase/i)).toBeInTheDocument();
    expect(within(purchasePanel).queryByText(/Run a Product Diagnosis/i)).not.toBeInTheDocument();
    expect(within(purchasePanel).queryByText(/Across 18 product-containing orders/i)).not.toBeInTheDocument();

    expect(within(riskSnapshot).getByText("72.2% solo purchase attribution")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Strong attribution: 72.2% solo purchase rate")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Bulk orders increase unit exposure")).toBeInTheDocument();
  });

  it("handles missing and unavailable purchase context without fake variant data", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        variantCount: 1,
        productPurchaseContextSummary: purchaseContextSummaryFixture({
          total_orders_containing_product: 6,
          total_units_sold: 6,
          solo_product_order_count: 0,
          multi_product_order_count: 6,
          single_unit_order_count: 6,
          multi_unit_order_count: 0,
          bulk_order_count: 0,
          multi_variant_order_count: 0,
          avg_product_quantity_per_order: 1,
          avg_distinct_products_per_order: 3.2,
          top_co_purchased_products: [],
          interpretation: "AI basket interpretation says basket-led attribution should be read through the surrounding order context before blaming this item alone.",
          purchase_context_confidence: 64,
          purchase_context_confidence_label: "Medium",
        }),
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const purchasePanel = container.querySelector(".ppBasketContextPanel");

    expect(within(purchasePanel).getByText("Basket context")).toBeInTheDocument();
    expect(within(purchasePanel).getByText("Bought with other products")).toBeInTheDocument();
    expect(within(purchasePanel).getAllByText("100%").length).toBeGreaterThan(0);
    expect(purchasePanel.querySelectorAll(".ppBasketContextBarRow.isZero").length).toBeGreaterThan(0);
    expect(within(purchasePanel).getByText(/AI basket interpretation says basket-led attribution/i)).toBeInTheDocument();
    expect(within(purchasePanel).queryByText(/Run a Product Diagnosis/i)).not.toBeInTheDocument();
    expect(within(purchasePanel).queryByText(/Across 6 product-containing orders/i)).not.toBeInTheDocument();
    expect(within(purchasePanel).getByText("No reliable co-purchase yet")).toBeInTheDocument();

    const noInterpretationProduct = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productPurchaseContextSummary: purchaseContextSummaryFixture({
          total_orders_containing_product: 3,
          solo_product_order_count: 2,
          multi_product_order_count: 1,
          single_unit_order_count: 3,
          multi_unit_order_count: 0,
          bulk_order_count: 0,
          multi_variant_order_count: 0,
          avg_product_quantity_per_order: 1,
          top_co_purchased_products: [],
        }),
      },
    };
    const noInterpretationRender = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={noInterpretationProduct} />);
    const noInterpretationPanel = noInterpretationRender.container.querySelector(".ppBasketContextPanel");
    expect(within(noInterpretationPanel).queryByText("AI interpretation")).not.toBeInTheDocument();
    expect(within(noInterpretationPanel).queryByText(/Run a Product Diagnosis/i)).not.toBeInTheDocument();
    noInterpretationRender.unmount();

    const missingProduct = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productPurchaseContextSummary: null,
      },
    };
    const missingRender = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={missingProduct} />);
    const missingPanel = missingRender.container.querySelector(".ppBasketContextPanel");
    expect(within(missingPanel).getByText("Purchase context not calculated yet. Run diagnosis after Shopify order evidence is available.")).toBeInTheDocument();
  });

  it("renders product relationship cards, timeline, trend, table and AI insights", () => {
    const relationshipSummary = productRelationshipSummaryFixture();
    relationshipSummary.source_product_id = defaultView.startHere.id;
    relationshipSummary.source_product_title = defaultView.startHere.title;
    relationshipSummary.top_bought_together = [
      {
        ...relationshipSummary.top_bought_together[0],
        related_product_id: defaultView.startHere.id,
        related_product_title: defaultView.startHere.title,
        attach_rate: 1,
        relationship_rate: 1,
      },
      ...relationshipSummary.top_bought_together,
    ];
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productRelationshipIntelligenceSummary: relationshipSummary,
        productRelationshipAiInsights: {
          available: true,
          insights: [{
            id: "relationship-insight-1",
            relatedProductTitle: "Refill Pack",
            summary: "Customers who buy this product are more likely to buy Refill Pack within 30 days.",
            caveat: "Association only; do not treat this as causality.",
          }],
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const riskSnapshot = container.querySelector(".ppRiskSnapshotBlock");
    const panel = container.querySelector(".ppProductRelationshipsPanel");
    const evidencePanel = container.querySelector(".ppEvidenceObservabilityPanel");

    expect(riskSnapshot).toBeInTheDocument();
    expect(within(riskSnapshot).queryByText("Relationship signal")).not.toBeInTheDocument();
    expect(evidencePanel).toBeInTheDocument();
    expect(within(evidencePanel).queryByText("Relationship signal")).not.toBeInTheDocument();
    expect(within(evidencePanel).queryByText("strong same-cart link")).not.toBeInTheDocument();
    expect(within(evidencePanel).queryByText("after-purchase path")).not.toBeInTheDocument();
    expect(within(evidencePanel).queryByText("Top related:")).not.toBeInTheDocument();
    expect(within(evidencePanel).queryByText("Nearby product relationships")).not.toBeInTheDocument();
    expect(evidencePanel.querySelector(".ppProductRelationshipSignalFooter")).not.toBeInTheDocument();
    expect(evidencePanel.querySelector(".ppProductRelationshipSignalVisual img")).not.toBeInTheDocument();
    expect(panel).toBeInTheDocument();
    expect(within(panel).queryByText("Relationship signal")).not.toBeInTheDocument();
    expect(panel.querySelector(".ppProductRelationshipSignalVisual img")).not.toBeInTheDocument();
    expect(within(panel).getByText("Product relationship timeline")).toBeInTheDocument();
    expect(within(panel).getAllByText("Same cart").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("Bought before").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("Bought after").length).toBeGreaterThan(0);
    expect(within(panel).getByText("Items purchased in the 90 days before")).toBeInTheDocument();
    expect(within(panel).getByText("Items purchased together")).toBeInTheDocument();
    expect(within(panel).getByText("Items purchased in the 90 days after")).toBeInTheDocument();
    expect(within(panel).getAllByText("8-30 days").length).toBeGreaterThanOrEqual(2);
    expect(within(panel).queryByText("31-90 days")).not.toBeInTheDocument();
    expect(panel.querySelector(".ppProductRelationshipTimelineCard")).toBeInTheDocument();
    expect(within(panel).getAllByText("Care Kit").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("Starter Guide").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("Refill Pack").length).toBeGreaterThan(0);
    expect(within(panel).getByText("42% attach rate")).toBeInTheDocument();
    expect(within(panel).getByText("30% within 30 days before")).toBeInTheDocument();
    expect(within(panel).getByText("25% within 30 days after")).toBeInTheDocument();
    expect(within(panel).getAllByText(/2\.4x lift/).length).toBeGreaterThan(0);
    fireEvent.mouseEnter(within(panel).getAllByRole("button", { name: "Relationship metric explanation for Care Kit" })[0]);
    const metricTooltip = document.body.querySelector(".ppProductRelationshipMetricPopover");
    expect(metricTooltip).toBeInTheDocument();
    expect(within(metricTooltip).getByText("How to read this relationship")).toBeInTheDocument();
    expect(within(metricTooltip).getByText(/Lift compares that rate with how often the related product appears across all known Shopify orders/)).toBeInTheDocument();
    expect(within(metricTooltip).getByText("Attach rate")).toBeInTheDocument();
    expect(within(metricTooltip).getByText("Store baseline")).toBeInTheDocument();
    expect(within(panel).getByAltText("Care Kit image")).toHaveAttribute("src", "https://cdn.example/care-kit.jpg");
    expect(within(panel).getByRole("link", { name: "Open Care Kit" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Run diagnosis" })).not.toBeInTheDocument();
    expect(within(panel).queryByText("Current product")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Source product")).not.toBeInTheDocument();
    expect(within(panel).queryByText(defaultView.startHere.title)).not.toBeInTheDocument();
  });

  it("groups product relationship timeline cards by timing bucket and expands overflow", () => {
    const makeRelationshipItem = (id, title, direction, days, rate = 0.18) => ({
      related_product_id: `gid://shopify/Product/${id}`,
      related_product_title: title,
      relationship_type: direction === "together" ? "same_order" : direction === "before" ? "previous_purchase" : "next_purchase",
      relationship_direction: direction,
      time_window: direction === "together" ? "same_order" : `${days}d_${direction}`,
      relationship_rate: rate,
      attach_rate: direction === "together" ? rate : undefined,
      lift: id === "same-two" ? 0.5 : 1.6,
      confidence: 76,
      confidence_label: "Medium",
      sample_size: 6,
      customer_count: 6,
      co_order_count: direction === "together" ? 6 : undefined,
      relationship_strength: "moderate",
      median_days_before: direction === "before" ? days : undefined,
      median_days_after: direction === "after" ? days : undefined,
    });
    const relationshipSummary = productRelationshipSummaryFixture({
      top_bought_before: [
        makeRelationshipItem("before-one", "Before One", "before", 3, 0.23),
        makeRelationshipItem("before-one", "Before One", "before", 18, 0.18),
        makeRelationshipItem("before-two", "Before Two", "before", 12, 0.2),
        makeRelationshipItem("before-three", "Before Three", "before", 18, 0.19),
        makeRelationshipItem("before-four", "Before Four", "before", 42, 0.17),
        makeRelationshipItem("before-five", "Before Five", "before", 48, 0.16),
        makeRelationshipItem("before-six", "Before Six", "before", 55, 0.15),
      ],
      top_bought_together: [
        makeRelationshipItem("same-one", "Same One", "together", 0, 0.3),
        makeRelationshipItem("same-two", "Same Two", "together", 0, 0.28),
        makeRelationshipItem("same-three", "Same Three", "together", 0, 0.26),
        makeRelationshipItem("same-four", "Same Four", "together", 0, 0.24),
        makeRelationshipItem("same-five", "Same Five", "together", 0, 0.22),
      ],
      top_bought_after: [
        makeRelationshipItem("after-one", "After One", "after", 5, 0.21),
        makeRelationshipItem("after-one", "After One", "after", 39, 0.22),
        makeRelationshipItem("after-two", "After Two", "after", 16, 0.19),
        makeRelationshipItem("after-three", "After Three", "after", 39, 0.17),
        {
          ...makeRelationshipItem("after-four", "After Four", "after", 90, 0.16),
          median_days_after: 18,
        },
      ],
    });
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productRelationshipIntelligenceSummary: relationshipSummary,
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const panel = container.querySelector(".ppProductRelationshipsPanel");
    const beforeColumn = panel.querySelector(".ppProductRelationshipTimelineSide-before");
    const togetherColumn = panel.querySelector(".ppProductRelationshipTimelineSide-together");
    const afterColumn = panel.querySelector(".ppProductRelationshipTimelineSide-after");

    expect(within(beforeColumn).getByText("0-7 days")).toBeInTheDocument();
    expect(within(beforeColumn).getByText("8-30 days")).toBeInTheDocument();
    expect(within(beforeColumn).getByText("30+ days")).toBeInTheDocument();
    expect(within(togetherColumn).getByText(/0\.5x vs baseline/)).toBeInTheDocument();
    expect(within(beforeColumn).queryByText("31-90 days")).not.toBeInTheDocument();
    expect(within(afterColumn).getByText("0-7 days")).toBeInTheDocument();
    expect(within(afterColumn).getByText("8-30 days")).toBeInTheDocument();
    expect(within(afterColumn).getByText("30+ days")).toBeInTheDocument();
    expect(within(beforeColumn).getAllByText("Before One")).toHaveLength(1);
    expect(within(beforeColumn).queryByText("18% within 18 days before")).not.toBeInTheDocument();
    expect(within(afterColumn).getAllByText("After One")).toHaveLength(1);
    expect(within(afterColumn).queryByText("22% within 39 days after")).not.toBeInTheDocument();
    const afterEightToThirtyBucket = within(afterColumn).getByRole("region", { name: "8-30 days relationship products" });
    const afterThirtyPlusBucket = within(afterColumn).getByRole("region", { name: "30+ days relationship products" });
    expect(within(afterEightToThirtyBucket).queryByText("After Four")).not.toBeInTheDocument();
    expect(within(afterThirtyPlusBucket).getByText("After Four")).toBeInTheDocument();
    expect(within(afterThirtyPlusBucket).getByText("16% within 90 days after")).toBeInTheDocument();
    expect(within(beforeColumn).queryByText("Before Six")).not.toBeInTheDocument();
    const beforeThirtyPlusBucket = within(beforeColumn).getByRole("region", { name: "30+ days relationship products" });
    fireEvent.click(within(beforeThirtyPlusBucket).getByRole("button", { name: "View more (3)" }));
    expect(within(beforeColumn).getByText("Before Six")).toBeInTheDocument();
    expect(within(beforeThirtyPlusBucket).getByRole("button", { name: "Show less" })).toBeInTheDocument();
    fireEvent.click(within(beforeThirtyPlusBucket).getByRole("button", { name: "Show less" }));
    expect(within(beforeColumn).queryByText("Before Six")).not.toBeInTheDocument();
    fireEvent.click(within(beforeColumn).getByRole("button", { name: "View all (6)" }));
    expect(within(beforeColumn).getByText("Before Six")).toBeInTheDocument();
    expect(within(beforeColumn).getByRole("button", { name: "Show less" })).toBeInTheDocument();
    expect(within(togetherColumn).queryByText("Same Five")).not.toBeInTheDocument();
    fireEvent.click(within(togetherColumn).getByRole("button", { name: "View all (5)" }));
    expect(within(togetherColumn).getByText("Same Five")).toBeInTheDocument();
    expect(within(beforeColumn).getAllByRole("link", { name: /^Open Before/ }).length).toBeGreaterThan(0);
  });

  it("renders specific empty relationship timeline states and keeps timeline connectors visible", () => {
    const sameCartEmptyProduct = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productRelationshipIntelligenceSummary: productRelationshipSummaryFixture({
          top_bought_together: [],
        }),
      },
    };
    const sameCartRender = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={sameCartEmptyProduct} />);
    const sameCartPanel = sameCartRender.container.querySelector(".ppProductRelationshipsPanel");
    expect(within(sameCartPanel).getByText("No reliable same-cart product yet")).toBeInTheDocument();
    expect(within(sameCartPanel).getByText(/not found enough same-order evidence/i)).toBeInTheDocument();
    expect(sameCartPanel.querySelectorAll(".ppProductRelationshipTimelineLineBefore").length).toBeGreaterThan(0);
    expect(sameCartPanel.querySelectorAll(".ppProductRelationshipTimelineLineTogether").length).toBeGreaterThan(0);

    const emptyProduct = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productRelationshipIntelligenceSummary: productRelationshipSummaryFixture({
          top_bought_before: [],
          top_bought_together: [],
          top_bought_after: [],
        }),
      },
    };
    const emptyRender = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={emptyProduct} />);
    const emptyPanel = emptyRender.container.querySelector(".ppProductRelationshipsPanel");
    expect(within(emptyPanel).getByText("No reliable earlier purchase yet")).toBeInTheDocument();
    expect(within(emptyPanel).getByText(/buy another product first, wait, and then buy this one/i)).toBeInTheDocument();
    expect(within(emptyPanel).getByText("No reliable same-cart product yet")).toBeInTheDocument();
    expect(within(emptyPanel).getByText("No reliable follow-up purchase yet")).toBeInTheDocument();
    expect(within(emptyPanel).getByText(/come back later and buy another product after this one/i)).toBeInTheDocument();
  });

  it("handles missing and low-confidence product relationship data without overemphasis", () => {
    const lowConfidenceProduct = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productRelationshipIntelligenceSummary: productRelationshipSummaryFixture({
          confidence: { score: 42, label: "Low", reasons: ["low_sample_size"] },
          relationships_with_return_risk_impact: [{
            related_product_id: "gid://shopify/Product/noisy-pair",
            related_product_title: "Noisy Pair",
            relationship_type: "same_order",
            relationship_direction: "together",
            time_window: "same_order",
            attach_rate: 0.4,
            relationship_rate: 0.4,
            lift: 3.1,
            confidence: 35,
            confidence_label: "Low",
            sample_size: 1,
            relationship_strength: "weak",
            trend: "insufficient_data",
            delta_return_rate: 0.28,
          }],
        }),
      },
    };
    const lowRender = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={lowConfidenceProduct} />);
    const lowPanel = lowRender.container.querySelector(".ppProductRelationshipsPanel");
    expect(lowPanel).toBeInTheDocument();
    expect(within(lowPanel).getByText("Product relationship timeline")).toBeInTheDocument();

    const missingProduct = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        productRelationshipIntelligenceSummary: null,
      },
    };
    const missingRender = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={missingProduct} />);
    const missingPanel = missingRender.container.querySelector(".ppProductRelationshipsPanel");
    expect(within(missingPanel).getByText("Not enough order history to detect product relationships yet.")).toBeInTheDocument();
  });

  it("renders return-rate prediction for Product Diagnosis", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        returnRatePrediction: {
          granularity: "weekly",
          windowDays: 90,
          observedPoints: [
            { key: "2026-04-06", label: "Apr 6", orders: 8, returnedOrders: 1, smoothedReturnRate: 12.5 },
            { key: "2026-04-13", label: "Apr 13", orders: 9, returnedOrders: 2, smoothedReturnRate: 18.2 },
            { key: "2026-04-20", label: "Apr 20", orders: 7, returnedOrders: 2, smoothedReturnRate: 21.4 },
          ],
          forecastPoints: [
            { key: "2026-05-18", label: "May 18", predictedReturnRate: 19.8, basePredictedReturnRate: 20 },
            { key: "2026-05-25", label: "May 25", predictedReturnRate: 18.9, basePredictedReturnRate: 19.4 },
          ],
          summary: {
            totalOrders: 24,
            totalReturnedOrders: 5,
            totalReturnRate: 20.83,
            last60DayReturnRate: 19.5,
            last30DayReturnRate: 22.2,
            forecastNext90ReturnRate: 19.35,
            confidence: "Medium",
          },
          actionAdjustment: {
            pending: 0,
            applied: 1,
            reviewed: 1,
            dismissed: 0,
            direction: "improving",
          },
        },
        chartInterpretations: {
          interpretations: {
            returnRatePrediction: {
              text: "The forecast remains close to the recent observed rate, so the product still carries near-term return pressure after current actions.",
            },
          },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const predictionPanel = container.querySelector(".ppProductReturnPredictionPanel");

    expect(predictionPanel).toBeInTheDocument();
    expect(within(predictionPanel).getByText("Return rate prediction")).toBeInTheDocument();
    expect(within(predictionPanel).getByText("Total return rate")).toBeInTheDocument();
    expect(within(predictionPanel).getByText("Last 60 days")).toBeInTheDocument();
    expect(within(predictionPanel).getByText("Last 30 days")).toBeInTheDocument();
    expect(within(predictionPanel).getByText("Next 3 months")).toBeInTheDocument();
    expect(within(predictionPanel).getByRole("button", { name: "Collapse Return rate prediction" })).toBeInTheDocument();
    expect(within(predictionPanel).queryByText("Medium confidence")).not.toBeInTheDocument();
    expect(within(predictionPanel).getByText("Forecast range")).toBeInTheDocument();
    expect(within(predictionPanel).getByText("AI interpretation")).toBeInTheDocument();
    expect(within(predictionPanel).getByText(/forecast remains close/)).toBeInTheDocument();
    expect(predictionPanel.querySelector(".ppReturnPredictionForecastRange")).toBeInTheDocument();
    expect(predictionPanel.querySelector(".ppReturnPredictionForecastRange")?.getAttribute("d")).toContain("Z");
    expect(predictionPanel.querySelector(".ppReturnPredictionImpactBadge")).toBeInTheDocument();
    expect(predictionPanel.querySelector(".ppReturnPredictionActionImpact")).not.toBeInTheDocument();
    expect(within(predictionPanel).getAllByText("0 points").length).toBeGreaterThan(0);
    fireEvent.mouseEnter(within(predictionPanel).getByRole("button", { name: "Recommendation impact 0 points" }));
    const impactTooltip = document.body.querySelector(".ppReturnPredictionImpactTooltip");
    expect(impactTooltip).toBeInTheDocument();
    expect(impactTooltip).toHaveClass("ppFloatingTablePopover");
    expect(predictionPanel.contains(impactTooltip)).toBe(false);
    const impactCounts = impactTooltip.querySelector(".ppReturnPredictionImpactCounts");
    expect(impactCounts).toHaveTextContent("1 applied");
    expect(impactCounts).toHaveTextContent("1 reviewed");
    expect(impactCounts).toHaveTextContent("0 dismissed");
    expect(impactCounts).toHaveTextContent("0 open");
    expect(within(impactTooltip).getByText(/pull the forecast downward/)).toBeInTheDocument();
  });

  it("shows a full-diagnosis prompt instead of commercial charts for Catalog Scan-only products", () => {
    const product = {
      ...defaultView.startHere,
      analysisDepth: "quickscan",
      analysisLabel: "Catalog Scan only",
      recommendedActions: [],
      metrics: {
        ...defaultView.startHere.metrics,
        latestDiagnosisId: null,
        lastDetailedDiagnosisAt: null,
        monthlyOrderActivity: {
          months: [{ key: "2026-05", label: "May 2026", orders: 4, orderUnits: 5, revenue: 650 }],
          summary: { totalOrders: 4, totalOrderUnits: 5, totalRevenue: 650 },
        },
        returnRatePrediction: {
          observedPoints: [{ key: "2026-05-04", label: "May 4", orders: 4, returnedOrders: 1 }],
          summary: { totalOrders: 4, totalReturnedOrders: 1 },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);

    expect(container.querySelector(".ppProductDeepDiagnosisPlaceholder")).toBeInTheDocument();
    expect(screen.getByText("Commercial charts are not available yet")).toBeInTheDocument();
    expect(container.querySelector(".ppProductOrderActivityPanel")).not.toBeInTheDocument();
    expect(container.querySelector(".ppProductReturnPredictionPanel")).not.toBeInTheDocument();
  });

  it("hides return prediction when orders exist but no returns are stored", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        monthlyOrderActivity: {
          months: [
            { key: "2026-05", label: "May 2026", shortLabel: "May", orders: 4, orderUnits: 5, revenue: 650 },
          ],
          summary: { totalOrders: 4, totalOrderUnits: 5, totalRevenue: 650, maxOrders: 4 },
        },
        returnRatePrediction: {
          observedPoints: [{ key: "2026-05-04", label: "May 4", orders: 4, orderUnits: 5, returnedOrders: 0, returnedUnits: 0 }],
          forecastPoints: [{ key: "2026-06-01", label: "Jun 1", predictedReturnRate: 0 }],
          summary: { totalOrders: 4, totalOrderUnits: 5, totalReturnedOrders: 0, totalReturnedUnits: 0 },
        },
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);

    expect(container.querySelector(".ppProductOrderActivityPanel")).toBeInTheDocument();
    expect(container.querySelector(".ppProductReturnPredictionPanel")).not.toBeInTheDocument();
  });

  it("shows product risk level and renders historical insight cards", () => {
    const product = {
      ...defaultView.startHere,
      riskScore: 50,
      riskTone: "info",
      metrics: {
        ...defaultView.startHere.metrics,
        riskTrend: [90, 40, 80, 50],
        riskHistory: [
          { riskScore: 90, source: "quickscan", recordedAt: "2026-04-20T10:00:00.000Z" },
          { riskScore: 40, source: "full-diagnosis", recordedAt: "2026-04-27T10:00:00.000Z" },
          { riskScore: 80, source: "watchlist", recordedAt: "2026-05-05T10:00:00.000Z" },
          { riskScore: 50, source: "full-diagnosis", recordedAt: "2026-05-16T10:00:00.000Z" },
        ],
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const riskSnapshot = container.querySelector(".ppRiskSnapshotBlock");

    expect(riskSnapshot).toBeInTheDocument();
    expect(riskSnapshot.querySelectorAll(".ppProductInsight-withArea")).toHaveLength(11);
    expect(riskSnapshot.querySelectorAll(".ppRiskSnapshot-primary .ppProductInsight-withArea")).toHaveLength(4);
    expect(riskSnapshot.querySelectorAll(".ppRiskSnapshot-extra .ppProductInsight-withArea")).toHaveLength(7);
    expect(riskSnapshot.querySelectorAll(".ppProductInsightAreaTrend")).toHaveLength(11);
    expect(riskSnapshot.querySelectorAll(".ppProductInsight-withArea .ppInsightInfoWrap")).toHaveLength(11);
    expect(within(riskSnapshot).getByRole("button", { name: /view more/i })).toHaveAttribute("aria-expanded", "false");
    expect(within(riskSnapshot).getByText("Emerging")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Improving")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Return pressure")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Refund leakage")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Evidence support")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Customer signals")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Average rating")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Negative review pressure")).toBeInTheDocument();
    const primaryInfoButton = within(riskSnapshot).getByRole("button", { name: "What Product risk means" });
    fireEvent.pointerEnter(primaryInfoButton);
    expect(screen.getByText(/how severe the product problem is over time/i)).toBeInTheDocument();
    fireEvent.pointerLeave(primaryInfoButton);
    fireEvent.click(within(riskSnapshot).getByRole("button", { name: /view more/i }));
    expect(riskSnapshot).toHaveClass("isExpanded");
    expect(within(riskSnapshot).getByRole("button", { name: /show less/i })).toHaveAttribute("aria-expanded", "true");
    const hiddenInfoButton = within(riskSnapshot).getByRole("button", { name: "What Refund leakage means" });
    fireEvent.pointerEnter(hiddenInfoButton);
    const expandedTooltip = screen.getByText(/sales value is leaking into refunds/i).closest("[role='tooltip']");
    expect(expandedTooltip).toHaveTextContent(/sales value is leaking into refunds/i);
    expect(riskSnapshot).not.toContainElement(expandedTooltip);
    fireEvent.pointerLeave(hiddenInfoButton);
    fireEvent.click(within(riskSnapshot).getByRole("button", { name: /show less/i }));
    expect(riskSnapshot).not.toHaveClass("isExpanded");
  });

  it("lets product detail remove an already watched product", () => {
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={{ ...defaultView.startHere, isWatched: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Core Linen Trouser" }));
    const watchButton = screen.getByRole("menuitem", { name: "Remove from Watchlist" });
    expect(watchButton).toBeInTheDocument();
    fireEvent.click(watchButton);
    expect(screen.getByRole("heading", { name: "Remove watched product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from Watchlist" })).toBeInTheDocument();
  });

  it("lets product detail delete local analysis from product actions", () => {
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Core Linen Trouser" }));
    const deleteButton = screen.getByRole("menuitem", { name: "Delete analysis" });
    expect(deleteButton).toBeInTheDocument();
    fireEvent.click(deleteButton);
    const deleteDialog = screen.getByRole("dialog", { name: "Delete Product Diagnosis?" });
    expect(within(deleteDialog).getByText(/does not delete or modify the Shopify product/i)).toBeInTheDocument();
    expect(within(deleteDialog).getByRole("button", { name: "Delete analysis" })).toBeInTheDocument();
  });

  it("compacts applied recommended actions after successful Shopify changes", async () => {
    renderWithRouter(<ProductDiagnosisScreen
      data={defaultView}
      product={defaultView.startHere}
      actionData={{
        status: "success",
        message: "Add fit note was applied.",
        action: { id: "fit-note", label: "Add fit note" },
      }}
    />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Expand Add fit note" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Add fit note" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Add fit note" })).toHaveTextContent("Applied");
    fireEvent.click(screen.getByRole("button", { name: "Expand Add fit note" }));
    expect(screen.getByRole("heading", { name: "Add fit note" })).toBeInTheDocument();
  });

  it("lets FAQ recommendations choose the Shopify application format", async () => {
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />);

    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add sizing FAQ" }));
    const faqDialog = screen.getByRole("dialog", { name: "Add sizing FAQ" });
    expect(within(faqDialog).getByRole("group", { name: "How to apply Add sizing FAQ" })).toBeInTheDocument();
    expect(within(faqDialog).getByRole("button", { name: /Collapsible FAQ/ })).toHaveClass("isSelected");
    const faqPreviewItem = within(faqDialog).getByText("How does this trouser fit?").closest(".ppActionFaqPreviewItem");
    expect(faqPreviewItem).toBeInTheDocument();
    expect(faqPreviewItem?.querySelector("p")).toHaveTextContent("This trouser has a closer fit around the waist and inseam.");

    fireEvent.click(within(faqDialog).getByRole("button", { name: /Product metafield/ }));
    await waitFor(() => expect(within(faqDialog).getByRole("button", { name: /Product metafield/ })).toHaveClass("isSelected"));
    expect(within(faqDialog).getByLabelText("FAQ metafield namespace")).toHaveValue("productpulse");
    expect(within(faqDialog).getByLabelText("FAQ metafield key")).toHaveValue("faq_html");
    fireEvent.change(within(faqDialog).getByLabelText("FAQ metafield key"), { target: { value: "buyer_faq_html" } });
    fireEvent.click(within(faqDialog).getByRole("button", { name: "Apply change" }));
    expect(screen.getByRole("heading", { name: "Confirm FAQ metafield update" })).toBeInTheDocument();
    expect(screen.getAllByText(/productpulse\.buyer_faq_html/).length).toBeGreaterThan(0);
  });

  it("minimizes and expands the recommended actions panel", () => {
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />);
    expect(container.querySelector(".ppProductDetailSidebar .ppRecommendedActionsPanel")).toBeInTheDocument();
    expect(container.querySelector(".ppProductDetailSidebar .ppProductEvidenceSummaryPanel")).toBeInTheDocument();
    expect(container.querySelector(".ppProductDetailFullWidth .ppEvidenceObservabilityPanel")).toBeInTheDocument();
    expect(container.querySelector(".ppProductDetailPrimary .ppEvidenceObservabilityPanel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open recommended action Add fit note" })).toBeInTheDocument();
    expect(screen.getByText(/customers report this trouser runs small/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/customers report this trouser runs small/)).not.toBeInTheDocument();
    expect(screen.getByText("3 actions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("button", { name: "Minimize" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add fit note" }));
    expect(screen.getAllByText(/customers report this trouser runs small/).length).toBeGreaterThan(0);
  });

  it("orders recommended actions by customer-facing high-impact fixes before internal or sensitive actions", () => {
    const product = {
      ...defaultView.startHere,
      confidence: 84,
      sourceCoverage: ["Shopify returns", "Reviews", "Product content"],
      recommendedActions: [
        {
          id: "apply-risk-tags",
          label: "Add internal risk tags",
          type: "Workflow tags",
          effort: "Low",
          status: "Ready",
          payload: {
            tags: ["risk-medium"],
            impact: "Optional",
            visibility: "Internal",
            confidence: "High",
            evidenceStrength: "Strong",
            applicationRisk: "Low",
            actionTier: 3,
          },
        },
        {
          id: "set-product-draft",
          label: "Change product status",
          type: "High-risk action",
          effort: "High",
          status: "Manual approval required",
          payload: {
            productStatus: "DRAFT",
            impact: "High",
            visibility: "Operational",
            confidence: "High",
            evidenceStrength: "Strong",
            applicationRisk: "High",
            actionTier: 1,
          },
        },
        {
          id: "create-product-faq",
          label: "Add product FAQ",
          type: "PDP copy",
          effort: "Low",
          status: "Ready",
          payload: {
            faqItems: [{ question: "How does it fit?", answer: "It runs slim through the chest." }],
            impact: "High",
            visibility: "Customer-facing",
            confidence: "High",
            evidenceStrength: "Strong",
            applicationRisk: "Low",
            actionTier: 1,
          },
        },
        {
          id: "recommend-qa-review",
          label: "Supplier / QA review",
          type: "QA review",
          effort: "Medium",
          status: "Ready",
          payload: {
            impact: "High",
            visibility: "Operational",
            confidence: "High",
            evidenceStrength: "Strong",
            applicationRisk: "Low",
            actionTier: 1,
          },
        },
      ],
    };

    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const recommendedActionsOverflow = container.querySelector(".ppRecommendedActionsOverflow");

    const actionButtons = screen.getAllByRole("button", { name: /Open recommended action/ });
    expect(actionButtons[0]).toHaveAccessibleName("Open recommended action Add product FAQ");
    expect(within(actionButtons[0]).getByText("Primary next step")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort recommended actions" })).toHaveDisplayValue("Sort by priority");
    expect(within(actionButtons[0]).getByText("How does it fit? It runs slim through the chest.")).toBeInTheDocument();
    expect(within(actionButtons[0]).getByText("Impact")).toBeInTheDocument();
    expect(within(actionButtons[0]).getByText("Risk")).toBeInTheDocument();
    expect(within(actionButtons[0]).getByText("Effort")).toBeInTheDocument();
    expect(within(actionButtons[0]).getByText("Confidence")).toBeInTheDocument();
    expect(within(actionButtons[0]).getAllByText("Low").length).toBeGreaterThanOrEqual(2);
    expect(within(actionButtons[0]).getAllByText("High").length).toBeGreaterThanOrEqual(2);
    expect(within(actionButtons[0]).queryByText("Evidence")).not.toBeInTheDocument();
    expect(actionButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open recommended action Add product FAQ",
      "Open recommended action Supplier / QA review",
      "Open recommended action Change product status",
    ]);
    expect(recommendedActionsOverflow).not.toHaveClass("isExpanded");
    expect(screen.queryByRole("button", { name: "Open recommended action Add internal risk tags" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View more (1)" }));
    expect(recommendedActionsOverflow).toHaveClass("isExpanded");
    const expandedActionButtons = screen.getAllByRole("button", { name: /Open recommended action/ });
    expect(expandedActionButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open recommended action Add product FAQ",
      "Open recommended action Supplier / QA review",
      "Open recommended action Change product status",
      "Open recommended action Add internal risk tags",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "View less" }));
    expect(recommendedActionsOverflow).not.toHaveClass("isExpanded");
    expect(screen.getAllByRole("button", { name: /Open recommended action/ })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Open recommended action Add internal risk tags" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add product FAQ" }));
    expect(screen.getByText("Visibility")).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.getByText("Reversibility")).toBeInTheDocument();
    expect(screen.getByText("Reason")).toBeInTheDocument();
    expect(screen.getByText("Benefit")).toBeInTheDocument();
  });

  it("prioritizes pairing expectation copy before relationship evidence review", () => {
    const product = {
      ...defaultView.startHere,
      title: "GEN RELTEST Source Product",
      primaryIssue: "Product quality (expectations mismatch in bought-together context)",
      metrics: {
        ...defaultView.startHere.metrics,
        returnUnits: 3,
        refundUnits: 2,
        negativeReviewCount: 12,
        contentAnalysis: {
          issues: [
            { code: "missing_customer_guidance", label: "Missing shopper guidance for bundle expectations", evidence: "The PDP does not explain what belongs together." },
          ],
        },
        productRelationshipIntelligenceSummary: {
          top_bought_together: [{
            related_product_title: "GEN RELTEST Bought Together Product",
            delta_return_rate: 37.5,
            delta_refund_rate: 25,
          }],
        },
      },
      recommendedActions: [
        {
          id: "review-product-pairing-expectations",
          label: "Review pairing expectations",
          type: "Compatibility review",
          effort: "Medium",
          status: "Ready",
          payload: {
            recommendationKind: "compatibility_warning",
            relatedProductTitle: "GEN RELTEST Bought Together Product",
            relationshipType: "same_order",
            deltaReturnRate: 37.5,
            deltaRefundRate: 25,
            impact: "High",
            visibility: "Customer-facing",
            confidence: "High",
            evidenceStrength: "Strong",
            applicationRisk: "Low",
            actionTier: 1,
          },
        },
        {
          id: "rewrite-product-description",
          label: "Update product description",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: "Add bought-together expectations, Pack differences, and what the customer receives before checkout.",
            operation: "prepend",
            impact: "High",
            visibility: "Customer-facing",
            confidence: "High",
            evidenceStrength: "Strong",
            applicationRisk: "Low",
            actionTier: 1,
          },
        },
        {
          id: "create-product-faq",
          label: "Create product FAQ",
          type: "FAQ",
          effort: "Low",
          status: "Draft",
          payload: {
            faqItems: [{ question: "What happens when I buy this with the companion product?", answer: "Check what belongs to each product and which Pack was selected." }],
            impact: "High",
            visibility: "Customer-facing",
            confidence: "High",
            evidenceStrength: "Strong",
            applicationRisk: "Low",
            actionTier: 1,
          },
        },
      ],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);

    const actionButtons = screen.getAllByRole("button", { name: /Open recommended action/ });
    expect(actionButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open recommended action Update product description",
      "Open recommended action Review pairing expectations",
      "Open recommended action Create product FAQ",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Review pairing expectations" }));
    const dialog = screen.getByRole("dialog", { name: "Review pairing expectations" });
    expect(within(dialog).getByText("Recommended copy direction")).toBeInTheDocument();
    expect(within(dialog).getByText(/what the customer receives with this product/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Compare return\/refund pressure when bought together versus when bought alone/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Review evidence" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/QA or supplier escalation/)).not.toBeInTheDocument();
  });

  it("renames description rewrites that only append copy and explains why", () => {
    const currentDescription = "The Trail Jacket is a lightweight shell with a water-resistant finish and adjustable cuffs.";
    const textToAdd = "Add a clear sizing note: customers should size up if they plan to wear thick layers under this jacket.";
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "rewrite-product-description",
        label: "Rewrite product description",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: `${currentDescription}\n\n${textToAdd}`,
          currentDescriptionText: currentDescription,
          operation: "replace",
          returnUnits: 4,
          negativeReviewCount: 2,
          topReturnReasons: ["Too small"],
          contentIssues: [{ label: "Sizing guidance missing", evidence: "Description does not explain layering fit.", code: "short_description" }],
        },
      }],
      metrics: {
        ...defaultView.startHere.metrics,
        returnUnits: 4,
        negativeReviewCount: 2,
        topReturnReasons: ["Too small"],
      },
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getByRole("button", { name: "Open recommended action Add text to end of description" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add text to end of description" }));
    const dialog = screen.getByRole("dialog", { name: "Add text to end of description" });
    const proposedChange = dialog.querySelector(".ppActionProposedChangeBox");
    expect(proposedChange).toHaveTextContent(textToAdd);
    expect(proposedChange).not.toHaveTextContent(currentDescription);
    const quotedReason = dialog.querySelector(".ppActionWhyNarrative q.ppInlineQuote");
    expect(dialog.querySelector(".ppActionWhyNarrative")).toHaveTextContent(/ProductPulse recommends adding this text at the end of the description because 4 returns tied to Too small/);
    expect(quotedReason).toHaveTextContent("Too small");
  });

  it("expands full current and updated Shopify descriptions in recommended action previews", () => {
    const currentDescription = Array.from({ length: 18 }, (_, index) => `Current Shopify description sentence ${index + 1} with product details shoppers need before checkout.`).join(" ");
    const textToAdd = Array.from({ length: 10 }, (_, index) => `Updated description addition sentence ${index + 1} explains fit, contents, and expectations.`).join(" ");
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "add-description-guidance",
        label: "Add description guidance",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: textToAdd,
          currentDescriptionText: currentDescription,
          operation: "append",
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add description guidance" }));
    const dialog = screen.getByRole("dialog", { name: "Add description guidance" });
    const previewGrid = dialog.querySelector(".ppActionPreviewGrid");
    const currentColumn = within(dialog).getByText("Current Shopify description").closest(".ppActionPreviewColumn");
    const updatedColumn = within(dialog).getByText("Updated description preview").closest(".ppActionPreviewColumn");

    expect(currentColumn).toHaveTextContent("Current Shopify description sentence 1");
    expect(currentColumn).not.toHaveTextContent("Current Shopify description sentence 18");

    expect(updatedColumn).toHaveTextContent("Updated description addition sentence 1");
    expect(updatedColumn).not.toHaveTextContent("Current Shopify description sentence 1 with product details");
    expect(within(currentColumn).queryByRole("button")).not.toBeInTheDocument();
    expect(within(updatedColumn).queryByRole("button")).not.toBeInTheDocument();

    fireEvent.click(within(previewGrid).getByRole("button", { name: "Show more description previews" }));
    expect(within(previewGrid).getByRole("button", { name: "Show less description previews" })).toBeInTheDocument();
    expect(currentColumn).toHaveTextContent("Current Shopify description sentence 18");
    expect(updatedColumn).toHaveTextContent("Current Shopify description sentence 1 with product details");
    expect(updatedColumn).toHaveTextContent("Current Shopify description sentence 18");
    expect(updatedColumn).toHaveTextContent("Updated description addition sentence 10");
  });

  it("highlights changed blocks in updated product description previews", () => {
    const currentDescription = [
      "Opening product copy stays unchanged.",
      "Original materials sentence stays too vague.",
      "Shipping note remains unchanged.",
      "Care guidance stays unchanged.",
    ].join(" ");
    const updatedDescription = [
      "Opening product copy stays unchanged.",
      "Updated materials sentence names recycled nylon and a water-resistant finish.",
      "Shipping note remains unchanged.",
      "Added fit block explains relaxed sizing for layering.",
      "Care guidance stays unchanged.",
    ].join(" ");
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "correct-product-description",
        label: "Correct product description",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: updatedDescription,
          currentDescriptionText: currentDescription,
          operation: "replace",
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Correct product description" }));
    const dialog = screen.getByRole("dialog", { name: "Correct product description" });
    const updatedColumn = within(dialog).getByText("Updated description preview").closest(".ppActionPreviewColumn");
    const changedBlocks = updatedColumn.querySelectorAll(".ppActionPreviewDiffBlock");

    expect(changedBlocks).toHaveLength(2);
    expect(changedBlocks[0]).toHaveTextContent("Updated materials sentence names recycled nylon");
    expect(changedBlocks[1]).toHaveTextContent("Added fit block explains relaxed sizing");
    expect(updatedColumn).toHaveTextContent("Opening product copy stays unchanged.");
    expect(changedBlocks[0]).not.toHaveTextContent("Opening product copy stays unchanged.");
  });

  it("groups overlapping product description changes into one selectable action", () => {
    const currentDescription = "The Trail Jacket is a lightweight shell with a water-resistant finish and adjustable cuffs.";
    const replacement = "The Trail Jacket is a lightweight, water-resistant shell with adjustable cuffs and a relaxed outdoor fit.";
    const topNote = "Fit note: size up if you plan to wear thick layers under this jacket.";
    const bottomNote = "Care note: wipe clean after heavy rain and hang dry before storing.";
    const product = {
      ...defaultView.startHere,
      recommendedActions: [
        {
          id: "rewrite-product-description",
          label: "Rewrite product description",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: replacement,
            currentDescriptionText: currentDescription,
            operation: "replace",
          },
        },
        {
          id: "add-fit-note",
          label: "Add fit note",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: topNote,
            currentDescriptionText: currentDescription,
            operation: "prepend",
            topReturnReasons: ["Too small"],
          },
        },
        {
          id: "add-care-note",
          label: "Add care note",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: bottomNote,
            currentDescriptionText: currentDescription,
            operation: "append",
          },
        },
      ],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getByRole("button", { name: "Open recommended action Update product description" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open recommended action Rewrite product description" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Update product description" }));
    const dialog = screen.getByRole("dialog", { name: "Update product description" });
    expect(within(dialog).getByText(/ProductPulse found multiple description changes for this product/)).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Rewrite product description/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Add fit note/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Add care note/ })).toBeChecked();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Add care note/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply change" }));
    const confirmDialog = screen.getByRole("dialog", { name: "Confirm product description update" });
    expect(confirmDialog).toHaveTextContent(topNote);
    expect(confirmDialog).not.toHaveTextContent(bottomNote);
  });

  it("keeps grouped product description edits separate when applying", async () => {
    const currentDescription = "The Trail Jacket is a lightweight shell with a water-resistant finish and adjustable cuffs.";
    const topNote = "Fit note: size up if you plan to wear thick layers under this jacket.";
    const bottomNote = "Specs note: includes sealed seams and a drawcord hem.";
    let submittedChanges = [];
    let submittedDraftText = "";
    const action = vi.fn(async ({ request }) => {
      const formData = await request.formData();
      submittedDraftText = String(formData.get("draftText") || "");
      submittedChanges = JSON.parse(String(formData.get("descriptionChangesJson") || "[]"));
      return {
        status: "success",
        message: "Selected product description changes were applied.",
        action: { id: String(formData.get("actionId") || "") },
        actionRecordStatus: "applied",
      };
    });
    const product = {
      ...defaultView.startHere,
      recommendedActions: [
        {
          id: "add-fit-note",
          label: "Add fit note",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: topNote,
            currentDescriptionText: currentDescription,
            operation: "prepend",
          },
        },
        {
          id: "add-specs-note",
          label: "Add specifications note",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: bottomNote,
            currentDescriptionText: currentDescription,
            operation: "append",
          },
        },
      ],
    };

    renderWithAction(<ProductDiagnosisActionHarness data={defaultView} product={product} />, action);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Update product description" }));
    const dialog = screen.getByRole("dialog", { name: "Update product description" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit text" }));

    const fitNoteEditor = within(dialog).getByLabelText("Description text to apply for Add fit note");
    fireEvent.change(fitNoteEditor, {
      target: { value: "Edited fit note for layering. " },
    });
    expect(fitNoteEditor).toHaveValue("Edited fit note for layering. ");
    fireEvent.change(fitNoteEditor, {
      target: { value: "Edited fit note for layering.  More room." },
    });
    expect(fitNoteEditor).toHaveValue("Edited fit note for layering.  More room.");
    fireEvent.change(within(dialog).getByLabelText("Description text to apply for Add specifications note"), {
      target: { value: "Edited technical specifications block." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply change" }));

    const confirmDialog = screen.getByRole("dialog", { name: "Confirm product description update" });
    const currentDescriptionPanel = confirmDialog.querySelector(".ppActionConfirmCurrent");
    expect(currentDescriptionPanel).not.toBeNull();
    expect(currentDescriptionPanel.querySelectorAll(".ppActionPreviewDiffBlock").length).toBeGreaterThanOrEqual(2);
    expect(within(currentDescriptionPanel).getByText("Edited fit note for layering. More room.")).toBeInTheDocument();
    expect(within(currentDescriptionPanel).getByText("Edited technical specifications block.")).toBeInTheDocument();
    expect(confirmDialog).toHaveTextContent("Edited fit note for layering.");
    expect(confirmDialog).toHaveTextContent("Edited technical specifications block.");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Accept and apply change" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(submittedDraftText).toContain("Edited fit note for layering. More room.");
    expect(submittedDraftText).toContain("Edited technical specifications block.");
    expect(submittedChanges).toEqual([
      expect.objectContaining({ id: "add-fit-note", operation: "prepend", text: "Edited fit note for layering.  More room." }),
      expect.objectContaining({ id: "add-specs-note", operation: "append", text: "Edited technical specifications block." }),
    ]);
  });

  it("keeps SEO title recommendations out of product description groups", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        seoTitle: "Old search title",
      },
      recommendedActions: [
        {
          id: "rewrite-seo-title",
          label: "Rewrite SEO title",
          type: "SEO title",
          effort: "Low",
          status: "Draft",
          payload: {
            field: "seo.title",
            draftText: "Nintendo New 3DS XL Console | ProductPulse",
            currentValue: "Old search title",
          },
        },
        {
          id: "add-fit-note",
          label: "Add fit note",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: "Fit note: check console compatibility before buying.",
            operation: "prepend",
          },
        },
      ],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getByRole("button", { name: "Open recommended action Rewrite SEO title" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Rewrite SEO title" }));
    const dialog = screen.getByRole("dialog", { name: "Rewrite SEO title" });
    expect(within(dialog).getByText("Proposed SEO title")).toBeInTheDocument();
    expect(within(dialog).getByText("Current SEO title")).toBeInTheDocument();
    expect(within(dialog).queryByText("Current Shopify description")).not.toBeInTheDocument();
  });

  it("does not let a stored SEO meta action archive product description actions through broad aliases", () => {
    const product = {
      ...defaultView.startHere,
      recommendedActions: [
        {
          id: "product-description-changes",
          label: "Update product description",
          type: "PDP copy",
          effort: "Low",
          status: "Ready",
          payload: {
            descriptionChangeGroup: true,
            descriptionChanges: [{
              id: "add-expectation-note",
              title: "Add expectation note",
              operation: "prepend",
              operationLabel: "Add to top of description",
              text: "Please note: confirm compatibility before buying.",
            }],
          },
        },
        {
          id: "rewrite-meta-description",
          label: "Rewrite meta description",
          type: "SEO",
          effort: "Low",
          status: "Ready",
          payload: {
            field: "seo.description",
            draftText: "Clear SEO description.",
          },
        },
      ],
      actionHistory: [
        {
          id: "stored-meta",
          actionId: "rewrite-meta-description",
          actionType: "rewrite-meta-description",
          label: "Rewrite meta description",
          status: "applied",
          payload: {
            sourceActionId: "rewrite-meta-description",
            canonicalActionId: "rewrite-meta-description",
            actionAliases: ["rewrite-meta-description", "product-description-changes", "title-metadata"],
          },
        },
      ],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getByRole("button", { name: "Open recommended action Update product description" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open recommended action Rewrite meta description" })).not.toBeInTheDocument();
  });

  it("does not let a stored FAQ action archive every FAQ through broad aliases", () => {
    const product = {
      ...defaultView.startHere,
      recommendedActions: [
        {
          id: "create-sizing-faq",
          title: "Create sizing FAQ",
          label: "Create product FAQ",
          type: "PDP copy",
          effort: "Low",
          status: "Ready",
          payload: {
            faqItems: [{ question: "How does sizing run?", answer: "It runs small." }],
          },
        },
        {
          id: "create-compatibility-faq",
          title: "Create compatibility FAQ",
          label: "Create product FAQ",
          type: "PDP copy",
          effort: "Low",
          status: "Ready",
          payload: {
            faqItems: [{ question: "What is it compatible with?", answer: "Use the listed adapter." }],
          },
        },
      ],
      actionHistory: [
        {
          id: "stored-sizing-faq",
          actionId: "create-sizing-faq",
          actionType: "create-sizing-faq",
          label: "Create product FAQ",
          status: "applied",
          payload: {
            sourceActionId: "create-sizing-faq",
            canonicalActionId: "create-sizing-faq",
            actionAliases: ["create-product-faq"],
          },
        },
      ],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getAllByRole("button", { name: "Open recommended action Create product FAQ" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Expand Create product FAQ" })).toBeInTheDocument();
  });

  it("does not archive a fresh recommendation because an equivalent action was applied in an older diagnosis", () => {
    const product = {
      ...defaultView.startHere,
      latestDiagnosisId: "diagnosis-new",
      metrics: {
        ...defaultView.startHere.metrics,
        latestDiagnosisId: "diagnosis-new",
      },
      recommendedActions: [{
        id: "fit-note",
        label: "Add fit note",
        type: "PDP copy",
        effort: "Low",
        status: "Ready",
        payload: {
          draftText: "Add the new fit language from the latest review window.",
        },
      }],
      actionHistory: [{
        id: "stored-old-fit-note",
        diagnosisId: "diagnosis-old",
        actionId: "fit-note",
        actionType: "fit-note",
        label: "Add fit note",
        status: "applied",
        payload: {
          sourceActionId: "fit-note",
          canonicalActionId: "fit-note",
          actionAliases: ["fit-note", "product-description-changes"],
        },
        appliedAt: "2026-05-14T10:00:00.000Z",
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getByRole("button", { name: "Open recommended action Add fit note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand Add fit note" })).not.toBeInTheDocument();
  });

  it("shows Add to Watchlist as a workflow action without a before/after preview", () => {
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "add-to-watchlist",
        label: "Add to Watchlist",
        type: "Watchlist",
        effort: "Low",
        status: "Ready",
        payload: {},
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add to Watchlist" }));
    const dialog = screen.getByRole("dialog", { name: "Add to Watchlist" });
    expect(within(dialog).queryByRole("heading", { name: "Preview" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add to Watchlist" })).toBeInTheDocument();
  });

  it("shows concrete variant option suggestions and a Shopify edit link", () => {
    const product = {
      ...defaultView.startHere,
      shopifyAdminUrl: "https://admin.shopify.com/store/zuam/products/123",
      recommendedActions: [{
        id: "correct-variant-options",
        label: "Fix variant names/options",
        type: "Variant options",
        effort: "Medium",
        status: "Ready",
        payload: {
          variantUpdates: [{
            variantId: "gid://shopify/ProductVariant/1",
            variantTitle: "Black",
            currentLabel: "Black",
            suggestedLabel: "Midnight Black",
            sku: "SW-BLK",
            optionValues: [{ optionName: "Color", currentValue: "Black", suggestedValue: "Midnight Black" }],
          }],
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Fix variant names/options" }));
    const dialog = screen.getByRole("dialog", { name: "Fix variant names/options" });
    expect(within(dialog).getByText("Suggested variant/option updates")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Midnight Black/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("link", { name: "Edit in Shopify" })).toHaveAttribute("href", product.shopifyAdminUrl);
    expect(within(dialog).getByRole("button", { name: "Update variants" })).toBeInTheDocument();
  });

  it("does not show no-op variant label suggestions", () => {
    const product = {
      ...defaultView.startHere,
      shopifyAdminUrl: "https://admin.shopify.com/store/zuam/products/123",
      recommendedActions: [{
        id: "correct-variant-options",
        label: "Fix variant names/options",
        type: "Variant options",
        effort: "Medium",
        status: "Ready",
        payload: {
          affectedVariants: ["Mixed Herbs"],
          variantUpdates: [{
            variantId: "gid://shopify/ProductVariant/1",
            variantTitle: "Mixed Herbs",
            currentLabel: "Mixed Herbs",
            suggestedLabel: "Mixed Herbs",
            sku: "HERB-MIX",
            optionValues: [{ optionName: "Style", currentValue: "Mixed Herbs", suggestedValue: "Mixed Herbs" }],
          }],
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Fix variant names/options" }));
    const dialog = screen.getByRole("dialog", { name: "Fix variant names/options" });
    expect(within(dialog).queryByText("Suggested variant labels")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Update variants" })).not.toBeInTheDocument();
  });

  it("deduplicates equivalent grouped description changes from the same cause", () => {
    const currentDescription = "Completed in 1642, this famous artwork reproduction depicts a city guard moving out.";
    const duplicatedNote = "Please note: This reproduction uses dramatic lighting and a dark visual tone that can feel intense in a room.";
    const product = {
      ...defaultView.startHere,
      recommendedActions: [
        {
          id: "draft-subjective-expectation-note",
          label: "Draft expectation-setting note",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: duplicatedNote,
            currentDescriptionText: currentDescription,
            operation: "prepend",
            causeKey: "subjective-reaction-night-watch",
            returnUnits: 3,
            negativeReviewCount: 2,
          },
        },
        {
          id: "add-product-description-guidance",
          label: "Add product description guidance",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: duplicatedNote,
            currentDescriptionText: currentDescription,
            operation: "append",
            causeKey: "subjective-reaction-night-watch",
            returnUnits: 3,
            negativeReviewCount: 2,
          },
        },
      ],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Update product description" }));
    const dialog = screen.getByRole("dialog", { name: "Update product description" });
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(dialog).getByRole("checkbox", { name: /Draft expectation-setting note/ })).toBeChecked();
    expect(within(dialog).queryByRole("checkbox", { name: /Add product description guidance/ })).not.toBeInTheDocument();
  });

  it("lets media recommendations apply generated alt text instead of only opening evidence", () => {
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "improve-product-media",
        label: "Improve images and alt text",
        type: "Media alt text",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: "Core Linen Trouser product image highlighting material, color and fit.",
          mediaGuidance: "Add descriptive alt text that explains the visible product, material and scale.",
          imageBrief: "Keep the current image order, but add descriptive alt text to media without alt text.",
          mediaCount: 1,
          mediaWithoutAltCount: 1,
          mediaUpdates: [{
            id: "gid://shopify/MediaImage/1",
            targetLabel: "Primary product media",
            currentAltText: "",
            suggestedAltText: "Core Linen Trouser product image highlighting material, color and fit.",
          }],
          issue: "color_expectation",
          proposedChange: "Update alt text for Primary product media.",
          shopifyField: "Product media alt text",
          expectedImpact: "Reduce visual expectation mismatch and improve PDP clarity.",
          applicationRisk: "Low",
        },
      }],
      metrics: {
        ...defaultView.startHere.metrics,
        mediaCount: 1,
        mediaWithoutAltCount: 1,
      },
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Improve images and alt text" }));
    const dialog = screen.getByRole("dialog", { name: "Improve images and alt text" });
    expect(within(dialog).getByText("Suggested alt text")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/ProductPulse recommends improving product media because 1 media item missing alt text/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Apply change" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply change" }));
    expect(screen.getByRole("dialog", { name: "Confirm product media alt text update" })).toBeInTheDocument();
  });

  it("persists ignored issues, hides related recommendations and can restore them", async () => {
    let submittedAction = null;
    let submittedIssueKey = null;
    const action = vi.fn(async ({ request }) => {
      const formData = await request.formData();
      submittedAction = String(formData.get("_action") || "");
      submittedIssueKey = String(formData.get("issueKey") || "");
      return {
        status: "success",
        message: submittedAction === "unignore-issue" ? "Issue restored." : "Issue ignored.",
        action: {
          id: submittedAction,
          payload: {
            issue: String(formData.get("issue") || ""),
            issueKey: submittedIssueKey,
          },
        },
      };
    });

    renderWithAction(<ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />, action);
    expect(screen.getByRole("button", { name: "Open recommended action Add fit note" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ignore Fit runs small around waist and inseam" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(submittedAction).toBe("ignore-issue");
    expect(submittedIssueKey).toBe("fit-runs-small-around-waist-and-inseam");
    await waitFor(() => expect(screen.getByText("Ignored")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Open recommended action Add fit note" })).not.toBeInTheDocument();
    expect(screen.getByText(/hidden because related issues are ignored/)).toBeInTheDocument();

    const unignoreButton = screen.getByRole("button", { name: "Unignore Fit runs small around waist and inseam" });
    await waitFor(() => expect(unignoreButton).not.toBeDisabled());
    fireEvent.click(unignoreButton);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(submittedAction).toBe("unignore-issue");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open recommended action Add fit note" })).toBeInTheDocument());
  });

  it("loads persisted ignored issues from product action history", () => {
    renderWithRouter(<ProductDiagnosisScreen
      data={defaultView}
      product={{
        ...defaultView.startHere,
        actionHistory: [{
          id: "ignored-fit",
          actionId: "ignore-issue",
          label: "Ignore issue: Fit runs small around waist and inseam",
          status: "ignored",
          payload: {
            issue: "Fit runs small around waist and inseam",
            issueKey: "fit-runs-small-around-waist-and-inseam",
          },
          appliedAt: "2026-05-14T10:00:00.000Z",
        }],
      }}
    />);

    expect(screen.getByText("Ignored")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unignore Fit runs small around waist and inseam" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open recommended action Add fit note" })).not.toBeInTheDocument();
    expect(screen.getByText(/1 ignored issue/)).toBeInTheDocument();
  });

  it("does not keep an issue ignored when a newer restore action exists", () => {
    renderWithRouter(<ProductDiagnosisScreen
      data={defaultView}
      product={{
        ...defaultView.startHere,
        actionHistory: [
          {
            id: "restored-fit",
            actionId: "unignore-issue",
            label: "Restore issue: Fit runs small around waist and inseam",
            status: "applied",
            payload: {
              issue: "Fit runs small around waist and inseam",
              issueKey: "fit-runs-small-around-waist-and-inseam",
            },
            appliedAt: "2026-05-14T11:00:00.000Z",
          },
          {
            id: "ignored-fit",
            actionId: "ignore-issue",
            label: "Ignore issue: Fit runs small around waist and inseam",
            status: "ignored",
            payload: {
              issue: "Fit runs small around waist and inseam",
              issueKey: "fit-runs-small-around-waist-and-inseam",
            },
            appliedAt: "2026-05-14T10:00:00.000Z",
          },
        ],
      }}
    />);

    expect(screen.queryByText("Ignored")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open recommended action Add fit note" })).toBeInTheDocument();
  });

  it("renders content issue reasons without object placeholders", () => {
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "review-product-content-alignment",
        label: "Review title, tags and collection alignment",
        type: "Workflow",
        effort: "Low",
        status: "Ready",
        payload: {
          contentIssues: [
            { label: "Missing product description", evidence: "The Shopify product description is empty.", severity: "high" },
            { label: "Tags are not reflected in description", evidence: "Tags do not appear in PDP copy.", severity: "low" },
          ],
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getAllByText("Review title, tags and collection alignment").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Review title, tags and collection alignment" }));
    expect(screen.getByText("ProductPulse found content issues that can reduce buyer confidence: Missing product description.")).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it("uses an investigation modal for non-Shopify-change actions", () => {
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "supplier-qa-review",
        label: "Supplier / QA review needed",
        type: "Workflow",
        effort: "Low",
        status: "Ready",
        payload: {
          contentIssues: [{ label: "Quality complaints need review" }],
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Supplier / QA review needed" }));
    expect(screen.getByText("Manual follow-up")).toBeInTheDocument();
    expect(screen.getByText("No Shopify change")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What to verify" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add QA tag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review evidence" })).toBeInTheDocument();
  });

  it("minimizes investigation actions after opening evidence", () => {
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "supplier-qa-review",
        label: "Supplier / QA review needed",
        type: "Workflow",
        effort: "Low",
        status: "Ready",
        payload: {
          contentIssues: [{ label: "Quality complaints need review" }],
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Supplier / QA review needed" }));
    fireEvent.click(screen.getByRole("button", { name: "Review evidence" }));

    const miniDock = document.querySelector(".ppRecommendedActionMiniDock");
    expect(miniDock).toBeInTheDocument();
    expect(within(miniDock).getByText("Supplier / QA review needed")).toBeInTheDocument();
    expect(miniDock.querySelector(".ppRecommendedActionMiniSummary")).toHaveTextContent("Verify whether this product has a QA issue");
    expect(within(miniDock).getByRole("button", { name: "Mark reviewed" })).toBeInTheDocument();
    expect(within(miniDock).getByRole("button", { name: "Maximize recommended action" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What to verify" })).not.toBeInTheDocument();

    fireEvent.click(within(miniDock).getByRole("button", { name: "Maximize recommended action" }));
    expect(screen.getByRole("heading", { name: "What to verify" })).toBeInTheDocument();
  });

  it("persists reviewed recommended actions and celebrates when every action is handled", async () => {
    let submittedAction = "";
    let submittedActionId = "";
    const action = vi.fn(async ({ request }) => {
      const formData = await request.formData();
      submittedAction = String(formData.get("_action") || "");
      submittedActionId = String(formData.get("actionId") || "");
      return {
        status: "success",
        message: "Review return reasons was marked as reviewed.",
        action: { id: submittedActionId, label: String(formData.get("label") || "") },
        actionRecordStatus: "reviewed",
      };
    });
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "review-return-reasons",
        label: "Review return reasons",
        type: "Workflow",
        effort: "Low",
        status: "Ready",
        payload: { returnUnits: 4 },
      }],
      actionHistory: [],
    };

    renderWithAction(<ProductDiagnosisScreen data={defaultView} product={product} />, action);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Review return reasons" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(submittedAction).toBe("review-action");
    expect(submittedActionId).toBe("review-return-reasons");
    expect(screen.getByRole("dialog", { name: "All recommended actions are handled" })).toBeInTheDocument();
    expect(screen.getByText("Product actions complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Review return reasons" })).toHaveTextContent("Reviewed");
  });

  it("keeps the recommended actions completion modal open across same-product revalidation", async () => {
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "review-return-reasons",
        label: "Review return reasons",
        type: "Workflow",
        effort: "Low",
        status: "Ready",
        payload: { returnUnits: 4 },
      }],
      actionHistory: [],
    };
    const actionData = {
      status: "success",
      message: "Review return reasons was marked as reviewed.",
      action: { id: "review-return-reasons", label: "Review return reasons" },
      actionRecordStatus: "reviewed",
    };

    function SameProductRevalidationHarness() {
      const [currentProduct, setCurrentProduct] = useState(product);
      return (
        <>
          <button
            type="button"
            onClick={() => setCurrentProduct({
              ...product,
              actionHistory: [{ actionId: "review-return-reasons", status: "reviewed" }],
            })}
          >
            Revalidate product
          </button>
          <ProductDiagnosisScreen product={currentProduct} actionData={actionData} />
        </>
      );
    }

    renderWithRouter(<SameProductRevalidationHarness />);
    const completeDialog = await screen.findByRole("dialog", { name: "All recommended actions are handled" });
    expect(completeDialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revalidate product" }));
    expect(screen.getByRole("dialog", { name: "All recommended actions are handled" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "All recommended actions are handled" })).not.toBeInTheDocument();
  });

  it("renders granular sentiment and language evidence in Product Diagnosis", () => {
    const product = {
      ...defaultView.startHere,
      issues: [{
        issue: "Fear or safety concern",
        severity: "Medium",
        confidence: 72,
        signals: 4,
        evidence: [
          "4 generic return reasons reclassified from customer text as Fear or safety concern.",
          "Example: \"Scares me more than nothing. I want them to take him away.\"",
        ],
        action: "Review fear/safety language",
      }],
      evidence: [{
        source: "Customer language analysis",
        quote: "Dominant sentiment: negative",
        weight: "4 customer text signals analyzed",
      }, {
        source: "Shopify returns",
        quote: "OTHER, too small",
        weight: "4 return units, 18% return rate",
        points: [
          "Return-note sentiment: 2 negative, 1 neutral, 0 positive",
          "\"Other\" notes classified as Fit & sizing 2 times",
        ],
      }],
      metrics: {
        ...defaultView.startHere.metrics,
        textInsights: {
          sentiment: { total: 4, negative: 3, neutral: 1, positive: 0 },
          returns: {
            sentiment: { total: 3, negative: 2, neutral: 1, positive: 0 },
            emotions: [{ code: "fear", label: "Fear", polarity: "negative", count: 2 }],
            examples: [{
              text: "Other - Scares me more than nothing. I want them to take him away.",
              sentiment: "negative",
              emotion: "fear",
            }],
          },
          reviews: {
            sentiment: { total: 1, negative: 1, neutral: 0, positive: 0 },
            emotions: [{ code: "disappointment", label: "Disappointment", polarity: "negative", count: 1 }],
            examples: [],
          },
          emotions: [
            { code: "fear", label: "Fear", polarity: "negative", count: 2 },
            { code: "disappointment", label: "Disappointment", polarity: "negative", count: 1 },
          ],
          aiKnownEmotions: [{ code: "fear", label: "Fear", polarity: "negative", count: 2 }],
          aiEmergentSentiments: [{ label: "Superstitious discomfort", normalizedLabel: "superstitious_discomfort", polarity: "negative", signals: 2 }],
          otherReturnClassifications: [{ issueCode: "fit_sizing", label: "Fit & sizing", count: 2 }],
        },
      },
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const issuesPanel = screen.getByText("Issues detected").closest(".ppIssuesOverviewPanel");
    const issueRow = within(issuesPanel).getByText("Fear or safety concern").closest("tr");
    expect(within(issueRow).getByText("Medium")).toBeInTheDocument();
    expect(issueRow.querySelector(".ppImpactLevelIndicator-medium")).toBeInTheDocument();
    expect(issueRow.querySelectorAll(".ppImpactLevelBars .isActive")).toHaveLength(2);
    const issueEvidenceTrigger = within(issueRow).getByText("Fear or safety concern").closest(".ppIssueTitleWithEvidence");
    expect(issueEvidenceTrigger).toHaveClass("hasEvidence");
    expect(within(issueEvidenceTrigger).getByRole("tooltip")).toHaveTextContent("4 generic return reasons reclassified from customer text as Fear or safety concern.");
    expect(issueRow.querySelector(".ppIssueNameCell small")).not.toBeInTheDocument();
    expect(screen.getAllByText("Fear or safety concern").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Scares me more than nothing/).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /Customer language analysis/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Text signals")).toBeInTheDocument();
    expect(screen.getByText("Negative language")).toBeInTheDocument();
    expect(screen.getAllByText("Primary emotion").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fear").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 (next-strongest )?signals/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Secondary emotion").length).toBeGreaterThan(0);
    expect(screen.getByText("Snapshot overview")).toBeInTheDocument();
    expect(screen.getByText("AI reading")).toBeInTheDocument();
    expect(screen.getByText("Top themes")).toBeInTheDocument();
    expect(screen.getByText("Signal breakdown")).toBeInTheDocument();
    expect(screen.getByText("All signals by type")).toBeInTheDocument();
    expect(screen.getByText("Customer themes")).toBeInTheDocument();
    expect(screen.getAllByText(/Superstitious discomfort/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/View all sources/)).toBeInTheDocument();
  });

  it("renders specialized Shopify orders evidence with sales context", () => {
    const product = {
      ...defaultView.startHere,
      evidence: [{
        source: "Shopify orders",
        quote: "Order data captured",
        weight: "365 day Shopify order window",
      }],
      metrics: {
        ...defaultView.startHere.metrics,
        soldUnits: 15,
        salesAmount: 2300,
        monthlyOrderActivity: {
          windowDays: 365,
          months: [
            { key: "2026-03", label: "Mar 2026", shortLabel: "Mar", orders: 3, orderUnits: 4, revenue: 600 },
            { key: "2026-04", label: "Apr 2026", shortLabel: "Apr", orders: 7, orderUnits: 8, revenue: 1200 },
            { key: "2026-05", label: "May 2026", shortLabel: "May", orders: 2, orderUnits: 3, revenue: 500 },
          ],
          summary: {
            totalOrders: 12,
            totalOrderUnits: 15,
            totalRevenue: 2300,
            maxOrders: 8,
          },
        },
        productPurchaseContextSummary: {
          totalOrdersContainingProduct: 12,
          monthlyContext: [
            { key: "2026-03", label: "Mar 2026", ordersContainingProduct: 3, unitsSold: 4, avgProductQuantityPerOrder: 1.3, avgTotalUnitsPerOrder: 2.4 },
            { key: "2026-04", label: "Apr 2026", ordersContainingProduct: 7, unitsSold: 8, avgProductQuantityPerOrder: 1.1, avgTotalUnitsPerOrder: 3.2 },
            { key: "2026-05", label: "May 2026", ordersContainingProduct: 2, unitsSold: 3, avgProductQuantityPerOrder: 1.5, avgTotalUnitsPerOrder: 1.5 },
          ],
        },
        orderGeography: [
          { label: "Texas, United States", count: 8, share: 66.7, detail: "8 orders · 66.7%" },
          { label: "Canada", count: 4, share: 33.3, detail: "4 orders · 33.3%" },
        ],
      },
    };

    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getByRole("tab", { name: "Shopify orders" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Units sold over time")).toBeInTheDocument();
    expect(screen.getByText("Units/order")).toBeInTheDocument();
    expect(screen.getByText("Product share")).toBeInTheDocument();
    const ordersChart = container.querySelector(".ppEvidenceOrdersLineChart");
    expect(ordersChart.querySelector(".ppEvidenceOrdersLine-units")).toBeInTheDocument();
    expect(ordersChart.querySelector(".ppEvidenceOrdersLine-orders")).toBeInTheDocument();
    expect(ordersChart.querySelector(".ppEvidenceOrdersLine-unitsPerOrder")).toBeInTheDocument();
    expect(ordersChart.querySelector(".ppEvidenceOrdersLine-basketShare")).toBeInTheDocument();
    expect(screen.getByText("Order velocity")).toBeInTheDocument();
    expect(screen.getByText("Sales by channel")).toBeInTheDocument();
    expect(screen.getByText("Order insights")).toBeInTheDocument();
    const geographySection = screen.getByRole("heading", { name: "Geography" }).closest("section");
    expect(within(geographySection).getByText("By order origin")).toBeInTheDocument();
    expect(within(geographySection).getByText("Texas, United States")).toBeInTheDocument();
    expect(within(geographySection).getByText("Canada")).toBeInTheDocument();
    expect(within(geographySection).getByText("8 orders · 66.7%")).toBeInTheDocument();
  });

  it("puts AI evidence synthesis first and expands Shopify variant evidence", async () => {
    const product = {
      ...defaultView.startHere,
      evidence: [
        { source: "Shopify product", quote: "Active product in Shopify", weight: "2 variants, 2 SKUs, 4 tags" },
        {
          source: "AI evidence synthesis",
          quote: "Cross-source reading: Stored AI synthesis says variant evidence should guide action without broad product changes.",
          weight: "Generated from deterministic metrics and stored snippets.",
          points: [
            "Customer language: Stored AI reading highlights expectation-setting language without restating panel metrics.",
            {
              section_key: "product_orders_retention",
              title: "Product, orders and retention",
              body: "Stored AI product-order reading says variant sales and retention context should be compared before changing the whole product.",
            },
            {
              section_key: "post_purchase",
              title: "Returns, refunds and negative reviews",
              body: "Stored AI post-purchase reading says refunds, returns and negative reviews should be treated as quality pressure only when repeated.",
            },
            "Variant scope: Stored AI variant interpretation says Aurora Blue should be reviewed before broad product changes.",
          ],
        },
      ],
      metrics: {
        ...defaultView.startHere.metrics,
        variantCount: 2,
        skuCount: 2,
        variants: [
          { title: "Aurora Blue", sku: "GEN-BLUE", price: 118, selectedOptions: [{ name: "Color", value: "Aurora Blue" }] },
          { title: "Warm White", sku: "GEN-WHITE", price: 112, selectedOptions: [{ name: "Color", value: "Warm White" }] },
        ],
        variantInsights: [
          {
            variantTitle: "Aurora Blue",
            sku: "GEN-BLUE",
            price: 118,
            selectedOptions: [{ name: "Color", value: "Aurora Blue" }],
            signalCount: 4,
            sales: { units: 5, amount: 590 },
            timeline: [
              { key: "2026-03", label: "Mar 2026", shortLabel: "Mar", salesUnits: 2, salesAmount: 236, reviewCount: 0, negativeReviewCount: 0 },
              { key: "2026-04", label: "Apr 2026", shortLabel: "Apr", salesUnits: 3, salesAmount: 354, reviewCount: 1, negativeReviewCount: 1 },
            ],
            returns: {
              units: 1,
              rate: 20,
              examples: [{ variant: "Aurora Blue", text: "Aurora Blue color was not as pictured.", sentiment: "negative", reason: "Color", quantity: 1 }],
            },
            refunds: {
              units: 2,
              amount: 118,
              examples: [
                { variant: "Aurora Blue", amount: 60, quantity: 1, reasonText: "Customer request", text: "Refund connected to Aurora Blue color mismatch." },
                { variant: "Aurora Blue", amount: 58, quantity: 1, reasonText: "Not as described", text: "Aurora Blue looked darker than expected." },
              ],
            },
            reviews: {
              count: 1,
              negativeCount: 1,
              averageRating: 2,
              sources: [{ label: "CSV reviews", count: 1 }],
              examples: [{ variant: "Aurora Blue", text: "The Aurora Blue variant looks muted.", sentiment: "negative", rating: 2, sourceLabel: "CSV reviews" }],
            },
          },
          {
            variantTitle: "Warm White",
            sku: "GEN-WHITE",
            price: 112,
            selectedOptions: [{ name: "Color", value: "Warm White" }],
            signalCount: 0,
            sales: { units: 8, amount: 896 },
            timeline: [
              { key: "2026-03", label: "Mar 2026", shortLabel: "Mar", salesUnits: 6, salesAmount: 672, reviewCount: 0, negativeReviewCount: 0 },
              { key: "2026-04", label: "Apr 2026", shortLabel: "Apr", salesUnits: 2, salesAmount: 224, reviewCount: 0, negativeReviewCount: 0 },
            ],
            returns: { units: 0, examples: [] },
            refunds: { units: 0, amount: 0, examples: [] },
            reviews: { count: 0, negativeCount: 0, examples: [] },
          },
        ],
        affectedVariants: ["Aurora Blue"],
        affectedVariantDetails: [{ label: "Aurora Blue", count: 3 }],
        refundInsights: {
          ...(defaultView.startHere.metrics.refundInsights || {}),
          examples: [
            { variant: "Aurora Blue", amount: 60, quantity: 1, reasonText: "Customer request", text: "Refund connected to Aurora Blue color mismatch." },
            { variant: "Aurora Blue", amount: 58, quantity: 1, reasonText: "Not as described", text: "Aurora Blue looked darker than expected." },
          ],
        },
        textInsights: {
          ...(defaultView.startHere.metrics.textInsights || {}),
          returns: {
            sentiment: { total: 1, negative: 1, neutral: 0, positive: 0 },
            examples: [{ variant: "Aurora Blue", text: "Aurora Blue color was not as pictured.", sentiment: "negative", reason: "Color" }],
          },
          reviews: {
            sentiment: { total: 1, negative: 1, neutral: 0, positive: 0 },
            examples: [{ variant: "Aurora Blue", text: "The Aurora Blue variant looks muted.", sentiment: "negative", rating: 2 }],
          },
        },
      },
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-label", "AI evidence synthesis");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    const synthesisSection = screen.getByRole("heading", { name: "Technical synthesis" }).closest("section");
    expect(synthesisSection.querySelectorAll(".ppEvidenceFinding")).toHaveLength(3);
    expect(within(synthesisSection).getByText("Customer language")).toBeInTheDocument();
    expect(within(synthesisSection).getByText("Product, orders and retention")).toBeInTheDocument();
    expect(within(synthesisSection).getByText("Returns, refunds and negative reviews")).toBeInTheDocument();
    expect(within(synthesisSection).getByText(/Stored AI synthesis says variant evidence should guide action/)).toBeInTheDocument();
    expect(within(synthesisSection).getByText(/Stored AI reading highlights expectation-setting language/)).toBeInTheDocument();
    expect(within(synthesisSection).getByText(/Stored AI post-purchase reading says refunds/)).toBeInTheDocument();
    expect(synthesisSection.textContent).not.toMatch(/Product Risk is|customer-language signals|affected variant.*stored|\$/);

    fireEvent.click(screen.getByRole("tab", { name: "Shopify product" }));
    const variantSection = screen.getByRole("heading", { name: "Variant intelligence" }).closest("section");
    expect(within(variantSection).queryByRole("heading", { name: "Product content" })).not.toBeInTheDocument();
    expect(within(variantSection).queryByText("Interpretation")).not.toBeInTheDocument();
    expect(within(variantSection).getByText("Shopify data")).toBeInTheDocument();
    expect(within(variantSection).getByText("Sales")).toBeInTheDocument();
    expect(within(variantSection).getByText("Refunds")).toBeInTheDocument();
    expect(within(variantSection).getByText("Returns")).toBeInTheDocument();
    expect(within(variantSection).getByText("Reviews / language")).toBeInTheDocument();
    expect(within(variantSection).getByText("5 sold units")).toBeInTheDocument();
    expect(within(variantSection).getByText("8 sold units")).toBeInTheDocument();
    expect(within(variantSection).getByText("2 refund signals · $118")).toBeInTheDocument();
    expect(within(variantSection).getByText("1 return signal")).toBeInTheDocument();
    expect(within(variantSection).getByText("1 negative review · 1 total")).toBeInTheDocument();
    const timeline = within(variantSection).getByText("Variant sales over time").closest(".ppVariantTemporalInsight");
    expect(within(timeline).getByText("Monthly units sold by variant. Dashed lines show dated review signals when available.")).toBeInTheDocument();
    expect(timeline.querySelectorAll(".ppVariantTemporalLine-sales")).toHaveLength(2);
    expect(timeline.querySelectorAll(".ppVariantTemporalLine-reviews")).toHaveLength(1);
    expect(within(variantSection).queryByText(/Aurora Blue color was not as pictured/)).not.toBeInTheDocument();
    fireEvent.click(within(variantSection).getByLabelText("View details for Aurora Blue return evidence"));
    const hiddenReturnExample = await screen.findByText(/Aurora Blue color was not as pictured/);
    expect(hiddenReturnExample).toBeVisible();
    expect(within(variantSection).getByText(/Stored AI variant interpretation says Aurora Blue should be reviewed/)).toBeInTheDocument();
    expect(within(variantSection).queryByText(/Variant evidence appears concentrated/)).not.toBeInTheDocument();
    expect(within(variantSection).queryByText(/affected variant is stored/)).not.toBeInTheDocument();
  });

  it("keeps review provider data and AI synthesis scoped to each provider tab", () => {
    const product = {
      ...defaultView.startHere,
      evidence: [
        {
          source: "AI evidence synthesis",
          quote: "Cross-source reading: Aggregate AI synthesis belongs only in the synthesis overview.",
          points: [
            {
              section_key: "customer_language",
              source_key: "csv_reviews",
              source_title: "CSV reviews",
              title: "Customer language",
              body: "CSV-only synthesis says imported review wording points to expectation friction.",
            },
            {
              section_key: "customer_language",
              source_key: "judgeme_reviews",
              source_title: "Judge.me reviews",
              title: "Customer language",
              body: "Judge-only synthesis says storefront reviews read more like packaging feedback.",
            },
            {
              section_key: "customer_language",
              source_key: "yotpo_reviews",
              source_title: "Yotpo reviews",
              title: "Customer language",
              body: "Yotpo-only synthesis says review language points to setup friction.",
            },
            {
              section_key: "customer_language",
              source_key: "loox_reviews",
              source_title: "Loox reviews",
              title: "Customer language",
              body: "Loox-only synthesis says review media and wording point to material concerns.",
            },
          ],
        },
        {
          source: "CSV reviews",
          quote: "2 negative reviews out of 3",
          weight: "CSV average rating",
          points: ["Review text: \"CSV review seam issue was repeated.\""],
        },
        {
          source: "Judge.me reviews",
          quote: "1 negative review out of 4",
          weight: "Judge.me average rating",
          points: ["Review text: \"Judge.me packaging note mentioned dents.\""],
        },
        {
          source: "Yotpo reviews",
          quote: "1 negative review out of 2",
          weight: "Yotpo average rating",
          points: ["Review text: \"Yotpo setup note mentioned pairing confusion.\""],
        },
        {
          source: "Loox reviews",
          quote: "1 negative review out of 2",
          weight: "Loox average rating",
          points: ["Review text: \"Loox photo review mentioned material concerns.\""],
        },
      ],
      metrics: {
        ...defaultView.startHere.metrics,
        reviewSourceStats: {
          csv: { reviewCount: 3, negativeReviewCount: 2, avgRating: 2.4, negativeReviewRate: 67, recentNegativeReviewCount: 1 },
          judgeMe: { reviewCount: 4, negativeReviewCount: 1, avgRating: 4.2, negativeReviewRate: 25, recentNegativeReviewCount: 1 },
          yotpo: { reviewCount: 2, negativeReviewCount: 1, avgRating: 3.5, negativeReviewRate: 50, recentNegativeReviewCount: 1 },
          loox: { reviewCount: 2, negativeReviewCount: 1, avgRating: 3, negativeReviewRate: 50, recentNegativeReviewCount: 1 },
          total: { reviewCount: 11, negativeReviewCount: 5, avgRating: 3.3, negativeReviewRate: 45, recentNegativeReviewCount: 4 },
        },
        csvReviewCount: 3,
        csvNegativeReviewCount: 2,
        csvAverageRating: 2.4,
        judgeMeReviewCount: 4,
        judgeMeNegativeReviewCount: 1,
        judgeMeAverageRating: 4.2,
        yotpoReviewCount: 2,
        yotpoNegativeReviewCount: 1,
        yotpoAverageRating: 3.5,
        looxReviewCount: 2,
        looxNegativeReviewCount: 1,
        looxAverageRating: 3,
        avgRating: 3.3,
        reviewRating: 3.3,
        textInsights: {
          reviews: {
            bySource: {
              csv: {
                sentiment: { total: 3, negative: 2, neutral: 1, positive: 0 },
                sentimentTrend: [
                  { label: "Jan 2026", positive: 0, neutral: 1, negative: 1, total: 2 },
                  { label: "Feb 2026", positive: 0, neutral: 0, negative: 1, total: 1 },
                ],
                ratingTrend: [
                  { label: "Jan 2026", averageRating: 2.8, reviewCount: 2 },
                  { label: "Feb 2026", averageRating: 2.1, reviewCount: 1 },
                ],
                emotions: [{ label: "Frustration", count: 2 }],
                repeatedLanguage: [{ term: "seam issue", count: 2, sources: ["csv_review"], sentiments: { negative: 2 } }],
                examples: [
                  { source: "csv_review", sourceLabel: "CSV reviews", title: "CSV fit note", text: "CSV review seam issue was repeated.", sentiment: "negative", rating: 2 },
                  { source: "csv_review", sourceLabel: "CSV reviews", title: "CSV fit note", text: "CSV review seam issue was repeated.", sentiment: "negative", rating: 2 },
                ],
              },
              judgeMe: {
                sentiment: { total: 4, negative: 1, neutral: 1, positive: 2 },
                sentimentTrend: [
                  { label: "Mar 2026", positive: 1, neutral: 1, negative: 0, total: 2 },
                  { label: "Apr 2026", positive: 1, neutral: 0, negative: 1, total: 2 },
                ],
                ratingTrend: [
                  { label: "Mar 2026", averageRating: 4.6, reviewCount: 2 },
                  { label: "Apr 2026", averageRating: 3.8, reviewCount: 2 },
                ],
                emotions: [{ label: "Concern", count: 1 }],
                repeatedLanguage: [{ term: "packaging dents", count: 1, sources: ["judgeme_review"], sentiments: { negative: 1 } }],
                examples: [{ source: "judgeme_review", sourceLabel: "Judge.me reviews", title: "Judge packaging note", text: "Judge.me packaging note mentioned dents.", sentiment: "negative", rating: 2 }],
              },
              yotpo: {
                sentiment: { total: 2, negative: 1, neutral: 1, positive: 0 },
                sentimentTrend: [
                  { label: "May 2026", positive: 0, neutral: 1, negative: 1, total: 2 },
                ],
                ratingTrend: [
                  { label: "May 2026", averageRating: 3.5, reviewCount: 2 },
                ],
                emotions: [{ label: "Confusion", count: 1 }],
                repeatedLanguage: [{ term: "pairing confusion", count: 1, sources: ["yotpo_review"], sentiments: { negative: 1 } }],
                examples: [{ source: "yotpo_review", sourceLabel: "Yotpo reviews", title: "Yotpo setup note", text: "Yotpo setup note mentioned pairing confusion.", sentiment: "negative", rating: 2 }],
              },
              loox: {
                sentiment: { total: 2, negative: 1, neutral: 0, positive: 1 },
                sentimentTrend: [
                  { label: "May 2026", positive: 1, neutral: 0, negative: 1, total: 2 },
                ],
                ratingTrend: [
                  { label: "May 2026", averageRating: 3, reviewCount: 2 },
                ],
                emotions: [{ label: "Distrust", count: 1 }],
                repeatedLanguage: [{ term: "material concerns", count: 1, sources: ["loox_review"], sentiments: { negative: 1 } }],
                examples: [{ source: "loox_review", sourceLabel: "Loox reviews", title: "Loox material note", text: "Loox photo review mentioned material concerns.", sentiment: "negative", rating: 2 }],
              },
            },
          },
        },
      },
    };

    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const riskSnapshot = container.querySelector(".ppRiskSnapshotBlock");

    expect(within(riskSnapshot).getByText("Average rating")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("3.3 / 5")).toBeInTheDocument();

    const judgeMeTab = screen.getByRole("tab", { name: "Judge.me reviews" });
    const yotpoTab = screen.getByRole("tab", { name: "Yotpo reviews" });
    const looxTab = screen.getByRole("tab", { name: "Loox reviews" });
    expect(judgeMeTab.querySelector(".ppProductPulseSourceLogoGlyph-judgeme-reviews")).toHaveAttribute("src", expect.stringContaining("judge.me"));
    expect(yotpoTab.querySelector(".ppProductPulseSourceLogoGlyph-yotpo-reviews")).toHaveAttribute("src", expect.stringContaining("yotpo.com"));
    expect(looxTab.querySelector(".ppProductPulseSourceLogoGlyph-loox-reviews")).toHaveAttribute("src", expect.stringContaining("loox.io"));

    fireEvent.click(screen.getByRole("tab", { name: "CSV reviews" }));
    expect(screen.getByRole("heading", { name: "CSV reviews" })).toBeInTheDocument();
    expect(screen.getByText(/CSV-only synthesis says imported review wording/)).toBeInTheDocument();
    expect(screen.queryByText(/Judge-only synthesis/)).not.toBeInTheDocument();
    expect(screen.getByText("CSV review seam issue was repeated.")).toBeInTheDocument();
    expect(screen.getAllByText("CSV review seam issue was repeated.")).toHaveLength(1);
    expect(screen.queryByText("Judge.me packaging note mentioned dents.")).not.toBeInTheDocument();
    expect(screen.getByText("2 negative reviews")).toBeInTheDocument();
    expect(screen.getByText("Review sentiment over time")).toBeInTheDocument();
    expect(screen.getByText("Average rating over time")).toBeInTheDocument();
    expect(screen.getAllByText("Jan 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Feb 2026").length).toBeGreaterThan(0);
    expect(screen.getByText("2.1 / 5")).toBeInTheDocument();
    expect(screen.getAllByText("Last 30 days").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Judge.me reviews" }));
    expect(screen.getByRole("heading", { name: "Judge.me reviews" })).toBeInTheDocument();
    expect(screen.getByText(/Judge-only synthesis says storefront reviews/)).toBeInTheDocument();
    expect(screen.queryByText(/CSV-only synthesis/)).not.toBeInTheDocument();
    expect(screen.getByText("Judge.me packaging note mentioned dents.")).toBeInTheDocument();
    expect(screen.queryByText("CSV review seam issue was repeated.")).not.toBeInTheDocument();
    expect(screen.getByText("1 negative reviews")).toBeInTheDocument();
    expect(screen.getAllByText("Mar 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Apr 2026").length).toBeGreaterThan(0);
    expect(screen.getByText("3.8 / 5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Yotpo reviews" }));
    expect(screen.getByRole("heading", { name: "Yotpo reviews" })).toBeInTheDocument();
    expect(screen.getByText(/Yotpo-only synthesis says review language/)).toBeInTheDocument();
    expect(screen.queryByText(/Judge-only synthesis/)).not.toBeInTheDocument();
    expect(screen.getByText("Yotpo setup note mentioned pairing confusion.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Loox reviews" }));
    expect(screen.getByRole("heading", { name: "Loox reviews" })).toBeInTheDocument();
    expect(screen.getByText(/Loox-only synthesis says review media/)).toBeInTheDocument();
    expect(screen.queryByText(/Yotpo-only synthesis/)).not.toBeInTheDocument();
    expect(screen.getByText("Loox photo review mentioned material concerns.")).toBeInTheDocument();
  });

  it("renders the full product evidence report with raw evidence relationships", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        textInsights: {
          sentiment: { total: 4, negative: 3, neutral: 1, positive: 0 },
          returns: {
            sentiment: { total: 3, negative: 2, neutral: 1, positive: 0 },
            emotions: [{ code: "fear", label: "Fear", polarity: "negative", count: 2 }],
            examples: [{
              text: "Other - Scares me more than nothing. I want them to take him away.",
              sentiment: "negative",
              emotion: "fear",
            }],
          },
          emotions: [{ code: "fear", label: "Fear", polarity: "negative", count: 2 }],
          aiKnownEmotions: [{ code: "fear", label: "Fear", polarity: "negative", count: 2 }],
          aiEmergentSentiments: [{ label: "Superstitious discomfort", normalizedLabel: "superstitious_discomfort", polarity: "negative", signals: 2 }],
          otherReturnClassifications: [{ issueCode: "fit_sizing", label: "Fit & sizing", count: 2 }],
        },
        productPurchaseContextSummary: purchaseContextSummaryFixture(),
        productPurchaseContextFactors: { hasPurchaseContextSummary: true },
        productRelationshipIntelligenceSummary: productRelationshipSummaryFixture(),
        returnRefundRelationshipSummary: relationshipSummaryFixture({
          sold_units: 12,
          returned_units: 4,
          refunded_units: 3,
          returned_and_refunded_units: 2,
          returned_not_refunded_units: 2,
          refunded_without_return_units: 1,
          relationship_match_confidence_avg: 0.9,
        }),
      },
      evidence: [
        ...defaultView.startHere.evidence,
        { source: "Customer language analysis", quote: "Dominant sentiment: negative", weight: "4 customer text signals analyzed" },
      ],
    };

    const { container } = renderWithRouter(<ProductEvidenceReportScreen product={product} source="Customer language analysis" />);
    expect(screen.getByText("Full Evidence Report")).toBeInTheDocument();
    expect(screen.getByText("Score calculation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Score calculation/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Evidence sources/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Customer language analysis/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Product risk formula")).toBeInTheDocument();
    expect(screen.getByText("Product risk calculation")).toBeInTheDocument();
    expect(screen.getByText("Diagnosis confidence calculation")).toBeInTheDocument();
    expect(screen.getByText("Estimated Margin Exposure calculation")).toBeInTheDocument();
    expect(screen.getByText("Issues detected")).toBeInTheDocument();
    expect(screen.getByText("Evidence sources")).toBeInTheDocument();
    expect(screen.queryByText("Raw product metrics")).not.toBeInTheDocument();
    expect(screen.getByText("Order and outcome context")).toBeInTheDocument();
    expect(screen.getByText("Purchase context")).toBeInTheDocument();
    expect(screen.getByText("How this product is bought")).toBeInTheDocument();
    expect(screen.getAllByText("Why it matters").length).toBeGreaterThan(0);
    expect(screen.getByText("Return & refund resolution")).toBeInTheDocument();
    const returnsEvidenceReport = container.querySelector(".ppShopifyReturnsReport");
    expect(returnsEvidenceReport).toBeInTheDocument();
    expect(within(returnsEvidenceReport).getByText("Returns vs. refunds relationship")).toBeInTheDocument();
    const outcomeContextSection = container.querySelector("#evidence-report-order-outcome-context");
    expect(within(outcomeContextSection).getByText("Relationship signal")).toBeInTheDocument();
    expect(within(outcomeContextSection).getByText("Top related:")).toBeInTheDocument();
    expect(outcomeContextSection.querySelector(".ppProductRelationshipSignalVisual img")).toHaveAttribute("src", "/assets/product-relationships/relationship-signal.png");
    expect(outcomeContextSection.querySelector(".ppPurchaseContextPanel").compareDocumentPosition(outcomeContextSection.querySelector(".ppReturnRefundResolutionPanel")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(outcomeContextSection.querySelector(".ppReturnRefundResolutionPanel").compareDocumentPosition(outcomeContextSection.querySelector(".ppEvidenceReportRelationshipSignalSlot")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(outcomeContextSection).queryByText("Returns vs. refunds relationship")).not.toBeInTheDocument();
    expect(screen.getByText("Recommendations and checks")).toBeInTheDocument();
    expect(screen.getByText("Diagnostic checks behind recommendations")).toBeInTheDocument();
    expect(screen.getByText(/These cards explain what ProductPulse inspected/)).toBeInTheDocument();
    expect(screen.getAllByText("Conclusion").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recommendation link").length).toBeGreaterThan(0);
    expect(container.querySelector("#evidence-source-customer-language-analysis")).toBeInTheDocument();
    expect(screen.getAllByText("All customer text sentiment").length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, element) => element?.textContent === "3 negative, 1 neutral, 0 positive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Deterministic emotion taxonomy").length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, element) => element?.textContent === "Fear 2").length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, element) => element?.textContent === "Other return notes classified as Fit & sizing 2 times").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Other").some((element) => element.tagName.toLowerCase() === "q")).toBe(true);
    expect(screen.getAllByText(/Scares me more than nothing/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Score calculation/ }));
    expect(screen.getByRole("button", { name: /Score calculation/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("labels recommendation checks with the available review source instead of defaulting to Judge.me", () => {
    const product = {
      ...defaultView.startHere,
      sourceCoverage: ["CSV reviews"],
      evidence: [
        { source: "CSV reviews", quote: "2 negative reviews out of 3", weight: "CSV average rating" },
      ],
      metrics: {
        ...defaultView.startHere.metrics,
        reviewCount: 3,
        negativeReviewCount: 2,
        avgRating: 2.4,
        reviewRating: 2.4,
        csvReviewCount: 3,
        csvNegativeReviewCount: 2,
        csvAverageRating: 2.4,
        judgeMeReviewCount: 0,
        judgeMeNegativeReviewCount: 0,
        judgeMeAverageRating: 0,
        reviewSourceStats: {
          csv: { reviewCount: 3, negativeReviewCount: 2, avgRating: 2.4 },
          judgeMe: { reviewCount: 0, negativeReviewCount: 0, avgRating: 0 },
          total: { reviewCount: 3, negativeReviewCount: 2, avgRating: 2.4 },
        },
      },
    };

    const { container } = renderWithRouter(<ProductEvidenceReportScreen product={product} source="CSV reviews" />);
    const checkBlock = container.querySelector("#evidence-report-recommendations-and-checks .ppEvidenceReportCheckBlock");

    expect(within(checkBlock).getByText("CSV reviews")).toBeInTheDocument();
    expect(within(checkBlock).queryByText("Judge.me reviews")).not.toBeInTheDocument();
    expect(within(checkBlock).getByText("2.4 avg rating, 2 negative")).toBeInTheDocument();
  });

  it("shows returns/refunds overlap from total outcome counts and cumulative return-rate charting", () => {
    const product = {
      ...defaultView.startHere,
      metrics: {
        ...defaultView.startHere.metrics,
        soldUnits: 8,
        returnUnits: 6,
        refundUnits: 1,
        returnRate: 75,
        monthlyOrderActivity: {
          summary: {
            totalOrderUnits: 8,
            totalReturnedUnits: 6,
          },
          months: [
            { key: "2025-06", shortLabel: "Jun", orderUnits: 0, returnedUnits: 0, returnRate: 0 },
            { key: "2025-11", shortLabel: "Nov", orderUnits: 2, returnedUnits: 2, returnRate: 100 },
            { key: "2025-12", shortLabel: "Dec", orderUnits: 1, returnedUnits: 1, returnRate: 100 },
            { key: "2026-01", shortLabel: "Jan", orderUnits: 1, returnedUnits: 1, returnRate: 100 },
            { key: "2026-02", shortLabel: "Feb", orderUnits: 1, returnedUnits: 1, returnRate: 100 },
            { key: "2026-03", shortLabel: "Mar", orderUnits: 1, returnedUnits: 1, returnRate: 100 },
            { key: "2026-04", shortLabel: "Apr", orderUnits: 1, returnedUnits: 0, returnRate: 0 },
            { key: "2026-05", shortLabel: "May", orderUnits: 1, returnedUnits: 0, returnRate: 0 },
          ],
        },
        returnRefundRelationshipSummary: relationshipSummaryFixture({
          sold_units: 8,
          returned_units: 6,
          refunded_units: 1,
          returned_and_refunded_units: 0,
          returned_not_refunded_units: 0,
          refunded_without_return_units: 1,
          exchange_or_replacement_units: 2,
          pending_return_units: 4,
          relationship_match_confidence_avg: 1,
        }),
      },
    };

    const { container } = renderWithRouter(<ProductEvidenceReportScreen product={product} source="Customer language analysis" />);
    const returnsEvidenceReport = container.querySelector(".ppShopifyReturnsReport");
    const venn = returnsEvidenceReport.querySelector(".ppReturnRefundVennCard");
    const returnLine = returnsEvidenceReport.querySelector(".ppEvidenceReturnLine");
    const returnArea = returnsEvidenceReport.querySelector(".ppEvidenceReturnArea");
    const lineYValues = (returnLine.getAttribute("d").match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) || [])
      .map((pair) => Number(pair.split(",")[1]))
      .filter(Number.isFinite);

    expect(within(returnsEvidenceReport).getByText("Cumulative return rate in scan window")).toBeInTheDocument();
    expect(venn.querySelector(".ppReturnRefundVennText-returns strong")).toHaveTextContent("100%");
    expect(venn.querySelector(".ppReturnRefundVennText-returns small")).toHaveTextContent("(6)");
    expect(venn.querySelector(".ppReturnRefundVennText-refunds strong")).toHaveTextContent("100%");
    expect(venn.querySelector(".ppReturnRefundVennText-refunds small")).toHaveTextContent("(1)");
    expect(Math.min(...lineYValues)).toBeGreaterThan(20);
    expect(returnArea.getAttribute("d")).toContain(" Q ");
  });

  it("collapses long recommended action descriptions", () => {
    const longDetail = Array.from({ length: 12 }, (_, index) => `Sentence ${index + 1} explains a specific customer-facing product quality recommendation with enough detail to require expansion.`).join(" ");
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "long-copy",
        label: "Rewrite detailed product guidance",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: { draftText: longDetail },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Rewrite detailed product guidance" }));
    expect(screen.getByText(longDetail)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit suggested text for Rewrite detailed product guidance" }));
    expect(screen.getByLabelText("Description text to apply")).toHaveAttribute("rows", "6");
  });

  it("blocks recommended action application until generated placeholders are replaced", () => {
    const placeholderText = "Add care guidance for {insert material details} before purchase.";
    const product = {
      ...defaultView.startHere,
      recommendedActions: [{
        id: "placeholder-copy",
        label: "Add care guidance",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: placeholderText,
          currentDescriptionText: "Existing product description.",
          operation: "append",
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add care guidance" }));
    const dialog = screen.getByRole("dialog", { name: "Add care guidance" });
    expect(within(dialog).getAllByText("{insert material details}").some((element) => element.classList.contains("ppEditablePlaceholder"))).toBe(true);
    expect(within(dialog).getByText(/must be replaced before applying/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply change" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit suggested text for Add care guidance" }));
    fireEvent.change(within(dialog).getByLabelText("Description text to apply"), {
      target: { value: "Add care guidance for brushed cotton before purchase." },
    });
    expect(within(dialog).queryByText(/must be replaced before applying/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply change" })).not.toBeDisabled();
  });

  it("does not treat CSS rule blocks as generated placeholders", () => {
    const cssDescription = [
      "<style>",
      ".product-pulse-panel{background:rgba(15,23,42,.44);backdrop-filter:blur(2px);}",
      ".product-pulse-panel strong{display:block;}",
      "</style>",
      "<p>Inflatable standing desk details are ready to publish.</p>",
    ].join("");
    const product = {
      ...defaultView.startHere,
      handle: "gen-inflatable-standing-desk-26a108d0",
      recommendedActions: [{
        id: "css-description",
        label: "Update Product Description",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: cssDescription,
          currentDescriptionText: "Existing product description.",
          operation: "replace",
        },
      }],
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Update Product Description" }));
    const dialog = screen.getByRole("dialog", { name: "Update Product Description" });
    expect(within(dialog).queryByText(/must be replaced before applying/)).not.toBeInTheDocument();
    expect(dialog.querySelector(".ppEditablePlaceholder")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Apply change" })).not.toBeDisabled();
  });

  it("renders Product Diagnosis from snapshot dates and supports issue actions", () => {
    const snapshotProduct = {
      ...defaultView.startHere,
      lastAnalysis: new Date("2026-05-12T12:30:00.000Z"),
      imageUrl: "https://cdn.example.com/product.jpg",
      imageAlt: "Snapshot product",
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={snapshotProduct} />);
    expect(screen.getByText(/Analyzed May 12, 2026/)).toBeInTheDocument();
    expect(screen.getByAltText("Snapshot product")).toHaveAttribute("src", "https://cdn.example.com/product.jpg");
    expect(screen.getByRole("button", { name: "Review evidence for Fit runs small around waist and inseam" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create action draft for Fit runs small around waist and inseam" })).not.toBeInTheDocument();
  });

  it("shows explicit empty product detail data instead of mock values", () => {
    const liveProduct = {
      id: "gid://shopify/Product/999",
      slug: "catalog-only-product",
      title: "Catalog Only Product",
      handle: "catalog-only-product",
      status: "Active",
      riskScore: 0,
      riskTone: "success",
      riskLabel: "Not scanned",
      confidence: 0,
      sourceCoverage: ["Shopify products"],
      lastAnalysis: null,
      primaryIssue: null,
      hasRiskSnapshot: false,
      canDiagnose: true,
      canResolve: false,
      metrics: {
        signalCount: 0,
        returnRate: 0,
        refundRate: 0,
        revenueAtRisk: 0,
        marginAtRisk: 0,
        variantCount: 0,
        tags: [],
        collections: [],
      },
      evidence: [{ source: "Shopify product", quote: "Active product in Shopify", weight: "0 variants, 0 SKUs, 0 tags" }],
      issues: [],
      recommendedActions: [],
      actionHistory: [],
    };

    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={liveProduct} />);
    expect(screen.getByRole("heading", { name: "No data for this product yet" })).toBeInTheDocument();
    expect(screen.getByText(/does not have a Catalog Scan or Product Diagnosis stored yet/)).toBeInTheDocument();
    expect(screen.queryByText("0 deterministic issues detected from stored product signals.")).not.toBeInTheDocument();
    expect(screen.queryByText("Recommended actions will appear after you run the Product Diagnosis for this product.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Issues detected" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recommended actions" })).not.toBeInTheDocument();
    expect(screen.getByText("Evidence by Source")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Shopify product" })).toBeInTheDocument();
    expect(container.querySelector(".ppProductSummaryGrid")).not.toBeInTheDocument();
    expect(screen.queryByText(/View all detected issues/)).not.toBeInTheDocument();
    expect(screen.queryByText(/View all actions/)).not.toBeInTheDocument();
    expect(screen.queryByText("Runs small in chest")).not.toBeInTheDocument();
    expect(screen.getAllByText(/0 variants/).length).toBeGreaterThan(0);
    const noDiagnosisPanel = screen.getByRole("heading", { name: "No data for this product yet" }).closest(".ppProductNoDiagnosisPanel");
    const runDiagnosisButton = within(noDiagnosisPanel).getByRole("button", { name: "Run Product Diagnosis" });
    expect(runDiagnosisButton).toBeEnabled();
    fireEvent.click(runDiagnosisButton);
    expect(screen.getByRole("dialog", { name: "Confirm Product Diagnosis" })).toBeInTheDocument();
  });

  it("renders the Product Diagnosis for the selected product", () => {
    const selectedProduct = defaultView.products.find((product) => product.slug === "trail-run-vest");
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={selectedProduct} />);
    expect(screen.getByRole("heading", { name: "Trail Run Vest" })).toBeInTheDocument();
    expect(screen.getAllByText("Zipper failures after first use").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Core Linen Trouser" })).not.toBeInTheDocument();
  });

  it("renders main finding as up to five blocks", () => {
    const selectedProduct = {
      ...defaultView.products.find((product) => product.slug === "trail-run-vest"),
      mainFinding: {
        title: "Multiple product signals need review",
        detail: [
          "Reviews point to a durability concern while product content and post-purchase signals also need review.",
          "What is wrong? Shoppers are reporting repeated zipper and fit failures.",
          "Why do we believe that? Reviews, returns, and product content gaps point to the same expectation issue.",
          "What should we do now? Tighten the product description and inspect the affected variant.",
          "How much does it matter? The issue is material because it affects trust and avoidable post-purchase friction.",
          "This sixth block should not render.",
        ].join("\n\n"),
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={selectedProduct} />);
    const mainFindingText = container.querySelector(".ppMainFindingText")?.textContent || "";
    expect(mainFindingText).toContain("Reviews point to a durability concern while product content and post-purchase signals also need review.");
    expect(mainFindingText).toContain("What is wrong? Shoppers are reporting repeated zipper and fit failures.");
    expect(mainFindingText).toContain("Why do we believe that? Reviews, returns, and product content gaps point to the same expectation issue.");
    expect(mainFindingText).toContain("What should we do now? Tighten the product description and inspect the affected variant.");
    expect(mainFindingText).toContain("How much does it matter? The issue is material because it affects trust and avoidable post-purchase friction.");
    expect(mainFindingText).not.toContain("This sixth block should not render.");
    expect(Array.from(container.querySelectorAll(".ppMainFindingQuestionHeading")).map((element) => element.textContent)).toEqual([
      "What is wrong?",
      "Why do we believe that?",
      "What should we do now?",
      "How much does it matter?",
    ]);
  });

  it("locks recommended actions until a Product Diagnosis runs", () => {
    const quickScanProduct = defaultView.products.find((product) => product.slug === "ceramic-pour-over");
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={quickScanProduct} />);
    expect(screen.getByText(/Analyzed May 7, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Run Product Diagnosis")).toBeInTheDocument();
    const emptyRecommendedActions = screen.getByText("Recommended actions will appear after you run the Product Diagnosis for this product.").closest(".ppProductDetailEmpty-recommended");
    expect(emptyRecommendedActions).toBeInTheDocument();
    expect(emptyRecommendedActions?.querySelector("s-icon")?.getAttribute("type")).toBe("wand");
    expect(emptyRecommendedActions?.querySelector("s-icon")?.getAttribute("size")).toBe("large");
    expect(screen.queryByRole("heading", { name: "Add compatibility FAQ" })).not.toBeInTheDocument();
  });

  it("renders analytics overview and chart panels", () => {
    const { container } = renderWithRouter(<AnalyticsScreen data={defaultView} />);
    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getAllByText("Estimated Margin Exposure").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Risk and margin trend").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "30D" })).toHaveClass("isActive");
    expect(screen.getAllByText("Estimated Margin Exposure (USD)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Revenue at risk (USD)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issue distribution by type").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Source coverage mix").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Action impact over time").length).toBeGreaterThan(0);
    const deepChartGrid = container.querySelector(".ppAnalyticsDeepChartGrid");
    const actionImpactGrid = container.querySelector(".ppAnalyticsActionImpactGrid");
    expect(deepChartGrid).toHaveTextContent("Risk and margin trend");
    expect(deepChartGrid).toHaveTextContent("Issue distribution by type");
    expect(deepChartGrid).not.toHaveTextContent("Source coverage mix");
    expect(actionImpactGrid).toHaveTextContent("Action impact over time");
    expect(actionImpactGrid).toHaveTextContent("Source coverage mix");
    expect(screen.getByText(/Apply recommended actions and run another diagnosis/)).toBeInTheDocument();
    expect(screen.getAllByText("Estimated Margin Exposure over time").length).toBeGreaterThan(0);
    expect(screen.getByText("Current total")).toBeInTheDocument();
    expect(screen.getByText("Trend-weighted now")).toBeInTheDocument();
    expect(screen.getAllByText("Trend-weighted margin").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Products needing attention/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /High risk/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evidence source coverage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issue impact by type").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Action performance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Catalog coverage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Top products at risk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Risk vs. margin impact").length).toBeGreaterThan(0);
    expect(screen.queryByText("Analysis coverage by depth")).not.toBeInTheDocument();
    expect(screen.queryByText("Risk signals over time")).not.toBeInTheDocument();
    expect(screen.queryByText("Source contribution")).not.toBeInTheDocument();
    expect(screen.getByText("X-axis: product risk, starting slightly below the lowest plotted product and ending at 100.")).toBeInTheDocument();
    expect(screen.getByText("Bubble size: estimated revenue at risk.")).toBeInTheDocument();
    expect(screen.getByText("Hover a bubble for product details; click it to open the Product Diagnosis page.")).toBeInTheDocument();
    expect(screen.getByText(/Ranks stored products by operational priority/)).toBeInTheDocument();
    const productBubbleLinks = screen.getAllByRole("link", { name: /open product detail/ });
    expect(productBubbleLinks.length).toBeGreaterThan(0);
    expect(productBubbleLinks[0].getAttribute("href")).toMatch(/^\/app\/products\//);
    fireEvent.mouseEnter(productBubbleLinks[0]);
    expect(screen.getByText(/Click to open product details/)).toBeInTheDocument();
    expect(screen.queryByText("View all insights")).not.toBeInTheDocument();
    expect(screen.getByText("Estimated Margin Exposure (next 90 days)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Learn how ProductPulse AI improves these outcomes/ }));
    expect(screen.getByRole("heading", { name: "How ProductPulse calculates estimated margin exposure" })).toBeInTheDocument();
    expect(screen.getByText("Calculation model")).toBeInTheDocument();
    expect(screen.getAllByText(/relationship-adjusted refund exposure/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/basket\/bulk margin exposure/).length).toBeGreaterThan(0);
    expect(screen.getByText(/return units x analytics projection window/)).toBeInTheDocument();
    expect(screen.getByText("Current breakdown")).toBeInTheDocument();
    expect(screen.getByText("Return revenue exposure")).toBeInTheDocument();
    expect(screen.getByText("Review conversion margin drag")).toBeInTheDocument();
    expect(screen.getByText("Inputs used")).toBeInTheDocument();
    expect(screen.getByText(/designed for prioritization/)).toBeInTheDocument();
  });

  it("shows analytics chart popovers and hides long-range risk margin points until hover", () => {
    const data = {
      ...defaultView,
      analytics: {
        ...defaultView.analytics,
        actionImpactTrend: {
          hasData: true,
          labels: ["May 1", "May 8", "May 15"],
          pointDetails: [
            { label: "May 1", sourceLabel: "Applied recommendation history", basisLabel: "1 applied action recorded by this date." },
            { label: "May 8", sourceLabel: "Applied recommendation history", basisLabel: "1 product compared against saved pre-action baselines." },
            { label: "May 15", sourceLabel: "Applied recommendation history", basisLabel: "2 products compared against saved pre-action baselines." },
          ],
          summary: { detail: "2 products compared against a saved pre-action baseline." },
          series: [
            { key: "actionsApplied", label: "Actions applied", color: "purple", axis: "count", values: [1, 1, 2] },
            { key: "reducedRiskUsd", label: "Reduced risk (USD)", color: "green", axis: "money", values: [0, 120, 260] },
            { key: "reducedReturns", label: "Reduced returns", color: "blue", axis: "percent", values: [0, 1.5, 2.4] },
          ],
        },
      },
    };
    const { container } = renderWithRouter(<AnalyticsScreen data={data} />);

    fireEvent.click(screen.getByRole("tab", { name: "90D" }));
    const riskPointGroup = container.querySelector(".ppAnalyticsRiskMarginPointGroup");
    const riskHoverTarget = container.querySelector(".ppAnalyticsRiskMarginHoverTarget");
    expect(riskPointGroup).not.toHaveClass("isPersistent");
    fireEvent.mouseEnter(riskHoverTarget);
    expect(document.body.querySelector(".ppAnalyticsSvgPopover")).toHaveTextContent("Estimated Margin Exposure");
    expect(document.body.querySelector(".ppAnalyticsSvgPopover")).toHaveTextContent(/Saved score-history exposure|Reconstructed saved risk trend|No saved exposure yet/);
    fireEvent.mouseLeave(riskPointGroup);

    const actionTarget = container.querySelector(".ppAnalyticsActionImpactBarTarget");
    fireEvent.mouseEnter(actionTarget);
    expect(document.body.querySelector(".ppAnalyticsSvgPopover")).toHaveTextContent("Actions applied");
    expect(document.body.querySelector(".ppAnalyticsSvgPopover")).toHaveTextContent("Applied recommendation history");
  });

  it("uses calendar windows for the analytics risk and margin trend range selector", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-28T12:00:00.000Z").getTime());
    const data = {
      ...defaultView,
      analytics: {
        ...defaultView.analytics,
        deepDiagnosisCharts: {
          ...defaultView.analytics.deepDiagnosisCharts,
          riskMarginTrend: {
            hasData: true,
            labels: ["May 10", "May 26"],
            pointDetails: [
              { label: "May 10", time: new Date("2026-05-10T10:00:00.000Z").getTime(), sourceLabel: "Saved score-history exposure" },
              { label: "May 26", time: new Date("2026-05-26T10:00:00.000Z").getTime(), sourceLabel: "Saved score-history exposure" },
            ],
            series: [
              { key: "marginAtRisk", label: "Estimated Margin Exposure (USD)", color: "green", axis: "left", values: [120, 280] },
              { key: "revenueAtRisk", label: "Revenue at risk (USD)", color: "purple", axis: "right", values: [300, 620] },
            ],
          },
        },
      },
    };

    const { container } = renderWithRouter(<AnalyticsScreen data={data} />);
    fireEvent.click(screen.getByRole("tab", { name: "7D" }));
    const chart = container.querySelector(".ppAnalyticsRiskMarginTrendSvg");
    expect(chart).toHaveTextContent("May 21");
    expect(chart).toHaveTextContent("May 28");
    expect(container.querySelectorAll(".ppAnalyticsRiskMarginPointGroup")).toHaveLength(16);

    fireEvent.click(screen.getByRole("tab", { name: "30D" }));
    expect(chart).toHaveTextContent("Apr 28");
    expect(chart).toHaveTextContent("May 28");
    expect(container.querySelectorAll(".ppAnalyticsRiskMarginPointGroup")).toHaveLength(62);

    fireEvent.click(screen.getByRole("tab", { name: "YTD" }));
    expect(chart).toHaveTextContent("Jan");
    expect(chart).toHaveTextContent("May");
  });

  it("toggles extra impact breakdown rows from a centered view-more control", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      label: `Collection ${index + 1}`,
      productsAffected: index + 1,
      marginAtRisk: 1000 - index * 50,
      revenueAtRisk: 2000 - index * 80,
      avgRisk: 70 - index,
    }));
    const data = {
      ...defaultView,
      analytics: {
        ...defaultView.analytics,
        impactBreakdown: {
          defaultKey: "collection",
          filters: [{ key: "collection", label: "By collection", rows }],
        },
      },
    };

    renderWithRouter(<AnalyticsScreen data={data} />);

    expect(screen.getByText("Collection 6")).toBeInTheDocument();
    expect(screen.queryByText("Collection 7")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View more (2)" }));
    expect(screen.getByText("Collection 8")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View less" }));
    expect(screen.queryByText("Collection 7")).not.toBeInTheDocument();
  });

  it("starts the risk margin x-axis near the lowest plotted risk score", () => {
    const data = {
      ...defaultView,
      analytics: {
        ...defaultView.analytics,
        riskBubbles: [
          {
            label: "Product A",
            href: "/app/products/product-a",
            riskScore: 66,
            riskLabel: "Medium",
            impact: 1200,
            issueLabel: "Refund pressure",
            signalCount: 4,
            returnRate: 8,
            refundRate: 2,
            analysisLabel: "Catalog Scan only",
            size: 18,
            tone: "orange",
          },
          {
            label: "Product B",
            href: "/app/products/product-b",
            riskScore: 82,
            riskLabel: "High",
            impact: 2400,
            issueLabel: "Return pressure",
            signalCount: 8,
            returnRate: 16,
            refundRate: 5,
            analysisLabel: "Full diagnosis",
            size: 28,
            tone: "red",
          },
        ],
      },
    };
    const { container } = renderWithRouter(<AnalyticsScreen data={data} />);
    const xTicks = [...container.querySelectorAll(".ppBubbleXTick")].map((tick) => tick.textContent);
    expect(xTicks[0]).toBe("50");
    expect(xTicks).not.toContain("0");
    expect(screen.getByRole("link", { name: /Product A: open product detail/ })).toHaveStyle({ left: "32%" });
  });

  it("renders zero compact money labels without browser-dependent decimals", () => {
    const data = {
      ...defaultView,
      analytics: {
        ...defaultView.analytics,
        riskBubbles: [
          {
            label: "Zero Revenue Product",
            href: "/app/products/zero-revenue-product",
            riskScore: 66,
            riskLabel: "Medium",
            impact: 0,
            revenueAtRisk: 0,
            issueLabel: "Review later",
            signalCount: 1,
            returnRate: 0,
            refundRate: 0,
            analysisLabel: "Catalog Scan only",
            size: 18,
            tone: "orange",
          },
        ],
      },
    };
    renderWithRouter(<AnalyticsScreen data={data} />);
    expect(screen.getAllByText("$0").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.0")).not.toBeInTheDocument();
  });

});

function relationshipSummaryFixture(overrides = {}) {
  const summary = {
    sold_units: 10,
    sold_orders: 8,
    returned_units: 0,
    returned_orders: 0,
    refunded_units: 0,
    refunded_orders: 0,
    returned_and_refunded_units: 0,
    returned_and_refunded_orders: 0,
    returned_not_refunded_units: 0,
    returned_not_refunded_orders: 0,
    refunded_without_return_units: 0,
    refunded_without_return_orders: 0,
    exchange_or_replacement_units: 0,
    exchange_or_replacement_orders: 0,
    pending_return_units: 0,
    pending_return_orders: 0,
    unattributed_refund_amount: 0,
    attributed_refund_amount: 0,
    refund_amount_with_return: 0,
    refund_amount_without_return: 0,
    total_product_revenue: 1000,
    relationship_match_confidence_avg: 0,
    relationship_match_confidence_min: 0,
    relationship_unknown_count: 0,
    refund_attribution_rate: 1,
    relationship_buckets: {},
    ...overrides,
  };
  summary.return_rate_units = summary.sold_units ? summary.returned_units / summary.sold_units : 0;
  summary.refund_rate_units = summary.sold_units ? summary.refunded_units / summary.sold_units : 0;
  summary.refund_rate_revenue = summary.total_product_revenue ? summary.attributed_refund_amount / summary.total_product_revenue : 0;
  summary.return_to_refund_rate = summary.returned_units ? summary.returned_and_refunded_units / summary.returned_units : 0;
  summary.refund_with_return_rate = summary.refunded_units ? summary.returned_and_refunded_units / summary.refunded_units : 0;
  summary.refund_without_return_rate = summary.sold_units ? summary.refunded_without_return_units / summary.sold_units : 0;
  summary.return_without_refund_rate = summary.sold_units ? summary.returned_not_refunded_units / summary.sold_units : 0;
  summary.exchange_rate = summary.sold_units ? summary.exchange_or_replacement_units / summary.sold_units : 0;
  summary.unattributed_refund_rate = summary.total_product_revenue ? summary.unattributed_refund_amount / summary.total_product_revenue : 0;
  return summary;
}

function purchaseContextSummaryFixture(overrides = {}) {
  const summary = {
    total_orders_containing_product: 10,
    total_units_sold: 12,
    total_revenue_if_available: 1000,
    solo_product_order_count: 5,
    multi_product_order_count: 5,
    single_unit_order_count: 8,
    multi_unit_order_count: 2,
    bulk_order_count: 0,
    multi_variant_order_count: 0,
    avg_product_quantity_per_order: 1.2,
    median_product_quantity_per_order: 1,
    avg_distinct_products_per_order: 2,
    avg_total_units_per_order: 2.4,
    top_co_purchased_products: [],
    purchase_context_confidence: 80,
    purchase_context_confidence_label: "High",
    unknown_or_incomplete_order_count: 0,
    bulk_purchase_threshold: 4,
    quantity_distribution: {
      one_unit_count: 8,
      two_unit_count: 1,
      three_unit_count: 1,
      four_plus_unit_count: 0,
    },
    monthly_context: [],
    purchase_context_segments: {},
    ...overrides,
  };
  summary.solo_purchase_rate = summary.total_orders_containing_product ? summary.solo_product_order_count / summary.total_orders_containing_product : 0;
  summary.multi_product_basket_rate = summary.total_orders_containing_product ? summary.multi_product_order_count / summary.total_orders_containing_product : 0;
  summary.single_unit_purchase_rate = summary.total_orders_containing_product ? summary.single_unit_order_count / summary.total_orders_containing_product : 0;
  summary.multi_unit_purchase_rate = summary.total_orders_containing_product ? summary.multi_unit_order_count / summary.total_orders_containing_product : 0;
  summary.bulk_purchase_rate = summary.total_orders_containing_product ? summary.bulk_order_count / summary.total_orders_containing_product : 0;
  summary.multi_variant_order_rate = summary.total_orders_containing_product ? summary.multi_variant_order_count / summary.total_orders_containing_product : 0;
  summary.quantity_distribution = {
    ...summary.quantity_distribution,
    one_unit_rate: summary.total_orders_containing_product ? summary.quantity_distribution.one_unit_count / summary.total_orders_containing_product : 0,
    two_unit_rate: summary.total_orders_containing_product ? summary.quantity_distribution.two_unit_count / summary.total_orders_containing_product : 0,
    three_unit_rate: summary.total_orders_containing_product ? summary.quantity_distribution.three_unit_count / summary.total_orders_containing_product : 0,
    four_plus_unit_rate: summary.total_orders_containing_product ? summary.quantity_distribution.four_plus_unit_count / summary.total_orders_containing_product : 0,
  };
  return summary;
}

function productRelationshipSummaryFixture(overrides = {}) {
  const careKitMonthly = [
    { month: "2026-03", source_product_orders: 4, related_order_count: 1, relationship_rate: 0.25 },
    { month: "2026-04", source_product_orders: 5, related_order_count: 2, relationship_rate: 0.4 },
    { month: "2026-05", source_product_orders: 7, related_order_count: 3, relationship_rate: 0.428 },
  ];
  const starterMonthly = [
    { month: "2026-03", source_product_orders: 4, related_order_count: 1, relationship_rate: 0.25 },
    { month: "2026-04", source_product_orders: 5, related_order_count: 2, relationship_rate: 0.4 },
  ];
  const refillMonthly = [
    { month: "2026-04", source_product_orders: 5, related_order_count: 1, relationship_rate: 0.2 },
    { month: "2026-05", source_product_orders: 7, related_order_count: 2, relationship_rate: 0.286 },
  ];
  return {
    source_product_id: "gid://shopify/Product/relationship-detail",
    relationship_model_version: "product_relationship_v1",
    data_basis: {
      same_order_available: true,
      customer_sequence_available: true,
      order_count: 14,
      customer_count: 10,
      known_basket_order_count: 14,
      unknown_basket_order_count: 0,
    },
    confidence: { score: 82, label: "High", reasons: [] },
    top_bought_together: [{
      related_product_id: "gid://shopify/Product/care-kit",
      related_product_title: "Care Kit",
      related_product_image_url: "https://cdn.example/care-kit.jpg",
      relationship_type: "same_order",
      relationship_direction: "together",
      time_window: "same_order",
      relationship_rate: 0.42,
      attach_rate: 0.42,
      lift: 2.4,
      confidence: 82,
      confidence_label: "High",
      sample_size: 5,
      co_order_count: 5,
      co_customer_count: 4,
      relationship_strength: "strong",
      trend: "stable",
      delta_return_rate: 0.08,
      delta_refund_rate: 0.02,
      monthly: careKitMonthly,
    }],
    top_bought_before: [{
      related_product_id: "gid://shopify/Product/starter-guide",
      related_product_title: "Starter Guide",
      related_product_image_url: "https://cdn.example/starter-guide.jpg",
      relationship_type: "previous_purchase",
      relationship_direction: "before",
      time_window: "30d_before",
      relationship_rate: 0.3,
      lift: 3.2,
      median_days_before: 12,
      confidence: 72,
      confidence_label: "Medium",
      sample_size: 3,
      customer_count: 3,
      relationship_strength: "moderate",
      trend: "increasing",
      monthly: starterMonthly,
    }],
    top_bought_after: [{
      related_product_id: "gid://shopify/Product/refill-pack",
      related_product_title: "Refill Pack",
      related_product_image_url: "https://cdn.example/refill-pack.jpg",
      relationship_type: "next_purchase",
      relationship_direction: "after",
      time_window: "30d_after",
      relationship_rate: 0.25,
      lift: 1.7,
      median_days_after: 9,
      follow_on_revenue: 280,
      confidence: 76,
      confidence_label: "Medium",
      sample_size: 4,
      customer_count: 4,
      relationship_strength: "moderate",
      trend: "increasing",
      monthly: refillMonthly,
    }],
    strongest_relationships: [
      { related_product_id: "gid://shopify/Product/care-kit", related_product_title: "Care Kit", relationship_direction: "together", time_window: "same_order", relationship_rate: 0.42, attach_rate: 0.42, lift: 2.4, confidence: 82, confidence_label: "High", sample_size: 5, relationship_strength: "strong", trend: "stable", monthly: careKitMonthly },
      { related_product_id: "gid://shopify/Product/starter-guide", related_product_title: "Starter Guide", relationship_direction: "before", time_window: "30d_before", relationship_rate: 0.3, lift: 3.2, confidence: 72, confidence_label: "Medium", sample_size: 3, relationship_strength: "moderate", trend: "increasing", monthly: starterMonthly },
      { related_product_id: "gid://shopify/Product/refill-pack", related_product_title: "Refill Pack", relationship_direction: "after", time_window: "30d_after", relationship_rate: 0.25, lift: 1.7, confidence: 76, confidence_label: "Medium", sample_size: 4, relationship_strength: "moderate", trend: "increasing", monthly: refillMonthly },
      { related_product_id: "gid://shopify/Product/noise", related_product_title: "Fourth hidden trend", relationship_direction: "together", time_window: "same_order", relationship_rate: 0.18, lift: 1.4, confidence: 70, confidence_label: "Medium", sample_size: 3, relationship_strength: "weak", trend: "stable", monthly: careKitMonthly },
    ],
    relationship_trends: [
      { related_product_id: "gid://shopify/Product/care-kit", related_product_title: "Care Kit", relationship_direction: "together", time_window: "same_order", monthly: careKitMonthly, trend: "stable", confidence: 82 },
      { related_product_id: "gid://shopify/Product/starter-guide", related_product_title: "Starter Guide", relationship_direction: "before", time_window: "30d_before", monthly: starterMonthly, trend: "increasing", confidence: 72 },
      { related_product_id: "gid://shopify/Product/refill-pack", related_product_title: "Refill Pack", relationship_direction: "after", time_window: "30d_after", monthly: refillMonthly, trend: "increasing", confidence: 76 },
      { related_product_id: "gid://shopify/Product/noise", related_product_title: "Fourth hidden trend", relationship_direction: "together", time_window: "same_order", monthly: careKitMonthly, trend: "stable", confidence: 70 },
    ],
    relationships_with_return_risk_impact: [{
      related_product_id: "gid://shopify/Product/care-kit",
      related_product_title: "Care Kit",
      relationship_type: "same_order",
      relationship_direction: "together",
      time_window: "same_order",
      relationship_rate: 0.42,
      attach_rate: 0.42,
      lift: 2.4,
      confidence: 82,
      confidence_label: "High",
      sample_size: 5,
      relationship_strength: "strong",
      trend: "stable",
      delta_return_rate: 0.08,
      delta_refund_rate: 0.02,
      monthly: careKitMonthly,
    }],
    relationships_with_cross_sell_opportunity: [{
      related_product_id: "gid://shopify/Product/refill-pack",
      related_product_title: "Refill Pack",
      relationship_type: "next_purchase",
      relationship_direction: "after",
      time_window: "30d_after",
      relationship_rate: 0.25,
      lift: 1.7,
      confidence: 76,
      confidence_label: "Medium",
      sample_size: 4,
      relationship_strength: "moderate",
      trend: "increasing",
    }],
    warnings: [],
    ...overrides,
  };
}
