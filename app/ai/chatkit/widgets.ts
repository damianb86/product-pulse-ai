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
  card: "#FFFFFF",
  soft: "#F8FAFC",
  panel: "#F5F0FF",
  border: "#E2E8F0",
  divider: "#E5E7EB",
  text: "#0F172A",
  muted: "#64748B",
  accent: "#5B2FE8",
  accentStrong: "#4C1D95",
  accentSoft: "#EDE9FE",
  diagnosisBorder: "#DDD6FE",
  successSoft: "#BBF7D0",
  successText: "#15803D",
  dangerSoft: "#FECACA",
  dangerText: "#DC2626",
  infoSoft: "#DBEAFE",
  infoText: "#1D4ED8",
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
    case "app_draft_proposal":
      return appDraftProposalWidget(block);
    case "app_draft_result":
      return appDraftResultWidget(block);
    case "score_explanation":
      return scoreExplanationWidget(block);
    case "process_guide":
      return processGuideWidget(block);
    case "screen_guide":
      return screenGuideWidget(block);
    case "setting_explanation":
      return settingExplanationWidget(block);
    case "interaction_guidance":
      return interactionGuidanceWidget(block);
    case "summary":
    default:
      return summaryWidget(block);
  }
}

function summaryWidget(block: Extract<AiPresentationBlock, { type: "summary" }>): Widgets.Card {
  return productPulseCard([
    row([
      box([
        icon("sparkle", { key: "icon", size: "lg", color: COLORS.accentStrong }),
      ], {
        key: "icon",
        size: 34,
        minWidth: 34,
        radius: "lg",
        background: COLORS.accentSoft,
        align: "center",
        justify: "center",
      }),
      col([
        row([
          title(block.title || "AI Summary", { key: "title" }),
          badge("Today", "discovery", { key: "badge" }),
        ], { key: "heading", justify: "between", align: "start", gap: 8 }),
        text(block.text, { key: "body", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text }),
      ], { key: "content", gap: 4, flex: 1 }),
    ], { key: "main", align: "start", gap: 8, wrap: "nowrap" }),
  ], { status: { text: "AI summary", icon: "sparkle-double" } });
}

function productReferenceWidget(block: Extract<AiPresentationBlock, { type: "product_reference" }>): Widgets.Card {
  const productRef = block.productGid || block.handle || "";
  const metrics = normalizeProductMetrics(block);
  return productPulseCard([
    row([
      productImageOrIcon(block, "media"),
      col([
        title(block.title, { key: "title", size: "md", weight: "bold", maxLines: 2 }),
        ...(block.subtitle ? [caption(block.subtitle, { key: "subtitle", maxLength: 180 })] : []),
        row([
          ...(block.riskLabel || typeof block.riskScore === "number" ? riskBadges(block.riskLabel, block.riskScore) : []),
          ...(block.status ? [badge(block.status, statusBadgeColor(block.status), { key: "status" })] : []),
        ], { key: "badges", gap: 6 }),
        caption(buildProductSummaryCaption(block), { key: "caption", color: COLORS.muted }),
      ], { key: "copy", gap: 2, flex: 1 }),
    ], { key: "top", align: "start", gap: 6, wrap: "nowrap" }),
    divider("metrics-divider", 1),
    ...(metrics.length ? [metricGrid(metrics.slice(0, 4), { key: "metrics" })] : []),
    ...(productRef ? [button("Open product", "open_product", compactPayload({ productRef, productGid: block.productGid, handle: block.handle }), "chevron-right", {
      key: "view",
      style: "primary",
      variant: "solid",
      color: "primary",
      block: true,
    })] : []),
  ], { size: "md", status: { text: "Product summary", icon: "profile-card" } });
}

