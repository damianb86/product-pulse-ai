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
    description: "Quiet inline note with a thin ProductPulse accent and no card background.",
    tone: "blue",
    attributeStyle: "margin:16px 0;padding:2px 0 2px 14px;border:0;border-left:2px solid #2563eb;background:transparent;color:#1f2937;",
    headingStyle: "margin:0 0 7px;color:#1d4ed8;font-size:12px;font-weight:750;letter-spacing:0;text-transform:none;",
    paragraphStyle: "margin:0 0 9px;color:#374151;line-height:1.56;",
    template: `<section {{ATTRIBUTES}}>
{{HEADING_HTML}}
{{CONTENT_HTML}}
</section>`,
  },
  {
    id: "simple-clean",
    label: "Simple clean",
    shortLabel: "Simple",
    description: "Plain content block separated by one top rule for minimal product pages.",
    tone: "slate",
    attributeStyle: "margin:18px 0 14px;padding:13px 0 0;border:0;border-top:1px solid #d7dde6;background:transparent;color:#111827;",
    headingStyle: "margin:0 0 8px;color:#111827;font-size:13px;font-weight:700;letter-spacing:0;text-transform:none;",
    paragraphStyle: "margin:0 0 8px;color:#3f4a5a;line-height:1.55;",
    template: `<div {{ATTRIBUTES}}>
{{HEADING_HTML}}
<div style="max-width:68ch;">
{{CONTENT_HTML}}
</div>
</div>`,
  },
  {
    id: "professional-card",
    label: "Professional card",
    shortLabel: "Professional",
    description: "Compact neutral card with restrained structure for utilitarian stores.",
    tone: "green",
    attributeStyle: "margin:18px 0;padding:15px 16px;border:1px solid #d8dee8;border-radius:8px;background:#ffffff;color:#111827;box-shadow:0 1px 2px rgba(15,23,42,0.035);",
    headingStyle: "margin:0;color:#0f172a;font-size:12px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;",
    paragraphStyle: "margin:0 0 8px;color:#334155;line-height:1.55;",
    template: `<aside {{ATTRIBUTES}}>
<div style="display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:0 0 9px;border-bottom:1px solid #eef2f7;">
<span style="width:6px;height:6px;border-radius:999px;background:#16a34a;display:inline-block;flex:0 0 auto;"></span>
{{HEADING_HTML}}
</div>
<div style="display:grid;gap:2px;">
{{CONTENT_HTML}}
</div>
</aside>`,
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
    description: "Subtle tinted notice for guidance that should stand out slightly.",
    tone: "green",
    attributeStyle: "margin:18px 0;padding:14px 16px;border:1px solid #d9eadc;border-radius:10px;background:#f7faf7;color:#111827;",
    headingStyle: "display:inline-block;margin:0 0 9px;padding:2px 7px;border-radius:999px;background:#e9f5ec;color:#166534;font-size:11px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;",
    paragraphStyle: "margin:0 0 9px;color:#334155;line-height:1.56;",
    template: `<aside {{ATTRIBUTES}}>
{{HEADING_HTML}}
<div style="padding-left:1px;">
{{CONTENT_HTML}}
</div>
</aside>`,
  },
  {
    id: "editorial-guide",
    label: "Editorial guide",
    shortLabel: "Editorial",
    description: "Article-style insert with larger title text and no tinted panel.",
    tone: "amber",
    attributeStyle: "margin:22px 0;padding:18px 0 16px;border:0;border-top:2px solid #111827;border-bottom:1px solid #d8dee8;background:transparent;color:#111827;",
    headingStyle: "margin:0 0 12px;color:#111827;font-size:17px;font-weight:760;letter-spacing:0;text-transform:none;line-height:1.25;",
    paragraphStyle: "margin:0 0 10px;color:#475569;line-height:1.66;",
    template: `<section {{ATTRIBUTES}}>
<h3 style="margin:0 0 12px;color:#111827;font-size:17px;font-weight:760;letter-spacing:0;text-transform:none;line-height:1.25;">{{TITLE}}</h3>
<div style="max-width:70ch;">
{{CONTENT_HTML}}
</div>
</section>`,
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
    `<p style="${escapePreviewAttribute(preset.paragraphStyle)}">Use this area for ProductPulse notes, FAQs, specs, or expectation guidance.</p>`,
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
