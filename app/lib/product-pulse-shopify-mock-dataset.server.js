import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import prisma from "../db.server";
import { serializeCsvRows } from "./product-pulse-csv.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";

export const SHOPIFY_MOCK_DATASET_KIND = "shopify-mock-dataset";
export const SHOPIFY_MOCK_DATASET_SOURCE_KEY = "mockDataset";
export const REQUIRED_SHOPIFY_MOCK_DATASET_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_all_orders",
  "write_orders",
  "read_returns",
  "write_returns",
  "read_locations",
];

const GENERATED_TAG = "productpulse-gen";
const GENERATED_REVIEW_SOURCE = "ProductPulse mock reviews";
const DEFAULT_ORDER_COUNT = 120;
const MIN_ORDER_CREATE_DELAY_MS = 12_500;

const MOCK_PRODUCTS = [
  {
    key: "night-watch-print",
    title: "GEN Night Watch Dramatic Wall Print",
    productType: "Wall Art",
    vendor: "ProductPulse Lab",
    seoTitle: "Dramatic Night Watch Wall Print",
    seoDescription: "Museum-inspired Rembrandt wall print for dramatic rooms.",
    descriptionHtml: `
      <section>
        <h2>Museum-inspired statement wall print</h2>
        <p>This reproduction uses deep contrast, dense shadows and a dramatic crowd scene for buyers who want a bold focal point.</p>
        <ul>
          <li>Matte print finish</li>
          <li>Ships rolled in a protective tube</li>
          <li>Frame is not included</li>
        </ul>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, "art", "rembrandt", "dramatic", "quality-check"],
    options: [{ name: "Size", values: ["18x24", "24x36"] }],
    variants: [
      { options: { Size: "18x24" }, price: "89.00", sku: "GEN-NW-18X24" },
      { options: { Size: "24x36" }, price: "129.00", sku: "GEN-NW-24X36" },
    ],
    story: "A legitimate art print that intentionally creates subjective negative reactions. Returns and reviews mention fear, unsettling artwork and surprise.",
    expectedFindings: [
      "Subjective negative sentiment from return notes and reviews.",
      "Other return reasons with free-form notes should be analyzed.",
      "Expectation-setting note should be suggested, not a defect-only conclusion.",
    ],
    themes: ["fear", "unsettling", "dark", "unexpected"],
    reviewProfile: { count: 38, negativeRate: 0.45, average: 3.1 },
  },
  {
    key: "puzzle-calm",
    title: "GEN Calm Forest Puzzle 500 Pieces",
    productType: "Puzzle",
    vendor: "ProductPulse Lab",
    seoTitle: "Calm Forest 500 Piece Puzzle",
    seoDescription: "Relaxing 500 piece puzzle with clear piece count and finished size.",
    descriptionHtml: `
      <article>
        <h2>Clear, complete puzzle listing</h2>
        <p>A 500-piece illustrated forest puzzle with a finished size of 18 x 24 inches.</p>
        <p>Includes reference poster, resealable bag and sturdy storage box.</p>
      </article>
    `,
    tags: ["GEN", GENERATED_TAG, "puzzle", "family", "complete-description"],
    options: [{ name: "Edition", values: ["Standard"] }],
    variants: [{ options: { Edition: "Standard" }, price: "24.00", sku: "GEN-PUZZLE-CALM" }],
    story: "A well-built control product with clear copy, low returns and positive reviews.",
    expectedFindings: [
      "Low product risk.",
      "Positive or neutral sentiment should dominate.",
      "The app should avoid unnecessary rewrite actions.",
    ],
    themes: ["relaxing", "clear", "complete", "gift"],
    reviewProfile: { count: 34, negativeRate: 0.06, average: 4.7 },
  },
  {
    key: "travel-mug-leak",
    title: "GEN TrailSeal Travel Mug",
    productType: "Drinkware",
    vendor: "ProductPulse Lab",
    seoTitle: "Leakproof TrailSeal Travel Mug",
    seoDescription: "Insulated travel mug for commuting and hiking.",
    descriptionHtml: `
      <div>
        <h2>Insulated travel mug</h2>
        <p>Designed for daily commuting with a push-button lid and stainless steel body.</p>
        <p><strong>Marketing claim:</strong> leakproof in any bag.</p>
      </div>
    `,
    tags: ["GEN", GENERATED_TAG, "drinkware", "leakproof", "commute", "quality-risk"],
    options: [{ name: "Color", values: ["Steel", "Midnight"] }],
    variants: [
      { options: { Color: "Steel" }, price: "36.00", sku: "GEN-MUG-STL" },
      { options: { Color: "Midnight" }, price: "38.00", sku: "GEN-MUG-MID" },
    ],
    story: "A high-risk product: the copy over-promises leakproof behavior and orders generate repeated returns/refunds for leaking lids.",
    expectedFindings: [
      "High return/refund pressure.",
      "Repeated language around leaks, lid, bag and spills.",
      "Recommendation should clarify limits or trigger QA/supplier review.",
    ],
    themes: ["leak", "lid", "spill", "bag"],
    reviewProfile: { count: 46, negativeRate: 0.62, average: 2.4 },
  },
  {
    key: "soft-yoga-mat",
    title: "GEN CloudSoft Yoga Mat 12mm",
    productType: "Fitness",
    vendor: "ProductPulse Lab",
    seoTitle: "CloudSoft Extra Thick Yoga Mat",
    seoDescription: "Soft 12mm yoga mat for stretching and floor workouts.",
    descriptionHtml: `
      <section>
        <h2>Extra cushion yoga mat</h2>
        <p>This mat is intentionally soft and cushion-forward. It is best for stretching, pilates and floor workouts.</p>
        <p>Not recommended for fast balance transitions where a very firm surface is preferred.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, "fitness", "softness", "mat"],
    options: [{ name: "Color", values: ["Sage", "Charcoal"] }],
    variants: [
      { options: { Color: "Sage" }, price: "42.00", sku: "GEN-MAT-SAGE" },
      { options: { Color: "Charcoal" }, price: "42.00", sku: "GEN-MAT-CHAR" },
    ],
    story: "A product with expectation mismatch around softness: some buyers love the cushion, some return it because it is too soft for balance work.",
    expectedFindings: [
      "Medium risk from repeated but subjective softness feedback.",
      "Confidence should rise only with multiple signals.",
      "Recommendation should add expectation guidance, not overstate defect.",
    ],
    themes: ["soft", "cushion", "balance", "too thick"],
    reviewProfile: { count: 40, negativeRate: 0.28, average: 3.8 },
  },
  {
    key: "earbuds-color",
    title: "GEN AeroBud Wireless Earbuds",
    productType: "Electronics",
    vendor: "ProductPulse Lab",
    seoTitle: "AeroBud Wireless Earbuds",
    seoDescription: "Compact wireless earbuds with color variants and charging case.",
    descriptionHtml: `
      <div>
        <h2>Wireless earbuds with charging case</h2>
        <p>Bluetooth earbuds with touch controls and compact charging case.</p>
        <p>Includes USB-C cable and silicone ear tips.</p>
      </div>
    `,
    tags: ["GEN", GENERATED_TAG, "earbuds", "electronics", "color-mismatch"],
    options: [{ name: "Color", values: ["Black", "Rose", "Blue"] }],
    variants: [
      { options: { Color: "Black" }, price: "59.00", sku: "GEN-BUD-BLK" },
      { options: { Color: "Rose" }, price: "59.00", sku: "GEN-BUD-ROS" },
      { options: { Color: "Blue" }, price: "59.00", sku: "GEN-BUD-BLU" },
    ],
    story: "A variant-specific issue: the Rose color looks different in person and generates color returns.",
    expectedFindings: [
      "Variant concentration should identify the Rose variant.",
      "Color/appearance should appear in customer language and return reasons.",
      "Recommended action should focus on media or variant clarity.",
    ],
    themes: ["rose", "color", "photo", "different"],
    reviewProfile: { count: 36, negativeRate: 0.34, average: 3.5 },
  },
  {
    key: "smart-planter",
    title: "GEN SmartHerb Planter Kit",
    productType: "Home Garden",
    vendor: "ProductPulse Lab",
    seoTitle: "Smart Herb Planter Kit",
    seoDescription: "Indoor planter kit with app reminders and LED grow light.",
    descriptionHtml: `
      <article>
        <h2>Smart indoor herb planter</h2>
        <p>Includes planter base, LED grow light and seed pods. The companion app is available in English only.</p>
        <p>Requires 2.4 GHz Wi-Fi for reminders and light scheduling.</p>
      </article>
    `,
    tags: ["GEN", GENERATED_TAG, "garden", "smart-home", "compatibility"],
    options: [{ name: "Kit", values: ["Basil", "Mixed Herbs"] }],
    variants: [
      { options: { Kit: "Basil" }, price: "74.00", sku: "GEN-PLANT-BASIL" },
      { options: { Kit: "Mixed Herbs" }, price: "82.00", sku: "GEN-PLANT-MIX" },
    ],
    story: "Compatibility/product expectation issue around app language and 2.4 GHz Wi-Fi.",
    expectedFindings: [
      "Compatibility questions should trigger FAQ/spec guidance.",
      "Reviews mention app setup, language and Wi-Fi confusion.",
      "Not primarily a defect; PDP clarity should be recommended.",
    ],
    themes: ["wifi", "app", "language", "setup"],
    reviewProfile: { count: 31, negativeRate: 0.33, average: 3.6 },
  },
  {
    key: "linen-shirt-fit",
    title: "GEN Linen Breeze Shirt",
    productType: "Apparel",
    vendor: "ProductPulse Lab",
    seoTitle: "Linen Breeze Shirt",
    seoDescription: "Lightweight linen shirt for warm weather.",
    descriptionHtml: `
      <section>
        <h2>Lightweight linen shirt</h2>
        <p>Relaxed warm-weather shirt made from breathable linen blend.</p>
        <p>Care: machine wash cold, hang dry.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, "apparel", "linen", "size-fit"],
    options: [
      { name: "Size", values: ["S", "M", "L", "XL"] },
      { name: "Color", values: ["White", "Navy"] },
    ],
    variants: [
      { options: { Size: "S", Color: "White" }, price: "48.00", sku: "GEN-SHIRT-S-WHT" },
      { options: { Size: "M", Color: "White" }, price: "48.00", sku: "GEN-SHIRT-M-WHT" },
      { options: { Size: "L", Color: "Navy" }, price: "48.00", sku: "GEN-SHIRT-L-NVY" },
      { options: { Size: "XL", Color: "Navy" }, price: "48.00", sku: "GEN-SHIRT-XL-NVY" },
    ],
    story: "Size M runs small and should produce variant-level fit signals.",
    expectedFindings: [
      "Fit/size return reasons concentrated on one variant.",
      "Recommendation should add sizing guidance or fix variant names/options.",
      "Variant score should be non-zero because there are multiple variants.",
    ],
    themes: ["small", "fit", "sleeves", "size"],
    reviewProfile: { count: 42, negativeRate: 0.4, average: 3.2 },
  },
  {
    key: "ceramic-dinner-set",
    title: "GEN Aurora Ceramic Dinner Set",
    productType: "Kitchen",
    vendor: "ProductPulse Lab",
    seoTitle: "Aurora Ceramic Dinner Set",
    seoDescription: "Four-place ceramic dinnerware set with plates and bowls.",
    descriptionHtml: `
      <div>
        <h2>Four-place ceramic dinnerware</h2>
        <p>Includes 4 dinner plates, 4 salad plates and 4 bowls with a hand-glazed finish.</p>
        <p>Dishwasher safe. Ships in protective packaging.</p>
      </div>
    `,
    tags: ["GEN", GENERATED_TAG, "kitchen", "ceramic", "fragile", "shipping-damage"],
    options: [{ name: "Finish", values: ["Aurora Blue", "Warm White"] }],
    variants: [
      { options: { Finish: "Aurora Blue" }, price: "118.00", sku: "GEN-DINNER-BLU" },
      { options: { Finish: "Warm White" }, price: "112.00", sku: "GEN-DINNER-WHT" },
    ],
    story: "Operational damage pattern: customers like the product, but refunds and reviews mention broken pieces on arrival.",
    expectedFindings: [
      "Refund pressure and QA/fulfillment review should be visible.",
      "Sentiment should separate product appeal from damage complaints.",
      "Supplier/QA or packaging review should be a strong operational action.",
    ],
    themes: ["broken", "cracked", "packaging", "arrived damaged"],
    reviewProfile: { count: 35, negativeRate: 0.36, average: 3.4 },
  },
  {
    key: "desk-fan-mismatch",
    title: "GEN QuietDesk Mini Fan",
    productType: "Office",
    vendor: "ProductPulse Lab",
    seoTitle: "QuietDesk Mini Fan",
    seoDescription: "Small USB desk fan for quiet workspace cooling.",
    descriptionHtml: `
      <article>
        <h2>USB mini fan</h2>
        <p>Quiet airflow for desks and bedside tables. Includes USB cable.</p>
      </article>
    `,
    tags: ["GEN", GENERATED_TAG, "office", "fan", "source-integrity"],
    options: [{ name: "Color", values: ["White", "Graphite"] }],
    variants: [
      { options: { Color: "White" }, price: "19.00", sku: "GEN-FAN-WHT" },
      { options: { Color: "Graphite" }, price: "21.00", sku: "GEN-FAN-GPH" },
    ],
    story: "Reviews intentionally include references to a snowboard and boots to test source/review mismatch detection.",
    expectedFindings: [
      "Review/source mismatch should be detected.",
      "The app should recommend source integrity verification instead of rewriting good fan copy.",
      "Customer language should not overfit unrelated product words.",
    ],
    themes: ["snowboard", "boots", "wrong product", "desk fan"],
    reviewProfile: { count: 30, negativeRate: 0.42, average: 3.0 },
  },
  {
    key: "premium-keyboard",
    title: "GEN Atlas Pro Mechanical Keyboard",
    productType: "Electronics",
    vendor: "ProductPulse Lab",
    seoTitle: "Atlas Pro Mechanical Keyboard",
    seoDescription: "Premium mechanical keyboard with hot-swappable switches and aluminum frame.",
    descriptionHtml: `
      <section>
        <h2>Premium mechanical keyboard</h2>
        <p>Aluminum case, hot-swappable switches, RGB backlight and detachable USB-C cable.</p>
        <p>Choose tactile or linear switch feel before checkout.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, "keyboard", "premium", "high-momentum"],
    options: [{ name: "Switch", values: ["Tactile", "Linear"] }],
    variants: [
      { options: { Switch: "Tactile" }, price: "149.00", sku: "GEN-KBD-TAC" },
      { options: { Switch: "Linear" }, price: "149.00", sku: "GEN-KBD-LIN" },
    ],
    story: "Commercially strong product with rising sales and good reviews. It should test momentum without high risk.",
    expectedFindings: [
      "High momentum / low risk.",
      "Add to Watchlist or baseline scan should be reasonable.",
      "No aggressive PDP rewrite should be recommended.",
    ],
    themes: ["premium", "solid", "switches", "fast shipping"],
    reviewProfile: { count: 44, negativeRate: 0.1, average: 4.5 },
  },
];

