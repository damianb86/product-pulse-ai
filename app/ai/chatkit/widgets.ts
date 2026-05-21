import type { Widgets } from "@openai/chatkit";
import { aiPresentationBlockSchema, type AiPresentationBlock } from "../presentation/blocks";

const MAX_SUMMARY_LENGTH = 560;
const MAX_SNIPPET_LENGTH = 260;
const MAX_DETAIL_LENGTH = 220;
const MAX_LIST_ITEMS = 6;
const MAX_EVIDENCE_ITEMS = 5;
const MAX_METRIC_ROWS = 8;
const MAX_RECOMMENDATION_ITEMS = 10;

const COLORS = {
  card: { light: "#ffffff", dark: "#101918" },
  soft: { light: "#f7f8fb", dark: "#172321" },
  panel: { light: "#fbfcff", dark: "#13201f" },
  border: { light: "#dfe5ef", dark: "#273b38" },
  divider: { light: "#e7ebf2", dark: "#243633" },
  text: { light: "#101833", dark: "#f2fbf8" },
  muted: { light: "#66708a", dark: "#9baca7" },
  accent: "#4f32d9",
  accentSoft: { light: "#f1ecff", dark: "#251f46" },
  successSoft: { light: "#ecfdf3", dark: "#123326" },
  dangerSoft: { light: "#fff1f2", dark: "#3a1720" },
  warningSoft: { light: "#fff7ed", dark: "#3a2615" },
};

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
  return productPulseCard([
    row([
      iconTile("sparkle-double", { key: "icon" }),
      col([
        row([
          title(block.title || "AI Summary", { key: "title" }),
          badge("Today", "discovery", { key: "badge" }),
        ], { key: "heading", justify: "between", align: "start", gap: 8 }),
        text(block.text, { key: "body", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text }),
      ], { key: "content", gap: 6, flex: 1 }),
    ], { key: "main", align: "start", gap: 12, wrap: "nowrap" }),
  ], { status: { text: "AI summary", icon: "sparkle-double" } });
}

function productReferenceWidget(block: Extract<AiPresentationBlock, { type: "product_reference" }>): Widgets.Card {
  const productRef = block.productGid || block.handle || "";
  const metrics = normalizeProductMetrics(block);
  return productPulseCard([
    row([
      productImageOrIcon(block, "media"),
      col([
        title(block.title, { key: "title", size: "lg" }),
        ...(block.subtitle ? [caption(block.subtitle, { key: "subtitle", maxLength: 180 })] : []),
        row([
          ...(block.riskLabel || typeof block.riskScore === "number" ? riskBadges(block.riskLabel, block.riskScore) : []),
          ...(block.status ? [badge(block.status, statusBadgeColor(block.status), { key: "status" })] : []),
        ], { key: "badges", gap: 6 }),
      ], { key: "copy", gap: 7, flex: 1 }),
    ], { key: "top", align: "start", gap: 14, wrap: "nowrap" }),
    ...(metrics.length ? [metricGrid(metrics, { key: "metrics" })] : []),
    divider("footer-divider"),
    row([
      col([
        ...(block.handle ? [caption(`Handle: ${block.handle}`, { key: "handle", maxLength: 180 })] : []),
        ...(block.updatedAt ? [caption(`Last updated ${block.updatedAt}`, { key: "updated", maxLength: 120 })] : []),
        ...(!block.handle && !block.updatedAt ? [caption("ProductPulse product reference", { key: "fallback" })] : []),
      ], { key: "meta", gap: 2, flex: 1 }),
      ...(productRef ? [button("View details", "open_product", compactPayload({ productRef, productGid: block.productGid, handle: block.handle }), "chevron-right", {
        key: "view",
        style: "primary",
        color: "primary",
      })] : []),
    ], { key: "footer", justify: "between", align: "center", gap: 12 }),
  ], { status: { text: "Product summary", icon: "profile-card" } });
}