function diagnosisSummaryWidget(block: Extract<AiPresentationBlock, { type: "diagnosis_summary" }>): Widgets.Card {
  const hasDiagnosisContent = Boolean(block.summary || block.likelyCause || block.issues?.length)
    || typeof block.riskScore === "number"
    || typeof block.confidence === "number";
  return productPulseCard([
    row([
      col([
        title("Product diagnosis", { key: "title", size: "md", weight: "bold" }),
        caption([block.title, block.updatedAt].filter(Boolean).join(" · ") || "ProductPulse analysis", { key: "subtitle", color: COLORS.muted }),
      ], { key: "heading", gap: 1, flex: 1 }),
      badge(diagnosisAttentionLabel(block), diagnosisBadgeColor(block), { key: "attention" }),
    ], { key: "top", justify: "between", align: "start", gap: 4 }),
    ...(hasDiagnosisContent ? [
      box([
        caption("AI summary", { key: "label", color: COLORS.accent, weight: "bold" }),
        text(block.summary || block.likelyCause || "ProductPulse has a stored diagnosis for this product.", {
          key: "summary",
          size: "sm",
          maxLines: 4,
          maxLength: MAX_SUMMARY_LENGTH,
        }),
      ], {
        key: "summary-box",
        padding: 4,
        radius: "lg",
        background: COLORS.panel,
        border: { size: 1, color: COLORS.diagnosisBorder },
      }),
      metricGrid([
        { label: "Risk", value: riskMetricValue(block), detail: null, tone: "danger" },
        { label: "Confidence", value: typeof block.confidence === "number" ? `${formatNumber(block.confidence)}%` : "Unavailable", detail: null, tone: "success" },
        { label: "Evidence", value: `${block.issues?.length || 0} signals`, detail: null, tone: "info" },
      ], { key: "diagnosis-metrics" }),
      ...(block.issues?.length ? [
        col(block.issues.slice(0, MAX_LIST_ITEMS).map((issue, index) => bulletRow(issue, `issue-${index}`, "check-circle")), {
          key: "issues",
          gap: 1,
        }),
      ] : []),
    ] : [emptyInline("No diagnosis metrics are available yet.", "empty")]),
    ...(block.productGid ? [
      actionFooter([
        button("View evidence", "open_evidence", { productRef: block.productGid }, "document", {
          key: "evidence",
          style: "secondary",
          variant: "outline",
          block: true,
        }),
      ], "actions"),
    ] : []),
  ], { size: "lg", status: { text: "Diagnosis", icon: "analytics" } });
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
  return {
    type: "ListView",
    key: "evidence-list",
    limit: "auto",
    status: { text: block.title || "Evidence summary", icon: "document" },
    children: visibleItems.map((item, index) => ({
      type: "ListViewItem",
      key: `evidence-${index}-${stableId(item.source)}`,
      id: `evidence-${index}-${stableId(item.source)}`,
      gap: 1,
      onClickAction: block.productGid
        ? { type: "open_evidence_source", payload: { productRef: block.productGid, source: item.source } }
        : undefined,
      children: [
        row([
          col([
            text(item.source, { key: "source", weight: "bold", maxLength: 120 }),
            caption(item.weight || item.quote, { key: "caption", color: COLORS.muted, maxLength: 180 }),
          ], { key: "copy", gap: 0, flex: 1 }),
          badge(String(index + 1), evidenceBadgeColor(index), { key: "badge" }),
        ], { key: "row", justify: "between", align: "center", wrap: "nowrap" }),
      ],
    })),
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
  return productPulseCard([
    row([
      title(block.title || "Metrics", { key: "title" }),
      badge(`${block.rows.length} rows`, "secondary", { key: "count" }),
    ], { key: "heading", justify: "between", align: "center" }),
    divider("table-divider", 0),
    col(visibleRows.map((metric, index) => compactIssueRow(metric, index)), { key: "metric-rows", gap: 0 }),
    ...(block.rows.length > visibleRows.length ? [caption(`Showing ${visibleRows.length} of ${block.rows.length} metrics.`, { key: "more" })] : []),
  ], { size: "md", status: { text: "Data", icon: "chart" } });
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
    col(visibleItems.map((item, index) => entityPanel(item, index)), { key: "items", gap: 2 }),
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
    col(visibleItems.map((item, index) => recommendationPanel(block, item, index)), { key: "recommendations", gap: 2 }),
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
      ], { key: "content", gap: 1, flex: 1 }),
    ], { key: "main", align: "start", gap: 6, wrap: "nowrap" }),
  ], { status: { text: "Unavailable", icon: "info" } });
}

function actionProposalWidget(block: Extract<AiPresentationBlock, { type: "action_proposal" }>): Widgets.Card {
  return productPulseCard([
    title(block.title || "Preview internal change", { key: "title", size: "md", weight: "bold" }),
    caption(block.summary, { key: "caption", color: COLORS.muted, maxLength: 220 }),
    sectionBox([
      compactInfoLine("Reason", block.reason || block.summary, "reason"),
      divider("reason-divider", 2),
      compactInfoLine("Expected", block.expectedResult || "ProductPulse will execute this internal app action after confirmation.", "expected", COLORS.accent),
    ], { key: "preview", background: COLORS.soft }),
    ...(block.risks.length ? [col(block.risks.slice(0, 3).map((risk, index) => bulletRow(risk, `risk-${index}`, "info")), { key: "risks", gap: 1 })] : []),
    caption("This action affects ProductPulse internal data only. Shopify product data is not modified.", { key: "safety" }),
  ], {
    size: "md",
    status: {
      text: "Action proposal",
      icon: block.confirmationLevel === "high" ? "info" : "check-circle",
    },
    cancel: {
      label: "Cancel",
      action: { type: "cancel_ai_action", payload: { proposalId: block.proposalId } },
    },
    confirm: {
      label: "Apply change",
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
      ], { key: "heading", gap: 1, flex: 1 }),
    ], { key: "top", gap: 6, align: "start", wrap: "nowrap" }),
    sectionBox([
      text(block.summary, { key: "summary", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text }),
      ...(block.targetLabel ? [caption(`Target: ${block.targetLabel}`, { key: "target" })] : []),
      ...(block.createdJobId ? [caption(`Job: ${block.createdJobId}`, { key: "job", maxLength: 120 })] : []),
    ], { key: "summary-box" }),
    ...(block.affectedEntities.length ? [
      col(block.affectedEntities.slice(0, 4).map((entity, index) => bulletRow(entity.label || entity.id, `affected-${index}`, "check-circle")), {
        key: "affected",
        gap: 1,
      }),
    ] : []),
  ], {
    status: {
      text: block.status === "cancelled" ? "Action cancelled" : block.status === "success" ? "Action completed" : "Action failed",
      icon: block.status === "success" ? "check-circle" : "info",
    },
  });
}

