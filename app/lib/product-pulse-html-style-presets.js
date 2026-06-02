export const PRODUCT_PULSE_DEFAULT_HTML_STYLE_PRESET = "productpulse-current";
export const PRODUCT_PULSE_CUSTOM_HTML_STYLE_PRESET = "custom";
export const PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS = {
  attributes: "{{ATTRIBUTES}}",
  title: "{{TITLE}}",
  headingHtml: "{{HEADING_HTML}}",
  contentHtml: "{{CONTENT_HTML}}",
};

export const PRODUCT_PULSE_HTML_STYLE_PRESETS = [
  {
    id: PRODUCT_PULSE_DEFAULT_HTML_STYLE_PRESET,
    label: "Current ProductPulse",
    shortLabel: "Current",
    description: "Blue callout with ProductPulse tracking attributes and compact uppercase heading.",
    tone: "blue",
    attributeStyle: "margin:18px 0;padding:16px 18px;border:1px solid #bfdbfe;border-left:4px solid #3b82f6;border-radius:12px;background:#eff6ff;color:#1f2937;box-shadow:0 1px 2px rgba(15,23,42,0.04);",
    headingStyle: "margin:0 0 10px;color:#1d4ed8;font-size:12px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;",
    paragraphStyle: "margin:0 0 10px;color:#374151;line-height:1.6;",
    template: `<section {{ATTRIBUTES}}>
{{HEADING_HTML}}
{{CONTENT_HTML}}
</section>`,
  },
  {
    id: "simple-clean",
    label: "Simple clean",
    shortLabel: "Simple",
    description: "Lightweight white block for themes that already carry strong typography.",
    tone: "slate",
    attributeStyle: "margin:16px 0;padding:14px 0;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;background:#ffffff;color:#111827;",
    headingStyle: "margin:0 0 8px;color:#111827;font-size:13px;font-weight:800;letter-spacing:0;text-transform:none;",
    paragraphStyle: "margin:0 0 9px;color:#374151;line-height:1.58;",
    template: `<section {{ATTRIBUTES}}>
{{HEADING_HTML}}
{{CONTENT_HTML}}
</section>`,
  },
  {
    id: "professional-card",
    label: "Professional card",
    shortLabel: "Professional",
    description: "Neutral bordered card with dense spacing for operational stores.",
    tone: "green",
    attributeStyle: "margin:18px 0;padding:18px 20px;border:1px solid #dbe3ef;border-radius:10px;background:#ffffff;color:#111827;box-shadow:0 1px 2px rgba(15,23,42,0.05);",
    headingStyle: "margin:0 0 10px;color:#0f6b3f;font-size:13px;font-weight:850;letter-spacing:0.02em;text-transform:uppercase;",
    paragraphStyle: "margin:0 0 10px;color:#334155;line-height:1.58;",
    template: `<section {{ATTRIBUTES}}>
{{HEADING_HTML}}
<div style="display:grid;gap:2px;">
{{CONTENT_HTML}}
</div>
</section>`,
  },
  {
    id: "premium-minimal",
    label: "Premium minimal",
    shortLabel: "Premium",
    description: "Soft gradient panel that makes AI-generated guidance feel polished without being loud.",
    tone: "purple",
    attributeStyle: "margin:20px 0;padding:18px 20px;border:1px solid #ddd6fe;border-radius:16px;background:linear-gradient(135deg,#ffffff 0%,#f8f7ff 58%,#f3f7f4 100%);color:#111827;box-shadow:0 1px 2px rgba(15,23,42,0.05),0 10px 24px rgba(15,23,42,0.06);",
    headingStyle: "margin:0 0 10px;color:#7c5cff;font-size:12px;font-weight:850;letter-spacing:0.06em;text-transform:uppercase;",
    paragraphStyle: "margin:0 0 10px;color:#475569;line-height:1.62;",
    template: `<section {{ATTRIBUTES}}>
{{HEADING_HTML}}
{{CONTENT_HTML}}
</section>`,
  },
  {
    id: "soft-highlight",
    label: "Soft highlight",
    shortLabel: "Highlight",
    description: "Green-tinted guidance block for positive recommendations and shopper reassurance.",
    tone: "green",
    attributeStyle: "margin:18px 0;padding:16px 18px;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:12px;background:#f3f7f4;color:#111827;",
    headingStyle: "margin:0 0 9px;color:#166534;font-size:12px;font-weight:850;letter-spacing:0.04em;text-transform:uppercase;",
    paragraphStyle: "margin:0 0 10px;color:#334155;line-height:1.58;",
    template: `<section {{ATTRIBUTES}}>
{{HEADING_HTML}}
{{CONTENT_HTML}}
</section>`,
  },
  {
    id: "editorial-guide",
    label: "Editorial guide",
    shortLabel: "Editorial",
    description: "Magazine-like inset with a strong headline and calm readable content.",
    tone: "amber",
    attributeStyle: "margin:20px 0;padding:20px 22px;border:1px solid #fed7aa;border-radius:4px;background:#fffaf0;color:#111827;",
    headingStyle: "margin:0 0 12px;color:#92400e;font-size:15px;font-weight:850;letter-spacing:0;text-transform:none;",
    paragraphStyle: "margin:0 0 11px;color:#475569;line-height:1.66;",
    template: `<aside {{ATTRIBUTES}}>
{{HEADING_HTML}}
{{CONTENT_HTML}}
</aside>`,
  },
];

