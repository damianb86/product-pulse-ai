export const PRODUCT_PULSE_ICON_RENDERERS = Object.freeze({
  asset: "asset",
  chatKitHeaderIcon: "chat-kit-header-icon",
  chatKitStarterIcon: "chat-kit-starter-icon",
  helpIcon: "help-icon",
  plansCreditsIcon: "plans-credits-icon",
  productPulseGlyph: "product-pulse-glyph",
  shopifySIcon: "shopify-s-icon",
  textGlyph: "text-glyph",
});

export const PRODUCT_PULSE_ICON_CATALOG = Object.freeze([
  iconDefinition("ai-evidence-synthesis", "AI Evidence Synthesis", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["evidence-synthesis"] }),
  iconDefinition("binoculars", "Watchlist", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["watchlist-products"] }),
  iconDefinition("check-circle", "Completed / Resolved", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["check", "success"] }),
  iconDefinition("csv-reviews", "CSV Reviews", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["csv"] }),
  iconDefinition("customer-language-analysis", "Customer Language Analysis", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["customer-language", "friction"] }),
  iconDefinition("diagnostic-confidence", "Diagnostic Confidence", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["confidence", "shield-check-mark"] }),
  iconDefinition("financial-exposure", "Estimated Margin Exposure", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["cash-dollar", "refund", "refunds"] }),
  iconDefinition("judgeme-reviews", "Judge.me Reviews", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["judgeme"] }),
  iconDefinition("loox-reviews", "Loox Reviews", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["loox"] }),
  iconDefinition("main-issue", "Main Issue", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["issue"] }),
  iconDefinition("negative-review-pressure", "Negative Review Pressure", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["negative-reviews"] }),
  iconDefinition("next-best-action", "Next Best Action", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["actions", "recommended-actions"] }),
  iconDefinition("pause", "Paused", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("product-momentum", "Sales Momentum", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["chart-line", "momentum", "sales-momentum"] }),
  iconDefinition("product-risk", "Product Risk", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["alert-triangle", "risk", "risk-score"] }),
  iconDefinition("shopify-orders", "Shopify Orders", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["orders"] }),
  iconDefinition("shopify-product", "Shopify Product", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["catalog", "content", "product"] }),
  iconDefinition("shopify-refunds", "Shopify Refunds", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["refund-leakage"] }),
  iconDefinition("shopify-returns", "Shopify Returns", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["return", "returns"] }),
  iconDefinition("star", "Reviews", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["review", "reviews"] }),
  iconDefinition("thumb-down", "Negative Feedback", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("thumb-up", "Positive Feedback", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("trash", "Remove / Delete", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["delete", "remove"] }),
  iconDefinition("variants", "Product Variants", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["variant"] }),
  iconDefinition("wand", "AI Recommendation", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["ai-action", "suggested-action"] }),
  iconDefinition("yotpo-reviews", "Yotpo Reviews", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph, { aliases: ["yotpo"] }),

  iconDefinition("alert-circle", "Alert", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("arrow-down", "Decrease", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("arrow-left", "Back", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("arrow-up", "Increase", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("bug", "Bug / Feedback", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("calendar", "Date / Cadence", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("chat", "Chat / Message", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("chevron-down", "Expand", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("chevron-left", "Previous", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("chevron-right", "Next", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("chevron-up", "Collapse", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("clipboard", "Clipboard", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("clock", "Time / Active Now", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("close", "Close", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon, { aliases: ["x"] }),
  iconDefinition("database", "Stored Data", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("duplicate", "Duplicate / Clone", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("edit", "Edit", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("external", "Open External", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("file", "File / CSV", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("hide", "Hide", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("image", "Product Image", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("info", "Information", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("lightbulb", "Insight", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("menu-horizontal", "More Actions", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("note", "Note", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("package", "Package", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("play", "Run / Start", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("plus", "Add", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("plus-circle", "Add New", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("profile", "Customer Profile", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("question-circle", "Question / Help", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("recency", "Recency", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("refresh", "Refresh / Rescan", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("save", "Save", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("tag", "Tag", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("target", "Target / Accuracy", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),
  iconDefinition("trophy", "Achievement", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("velocity", "Sales Velocity", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("view", "View", PRODUCT_PULSE_ICON_RENDERERS.shopifySIcon),

  iconDefinition("assistant", "AI Assistant", PRODUCT_PULSE_ICON_RENDERERS.plansCreditsIcon),
  iconDefinition("bars", "Analytics Bars", PRODUCT_PULSE_ICON_RENDERERS.plansCreditsIcon),
  iconDefinition("card", "Shopify Billing Card", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("chart", "Analytics Dashboard", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("code", "Developer / Code", PRODUCT_PULSE_ICON_RENDERERS.plansCreditsIcon),
  iconDefinition("export", "Exports", PRODUCT_PULSE_ICON_RENDERERS.plansCreditsIcon),
  iconDefinition("gear", "Settings", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("heart", "Retention / Care", PRODUCT_PULSE_ICON_RENDERERS.plansCreditsIcon),
  iconDefinition("lock", "Secure / Locked", PRODUCT_PULSE_ICON_RENDERERS.plansCreditsIcon),
  iconDefinition("pulse", "Metric Timeline Pulse", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("rollover", "Credit Rollover", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("shield", "Protection / Billing Security", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("spark", "AI Spark", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("support", "Support", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("timeline", "Metric Timeline", PRODUCT_PULSE_ICON_RENDERERS.plansCreditsIcon),
  iconDefinition("users", "Users", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("wallet", "Credit Wallet", PRODUCT_PULSE_ICON_RENDERERS.plansCreditsIcon),

  iconDefinition("coverage", "Coverage", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("diagnosis", "Product Diagnosis", PRODUCT_PULSE_ICON_RENDERERS.helpIcon),
  iconDefinition("email", "Email", PRODUCT_PULSE_ICON_RENDERERS.helpIcon),
  iconDefinition("evidence", "Evidence", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("sources", "Sources", PRODUCT_PULSE_ICON_RENDERERS.helpIcon),

  iconDefinition("history", "Conversation History", PRODUCT_PULSE_ICON_RENDERERS.chatKitHeaderIcon),
  iconDefinition("new", "New Conversation", PRODUCT_PULSE_ICON_RENDERERS.chatKitHeaderIcon),
  iconDefinition("collapse", "Collapse", PRODUCT_PULSE_ICON_RENDERERS.chatKitHeaderIcon),
  iconDefinition("expand", "Expand", PRODUCT_PULSE_ICON_RENDERERS.chatKitHeaderIcon),
  iconDefinition("method", "Scoring Method", PRODUCT_PULSE_ICON_RENDERERS.productPulseGlyph),
  iconDefinition("metrics", "Key Metrics", PRODUCT_PULSE_ICON_RENDERERS.chatKitStarterIcon),

  iconDefinition("metric-timelines-asset", "Metric Timelines Image Asset", PRODUCT_PULSE_ICON_RENDERERS.asset, {
    assetPath: "/assets/metric-timelines-icon.png",
    aliases: ["metric-timelines-icon"],
  }),
  iconDefinition("ai-assistant-asset", "AI Assistant Image Asset", PRODUCT_PULSE_ICON_RENDERERS.asset, {
    assetPath: "/assets/ai-assistant-icon-gradient-transparent.png",
    aliases: ["ai-assistant-icon"],
  }),
  iconDefinition("points", "Credits / Points", PRODUCT_PULSE_ICON_RENDERERS.textGlyph),
]);

export const PRODUCT_PULSE_ICON_ALIASES = Object.freeze(
  PRODUCT_PULSE_ICON_CATALOG.reduce((aliases, icon) => {
    aliases[icon.key] = icon.key;
    icon.aliases.forEach((alias) => {
      aliases[alias] = icon.key;
    });
    return aliases;
  }, {}),
);

export const PRODUCT_PULSE_ICON_OPTIONS = Object.freeze(
  PRODUCT_PULSE_ICON_CATALOG.map(({ key, name }) => ({ label: name, value: key })),
);

export function normalizeProductPulseIconKey(icon) {
  const key = String(icon || "").trim().toLowerCase();
  return PRODUCT_PULSE_ICON_ALIASES[key] || key || "info";
}

export function getProductPulseIconDefinition(icon) {
  const normalized = normalizeProductPulseIconKey(icon);
  return PRODUCT_PULSE_ICON_CATALOG.find((definition) => definition.key === normalized) || null;
}

function iconDefinition(key, name, renderer, options = {}) {
  return Object.freeze({
    key,
    name,
    renderer,
    aliases: Object.freeze(options.aliases || []),
    assetPath: options.assetPath || "",
  });
}