function appDraftProposalWidget(block: Extract<AiPresentationBlock, { type: "app_draft_proposal" }>): Widgets.Card {
  const fieldControls = block.editableFields.flatMap((field, index) => editableFieldControl(field, index));
  return productPulseCard([
    row([
      iconTile(block.draftType === "metafield_value" ? "document" : "sparkle", {
        key: "icon",
        background: COLORS.accentSoft,
      }),
      col([
        title(block.title, { key: "title", size: "md", weight: "bold", maxLines: 2 }),
        caption(block.summary, { key: "summary", color: COLORS.muted, maxLength: 260 }),
      ], { key: "heading-copy", gap: 1, flex: 1 }),
    ], { key: "heading", gap: 6, align: "start", wrap: "nowrap" }),
    ...(block.generatedReason ? [
      sectionBox([
        caption("Reason", { key: "label", color: COLORS.accent, weight: "bold" }),
        text(block.generatedReason, { key: "reason", maxLength: MAX_DETAIL_LENGTH, maxLines: 3 }),
      ], { key: "reason-box", background: COLORS.panel }),
    ] : []),
    {
      type: "Form",
      key: "draft-form",
      direction: "col",
      gap: 1,
      onSubmitAction: { type: "save_ai_app_mutation", payload: { proposalId: block.proposalId } },
      children: [
        ...fieldControls,
        row([
          {
            type: "Button",
            key: "save",
            submit: true,
            label: "Save in ProductPulse",
            style: "primary",
            variant: "solid",
            color: "primary",
            size: "xs",
            block: true,
          },
          button("Cancel", "cancel_ai_app_mutation", { proposalId: block.proposalId }, "chevron-right", {
            key: "cancel",
            style: "secondary",
            variant: "outline",
            block: true,
          }),
        ], { key: "buttons", gap: 3, wrap: "wrap" }),
      ],
    },
    ...(block.validationWarnings.length ? [
      col(block.validationWarnings.slice(0, 3).map((warning, index) => bulletRow(warning, `warning-${index}`, "info")), {
        key: "warnings",
        gap: 1,
      }),
    ] : []),
    caption("This saves ProductPulse app data only. It does not update Shopify.", { key: "safety" }),
  ], {
    size: "lg",
    status: {
      text: "ProductPulse action",
      icon: "document",
    },
  });
}

function appDraftResultWidget(block: Extract<AiPresentationBlock, { type: "app_draft_result" }>): Widgets.Card {
  const isSuccess = block.status === "success";
  return productPulseCard([
    row([
      iconTile(isSuccess ? "check-circle" : "info", {
        key: "icon",
        background: isSuccess ? COLORS.successSoft : block.status === "error" ? COLORS.dangerSoft : COLORS.soft,
      }),
      col([
        title(block.title, { key: "title", size: "md", weight: "bold" }),
        row([
          badge(appDraftStatusLabel(block.status), appDraftStatusColor(block.status), { key: "status" }),
          ...(block.sideEffectLevel ? [badge(`${capitalize(block.sideEffectLevel)} app effect`, sideEffectBadgeColor(block.sideEffectLevel), { key: "side-effect" })] : []),
        ], { key: "badges", gap: 4 }),
      ], { key: "copy", gap: 1, flex: 1 }),
    ], { key: "top", gap: 6, align: "start", wrap: "nowrap" }),
    sectionBox([
      text(block.summary, { key: "summary", maxLength: MAX_SUMMARY_LENGTH, color: COLORS.text }),
      ...(block.targetLabel ? [caption(`Target: ${block.targetLabel}`, { key: "target" })] : []),
      ...(block.savedRecordId ? [caption(`Saved record: ${block.savedRecordId}`, { key: "record", maxLength: 120 })] : []),
    ], { key: "summary-box" }),
    ...(block.affectedEntities.length ? [
      col(block.affectedEntities.slice(0, 4).map((entity, index) => bulletRow(entity.label || entity.id, `affected-${index}`, "check-circle")), {
        key: "affected",
        gap: 1,
      }),
    ] : []),
    ...(block.primaryAction ? [
      button(block.primaryAction.label, block.primaryAction.type, block.primaryAction.payload, "chevron-right", {
        key: "primary-action",
        style: "primary",
        variant: "solid",
        color: "primary",
        block: true,
      }),
    ] : []),
  ], {
    status: {
      text: isSuccess ? "Saved" : block.status === "cancelled" ? "Cancelled" : "Save failed",
      icon: isSuccess ? "check-circle" : "info",
    },
  });
}

