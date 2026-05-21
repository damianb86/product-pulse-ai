import type { Widgets } from "@openai/chatkit";
import { aiPresentationBlockSchema, type AiPresentationBlock } from "../presentation/blocks";

const MAX_SUMMARY_LENGTH = 520;
const MAX_SNIPPET_LENGTH = 260;
const MAX_DETAIL_LENGTH = 220;
const MAX_LIST_ITEMS = 6;
const MAX_EVIDENCE_ITEMS = 5;
const MAX_METRIC_ROWS = 8;
const MAX_RECOMMENDATION_ITEMS = 10;

export function mapAiPresentationBlocksToChatKitWidgets(blocks: readonly unknown[]): Widgets.WidgetRoot[] {
  return blocks.map(mapAiPresentationBlockToChatKitWidget);
}

export function mapAiPresentationBlockToChatKitWidget(block: unknown): Widgets.WidgetRoot {
  const parsed = aiPresentationBlockSchema.safeParse(block);
  if (!parsed.success) return unsupportedBlockWidget(block);
  return mapValidatedAiPresentationBlock(parsed.data);
}

export function unavailableDataWidget(message: string): Widgets.Card {
  return emptyStateWidget({
    type: "unavailable_state",
    title: "Data unavailable",
    message,
  });
}

function mapValidatedAiPresentationBlock(block: AiPresentationBlock): Widgets.WidgetRoot {
  switch (block.type) {
    case "product_reference":
      return productReferenceWidget(block);
    case "diagnosis_summary":
      return diagnosisSummaryWidget(block);
    case "evidence_list":
      return evidenceListWidget(block);
    case "metric_table":
      return metricTableWidget(block);
    case "entity_list":
      return entityListWidget(block);
    case "recommendation_list":
      return recommendationListWidget(block);
    case "unavailable_state":
      return emptyStateWidget(block);
    case "action_proposal":
      return actionProposalWidget(block);
    case "action_result":
      return actionResultWidget(block);
    case "summary":
    default:
      return summaryWidget(block);
  }
}

function summaryWidget(block: Extract<AiPresentationBlock, { type: "summary" }>): Widgets.Card {
  return card([
    ...(block.title ? [title(block.title, { key: "title" })] : []),
    text(block.text, { key: "body", maxLength: MAX_SUMMARY_LENGTH }),
  ], { status: { text: "Summary", icon: "info" } });
}

function productReferenceWidget(block: Extract<AiPresentationBlock, { type: "product_reference" }>): Widgets.Card {
  const productRef = block.productGid || block.handle || block.title;
  const hasRisk = typeof block.riskScore === "number" || Boolean(block.riskLabel);
  return card([
    title(block.title, { key: "title" }),
    ...(hasRisk ? [riskBadgeRow(block.riskLabel, block.riskScore, "risk")] : [caption("Risk score unavailable", { key: "risk-empty" })]),
    ...(block.handle ? [caption(`Handle: ${block.handle}`, { key: "handle" })] : []),
    actionRow([
      button("View product", "open_product", compactPayload({ productRef, productGid: block.productGid, handle: block.handle }), "external-link"),
      button("View evidence", "open_evidence", compactPayload({ productRef, productGid: block.productGid, handle: block.handle }), "document"),
    ], { key: "actions" }),
  ], { status: { text: "Product", icon: "profile-card" } });
}

function diagnosisSummaryWidget(block: Extract<AiPresentationBlock, { type: "diagnosis_summary" }>): Widgets.Card {
  const hasDiagnosisContent = Boolean(block.likelyCause) || Boolean(block.issues?.length) || typeof block.riskScore === "number" || typeof block.confidence === "number";
  return card([
    title(block.title || "Diagnosis summary", { key: "title" }),
    ...(hasDiagnosisContent ? [diagnosisScoreRow(block)] : [caption("No diagnosis metrics are available yet.", { key: "empty" })]),
    ...(block.likelyCause ? [text(block.likelyCause, { key: "cause", maxLength: MAX_DETAIL_LENGTH })] : []),
    ...(block.issues?.length ? [
      divider("issues-divider"),
      ...block.issues.slice(0, MAX_LIST_ITEMS).map((issue, index) => bulletRow(issue, `issue-${index}`)),
    ] : []),
    ...(block.productGid ? [
      actionRow([
        button("Open diagnosis", "open_product", { productRef: block.productGid }, "external-link"),
        button("Evidence", "open_evidence", { productRef: block.productGid }, "document"),
      ], { key: "actions" }),
    ] : []),
  ], { status: { text: "Diagnosis", icon: "analytics" } });
}