function diagnosisSummaryWidget(block: Extract<AiPresentationBlock, { type: "diagnosis_summary" }>): Widgets.Card {
  const hasDiagnosisContent = Boolean(block.summary || block.likelyCause || block.issues?.length)
    || typeof block.riskScore === "number"
    || typeof block.confidence === "number";
  return productPulseCard([
    row([
      iconTile("analytics", { key: "icon" }),
      col([
        title(block.title || "Diagnosis summary", { key: "title" }),
        row([
          ...riskBadges(null, block.riskScore),
          ...(typeof block.confidence === "number" ? [badge(`Confidence ${formatNumber(block.confidence)}%`, confidenceBadgeColor(block.confidence), { key: "confidence" })] : []),
        ], { key: "badges", gap: 6 }),
      ], { key: "heading", gap: 6, flex: 1 }),
      ...(block.updatedAt ? [caption(block.updatedAt, { key: "updated", maxLength: 80 })] : []),
    ], { key: "top", align: "start", gap: 12, wrap: "nowrap" }),
    ...(hasDiagnosisContent ? [
      sectionBox([
        ...(block.summary ? [text(block.summary, { key: "summary", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text })] : []),
        ...(block.likelyCause ? [labelValueRow("Primary cause", block.likelyCause, "cause")] : []),
      ], { key: "summary-box" }),
      ...(block.issues?.length ? [
        col(block.issues.slice(0, MAX_LIST_ITEMS).map((issue, index) => bulletRow(issue, `issue-${index}`, "check-circle")), {
          key: "issues",
          gap: 5,
        }),
      ] : []),
    ] : [emptyInline("No diagnosis metrics are available yet.", "empty")]),
    ...(block.productGid ? [
      actionFooter([
        button("Open diagnosis", "open_product", { productRef: block.productGid }, "external-link", { key: "open" }),
        button("View evidence", "open_evidence", { productRef: block.productGid }, "document", { key: "evidence" }),
      ], "actions"),
    ] : []),
  ], { status: { text: "Diagnosis", icon: "analytics" } });
}

function evidenceListWidget(block: Extract<AiPresentationBlock, { type: "evidence_list" }>): Widgets.Card {
  if (!block.items.length) {
    return emptyStateWidget({
      type: "unavailable_state",
      title: block.title || "Evidence",
      message: "No evidence snippets are available for this response.",
      nextStep: block.productGid ? "Open the product evidence view for more source detail." : undefined,
    });
  }

  const visibleItems = block.items.slice(0, MAX_EVIDENCE_ITEMS);
  const sourceCount = new Set(block.items.map((item) => item.source)).size;
  return productPulseCard([
    row([
      iconTile("document", { key: "icon" }),
      col([
        title(block.title || "AI Evidence Summary", { key: "title" }),
        caption("Why ProductPulse is confident in this answer", { key: "subtitle" }),
      ], { key: "heading", gap: 3, flex: 1 }),
    ], { key: "top", gap: 12, wrap: "nowrap", align: "start" }),
    metricGrid([
      { label: "Sources", value: sourceCount },
      { label: "Signals", value: block.items.length },
      { label: "Shown", value: visibleItems.length },
    ], { key: "stats" }),
    sectionBox([
      text(block.summary || "These snippets are the strongest bounded evidence available for this answer.", {
        key: "summary",
        maxLength: MAX_SUMMARY_LENGTH,
        color: COLORS.text,
      }),
    ], { key: "summary-box" }),
    col(visibleItems.map((item, index) => evidenceRow(item, index, block.productGid)), { key: "evidence-rows", gap: 6 }),
    actionFooter([
      ...(block.productGid ? [
        button("View all evidence", block.items.length > visibleItems.length ? "show_more_evidence" : "open_evidence", { productRef: block.productGid }, "chevron-right", {
          key: "view-all",
          variant: "ghost",
          color: "primary",
        }),
      ] : []),
    ], "actions"),
  ], { status: { text: "Evidence", icon: "document" } });
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
  return productPulseCard([
    row([
      title(block.title || "Metrics", { key: "title" }),
      badge(`${block.rows.length} rows`, "secondary", { key: "count" }),
    ], { key: "heading", justify: "between", align: "center" }),
    col([
      metricHeaderRow("metric-header"),
      ...visibleRows.map((metric, index) => metricDataRow(metric, index)),
    ], { key: "metric-rows", gap: 0 }),
    ...(block.rows.length > visibleRows.length ? [caption(`Showing ${visibleRows.length} of ${block.rows.length} metrics.`, { key: "more" })] : []),
  ], { status: { text: "Metrics", icon: "chart" } });
}