function scoreExplanationWidget(block: Extract<AiPresentationBlock, { type: "score_explanation" }>): Widgets.Card {
  return productPulseCard([
    row([
      iconTile("analytics", { key: "icon", background: COLORS.infoSoft, iconColor: COLORS.infoText }),
      col([
        title(block.scoreName, { key: "title", size: "md", weight: "bold" }),
        caption([block.range, "ProductPulse scoring"].filter(Boolean).join(" · "), { key: "range" }),
      ], { key: "heading-copy", gap: 1, flex: 1 }),
      badge("Methodology", "info", { key: "badge" }),
    ], { key: "heading", gap: 5, align: "start", wrap: "nowrap" }),
    text(block.meaning, { key: "meaning", maxLength: 360 }),
    sectionBox([
      ...(block.formula ? [
        caption("Formula / logic", { key: "formula-label", color: COLORS.infoText, weight: "bold" }),
        text(block.formula, { key: "formula", maxLength: 420, color: COLORS.text }),
      ] : []),
      text(block.logic, { key: "logic", maxLength: 520 }),
    ], { key: "logic-box", background: COLORS.soft }),
    ...(block.thresholds.length ? [
      col(block.thresholds.slice(0, 5).map((threshold, index) => compactInfoLine(
        threshold.label,
        `${threshold.value}: ${threshold.meaning}`,
        `threshold-${index}`,
        COLORS.infoText,
      )), { key: "thresholds", gap: 0 }),
    ] : []),
    ...(block.inputs.length ? [
      caption(`Inputs: ${block.inputs.slice(0, 5).join(", ")}`, { key: "inputs", maxLength: 260 }),
    ] : []),
    ...(block.caveats.length ? [
      col(block.caveats.slice(0, 3).map((caveat, index) => bulletRow(caveat, `caveat-${index}`, "info")), {
        key: "caveats",
        gap: 1,
      }),
    ] : []),
  ], { size: "full", status: { text: "Score explanation", icon: "analytics" } });
}

function processGuideWidget(block: Extract<AiPresentationBlock, { type: "process_guide" }>): Widgets.Card {
  return productPulseCard([
    row([
      iconTile("sparkle", { key: "icon", background: COLORS.accentSoft, iconColor: COLORS.accentStrong }),
      col([
        title(block.title, { key: "title", size: "md", weight: "bold" }),
        text(block.summary, { key: "summary", maxLength: 520 }),
      ], { key: "copy", gap: 1, flex: 1 }),
    ], { key: "heading", gap: 5, align: "start", wrap: "nowrap" }),
    ...(block.steps.length ? [
      col(block.steps.slice(0, 6).map((step, index) => compactInfoLine(
        `${index + 1}. ${step.label}`,
        step.detail,
        `step-${index}`,
        COLORS.accent,
      )), { key: "steps", gap: 0 }),
    ] : []),
    ...(block.inputs.length || block.outputs.length ? [
      sectionBox([
        ...(block.inputs.length ? [caption(`Inputs: ${block.inputs.slice(0, 5).join(", ")}`, { key: "inputs", maxLength: 260 })] : []),
        ...(block.outputs.length ? [caption(`Outputs: ${block.outputs.slice(0, 5).join(", ")}`, { key: "outputs", maxLength: 260 })] : []),
      ], { key: "io", background: COLORS.soft }),
    ] : []),
    ...(block.limitations.length ? [
      col(block.limitations.slice(0, 3).map((limitation, index) => bulletRow(limitation, `limitation-${index}`, "info")), {
        key: "limitations",
        gap: 1,
      }),
    ] : []),
  ], { size: "full", status: { text: "Process guide", icon: "sparkle-double" } });
}

function screenGuideWidget(block: Extract<AiPresentationBlock, { type: "screen_guide" }>): Widgets.Card {
  return productPulseCard([
    row([
      iconTile("profile-card", { key: "icon", background: COLORS.accentSoft, iconColor: COLORS.accentStrong }),
      col([
        title(block.screenName, { key: "title", size: "md", weight: "bold" }),
        text(block.purpose, { key: "purpose", maxLength: 420 }),
      ], { key: "copy", gap: 1, flex: 1 }),
    ], { key: "heading", gap: 5, align: "start", wrap: "nowrap" }),
    ...(block.howToRead.length ? [
      col(block.howToRead.slice(0, 5).map((item, index) => bulletRow(item, `read-${index}`, "check-circle")), {
        key: "how-to-read",
        gap: 1,
      }),
    ] : []),
    ...(block.dataShown.length || block.commonActions.length ? [
      sectionBox([
        ...(block.dataShown.length ? [caption(`Shows: ${block.dataShown.slice(0, 5).join(", ")}`, { key: "shown", maxLength: 260 })] : []),
        ...(block.commonActions.length ? [caption(`Actions: ${block.commonActions.slice(0, 5).join(", ")}`, { key: "actions", maxLength: 260 })] : []),
      ], { key: "screen-facts", background: COLORS.soft }),
    ] : []),
    ...(block.caveats.length ? [
      caption(`Note: ${block.caveats[0]}`, { key: "caveat", maxLength: 220 }),
    ] : []),
  ], { size: "full", status: { text: "Screen guide", icon: "profile-card" } });
}