function evidenceListWidget(block: Extract<AiPresentationBlock, { type: "evidence_list" }>): Widgets.WidgetRoot {
  if (!block.items.length) {
    return emptyStateWidget({
      type: "unavailable_state",
      title: block.title || "Evidence",
      message: "No evidence snippets are available for this response.",
      nextStep: block.productGid ? "Open the product evidence view for more source detail." : undefined,
    });
  }

  const visibleItems = block.items.slice(0, MAX_EVIDENCE_ITEMS);
  const children = visibleItems.map((item, index) => ({
    type: "ListViewItem" as const,
    id: `evidence-${index}-${stableId(item.source)}`,
    key: `evidence-${index}`,
    gap: 5,
    onClickAction: block.productGid
      ? { type: "open_evidence", payload: compactPayload({ productRef: block.productGid, source: item.source }) }
      : undefined,
    children: [
      badge(item.source, "info", { key: `source-${index}` }),
      text(item.quote, { key: `quote-${index}`, maxLength: MAX_SNIPPET_LENGTH }),
      ...(item.weight ? [caption(item.weight, { key: `weight-${index}` })] : []),
    ],
  }));

  if (block.items.length > visibleItems.length) {
    children.push({
      type: "ListViewItem" as const,
      id: `evidence-more-${stableId(block.productGid || block.title || "evidence")}`,
      key: "evidence-more",
      gap: 5,
      onClickAction: block.productGid
        ? { type: "show_more_evidence", payload: { productRef: block.productGid } }
        : undefined,
      children: [caption(`Showing ${visibleItems.length} of ${block.items.length} evidence snippets.`, { key: "more" })],
    });
  }

  return {
    type: "ListView",
    id: block.productGid ? `evidence-${stableId(block.productGid)}` : undefined,
    key: "evidence-list",
    status: { text: block.title || "Evidence", icon: "document" },
    limit: "auto",
    children,
  };
}

function metricTableWidget(block: Extract<AiPresentationBlock, { type: "metric_table" }>): Widgets.Card {
  if (!block.rows.length) {
    return emptyStateWidget({
      type: "unavailable_state",
      title: block.title || "Metrics",
      message: "No metrics are available for this response.",
    });
  }

  const visibleRows = block.rows.slice(0, MAX_METRIC_ROWS);
  return card([
    ...(block.title ? [title(block.title, { key: "title" })] : []),
    ...visibleRows.map((metric, index) => metricRow(metric, index)),
    ...(block.rows.length > visibleRows.length ? [caption(`Showing ${visibleRows.length} of ${block.rows.length} metrics.`, { key: "more" })] : []),
  ], { status: { text: "Metrics", icon: "chart" } });
}

function entityListWidget(block: Extract<AiPresentationBlock, { type: "entity_list" }>): Widgets.WidgetRoot {
  if (!block.items.length) {
    return emptyStateWidget({
      type: "unavailable_state",
      title: block.title || "List",
      message: block.emptyMessage || "No items are available for this response.",
    });
  }

  return {
    type: "ListView",
    id: block.title ? `entity-list-${stableId(block.title)}` : undefined,
    key: "entity-list",
    status: { text: block.title || "Items", icon: "search" },
    limit: "auto",
    children: block.items.slice(0, MAX_LIST_ITEMS).map((item, index) => {
      const productRef = item.productGid || item.handle;
      return {
        type: "ListViewItem" as const,
        id: item.id ? stableId(item.id) : `entity-${index}`,
        key: `entity-${index}`,
        gap: 5,
        onClickAction: productRef ? { type: "open_product", payload: compactPayload({ productRef, productGid: item.productGid, handle: item.handle }) } : undefined,
        children: [
          row([
            text(item.title, { key: "title", weight: "medium", maxLength: 140 }),
            ...(item.riskLabel || typeof item.riskScore === "number" ? riskBadges(item.riskLabel, item.riskScore) : []),
            ...(item.status ? [badge(item.status, statusBadgeColor(item.status), { key: "status" })] : []),
          ], { key: "heading", justify: "between", align: "start" }),
          ...(item.subtitle ? [caption(item.subtitle, { key: "subtitle", maxLength: MAX_DETAIL_LENGTH })] : []),
          ...(item.detail ? [text(item.detail, { key: "detail", maxLength: MAX_DETAIL_LENGTH })] : []),
        ],
      };
    }),
  };
}

