import { getAiChatConfig, hasOpenAiApiKey } from "../ai/chat/config.server";
import { recordAiUsageEvent } from "../ai/observability/usageEvents.server";
import { normalizeAiUsageCall } from "./product-pulse-ai-usage.server";
import {
  PRODUCT_PULSE_EXTRACTED_HTML_STYLE_PRESET,
  PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS,
} from "./product-pulse-html-style-presets";

const OPENAI_PROVIDER = "openai";
const HTML_STYLE_EXTRACTION_TASK = "html_style_extraction";
const HTML_STYLE_EXTRACTION_CONTEXT = "settings_html_style_extraction";
const MAX_PRODUCT_DESCRIPTION_HTML_CHARS = 12_000;
const MAX_EXTRACTED_TEMPLATE_CHARS = 5_000;
const MAX_EXTRACTED_NOTE_CHARS = 220;

export async function extractProductPulseHtmlStyleFromProduct({
  shop,
  admin,
  productId,
  userId = null,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const normalizedProductId = String(productId || "").trim();
  if (!normalizedProductId) {
    return { status: "validation_error", message: "Choose a Shopify product before analyzing its HTML style." };
  }
  if (!admin?.graphql) {
    return { status: "validation_error", message: "Shopify Admin API is not available for product style extraction." };
  }
  if (!hasOpenAiApiKey(env)) {
    return { status: "validation_error", message: "OPENAI_API_KEY is required before ProductPulse can analyze product HTML style." };
  }

  try {
    const product = await fetchShopifyProductStyleSource(admin, normalizedProductId);
    if (!product?.id) {
      return { status: "validation_error", message: "ProductPulse could not find that Shopify product." };
    }

    const descriptionHtml = String(product.descriptionHtml || "").trim();
    if (!descriptionHtml) {
      return {
        status: "validation_error",
        message: `${product.title || "This product"} does not have description HTML to analyze yet.`,
        product: formatStyleExtractionProduct(product),
      };
    }

    const config = getAiChatConfig(env);
    const model = String(config.cheapModel || config.defaultModel || "").trim();
    if (!model) {
      return { status: "validation_error", message: "No cheap AI model is configured for product HTML style extraction." };
    }

    const response = await requestOpenAiHtmlStyleExtraction({
      env,
      fetchImpl,
      model,
      input: buildHtmlStyleExtractionPrompt(product, descriptionHtml),
    });
    const outputText = extractOpenAiResponseText(response);
    const parsed = parseAiJson(outputText, {});
    const extraction = normalizeHtmlStyleExtraction(parsed, product);
    const usage = normalizeAiUsageCall({
      provider: OPENAI_PROVIDER,
      model,
      task: HTML_STYLE_EXTRACTION_TASK,
      requestContext: HTML_STYLE_EXTRACTION_CONTEXT,
      usage: response.usage || null,
      usageSource: response.usage ? "openai_response_usage" : "provider_missing",
    });

    await recordAiUsageEvent({
      shop,
      userId,
      source: "settings",
      operation: HTML_STYLE_EXTRACTION_TASK,
      provider: OPENAI_PROVIDER,
      model,
      task: HTML_STYLE_EXTRACTION_TASK,
      requestContext: HTML_STYLE_EXTRACTION_CONTEXT,
      entityType: "product",
      entityId: product.id,
      status: "success",
      usage,
      metadata: {
        productHandle: product.handle || null,
      },
    });

    return {
      status: "success",
      message: `Extracted HTML style from ${product.title || "selected product"}. Review the template, then save settings.`,
      action: {
        id: "extract-html-style-from-product",
        productGid: product.id,
        productTitle: product.title || "",
        productHandle: product.handle || "",
      },
      htmlStyle: {
        preset: PRODUCT_PULSE_EXTRACTED_HTML_STYLE_PRESET,
        customTemplate: extraction.template,
      },
      template: extraction.template,
      summary: extraction.summary,
      styleNotes: extraction.styleNotes,
      product: formatStyleExtractionProduct(product),
      ai: {
        provider: OPENAI_PROVIDER,
        model,
        task: HTML_STYLE_EXTRACTION_TASK,
        usage,
      },
    };
  } catch (error) {
    return {
      status: "validation_error",
      message: `Unable to extract product HTML style: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function fetchShopifyProductStyleSource(admin, productId) {
  const productGid = normalizeShopifyProductGid(productId);
  if (productGid) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseHtmlStyleSourceById($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          description
          descriptionHtml
          vendor
          productType
          status
        }
      }`,
      { id: productGid },
    );
    if (data?.product?.id) return data.product;
  }

  const fallbackQuery = productId === String(productId).trim() && !String(productId).includes(" ")
    ? `handle:${escapeShopifyQueryValue(productId)}`
    : String(productId || "").trim();
  const data = await shopifyGraphql(
    admin,
    `#graphql
    query ProductPulseHtmlStyleSourceByQuery($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          title
          handle
          description
          descriptionHtml
          vendor
          productType
          status
        }
      }
    }`,
    { query: fallbackQuery },
  );
  return data?.products?.nodes?.[0] || null;
}

async function requestOpenAiHtmlStyleExtraction({ env, fetchImpl, model, input }) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${String(env.OPENAI_API_KEY || "").trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      temperature: 0,
      max_output_tokens: 1000,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (response.ok) return json;
  const detail = json?.error?.message || json?.message || response.statusText || `HTTP ${response.status}`;
  throw new Error(`OpenAI returned ${response.status}: ${detail}`);
}

function buildHtmlStyleExtractionPrompt(product, descriptionHtml) {
  const sourceHtml = truncateText(descriptionHtml, MAX_PRODUCT_DESCRIPTION_HTML_CHARS);
  return [
    "You create safe Shopify product-description wrapper HTML for ProductPulse.",
    "Read the product description HTML and infer the reusable visual style: headings, spacing, borders/rules, lists, panels, typography and inline CSS.",
    "Return JSON only with this shape:",
    "{\"template\":\"...\",\"summary\":\"...\",\"styleNotes\":[\"...\"]}",
    "Template rules:",
    `- Include ${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes} on the outer wrapper element.`,
    `- Include ${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml} exactly where ProductPulse generated content belongs.`,
    `- Use ${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.title} for a heading when the source has heading/title styling. Do not copy product-specific text.`,
    "- Use simple HTML only: section, div, h3, h4, p, ul, ol, li, strong, em, span, hr, table, tbody, tr, th, td.",
    "- Use inline styles only. Do not include script, style, link, image, form, button, iframe, SVG, JavaScript URLs, event handlers or external assets.",
    "- Keep the template concise and reusable for other products.",
    "- If the source HTML is plain, return a basic clean template with the same spacing rhythm.",
    "",
    `Product: ${product.title || product.handle || "Shopify product"}`,
    `Vendor/type: ${[product.vendor, product.productType].filter(Boolean).join(" / ") || "not provided"}`,
    "Description HTML:",
    sourceHtml,
  ].join("\n");
}

export function normalizeHtmlStyleExtraction(input = {}, product = {}) {
  const source = input && typeof input === "object" ? input : {};
  const template = normalizeExtractedTemplate(source.template || source.htmlTemplate || source.wrapperHtml || "");
  const summary = truncateText(
    String(source.summary || source.rationale || source.description || "").replace(/\s+/g, " ").trim()
      || `Template extracted from ${product.title || "selected product"} description HTML.`,
    MAX_EXTRACTED_NOTE_CHARS,
  );
  const styleNotes = normalizeStyleNotes(source.styleNotes || source.style_notes || source.notes || []);
  return { template, summary, styleNotes };
}

function normalizeExtractedTemplate(value) {
  let template = sanitizeExtractedTemplate(value);
  if (!template) template = buildFallbackExtractedTemplate();

  if (!template.includes(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml)) {
    template = `${template}\n<div style="margin-top:10px;">\n${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml}\n</div>`;
  }
  if (
    !template.includes(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.title)
    && !template.includes(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.headingHtml)
  ) {
    template = template.replace(
      PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml,
      `<h3 style="margin:0 0 10px;font-size:16px;line-height:1.35;font-weight:700;color:inherit;">${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.title}</h3>\n${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml}`,
    );
  }
  if (!template.includes(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes)) {
    template = `<section ${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes}>\n${template}\n</section>`;
  }

  template = template.trim();
  if (template.length > MAX_EXTRACTED_TEMPLATE_CHARS) return buildFallbackExtractedTemplate();
  return template;
}

function sanitizeExtractedTemplate(value) {
  return String(value || "")
    .replace(/```(?:html|json)?/gi, "")
    .replace(/```/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(?:script|style|link|meta|iframe|object|embed|img|picture|source|svg|canvas|form|input|button|select|textarea)[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src|srcset|poster|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildFallbackExtractedTemplate() {
  return `<section ${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes}>
<h3 style="margin:0 0 10px;font-size:16px;line-height:1.35;font-weight:700;color:inherit;">${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.title}</h3>
<div style="display:grid;gap:8px;">
${PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml}
</div>
</section>`;
}

function normalizeStyleNotes(value) {
  const notes = (Array.isArray(value) ? value : [value])
    .map((item) => truncateText(String(item || "").replace(/\s+/g, " ").trim(), MAX_EXTRACTED_NOTE_CHARS))
    .filter(Boolean)
    .slice(0, 5);
  return notes.length ? notes : ["Used product description HTML structure, spacing, headings and inline styles where available."];
}

function parseAiJson(text, fallback) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
    extractJsonBlock(raw),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      // Try the next candidate shape.
    }
  }
  return fallback;
}

function extractJsonBlock(text) {
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) return text.slice(firstObject, lastObject + 1);
  return "";
}

function extractOpenAiResponseText(response = {}) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }
  return chunks.join("\n").trim();
}

function formatStyleExtractionProduct(product = {}) {
  return {
    id: product.id || "",
    title: product.title || product.handle || "Shopify product",
    handle: product.handle || "",
    vendor: product.vendor || "",
    productType: product.productType || "",
    status: product.status || "",
  };
}

async function shopifyGraphql(admin, query, variables) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await response.json();
  const errors = json.errors || [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
  return json.data;
}

function normalizeShopifyProductGid(value) {
  const input = String(value || "").trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(input)) return input;
  if (/^\d{5,}$/.test(input)) return `gid://shopify/Product/${input}`;
  return null;
}

function escapeShopifyQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (!Number.isFinite(maxLength) || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

export const __productPulseHtmlStyleExtractionTestHooks = {
  buildHtmlStyleExtractionPrompt,
  normalizeHtmlStyleExtraction,
  normalizeExtractedTemplate,
};