function settingExplanationWidget(block: Extract<AiPresentationBlock, { type: "setting_explanation" }>): Widgets.Card {
  return productPulseCard([
    row([
      iconTile("settings-slider", { key: "icon", background: COLORS.infoSoft, iconColor: COLORS.infoText }),
      col([
        title(block.settingName, { key: "title", size: "md", weight: "bold" }),
        text(block.meaning, { key: "meaning", maxLength: 420 }),
      ], { key: "copy", gap: 1, flex: 1 }),
    ], { key: "heading", gap: 5, align: "start", wrap: "nowrap" }),
    sectionBox([
      compactInfoLine("Default", block.defaultValue || "Not documented", "default", COLORS.infoText),
      divider("setting-divider", 1),
      compactInfoLine("Effect", block.effect, "effect", COLORS.infoText),
    ], { key: "details", background: COLORS.soft }),
    ...(block.allowedValues.length ? [
      caption(`Allowed values: ${block.allowedValues.join(", ")}`, { key: "allowed", maxLength: 220 }),
    ] : []),
    ...(block.caveats.length ? [
      col(block.caveats.slice(0, 3).map((caveat, index) => bulletRow(caveat, `caveat-${index}`, "info")), {
        key: "caveats",
        gap: 1,
      }),
    ] : []),
  ], { size: "full", status: { text: "Setting", icon: "settings-slider" } });
}

function interactionGuidanceWidget(block: Extract<AiPresentationBlock, { type: "interaction_guidance" }>): Widgets.Card {
  return productPulseCard([
    row([
      iconTile("sparkle", { key: "icon", background: COLORS.accent, iconColor: "#FFFFFF" }),
      col([
        title(block.title, { key: "title", size: "md", weight: "bold" }),
        text(block.summary, { key: "summary", maxLength: 520 }),
      ], { key: "copy", gap: 1, flex: 1 }),
    ], { key: "heading", gap: 5, align: "start", wrap: "nowrap" }),
    sectionBox([
      caption("Pregunta de seguimiento", { key: "label", color: COLORS.accentStrong, weight: "bold" }),
      text(block.clarificationQuestion, { key: "question", maxLength: 240, weight: "semibold" }),
    ], { key: "question", background: COLORS.panel }),
    col(block.options.slice(0, 6).map((option, index) => guidanceOptionPanel(option, index)), {
      key: "options",
      gap: 1,
    }),
    ...(block.caveats.length ? [
      col(block.caveats.slice(0, 2).map((caveat, index) => bulletRow(caveat, `caveat-${index}`, "info")), {
        key: "caveats",
        gap: 1,
      }),
    ] : []),
  ], { size: "full", status: { text: "Assistant guide", icon: "sparkle-double" } });
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
    theme: "light",
    padding: 4,
    background: COLORS.card,
    ...options,
    size: "full",
    children: [col(children, { key: "card-content", gap: 1, width: "100%" })],
  };
}

function title(value: string, options: Partial<Widgets.Title> = {}): Widgets.Title {
  return { type: "Title", value: sanitizeText(value, 180), size: "md", weight: "bold", color: COLORS.text, ...options };
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
    size: "xs",
    variant: "outline",
    onClickAction: { type: actionType, payload: compactPayload(payload) },
    ...options,
  };
}

function row(children: Widgets.WidgetComponent[], options: Partial<Widgets.Row> = {}): Widgets.Row {
  return { type: "Row", gap: 3, align: "center", wrap: "wrap", width: "100%", children, ...options };
}

function col(children: Widgets.WidgetComponent[], options: Partial<Widgets.Col> = {}): Widgets.Col {
  return { type: "Col", gap: 1, align: "stretch", width: "100%", children, ...options };
}

function box(children: Widgets.WidgetComponent[], options: Partial<Widgets.Box> = {}): Widgets.Box {
  return { type: "Box", children, ...options };
}

function sectionBox(children: Widgets.WidgetComponent[], options: Partial<Widgets.Col> = {}): Widgets.Col {
  return col(children, {
    padding: 3,
    background: COLORS.panel,
    border: { size: 1, color: COLORS.border },
    radius: "md",
    ...options,
  });
}

function divider(key?: string, spacing = 4): Widgets.WidgetComponent {
  return { type: "Divider", spacing, color: COLORS.divider, key };
}

function icon(name: Widgets.WidgetIcon, options: Partial<Widgets.Icon> = {}): Widgets.Icon {
  return { type: "Icon", name, size: "sm", color: COLORS.accentStrong, ...options };
}