function recommendationListWidget(block: Extract<AiPresentationBlock, { type: "recommendation_list" }>): Widgets.WidgetRoot {
  if (!block.items.length) {
    return emptyStateWidget({
      type: "unavailable_state",
      title: block.title || "Recommended actions",
      message: block.emptyMessage || "No recommended actions are available for this response.",
    });
  }

  const visibleItems = block.items.slice(0, MAX_RECOMMENDATION_ITEMS);
  return {
    type: "ListView",
    id: block.productGid ? `recommendations-${stableId(block.productGid)}` : undefined,
    key: "recommendation-list",
    status: { text: block.title || "Recommended actions", icon: "lightbulb" },
    limit: "auto",
    children: visibleItems.map((item, index) => {
      const actionPayload = compactPayload({
        productRef: block.productGid,
        productGid: block.productGid,
        recommendationId: item.id,
      });
      return {
        type: "ListViewItem" as const,
        id: `recommendation-${stableId(item.id || `${index}`)}`,
        key: `recommendation-${index}-${stableId(item.id || item.label)}`,
        gap: 6,
        onClickAction: block.productGid
          ? { type: "open_recommendation", payload: actionPayload }
          : undefined,
        children: [
          row([
            text(item.label, { key: "label", weight: "medium", maxLength: 180 }),
            row([
              ...(item.status ? [badge(item.status, statusBadgeColor(item.status), { key: "status" })] : []),
              ...(item.effort ? [badge(`${item.effort} effort`, "secondary", { key: "effort" })] : []),
            ], { key: "badges", gap: 4, wrap: "wrap" }),
          ], { key: "heading", justify: "between", align: "start" }),
          ...(item.issue ? [caption(`Issue: ${item.issue}`, { key: "issue", maxLength: MAX_DETAIL_LENGTH })] : []),
          ...(item.draftPreview ? [text(item.draftPreview, { key: "preview", maxLength: MAX_SNIPPET_LENGTH })] : []),
          ...(block.productGid ? [
            actionRow([
              button("Review action", "open_recommendation", actionPayload, "external-link"),
              button("Open product", "open_product", { productRef: block.productGid }, "profile-card"),
            ], { key: "actions" }),
          ] : []),
        ],
      };
    }),
  };
}

function emptyStateWidget(block: Extract<AiPresentationBlock, { type: "unavailable_state" }>): Widgets.Card {
  return card([
    title(block.title, { key: "title" }),
    text(block.message, { key: "message", maxLength: MAX_SUMMARY_LENGTH }),
    ...(block.reason ? [caption(block.reason, { key: "reason", maxLength: MAX_DETAIL_LENGTH })] : []),
    ...(block.nextStep ? [text(block.nextStep, { key: "next-step", maxLength: MAX_DETAIL_LENGTH })] : []),
  ], { status: { text: "Unavailable", icon: "info" } });
}

function actionProposalWidget(block: Extract<AiPresentationBlock, { type: "action_proposal" }>): Widgets.Card {
  const levelLabel = block.confirmationLevel === "high"
    ? "High confirmation"
    : block.confirmationLevel === "medium"
    ? "Confirmation required"
    : "Confirm action";
  return card([
    title(block.title, { key: "title" }),
    row([
      badge(levelLabel, block.confirmationLevel === "high" ? "danger" : block.confirmationLevel === "medium" ? "warning" : "info", { key: "confirmation" }),
      badge(`${capitalize(block.sideEffectLevel)} side effect`, sideEffectBadgeColor(block.sideEffectLevel), { key: "side-effect" }),
    ], { key: "badges" }),
    text(block.summary, { key: "summary", maxLength: MAX_SUMMARY_LENGTH }),
    ...(block.targetLabel ? [labelValueRow("Target", block.targetLabel, "target")] : []),
    ...(block.reason ? [labelValueRow("Reason", block.reason, "reason")] : []),
    ...(block.expectedResult ? [labelValueRow("Expected result", block.expectedResult, "expected") ] : []),
    ...(block.risks.length ? [
      divider("risks-divider"),
      ...block.risks.slice(0, 4).map((risk, index) => bulletRow(risk, `risk-${index}`, "info")),
    ] : []),
    caption(block.reversible ? "This internal app action can be reversed later." : "This internal app action is not reversible from the assistant.", { key: "reversible" }),
    caption(`Expires: ${block.expiresAt}`, { key: "expires" }),
    actionRow([
      button("Confirm", "confirm_ai_action", { proposalId: block.proposalId }, "check", { style: "primary" }),
      button("Cancel", "cancel_ai_action", { proposalId: block.proposalId }, "empty-circle"),
    ], { key: "actions" }),
  ], {
    status: {
      text: "Action proposal",
      icon: block.confirmationLevel === "high" ? "info" : "check-circle",
    },
  });
}