const PRODUCT_PULSE_HTML_STYLE_IDS = new Set(PRODUCT_PULSE_HTML_STYLE_PRESETS.map((preset) => preset.id));

export function normalizeProductPulseHtmlStyle(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawPreset = String(source.preset || source.presetId || "").trim();
  const preset = rawPreset === PRODUCT_PULSE_CUSTOM_HTML_STYLE_PRESET || PRODUCT_PULSE_HTML_STYLE_IDS.has(rawPreset)
    ? rawPreset
    : PRODUCT_PULSE_DEFAULT_HTML_STYLE_PRESET;
  return {
    preset,
    customTemplate: String(source.customTemplate || "").trim(),
  };
}

export function getProductPulseHtmlStylePreset(presetId) {
  return PRODUCT_PULSE_HTML_STYLE_PRESETS.find((preset) => preset.id === presetId)
    || PRODUCT_PULSE_HTML_STYLE_PRESETS[0];
}

export function getProductPulseHtmlStyleTemplate(input = {}) {
  const style = normalizeProductPulseHtmlStyle(input);
  if (style.preset === PRODUCT_PULSE_CUSTOM_HTML_STYLE_PRESET && style.customTemplate) {
    return style.customTemplate;
  }
  return getProductPulseHtmlStylePreset(style.preset).template;
}

export function validateProductPulseHtmlStyle(input = {}) {
  const style = normalizeProductPulseHtmlStyle(input);
  if (style.preset !== PRODUCT_PULSE_CUSTOM_HTML_STYLE_PRESET) return "";
  if (!style.customTemplate) return "Custom HTML style needs a template.";
  if (!style.customTemplate.includes(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml)) {
    return "Custom HTML style must include {{CONTENT_HTML}} where ProductPulse should place the generated note or FAQ.";
  }
  return "";
}

export function buildProductPulseHtmlStylePreviewHtml(input = {}, options = {}) {
  const style = normalizeProductPulseHtmlStyle(input);
  const preset = getProductPulseHtmlStylePreset(style.preset);
  const template = getProductPulseHtmlStyleTemplate(style);
  const title = escapePreviewHtml(options.title || "Product note");
  const contentHtml = options.contentHtml || [
    "<p style=\"margin:0 0 10px;color:#374151;line-height:1.6;\">Use this area for ProductPulse notes, FAQs, specs, or expectation guidance.</p>",
    "<ul style=\"margin:0 0 0 18px;padding:0;color:#475569;line-height:1.55;\">",
    "<li>Generated content replaces <strong>{{CONTENT_HTML}}</strong>.</li>",
    "<li>The title can use <strong>{{TITLE}}</strong> or <strong>{{HEADING_HTML}}</strong>.</li>",
    "</ul>",
  ].join("\n");
  const attributes = [
    "data-productpulse-action=\"preview\"",
    "class=\"productpulse-preview productpulse-callout\"",
    `style="${escapePreviewAttribute(preset.attributeStyle)}"`,
  ].join(" ");
  const headingHtml = `<p style="${escapePreviewAttribute(preset.headingStyle)}">${title}</p>`;
  const rendered = template
    .replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes, attributes)
    .replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.title, title)
    .replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.headingHtml, headingHtml)
    .replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml, contentHtml);
  const body = rendered.includes(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes)
    ? rendered.replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes, attributes)
    : rendered;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:18px;background:#f6f8fa;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;} *{box-sizing:border-box;} @media (max-width:520px){body{padding:12px;font-size:12px;line-height:1.45;} p,li{font-size:12px!important;line-height:1.42!important;} [data-productpulse-action="preview"]{max-width:100%;}}</style></head><body>${sanitizePreviewHtml(body)}</body></html>`;
}

function sanitizePreviewHtml(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function escapePreviewHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapePreviewAttribute(value) {
  return escapePreviewHtml(value).replace(/\n/g, " ");
}