export function getMissingShopifyMockDatasetScopes(scopeString) {
  const granted = new Set(String(scopeString || "").split(",").map((scope) => scope.trim()).filter(Boolean));
  return REQUIRED_SHOPIFY_MOCK_DATASET_SCOPES.filter((scope) => !granted.has(scope));
}

export async function getShopifyMockDatasetState(shop) {
  if (!shop) return null;
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: SHOPIFY_MOCK_DATASET_SOURCE_KEY } },
  }).catch(() => null);
  if (!source) return null;
  return {
    connected: source.connected,
    active: source.active,
    available: source.available,
    health: source.health,
    lastSyncedAt: source.lastSyncedAt,
    config: source.config || {},
  };
}

export async function runShopifyMockDatasetJob({ shop, admin, jobId, onProgress }) {
  if (!shop || !admin?.graphql) throw new Error("Shopify Admin client is required to create the mock dataset.");
  const runId = buildRunId();
  const runSuffix = runId.slice(-8);
  const createdAt = new Date();
  const orderDelayMs = getOrderCreateDelayMs();
  const context = {
    shop,
    admin,
    jobId,
    runId,
    runSuffix,
    createdAt,
    onProgress: typeof onProgress === "function" ? onProgress : async () => {},
  };

  await updateProgress(context, 3, "Preparing controlled Shopify mock dataset.");
  const shopInfo = await getShopInfo(admin);
  const location = await getPrimaryLocation(admin);
  await archivePreviousGeneratedProducts(context);

  await updateProgress(context, 12, "Creating 10 GEN products with product stories, SEO, tags and variants.");
  const products = [];
  for (const productSpec of MOCK_PRODUCTS) {
    const product = await createMockProduct(context, productSpec, location, shopInfo.currencyCode);
    products.push(product);
  }

  await updateProgress(context, 25, `Creating ${DEFAULT_ORDER_COUNT} historical Shopify orders.`);
  const orderPlans = buildOrderPlans(products, shopInfo.currencyCode);
  const orders = [];
  for (let index = 0; index < orderPlans.length; index += 1) {
    const createdOrder = await createMockOrder(context, orderPlans[index], location, shopInfo.currencyCode);
    orders.push(createdOrder);
    await updateProgress(
      context,
      25 + Math.floor(((index + 1) / orderPlans.length) * 45),
      `Created ${index + 1} of ${orderPlans.length} historical orders.`,
      { orderName: createdOrder.name },
    );
    if (index < orderPlans.length - 1 && orderDelayMs > 0) await wait(orderDelayMs);
  }

  await updateProgress(context, 72, "Creating returns and refunds from selected fulfilled line items.");
  const outcomes = await createMockReturnsAndRefunds(context, orders, shopInfo.currencyCode);

  await updateProgress(context, 86, "Writing normalized CSV review dataset.");
  const reviewRows = buildReviewRows(products, createdAt);
  const reviewSource = await saveMockCsvReviewSource({ shop, runId, rows: reviewRows });

  await updateProgress(context, 93, "Saving mock dataset manifest and expected detections.");
  const manifest = await saveMockDatasetManifest({
    shop,
    runId,
    createdAt,
    products,
    orders,
    outcomes,
    reviewRows,
    reviewSource,
    orderDelayMs,
  });

  await prisma.productPulseSource.upsert({
    where: { shop_sourceKey: { shop, sourceKey: SHOPIFY_MOCK_DATASET_SOURCE_KEY } },
    create: {
      shop,
      sourceKey: SHOPIFY_MOCK_DATASET_SOURCE_KEY,
      category: "testing",
      name: "Shopify mock dataset",
      connected: true,
      active: true,
      available: true,
      health: "connected",
      coverageWeight: 0,
      connectedAt: createdAt,
      lastSyncedAt: createdAt,
      config: manifest.summary,
    },
    update: {
      connected: true,
      active: true,
      available: true,
      health: "connected",
      lastSyncedAt: createdAt,
      config: manifest.summary,
    },
  });

  await recordJobLog({
    shop,
    jobId,
    event: "mock_dataset.completed",
    message: "Controlled Shopify mock dataset created.",
    data: manifest.summary,
  });

  await updateProgress(context, 100, "Shopify mock dataset completed.", manifest.summary);
  return manifest.summary;
}

