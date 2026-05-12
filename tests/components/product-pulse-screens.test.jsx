import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
  ConnectSourcesScreen,
  DashboardScreen,
  ProductDiagnosisScreen,
  ProductsScreen,
  SourcesBillingScreen,
} from "../../app/components/ProductPulseScreens";
import { defaultView } from "../fixtures/product-pulse-fixtures";

function renderWithRouter(element) {
  const router = createMemoryRouter([{ path: "/", element }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

describe("ProductPulse screens", () => {
  it("renders dashboard KPIs and start-here product", () => {
    renderWithRouter(<DashboardScreen data={defaultView} />);
    expect(screen.getByText(/ProductPulse AI connects product/)).toBeInTheDocument();
    expect(screen.getAllByText("Core Linen Trouser").length).toBeGreaterThan(0);
    expect(screen.getAllByText("76%").length).toBeGreaterThan(0);
  });

  it("renders source coverage categories", () => {
    renderWithRouter(<ConnectSourcesScreen data={defaultView} />);
    expect(screen.getByText("Shopify returns and return reasons")).toBeInTheDocument();
    expect(screen.getByText("Judge.me reviews")).toBeInTheDocument();
    expect(screen.getByText("Gorgias or Zendesk")).toBeInTheDocument();
  });

  it("renders products table and analysis actions", () => {
    renderWithRouter(<ProductsScreen data={defaultView} filters={{ query: "", risk: "all" }} />);
    const table = screen.getByTestId("products-table");
    expect(within(table).getByText("Trail Run Vest")).toBeInTheDocument();
    expect(within(table).getAllByText("Analyze").length).toBeGreaterThan(0);
  });

  it("renders product diagnosis evidence and draft actions", () => {
    renderWithRouter(<ProductDiagnosisScreen data={defaultView} product={defaultView.startHere} />);
    expect(screen.getByText(/Too tight in waist/)).toBeInTheDocument();
    expect(screen.getByText("Add fit note")).toBeInTheDocument();
    expect(screen.getByText(/Run AI Product Diagnosis/)).toBeInTheDocument();
  });

  it("renders billing credits and source health", () => {
    renderWithRouter(<SourcesBillingScreen data={defaultView} />);
    expect(screen.getByText("Pulse Starter")).toBeInTheDocument();
    expect(screen.getByText("14 credits available")).toBeInTheDocument();
  });
});