function iconTile(
  name: Widgets.WidgetIcon,
  options: Partial<Widgets.Box> & { iconColor?: string; iconSize?: Widgets.Icon["size"] } = {},
): Widgets.Box {
  const { iconColor, iconSize, ...boxOptions } = options;
  const background = boxOptions.background || COLORS.accent;
  const resolvedIconColor = iconColor || iconColorForBackground(background);
  return box([
    icon(name, { key: "icon", color: resolvedIconColor, size: iconSize || "xl" }),
  ], {
    key: "icon-tile",
    width: 34,
    height: 34,
    minWidth: 34,
    align: "center",
    justify: "center",
    radius: "lg",
    background,
    padding: 0,
    ...boxOptions,
  });
}

function iconColorForBackground(background: unknown): string {
  const value = String(background || "");
  if (value === COLORS.accent || value === COLORS.infoText || value === COLORS.successText || value === COLORS.dangerText) return "#FFFFFF";
  if (value === COLORS.successSoft) return COLORS.successText;
  if (value === COLORS.dangerSoft) return COLORS.dangerText;
  if (value === COLORS.infoSoft) return COLORS.infoText;
  return COLORS.accentStrong;
}

function productImageOrIcon(
  block: Extract<AiPresentationBlock, { type: "product_reference" }>,
  key: string,
): Widgets.Image | Widgets.Box {
  const imageUrl = safeImageUrl(block.imageUrl);
  if (!imageUrl) {
    return box([
      icon("profile-card", { key: "icon", color: COLORS.accentStrong, size: "xl" }),
    ], {
      width: 44,
      height: 44,
      minWidth: 44,
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
    width: 44,
    height: 44,
    minWidth: 44,
    radius: "lg",
    fit: "cover",
    frame: false,
  };
}

function metricGrid(
  metrics: Array<{ label: string; value: string | number | boolean | null; detail?: string | null; trend?: string | null; tone?: "danger" | "success" | "info" | "neutral" }>,
  options: Partial<Widgets.Col> = {},
): Widgets.Col {
  return col(metrics.map((metric, index) => metricTile(metric, index)), {
    gap: 0,
    ...options,
  });
}

function metricTile(
  metric: { label: string; value: string | number | boolean | null; detail?: string | null; trend?: string | null; tone?: "danger" | "success" | "info" | "neutral" },
  index: number,
): Widgets.Row {
  return row([
    col([
      caption(metric.label, { key: "label", maxLength: 80, color: metricCaptionColor(metric.tone), maxLines: 1 }),
      ...(metric.detail ? [caption(metric.detail, { key: "detail", maxLength: 96, maxLines: 1 })] : []),
      ...(metric.trend ? [caption(metric.trend, { key: "trend", maxLength: 80, maxLines: 1, color: "#0f9f5f" })] : []),
    ], { key: "copy", gap: 0, flex: 1 }),
    text(formatMetricValue(metric.value), {
      key: "value",
      weight: "bold",
      textAlign: "end",
      maxLength: 64,
      maxLines: 1,
      color: metricCaptionColor(metric.tone),
    }),
  ], {
    key: `metric-${index}`,
    justify: "between",
    align: "center",
    wrap: "nowrap",
    padding: { top: 1, right: 0, bottom: 1, left: 0 },
    border: { bottom: { size: 1, color: COLORS.divider } },
  });
}

function compactIssueRow(
  metric: Extract<AiPresentationBlock, { type: "metric_table" }>["rows"][number],
  index: number,
): Widgets.WidgetComponent {
  return row([
    col([
      text(metric.label, { key: "label", weight: "semibold", maxLength: 120, maxLines: 1 }),
      ...(metric.detail ? [caption(metric.detail, { key: "detail", color: COLORS.muted, maxLength: 180, maxLines: 1 })] : []),
    ], { key: "copy", gap: 0, flex: 1 }),
    badge(formatMetricValue(metric.value), metricValueBadgeColor(metric.value), { key: "badge" }),
  ], {
    key: `metric-${index}`,
    justify: "between",
    align: "center",
    wrap: "nowrap",
    gap: 4,
    padding: { top: 1, right: 0, bottom: 1, left: 0 },
    ...(index < MAX_METRIC_ROWS - 1 ? { border: { bottom: { size: 1, color: COLORS.divider } } } : {}),
  });
}

function evidenceBadgeColor(index: number): NonNullable<Widgets.Badge["color"]> {
  if (index === 1) return "danger";
  if (index === 2) return "info";
  return "secondary";
}

function metricCaptionColor(tone?: "danger" | "success" | "info" | "neutral"): string {
  if (tone === "danger") return COLORS.dangerText;
  if (tone === "success") return COLORS.successText;
  if (tone === "info") return COLORS.infoText;
  return COLORS.muted;
}

function metricValueBadgeColor(value: string | number | boolean | null): NonNullable<Widgets.Badge["color"]> {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high") || normalized.includes("open") || normalized.includes("critical")) return "danger";
  if (normalized.includes("medium") || normalized.includes("warning")) return "warning";
  if (normalized.includes("low") || normalized.includes("good")) return "success";
  return "secondary";
}

function buildProductSummaryCaption(block: Extract<AiPresentationBlock, { type: "product_reference" }>): string {
  return [
    block.productType || block.vendor || null,
    block.handle || null,
    block.updatedAt ? `Updated ${block.updatedAt}` : null,
  ].filter(Boolean).join(" · ") || "ProductPulse product";
}

function diagnosisAttentionLabel(block: Extract<AiPresentationBlock, { type: "diagnosis_summary" }>): string {
  if (typeof block.riskScore === "number" && block.riskScore >= 70) return "Needs attention";
  if (typeof block.riskScore === "number" && block.riskScore <= 35) return "Healthy";
  return "Review";
}

function diagnosisBadgeColor(block: Extract<AiPresentationBlock, { type: "diagnosis_summary" }>): NonNullable<Widgets.Badge["color"]> {
  if (typeof block.riskScore === "number" && block.riskScore >= 70) return "warning";
  if (typeof block.riskScore === "number" && block.riskScore <= 35) return "success";
  return "info";
}

function riskMetricValue(block: Extract<AiPresentationBlock, { type: "diagnosis_summary" }>): string {
  if (typeof block.riskScore !== "number") return "Unavailable";
  return `${riskLevelLabel(block.riskScore)} ${formatNumber(block.riskScore)}`;
}

function riskLevelLabel(score: number): string {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
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
    ], { key: "heading", justify: "between", align: "start", gap: 3 }),
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
    action_id: item.id,
  });
  const impactMetrics = [
    item.impact ? badge(`${item.impact} impact`, impactBadgeColor(item.impact), { key: "impact" }) : null,
    item.risk ? badge(`${item.risk} risk`, riskBadgeColor(item.risk), { key: "risk" }) : null,
    item.effort ? badge(`${item.effort} effort`, effortBadgeColor(item.effort), { key: "effort" }) : null,
    item.confidence ? badge(item.confidence, "discovery", { key: "confidence" }) : null,
  ].filter(Boolean) as Widgets.Badge[];

  return sectionBox([
    row([
      box([
        icon("sparkle", { key: "icon", size: "lg", color: COLORS.accentStrong }),
      ], {
        key: "icon",
        size: 38,
        minWidth: 38,
        radius: "lg",
        background: COLORS.accentSoft,
        align: "center",
        justify: "center",
      }),
      col([
        title(item.label, { key: "label", size: "sm", weight: "bold", maxLines: 2 }),
        text(item.draftPreview || item.expectedResult || item.issue || "Review this ProductPulse recommendation before taking action.", {
          key: "description",
          size: "sm",
          color: "#475569",
          maxLines: 2,
          maxLength: MAX_SNIPPET_LENGTH,
        }),
        row([
          ...impactMetrics,
          ...(item.status ? [badge(item.status, statusBadgeColor(item.status), { key: "status" })] : []),
        ], { key: "badges", gap: 6, wrap: "wrap" }),
      ], { key: "copy", gap: 4, flex: 1 }),
    ], { key: "top", gap: 4, align: "start", wrap: "nowrap" }),
    divider("action-divider", 1),
    ...(block.productGid ? [
      actionFooter([
        button("Review", "review_action", actionPayload, "chevron-right", {
          key: "review",
          style: "secondary",
          variant: "outline",
          block: true,
        }),
        button("Apply", "prepare_apply_action", actionPayload, "chevron-right", {
          key: "apply",
          style: "primary",
          variant: "solid",
          color: "primary",
          block: true,
        }),
      ], `actions-${index}`),
    ] : []),
  ], {
    key: `recommendation-${index}-${stableId(item.id || item.label)}`,
    gap: 1,
    background: COLORS.card,
    border: { size: 1, color: COLORS.border },
    radius: "lg",
  });
}