function entityListWidget(block: Extract<AiPresentationBlock, { type: "entity_list" }>): Widgets.Card {
  if (!block.items.length) {
    return emptyStateWidget({
      type: "unavailable_state",
      title: block.title || "List",
      message: block.emptyMessage || "No items are available for this response.",
    });
  }

  const visibleItems = block.items.slice(0, MAX_LIST_ITEMS);
  return productPulseCard([
    row([
      title(block.title || "Items", { key: "title" }),
      badge(`${block.items.length}`, "secondary", { key: "count" }),
    ], { key: "heading", justify: "between" }),
    col(visibleItems.map((item, index) => entityPanel(item, index)), { key: "items", gap: 8 }),
    ...(block.items.length > visibleItems.length ? [caption(`Showing ${visibleItems.length} of ${block.items.length} items.`, { key: "more" })] : []),
  ], { status: { text: block.title || "Items", icon: "search" } });
}

function recommendationListWidget(block: Extract<AiPresentationBlock, { type: "recommendation_list" }>): Widgets.Card {
  if (!block.items.length) {
    return emptyStateWidget({
      type: "unavailable_state",
      title: block.title || "Recommended actions",
      message: block.emptyMessage || "No recommended actions are available for this response.",
    });
  }

  const visibleItems = block.items.slice(0, MAX_RECOMMENDATION_ITEMS);
  return productPulseCard([
    row([
      title(block.title || "Recommended actions", { key: "title" }),
      badge(`${block.items.length} actions`, "discovery", { key: "count" }),
    ], { key: "heading", justify: "between", align: "center" }),
    col(visibleItems.map((item, index) => recommendationPanel(block, item, index)), { key: "recommendations", gap: 9 }),
    ...(block.items.length > visibleItems.length ? [caption(`Showing ${visibleItems.length} of ${block.items.length} recommendations.`, { key: "more" })] : []),
  ], { status: { text: "Recommended actions", icon: "sparkle-double" } });
}

function emptyStateWidget(block: Extract<AiPresentationBlock, { type: "unavailable_state" }>): Widgets.Card {
  return productPulseCard([
    row([
      iconTile("info", { key: "icon", background: COLORS.soft }),
      col([
        title(block.title, { key: "title" }),
        text(block.message, { key: "message", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text }),
        ...(block.reason ? [caption(block.reason, { key: "reason", maxLength: MAX_DETAIL_LENGTH })] : []),
        ...(block.nextStep ? [text(block.nextStep, { key: "next-step", maxLength: MAX_DETAIL_LENGTH })] : []),
      ], { key: "content", gap: 5, flex: 1 }),
    ], { key: "main", align: "start", gap: 12, wrap: "nowrap" }),
  ], { status: { text: "Unavailable", icon: "info" } });
}

function actionProposalWidget(block: Extract<AiPresentationBlock, { type: "action_proposal" }>): Widgets.Card {
  const levelLabel = block.confirmationLevel === "high"
    ? "High confirmation"
    : block.confirmationLevel === "medium"
      ? "Confirmation required"
      : "Confirm action";
  return productPulseCard([
    row([
      iconTile("sparkle-double", { key: "icon" }),
      col([
        row([
          title(block.title, { key: "title" }),
          badge("Recommended", "success", { key: "recommended" }),
        ], { key: "title-row", justify: "between", align: "start" }),
        row([
          badge(levelLabel, block.confirmationLevel === "high" ? "danger" : block.confirmationLevel === "medium" ? "warning" : "info", { key: "confirmation" }),
          badge(`${capitalize(block.sideEffectLevel)} side effect`, sideEffectBadgeColor(block.sideEffectLevel), { key: "side-effect" }),
        ], { key: "badges", gap: 6 }),
      ], { key: "heading", gap: 7, flex: 1 }),
    ], { key: "top", gap: 12, align: "start", wrap: "nowrap" }),
    sectionBox([
      title("Why this action?", { key: "why-title", size: "sm" }),
      text(block.reason || block.summary, { key: "why-body", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text }),
    ], { key: "why" }),
    sectionBox([
      title("Expected result", { key: "expected-title", size: "sm" }),
      text(block.expectedResult || block.summary, { key: "expected-body", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text }),
      ...(block.targetLabel ? [caption(`Target: ${block.targetLabel}`, { key: "target" })] : []),
    ], { key: "expected" }),
    metricGrid([
      { label: "Side effect", value: capitalize(block.sideEffectLevel), detail: "Internal app only" },
      { label: "Risk", value: capitalize(block.confirmationLevel), detail: block.reversible ? "Reversible" : "Not reversible" },
      { label: "Expires", value: block.expiresAt },
    ], { key: "impact" }),
    ...(block.risks.length ? [col(block.risks.slice(0, 4).map((risk, index) => bulletRow(risk, `risk-${index}`, "info")), { key: "risks", gap: 5 })] : []),
    caption("Only ProductPulse internal data can be changed. Shopify product data is not modified.", { key: "safety" }),
  ], {
    status: {
      text: "Action proposal",
      icon: block.confirmationLevel === "high" ? "info" : "check-circle",
    },
    cancel: {
      label: "Cancel",
      action: { type: "cancel_ai_action", payload: { proposalId: block.proposalId } },
    },
    confirm: {
      label: "Confirm",
      action: { type: "confirm_ai_action", payload: { proposalId: block.proposalId } },
    },
  });
}

