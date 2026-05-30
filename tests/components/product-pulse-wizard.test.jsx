import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { createMemoryRouter, Link, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ProductPulseWizard } from "../../app/components/ProductPulseWizard";

const WIZARD_STORAGE_KEY = "productPulse.onboardingWizard.completed.v1";

afterEach(() => {
  window.localStorage.removeItem(WIZARD_STORAGE_KEY);
  delete window.__PP_WIZARD_TEST_HAS_CANDIDATES__;
});

describe("ProductPulseWizard", () => {
  it("starts on first visit and moves the user to Connect", async () => {
    renderWizard();

    expect(await screen.findByRole("dialog", { name: /welcome to your product signal workspace/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/connect"));
    expect(await screen.findByRole("dialog", { name: "Connect Judge.me Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Upload reviews by CSV" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Connect ChatMe Reviews" })).not.toBeInTheDocument();
  });

  it("does not start after completion is stored", () => {
    window.localStorage.setItem(WIZARD_STORAGE_KEY, "true");

    renderWizard();

    expect(screen.queryByRole("dialog", { name: /welcome to your product signal workspace/i })).not.toBeInTheDocument();
  });

  it("restarts from the dashboard when the development start event is fired", async () => {
    window.localStorage.setItem(WIZARD_STORAGE_KEY, "true");
    renderWizard("/app/settings");

    expect(screen.queryByRole("dialog", { name: /welcome to your product signal workspace/i })).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent("productpulse:wizard-start"));
    });

    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/dashboard"));
    expect(await screen.findByRole("dialog", { name: /welcome to your product signal workspace/i })).toBeInTheDocument();
    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBeNull();
  });

  it("keeps the wizard open when a Connect modal opens", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /next/i }));
    await screen.findByRole("dialog", { name: "Connect Judge.me Reviews" });

    fireEvent.click(screen.getByRole("button", { name: "Manage Judge.me" }));

    expect(await screen.findByRole("heading", { name: "Judge.me Reviews" })).toBeInTheDocument();
    expect(screen.getByText("Connect Judge.me reviews")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Wizard controls" })).toBeInTheDocument();
    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBeNull();
  });

  it("asks Settings to handle unsaved changes before moving to Products", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/connect"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/settings"));

    act(() => {
      window.dispatchEvent(new CustomEvent("productpulse:settings-dirty-state", { detail: { dirty: true } }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByTestId("settings-leave-requests")).toHaveTextContent("1");
    expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/settings");

    act(() => {
      window.dispatchEvent(new CustomEvent("productpulse:wizard-settings-leave-allowed"));
    });

    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/products?tab=candidates"));
  });

  it("shows the QuickScan step even when candidate rows already exist", async () => {
    window.__PP_WIZARD_TEST_HAS_CANDIDATES__ = true;
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/connect"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/settings"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/products?tab=candidates"));
    expect(await screen.findByRole("dialog", { name: "Run QuickScan" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Select a candidate and run Deep Scan" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run QuickScan first" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Run quick scan" }));

    expect(await screen.findByRole("dialog", { name: "QuickScan is running" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Select a candidate and run Deep Scan" })).not.toBeInTheDocument();

    finishQuickScan();

    expect(await screen.findByRole("dialog", { name: "Select a candidate and run Deep Scan" })).toBeInTheDocument();
  });

  it("skips only the current step without completing the tour", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: "Skip step" }));

    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/connect"));
    expect(await screen.findByRole("dialog", { name: "Connect Judge.me Reviews" })).toBeInTheDocument();
    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBeNull();
  });

  it("can skip the QuickScan and candidate steps independently", async () => {
    window.__PP_WIZARD_TEST_HAS_CANDIDATES__ = true;
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/connect"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/settings"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/products?tab=candidates"));
    expect(await screen.findByRole("dialog", { name: "Run QuickScan" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));

    expect(await screen.findByRole("dialog", { name: "Select a candidate and run Deep Scan" })).toBeInTheDocument();
    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));

    expect(await screen.findByRole("dialog", { name: "Background processes" })).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Track the Deep Scan" })).toHaveClass("isLeft");
    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBeNull();
  });

  it("moves through Settings, Products, and Background processes before finishing", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/connect"));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/settings"));
    expect(await screen.findByRole("dialog", { name: "Tune your scan rules" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/products?tab=candidates"));
    expect(await screen.findByRole("dialog", { name: "Run QuickScan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run QuickScan first" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Run quick scan" }));

    expect(await screen.findByRole("dialog", { name: "QuickScan is running" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Select a candidate and run Deep Scan" })).not.toBeInTheDocument();

    finishQuickScan();

    expect(await screen.findByRole("dialog", { name: "Select a candidate and run Deep Scan" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Analyze selected (1)" })).toHaveClass("ppWizardSpotlightTarget");
      expect(screen.getByTestId("candidate-toolbar")).toHaveClass("ppWizardSpotlightAncestor");
    });
    expect(screen.getByRole("button", { name: "Analyze Candidate Product" })).not.toHaveClass("ppWizardSpotlightTarget");
    expect(screen.getByRole("button", { name: "Waiting for Deep Scan" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Analyze selected (1)" }));

    expect(await screen.findByRole("dialog", { name: "Background processes" })).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Track the Deep Scan" })).toHaveClass("isLeft");
    expect(screen.getByText(/AI-assisted reasoning and product-signal scoring/i)).toBeInTheDocument();
    expect(screen.getByText("Deep Scan is still running...")).toBeInTheDocument();

    completeDeepScan();

    expect(await screen.findByRole("dialog", { name: "Deep Scan complete" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Deep analysis finished");

    fireEvent.click(screen.getByRole("link", { name: "Open product" }));

    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/products/gen-quietdesk-mini-fan"));
    expect(await screen.findByRole("dialog", { name: "Deep product analysis" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Product actions" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("product-detail-hero")).toHaveClass("ppWizardSpotlightTarget");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("dialog", { name: "AI Interpretation" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Recommended Actions" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("ai-interpretation-panel")).toHaveClass("ppWizardSpotlightTarget");
      expect(screen.getByTestId("recommended-actions-panel")).toHaveClass("ppWizardSpotlightTarget");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("dialog", { name: "Meet Pulse Guide" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Wizard controls" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Pulse Guide" })).toHaveClass("ppWizardSpotlightTarget");
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Meet Pulse Guide" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Pulse Guide" })).toBeInTheDocument();
    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBe("true");
  });
});

function finishQuickScan() {
  act(() => {
    window.dispatchEvent(new CustomEvent("productpulse:test-finish-quick-scan"));
  });
}

function completeDeepScan() {
  act(() => {
    window.dispatchEvent(new CustomEvent("productpulse:test-complete-deep-scan"));
  });
}

function renderWizard(initialEntry = "/app/dashboard") {
  const router = createMemoryRouter([{ path: "*", element: <WizardHarness /> }], {
    initialEntries: [initialEntry],
  });

  return render(<RouterProvider router={router} />);
}

function WizardHarness() {
  const location = useLocation();
  const [openConnectModal, setOpenConnectModal] = useState("");
  const [hasCandidates, setHasCandidates] = useState(() => Boolean(window.__PP_WIZARD_TEST_HAS_CANDIDATES__));
  const [quickScanRunning, setQuickScanRunning] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [settingsLeaveRequests, setSettingsLeaveRequests] = useState(0);
  const [deepScanNotice, setDeepScanNotice] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const handleOpenBackgroundProcesses = () => setJobsOpen(true);
    window.addEventListener("productpulse:wizard-open-background-processes", handleOpenBackgroundProcesses);
    return () => window.removeEventListener("productpulse:wizard-open-background-processes", handleOpenBackgroundProcesses);
  }, []);

  useEffect(() => {
    const handleSettingsLeaveRequest = () => setSettingsLeaveRequests((current) => current + 1);
    window.addEventListener("productpulse:wizard-request-settings-leave", handleSettingsLeaveRequest);
    return () => window.removeEventListener("productpulse:wizard-request-settings-leave", handleSettingsLeaveRequest);
  }, []);

  useEffect(() => {
    const handleFinishQuickScan = () => {
      setQuickScanRunning(false);
      setHasCandidates(true);
      window.dispatchEvent(new CustomEvent("productpulse:wizard", { detail: { type: "quick-scan-job-finished" } }));
    };
    window.addEventListener("productpulse:test-finish-quick-scan", handleFinishQuickScan);
    return () => window.removeEventListener("productpulse:test-finish-quick-scan", handleFinishQuickScan);
  }, []);

  useEffect(() => {
    const handleCompleteDeepScan = () => {
      const job = {
        kind: "product-diagnosis",
        productTitle: "GEN QuietDesk Mini Fan",
        productHref: "/app/products/gen-quietdesk-mini-fan",
      };
      setDeepScanNotice(job);
      window.dispatchEvent(new CustomEvent("productpulse:wizard", { detail: { type: "deep-scan-completed", job } }));
    };
    window.addEventListener("productpulse:test-complete-deep-scan", handleCompleteDeepScan);
    return () => window.removeEventListener("productpulse:test-complete-deep-scan", handleCompleteDeepScan);
  }, []);

  const startDeepScan = () => {
    window.dispatchEvent(new CustomEvent("productpulse:wizard", { detail: { type: "deep-scan-started" } }));
  };

  const startQuickScan = () => {
    setQuickScanRunning(true);
    window.dispatchEvent(new CustomEvent("productpulse:wizard", { detail: { type: "quick-scan-started" } }));
    window.dispatchEvent(new CustomEvent("productpulse:wizard", { detail: { type: "quick-scan-job-started" } }));
  };

  return (
    <>
      <ProductPulseWizard />
      <aside className="ppChatKitAssistant" aria-label="Pulse Guide assistant" data-pp-chat-assistant={chatOpen ? "open" : "closed"}>
        {chatOpen ? (
          <section className="ppChatKitPanel" role="dialog" aria-label="Pulse Guide" data-pp-chat-panel>
            Pulse Guide is open
          </section>
        ) : (
          <button
            className="ppChatKitLauncher"
            type="button"
            aria-label="Open Pulse Guide"
            data-pp-chat-launcher
            onClick={() => {
              setChatOpen(true);
              window.dispatchEvent(new CustomEvent("productpulse:wizard", { detail: { type: "chat-opened" } }));
            }}
          />
        )}
      </aside>
      {deepScanNotice ? (
        <aside data-pp-job-completion-notice="product-diagnosis" role="status">
          <strong>Deep analysis finished</strong>
          <p>{deepScanNotice.productTitle} is ready to review.</p>
          <Link
            data-pp-job-completion-open-product="true"
            to={deepScanNotice.productHref}
            onClick={() => {
              window.dispatchEvent(new CustomEvent("productpulse:wizard", {
                detail: {
                  type: "deep-scan-product-opened",
                  job: deepScanNotice,
                  href: deepScanNotice.productHref,
                },
              }));
              setDeepScanNotice(null);
            }}
          >
            Open product
          </Link>
        </aside>
      ) : null}
      <div className="ppGlobalTopbar">
        <button
          data-pp-background-process-button
          type="button"
          aria-label="Background processes"
          onClick={() => setJobsOpen((current) => !current)}
        >
          Background processes
        </button>
        {jobsOpen ? (
          <section data-pp-background-process-popover role="dialog" aria-label="Background processes">
            <h2>Background processes</h2>
            <p>Deep Scan is queued.</p>
          </section>
        ) : null}
      </div>
      <main>
        <span data-testid="wizard-path">{`${location.pathname}${location.search}`}</span>
        {location.pathname.startsWith("/app/connect") ? (
          <>
            <table>
              <tbody>
                <tr data-pp-connect-source-row="judgemeReviews">
                  <td>Judge.me Reviews</td>
                  <td>
                    <button data-pp-connect-source-action="judgemeReviews" type="button" onClick={() => setOpenConnectModal("judgeme")}>
                      Manage Judge.me
                    </button>
                  </td>
                </tr>
                <tr data-pp-connect-source-row="csvReviews">
                  <td>CSV Upload</td>
                  <td>
                    <button data-pp-connect-source-action="csvReviews" type="button" onClick={() => setOpenConnectModal("csv")}>
                      Upload CSV
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            {openConnectModal === "judgeme" ? (
              <div className="ppConnectionModalOverlay" role="presentation">
                <section className="ppConnectionModal" role="dialog" aria-modal="true" aria-labelledby="judgeme-connect-title">
                  <h2 id="judgeme-connect-title">Judge.me Reviews</h2>
                  <button type="button" onClick={() => setOpenConnectModal("")}>Close</button>
                </section>
              </div>
            ) : null}
          </>
        ) : null}
        {location.pathname.startsWith("/app/settings") ? (
          <div>
            <span data-testid="settings-leave-requests">{settingsLeaveRequests}</span>
            <section data-pp-settings-target="risk-thresholds">Product risk thresholds</section>
            <section data-pp-settings-target="momentum-inclusion">Product Momentum inclusion</section>
            <section data-pp-settings-target="evidence-lookback">Evidence lookback</section>
          </div>
        ) : null}
        {location.pathname === "/app/products/gen-quietdesk-mini-fan" ? (
          <>
            <section data-testid="product-detail-hero" data-pp-product-detail-overview="hero" aria-label="Product overview">
              <span data-pp-product-detail-overview="image">Product image</span>
              <div data-pp-product-detail-overview="summary">
                <h1>GEN QuietDesk Mini Fan</h1>
                <div data-pp-product-detail-overview="status">High risk · Analyzed just now</div>
                <dl data-pp-product-detail-overview="meta">
                  <div>
                    <dt>Vendor:</dt>
                    <dd>GEN</dd>
                  </div>
                </dl>
              </div>
              <div data-pp-product-detail-overview="actions">
                <button type="button">Re-analyze</button>
                <button type="button">Metric timelines</button>
              </div>
            </section>
            <section
              className="ppMainFindingCard ppProductDetailOverviewFinding"
              data-testid="ai-interpretation-panel"
              data-pp-product-detail-analysis-panel="ai-interpretation"
            >
              AI interpretation
            </section>
            <section
              className="ppProductPanel ppRecommendedActionsPanel"
              data-testid="recommended-actions-panel"
              data-pp-product-detail-analysis-panel="recommended-actions"
            >
              Recommended actions
            </section>
          </>
        ) : location.pathname.startsWith("/app/products") ? (
          <div>
            <button data-pp-products-tab="candidates" type="button">Candidates</button>
            <button data-pp-products-quick-scan type="button" onClick={startQuickScan}>Run quick scan</button>
            {quickScanRunning ? (
              <section role="status" aria-label="QuickScan running">
                <h2>Fast product scan running</h2>
              </section>
            ) : null}
            {hasCandidates ? (
              <>
                <div className="ppProductsToolbar ppProductsCandidatesToolbar" data-testid="candidate-toolbar">
                  <button
                    className="ppAnalyzeLinkButton ppAnalyzeLinkButton-primary ppProductsToolbarIconButton ppProductsAnalyzeSelectedButton"
                    data-pp-products-run-deep-scan-selected="true"
                    type="button"
                    aria-label="Analyze selected (1)"
                    onClick={startDeepScan}
                  >
                    Analyze selected
                  </button>
                </div>
                <table>
                  <tbody>
                    <tr data-pp-products-candidate-row="candidate-1">
                      <td><input data-pp-products-candidate-select="candidate-1" aria-label="Select Candidate Product" type="checkbox" defaultChecked /></td>
                      <td>Candidate Product</td>
                      <td><button data-pp-products-candidate-run-deep-scan="candidate-1" type="button" onClick={startDeepScan}>Analyze Candidate Product</button></td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        ) : null}
        {!location.pathname.startsWith("/app/connect") && !location.pathname.startsWith("/app/settings") && !location.pathname.startsWith("/app/products") ? <h1>Dashboard</h1> : null}
      </main>
    </>
  );
}
