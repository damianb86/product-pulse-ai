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
