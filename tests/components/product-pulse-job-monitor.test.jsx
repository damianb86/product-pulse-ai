import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductPulseJobMonitor } from "../../app/components/ProductPulseJobMonitor";

function renderMonitor(initialMonitor, options = {}) {
  const getMonitor = typeof initialMonitor === "function" ? initialMonitor : () => initialMonitor;
  const monitorElement = <ProductPulseJobMonitor initialMonitor={getMonitor()} developmentMode shop={options.shop} />;
  const router = createMemoryRouter([
    {
      path: "/",
      element: monitorElement,
    },
    {
      path: "/app/dashboard",
      element: monitorElement,
    },
    {
      path: "/apps/product-pulse-ia/app/dashboard",
      element: monitorElement,
    },
    {
      path: "/app/job-status",
      loader: ({ request }) => {
        options.onJobStatus?.(new URL(request.url));
        return { jobMonitor: getMonitor() };
      },
      action: async ({ request }) => {
        const formData = await request.formData();
        const jobId = String(formData.get("jobId") || "");
        options.onCancelJob?.(jobId);
        if (typeof options.cancelActionResponse === "function") return options.cancelActionResponse(jobId);
        return { status: "success", message: "Background job cancelled." };
      },
    },
    {
      path: "/apps/product-pulse-ia/app/job-status",
      loader: ({ request }) => {
        options.onJobStatus?.(new URL(request.url));
        return { jobMonitor: getMonitor() };
      },
      action: async ({ request }) => {
        const formData = await request.formData();
        const jobId = String(formData.get("jobId") || "");
        options.onCancelJob?.(jobId);
        if (typeof options.cancelActionResponse === "function") return options.cancelActionResponse(jobId);
        return { status: "success", message: "Background job cancelled." };
      },
    },
    {
      path: "/app/credits-summary",
      loader: ({ request }) => {
        options.onCreditSummary?.(new URL(request.url));
        if (options.creditSummaryResponse) return options.creditSummaryResponse;
        const monitor = getMonitor() || {};
        return {
          pointSummary: monitor.pointSummary || null,
          pointBalance: monitor.pointBalance || monitor.pointSummary?.balance || null,
        };
      },
    },
    {
      path: "/apps/product-pulse-ia/app/credits-summary",
      loader: ({ request }) => {
        options.onCreditSummary?.(new URL(request.url));
        if (options.creditSummaryResponse) return options.creditSummaryResponse;
        const monitor = getMonitor() || {};
        return {
          pointSummary: monitor.pointSummary || null,
          pointBalance: monitor.pointBalance || monitor.pointSummary?.balance || null,
        };
      },
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
    {
      path: "/apps/product-pulse-ia/app/product-search",
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
  ], { initialEntries: options.initialEntries || ["/"] });

  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("ProductPulseJobMonitor", () => {
  it("opens the background processes popover when the wizard requests it", async () => {
    renderMonitor({ activeJobs: [], recentJobs: [], logs: [] });

    act(() => {
      window.dispatchEvent(new CustomEvent("productpulse:wizard-open-background-processes"));
    });

    expect(await screen.findByRole("dialog", { name: /background processes/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /background processes/i })).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("[data-pp-background-process-popover]")).toBeInTheDocument();
  });

  it("forces one immediate job-status request when the background processes popover opens after a recent refresh", async () => {
    const jobStatusRequests = [];
    const runningJob = {
      id: "job-recent-refresh",
      kind: "product-diagnosis",
      name: "Product Diagnosis",
      displayTitle: "Core Linen Trouser",
      displaySubtitle: "Running Product Diagnosis",
      status: "Running",
      productHref: "/app/products/core-linen-trouser",
      startedAtIso: new Date(Date.now() - 5000).toISOString(),
      updatedAtIso: new Date().toISOString(),
    };
    let monitorReadCount = 0;
    const getMonitor = () => {
      monitorReadCount += 1;
      if (monitorReadCount === 1) return { activeJobs: [], recentJobs: [], logs: [] };
      return { activeJobs: [runningJob], recentJobs: [runningJob], logs: [] };
    };

    renderMonitor(getMonitor, { onJobStatus: (url) => jobStatusRequests.push(url) });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /background processes, 1 active/i })).toBeVisible();
    });
    expect(jobStatusRequests).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /background processes, 1 active/i }));

    await waitFor(() => expect(jobStatusRequests).toHaveLength(2));
    expect(jobStatusRequests[1].searchParams.get("scope")).toBe("popover");

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(jobStatusRequests).toHaveLength(2);
  });

  it("loads credit summary with Shopify embedded params instead of dropping shop context", async () => {
    const creditSummaryRequests = [];

    renderMonitor(
      {
        activeJobs: [],
        recentJobs: [],
        logs: [],
        pointBalance: { available: 95, label: "95.0" },
      },
      {
        initialEntries: ["/apps/product-pulse-ia/app/dashboard?host=encoded-host&embedded=1&locale=en"],
        shop: "demo-shop.myshopify.com",
        onCreditSummary: (url) => creditSummaryRequests.push(url),
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "95 Credits available" }));

    await waitFor(() => expect(creditSummaryRequests).toHaveLength(1));
    expect(creditSummaryRequests[0].pathname).toBe("/apps/product-pulse-ia/app/credits-summary");
    expect(creditSummaryRequests[0].searchParams.get("shop")).toBe("demo-shop.myshopify.com");
    expect(creditSummaryRequests[0].searchParams.get("host")).toBe("encoded-host");
    expect(creditSummaryRequests[0].searchParams.get("embedded")).toBe("1");
    expect(creditSummaryRequests[0].searchParams.get("locale")).toBe("en");
  });

  it("keeps a global top bar visible and searches stored products from a dropdown", async () => {
    const productSearchQueries = [];
    renderMonitor(
      {
        activeJobs: [],
        recentJobs: [],
        logs: [],
        pointBalance: { available: 95, label: "95.0" },
        pointSummary: {
          balance: { available: 95, label: "95.0" },
          plan: {
            name: "Free plan",
            renewalLabel: "Does not renew",
            allowance: 100,
            allowanceLabel: "100",
          },
          usage: {
            used: 5,
            total: 100,
            usedLabel: "5",
            totalLabel: "100",
            percent: 5,
            percentLabel: "5% used",
            progressPercent: 5,
          },
          activity: [
            {
              id: "deep-diagnosis-1",
              icon: "wand",
              title: "Product Diagnosis",
              detail: "GEN Aura Ceramic Dinner Set",
              amount: -1,
              amountLabel: "-1 credit",
              timeLabel: "2m ago",
            },
            {
              id: "quick-scan-1",
              icon: "search",
              title: "Catalog Scan",
              detail: "60-day scan window",
              amount: -1,
              amountLabel: "-1 credit",
              timeLabel: "28m ago",
            },
            {
              id: "initial-balance",
              icon: "product",
              title: "Free plan credits",
              detail: "Initial balance",
              amount: 100,
              amountLabel: "+100 credits",
              timeLabel: "1h ago",
            },
          ],
        },
      },
      { onProductSearch: (query) => productSearchQueries.push(query) },
    );

    const creditsButton = screen.getByRole("button", { name: "95 Credits available" });
    expect(creditsButton).toBeVisible();

    fireEvent.click(creditsButton);
    const creditsDialog = screen.getByRole("dialog", { name: "Credit details" });
    expect(within(creditsDialog).getByText("Total remaining")).toBeVisible();
    expect(within(creditsDialog).getByText("95")).toBeVisible();
    expect(within(creditsDialog).getByText("Credits")).toBeVisible();
    expect(within(creditsDialog).getByText("Current plan")).toBeVisible();
    expect(within(creditsDialog).getByText("Free plan")).toBeVisible();
    expect(within(creditsDialog).getByText("Does not renew")).toBeVisible();
    expect(within(creditsDialog).getByText("Usage this period")).toBeVisible();
    expect(creditsDialog).toHaveTextContent("5 / 100 credits used");
    expect(within(creditsDialog).getByText("5% used")).toBeVisible();
    expect(within(creditsDialog).getByText("Recent credit activity")).toBeVisible();
    expect(within(creditsDialog).getByText("Product Diagnosis")).toBeVisible();
    expect(within(creditsDialog).getByText("GEN Aura Ceramic Dinner Set")).toBeVisible();
    expect(within(creditsDialog).getAllByText("-1 credit")).toHaveLength(2);
    expect(within(creditsDialog).getByText("2m ago")).toBeVisible();
    expect(within(creditsDialog).getByText("Catalog Scan")).toBeVisible();
    expect(within(creditsDialog).getByText("60-day scan window")).toBeVisible();
    expect(within(creditsDialog).getByText("28m ago")).toBeVisible();
    expect(within(creditsDialog).getByText("Free plan credits")).toBeVisible();
    expect(within(creditsDialog).getByText("Initial balance")).toBeVisible();
    expect(within(creditsDialog).getByText("+100 credits")).toBeVisible();
    expect(within(creditsDialog).getByText("1h ago")).toBeVisible();
    expect(within(creditsDialog).getByRole("link", { name: "Review credits" })).toHaveAttribute("href", "/app/plans-and-credits");
    expect(within(creditsDialog).queryByRole("link", { name: /View credits/ })).not.toBeInTheDocument();

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

  it("keeps the credits dropdown open when activity fails but a balance is available", async () => {
    renderMonitor(
      {
        activeJobs: [],
        recentJobs: [],
        logs: [],
        pointBalance: { available: 12.4, label: "12.4" },
      },
      {
        onCreditSummary: () => {},
        creditSummaryResponse: {
          status: "error",
          message: "Credit activity could not be loaded.",
          pointSummary: null,
          pointBalance: { available: 12.4, label: "12.4" },
        },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "12 Credits available" }));

    const creditsDialog = screen.getByRole("dialog", { name: "Credit details" });
    expect(within(creditsDialog).getByText("12")).toBeVisible();
    await waitFor(() => {
      expect(within(creditsDialog).getByText("Credit activity could not be loaded.")).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "12 Credits available" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows active and past jobs from the top bar with product navigation", () => {
    const initialMonitor = {
      activeJobs: [
        {
          id: "job-active",
          kind: "product-diagnosis",
          name: "Product Diagnosis",
          displayTitle: "Core Linen Trouser",
          displaySubtitle: "Running Product Diagnosis",
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
          name: "Product Diagnosis",
          displayTitle: "Core Linen Trouser",
          displaySubtitle: "Running Product Diagnosis",
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
          displaySubtitle: "Product Diagnosis completed",
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
    expect(screen.getByRole("link", { name: /View all background processes/i })).toHaveAttribute("href", "/app/background-processes");
    expect(document.querySelector(".ppGlobalTopbarJobProgress")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /open product/i })[0]).toHaveAttribute("href", "/app/products/core-linen-trouser");
  });

  it("confirms before cancelling an active job from the top bar popover", async () => {
    const cancelledJobs = [];
    const jobStatusRequests = [];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const runningJob = {
      id: "job-running-cancel",
      kind: "product-diagnosis",
      name: "Running scan",
      displayTitle: "Core Linen Trouser",
      status: "Running",
      productHref: "/app/products/core-linen-trouser",
      startedAtIso: new Date(Date.now() - 5000).toISOString(),
      updatedAtIso: new Date().toISOString(),
    };
    const cancelledJob = {
      ...runningJob,
      status: "Failed",
      errorMessage: "Canceled from Background processes.",
      finishedAtIso: new Date().toISOString(),
    };
    let monitor = {
      activeJobs: [runningJob],
      recentJobs: [],
      logs: [],
    };

    renderMonitor(
      () => monitor,
      {
        onCancelJob: (jobId) => cancelledJobs.push(jobId),
        onJobStatus: (url) => jobStatusRequests.push(url),
        cancelActionResponse: (jobId) => ({
          status: "success",
          message: "Background job cancelled.",
          job: {
            ...cancelledJob,
            id: jobId,
          },
        }),
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /background processes/i }));
    await waitFor(() => expect(jobStatusRequests).toHaveLength(1));
    jobStatusRequests.length = 0;
    monitor = {
      activeJobs: [],
      recentJobs: [cancelledJob],
      logs: [],
    };
    fireEvent.click(screen.getByRole("button", { name: "Cancel Core Linen Trouser" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Cancel Core Linen Trouser?"));
    await waitFor(() => expect(cancelledJobs).toEqual(["job-running-cancel"]));
    await waitFor(() => expect(jobStatusRequests).toHaveLength(1));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(jobStatusRequests).toHaveLength(1);
    expect(screen.getByRole("button", { name: /background processes/i })).not.toHaveTextContent("1");
  });

  it("caps History at six jobs without capping Current", () => {
    const activeJobs = Array.from({ length: 12 }, (_, index) => ({
      id: `active-${index + 1}`,
      kind: "product-diagnosis",
      name: "Queued diagnosis",
      displayTitle: `Active Process ${index + 1}`,
      displaySubtitle: "Product Diagnosis queued",
      status: "Queued",
      productHref: `/app/products/active-process-${index + 1}`,
      startedAtIso: new Date(Date.now() - (index + 2) * 1000).toISOString(),
      updatedAtIso: new Date(Date.now() - (index + 1) * 1000).toISOString(),
    }));
    const recentJobs = Array.from({ length: 25 }, (_, index) => ({
      id: `job-${index + 1}`,
      kind: "product-diagnosis",
      name: "Completed scan",
      displayTitle: `Background Process ${index + 1}`,
      displaySubtitle: "Product Diagnosis completed",
      status: "Completed",
      productHref: `/app/products/background-process-${index + 1}`,
      startedAtIso: new Date(Date.now() - (index + 2) * 1000).toISOString(),
      updatedAtIso: new Date(Date.now() - (index + 1) * 1000).toISOString(),
      finishedAtIso: new Date(Date.now() - (index + 1) * 1000).toISOString(),
    }));

    renderMonitor({ activeJobs, recentJobs, logs: [] });

    fireEvent.click(screen.getByRole("button", { name: /background processes/i }));

    expect(screen.getByText("Active Process 12")).toBeVisible();
    expect(document.querySelectorAll(".ppGlobalTopbarJobSection.isCurrent .ppGlobalTopbarJobItem")).toHaveLength(12);
    expect(screen.getByText("Background Process 6")).toBeVisible();
    expect(screen.queryByText("Background Process 7")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".ppGlobalTopbarJobSection.isHistory .ppGlobalTopbarJobItem")).toHaveLength(6);
  });

  it("does not replay already failed jobs as user-visible alerts on page load", () => {
    const initialMonitor = {
      activeJobs: [],
      recentJobs: [
        {
          id: "job-failed",
          name: "Product diagnosis",
          displayTitle: "Linen Shirt",
          status: "Failed",
          source: "Product Diagnosis",
          errorMessage: "Gemini quota exhausted; OpenAI nano fallback returned HTTP 429.",
          startedAtIso: new Date(Date.now() - 20000).toISOString(),
          updatedAtIso: new Date(Date.now() - 1000).toISOString(),
          finishedAtIso: new Date(Date.now() - 1000).toISOString(),
        },
      ],
      logs: [],
    };

    renderMonitor(initialMonitor);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the Product Diagnosis completion toast after a running diagnosis finishes", async () => {
    const wizardEvents = [];
    const handleWizardEvent = (event) => wizardEvents.push(event.detail);
    window.addEventListener("productpulse:wizard", handleWizardEvent);
    const runningJob = {
      id: "job-finished-toast",
      kind: "product-diagnosis",
      name: "Product Diagnosis",
      displayTitle: "GEN QuietDesk Mini Fan",
      status: "Running",
      productHref: "/app/products/gen-quietdesk-mini-fan",
      productImageUrl: "https://cdn.example.com/gen-quietdesk-mini-fan.jpg",
      productImageAlt: "GEN QuietDesk Mini Fan product photo",
      startedAtIso: new Date(Date.now() - 5000).toISOString(),
      updatedAtIso: new Date().toISOString(),
    };
    let monitor = {
      activeJobs: [runningJob],
      recentJobs: [runningJob],
      logs: [],
    };

    try {
      renderMonitor(() => monitor);
      expect(screen.queryByText("Product Diagnosis finished")).not.toBeInTheDocument();

      monitor = {
        activeJobs: [],
        recentJobs: [
          {
            ...runningJob,
            status: "Completed",
            finishedAtIso: new Date().toISOString(),
          },
        ],
        logs: [],
      };

      await act(async () => {
        window.dispatchEvent(new CustomEvent("productpulse:jobs-queued", { detail: { job: runningJob } }));
      });

      const notice = await screen.findByRole("status");
      expect(notice).toHaveTextContent("Product Diagnosis finished");
      expect(notice).toHaveTextContent("GEN QuietDesk Mini Fan is ready to review.");
      expect(notice).toHaveAttribute("data-pp-job-completion-notice", "product-diagnosis");
      expect(screen.getByAltText("GEN QuietDesk Mini Fan product photo")).toHaveAttribute("src", "https://cdn.example.com/gen-quietdesk-mini-fan.jpg");
      expect(screen.getByRole("link", { name: /Open product/ })).toHaveAttribute("href", "/app/products/gen-quietdesk-mini-fan");
      await waitFor(() => expect(wizardEvents.some((event) => event?.type === "deep-scan-completed")).toBe(true));
    } finally {
      window.removeEventListener("productpulse:wizard", handleWizardEvent);
    }
  });

  it("always starts minimized in development mode and filters logs by recent job", () => {
    window.localStorage.setItem("productPulseDevJobsMinimized", "false");
    const initialMonitor = {
      activeJobs: [
        {
          id: "job-active",
          name: "Catalog Scan",
          status: "Running",
          source: "Reading Shopify catalog",
          startedAtIso: new Date(Date.now() - 5000).toISOString(),
          updatedAtIso: new Date().toISOString(),
        },
      ],
      recentJobs: [
        {
          id: "job-active",
          name: "Catalog Scan",
          status: "Running",
          source: "Reading Shopify catalog",
          startedAtIso: new Date(Date.now() - 5000).toISOString(),
          updatedAtIso: new Date().toISOString(),
        },
        {
          id: "job-completed",
          name: "Completed scan",
          status: "Completed",
          source: "Catalog Scan completed",
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
