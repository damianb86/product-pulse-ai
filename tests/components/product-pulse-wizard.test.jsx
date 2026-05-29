import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ProductPulseWizard } from "../../app/components/ProductPulseWizard";

const WIZARD_STORAGE_KEY = "productPulse.onboardingWizard.completed.v1";

afterEach(() => {
  window.localStorage.removeItem(WIZARD_STORAGE_KEY);
});

describe("ProductPulseWizard", () => {
  it("starts on first visit and moves the user to Connect", async () => {
    renderWizard();

    expect(await screen.findByRole("dialog", { name: /welcome to your product signal workspace/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/connect"));
    expect(await screen.findByRole("dialog", { name: "Connect ChatMe Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Upload reviews by CSV" })).toBeInTheDocument();
  });

  it("does not start after completion is stored", () => {
    window.localStorage.setItem(WIZARD_STORAGE_KEY, "true");

    renderWizard();

    expect(screen.queryByRole("dialog", { name: /welcome to your product signal workspace/i })).not.toBeInTheDocument();
  });

  it("keeps the wizard open when a Connect modal opens", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /next/i }));
    await screen.findByRole("dialog", { name: "Connect ChatMe Reviews" });

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));

    expect(await screen.findByRole("heading", { name: "ChatMe Reviews" })).toBeInTheDocument();
    expect(screen.getByText("Add your ChatMe credentials")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Wizard controls" })).toBeInTheDocument();
    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBeNull();
  });

  it("moves through Settings and Products candidates before finishing", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/connect"));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/settings"));
    expect(await screen.findByRole("dialog", { name: "Tune your scan rules" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("wizard-path")).toHaveTextContent("/app/products?tab=candidates"));
    expect(await screen.findByRole("dialog", { name: "Run QuickScan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waiting for candidates" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Run quick scan" }));

    expect(await screen.findByRole("dialog", { name: "Select a candidate and run Deep Scan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Select a candidate and run Deep Scan" })).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(WIZARD_STORAGE_KEY)).toBe("true");
  });
});

function renderWizard(initialEntry = "/app/dashboard") {
  const router = createMemoryRouter([{ path: "*", element: <WizardHarness /> }], {
    initialEntries: [initialEntry],
  });

  return render(<RouterProvider router={router} />);
}

function WizardHarness() {
  const location = useLocation();
  const [openConnectModal, setOpenConnectModal] = useState("");
  const [hasCandidates, setHasCandidates] = useState(false);

  return (
    <>
      <ProductPulseWizard />
      <main>
        <span data-testid="wizard-path">{`${location.pathname}${location.search}`}</span>
        {location.pathname.startsWith("/app/connect") ? (
          <>
            <table>
              <tbody>
                <tr data-pp-connect-source-row="chatmeReviews">
                  <td>ChatMe Reviews</td>
                  <td>
                    <button data-pp-connect-source-action="chatmeReviews" type="button" onClick={() => setOpenConnectModal("chatme")}>
                      Manage
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
            {openConnectModal === "chatme" ? (
              <div className="ppConnectionModalOverlay" role="presentation">
                <section className="ppConnectionModal" role="dialog" aria-modal="true" aria-labelledby="chatme-connect-title">
                  <h2 id="chatme-connect-title">ChatMe Reviews</h2>
                  <button type="button" onClick={() => setOpenConnectModal("")}>Close</button>
                </section>
              </div>
            ) : null}
          </>
        ) : null}
        {location.pathname.startsWith("/app/settings") ? (
          <div>
            <section data-pp-settings-target="risk-thresholds">Product risk thresholds</section>
            <section data-pp-settings-target="momentum-inclusion">Product Momentum inclusion</section>
            <section data-pp-settings-target="evidence-lookback">Evidence lookback</section>
          </div>
        ) : null}
        {location.pathname.startsWith("/app/products") ? (
          <div>
            <button data-pp-products-tab="candidates" type="button">Candidates</button>
            <button data-pp-products-quick-scan type="button" onClick={() => setHasCandidates(true)}>Run quick scan</button>
            {hasCandidates ? (
              <table>
                <tbody>
                  <tr data-pp-products-candidate-row="candidate-1">
                    <td><input data-pp-products-candidate-select="candidate-1" aria-label="Select Candidate Product" type="checkbox" /></td>
                    <td>Candidate Product</td>
                    <td><button data-pp-products-candidate-run-deep-scan="candidate-1" type="button">Analyze Candidate Product</button></td>
                  </tr>
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}
        {!location.pathname.startsWith("/app/connect") && !location.pathname.startsWith("/app/settings") && !location.pathname.startsWith("/app/products") ? <h1>Dashboard</h1> : null}
      </main>
    </>
  );
}
