import type { Widgets } from "@openai/chatkit";
import type { AiPresentationBlock } from "../presentation/blocks";

export function mapAiPresentationBlocksToChatKitWidgets(blocks: AiPresentationBlock[]): Widgets.WidgetRoot[] {
  return blocks.map(mapAiPresentationBlockToChatKitWidget);
}

export function mapAiPresentationBlockToChatKitWidget(block: AiPresentationBlock): Widgets.WidgetRoot {
  switch (block.type) {
    case "product_reference":
      return productReferenceWidget(block);
    case "diagnosis_summary":
      return diagnosisSummaryWidget(block);
    case "evidence_list":
      return evidenceListWidget(block);
    case "metric_table":
      return metricTableWidget(block);
    case "action_proposal":
      return actionProposalWidget(block);
    case "summary":
    default:
      return summaryWidget(block);
  }
}

export function unavailableDataWidget(message: string): Widgets.Card {
  return card([
    title("Data unavailable"),
    text(message),
  ], { status: { text: "Unavailable", icon: "info" } });
}

function summaryWidget(block: Extract<AiPresentationBlock, { type: "summary" }>): Widgets.Card {
  return card([
    ...(block.title ? [title(block.title)] : []),
    text(block.text),
  ]);
}

function productReferenceWidget(block: Extract<AiPresentationBlock, { type: "product_reference" }>): Widgets.Card {
  const productRef = block.productGid || block.handle || block.title;
  return card([
    title(block.title),
    row([
      ...(block.riskLabel ? [badge(block.riskLabel, riskBadgeColor(block.riskLabel))] : []),
      ...(typeof block.riskScore === "number" ? [badge(`Risk ${block.riskScore}`, "secondary")] : []),
    ]),
    ...(block.handle ? [caption(`Handle: ${block.handle}`)] : []),
    row([
      button("View product", "open_product", { productRef, productGid: block.productGid, handle: block.handle }, "external-link"),
      button("View evidence", "open_evidence", { productRef, productGid: block.productGid, handle: block.handle }, "document"),
    ]),
  ], { status: { text: "Product", icon: "profile-card" } });
}

function diagnosisSummaryWidget(block: Extract<AiPresentationBlock, { type: "diagnosis_summary" }>): Widgets.Card {
  const metrics = [
    typeof block.riskScore === "number" ? `Risk ${block.riskScore}` : "",
    typeof block.confidence === "number" ? `Confidence ${block.confidence}` : "",
  ].filter(Boolean);

  return card([
    title(block.title || "Diagnosis summary"),
    ...(metrics.length ? [row(metrics.map((metric) => badge(metric, "secondary")))] : []),
    ...(block.likelyCause ? [text(block.likelyCause)] : []),
    ...(block.issues?.length ? [
      divider(),
      ...block.issues.slice(0, 6).map((issue) => row([icon("dot"), text(issue)])),
    ] : []),
    ...(block.productGid ? [
      row([
        button("Open diagnosis", "open_product", { productRef: block.productGid }, "external-link"),
        button("Evidence", "open_evidence", { productRef: block.productGid }, "document"),
      ]),
    ] : []),
  ], { status: { text: "Diagnosis", icon: "analytics" } });
}

function evidenceListWidget(block: Extract<AiPresentationBlock, { type: "evidence_list" }>): Widgets.ListView {
  return {
    type: "ListView",
    id: block.productGid ? `evidence-${stableId(block.productGid)}` : undefined,
    status: { text: block.title || "Evidence", icon: "document" },
    limit: "auto",
    children: block.items.map((item, index) => ({
      type: "ListViewItem",
      id: `evidence-${index}`,
      gap: 4,
      onClickAction: block.productGid
        ? { type: "open_evidence", payload: { productRef: block.productGid, source: item.source } }
        : undefined,
      children: [
        badge(item.source, "info"),
        text(item.quote),
        ...(item.weight ? [caption(item.weight)] : []),
      ],
    })),
  };
}