async function archivePreviousGeneratedProducts(context) {
  const query = `tag:${GENERATED_TAG} AND title:'GEN'`;
  try {
    const data = await shopifyGraphql(context.admin, `#graphql
      query ProductPulseGeneratedProducts($query: String!) {
        products(first: 50, query: $query) {
          nodes {
            id
            title
          }
        }
      }
    `, { query });
    const products = data?.products?.nodes || [];
    for (const product of products) {
      await shopifyGraphql(context.admin, `#graphql
        mutation ProductPulseArchiveGeneratedProduct($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product { id title status }
            userErrors { field message }
          }
        }
      `, { product: { id: product.id, status: "ARCHIVED", tags: [GENERATED_TAG, "archived-gen"] } }).catch(() => null);
    }
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.previous_products_archived",
      message: `${products.length} previous GEN products were archived before creating the new dataset.`,
      data: { count: products.length },
    });
  } catch (error) {
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      level: "warning",
      event: "mock_dataset.archive_previous_failed",
      message: "Previous GEN products could not be archived. Continuing with unique handles.",
      data: { error: serializeError(error) },
    });
  }
}

async function createMockProduct(context, spec, location, currencyCode) {
  const handle = `gen-${spec.key}-${context.runSuffix}`;
  const productInput = {
    title: spec.title,
    handle,
    descriptionHtml: spec.descriptionHtml.trim(),
    productType: spec.productType,
    vendor: spec.vendor,
    tags: [...spec.tags, `run-${context.runSuffix}`],
    seo: {
      title: spec.seoTitle,
      description: spec.seoDescription,
    },
    status: "ACTIVE",
    productOptions: spec.options.map((option, index) => ({
      name: option.name,
      position: index + 1,
      values: option.values.map((name) => ({ name })),
    })),
  };

  const created = await shopifyGraphql(context.admin, `#graphql
    mutation ProductPulseCreateMockProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          title
          handle
          productType
          vendor
          options {
            id
            name
            position
            values
          }
        }
        userErrors { field message }
      }
    }
  `, { product: productInput });
  assertNoUserErrors(created?.productCreate?.userErrors, `Create product ${spec.title}`);
  const product = created.productCreate.product;
  const variantsInput = spec.variants.map((variant) => ({
    price: variant.price,
    compareAtPrice: variant.compareAtPrice || null,
    taxable: true,
    inventoryPolicy: "CONTINUE",
    optionValues: Object.entries(variant.options).map(([optionName, name]) => ({ optionName, name })),
    inventoryItem: {
      sku: variant.sku,
      tracked: true,
    },
    ...(location?.id ? {
      inventoryQuantities: [{
        locationId: location.id,
        availableQuantity: 100,
      }],
    } : {}),
  }));

  let variants = [];
  if (variantsInput.length) {
    const variantsData = await shopifyGraphql(context.admin, `#graphql
      mutation ProductPulseCreateMockVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
          productVariants {
            id
            title
            price
            sku
            selectedOptions {
              name
              value
            }
          }
          userErrors { field message }
        }
      }
    `, {
      productId: product.id,
      variants: variantsInput,
    });
    assertNoUserErrors(variantsData?.productVariantsBulkCreate?.userErrors, `Create variants for ${spec.title}`);
    variants = (variantsData?.productVariantsBulkCreate?.productVariants || []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: String(variant.price || "0"),
      sku: variant.sku,
      selectedOptions: variant.selectedOptions || [],
      productKey: spec.key,
    }));
  }

  return {
    ...spec,
    id: product.id,
    handle: product.handle,
    title: product.title,
    variants,
    currencyCode,
  };
}