function actionResultWidget(block: Extract<AiPresentationBlock, { type: "action_result" }>): Widgets.Card {
  return productPulseCard([
    row([
      iconTile(block.status === "success" ? "check-circle" : "info", {
        key: "icon",
        background: block.status === "success" ? COLORS.successSoft : block.status === "error" ? COLORS.dangerSoft : COLORS.soft,
      }),
      col([
        title(block.title, { key: "title" }),
        row([
          badge(actionResultStatusLabel(block.status), actionResultBadgeColor(block.status), { key: "status" }),
          ...(block.sideEffectLevel ? [badge(`${capitalize(block.sideEffectLevel)} side effect`, sideEffectBadgeColor(block.sideEffectLevel), { key: "side-effect" })] : []),
        ], { key: "badges", gap: 6 }),
      ], { key: "heading", gap: 6, flex: 1 }),
    ], { key: "top", gap: 12, align: "start", wrap: "nowrap" }),
    sectionBox([
      text(block.summary, { key: "summary", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text }),
      ...(block.targetLabel ? [caption(`Target: ${block.targetLabel}`, { key: "target" })] : []),
      ...(block.createdJobId ? [caption(`Job: ${block.createdJobId}`, { key: "job", maxLength: 120 })] : []),
    ], { key: "summary-box" }),
    ...(block.affectedEntities.length ? [
      col(block.affectedEntities.slice(0, 4).map((entity, index) => bulletRow(entity.label || entity.id, `affected-${index}`, "check-circle")), {
        key: "affected",
        gap: 5,
      }),
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
  return productPulseCard([
    title("Unsupported assistant card", { key: "title" }),
    text(type ? `The assistant returned a card type that this version cannot display: ${truncateText(type, 80)}.` : "The assistant returned a card that this version cannot display.", { key: "message" }),
  ], { status: { text: "Unavailable", icon: "info" } });
}

function productPulseCard(children: Widgets.WidgetComponent[], options: Partial<Widgets.Card> = {}): Widgets.Card {
  return {
    type: "Card",
    size: "full",
    padding: { top: 16, right: 16, bottom: 14, left: 16 },
    background: COLORS.card,
    border: { size: 1, color: COLORS.border },
    children,
    ...options,
  };
}

function title(value: string, options: Partial<Widgets.Title> = {}): Widgets.Title {
  return { type: "Title", value: sanitizeText(value, 180), size: "md", weight: "semibold", color: COLORS.text, ...options };
}

function caption(value: string, options: Partial<Widgets.Caption> & { maxLength?: number } = {}): Widgets.Caption {
  const { maxLength = MAX_DETAIL_LENGTH, ...rest } = options;
  return { type: "Caption", value: sanitizeText(value, maxLength), size: "sm", color: COLORS.muted, ...rest };
}

function text(value: string, options: Partial<Widgets.TextComponent> & { maxLength?: number } = {}): Widgets.TextComponent {
  const { maxLength = MAX_DETAIL_LENGTH, ...rest } = options;
  return { type: "Text", value: sanitizeText(value, maxLength), size: "sm", color: COLORS.text, ...rest };
}

function badge(label: string, color: NonNullable<Widgets.Badge["color"]> = "secondary", options: Partial<Widgets.Badge> = {}): Widgets.Badge {
  return { type: "Badge", label: sanitizeText(label, 56), color, variant: "soft", size: "sm", pill: true, ...options };
}

function button(
  label: string,
  actionType: string,
  payload: Record<string, unknown>,
  iconEnd: Widgets.WidgetIcon,
  options: Partial<Widgets.Button> = {},
): Widgets.Button {
  return {
    type: "Button",
    label: sanitizeText(label, 80),
    iconEnd,
    size: "sm",
    variant: "outline",
    onClickAction: { type: actionType, payload: compactPayload(payload) },
    ...options,
  };
}

function row(children: Widgets.WidgetComponent[], options: Partial<Widgets.Row> = {}): Widgets.Row {
  return { type: "Row", gap: 8, align: "center", wrap: "wrap", children, ...options };
}

function col(children: Widgets.WidgetComponent[], options: Partial<Widgets.Col> = {}): Widgets.Col {
  return { type: "Col", gap: 6, align: "stretch", children, ...options };
}

function sectionBox(children: Widgets.WidgetComponent[], options: Partial<Widgets.Col> = {}): Widgets.Col {
  return col(children, {
    padding: 12,
    background: COLORS.panel,
    border: { size: 1, color: COLORS.border },
    radius: "md",
    ...options,
  });
}

function divider(key?: string): Widgets.WidgetComponent {
  return { type: "Divider", spacing: 4, color: COLORS.divider, key };
}

function icon(name: Widgets.WidgetIcon, options: Partial<Widgets.Icon> = {}): Widgets.Icon {
  return { type: "Icon", name, size: "xs", ...options };
}

function iconTile(name: Widgets.WidgetIcon, options: Partial<Widgets.Col> = {}): Widgets.Col {
  return col([
    icon(name, { key: "icon", color: "#ffffff", size: "md" }),
  ], {
    key: "icon-tile",
    width: 42,
    height: 42,
    minWidth: 42,
    align: "center",
    justify: "center",
    radius: "lg",
    background: COLORS.accent,
    padding: 0,
    ...options,
  });
}

function productImageOrIcon(
  block: Extract<AiPresentationBlock, { type: "product_reference" }>,
  key: string,
): Widgets.Image | Widgets.Col {
  const imageUrl = safeImageUrl(block.imageUrl);
  if (!imageUrl) {
    return col([
      icon("profile-card", { key: "icon", color: COLORS.accent, size: "lg" }),
    ], {
      width: 88,
      height: 88,
      minWidth: 88,
      align: "center",
      justify: "center",
      radius: "lg",
      background: COLORS.accentSoft,
      padding: 0,
      key,
    });
  }
  return {
    type: "Image",
    key,
    src: imageUrl,
    alt: sanitizeText(block.imageAlt || block.title, 180),
    width: 88,
    height: 88,
    minWidth: 88,
    radius: "lg",
    fit: "cover",
    frame: false,
  };
}

function metricGrid(
  metrics: Array<{ label: string; value: string | number | boolean | null; detail?: string | null; trend?: string | null }>,
  options: Partial<Widgets.Row> = {},
): Widgets.Row {
  return row(metrics.map((metric, index) => metricTile(metric, index)), {
    gap: 8,
    wrap: "wrap",
    ...options,
  });
}

function metricTile(
  metric: { label: string; value: string | number | boolean | null; detail?: string | null; trend?: string | null },
  index: number,
): Widgets.Col {
  return col([
    caption(metric.label, { key: "label", maxLength: 80 }),
    text(formatMetricValue(metric.value), { key: "value", size: "lg", weight: "bold", maxLength: 80 }),
    ...(metric.trend ? [caption(metric.trend, { key: "trend", maxLength: 80, color: "#0f9f5f" })] : []),
    ...(metric.detail ? [caption(metric.detail, { key: "detail", maxLength: 120 })] : []),
  ], {
    key: `metric-${index}`,
    flex: 1,
    minWidth: 116,
    padding: 10,
    background: COLORS.soft,
    border: { size: 1, color: COLORS.border },
    radius: "md",
    gap: 3,
  });
}

function evidenceRow(
  item: Extract<AiPresentationBlock, { type: "evidence_list" }>["items"][number],
  index: number,
  productGid?: string,
): Widgets.Col {
  return sectionBox([
    row([
      badge(item.source, "info", { key: "source" }),
      ...(item.weight ? [caption(item.weight, { key: "weight", maxLength: 120 })] : []),
    ], { key: "meta", justify: "between", align: "center" }),
    text(item.quote, { key: "quote", maxLength: MAX_SNIPPET_LENGTH, color: COLORS.text }),
    ...(productGid ? [button("Open evidence", "open_evidence", { productRef: productGid, source: item.source }, "chevron-right", {
      key: "open",
      variant: "ghost",
      color: "primary",
    })] : []),
  ], { key: `evidence-${index}-${stableId(item.source)}`, gap: 7 });
}

function entityPanel(
  item: Extract<AiPresentationBlock, { type: "entity_list" }>["items"][number],
  index: number,
): Widgets.Col {
  const productRef = item.productGid || item.handle;
  return sectionBox([
    row([
      col([
        text(item.title, { key: "title", weight: "semibold", maxLength: 160 }),
        ...(item.subtitle ? [caption(item.subtitle, { key: "subtitle", maxLength: 180 })] : []),
      ], { key: "copy", gap: 2, flex: 1 }),
      row([
        ...(item.riskLabel || typeof item.riskScore === "number" ? riskBadges(item.riskLabel, item.riskScore) : []),
        ...(item.status ? [badge(item.status, statusBadgeColor(item.status), { key: "status" })] : []),
      ], { key: "badges", gap: 4 }),
    ], { key: "heading", justify: "between", align: "start" }),
    ...(item.detail ? [text(item.detail, { key: "detail", maxLength: MAX_DETAIL_LENGTH })] : []),
    ...(productRef ? [button("Open product", "open_product", compactPayload({ productRef, productGid: item.productGid, handle: item.handle }), "chevron-right", {
      key: "open",
      variant: "ghost",
      color: "primary",
    })] : []),
  ], { key: `entity-${index}-${stableId(item.id || item.title)}` });
}

function recommendationPanel(
  block: Extract<AiPresentationBlock, { type: "recommendation_list" }>,
  item: Extract<AiPresentationBlock, { type: "recommendation_list" }>["items"][number],
  index: number,
): Widgets.Col {
  const actionPayload = compactPayload({
    productRef: block.productGid,
    productGid: block.productGid,
    recommendationId: item.id,
  });
  const impactMetrics = [
    item.impact ? { label: "Impact", value: item.impact } : null,
    item.risk ? { label: "Risk", value: item.risk } : null,
    item.effort ? { label: "Effort", value: item.effort } : null,
    item.confidence ? { label: "Confidence", value: item.confidence } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return sectionBox([
    row([
      iconTile("sparkle-double", { key: "icon", width: 34, height: 34, minWidth: 34, radius: "md" }),
      col([
        text(item.label, { key: "label", weight: "semibold", maxLength: 180 }),
        row([
          ...(item.status ? [badge(item.status, statusBadgeColor(item.status), { key: "status" })] : []),
          ...(item.issue ? [badge(item.issue, "secondary", { key: "issue" })] : []),
        ], { key: "badges", gap: 5 }),
      ], { key: "copy", gap: 4, flex: 1 }),
    ], { key: "top", gap: 10, align: "start", wrap: "nowrap" }),
    ...(item.draftPreview ? [text(item.draftPreview, { key: "preview", maxLength: MAX_SNIPPET_LENGTH })] : []),
    ...(item.expectedResult ? [caption(item.expectedResult, { key: "expected", maxLength: 180 })] : []),
    ...(impactMetrics.length ? [metricGrid(impactMetrics, { key: "metrics" })] : []),
    ...(block.productGid ? [
      actionFooter([
        button("Review", "open_recommendation", actionPayload, "chevron-right", { key: "review", block: true }),
        button("Open product", "open_product", { productRef: block.productGid }, "external-link", { key: "open", block: true }),
      ], `actions-${index}`),
    ] : []),
  ], { key: `recommendation-${index}-${stableId(item.id || item.label)}`, gap: 8 });
}

function actionFooter(children: Widgets.WidgetComponent[], key: string): Widgets.Row {
  return row(children, { key, gap: 8, align: "center", wrap: "wrap" });
}

function emptyInline(message: string, key: string): Widgets.Col {
  return sectionBox([
    caption(message, { key: "message" }),
  ], { key });
}

function labelValueRow(label: string, value: string, key: string): Widgets.Row {
  return row([
    caption(label, { key: "label", maxLength: 80 }),
    text(value, { key: "value", maxLength: MAX_DETAIL_LENGTH }),
  ], { key, align: "start", wrap: "nowrap" });
}

function bulletRow(value: string, key: string, iconName: Widgets.WidgetIcon = "dot"): Widgets.Row {
  return row([
    icon(iconName, { key: "icon", color: COLORS.accent }),
    text(value, { key: "text", maxLength: MAX_DETAIL_LENGTH }),
  ], { key, align: "start", wrap: "nowrap" });
}

function metricHeaderRow(key: string): Widgets.Row {
  return row([
    caption("Metric", { key: "metric", weight: "semibold", maxLength: 80 }),
    caption("Value", { key: "value", weight: "semibold", textAlign: "end", maxLength: 80 }),
  ], {
    key,
    justify: "between",
    align: "center",
    padding: { top: 6, right: 10, bottom: 6, left: 10 },
    border: { bottom: { size: 1, color: COLORS.divider } },
    background: COLORS.soft,
    radius: "md",
  });
}

function metricDataRow(
  metric: Extract<AiPresentationBlock, { type: "metric_table" }>["rows"][number],
  index: number,
): Widgets.Row {
  return row([
    col([
      text(metric.label, { key: "label", weight: "medium", maxLength: 96 }),
      ...(metric.detail ? [caption(metric.detail, { key: "detail", maxLength: 150 })] : []),
    ], { key: "label-col", gap: 2, flex: 1 }),
    text(formatMetricValue(metric.value), {
      key: "value",
      weight: "semibold",
      textAlign: "end",
      maxLength: 80,
      width: 96,
    }),
  ], {
    key: `metric-${index}`,
    justify: "between",
    align: "start",
    wrap: "nowrap",
    padding: { top: 9, right: 10, bottom: 9, left: 10 },
    border: { bottom: { size: 1, color: COLORS.divider } },
  });
}

function riskBadges(label?: string | null, score?: number | null): Widgets.Badge[] {
  return [
    ...(label ? [badge(label, riskBadgeColor(label), { key: "risk-label" })] : []),
    ...(typeof score === "number" ? [badge(`Risk ${formatNumber(score)}`, riskBadgeColor(label || String(score)), { key: "risk-score" })] : []),
  ];
}

function normalizeProductMetrics(block: Extract<AiPresentationBlock, { type: "product_reference" }>): Array<{
  label: string;
  value: string | number | boolean | null;
  detail?: string | null;
  trend?: string | null;
}> {
  if (block.metrics?.length) return block.metrics;
  return [
    block.price ? { label: "Price", value: block.price } : null,
    block.vendor ? { label: "Vendor", value: block.vendor } : null,
    block.productType ? { label: "Type", value: block.productType } : null,
    typeof block.riskScore === "number" ? { label: "Product Score", value: block.riskScore, detail: block.riskLabel || undefined } : null,
  ].filter(Boolean) as Array<{ label: string; value: string | number | boolean | null; detail?: string | null; trend?: string | null }>;
}

function safeImageUrl(value: unknown): string {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  return url.slice(0, 1000);
}

function riskBadgeColor(label: string): NonNullable<Widgets.Badge["color"]> {
  const normalized = label.toLowerCase();
  if (normalized.includes("high") || normalized.includes("critical") || normalized.includes("80") || normalized.includes("90") || normalized.includes("100")) return "danger";
  if (normalized.includes("medium") || normalized.includes("warning") || normalized.includes("50") || normalized.includes("60") || normalized.includes("70")) return "warning";
  if (normalized.includes("low") || normalized.includes("healthy") || normalized.includes("success") || normalized.includes("good")) return "success";
  return "secondary";
}

function confidenceBadgeColor(confidence: number): NonNullable<Widgets.Badge["color"]> {
  if (confidence >= 80) return "success";
  if (confidence >= 50) return "warning";
  return "secondary";
}

function statusBadgeColor(status: string): NonNullable<Widgets.Badge["color"]> {
  const normalized = status.toLowerCase();
  if (normalized.includes("high") || normalized.includes("failed") || normalized.includes("error") || normalized.includes("blocked") || normalized.includes("open")) return "danger";
  if (normalized.includes("pending") || normalized.includes("medium") || normalized.includes("warning") || normalized.includes("monitor")) return "warning";
  if (normalized.includes("active") || normalized.includes("success") || normalized.includes("complete") || normalized.includes("low") || normalized.includes("healthy")) return "success";
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
