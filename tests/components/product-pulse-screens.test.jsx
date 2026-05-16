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
    expect(within(table).getByText("No scanned products yet")).toBeInTheDocument();
    expect(within(table).queryByText("Credits")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Run quick scan/ }).length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Find Shopify product" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find Shopify product" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Find Shopify product" }));
    fireEvent.change(screen.getByPlaceholderText("Search by title, handle, product ID or SKU"), { target: { value: "denim" } });

    await waitFor(() => expect(screen.getByText("Vintage Denim Jacket")).toBeInTheDocument());
    await new Promise((resolve) => { window.setTimeout(resolve, 450); });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("renders settings controls for thresholds and queue limits", () => {
    renderWithRouter(<SettingsScreen data={{
      ...defaultView,
      settings: {
        risk: { minimumScore: 50, mediumThreshold: 55, highThreshold: 75 },
        diagnosis: { maxQueuedPerSubmission: 12 },
        analysis: { lookbackDays: 120 },
      },
    }} />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Product risk thresholds")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum QuickScan score")).toHaveValue("50");
    expect(screen.getByLabelText("Medium risk starts at")).toHaveValue("55");
    expect(screen.getByLabelText("High risk starts at")).toHaveValue("75");
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
    expect(screen.getByRole("button", { name: /Run quick scan/ })).toBeInTheDocument();
    expect(screen.getByText("Linen Shirt").closest("a")).toHaveAttribute("href", "/app/products/linen-shirt");
    expect(screen.getByAltText("Linen product")).toHaveAttribute("src", "https://cdn.example.com/linen-shirt.jpg");
    expect(screen.getByText("Diagnosis running")).toBeInTheDocument();
    const analysisButton = screen.getByRole("button", { name: /Fast Analysis completed/ });
    fireEvent.mouseEnter(analysisButton);
    expect(await screen.findByText("Fast Analysis completed")).toBeInTheDocument();
    expect(screen.getByText(/Only the fast Shopify scan has run/)).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnosis running for Linen Shirt")).toBeInTheDocument();
    expect(screen.getByText("Diagnosis running").closest("tr")).toHaveClass("isDiagnosing");
    fireEvent.click(screen.getByRole("button", { name: "Product risk" }));
    expect(screen.getByText("↓")).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.getByText("Strong · 3 sources")).toBeInTheDocument();
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
    expect(screen.queryByRole("menuitem", { name: "Mark for review" })).not.toBeInTheDocument();
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
    expect(screen.getByText("Re-run product diagnosis")).toBeInTheDocument();
    const watchButton = screen.getByRole("button", { name: "Add product to Watchlist" });
    expect(watchButton).toBeInTheDocument();
    fireEvent.click(watchButton);
    expect(screen.getByRole("heading", { name: "Add watched product" })).toBeInTheDocument();
    expect(screen.getByText(/configured automatic cadence/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Explore and review the evidence behind each detected issue.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Returns" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Total returns")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Full Report" })).toHaveAttribute("href", "/app/products/core-linen-trouser/evidence?source=Returns");
    fireEvent.click(screen.getByRole("tab", { name: "Reviews" }));
    expect(screen.getByText("Total reviews")).toBeInTheDocument();
    expect(screen.getByText("Negative reviews")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add fit note" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit suggested text for Add fit note" }));
    fireEvent.change(screen.getAllByLabelText("Description text to apply")[0], { target: { value: "Updated fit guidance for shoppers." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Apply change" })[0]);
    expect(screen.getByRole("heading", { name: "Confirm product description update" })).toBeInTheDocument();
    expect(screen.getAllByText("Updated fit guidance for shoppers.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add fit note" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.getByText(/dismissed for this review session/)).toBeInTheDocument();
    expect(screen.getByText("Completed and dismissed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Add fit note" })).toHaveTextContent("Dismissed");
    expect(screen.queryByRole("heading", { name: "Add fit note" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Add fit note" }));
    expect(screen.getByRole("heading", { name: "Add fit note" })).toBeInTheDocument();
  });

  it("lets product detail remove an already watched product", () => {
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={{ ...defaultView.startHere, isWatched: true }} />);
    const watchButton = screen.getByRole("button", { name: "Remove product from Watchlist" });
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

    fireEvent.click(within(faqDialog).getByRole("button", { name: /Product metafield/ }));
    await waitFor(() => expect(within(faqDialog).getByRole("button", { name: /Product metafield/ })).toHaveClass("isSelected"));
    fireEvent.click(within(faqDialog).getByRole("button", { name: "Apply change" }));
    expect(screen.getByRole("heading", { name: "Confirm FAQ metafield update" })).toBeInTheDocument();
    expect(screen.getAllByText(/productpulse\.faq_items/).length).toBeGreaterThan(0);
  });

  it("minimizes and expands the recommended actions panel", () => {
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />);
    expect(screen.getByRole("button", { name: "Open recommended action Add fit note" })).toBeInTheDocument();
    expect(screen.queryByText(/customers report this trouser runs small/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/customers report this trouser runs small/)).not.toBeInTheDocument();
    expect(screen.getByText("3 actions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("button", { name: "Minimize" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Open recommended action Add fit note" }));
    expect(screen.getAllByText(/customers report this trouser runs small/).length).toBeGreaterThan(0);
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

    fireEvent.click(screen.getByRole("button", { name: "Unignore Fit runs small around waist and inseam" }));
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
    expect(screen.getAllByText("Fear or safety concern").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Scares me more than nothing/).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /Customer language analysis/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Text signals")).toBeInTheDocument();
    expect(screen.getByText("Negative language")).toBeInTheDocument();
    expect(screen.getByText("Dominant emotion")).toBeInTheDocument();
    expect(screen.getAllByText("Fear 2").length).toBeGreaterThan(0);
    expect(screen.getByText("AI emotions")).toBeInTheDocument();
    expect(screen.getByText("Emergent emotion")).toBeInTheDocument();
    expect(screen.getAllByText("Superstitious discomfort 2").length).toBeGreaterThan(0);
    expect(screen.getByText("What ProductPulse checked")).toBeInTheDocument();
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
    expect(screen.getAllByText((_, element) => element?.textContent === "\"Other\" return notes classified as Fit & sizing 2 times").length).toBeGreaterThan(0);
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

  it("renders product diagnosis from snapshot dates and supports issue actions", () => {
    const snapshotProduct = {
      ...defaultView.startHere,
      lastAnalysis: new Date("2026-05-12T12:30:00.000Z"),
      imageUrl: "https://cdn.example.com/product.jpg",
      imageAlt: "Snapshot product",
    };

    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={snapshotProduct} />);
    expect(screen.getByText(/Last analyzed May 12, 2026/)).toBeInTheDocument();
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
    expect(screen.getByText("0 variants")).toBeInTheDocument();
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
    expect(screen.getByText(/QuickScan product signals/)).toBeInTheDocument();
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
