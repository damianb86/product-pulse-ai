import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  AnalyticsScreen,
  ConnectScreen,
  DashboardScreen,
  ProductDiagnosisScreen,
  ProductEvidenceReportScreen,
  ProductsScreen,
  SettingsScreen,
  WatchlistActivityScreen,
  WatchlistScreen,
} from "../../app/components/ProductPulseScreens";
import { defaultView } from "../fixtures/product-pulse-fixtures";

function renderWithRouter(element) {
  const router = createMemoryRouter([{ path: "/", element }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

function renderWithAction(element, action) {
  const router = createMemoryRouter([{ path: "/", element, action }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

describe("ProductPulse screens", () => {
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
    expect(screen.getByText("Yotpo Reviews")).toBeInTheDocument();
    expect(screen.getByText("Shopify Returns & Refunds")).toBeInTheDocument();
    const chatMeRow = screen.getByText("ChatMe Reviews").closest("tr");
    expect(within(chatMeRow).getByRole("button", { name: "Coming soon" })).toBeDisabled();
    expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Always on").length).toBeGreaterThan(0);
    expect(screen.getByText("Data coverage")).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection setup progress")).not.toBeInTheDocument();
  });

  it("does not show category ignore controls in Connect", () => {
    renderWithRouter(<ConnectScreen data={defaultView} />);
    expect(screen.getByText("0% effective customer-signal coverage")).toBeInTheDocument();
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
    expect(within(csvRow).getByText("CSV import disabled; ignored by scans and diagnostics.")).toBeInTheDocument();
    expect(within(csvRow).getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("connects Judge.me from the connection modal", async () => {
    renderWithRouter(<ConnectScreen data={defaultView} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("heading", { name: "Judge.me Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Judge.me API settings" })).toHaveAttribute("href", "https://judge.me/settings?jump_to=judge.me+api");
    expect(screen.getByRole("link", { name: "Judge.me API documentation" })).toHaveAttribute("href", "https://judge.me/help/en/articles/8409180-judge-me-api");
    fireEvent.change(screen.getByLabelText("Private API token"), { target: { value: "judgeme_private_123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getAllByText("Connected to Judge.me.")).toHaveLength(1));
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.getByText("60% effective customer-signal coverage")).toBeInTheDocument();
  });

  it("renders products table and analysis actions", () => {
    renderWithRouter(<ProductsScreen data={defaultView} filters={{ query: "", risk: "all" }} />);
    const table = screen.getByTestId("products-table");
    expect(within(table).getByText("No full diagnostics yet")).toBeInTheDocument();
    expect(within(table).queryByText("Credits")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("products-candidates-table")).getByText("No candidates yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Run quick scan/ }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole("button", { name: "Find Shopify product" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Find Shopify product" })[0]);
    expect(screen.getByRole("heading", { name: "Find Shopify product" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search by title, handle, product ID or SKU")).toBeInTheDocument();
    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
    expect(within(table).queryByRole("link", { name: /Linen Shirt/ })).not.toBeInTheDocument();
  });

  it("renders the watchlist and opens the add watched product modal", () => {
    renderWithRouter(<WatchlistScreen
      data={{
        watchlist: {
          maxProducts: 5,
          watchedCount: 2,
          slotsAvailable: 3,
          rows: [
            {
              id: "watch-1",
              productGid: "gid://shopify/Product/1",
              title: "Nintendo New 3DS XL",
              sku: "N3DSXL-BLUE",
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
              latestChangeReport: {
                status: "changed",
                title: "Watchlist changes detected",
                summary: "2 meaningful changes since the previous Watchlist run. Product risk increased from 58 to 63.",
                narrative: "Nintendo New 3DS XL picked up new return and review evidence since the last Watchlist scan.",
                headline: "Product risk increased from 58 to 63.",
                changeCount: 2,
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
            },
            {
              id: "watch-2",
              productGid: "gid://shopify/Product/2",
              title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
              sku: "ART-REMBRANDT",
              status: "Watching",
              statusTone: "success",
              riskScore: 46,
              riskLabel: "Low",
              riskTone: "success",
              latestChange: "No new issues",
              latestChangeDetail: "All clear",
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
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    expect(screen.getAllByText("Nintendo New 3DS XL").length).toBeGreaterThan(0);
    expect(screen.getByText("Recent watch activity")).toBeInTheDocument();
    expect(screen.getByText("Product added to watchlist")).toBeInTheDocument();
    expect(screen.getByText("Watchlist trend (risk activity)")).toBeInTheDocument();
    expect(screen.getByText("63 · Medium")).toBeInTheDocument();
    expect(screen.getByText("46 · Low")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Nintendo New 3DS XL" })).toHaveAttribute("href", "/app/products/nintendo-new-3ds-xl");
    fireEvent.click(screen.getByRole("button", { name: "View latest Watchlist change report for Nintendo New 3DS XL" }));
    const reportDialog = screen.getByRole("dialog", { name: "Nintendo New 3DS XL" });
    expect(within(reportDialog).getByText("Watchlist change report")).toBeInTheDocument();
    expect(within(reportDialog).getByText("Product risk increased from 58 to 63.")).toBeInTheDocument();
    expect(within(reportDialog).getByText("Return evidence changed")).toBeInTheDocument();
    expect(within(reportDialog).getByText("Nintendo New 3DS XL picked up new return and review evidence since the last Watchlist scan.")).toBeInTheDocument();
    fireEvent.click(within(reportDialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: /Move Nintendo New 3DS XL/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/app/watchlist/activity");
    expect(screen.getByRole("button", { name: "Pause Nintendo New 3DS XL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Nintendo New 3DS XL from watchlist" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Watch settings" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Save settings")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ops@store.com, support@store.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Disable watch alerts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add watched product" }));
    expect(screen.getByRole("heading", { name: "Add watched product" })).toBeInTheDocument();
    expect(screen.getByText(/add one product to automatic monitoring/i)).toBeInTheDocument();
  });

  it("renders full watchlist activity history", () => {
    renderWithRouter(<WatchlistActivityScreen
      data={{
        watchlist: {
          maxProducts: 5,
          watchedCount: 1,
          slotsAvailable: 4,
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
          detail: "Qorve / Outerwear",
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
            detail: "Qorve / Outerwear",
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
            detail: "Qorve / Bags",
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
    expect(screen.getByLabelText(/Added to Candidates.*still run diagnostics/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Run diagnostics" })[0]).not.toBeDisabled();
  });

  it("renders settings controls for thresholds and queue limits", () => {
    renderWithRouter(<SettingsScreen data={{
      ...defaultView,
      settings: {
        risk: { minimumScore: 50, mediumThreshold: 55, highThreshold: 75 },
        momentum: { minimumScore: 72 },
        diagnosis: { maxQueuedPerSubmission: 12 },
        analysis: { lookbackDays: 120 },
      },
    }} />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Product risk thresholds")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum QuickScan score")).toHaveValue("50");
    expect(screen.getByLabelText("Medium risk starts at")).toHaveValue("55");
    expect(screen.getByLabelText("High risk starts at")).toHaveValue("75");
    expect(screen.getByText("Product Momentum inclusion")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum Product Momentum score")).toHaveValue("72");
    expect(screen.queryByText("Table defaults")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Max diagnoses queued at once")).toHaveValue(12);
    expect(screen.getByText("Evidence lookback")).toBeInTheDocument();
    expect(screen.getByLabelText("Analysis lookback days")).toHaveValue("120");
    expect(screen.queryByRole("link", { name: "Back to Products" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cost control")).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenAI Batch/)).not.toBeInTheDocument();
  });

  it("shows a scan overlay when a quick scan starts", () => {
    renderWithRouter(<ProductsScreen data={defaultView} filters={{ query: "", risk: "all" }} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Run quick scan/ })[0]);
    expect(screen.getByRole("heading", { name: "Confirm quick product scan" })).toBeInTheDocument();
    expect(screen.getByText("QuickScan costs 1 credit and runs as a background job.")).toBeInTheDocument();
    expect(screen.getByText(/Products that already have a full AI product diagnosis will be ignored/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept cost and run QuickScan" }));
    expect(screen.getByText("Fast product scan running")).toBeInTheDocument();
    expect(screen.getByText(/backend job will keep running/)).toBeInTheDocument();
    expect(screen.queryByText(/8%/)).not.toBeInTheDocument();
  });

  it("recommends uploading CSV reviews before QuickScan when no review CSV is configured", () => {
    const data = {
      ...defaultView,
      quickScanCsvReviews: { available: false, connected: false, active: false, rowCount: 0 },
    };

    renderWithRouter(<ProductsScreen data={data} filters={{ query: "", risk: "all" }} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Run quick scan/ })[0]);
    expect(screen.getByRole("heading", { name: "Add CSV reviews before QuickScan?" })).toBeInTheDocument();
    expect(screen.getByText(/ProductPulse does not call your review provider during QuickScan/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload CSV first" })).toHaveAttribute("href", "/app/connect");
    expect(screen.queryByRole("heading", { name: "Confirm quick product scan" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue without CSV" }));
    expect(screen.getByRole("heading", { name: "Confirm quick product scan" })).toBeInTheDocument();
  });

  it("keeps the quick scan action available when product rows exist", async () => {
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
            displaySubtitle: "Running AI product diagnostics",
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
    expect(screen.getAllByRole("button", { name: /Run quick scan/ }).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("Momentum").length).toBeGreaterThan(0);
    const trendLink = screen.getByRole("link", { name: "Rising risk trend for Linen Shirt" });
    expect(within(trendLink).getByText("Rising")).toBeInTheDocument();
    expect(screen.getByText("Hot 87")).toBeInTheDocument();
    expect(screen.getByText("+68% 30d · Top 12%")).toBeInTheDocument();
    expect(screen.getByText("Strong · 3 sources")).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Open Product Momentum for Linen Shirt" }));
    expect(await screen.findByText("Product Momentum")).toBeInTheDocument();
    expect(screen.getByText("Hot · 87/100")).toBeInTheDocument();
    expect(screen.getByText("42 units")).toBeInTheDocument();
    expect(screen.getByText("$3,240 revenue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Watchlist" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Analyze selected (1)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Linen Shirt" }));
    expect(screen.getByRole("menuitem", { name: /View diagnostics/ })).toHaveAttribute("href", "/app/products/linen-shirt");
    expect(screen.getByRole("menuitem", { name: "Copy handle" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Add to Watchlist" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete analysis" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Mark for review" })).not.toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menuitem", { name: "Delete analysis" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Linen Shirt" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete analysis" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete product analysis?" });
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
          analysisLabel: "QuickScan only",
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

  it("renders product diagnosis evidence and draft actions", () => {
    renderWithAction(
      <ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />,
      async () => ({
        status: "success",
        action: { id: "fit-note", label: "Add fit note" },
        actionRecordStatus: "dismissed",
      }),
    );
    expect(screen.getByText(/Sizing & fit expectations are not being met/)).toBeInTheDocument();
    expect(screen.getByText("$24,700")).toBeInTheDocument();
    expect(screen.getByText("$9,200 margin at risk")).toBeInTheDocument();
    expect(screen.getAllByText(/Fit runs small around waist and inseam/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Add fit note").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Deep analysis completed/ })).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "View Full Report" })).toHaveAttribute("href", "/app/products/core-linen-trouser/evidence?source=Returns");
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

  it("puts Shopify Admin in the product header and storefront in product actions", () => {
    const product = {
      ...defaultView.startHere,
      shopifyAdminUrl: "https://admin.shopify.com/store/qorve/products/123",
      shopifyStorefrontUrl: "https://qorve.example.com/products/core-linen-trouser",
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getByRole("link", { name: "Open in Shopify Admin" })).toHaveAttribute("href", product.shopifyAdminUrl);
    expect(screen.queryByRole("link", { name: "View in Store" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Core Linen Trouser" }));
    expect(screen.getByRole("menuitem", { name: "View in Store" })).toHaveAttribute("href", product.shopifyStorefrontUrl);
    expect(screen.queryByRole("menuitem", { name: "Open in Shopify admin" })).not.toBeInTheDocument();
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

  it("shows saved product risk history in the detail sidebar", () => {
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
          },
          {
            id: "history-2",
            riskScore: 88,
            source: "full-diagnosis",
            recordedAt: "2026-05-10T18:10:00.000Z",
            primaryIssue: "Fit runs small around waist and inseam",
          },
        ],
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const historyPanel = container.querySelector(".ppProductRiskHistoryPanel");

    expect(historyPanel).toBeInTheDocument();
    expect(historyPanel.closest(".ppProductDetailSidebar")).toBeInTheDocument();
    expect(within(historyPanel).getByText("Product risk over time")).toBeInTheDocument();
    expect(within(historyPanel).getByText("88 / 100")).toBeInTheDocument();
    expect(within(historyPanel).getByText("Up 16 pts since last analysis")).toBeInTheDocument();
    expect(within(historyPanel).getByText("2 saved scores · May 1, 2026 to May 10, 2026")).toBeInTheDocument();
    expect(within(historyPanel).getByText("Fit runs small around waist and inseam")).toBeInTheDocument();
  });

  it("renders Product Momentum in the product detail view", () => {
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
    const sidebarPanels = Array.from(container.querySelectorAll(".ppProductDetailSidebar > *"));
    const riskPanelIndex = sidebarPanels.findIndex((element) => element.classList.contains("ppProductRiskHistoryPanel"));
    const momentumPanelIndex = sidebarPanels.findIndex((element) => element.classList.contains("ppProductMomentumPanel"));
    const gauge = panel.querySelector(".ppProductMomentumGauge");
    const weeklyChart = panel.querySelector(".ppProductMomentumWeeklyChart");

    expect(screen.getAllByText("Product Momentum").length).toBeGreaterThan(0);
    expect(panel.closest(".ppProductDetailSidebar")).toBeInTheDocument();
    expect(momentumPanelIndex).toBeGreaterThan(riskPanelIndex);
    expect(gauge.querySelector(".ppProductMomentumGaugeCenter strong")).toHaveTextContent(/\d+\s*\/\s*100/);
    expect(within(gauge).getByText("/ 100")).toBeInTheDocument();
    expect(gauge).toBeInTheDocument();
    expect(gauge.querySelector(".ppProductMomentumGaugeArc")).toBeInTheDocument();
    expect(gauge.querySelector(".ppProductMomentumNeedle")).toBeInTheDocument();
    expect(weeklyChart).toBeInTheDocument();
    expect(within(weeklyChart).getByText("Units sold")).toBeInTheDocument();
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
    ["0", "25", "50", "75", "100"].forEach((label) => {
      expect(within(gauge).getByText(label)).toBeInTheDocument();
    });
    ["Velocity", "Growth", "Catalog share", "Trend consistency", "Recency"].forEach((label) => {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    });
    expect(panel.querySelector(".ppProductMomentumTrendBars")).not.toBeInTheDocument();
    expect(within(panel).getByText("High confidence")).toBeInTheDocument();
    expect(within(panel).getByText("42 units · $3,240 revenue in the last 30 days")).toBeInTheDocument();
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
      .find((card) => card.textContent.includes("Product Momentum"));
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
    expect(componentValues.every((value) => value < 100)).toBe(true);
    expect(within(momentumCard).getByText("Last 4 weekly units")).toBeInTheDocument();
    expect(firstLineY - lastLineY).toBeGreaterThan(10);
  });

  it("renders monthly order activity for product diagnosis", () => {
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
      },
    };
    const { container } = renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    const orderPanel = container.querySelector(".ppProductOrderActivityPanel");

    expect(orderPanel).toBeInTheDocument();
    expect(within(orderPanel).getByText("Monthly order activity")).toBeInTheDocument();
    expect(within(orderPanel).getByText("365-day window")).toBeInTheDocument();
    expect(within(orderPanel).getAllByText("Total orders").length).toBeGreaterThan(0);
    expect(within(orderPanel).getAllByText("Returned orders").length).toBeGreaterThan(0);
    expect(within(orderPanel).getAllByText("Refunded orders").length).toBeGreaterThan(0);
    expect(within(orderPanel).getByText("$150")).toBeInTheDocument();
    expect(within(orderPanel).getByText("Apr")).toBeInTheDocument();
    expect(within(orderPanel).getByText("May")).toBeInTheDocument();
    expect(within(orderPanel).getByText("Revenue")).toBeInTheDocument();
    expect(within(orderPanel.querySelector(".ppOrderActivityYAxisRight")).getByText("$1,200")).toBeInTheDocument();
    expect(orderPanel.querySelector(".ppOrderActivityLineRevenue")).toBeInTheDocument();
    expect(orderPanel.querySelectorAll(".ppOrderActivityBarRefunds")).toHaveLength(1);
    expect(orderPanel.querySelectorAll(".ppOrderActivityBarReturns")).toHaveLength(2);
    expect(orderPanel.querySelectorAll(".ppOrderActivityBarTotal")).toHaveLength(2);
  });

  it("renders return-rate prediction for product diagnosis", () => {
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
    expect(within(predictionPanel).getByText("Medium confidence")).toBeInTheDocument();
    expect(within(predictionPanel).getByText("Forecast range")).toBeInTheDocument();
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

  it("shows a full-diagnosis prompt instead of commercial charts for QuickScan-only products", () => {
    const product = {
      ...defaultView.startHere,
      analysisDepth: "quickscan",
      analysisLabel: "QuickScan only",
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
    expect(riskSnapshot.querySelectorAll(".ppProductInsight-withArea")).toHaveLength(10);
    expect(riskSnapshot.querySelectorAll(".ppRiskSnapshot-primary .ppProductInsight-withArea")).toHaveLength(4);
    expect(riskSnapshot.querySelectorAll(".ppRiskSnapshot-extra .ppProductInsight-withArea")).toHaveLength(6);
    expect(riskSnapshot.querySelectorAll(".ppProductInsightAreaTrend")).toHaveLength(10);
    expect(riskSnapshot.querySelectorAll(".ppProductInsight-withArea .ppInsightInfoWrap")).toHaveLength(10);
    expect(within(riskSnapshot).getByRole("button", { name: /view more/i })).toHaveAttribute("aria-expanded", "false");
    expect(within(riskSnapshot).getByText("Emerging")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Improving")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Return pressure")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Refund leakage")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Evidence strength")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Customer signals")).toBeInTheDocument();
    expect(within(riskSnapshot).getByText("Negative review pressure")).toBeInTheDocument();
    [
      /how severe the product problem is over time/i,
      /commercial strength from sales velocity/i,
      /how reliable the diagnosis is/i,
      /money at risk from refunds/i,
      /customer-friction index/i,
      /sales value is leaking into refunds/i,
      /broad and useful the product evidence is/i,
      /volume of customer-facing signals/i,
      /share of connected reviews that are negative/i,
      /strongest issue category currently detected/i,
    ].forEach((tooltipCopy) => {
      expect(within(riskSnapshot).getByText(tooltipCopy)).toBeInTheDocument();
    });
    fireEvent.click(within(riskSnapshot).getByRole("button", { name: /view more/i }));
    expect(riskSnapshot).toHaveClass("isExpanded");
    expect(within(riskSnapshot).getByRole("button", { name: /show less/i })).toHaveAttribute("aria-expanded", "true");
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
      shopifyAdminUrl: "https://admin.shopify.com/store/qorve/products/123",
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
      shopifyAdminUrl: "https://admin.shopify.com/store/qorve/products/123",
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
    expect(screen.getByRole("button", { name: "Start verification" })).toBeInTheDocument();
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

  it("renders granular sentiment and language evidence in product diagnosis", () => {
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
        orderGeography: [
          { label: "Texas, United States", count: 8, share: 66.7, detail: "8 orders · 66.7%" },
          { label: "Canada", count: 4, share: 33.3, detail: "4 orders · 33.3%" },
        ],
      },
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);
    expect(screen.getByRole("tab", { name: "Shopify orders" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Units sold over time")).toBeInTheDocument();
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
    expect(within(synthesisSection).getByText(/Stored AI synthesis says variant evidence should guide action/)).toBeInTheDocument();
    expect(within(synthesisSection).getByText(/Stored AI reading highlights expectation-setting language/)).toBeInTheDocument();
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
      ],
      metrics: {
        ...defaultView.startHere.metrics,
        reviewSourceStats: {
          csv: { reviewCount: 3, negativeReviewCount: 2, avgRating: 2.4, negativeReviewRate: 67, recentNegativeReviewCount: 1 },
          judgeMe: { reviewCount: 4, negativeReviewCount: 1, avgRating: 4.2, negativeReviewRate: 25, recentNegativeReviewCount: 1 },
          total: { reviewCount: 7, negativeReviewCount: 3, avgRating: 3.4, negativeReviewRate: 43, recentNegativeReviewCount: 2 },
        },
        csvReviewCount: 3,
        csvNegativeReviewCount: 2,
        csvAverageRating: 2.4,
        judgeMeReviewCount: 4,
        judgeMeNegativeReviewCount: 1,
        judgeMeAverageRating: 4.2,
        textInsights: {
          reviews: {
            bySource: {
              csv: {
                sentiment: { total: 3, negative: 2, neutral: 1, positive: 0 },
                sentimentTrend: [
                  { label: "Jan 2026", positive: 0, neutral: 1, negative: 1, total: 2 },
                  { label: "Feb 2026", positive: 0, neutral: 0, negative: 1, total: 1 },
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
                emotions: [{ label: "Concern", count: 1 }],
                repeatedLanguage: [{ term: "packaging dents", count: 1, sources: ["judgeme_review"], sentiments: { negative: 1 } }],
                examples: [{ source: "judgeme_review", sourceLabel: "Judge.me reviews", title: "Judge packaging note", text: "Judge.me packaging note mentioned dents.", sentiment: "negative", rating: 2 }],
              },
            },
          },
        },
      },
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={product} />);

    fireEvent.click(screen.getByRole("tab", { name: "CSV reviews" }));
    expect(screen.getByRole("heading", { name: "CSV reviews" })).toBeInTheDocument();
    expect(screen.getByText(/CSV-only synthesis says imported review wording/)).toBeInTheDocument();
    expect(screen.queryByText(/Judge-only synthesis/)).not.toBeInTheDocument();
    expect(screen.getByText("CSV review seam issue was repeated.")).toBeInTheDocument();
    expect(screen.getAllByText("CSV review seam issue was repeated.")).toHaveLength(1);
    expect(screen.queryByText("Judge.me packaging note mentioned dents.")).not.toBeInTheDocument();
    expect(screen.getByText("2 negative reviews")).toBeInTheDocument();
    expect(screen.getByText("Review sentiment over time")).toBeInTheDocument();
    expect(screen.getByText("Jan 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Feb 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Last 30 days").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Judge.me reviews" }));
    expect(screen.getByRole("heading", { name: "Judge.me reviews" })).toBeInTheDocument();
    expect(screen.getByText(/Judge-only synthesis says storefront reviews/)).toBeInTheDocument();
    expect(screen.queryByText(/CSV-only synthesis/)).not.toBeInTheDocument();
    expect(screen.getByText("Judge.me packaging note mentioned dents.")).toBeInTheDocument();
    expect(screen.queryByText("CSV review seam issue was repeated.")).not.toBeInTheDocument();
    expect(screen.getByText("1 negative reviews")).toBeInTheDocument();
    expect(screen.getByText("Mar 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Apr 2026").length).toBeGreaterThan(0);
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
      },
      evidence: [
        ...defaultView.startHere.evidence,
        { source: "Customer language analysis", quote: "Dominant sentiment: negative", weight: "4 customer text signals analyzed" },
      ],
    };

    renderWithRouter(<ProductEvidenceReportScreen product={product} source="Customer language analysis" />);
    expect(screen.getByText("Full Evidence Report")).toBeInTheDocument();
    expect(screen.getByText("Score calculation")).toBeInTheDocument();
    expect(screen.getByText("Product risk formula")).toBeInTheDocument();
    expect(screen.getByText("Product risk calculation")).toBeInTheDocument();
    expect(screen.getByText("Diagnosis confidence calculation")).toBeInTheDocument();
    expect(screen.getByText("Financial exposure calculation")).toBeInTheDocument();
    expect(screen.getByText("Issues detected")).toBeInTheDocument();
    expect(screen.getByText("Evidence sources")).toBeInTheDocument();
    expect(screen.getByText("Raw product metrics")).toBeInTheDocument();
    expect(screen.getByText("Recommendations and checks")).toBeInTheDocument();
    expect(screen.getAllByText("All customer text sentiment").length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, element) => element?.textContent === "3 negative, 1 neutral, 0 positive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Deterministic emotion taxonomy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fear 2").length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, element) => element?.textContent === "Other return notes classified as Fit & sizing 2 times").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Other").some((element) => element.tagName.toLowerCase() === "q")).toBe(true);
    expect(screen.getAllByText(/Scares me more than nothing/).length).toBeGreaterThan(0);
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

  it("renders product diagnosis from snapshot dates and supports issue actions", () => {
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
      canDiagnose: false,
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

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={liveProduct} />);
    expect(screen.getByText("0 deterministic issues detected from stored product signals.")).toBeInTheDocument();
    expect(screen.getByText("Recommended actions will appear after you run the full product diagnosis for this product.")).toBeInTheDocument();
    expect(screen.queryByText(/View all detected issues/)).not.toBeInTheDocument();
    expect(screen.queryByText(/View all actions/)).not.toBeInTheDocument();
    expect(screen.queryByText("Runs small in chest")).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Shopify product/ }));
    expect(screen.getAllByText(/0 variants/).length).toBeGreaterThan(0);
    expect(screen.getByText("Run product diagnosis").closest("button")).toBeDisabled();
  });

  it("renders the product diagnosis for the selected product", () => {
    const selectedProduct = defaultView.products.find((product) => product.slug === "trail-run-vest");
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={selectedProduct} />);
    expect(screen.getByRole("heading", { name: "Trail Run Vest" })).toBeInTheDocument();
    expect(screen.getAllByText("Zipper failures after first use").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Core Linen Trouser" })).not.toBeInTheDocument();
  });

  it("renders main finding as up to three paragraphs", () => {
    const selectedProduct = {
      ...defaultView.products.find((product) => product.slug === "trail-run-vest"),
      mainFinding: {
        title: "Multiple product signals need review",
        detail: [
          "Reviews point to a durability concern that shoppers keep describing in similar language.",
          "Product content also needs attention because the description does not set clear expectations.",
          "Tags and collection placement should be reviewed so the product story stays consistent.",
          "This fourth paragraph should not render.",
        ].join("\n\n"),
      },
    };
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={selectedProduct} />);
    expect(screen.getByText("Reviews point to a durability concern that shoppers keep describing in similar language.")).toBeInTheDocument();
    expect(screen.getByText("Product content also needs attention because the description does not set clear expectations.")).toBeInTheDocument();
    expect(screen.getByText("Tags and collection placement should be reviewed so the product story stays consistent.")).toBeInTheDocument();
    expect(screen.queryByText("This fourth paragraph should not render.")).not.toBeInTheDocument();
  });

  it("locks recommended actions until a full product diagnosis runs", () => {
    const quickScanProduct = defaultView.products.find((product) => product.slug === "ceramic-pour-over");
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={quickScanProduct} />);
    expect(screen.getByText(/Analyzed May 7, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Run product diagnosis")).toBeInTheDocument();
    const emptyRecommendedActions = screen.getByText("Recommended actions will appear after you run the full product diagnosis for this product.").closest(".ppProductDetailEmpty-recommended");
    expect(emptyRecommendedActions).toBeInTheDocument();
    expect(emptyRecommendedActions?.querySelector("s-icon")?.getAttribute("type")).toBe("wand");
    expect(emptyRecommendedActions?.querySelector("s-icon")?.getAttribute("size")).toBe("large");
    expect(screen.queryByRole("heading", { name: "Add compatibility FAQ" })).not.toBeInTheDocument();
  });

  it("renders analytics overview and chart panels", () => {
    renderWithRouter(<AnalyticsScreen data={defaultView} />);
    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getAllByText("Margin at risk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Margin at risk over time").length).toBeGreaterThan(0);
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
    expect(screen.getByText("Hover a bubble for product details; click it to open the product diagnosis page.")).toBeInTheDocument();
    expect(screen.getByText(/Ranks stored products by operational priority/)).toBeInTheDocument();
    const productBubbleLinks = screen.getAllByRole("link", { name: /open product detail/ });
    expect(productBubbleLinks.length).toBeGreaterThan(0);
    expect(productBubbleLinks[0].getAttribute("href")).toMatch(/^\/app\/products\//);
    fireEvent.mouseEnter(productBubbleLinks[0]);
    expect(screen.getByText(/Click to open product details/)).toBeInTheDocument();
    expect(screen.queryByText("View all insights")).not.toBeInTheDocument();
    expect(screen.getByText("Estimated business impact (next 90 days)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Learn how ProductPulse AI improves these outcomes/ }));
    expect(screen.getByRole("heading", { name: "How ProductPulse calculates business impact" })).toBeInTheDocument();
    expect(screen.getByText("Calculation model")).toBeInTheDocument();
    expect(screen.getByText("Current breakdown")).toBeInTheDocument();
    expect(screen.getByText("Inputs used")).toBeInTheDocument();
    expect(screen.getByText(/designed for prioritization/)).toBeInTheDocument();
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
            analysisLabel: "QuickScan only",
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
            analysisLabel: "QuickScan only",
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
