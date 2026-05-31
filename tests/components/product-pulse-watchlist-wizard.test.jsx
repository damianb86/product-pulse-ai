import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, Link, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ProductPulseWatchlistWizard } from "../../app/components/ProductPulseWatchlistWizard";

const WATCHLIST_WIZARD_STORAGE_KEY = "productPulse.watchlistWizard.completed.v1";

afterEach(() => {
  window.localStorage.removeItem(WATCHLIST_WIZARD_STORAGE_KEY);
});

describe("ProductPulseWatchlistWizard", () => {
  it("starts on the first Watchlist visit and guides adding a product", async () => {
    renderWatchlistWizard();

    expect(await screen.findByRole("dialog", { name: "Monitor product changes automatically" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add a watched product" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add watched product" }));

    expect(await screen.findByRole("dialog", { name: "Add watched product" })).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Choose a product to watch" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add to watchlist" }));

    expect(await screen.findByRole("dialog", { name: "Watched products" })).toBeInTheDocument();
    expect(window.localStorage.getItem(WATCHLIST_WIZARD_STORAGE_KEY)).toBeNull();
  });

  it("moves through scan, report, product details, and recent runs", async () => {
    renderWatchlistWizard();

    fireEvent.click(await screen.findByRole("button", { name: "Add watched product" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add to watchlist" }));

    expect(await screen.findByRole("dialog", { name: "Watched products" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("dialog", { name: "Run a Watchlist scan" })).toHaveClass("isTop");
    expect(screen.getByRole("button", { name: "Run scan now first" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Run scan now" }));

    expect(await screen.findByRole("dialog", { name: "Watchlist scan is running" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for a Watchlist report...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish scan" }));

    expect(await screen.findByRole("dialog", { name: "Open the product report" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Watchlist report for GEN Watch Product" })).toHaveClass("ppWizardSpotlightTarget");

    fireEvent.click(screen.getByRole("link", { name: "View Watchlist report for GEN Watch Product" }));

    await waitFor(() => expect(screen.getByTestId("watchlist-path")).toHaveTextContent("/app/watchlist/gen-watch-product"));
    expect(await screen.findByRole("dialog", { name: "Product Watchlist report" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("dialog", { name: "Recent Watchlist runs" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Recent Watchlist runs" })).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(WATCHLIST_WIZARD_STORAGE_KEY)).toBe("true");
  });

  it("does not start after completion is stored", () => {
    window.localStorage.setItem(WATCHLIST_WIZARD_STORAGE_KEY, "true");

    renderWatchlistWizard();

    expect(screen.queryByRole("dialog", { name: "Monitor product changes automatically" })).not.toBeInTheDocument();
  });
});

function renderWatchlistWizard(initialEntry = "/app/watchlist") {
  const router = createMemoryRouter([{ path: "*", element: <WatchlistWizardHarness /> }], {
    initialEntries: [initialEntry],
  });

  return render(<RouterProvider router={router} />);
}

function WatchlistWizardHarness() {
  const location = useLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const [rows, setRows] = useState([]);

  const addProduct = () => {
    setModalOpen(false);
    setRows([buildWatchlistRow(false)]);
    dispatchWatchlistWizardEvent({ type: "product-added" });
  };

  const startScan = () => {
    dispatchWatchlistWizardEvent({ type: "scan-started" });
  };

  const finishScan = () => {
    const readyRow = buildWatchlistRow(true);
    setRows([readyRow]);
    dispatchWatchlistWizardEvent({
      type: "report-ready",
      productTitle: readyRow.title,
      productHref: readyRow.watchlistHref,
    });
  };

  return (
    <>
      <ProductPulseWatchlistWizard />
      <main>
        <span data-testid="watchlist-path">{`${location.pathname}${location.search}`}</span>
        {location.pathname === "/app/watchlist" ? (
          <>
            <header>
              <button
                type="button"
                data-pp-watchlist-add-button="header"
                onClick={() => {
                  setModalOpen(true);
                  dispatchWatchlistWizardEvent({ type: "add-product-modal-opened" });
                }}
              >
                Add watched product
              </button>
            </header>
            <div data-pp-watchlist-table>
              <table>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      data-pp-watchlist-product-row={row.productGid}
                      data-pp-watchlist-ready-row={row.latestChangeReport ? "true" : undefined}
                    >
                      <td>{row.title}</td>
                      <td>
                        <Link
                          to={row.watchlistHref}
                          data-pp-watchlist-view-report={row.latestChangeReport ? "true" : undefined}
                          aria-label={`View Watchlist report for ${row.title}`}
                          onClick={() => dispatchWatchlistWizardEvent({
                            type: "report-opened",
                            productTitle: row.title,
                            href: row.watchlistHref,
                          })}
                        >
                          View report
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section data-pp-watchlist-settings-panel>
              <h2>Watch settings</h2>
              <button type="button" data-pp-watchlist-run-scan onClick={startScan}>
                Run scan now
              </button>
              <button type="button" onClick={finishScan}>
                Finish scan
              </button>
            </section>
            {modalOpen ? (
              <section data-pp-watchlist-add-modal="true" role="dialog" aria-modal="true" aria-labelledby="watchlist-add-title">
                <h2 id="watchlist-add-title">Add watched product</h2>
                <input data-pp-shopify-product-search-input aria-label="Search Shopify products" />
                <button type="button" onClick={addProduct}>Add to watchlist</button>
              </section>
            ) : null}
          </>
        ) : null}
        {location.pathname === "/app/watchlist/gen-watch-product" ? (
          <>
            <section data-pp-watchlist-product-hero aria-label="Watchlist report header">
              <h1>GEN Watch Product</h1>
              <p>Watchlist run · 2 changes tracked</p>
            </section>
            <section data-pp-watchlist-product-insight aria-label="AI Watchlist insight">
              <h2>AI Watchlist insight</h2>
              <p>Two meaningful changes were detected since the previous run.</p>
            </section>
            <section data-pp-watchlist-recent-runs aria-label="Recent Watchlist runs">
              <h2>Recent runs</h2>
              <Link to="/app/watchlist/gen-watch-product?runId=run-1">View Watchlist run May 12</Link>
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}

function buildWatchlistRow(withReport) {
  return {
    id: "watch-1",
    productGid: "gid://shopify/Product/1",
    title: "GEN Watch Product",
    watchlistHref: "/app/watchlist/gen-watch-product",
    latestChangeReport: withReport ? { id: "run-1", status: "changed" } : null,
  };
}

function dispatchWatchlistWizardEvent(detail) {
  window.dispatchEvent(new CustomEvent("productpulse:watchlist-wizard", { detail }));
}