function metricTableWidget(block: Extract<AiPresentationBlock, { type: "metric_table" }>): Widgets.Card {
  return card([
    ...(block.title ? [title(block.title)] : []),
    ...block.rows.slice(0, 12).map((metric) => row([
      text(metric.label, { weight: "medium" }),
      text(String(metric.value ?? "Unavailable"), { textAlign: "end" }),
      ...(metric.detail ? [caption(metric.detail)] : []),
    ], { justify: "between", align: "start" })),
  ], { status: { text: "Metrics", icon: "chart" } });
}

function actionProposalWidget(block: Extract<AiPresentationBlock, { type: "action_proposal" }>): Widgets.Card {
  const levelLabel = block.confirmationLevel === "high"
    ? "High confirmation"
    : block.confirmationLevel === "medium"
    ? "Confirmation required"
    : "Confirm action";
  return card([
    title(block.title),
    badge(levelLabel, block.confirmationLevel === "high" ? "danger" : block.confirmationLevel === "medium" ? "warning" : "info"),
    text(block.summary),
    ...(block.targetLabel ? [caption(`Target: ${block.targetLabel}`)] : []),
    ...(block.reason ? [caption(`Reason: ${block.reason}`)] : []),
    ...(block.expectedResult ? [text(block.expectedResult)] : []),
    ...(block.risks.length ? [
      divider(),
      ...block.risks.map((risk) => row([icon("info"), text(risk)])),
    ] : []),
    caption(block.reversible ? "This internal app action can be reversed later." : "This internal app action is not reversible from the assistant."),
    row([
      button("Confirm", "confirm_ai_action", { proposalId: block.proposalId }, "check"),
      button("Cancel", "cancel_ai_action", { proposalId: block.proposalId }, "empty-circle"),
    ]),
  ], {
    status: {
      text: "Action proposal",
      icon: block.confirmationLevel === "high" ? "info" : "check-circle",
    },
  });
}

function card(children: Widgets.WidgetComponent[], options: Partial<Widgets.Card> = {}): Widgets.Card {
  return {
    type: "Card",
    size: "md",
    padding: 12,
    children,
    ...options,
  };
}

function title(value: string): Widgets.Title {
  return { type: "Title", value, size: "md", weight: "semibold" };
}

function caption(value: string): Widgets.Caption {
  return { type: "Caption", value, size: "sm", color: "secondary" };
}

function text(value: string, options: Partial<Widgets.TextComponent> = {}): Widgets.TextComponent {
  return { type: "Text", value, size: "sm", ...options };
}

function badge(label: string, color: NonNullable<Widgets.Badge["color"]> = "secondary"): Widgets.Badge {
  return { type: "Badge", label, color, variant: "soft", size: "sm" };
}

function button(
  label: string,
  actionType: string,
  payload: Record<string, unknown>,
  iconStart: Widgets.WidgetIcon,
): Widgets.Button {
  return {
    type: "Button",
    label,
    iconStart,
    size: "sm",
    variant: "outline",
    onClickAction: { type: actionType, payload },
  };
}

function row(children: Widgets.WidgetComponent[], options: Partial<Widgets.Row> = {}): Widgets.Row {
  return { type: "Row", gap: 6, align: "center", wrap: "wrap", children, ...options };
}

function divider(): Widgets.WidgetComponent {
  return { type: "Divider", spacing: 4 };
}

function icon(name: Widgets.WidgetIcon): Widgets.Icon {
  return { type: "Icon", name, size: "xs" };
}

function riskBadgeColor(label: string): NonNullable<Widgets.Badge["color"]> {
  const normalized = label.toLowerCase();
  if (normalized.includes("high")) return "danger";
  if (normalized.includes("medium")) return "warning";
  if (normalized.includes("low")) return "success";
  return "secondary";
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}