function buildOrderPlans(products, currencyCode) {
  const start = Date.now() - 300 * 24 * 60 * 60 * 1000;
  const step = (300 * 24 * 60 * 60 * 1000) / DEFAULT_ORDER_COUNT;
  const byKey = new Map(products.map((product) => [product.key, product]));
  const keyCycle = [
    "premium-keyboard",
    "travel-mug-leak",
    "linen-shirt-fit",
    "puzzle-calm",
    "night-watch-print",
    "earbuds-color",
    "ceramic-dinner-set",
    "soft-yoga-mat",
    "smart-planter",
    "desk-fan-mismatch",
  ];

  return Array.from({ length: DEFAULT_ORDER_COUNT }, (_, index) => {
    const date = new Date(start + index * step + (index % 9) * 60 * 60 * 1000);
    const primary = byKey.get(keyCycle[index % keyCycle.length]);
    const secondary = index % 5 === 0 ? byKey.get(keyCycle[(index + 3) % keyCycle.length]) : null;
    const tertiary = index % 13 === 0 ? byKey.get(keyCycle[(index + 6) % keyCycle.length]) : null;
    const items = [primary, secondary, tertiary].filter(Boolean).map((product, itemIndex) => {
      const variant = pickVariantForOrder(product, index + itemIndex);
      return {
        productKey: product.key,
        productTitle: product.title,
        handle: product.handle,
        variantId: variant.id,
        variantTitle: variant.title,
        sku: variant.sku,
        quantity: getOrderQuantity(product.key, index),
        unitPrice: Number(variant.price || 0),
      };
    });
    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    return {
      index,
      processedAt: date.toISOString(),
      email: `productpulse.mock.${index + 1}@example.com`,
      currencyCode,
      note: `ProductPulse generated order ${index + 1}. Controlled mock dataset for diagnostics.`,
      tags: ["productpulse-gen-order", `run-${products[0]?.handle?.split("-").pop() || "mock"}`],
      items,
      total,
    };
  });
}