function guidanceOptionPanel(
  option: Extract<AiPresentationBlock, { type: "interaction_guidance" }>["options"][number],
  index: number,
): Widgets.Col {
  const badges = [
    badge(guidanceCategoryLabel(option.category), guidanceCategoryColor(option.category), { key: "category" }),
    ...(option.requiresProductContext ? [badge("Needs product", "info", { key: "product" })] : []),
    ...(option.requiresConfirmation ? [badge("Confirm first", "warning", { key: "confirm" })] : []),
  ];
  return sectionBox([
    row([
      box([
        icon(option.category === "read" ? "search" : option.category === "explain" ? "document" : "sparkle", {
          key: "icon",
          size: "lg",
          color: COLORS.accentStrong,
        }),
      ], {
        key: "icon",
        size: 34,
        minWidth: 34,
        radius: "lg",
        background: COLORS.accentSoft,
        align: "center",
        justify: "center",
      }),
      col([
        row([
          title(option.label, { key: "label", size: "sm", weight: "bold", maxLines: 2 }),
          badge(`#${index + 1}`, "secondary", { key: "index" }),
        ], { key: "title-row", justify: "between", align: "start", gap: 3, wrap: "nowrap" }),
        text(option.description, { key: "description", maxLength: 260, maxLines: 2, color: "#475569" }),
        row(badges, { key: "badges", gap: 4, wrap: "wrap" }),
      ], { key: "copy", gap: 1, flex: 1 }),
    ], { key: "top", gap: 4, align: "start", wrap: "nowrap" }),
    divider("option-divider", 1),
    caption(`Ejemplo: ${option.examplePrompt}`, { key: "example", maxLength: 220, color: COLORS.accentStrong }),
  ], {
    key: `guidance-${index}-${stableId(option.id)}`,
    background: COLORS.card,
    border: { size: 1, color: COLORS.border },
    radius: "lg",
  });
}