function actionResultWidget(block: Extract<AiPresentationBlock, { type: "action_result" }>): Widgets.Card {
  return card([
    title(block.title, { key: "title" }),
    row([
      badge(actionResultStatusLabel(block.status), actionResultBadgeColor(block.status), { key: "status" }),
      ...(block.sideEffectLevel ? [badge(`${capitalize(block.sideEffectLevel)} side effect`, sideEffectBadgeColor(block.sideEffectLevel), { key: "side-effect" })] : []),
    ], { key: "badges" }),
    text(block.summary, { key: "summary", maxLength: MAX_SUMMARY_LENGTH }),
    ...(block.targetLabel ? [labelValueRow("Target", block.targetLabel, "target")] : []),
    ...(block.createdJobId ? [caption(`Job: ${block.createdJobId}`, { key: "job", maxLength: 120 })] : []),
    ...(block.affectedEntities.length ? [
      divider("affected-divider"),
      ...block.affectedEntities.slice(0, 4).map((entity, index) => bulletRow(entity.label || entity.id, `affected-${index}`, "check-circle")),
    ] : []),
  ], {
    status: {
      text: block.status === "cancelled" ? "Action cancelled" : block.status === "success" ? "Action completed" : "Action failed",
      icon: block.status === "success" ? "check-circle" : "info",
    },
  });
}

function unsupportedBlockWidget(block: unknown): Widgets.Card {
  const type = block && typeof block === "object" && "type" in block ? String((block as { type?: unknown }).type || "") : "";
  return card([
    title("Unsupported assistant card", { key: "title" }),
    text(type ? `The assistant returned a card type that this version cannot display: ${truncateText(type, 80)}.` : "The assistant returned a card that this version cannot display.", { key: "message" }),
  ], { status: { text: "Unavailable", icon: "info" } });
}

function card(children: Widgets.WidgetComponent[], options: Partial<Widgets.Card> = {}): Widgets.Card {
  return {
    type: "Card",
    size: "full",
    padding: 12,
    children,
    ...options,
  };
}

function title(value: string, options: Partial<Widgets.Title> = {}): Widgets.Title {
  return { type: "Title", value: sanitizeText(value, 180), size: "md", weight: "semibold", ...options };
}

function caption(value: string, options: Partial<Widgets.Caption> & { maxLength?: number } = {}): Widgets.Caption {
  const { maxLength = MAX_DETAIL_LENGTH, ...rest } = options;
  return { type: "Caption", value: sanitizeText(value, maxLength), size: "sm", color: "secondary", ...rest };
}

function text(value: string, options: Partial<Widgets.TextComponent> & { maxLength?: number } = {}): Widgets.TextComponent {
  const { maxLength = MAX_DETAIL_LENGTH, ...rest } = options;
  return { type: "Text", value: sanitizeText(value, maxLength), size: "sm", ...rest };
}

function badge(label: string, color: NonNullable<Widgets.Badge["color"]> = "secondary", options: Partial<Widgets.Badge> = {}): Widgets.Badge {
  return { type: "Badge", label: sanitizeText(label, 56), color, variant: "soft", size: "sm", ...options };
}

function button(
  label: string,
  actionType: string,
  payload: Record<string, unknown>,
  iconStart: Widgets.WidgetIcon,
  options: Partial<Widgets.Button> = {},
): Widgets.Button {
  return {
    type: "Button",
    label: sanitizeText(label, 80),
    iconStart,
    size: "sm",
    variant: "outline",
    onClickAction: { type: actionType, payload: compactPayload(payload) },
    ...options,
  };
}

function row(children: Widgets.WidgetComponent[], options: Partial<Widgets.Row> = {}): Widgets.Row {
  return { type: "Row", gap: 6, align: "center", wrap: "wrap", children, ...options };
}

function actionRow(children: Widgets.WidgetComponent[], options: Partial<Widgets.Row> = {}): Widgets.Row {
  return row(children, { gap: 6, align: "center", wrap: "wrap", ...options });
}

function col(children: Widgets.WidgetComponent[], options: Partial<Widgets.Col> = {}): Widgets.Col {
  return { type: "Col", gap: 4, align: "stretch", children, ...options };
}

function divider(key?: string): Widgets.WidgetComponent {
  return { type: "Divider", spacing: 4, key };
}

