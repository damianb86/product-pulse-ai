import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ProductPulseJobMonitor } from "../../app/components/ProductPulseJobMonitor";

function renderMonitor(initialMonitor, options = {}) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: <ProductPulseJobMonitor initialMonitor={initialMonitor} developmentMode />,
    },
    {
      path: "/app/job-status",
      loader: () => ({ jobMonitor: initialMonitor }),
    },
    {
      path: "/app/product-search",
      loader: ({ request }) => {
        const query = new URL(request.url).searchParams.get("q") || "";
        options.onProductSearch?.(query);
        return {
          status: "success",
          query,
          products: query.toLowerCase().includes("linen")
            ? [
              {
                id: "gid://shopify/Product/1",
                title: "Core Linen Trouser",
                handle: "core-linen-trouser",
                href: "/app/products/core-linen-trouser",
                riskScore: 84,
                primaryIssue: "Fit complaints",
                detail: "ProductPulse Lab / Apparel",
                imageUrl: "https://cdn.example.com/core-linen-trouser.jpg",
                imageAlt: "Core Linen Trouser product photo",
              },
            ]
            : [],
        };
      },
    },
  ], { initialEntries: ["/"] });

  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  window.localStorage.clear();
});

describe("ProductPulseJobMonitor", () => {
  it("keeps a global top bar visible and searches stored products from a dropdown", async () => {
    const productSearchQueries = [];
    renderMonitor(
      { activeJobs: [], recentJobs: [], logs: [] },
      { onProductSearch: (query) => productSearchQueries.push(query) },
    );

    fireEvent.click(screen.getByRole("button", { name: /search products/i }));
    fireEvent.change(screen.getByPlaceholderText("Product title, handle, issue..."), {
      target: { value: "linen" },
    });

    await waitFor(() => {
      expect(screen.getByText("Core Linen Trouser")).toBeVisible();
    });
    expect(screen.getByAltText("Core Linen Trouser product photo")).toHaveAttribute("src", "https://cdn.example.com/core-linen-trouser.jpg");
    expect(screen.getByText((content) => content.includes("/core-linen-trouser") && content.includes("ProductPulse Lab / Apparel"))).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Core Linen Trouser" })).toHaveAttribute("href", "/app/products/core-linen-trouser");

    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(productSearchQueries).toEqual(["linen"]);
  });

  it("shows active and past jobs from the top bar with product navigation", () => {
    const initialMonitor = {
      activeJobs: [
        {
          id: "job-active",
          kind: "product-diagnosis",
          name: "AI Product Diagnosis",
          displayTitle: "Core Linen Trouser",
          displaySubtitle: "Running AI product diagnostics",
          status: "Running",
          progress: 14,
          productHref: "/app/products/core-linen-trouser",
          startedAtIso: new Date(Date.now() - 5000).toISOString(),
          updatedAtIso: new Date().toISOString(),
        },
      ],
      recentJobs: [
        {
          id: "job-active",
          kind: "product-diagnosis",
          name: "AI Product Diagnosis",
          displayTitle: "Core Linen Trouser",
          displaySubtitle: "Running AI product diagnostics",
          status: "Running",
          progress: 14,
          productHref: "/app/products/core-linen-trouser",
          startedAtIso: new Date(Date.now() - 5000).toISOString(),
          updatedAtIso: new Date().toISOString(),
        },
        {
          id: "job-completed",
          kind: "product-diagnosis",
          name: "Completed scan",
          displayTitle: "Trail Run Vest",
          displaySubtitle: "AI product diagnostics completed",
          status: "Completed",
          productHref: "/app/products/trail-run-vest",
          startedAtIso: new Date(Date.now() - 15000).toISOString(),
          updatedAtIso: new Date().toISOString(),
          finishedAtIso: new Date().toISOString(),
        },
      ],
      logs: [],
    };

    renderMonitor(initialMonitor);

    const jobsButton = screen.getByRole("button", { name: /background processes/i });
    expect(jobsButton).toHaveTextContent("1");

    fireEvent.click(jobsButton);

    expect(screen.getByRole("dialog", { name: /background processes/i })).toBeVisible();
    expect(screen.getByText("Current")).toBeVisible();
    expect(screen.getByText("History")).toBeVisible();
    expect(screen.getByText("Core Linen Trouser")).toBeVisible();
    expect(screen.getByText("Trail Run Vest")).toBeVisible();
    expect(screen.getByText(/Started /)).toBeVisible();
    expect(screen.getByText(/Completed /)).toBeVisible();
    expect(screen.getAllByText("1 credit").length).toBeGreaterThan(0);
    expect(document.querySelector(".ppGlobalTopbarJobItem.isCurrent .ppGlobalTopbarJobElapsed")).not.toBeInTheDocument();
    expect(document.querySelector(".ppGlobalTopbarJobItem.isCurrent .ppGlobalTopbarJobMeta")).toHaveTextContent(/1 credit.*s/);
    expect(screen.getByText("View all background processes")).toBeVisible();
    expect(document.querySelector(".ppGlobalTopbarJobProgress")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /open product/i })[0]).toHaveAttribute("href", "/app/products/core-linen-trouser");
  });

  it("shows recent failed jobs as user-visible alerts", () => {
    const initialMonitor = {
      activeJobs: [],
      recentJobs: [
        {
          id: "job-failed",
          name: "Product diagnosis",
          displayTitle: "Linen Shirt",
          status: "Failed",
          source: "AI product diagnostics",
          errorMessage: "Gemini quota exhausted; OpenAI nano fallback returned HTTP 429.",
          startedAtIso: new Date(Date.now() - 20000).toISOString(),
          updatedAtIso: new Date(Date.now() - 1000).toISOString(),
          finishedAtIso: new Date(Date.now() - 1000).toISOString(),
        },
      ],
      logs: [],
    };

    renderMonitor(initialMonitor);

    expect(screen.getByRole("alert")).toHaveTextContent("Linen Shirt finished with an error");
    expect(screen.getByText("The background job could not be completed. Please try again later.")).toBeVisible();
    expect(screen.getByText("Gemini quota exhausted; OpenAI nano fallback returned HTTP 429.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss failed job message" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("always starts minimized in development mode and filters logs by recent job", () => {
    window.localStorage.setItem("productPulseDevJobsMinimized", "false");
    const initialMonitor = {
      activeJobs: [
        {
          id: "job-active",
          name: "QuickScan",
          status: "Running",
          source: "Reading Shopify catalog",
          startedAtIso: new Date(Date.now() - 5000).toISOString(),
          updatedAtIso: new Date().toISOString(),
        },
      ],
      recentJobs: [
        {
          id: "job-active",
          name: "QuickScan",
          status: "Running",
          source: "Reading Shopify catalog",
          startedAtIso: new Date(Date.now() - 5000).toISOString(),
          updatedAtIso: new Date().toISOString(),
        },
        {
          id: "job-completed",
          name: "Completed scan",
          status: "Completed",
          source: "QuickScan completed",
          startedAtIso: new Date(Date.now() - 15000).toISOString(),
          updatedAtIso: new Date().toISOString(),
          finishedAtIso: new Date().toISOString(),
        },
      ],
      logs: [
        {
          id: "log-active",
          jobId: "job-active",
          level: "info",
          event: "quick_scan.started",
          message: "Active scan started.",
          createdAtIso: new Date().toISOString(),
        },
        {
          id: "log-completed",
          jobId: "job-completed",
          level: "info",
          event: "quick_scan.completed",
          message: "Completed scan finished.",
          createdAtIso: new Date().toISOString(),
        },
      ],
    };

    renderMonitor(initialMonitor);

    expect(screen.getByRole("button", { name: /open development job monitor/i })).toBeVisible();
    expect(screen.queryByRole("complementary", { name: /development job monitor/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open development job monitor/i }));
    expect(screen.getByRole("complementary", { name: /development job monitor/i })).toBeVisible();
    expect(screen.getByText("Active scan started.")).toBeVisible();
    expect(screen.getByText("Completed scan finished.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /completed scan/i }));
    const logsPanel = screen.getByText("Logs: Completed scan").closest("section");

    expect(within(logsPanel).getByText("Completed scan finished.")).toBeVisible();
    expect(within(logsPanel).queryByText("Active scan started.")).not.toBeInTheDocument();
  });
});