function actionFooter(children: Widgets.WidgetComponent[], key: string): Widgets.Row {
  return row(children, { key, gap: 3, align: "center", wrap: "wrap" });
}

function editableFieldControl(
  field: Extract<AiPresentationBlock, { type: "app_draft_proposal" }>["editableFields"][number],
  index: number,
): Widgets.WidgetComponent[] {
  const key = `field-${index}-${stableId(field.name)}`;
  const label = {
    type: "Label",
    key: `${key}-label`,
    value: field.label,
    fieldName: field.name,
    size: "sm",
    weight: "semibold",
    color: COLORS.text,
  } as Widgets.WidgetComponent;

  if (field.fieldType === "select") {
    return [
      label,
      {
        type: "Select",
        key,
        name: field.name,
        options: field.options || [],
        defaultValue: field.value,
        size: "sm",
        variant: "outline",
        block: true,
      } as Widgets.WidgetComponent,
    ];
  }

  if (field.fieldType === "text") {
    return [
      label,
      {
        type: "Input",
        key,
        name: field.name,
        inputType: "text",
        defaultValue: field.value,
        required: field.required,
        size: "sm",
        variant: "outline",
      } as Widgets.WidgetComponent,
    ];
  }

  return [
    label,
    {
      type: "Textarea",
      key,
      name: field.name,
      defaultValue: field.value,
      required: field.required,
      size: "sm",
      variant: "outline",
      rows: field.value.length > 280 ? 6 : 4,
      autoResize: true,
      maxRows: 10,
    } as Widgets.WidgetComponent,
  ];
}

function emptyInline(message: string, key: string): Widgets.Col {
  return sectionBox([
    caption(message, { key: "message" }),
  ], { key });
}

function compactInfoLine(label: string, value: string, key: string, labelColor = COLORS.muted): Widgets.Row {
  return row([
    text(label, { key: "label", weight: "bold", color: labelColor, maxLength: 72, width: 78, maxLines: 1 }),
    text(value, { key: "value", size: "sm", maxLines: 2, maxLength: MAX_DETAIL_LENGTH }),
  ], { key, align: "start", wrap: "nowrap", gap: 4 });
}

function bulletRow(value: string, key: string, iconName: Widgets.WidgetIcon = "dot"): Widgets.Row {
  return row([
    icon(iconName, { key: "icon", color: COLORS.accent }),
    text(value, { key: "text", maxLength: MAX_DETAIL_LENGTH }),
  ], { key, align: "start", wrap: "nowrap" });
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

function impactBadgeColor(label: string): NonNullable<Widgets.Badge["color"]> {
  const normalized = label.toLowerCase();
  if (normalized.includes("high") || normalized.includes("large") || normalized.includes("major")) return "danger";
  if (normalized.includes("medium")) return "warning";
  if (normalized.includes("low")) return "info";
  return "secondary";
}

function effortBadgeColor(label: string): NonNullable<Widgets.Badge["color"]> {
  const normalized = label.toLowerCase();
  if (normalized.includes("low") || normalized.includes("easy")) return "info";
  if (normalized.includes("medium")) return "warning";
  if (normalized.includes("high") || normalized.includes("hard")) return "danger";
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

function guidanceCategoryLabel(category: "read" | "explain" | "propose_action" | "app_mutation"): string {
  if (category === "read") return "Read data";
  if (category === "explain") return "Explain";
  if (category === "propose_action") return "Internal action";
  return "ProductPulse save";
}

function guidanceCategoryColor(category: "read" | "explain" | "propose_action" | "app_mutation"): NonNullable<Widgets.Badge["color"]> {
  if (category === "read") return "info";
  if (category === "explain") return "secondary";
  if (category === "propose_action") return "warning";
  return "discovery";
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

function appDraftStatusLabel(status: "success" | "error" | "cancelled"): string {
  if (status === "success") return "Saved";
  if (status === "error") return "Failed";
  return "Cancelled";
}

function appDraftStatusColor(status: "success" | "error" | "cancelled"): NonNullable<Widgets.Badge["color"]> {
  if (status === "success") return "success";
  if (status === "error") return "danger";
  return "secondary";
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