function pickVariantForOrder(product, index) {
  const variants = product.variants || [];
  if (!variants.length) throw new Error(`Product ${product.title} has no variants after creation.`);
  if (product.key === "linen-shirt-fit") {
    const medium = variants.find((variant) => variant.title.includes("M"));
    if (index % 2 === 0 && medium) return medium;
  }
  if (product.key === "earbuds-color") {
    const rose = variants.find((variant) => variant.title.toLowerCase().includes("rose"));
    if (index % 2 === 0 && rose) return rose;
  }
  return variants[index % variants.length];
}

function getOrderQuantity(productKey, index) {
  if (productKey === "puzzle-calm" && index % 4 === 0) return 2;
  if (productKey === "premium-keyboard" && index > 75 && index % 6 === 0) return 2;
  if (productKey === "ceramic-dinner-set" && index % 7 === 0) return 2;
  return 1;
}

async function createMockOrder(context, plan, location, currencyCode) {
  const orderInput = {
    currency: currencyCode,
    email: plan.email,
    processedAt: plan.processedAt,
    financialStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    test: true,
    note: plan.note,
    tags: plan.tags,
    shippingAddress: buildAddress(plan.index),
    billingAddress: buildAddress(plan.index),
    fulfillment: location?.id ? {
      locationId: location.id,
      notifyCustomer: false,
      shipmentStatus: "DELIVERED",
      trackingCompany: "Other",
      trackingNumber: `PPGEN${String(plan.index + 1).padStart(5, "0")}`,
    } : null,
    lineItems: plan.items.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      requiresShipping: true,
    })),
    transactions: [{
      kind: "SALE",
      status: "SUCCESS",
      test: true,
      gateway: "ProductPulse mock gateway",
      processedAt: plan.processedAt,
      amountSet: {
        shopMoney: {
          amount: plan.total.toFixed(2),
          currencyCode,
        },
      },
    }],
  };

  const data = await shopifyGraphql(context.admin, `#graphql
    mutation ProductPulseCreateMockOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order {
          id
          name
          processedAt
          transactions(first: 10) {
            id
            kind
            status
            gateway
            amountSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
          lineItems(first: 50) {
            nodes {
              id
              title
              quantity
              variant {
                id
              }
            }
          }
          fulfillments(first: 10) {
            id
            fulfillmentLineItems(first: 50) {
              nodes {
                id
                quantity
                lineItem {
                  id
                }
              }
            }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    order: stripNullish(orderInput),
    options: {
      sendReceipt: false,
      sendFulfillmentReceipt: false,
      inventoryBehaviour: "BYPASS",
    },
  });
  assertNoUserErrors(data?.orderCreate?.userErrors, `Create order ${plan.index + 1}`);
  const order = data.orderCreate.order;
  const lineItems = (order.lineItems?.nodes || []).map((lineItem) => {
    const planItem = plan.items.find((item) => item.variantId === lineItem.variant?.id) || plan.items[0];
    const fulfillmentLineItem = (order.fulfillments || [])
      .flatMap((fulfillment) => fulfillment.fulfillmentLineItems?.nodes || [])
      .find((item) => item.lineItem?.id === lineItem.id);
    return {
      id: lineItem.id,
      title: lineItem.title,
      quantity: lineItem.quantity,
      variantId: lineItem.variant?.id,
      fulfillmentLineItemId: fulfillmentLineItem?.id || null,
      productKey: planItem.productKey,
      productTitle: planItem.productTitle,
      handle: planItem.handle,
      sku: planItem.sku,
      variantTitle: planItem.variantTitle,
      unitPrice: planItem.unitPrice,
    };
  });

  return {
    id: order.id,
    name: order.name,
    processedAt: order.processedAt,
    transactions: order.transactions || [],
    lineItems,
    plan,
  };
}

async function createMockReturnsAndRefunds(context, orders, currencyCode) {
  const usedLineItems = new Set();
  const returns = [];
  const refunds = [];
  const returnCandidates = orders.flatMap((order) => order.lineItems.map((lineItem) => ({ order, lineItem })));

  for (const candidate of returnCandidates) {
    const { order, lineItem } = candidate;
    if (returns.length >= 28) break;
    if (!lineItem.fulfillmentLineItemId || usedLineItems.has(lineItem.id)) continue;
    const reason = getReturnReasonForLineItem(lineItem, returns.length);
    if (!reason) continue;
    usedLineItems.add(lineItem.id);
    const result = await createReturn(context, order, lineItem, reason);
    if (result?.id) returns.push({ orderId: order.id, orderName: order.name, lineItemId: lineItem.id, ...reason, id: result.id });
  }

  for (const candidate of returnCandidates) {
    const { order, lineItem } = candidate;
    if (refunds.length >= 18) break;
    if (usedLineItems.has(lineItem.id)) continue;
    const reason = getRefundReasonForLineItem(lineItem, refunds.length);
    if (!reason) continue;
    usedLineItems.add(lineItem.id);
    const result = await createRefund(context, order, lineItem, reason, currencyCode);
    if (result?.id) refunds.push({ orderId: order.id, orderName: order.name, lineItemId: lineItem.id, ...reason, id: result.id });
  }

  return { returns, refunds };
}

function getReturnReasonForLineItem(lineItem, count) {
  if (lineItem.productKey === "travel-mug-leak" && count % 2 === 0) {
    return { returnReason: "OTHER", note: "Other: The lid leaks inside my bag and I am afraid to use it near electronics.", theme: "leak" };
  }
  if (lineItem.productKey === "night-watch-print" && count % 3 === 0) {
    return { returnReason: "OTHER", note: "Other: It scares me more than nothing. The faces feel unsettling in the room.", theme: "fear" };
  }
  if (lineItem.productKey === "linen-shirt-fit" && lineItem.variantTitle?.includes("M")) {
    return { returnReason: "SIZE_TOO_SMALL", note: "Medium runs small around shoulders and sleeves.", theme: "fit" };
  }
  if (lineItem.productKey === "earbuds-color" && lineItem.variantTitle?.toLowerCase().includes("rose")) {
    return { returnReason: "COLOR", note: "Rose color looks copper and not like the product images.", theme: "color" };
  }
  if (lineItem.productKey === "soft-yoga-mat" && count % 4 === 0) {
    return { returnReason: "OTHER", note: "Too soft for balance poses; expected a firmer yoga surface.", theme: "softness" };
  }
  return null;
}

function getRefundReasonForLineItem(lineItem, count) {
  if (lineItem.productKey === "ceramic-dinner-set") {
    return { note: "Refunded because one bowl arrived cracked. Packaging needs QA review.", theme: "damage", quantity: Math.min(1, lineItem.quantity) };
  }
  if (lineItem.productKey === "travel-mug-leak" && count % 3 === 0) {
    return { note: "Partial refund for leaking lid reported before return was requested.", theme: "leak", quantity: 1 };
  }
  if (lineItem.productKey === "smart-planter" && count % 4 === 0) {
    return { note: "Refunded after app compatibility confusion with 5 GHz Wi-Fi.", theme: "compatibility", quantity: 1 };
  }
  return null;
}

async function createReturn(context, order, lineItem, reason) {
  try {
    const data = await shopifyGraphql(context.admin, `#graphql
      mutation ProductPulseCreateMockReturn($returnInput: ReturnInput!) {
        returnCreate(returnInput: $returnInput) {
          return {
            id
          }
          userErrors { field message }
        }
      }
    `, {
      returnInput: {
        orderId: order.id,
        returnLineItems: [{
          fulfillmentLineItemId: lineItem.fulfillmentLineItemId,
          quantity: Math.min(1, lineItem.quantity || 1),
          returnReason: reason.returnReason,
          returnReasonNote: reason.note,
        }],
      },
    });
    const errors = data?.returnCreate?.userErrors || [];
    if (errors.length) throw new Error(formatUserErrors(errors));
    return data?.returnCreate?.return || null;
  } catch (error) {
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      level: "warning",
      event: "mock_dataset.return_failed",
      message: "A mock return could not be created. The dataset continues with remaining records.",
      data: { order: order.name, lineItem: lineItem.title, reason, error: serializeError(error) },
    });
    return null;
  }
}

async function createRefund(context, order, lineItem, reason, currencyCode) {
  try {
    const data = await shopifyGraphql(context.admin, `#graphql
      mutation ProductPulseCreateMockRefund($input: RefundInput!, $idempotencyKey: String!) {
        refundCreate(input: $input) @idempotent(key: $idempotencyKey) {
          refund {
            id
            note
            totalRefundedSet {
              presentmentMoney {
                amount
                currencyCode
              }
            }
          }
          userErrors { field message }
        }
      }
    `, {
      idempotencyKey: randomUUID(),
      input: {
        orderId: order.id,
        note: reason.note,
        notify: false,
        currency: currencyCode,
        refundLineItems: [{
          lineItemId: lineItem.id,
          quantity: Math.min(reason.quantity || 1, lineItem.quantity || 1),
          restockType: "NO_RESTOCK",
        }],
        transactions: [],
      },
    });
    const errors = data?.refundCreate?.userErrors || [];
    if (errors.length) throw new Error(formatUserErrors(errors));
    return data?.refundCreate?.refund || null;
  } catch (error) {
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      level: "warning",
      event: "mock_dataset.refund_failed",
      message: "A mock refund could not be created. The dataset continues with remaining records.",
      data: { order: order.name, lineItem: lineItem.title, reason, error: serializeError(error) },
    });
    return null;
  }
}

function buildReviewRows(products, createdAt) {
  let sourceRow = 2;
  return products.flatMap((product) => {
    const rows = [];
    const count = product.reviewProfile.count;
    for (let index = 0; index < count; index += 1) {
      const ageDays = Math.round(295 - (index / Math.max(1, count - 1)) * 285);
      const date = new Date(createdAt.getTime() - ageDays * 24 * 60 * 60 * 1000);
      const negative = shouldMakeNegativeReview(product, index);
      const rating = getReviewRating(product, index, negative);
      const text = getReviewText(product, index, negative);
      rows.push({
        source_row: sourceRow++,
        product_handle: product.handle,
        shopify_product_id: product.id,
        rating,
        review_title: negative ? getNegativeReviewTitle(product) : getPositiveReviewTitle(product),
        review_body: text,
        review_date: date.toISOString(),
        reviewer_name: `Mock Reviewer ${sourceRow - 2}`,
        review_status: "published",
        source_product_id: product.key,
      });
    }
    return rows;
  });
}

function shouldMakeNegativeReview(product, index) {
  const threshold = Math.round(product.reviewProfile.count * product.reviewProfile.negativeRate);
  if (product.key === "premium-keyboard" && index > product.reviewProfile.count - 10) return false;
  if (product.key === "travel-mug-leak" && index > 8) return index % 2 === 0 || index % 5 === 0;
  return index < threshold;
}

function getReviewRating(product, index, negative) {
  if (!negative) return index % 7 === 0 ? 4 : 5;
  if (product.key === "travel-mug-leak" || product.key === "night-watch-print") return index % 3 === 0 ? 1 : 2;
  return index % 2 === 0 ? 2 : 3;
}

function getNegativeReviewTitle(product) {
  const titles = {
    "night-watch-print": "It feels unsettling",
    "travel-mug-leak": "The lid leaks",
    "soft-yoga-mat": "Too soft for balance",
    "earbuds-color": "Color does not match",
    "smart-planter": "Setup was confusing",
    "linen-shirt-fit": "Sizing runs small",
    "ceramic-dinner-set": "Arrived broken",
    "desk-fan-mismatch": "Wrong review feed",
  };
  return titles[product.key] || "Not what I expected";
}

function getPositiveReviewTitle(product) {
  if (product.key === "premium-keyboard") return "Excellent build quality";
  if (product.key === "puzzle-calm") return "Clear listing and great gift";
  return "Good product overall";
}

function getReviewText(product, index, negative) {
  if (!negative) {
    const positives = {
      "puzzle-calm": "Everything was clear: piece count, poster and finished size. Relaxing puzzle and no surprises.",
      "premium-keyboard": "Solid aluminum build, switches feel premium and the listing explained exactly what was included.",
      "soft-yoga-mat": "Very cushioned and comfortable for stretching. The soft feel is exactly what I wanted.",
      "ceramic-dinner-set": "The glaze is beautiful and the set looks premium when it arrives safely.",
    };
    return positives[product.key] || `The product matched the listing. ${product.themes[0]} and ${product.themes[1]} were as expected.`;
  }
  const negativeTexts = {
    "night-watch-print": [
      "The artwork scares me more than I expected. It feels dark and unsettling in a bedroom.",
      "I thought it would look museum-like, but the faces feel creepy and intense.",
      "The print is not defective, but the mood is too frightening for our room.",
    ],
    "travel-mug-leak": [
      "The lid leaks into my bag. Calling it leakproof is not accurate.",
      "Coffee spilled near my laptop because the seal failed during commute.",
      "The mug looks nice but the cap drips every time I tilt it.",
    ],
    "soft-yoga-mat": [
      "It is too soft for balance poses. I expected more firmness for yoga.",
      "The cushion is thick but unstable for transitions.",
    ],
    "earbuds-color": [
      "The Rose color looks copper in person and not like the product photo.",
      "Color is different from the pictures, so I returned the Rose variant.",
    ],
    "smart-planter": [
      "Setup was confusing because the app and Wi-Fi requirements were not obvious enough.",
      "The app is English only and I missed that before buying.",
    ],
    "linen-shirt-fit": [
      "Medium runs small in the shoulders and sleeves.",
      "I usually wear M, but this fit like a small.",
    ],
    "ceramic-dinner-set": [
      "One bowl arrived cracked and the box did not protect the set enough.",
      "Beautiful product but packaging damage made it unusable.",
    ],
    "desk-fan-mismatch": [
      "This review talks about snowboard bindings and boots, not a fan. Something is mismatched.",
      "I bought this little desk fan, but reviews mention snow conditions and boards.",
    ],
  };
  const options = negativeTexts[product.key] || [`The product had issues with ${product.themes.join(", ")}.`];
  return options[index % options.length];
}

async function saveMockCsvReviewSource({ shop, runId, rows }) {
  const storageRoot = process.env.PRODUCT_PULSE_CSV_STORAGE_DIR
    || path.join(process.cwd(), ".cache", "product-pulse", "csv-reviews");
  const shopDir = path.join(storageRoot, sanitizeStorageSegment(shop || "unknown-shop"));
  const fileName = `mock-reviews-${runId}.normalized.csv`;
  const filePath = path.join(shopDir, fileName);
  const text = serializeCsvRows(rows);
  const checksum = createHash("sha256").update(text).digest("hex");

  await mkdir(shopDir, { recursive: true });
  await writeFile(filePath, text, "utf8");

  await prisma.productPulseSource.upsert({
    where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
    create: {
      shop,
      sourceKey: "csvReviews",
      category: "reviews",
      name: "CSV reviews",
      connected: true,
      active: true,
      available: true,
      health: "connected",
      coverageWeight: 18,
      connectedAt: new Date(),
      lastSyncedAt: new Date(),
      config: {
        displayFileName: GENERATED_REVIEW_SOURCE,
        normalizedFileName: fileName,
        normalizedFilePath: filePath,
        normalizedRowCount: rows.length,
        importId: runId,
        storageKey: sanitizeStorageSegment(shop || "unknown-shop"),
        checksum,
        uploadedAt: new Date().toISOString(),
        generatedBy: SHOPIFY_MOCK_DATASET_KIND,
      },
    },
    update: {
      connected: true,
      active: true,
      available: true,
      health: "connected",
      lastSyncedAt: new Date(),
      config: {
        displayFileName: GENERATED_REVIEW_SOURCE,
        normalizedFileName: fileName,
        normalizedFilePath: filePath,
        normalizedRowCount: rows.length,
        importId: runId,
        storageKey: sanitizeStorageSegment(shop || "unknown-shop"),
        checksum,
        uploadedAt: new Date().toISOString(),
        generatedBy: SHOPIFY_MOCK_DATASET_KIND,
      },
    },
  });

  return { filePath, fileName, rowCount: rows.length, checksum };
}

async function saveMockDatasetManifest({ shop, runId, createdAt, products, orders, outcomes, reviewRows, reviewSource, orderDelayMs }) {
  const storageRoot = process.env.PRODUCT_PULSE_MOCK_DATASET_DIR
    || path.join(process.cwd(), ".cache", "product-pulse", "mock-datasets");
  const shopDir = path.join(storageRoot, sanitizeStorageSegment(shop || "unknown-shop"));
  const manifestPath = path.join(shopDir, `${runId}.manifest.json`);
  const productDocs = products.map((product) => ({
    title: product.title,
    handle: product.handle,
    shopifyProductId: product.id,
    story: product.story,
    expectedFindings: product.expectedFindings,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
    })),
    orderUnits: orders.flatMap((order) => order.lineItems)
      .filter((lineItem) => lineItem.productKey === product.key)
      .reduce((sum, lineItem) => sum + Number(lineItem.quantity || 0), 0),
    returns: outcomes.returns.filter((item) => item.theme && orders.some((order) => (
      order.id === item.orderId && order.lineItems.some((lineItem) => lineItem.productKey === product.key)
    ))).length,
    refunds: outcomes.refunds.filter((item) => orders.some((order) => (
      order.id === item.orderId && order.lineItems.some((lineItem) => lineItem.productKey === product.key)
    ))).length,
    reviews: reviewRows.filter((row) => row.source_product_id === product.key).length,
    expectedThemes: product.themes,
  }));

  const summary = {
    runId,
    generatedAt: createdAt.toISOString(),
    productCount: products.length,
    orderCount: orders.length,
    returnCount: outcomes.returns.length,
    refundCount: outcomes.refunds.length,
    reviewCount: reviewRows.length,
    csvReviewFilePath: reviewSource.filePath,
    manifestPath,
    orderCreateDelayMs: orderDelayMs,
    requiredScopes: REQUIRED_SHOPIFY_MOCK_DATASET_SCOPES,
    products: productDocs,
  };

  await mkdir(shopDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(summary, null, 2), "utf8");
  return { summary, manifestPath };
}

async function getShopInfo(admin) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseMockShopInfo {
      shop {
        currencyCode
      }
    }
  `);
  return {
    currencyCode: data?.shop?.currencyCode || "USD",
  };
}

