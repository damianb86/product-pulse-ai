import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ProductPulseJobMonitor } from "../../app/components/ProductPulseJobMonitor";

function renderMonitor(initialMonitor) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: <ProductPulseJobMonitor initialMonitor={initialMonitor} developmentMode />,
    },
    {
      path: "/app/job-status",
      loader: () => ({ jobMonitor: initialMonitor }),
    },
  ], { initialEntries: ["/"] });

  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  window.localStorage.clear();
});

describe("ProductPulseJobMonitor", () => {
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