function icon(name: Widgets.WidgetIcon, options: Partial<Widgets.Icon> = {}): Widgets.Icon {
  return { type: "Icon", name, size: "xs", ...options };
}

function riskBadgeRow(label?: string | null, score?: number | null, key = "risk-row"): Widgets.Row {
  return row(riskBadges(label, score), { key });
}

function riskBadges(label?: string | null, score?: number | null): Widgets.Badge[] {
  return [
    ...(label ? [badge(label, riskBadgeColor(label), { key: "risk-label" })] : []),
    ...(typeof score === "number" ? [badge(`Risk ${formatNumber(score)}`, riskBadgeColor(label || String(score)), { key: "risk-score" })] : []),
  ];
}

function diagnosisScoreRow(block: Extract<AiPresentationBlock, { type: "diagnosis_summary" }>): Widgets.Row {
  const children = [
    ...riskBadges(null, block.riskScore),
    ...(typeof block.confidence === "number" ? [badge(`Confidence ${formatNumber(block.confidence)}%`, confidenceBadgeColor(block.confidence), { key: "confidence" })] : []),
  ];
  return row(children.length ? children : [caption("Diagnosis score unavailable", { key: "empty" })], { key: "score-row" });
}

function metricRow(metric: Extract<AiPresentationBlock, { type: "metric_table" }>["rows"][number], index: number): Widgets.Row {
  return row([
    col([
      text(metric.label, { key: "label", weight: "medium", maxLength: 96 }),
      ...(metric.detail ? [caption(metric.detail, { key: "detail", maxLength: 160 })] : []),
    ], { key: "label-col", gap: 2, flex: 1 }),
    text(formatMetricValue(metric.value), { key: "value", textAlign: "end", weight: "semibold", maxLength: 80 }),
  ], { key: `metric-${index}`, justify: "between", align: "start" });
}

function labelValueRow(label: string, value: string, key: string): Widgets.Row {
  return row([
    text(label, { key: "label", weight: "medium", maxLength: 80 }),
    text(value, { key: "value", maxLength: MAX_DETAIL_LENGTH }),
  ], { key, align: "start" });
}

function bulletRow(value: string, key: string, iconName: Widgets.WidgetIcon = "dot"): Widgets.Row {
  return row([
    icon(iconName, { key: "icon" }),
    text(value, { key: "text", maxLength: MAX_DETAIL_LENGTH }),
  ], { key, align: "start" });
}

function riskBadgeColor(label: string): NonNullable<Widgets.Badge["color"]> {
  const normalized = label.toLowerCase();
  if (normalized.includes("high") || normalized.includes("critical") || normalized.includes("80") || normalized.includes("90") || normalized.includes("100")) return "danger";
  if (normalized.includes("medium") || normalized.includes("warning") || normalized.includes("50") || normalized.includes("60") || normalized.includes("70")) return "warning";
  if (normalized.includes("low") || normalized.includes("healthy") || normalized.includes("success")) return "success";
  return "secondary";
}

function confidenceBadgeColor(confidence: number): NonNullable<Widgets.Badge["color"]> {
  if (confidence >= 80) return "success";
  if (confidence >= 50) return "warning";
  return "secondary";
}

function statusBadgeColor(status: string): NonNullable<Widgets.Badge["color"]> {
  const normalized = status.toLowerCase();
  if (normalized.includes("high") || normalized.includes("failed") || normalized.includes("error") || normalized.includes("blocked")) return "danger";
  if (normalized.includes("pending") || normalized.includes("medium") || normalized.includes("warning")) return "warning";
  if (normalized.includes("active") || normalized.includes("success") || normalized.includes("complete") || normalized.includes("low")) return "success";
  if (normalized.includes("info") || normalized.includes("review")) return "info";
  return "secondary";
}

function sideEffectBadgeColor(level: "low" | "medium" | "high"): NonNullable<Widgets.Badge["color"]> {
  if (level === "high") return "danger";
  if (level === "medium") return "warning";
  return "info";
}

function actionResultBadgeColor(status: "success" | "error" | "cancelled"): NonNullable<Widgets.Badge["color"]> {
  if (status === "success") return "success";
  if (status === "error") return "danger";
  return "secondary";
}

function actionResultStatusLabel(status: "success" | "error" | "cancelled"): string {
  if (status === "success") return "Completed";
  if (status === "error") return "Failed";
  return "Cancelled";
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function formatMetricValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatNumber(value);
  return value;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function sanitizeText(value: string, maxLength: number): string {
  return truncateText(String(value || "").split("").map((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim(), maxLength);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}
