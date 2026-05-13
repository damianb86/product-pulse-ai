import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
  AnalyticsScreen,
  ConnectScreen,
  DashboardScreen,
  ProductDiagnosisScreen,
  ProductsScreen,
} from "../../app/components/ProductPulseScreens";
import { defaultView } from "../fixtures/product-pulse-fixtures";

function renderWithRouter(element) {
  const router = createMemoryRouter([{ path: "/", element }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

describe("ProductPulse screens", () => {
  it("renders dashboard KPIs and start-here product", () => {
    renderWithRouter(<DashboardScreen data={defaultView} />);
    expect(screen.getByText(/Product quality signals from reviews/)).toBeInTheDocument();
    expect(screen.getByText("Products needing attention")).toBeInTheDocument();
    expect(screen.getAllByText("Linen Shirt").length).toBeGreaterThan(0);
    expect(screen.getByText("$12,450")).toBeInTheDocument();
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

  it("updates connect coverage when a category is ignored", () => {
    renderWithRouter(<ConnectScreen data={defaultView} />);
    expect(screen.getByText("0% effective customer-signal coverage")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Ignore category" })[1]);
    expect(screen.getByText("25% effective customer-signal coverage")).toBeInTheDocument();
  });

  it("connects Judge.me from the connection modal", async () => {
    renderWithRouter(<ConnectScreen data={defaultView} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("heading", { name: "Judge.me Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Judge.me API settings" })).toHaveAttribute("href", "https://judge.me/settings?jump_to=judge.me+api");
    expect(screen.getByRole("link", { name: "Judge.me API documentation" })).toHaveAttribute("href", "https://judge.me/help/en/articles/8409180-judge-me-api");
    fireEvent.change(screen.getByLabelText("Private API token"), { target: { value: "judgeme_private_123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getAllByText("Connected to Judge.me.").length).toBeGreaterThan(0));
    expect(screen.getByText("60% effective customer-signal coverage")).toBeInTheDocument();
  });

  it("renders products table and analysis actions", () => {
    renderWithRouter(<ProductsScreen data={defaultView} filters={{ query: "", risk: "all" }} />);
    const table = screen.getByTestId("products-table");
    expect(within(table).getByText("No scanned products yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Run quick scan/ }).length).toBeGreaterThan(1);
    expect(within(table).queryByRole("link", { name: /Linen Shirt/ })).not.toBeInTheDocument();
  });

  it("shows a scan overlay when a quick scan starts", () => {
    renderWithRouter(<ProductsScreen data={defaultView} filters={{ query: "", risk: "all" }} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Run quick scan/ })[0]);
    expect(screen.getByText("Fast product scan running")).toBeInTheDocument();
    expect(screen.getByText(/backend job will keep running/)).toBeInTheDocument();
    expect(screen.queryByText(/8%/)).not.toBeInTheDocument();
  });

  it("keeps the quick scan action available when product rows exist", () => {
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
    expect(screen.getByRole("link", { name: /Linen Shirt/ })).toHaveAttribute("href", "/app/products/linen-shirt");
    expect(screen.getByAltText("Linen product")).toHaveAttribute("src", "https://cdn.example.com/linen-shirt.jpg");
    expect(screen.getByText("Diagnosis running")).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnosis running for Linen Shirt")).toBeInTheDocument();
    expect(screen.getByText("Diagnosis running").closest("tr")).toHaveClass("isDiagnosing");
    fireEvent.click(screen.getByRole("button", { name: "Risk score" }));
    expect(screen.getByText("↓")).toBeInTheDocument();
    expect(screen.getByText("Return rate contribution.")).toBeInTheDocument();
    expect(screen.getByLabelText("3 sources used for this product")).toBeInTheDocument();
    expect(screen.getByText("Sources used")).toBeInTheDocument();
    expect(screen.getByText("Returns")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("Shopify product metadata.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Linen Shirt" }));
    expect(screen.getByRole("button", { name: "Analyze selected (1)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Linen Shirt" }));
    expect(screen.getByRole("menuitem", { name: /View diagnostics/ })).toHaveAttribute("href", "/app/products/linen-shirt");
    expect(screen.getByRole("menuitem", { name: "Copy handle" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Mark for review" })).not.toBeInTheDocument();
  });

  it("renders product diagnosis evidence and draft actions", () => {
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />);
    expect(screen.getByText(/Sizing & fit expectations are not being met/)).toBeInTheDocument();
    expect(screen.getByText("Too tight in waist")).toBeInTheDocument();
    expect(screen.getAllByText("Add fit note").length).toBeGreaterThan(0);
    expect(screen.getByText("Re-run diagnosis")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Reviews" }));
    expect(screen.getByText("Sizing is smaller than the size chart")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Edit")[0]);
    expect(screen.getByLabelText("Draft")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.getByText(/dismissed for this review session/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Create action draft for Fit runs small around waist and inseam" }));
    expect(screen.getByLabelText("Draft").value).toMatch(/Investigate Fit runs small/);
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
    expect(screen.getByText("0 deterministic recommended actions from current stored signals.")).toBeInTheDocument();
    expect(screen.queryByText(/View all detected issues/)).not.toBeInTheDocument();
    expect(screen.queryByText(/View all actions/)).not.toBeInTheDocument();
    expect(screen.queryByText("Runs small in chest")).not.toBeInTheDocument();
    expect(screen.getByText("0 variants")).toBeInTheDocument();
    expect(screen.getByText("Re-run diagnosis").closest("button")).toBeDisabled();
  });

  it("renders the product diagnosis for the selected product", () => {
    const selectedProduct = defaultView.products.find((product) => product.slug === "trail-run-vest");
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={selectedProduct} />);
    expect(screen.getByRole("heading", { name: "Trail Run Vest" })).toBeInTheDocument();
    expect(screen.getAllByText("Zipper failures after first use").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Core Linen Trouser" })).not.toBeInTheDocument();
  });

  it("renders analytics overview and chart panels", () => {
    renderWithRouter(<AnalyticsScreen data={defaultView} />);
    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getAllByText("Estimated margin at risk").length).toBeGreaterThan(0);
    expect(screen.getByText("Risk signals over time")).toBeInTheDocument();
    expect(screen.getByText("Source contribution")).toBeInTheDocument();
    expect(screen.getByText("Estimated business impact (next 90 days)")).toBeInTheDocument();
  });

});