async function getPrimaryLocation(admin) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseMockPrimaryLocation {
      locations(first: 1) {
        nodes {
          id
          name
        }
      }
    }
  `).catch(() => null);
  return data?.locations?.nodes?.[0] || null;
}

async function updateProgress(context, progress, source, data = null) {
  await context.onProgress(progress, source, data);
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

function assertNoUserErrors(errors, label) {
  if (!Array.isArray(errors) || !errors.length) return;
  throw new Error(`${label}: ${formatUserErrors(errors)}`);
}

function formatUserErrors(errors) {
  return errors.map((error) => {
    const field = Array.isArray(error.field) ? error.field.join(".") : error.field;
    return [field, error.message].filter(Boolean).join(": ");
  }).join("; ");
}

function stripNullish(value) {
  if (Array.isArray(value)) return value.map(stripNullish);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => [key, stripNullish(item)]));
}

function buildAddress(index) {
  return {
    firstName: "Mock",
    lastName: `Customer ${index + 1}`,
    address1: `${100 + index} Test Dataset Ave`,
    city: "Austin",
    provinceCode: "TX",
    countryCode: "US",
    zip: "78701",
  };
}

function buildRunId() {
  return `mock-${new Date().toISOString().replace(/[^0-9]+/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function getOrderCreateDelayMs() {
  const configured = Number(process.env.PRODUCT_PULSE_MOCK_ORDER_DELAY_MS);
  if (Number.isFinite(configured) && configured >= 0) return Math.max(0, configured);
  return MIN_ORDER_CREATE_DELAY_MS;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeStorageSegment(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "unknown";
}
