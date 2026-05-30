import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BetaFeedbackPanelControls,
  BetaFeedbackPanelFrame,
  BetaFeedbackProvider,
} from "../../app/components/beta-feedback/BetaFeedbackLayer";

const betaConfig = {
  enabled: true,
  shop: "shop-a.myshopify.com",
  user: {
    id: "42",
    email: "ada@example.com",
    name: "Ada Lovelace",
  },
  environment: "test",
  appVersion: "test-build",
};

const riskPanel = {
  id: "product.riskHistory",
  label: "Risk panel",
  context: {
    product: { title: "Wool hat", handle: "wool-hat" },
    metric: { name: "Risk score", value: 82 },
  },
  relatedEntity: {
    type: "product",
    id: "gid://shopify/Product/1",
  },
};

describe("BetaFeedbackProvider", () => {
  let requests;

  beforeEach(() => {
    requests = [];
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      if (!options.method) {
        return jsonResponse({ status: "success", enabled: true, preferences: [] });
      }

      const body = JSON.parse(options.body || "{}");
      requests.push({ url: String(url), body });

      if (body.intent === "hide-panel") {
        return jsonResponse({
          status: "success",
          preference: {
            id: "pref-1",
            pageKey: body.pageKey,
            panelId: body.panelId,
            panelLabel: body.panelLabel,
            hidden: true,
            hasHideReason: true,
          },
        });
      }

      if (body.intent === "set-panel-visibility") {
        return jsonResponse({
          status: "success",
          preference: {
            id: "pref-1",
            pageKey: body.pageKey,
            panelId: body.panelId,
            panelLabel: body.panelLabel,
            hidden: Boolean(body.hidden),
            hasHideReason: true,
          },
        });
      }

      return jsonResponse({
        status: "success",
        report: { id: "feedback-1" },
      });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves no launcher or panel controls when disabled", () => {
    renderLayer({ config: { enabled: false } });

    expect(screen.queryByRole("button", { name: "Open beta feedback" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Beta feedback for Risk panel" })).not.toBeInTheDocument();
  });

  it("submits contextual feedback with safe page and panel context", async () => {
    renderLayer();

    fireEvent.click(screen.getByRole("button", { name: "Beta feedback for Risk panel" }));
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "wrong_value" } });
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "The risk score does not match the chart." } });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => {
      expect(requests.some((request) => request.body.intent === "submit-feedback")).toBe(true);
    });

    const request = requests.find((item) => item.body.intent === "submit-feedback");
    expect(request.body).toMatchObject({
      category: "wrong_value",
      message: "The risk score does not match the chart.",
      panelId: "product.riskHistory",
      panelLabel: "Risk panel",
      relatedEntity: {
        type: "product",
        id: "gid://shopify/Product/1",
      },
      context: {
        product: { title: "Wool hat", handle: "wool-hat" },
        metric: { name: "Risk score", value: 82 },
        route: {
          pathname: "/app/products/wool-hat",
          pageKey: "/app/products/wool-hat",
        },
      },
    });
  });

  it("asks for a first hide reason, minimizes the panel, and restores it", async () => {
    renderLayer();

    fireEvent.click(screen.getByRole("button", { name: "Hide Risk panel" }));
    expect(await screen.findByRole("dialog", { name: "Hide Risk panel?" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByLabelText("Tell us why"), { target: { value: "Risk score is duplicated elsewhere." } });
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));

    const restoreButton = await screen.findByRole("button", { name: "Restore Risk panel" });
    expect(requests.find((item) => item.body.intent === "hide-panel")?.body).toMatchObject({
      panelId: "product.riskHistory",
      reason: "other",
      reasonMessage: "Risk score is duplicated elsewhere.",
    });

    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(requests.some((item) => item.body.intent === "set-panel-visibility" && item.body.hidden === false)).toBe(true);
    });
    expect(screen.getByText("Risk panel content")).toBeInTheDocument();
  });
});

function renderLayer({ config = betaConfig } = {}) {
  return render(
    <MemoryRouter initialEntries={["/app/products/wool-hat?risk=high"]}>
      <BetaFeedbackProvider config={config}>
        <BetaFeedbackPanelFrame panel={riskPanel}>
          <section>
            <h1>Risk panel content</h1>
            <BetaFeedbackPanelControls panel={riskPanel} />
          </section>
        </BetaFeedbackPanelFrame>
      </BetaFeedbackProvider>
    </MemoryRouter>,
  );
}

function jsonResponse(body, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}
