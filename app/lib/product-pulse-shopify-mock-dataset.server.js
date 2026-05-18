import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import prisma from "../db.server";
import { serializeCsvRows } from "./product-pulse-csv.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";

export const SHOPIFY_MOCK_DATASET_KIND = "shopify-mock-dataset";
export const SHOPIFY_MOCK_DATASET_SOURCE_KEY = "mockDataset";
export const SHOPIFY_MOCK_DATASET_STAGES = [
  "all",
  "products",
  "orders",
  "outcomes",
  "reviews",
  "manifest",
];
export const SHOPIFY_MOCK_DATASET_STAGE_LABELS = {
  all: "Run remaining setup",
  products: "Create products",
  orders: "Create orders",
  outcomes: "Create returns and refunds",
  reviews: "Generate CSV reviews",
  manifest: "Finalize report",
};
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
const GENERATED_ORDER_TAG = "productpulse-gen-order";
const GENERATED_REVIEW_SOURCE = "ProductPulse mock reviews";
const DEFAULT_ORDER_COUNT = 120;
const MIN_ORDER_CREATE_DELAY_MS = 12_500;
const STAGE_PROGRESS = {
  products: [5, 25],
  orders: [25, 70],
  outcomes: [70, 86],
  reviews: [86, 93],
  manifest: [93, 100],
};
const SHOPIFY_SCOPE_READ_EQUIVALENTS = {
  read_products: ["write_products"],
  read_orders: ["write_orders"],
  read_returns: ["write_returns"],
};

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
    story: "A legitimate art print that intentionally creates subjective negative reactions. The first half of the history behaves normally, then a recent paid campaign brings shoppers who did not understand the visual mood. Returns and reviews mention fear, unsettling faces and surprise, but they do not describe a physical defect.",
    orderPattern: "Low baseline demand for the first 150 days, a campaign-driven spike in the last third of the window, then moderate demand after negative subjective reactions start appearing.",
    returnRefundPattern: "Recent returns use Other with free-form notes like fear, scary, unsettling and take it away. Refunds should be rare because the product is not broken.",
    reviewPattern: "Older reviews are art-positive. Recent reviews become longer, more emotional and subjective, with fear/unease language that should not be treated as objective product failure from a single signal.",
    stressCase: "Tests whether subjective language from Other return notes is analyzed without over-escalating one emotional complaint into multiple duplicate issues.",
    expectedFindings: [
      "Subjective negative sentiment from return notes and reviews.",
      "Other return reasons with free-form notes should be analyzed.",
      "Expectation-setting note should be suggested, not a defect-only conclusion.",
    ],
    expectedActions: [
      "Add expectation-setting note.",
      "Add product FAQ explaining mood, framing and room-fit expectations.",
      "Avoid QA/supplier escalation unless evidence volume becomes very high.",
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
    story: "A well-built control product with clear copy, stable demand, low returns and positive reviews. It is the clean baseline product in the dataset and should make unnecessary recommendations look suspicious.",
    orderPattern: "Stable orders across the full 300-day window with small gift-season bumps and repeat multi-unit orders.",
    returnRefundPattern: "Very low return/refund activity, mostly isolated and not thematically repeated.",
    reviewPattern: "Consistently positive reviews that mention clear piece count, finished size and included poster. A tiny number of neutral reviews should not move risk materially.",
    stressCase: "Tests whether the app avoids manufacturing content rewrite actions when a product is already clear and customer sentiment is positive.",
    expectedFindings: [
      "Low product risk.",
      "Positive or neutral sentiment should dominate.",
      "The app should avoid unnecessary rewrite actions.",
    ],
    expectedActions: [
      "No urgent action.",
      "Optional baseline/watchlist only if momentum is high.",
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
    story: "A high-risk product where sales initially grow because the listing says leakproof, then return/refund pressure rises after customers use it during commutes. The underlying issue is a promise mismatch plus possible lid QA problem.",
    orderPattern: "Strong early and mid-window demand, then slower recent demand as negative reviews accumulate.",
    returnRefundPattern: "Returns start in the middle of the window and intensify recently. Refunds are partial and full, often before a formal return, with notes about leaking lids, bags and electronics.",
    reviewPattern: "Early reviews are positive about insulation. Later reviews become long, specific and angry about leakage, wet bags and the word leakproof being misleading.",
    stressCase: "Tests whether repeated returns plus refunds plus claim mismatch can push Product Risk high, without double-counting the same leak signal into many duplicated issues.",
    expectedFindings: [
      "High return/refund pressure.",
      "Repeated language around leaks, lid, bag and spills.",
      "Recommendation should clarify limits or trigger QA/supplier review.",
    ],
    expectedActions: [
      "Rewrite product description or remove/qualify leakproof claim.",
      "Supplier / QA review.",
      "Add internal risk tags.",
      "Consider status/availability change only if confidence is high.",
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
    story: "A polarizing product with a deliberately subjective softness tradeoff. Some customers love the cushion; others return it because it is too soft for balance work. The product is not objectively broken.",
    orderPattern: "Steady orders with a January fitness bump and a mild recent decline.",
    returnRefundPattern: "Small but repeated returns using Other or Not as described language around too soft, unstable and balance poses.",
    reviewPattern: "Mixed sentiment throughout the year. Positive reviews praise cushion; negative reviews are subjective and should only gain severity when repeated.",
    stressCase: "Tests subjective-only issue handling: one or two softness comments should remain low confidence, repeated comments should become a medium-risk expectation mismatch.",
    expectedFindings: [
      "Medium risk from repeated but subjective softness feedback.",
      "Confidence should rise only with multiple signals.",
      "Recommendation should add expectation guidance, not overstate defect.",
    ],
    expectedActions: [
      "Add expectation-setting note.",
      "Add specs/details block about firmness and intended use.",
      "Avoid high-risk QA action unless returns accelerate.",
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
    story: "A variant-specific appearance issue. The product is healthy overall, but the Rose variant looks copper in person and produces concentrated color returns and negative reviews.",
    orderPattern: "Healthy launch, then Rose becomes the popular variant after a promotion. Black and Blue remain stable and low risk.",
    returnRefundPattern: "Returns are concentrated on Rose with Color reason. Partial refunds are uncommon; most customers return the variant.",
    reviewPattern: "Review sentiment is split by variant: positive for sound and battery, negative for Rose color accuracy and product photos.",
    stressCase: "Tests whether variant concentration is detected instead of marking the whole product as equally defective.",
    expectedFindings: [
      "Variant concentration should identify the Rose variant.",
      "Color/appearance should appear in customer language and return reasons.",
      "Recommended action should focus on media or variant clarity.",
    ],
    expectedActions: [
      "Reorder product media or add contextual media recommendation.",
      "Update Rose variant guidance / alt text.",
      "Fix variant names/options only if current label is ambiguous.",
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
    story: "A compatibility clarity problem. The kit works, but buyers miss that the app is English-only and setup requires 2.4 GHz Wi-Fi. The issue is strongest early, then improves once clearer reviews appear.",
    orderPattern: "Moderate seasonal demand around spring planting, with mixed kit variants.",
    returnRefundPattern: "Refunds and returns cluster around app setup and Wi-Fi compatibility, not physical damage.",
    reviewPattern: "Long setup reviews mention app language, 5 GHz Wi-Fi, router configuration and unclear setup expectations.",
    stressCase: "Tests whether compatibility details trigger FAQ/spec guidance rather than generic description rewrite.",
    expectedFindings: [
      "Compatibility questions should trigger FAQ/spec guidance.",
      "Reviews mention app setup, language and Wi-Fi confusion.",
      "Not primarily a defect; PDP clarity should be recommended.",
    ],
    expectedActions: [
      "Add product FAQ.",
      "Add specs/details block.",
      "Rewrite meta/SEO only if SEO fields are weak.",
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
    story: "A variant and sizing problem. Size M in White runs small while other variants are mostly fine, so the app should find concentration rather than broad product failure.",
    orderPattern: "Seasonal apparel demand rises in the recent warm-weather phase. Size M White is overrepresented in recent orders.",
    returnRefundPattern: "Returns concentrate on Size M / White with Size too small notes. Other sizes have lower return activity.",
    reviewPattern: "Reviews mention shoulders, sleeves, shrink after wash and confusion with relaxed fit wording.",
    stressCase: "Tests variant-specific return-rate math with multi-variant products and quantities, ensuring return rates never exceed 100%.",
    expectedFindings: [
      "Fit/size return reasons concentrated on one variant.",
      "Recommendation should add sizing guidance or fix variant names/options.",
      "Variant score should be non-zero because there are multiple variants.",
    ],
    expectedActions: [
      "Add specs/details block with fit guidance.",
      "Fix variant names/options if Shopify option labels are too terse.",
      "Pause affected variant only if risk and confidence are high.",
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
    story: "An operational damage pattern. Customers generally like the dinner set, but a mid-window packaging problem causes broken bowls and refund pressure. Recent reviews should show partial recovery after packaging improves.",
    orderPattern: "Holiday/gift-season spike, then steady smaller demand.",
    returnRefundPattern: "Refunds are more important than returns because customers receive broken pieces and support issues partial refunds. The issue should contribute financially but not be confused with buyer dislike.",
    reviewPattern: "Positive product sentiment coexists with damage complaints; recent reviews say packaging improved.",
    stressCase: "Tests whether refunds are processed as product evidence with lower weight than returns and whether sentiment separates product appeal from fulfillment damage.",
    expectedFindings: [
      "Refund pressure and QA/fulfillment review should be visible.",
      "Sentiment should separate product appeal from damage complaints.",
      "Supplier/QA or packaging review should be a strong operational action.",
    ],
    expectedActions: [
      "Supplier / QA review.",
      "Create internal support note.",
      "Add workflow tags such as qa-review-needed.",
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
    story: "A data integrity trap. The Shopify product and orders are normal for a desk fan, but the CSV review feed intentionally mixes in snowboard/boot language as if reviews were mapped to the wrong product.",
    orderPattern: "Low, steady desk accessory orders with no major return pattern.",
    returnRefundPattern: "Minimal returns/refunds; the risk should come from review source integrity, not native Shopify order evidence.",
    reviewPattern: "Older reviews sound like a fan. Recent CSV reviews abruptly mention snowboard, boots, bindings and snow conditions.",
    stressCase: "Tests whether the app identifies source/review mismatch and avoids rewriting the product description based on unrelated review text.",
    expectedFindings: [
      "Review/source mismatch should be detected.",
      "The app should recommend source integrity verification instead of rewriting good fan copy.",
      "Customer language should not overfit unrelated product words.",
    ],
    expectedActions: [
      "Fix source/review mismatch.",
      "Open evidence or check review feed integrity.",
      "Avoid customer-facing PDP rewrite unless native product data also supports it.",
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
    story: "A commercially important product with rising sales, high momentum and mostly positive reviews. It should enter the app through momentum even without high risk.",
    orderPattern: "Slow launch, then accelerating recent sales with occasional multi-unit purchases.",
    returnRefundPattern: "Very low returns/refunds; maybe a rare price/value complaint but no repeated defect.",
    reviewPattern: "Recent reviews are longer and enthusiastic about build quality, switches and included accessories. A few customers mention price but not enough to create high risk.",
    stressCase: "Tests momentum-based inclusion and Watchlist suggestions without contaminating Product Risk.",
    expectedFindings: [
      "High momentum / low risk.",
      "Add to Watchlist or baseline scan should be reasonable.",
      "No aggressive PDP rewrite should be recommended.",
    ],
    expectedActions: [
      "Add to Watchlist.",
      "Create baseline scan or run full diagnosis if QuickScan only.",
      "No urgent customer-facing fix.",
    ],
    themes: ["premium", "solid", "switches", "fast shipping"],
    reviewProfile: { count: 44, negativeRate: 0.1, average: 4.5 },
  },
];

export function getMissingShopifyMockDatasetScopes(scopeString) {
  const granted = new Set(String(scopeString || "").split(",").map((scope) => scope.trim()).filter(Boolean));
  return REQUIRED_SHOPIFY_MOCK_DATASET_SCOPES.filter((scope) => !hasShopifyScope(granted, scope));
}

function hasShopifyScope(granted, scope) {
  if (granted.has(scope)) return true;
  return (SHOPIFY_SCOPE_READ_EQUIVALENTS[scope] || []).some((equivalentScope) => granted.has(equivalentScope));
}

export function normalizeShopifyMockDatasetStage(stage) {
  const normalized = String(stage || "all").trim().toLowerCase();
  return SHOPIFY_MOCK_DATASET_STAGES.includes(normalized) ? normalized : "all";
}

function shouldRunMockDatasetStage(requestedStage, stage) {
  return requestedStage === "all" || requestedStage === stage;
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

export async function runShopifyMockDatasetJob({ shop, admin, jobId, stage = "all", onProgress }) {
  if (!shop || !admin?.graphql) throw new Error("Shopify Admin client is required to create the mock dataset.");
  const requestedStage = normalizeShopifyMockDatasetStage(stage);
  const existingSource = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: SHOPIFY_MOCK_DATASET_SOURCE_KEY } },
  }).catch(() => null);
  const existingConfig = existingSource?.config || {};
  const runId = existingConfig.runId || buildRunId();
  const runSuffix = runId.slice(-8);
  const createdAt = existingConfig.generatedAt ? new Date(existingConfig.generatedAt) : new Date();
  const orderDelayMs = getOrderCreateDelayMs();
  const context = {
    shop,
    admin,
    jobId,
    runId,
    runSuffix,
    createdAt,
    requestedStage,
    onProgress: typeof onProgress === "function" ? onProgress : async () => {},
  };

  await updateMockDatasetState(context, {
    runId,
    generatedAt: createdAt.toISOString(),
    status: "running",
    lastRequestedStage: requestedStage,
  });
  await recordJobLog({
    shop,
    jobId,
    event: "mock_dataset.stage_requested",
    message: `Mock dataset stage requested: ${requestedStage}.`,
    data: { stage: requestedStage, runId },
  });

  await updateProgress(context, 3, `Preparing Shopify mock dataset stage: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[requestedStage]}.`);
  const shopInfo = await getShopInfo(admin);
  const location = await getPrimaryLocation(admin);
  let products = await loadOrCreateMockProducts(context, location, shopInfo.currencyCode, {
    createMissing: shouldRunMockDatasetStage(requestedStage, "products"),
  });

  let orders = [];
  if (shouldRunMockDatasetStage(requestedStage, "orders")) {
    await updateProgress(context, 25, `Creating or resuming ${DEFAULT_ORDER_COUNT} historical Shopify orders.`);
    orders = await loadOrCreateMockOrders(context, products, location, shopInfo.currencyCode, orderDelayMs);
  } else if (["outcomes", "manifest", "all"].includes(requestedStage)) {
    orders = await loadExistingMockOrders(context, products, shopInfo.currencyCode);
  }

  let outcomes = await getStoredMockDatasetOutcomes(shop);
  if (shouldRunMockDatasetStage(requestedStage, "outcomes")) {
    if (!orders.length) orders = await loadExistingMockOrders(context, products, shopInfo.currencyCode);
    await markMockDatasetStageRunning(context, "outcomes");
    await updateProgress(context, 72, "Creating or resuming returns and refunds from selected fulfilled line items.");
    outcomes = await createMockReturnsAndRefunds(context, orders, shopInfo.currencyCode, {
      existingOutcomes: outcomes,
      onOutcome: async (nextOutcomes) => {
        await updateMockDatasetState(context, {
          returnCount: nextOutcomes.returns.length,
          refundCount: nextOutcomes.refunds.length,
          outcomes: nextOutcomes,
        });
      },
    });
    await markMockDatasetStageComplete(context, "outcomes", {
      returnCount: outcomes.returns.length,
      refundCount: outcomes.refunds.length,
      outcomes,
    });
  }

  let reviewRows = [];
  let reviewSource = null;
  if (shouldRunMockDatasetStage(requestedStage, "reviews")) {
    await markMockDatasetStageRunning(context, "reviews");
    await updateProgress(context, 86, "Writing normalized CSV review dataset.");
    reviewRows = buildReviewRows(products, createdAt);
    reviewSource = await saveMockCsvReviewSource({ shop, runId, rows: reviewRows });
    await markMockDatasetStageComplete(context, "reviews", {
      reviewCount: reviewRows.length,
      csvReviewFilePath: reviewSource.filePath,
      csvReviewFileName: reviewSource.fileName,
      csvReviewChecksum: reviewSource.checksum,
    });
  } else {
    reviewRows = buildReviewRows(products, createdAt);
    reviewSource = await getStoredMockDatasetReviewSource(shop);
  }

  let summary = await getCurrentMockDatasetSummary(shop, {
    runId,
    createdAt,
    products,
    orders,
    outcomes,
    reviewRows,
    reviewSource,
    orderDelayMs,
  });
  if (shouldRunMockDatasetStage(requestedStage, "manifest")) {
    if (!orders.length) orders = await loadExistingMockOrders(context, products, shopInfo.currencyCode);
    await markMockDatasetStageRunning(context, "manifest");
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
    summary = manifest.summary;
    await markMockDatasetStageComplete(context, "manifest", {
      manifestPath: manifest.manifestPath,
      ...summary,
    });
  }

  await recordJobLog({
    shop,
    jobId,
    event: "mock_dataset.stage_completed",
    message: `Mock dataset stage completed: ${requestedStage}.`,
    data: summary,
  });

  await updateMockDatasetState(context, { status: "ready", lastCompletedStage: requestedStage });
  await updateProgress(context, 100, `Shopify mock dataset stage completed: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[requestedStage]}.`, summary);
  return summary;
}

async function loadOrCreateMockProducts(context, location, currencyCode, { createMissing = false, recordStage = createMissing } = {}) {
  if (recordStage) await markMockDatasetStageRunning(context, "products");
  const existingProducts = await fetchGeneratedProducts(context.admin, currencyCode);
  const existingByTitle = new Map(existingProducts.map((product) => [product.title, product]));
  const products = [];
  const missing = [];

  for (const productSpec of MOCK_PRODUCTS) {
    const existing = existingByTitle.get(productSpec.title);
    if (existing) {
      products.push(normalizeExistingMockProduct(productSpec, existing, currencyCode));
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        event: "mock_dataset.product_reused",
        message: `Reused existing GEN product: ${productSpec.title}.`,
        data: { productId: existing.id, handle: existing.handle },
      });
      continue;
    }

    if (!createMissing) {
      missing.push(productSpec.title);
      continue;
    }

    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.product_create_started",
      message: `Creating GEN product: ${productSpec.title}.`,
      data: { key: productSpec.key, variants: productSpec.variants.length },
    });
    let createdProduct;
    try {
      createdProduct = await createMockProduct(context, productSpec, location, currencyCode);
    } catch (error) {
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        level: "error",
        event: "mock_dataset.product_create_failed",
        message: `Failed creating GEN product: ${productSpec.title}.`,
        data: { key: productSpec.key, error: serializeError(error) },
      });
      throw error;
    }
    products.push(createdProduct);
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.product_created",
      message: `Created GEN product: ${createdProduct.title}.`,
      data: { productId: createdProduct.id, handle: createdProduct.handle, variants: createdProduct.variants.length },
    });
    if (recordStage) await updateProgressForStage(context, "products", products.length, MOCK_PRODUCTS.length, `Prepared ${products.length} of ${MOCK_PRODUCTS.length} GEN products.`);
  }

  if (missing.length) {
    throw new Error(`Mock dataset products are missing. Run the products stage first: ${missing.join(", ")}`);
  }

  if (recordStage) await markMockDatasetStageComplete(context, "products", {
    productCount: products.length,
    products: products.map(serializeProductForState),
  });
  return products;
}

async function fetchGeneratedProducts(admin, currencyCode) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseGeneratedProducts($query: String!) {
      products(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          title
          handle
          productType
          vendor
          status
          tags
          options {
            id
            name
            position
            values
          }
          variants(first: 50) {
            nodes {
              id
              title
              price
              sku
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
    }
  `, { query: `tag:${GENERATED_TAG}` }, "Fetch existing GEN products");
  return (data?.products?.nodes || [])
    .filter((product) => product.title?.startsWith("GEN ") && product.status !== "ARCHIVED")
    .map((product) => ({ ...product, currencyCode }));
}

function normalizeExistingMockProduct(spec, product, currencyCode) {
  return {
    ...spec,
    id: product.id,
    handle: product.handle,
    title: product.title,
    currencyCode,
    variants: (product.variants?.nodes || []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: String(variant.price || "0"),
      sku: variant.sku,
      selectedOptions: variant.selectedOptions || [],
      productKey: spec.key,
    })),
  };
}

function serializeProductForState(product) {
  return {
    key: product.key,
    id: product.id,
    title: product.title,
    handle: product.handle,
    variants: (product.variants || []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
    })),
  };
}

async function loadOrCreateMockOrders(context, products, location, currencyCode, orderDelayMs) {
  await markMockDatasetStageRunning(context, "orders");
  const orderPlans = buildOrderPlans(products, currencyCode);
  const existingOrders = await fetchGeneratedOrders(context.admin, products, orderPlans, currencyCode);
  const existingByEmail = new Map(existingOrders.map((order) => [order.plan?.email, order]).filter(([email]) => email));
  const orders = [];
  let createdCount = 0;
  let reusedCount = 0;

  for (let index = 0; index < orderPlans.length; index += 1) {
    const plan = orderPlans[index];
    const existing = existingByEmail.get(plan.email);
    if (existing) {
      orders.push(existing);
      reusedCount += 1;
      if (index % 10 === 0) {
        await recordJobLog({
          shop: context.shop,
          jobId: context.jobId,
          event: "mock_dataset.order_reused",
          message: `Reused existing mock order ${index + 1} of ${orderPlans.length}.`,
          data: { orderName: existing.name, email: plan.email, phase: plan.phase },
        });
      }
    } else {
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        event: "mock_dataset.order_create_started",
        message: `Creating mock order ${index + 1} of ${orderPlans.length}.`,
        data: {
          email: plan.email,
          phase: plan.phase,
          itemCount: plan.items.length,
          total: plan.total,
        },
      });
      let createdOrder;
      try {
        createdOrder = await createMockOrder(context, plan, location, currencyCode);
      } catch (error) {
        await recordJobLog({
          shop: context.shop,
          jobId: context.jobId,
          level: "error",
          event: "mock_dataset.order_create_failed",
          message: `Failed creating mock order ${index + 1} of ${orderPlans.length}.`,
          data: {
            email: plan.email,
            phase: plan.phase,
            itemCount: plan.items.length,
            total: plan.total,
            error: serializeError(error),
          },
        });
        throw error;
      }
      orders.push(createdOrder);
      createdCount += 1;
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        event: "mock_dataset.order_created",
        message: `Created mock order ${index + 1} of ${orderPlans.length}.`,
        data: { orderName: createdOrder.name, orderId: createdOrder.id, email: plan.email },
      });
      if (index < orderPlans.length - 1 && orderDelayMs > 0) await wait(orderDelayMs);
    }

    await updateProgressForStage(context, "orders", index + 1, orderPlans.length, `Prepared ${index + 1} of ${orderPlans.length} historical orders.`);
    if ((index + 1) % 5 === 0 || index === orderPlans.length - 1) {
      await updateMockDatasetState(context, {
        orderCount: orders.length,
        orderCreateDelayMs: orderDelayMs,
        orderProgress: {
          expectedOrders: orderPlans.length,
          preparedOrders: orders.length,
          createdCount,
          reusedCount,
          lastOrderIndex: index + 1,
        },
      });
    }
  }

  await markMockDatasetStageComplete(context, "orders", {
    orderCount: orders.length,
    orderCreateDelayMs: orderDelayMs,
    orderProgress: {
      expectedOrders: orderPlans.length,
      preparedOrders: orders.length,
      createdCount,
      reusedCount,
      lastOrderIndex: orderPlans.length,
    },
  });
  return orders;
}

async function loadExistingMockOrders(context, products, currencyCode) {
  const plans = buildOrderPlans(products, currencyCode);
  const orders = await fetchGeneratedOrders(context.admin, products, plans, currencyCode);
  if (!orders.length) {
    throw new Error("No generated mock orders were found. Run the orders stage before creating returns, refunds or the manifest.");
  }
  await recordJobLog({
    shop: context.shop,
    jobId: context.jobId,
    event: "mock_dataset.orders_loaded",
    message: `Loaded ${orders.length} existing generated mock orders from Shopify.`,
    data: { orderCount: orders.length },
  });
  return orders;
}

async function fetchGeneratedOrders(admin, products, orderPlans, currencyCode) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseGeneratedOrders($query: String!) {
      orders(first: 250, query: $query, sortKey: PROCESSED_AT, reverse: false) {
        nodes {
          id
          name
          email
          processedAt
          note
          tags
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
      }
    }
  `, { query: `tag:${GENERATED_ORDER_TAG}` }, "Fetch existing generated mock orders");
  const plansByEmail = new Map(orderPlans.map((plan) => [plan.email, plan]));
  const productsByVariantId = new Map(products.flatMap((product) => (
    (product.variants || []).map((variant) => [variant.id, { product, variant }])
  )));
  return (data?.orders?.nodes || [])
    .map((order) => normalizeExistingMockOrder(order, plansByEmail, productsByVariantId, currencyCode))
    .filter(Boolean);
}

function normalizeExistingMockOrder(order, plansByEmail, productsByVariantId, currencyCode) {
  const plan = plansByEmail.get(order.email);
  if (!plan) return null;
  const lineItems = (order.lineItems?.nodes || []).map((lineItem) => {
    const matched = productsByVariantId.get(lineItem.variant?.id);
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
      productKey: matched?.product?.key || planItem.productKey,
      productTitle: matched?.product?.title || planItem.productTitle,
      handle: matched?.product?.handle || planItem.handle,
      sku: matched?.variant?.sku || planItem.sku,
      variantTitle: matched?.variant?.title || planItem.variantTitle,
      unitPrice: Number(matched?.variant?.price || planItem.unitPrice || 0),
    };
  });
  return {
    id: order.id,
    name: order.name,
    processedAt: order.processedAt,
    transactions: order.transactions || [],
    lineItems,
    plan: { ...plan, currencyCode },
  };
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
  `, { product: productInput }, `Create product ${spec.title}`);
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
    }, `Create variants for ${spec.title}`);
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

  return Array.from({ length: DEFAULT_ORDER_COUNT }, (_, index) => {
    const progress = index / Math.max(1, DEFAULT_ORDER_COUNT - 1);
    const date = new Date(start + index * step + (index % 9) * 60 * 60 * 1000);
    const primary = byKey.get(getPrimaryProductKeyForOrder(index, progress));
    const bundledProducts = getSecondaryProductKeysForOrder(index, progress)
      .map((key) => byKey.get(key))
      .filter(Boolean);
    const items = [primary, ...bundledProducts].filter(Boolean).map((product, itemIndex) => {
      const variant = pickVariantForOrder(product, index + itemIndex);
      return {
        productKey: product.key,
        productTitle: product.title,
        handle: product.handle,
        variantId: variant.id,
        variantTitle: variant.title,
        sku: variant.sku,
        quantity: getOrderQuantity(product.key, index, progress),
        unitPrice: Number(variant.price || 0),
      };
    });
    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    return {
      index,
      phase: getOrderPhase(progress),
      processedAt: date.toISOString(),
      email: `productpulse.mock.${index + 1}@example.com`,
      currencyCode,
      note: `ProductPulse generated order ${index + 1}. ${getOrderPhase(progress)} phase. Controlled mock dataset for diagnostics.`,
      tags: [GENERATED_ORDER_TAG, `run-${products[0]?.handle?.split("-").pop() || "mock"}`],
      items,
      total,
    };
  });
}

function getOrderPhase(progress) {
  if (progress < 0.25) return "baseline";
  if (progress < 0.5) return "growth";
  if (progress < 0.75) return "friction";
  return "current";
}

function getPrimaryProductKeyForOrder(index, progress) {
  const phaseCycles = {
    baseline: [
      "puzzle-calm",
      "premium-keyboard",
      "puzzle-calm",
      "smart-planter",
      "ceramic-dinner-set",
      "soft-yoga-mat",
      "desk-fan-mismatch",
      "puzzle-calm",
      "earbuds-color",
      "premium-keyboard",
    ],
    growth: [
      "travel-mug-leak",
      "linen-shirt-fit",
      "earbuds-color",
      "travel-mug-leak",
      "night-watch-print",
      "smart-planter",
      "soft-yoga-mat",
      "travel-mug-leak",
      "ceramic-dinner-set",
      "linen-shirt-fit",
    ],
    friction: [
      "travel-mug-leak",
      "ceramic-dinner-set",
      "linen-shirt-fit",
      "earbuds-color",
      "travel-mug-leak",
      "night-watch-print",
      "desk-fan-mismatch",
      "ceramic-dinner-set",
      "soft-yoga-mat",
      "smart-planter",
    ],
    current: [
      "premium-keyboard",
      "premium-keyboard",
      "night-watch-print",
      "linen-shirt-fit",
      "travel-mug-leak",
      "earbuds-color",
      "premium-keyboard",
      "puzzle-calm",
      "night-watch-print",
      "premium-keyboard",
    ],
  };
  const cycle = phaseCycles[getOrderPhase(progress)];
  return cycle[index % cycle.length];
}

function getSecondaryProductKeysForOrder(index, progress) {
  const phase = getOrderPhase(progress);
  const keys = [];
  if (index % 9 === 0) keys.push(phase === "current" ? "premium-keyboard" : "puzzle-calm");
  if (index % 14 === 0) keys.push(phase === "friction" ? "travel-mug-leak" : "soft-yoga-mat");
  if (index % 22 === 0) keys.push(phase === "growth" ? "smart-planter" : "ceramic-dinner-set");
  return [...new Set(keys)];
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

function getOrderQuantity(productKey, index, progress) {
  if (productKey === "puzzle-calm" && index % 4 === 0) return 2;
  if (productKey === "premium-keyboard" && progress > 0.7 && index % 4 === 0) return 2;
  if (productKey === "ceramic-dinner-set" && progress > 0.42 && progress < 0.72 && index % 5 === 0) return 2;
  if (productKey === "linen-shirt-fit" && progress > 0.68 && index % 8 === 0) return 2;
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
  }, `Create mock order ${plan.index + 1}`);
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

async function createMockReturnsAndRefunds(context, orders, currencyCode, { existingOutcomes = {}, onOutcome } = {}) {
  const returns = Array.isArray(existingOutcomes.returns) ? [...existingOutcomes.returns] : [];
  const refunds = Array.isArray(existingOutcomes.refunds) ? [...existingOutcomes.refunds] : [];
  const usedLineItems = new Set([...returns, ...refunds].map((outcome) => outcome.lineItemId).filter(Boolean));
  const returnTargets = new Map(Object.entries({
    "travel-mug-leak": 8,
    "night-watch-print": 6,
    "linen-shirt-fit": 6,
    "earbuds-color": 5,
    "soft-yoga-mat": 4,
    "smart-planter": 3,
    "desk-fan-mismatch": 1,
  }));
  const refundTargets = new Map(Object.entries({
    "ceramic-dinner-set": 7,
    "travel-mug-leak": 5,
    "smart-planter": 4,
    "earbuds-color": 2,
    "linen-shirt-fit": 2,
  }));
  const returnCounts = new Map(returns.map((outcome) => outcome.productKey).filter(Boolean).map((productKey) => [
    productKey,
    returns.filter((outcome) => outcome.productKey === productKey).length,
  ]));
  const refundCounts = new Map(refunds.map((outcome) => outcome.productKey).filter(Boolean).map((productKey) => [
    productKey,
    refunds.filter((outcome) => outcome.productKey === productKey).length,
  ]));
  const returnCandidates = orders.flatMap((order) => order.lineItems.map((lineItem) => ({ order, lineItem })));

  for (const candidate of returnCandidates) {
    const { order, lineItem } = candidate;
    if (returns.length >= 36) break;
    if (!lineItem.fulfillmentLineItemId || usedLineItems.has(lineItem.id)) continue;
    const target = returnTargets.get(lineItem.productKey) || 0;
    const productReturnCount = returnCounts.get(lineItem.productKey) || 0;
    if (productReturnCount >= target) continue;
    const reason = getReturnReasonForLineItem(lineItem, order, productReturnCount);
    if (!reason) continue;
    usedLineItems.add(lineItem.id);
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.return_create_started",
      message: `Creating mock return for ${lineItem.productTitle || lineItem.title}.`,
      data: { orderName: order.name, lineItemId: lineItem.id, productKey: lineItem.productKey, reason },
    });
    const result = await createReturn(context, order, lineItem, reason);
    if (result?.id) {
      returnCounts.set(lineItem.productKey, productReturnCount + 1);
      returns.push({ orderId: order.id, orderName: order.name, lineItemId: lineItem.id, productKey: lineItem.productKey, productTitle: lineItem.productTitle, ...reason, id: result.id });
      await onOutcome?.({ returns, refunds });
    }
  }

  for (const candidate of returnCandidates) {
    const { order, lineItem } = candidate;
    if (refunds.length >= 24) break;
    if (usedLineItems.has(lineItem.id)) continue;
    const target = refundTargets.get(lineItem.productKey) || 0;
    const productRefundCount = refundCounts.get(lineItem.productKey) || 0;
    if (productRefundCount >= target) continue;
    const reason = getRefundReasonForLineItem(lineItem, order, productRefundCount);
    if (!reason) continue;
    usedLineItems.add(lineItem.id);
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.refund_create_started",
      message: `Creating mock refund for ${lineItem.productTitle || lineItem.title}.`,
      data: { orderName: order.name, lineItemId: lineItem.id, productKey: lineItem.productKey, reason },
    });
    const result = await createRefund(context, order, lineItem, reason, currencyCode);
    if (result?.id) {
      refundCounts.set(lineItem.productKey, productRefundCount + 1);
      refunds.push({ orderId: order.id, orderName: order.name, lineItemId: lineItem.id, productKey: lineItem.productKey, productTitle: lineItem.productTitle, ...reason, id: result.id });
      await onOutcome?.({ returns, refunds });
    }
  }

  return { returns, refunds };
}

function getReturnReasonForLineItem(lineItem, order, productReturnCount) {
  const phase = order.plan?.phase || "baseline";
  if (lineItem.productKey === "travel-mug-leak" && phase !== "baseline") {
    const notes = [
      "Other: The lid leaks inside my bag and I am afraid to use it near electronics.",
      "Other: It says leakproof, but coffee came out during my commute and soaked my papers.",
      "Other: The seal failed after two uses. I do not trust it in a backpack.",
    ];
    return { returnReason: productReturnCount % 3 === 0 ? "OTHER" : "NOT_AS_DESCRIBED", note: notes[productReturnCount % notes.length], theme: "leak" };
  }
  if (lineItem.productKey === "night-watch-print" && ["friction", "current"].includes(phase)) {
    const notes = [
      "Other: It scares me more than nothing. The faces feel unsettling in the room.",
      "Other: The print is not damaged, but the scene feels too dark and intense for our hallway.",
      "Other: I expected museum decor, not something that makes the room feel frightening.",
    ];
    return { returnReason: "OTHER", note: notes[productReturnCount % notes.length], theme: "fear" };
  }
  if (lineItem.productKey === "linen-shirt-fit" && lineItem.variantTitle?.includes("M") && phase !== "baseline") {
    const notes = [
      "Medium runs small around shoulders and sleeves.",
      "The fit copy says relaxed, but the Medium White shirt is tight after washing.",
      "I ordered my usual Medium and could not button the chest comfortably.",
    ];
    return { returnReason: "SIZE_TOO_SMALL", note: notes[productReturnCount % notes.length], theme: "fit" };
  }
  if (lineItem.productKey === "earbuds-color" && lineItem.variantTitle?.toLowerCase().includes("rose") && phase !== "baseline") {
    return { returnReason: "COLOR", note: "Rose color looks copper and not like the product images.", theme: "color" };
  }
  if (lineItem.productKey === "soft-yoga-mat" && productReturnCount < 4) {
    return { returnReason: "OTHER", note: "Too soft for balance poses; expected a firmer yoga surface.", theme: "softness" };
  }
  if (lineItem.productKey === "smart-planter" && ["growth", "friction"].includes(phase)) {
    return { returnReason: "NOT_AS_DESCRIBED", note: "Setup requirements were not clear; I only have 5 GHz Wi-Fi and the app language confused me.", theme: "compatibility" };
  }
  if (lineItem.productKey === "desk-fan-mismatch" && phase === "current") {
    return { returnReason: "WRONG_ITEM", note: "The product is a fan, but the review context and support note I saw referred to a snowboard.", theme: "source-mismatch" };
  }
  return null;
}

function getRefundReasonForLineItem(lineItem, order, productRefundCount) {
  const phase = order.plan?.phase || "baseline";
  if (lineItem.productKey === "ceramic-dinner-set" && ["growth", "friction", "current"].includes(phase)) {
    const notes = [
      "Refunded because one bowl arrived cracked. Packaging needs QA review.",
      "Partial refund issued after customer sent photos of chipped plates from shipping damage.",
      "Refunded damaged set component; buyer liked the design but packaging failed.",
    ];
    return { note: notes[productRefundCount % notes.length], theme: "damage", quantity: Math.min(1, lineItem.quantity) };
  }
  if (lineItem.productKey === "travel-mug-leak" && ["friction", "current"].includes(phase)) {
    return { note: "Partial refund for leaking lid reported before return was requested.", theme: "leak", quantity: 1 };
  }
  if (lineItem.productKey === "smart-planter" && ["growth", "friction"].includes(phase)) {
    return { note: "Refunded after app compatibility confusion with 5 GHz Wi-Fi.", theme: "compatibility", quantity: 1 };
  }
  if (lineItem.productKey === "earbuds-color" && lineItem.variantTitle?.toLowerCase().includes("rose") && phase === "friction") {
    return { note: "Goodwill refund for Rose color mismatch after customer kept the earbuds.", theme: "color", quantity: 1 };
  }
  if (lineItem.productKey === "linen-shirt-fit" && lineItem.variantTitle?.includes("M") && phase === "current") {
    return { note: "Partial refund for Medium White fit complaint after wash shrinkage.", theme: "fit", quantity: 1 };
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
    }, `Create return for ${order.name}`);
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
    }, `Create refund for ${order.name}`);
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
      const progress = index / Math.max(1, count - 1);
      const ageDays = Math.round(295 - (index / Math.max(1, count - 1)) * 285);
      const date = new Date(createdAt.getTime() - ageDays * 24 * 60 * 60 * 1000);
      const phase = getOrderPhase(progress);
      const negative = shouldMakeNegativeReview(product, index, progress);
      const rating = getReviewRating(product, index, negative, progress);
      const text = getReviewText(product, index, negative, progress, phase);
      rows.push({
        source_row: sourceRow++,
        product_handle: product.handle,
        shopify_product_id: product.id,
        rating,
        review_title: negative ? getNegativeReviewTitle(product, progress) : getPositiveReviewTitle(product, progress),
        review_body: text,
        review_date: date.toISOString(),
        reviewer_name: `Mock Reviewer ${sourceRow - 2}`,
        review_status: "published",
        source_product_id: product.key,
        scenario_phase: phase,
      });
    }
    return rows;
  });
}

function shouldMakeNegativeReview(product, index, progress) {
  if (product.key === "puzzle-calm") return index === 11 || index === 27;
  if (product.key === "premium-keyboard") return progress < 0.25 && index % 9 === 0;
  if (product.key === "night-watch-print") return progress > 0.52 ? index % 2 === 0 || index % 5 === 0 : index % 13 === 0;
  if (product.key === "travel-mug-leak") return progress > 0.35 ? index % 2 === 0 || index % 3 === 0 : index % 8 === 0;
  if (product.key === "soft-yoga-mat") return index % 4 === 0 || (progress > 0.65 && index % 5 === 0);
  if (product.key === "earbuds-color") return progress > 0.25 && progress < 0.78 ? index % 2 === 0 : index % 11 === 0;
  if (product.key === "smart-planter") return progress > 0.18 && progress < 0.7 ? index % 2 === 0 || index % 5 === 0 : index % 10 === 0;
  if (product.key === "linen-shirt-fit") return progress > 0.42 ? index % 2 === 0 || index % 6 === 0 : index % 10 === 0;
  if (product.key === "ceramic-dinner-set") return progress > 0.35 && progress < 0.78 ? index % 2 === 0 : index % 12 === 0;
  if (product.key === "desk-fan-mismatch") return progress > 0.68 ? true : index % 10 === 0;
  const threshold = Math.round(product.reviewProfile.count * product.reviewProfile.negativeRate);
  return index < threshold;
}

function getReviewRating(product, index, negative, progress) {
  if (!negative) return index % 7 === 0 ? 4 : 5;
  if (product.key === "travel-mug-leak" && progress > 0.55) return index % 3 === 0 ? 1 : 2;
  if (product.key === "night-watch-print" && progress > 0.65) return index % 3 === 0 ? 1 : 2;
  if (product.key === "desk-fan-mismatch" && progress > 0.68) return index % 4 === 0 ? 1 : 2;
  return index % 2 === 0 ? 2 : 3;
}

function getNegativeReviewTitle(product, progress) {
  const titles = {
    "night-watch-print": progress > 0.6 ? "Beautiful but too unsettling for my room" : "Darker than expected",
    "travel-mug-leak": progress > 0.55 ? "Leakproof claim failed in my bag" : "Lid seal is questionable",
    "soft-yoga-mat": "Too soft for balance work",
    "earbuds-color": "Rose color does not match the photos",
    "smart-planter": "Wi-Fi and app requirements were not clear",
    "linen-shirt-fit": "Medium White runs small",
    "ceramic-dinner-set": progress > 0.78 ? "Packaging seems improved now" : "Arrived broken despite looking beautiful",
    "desk-fan-mismatch": progress > 0.68 ? "This review seems attached to the wrong product" : "Fan is smaller than expected",
  };
  return titles[product.key] || "Not what I expected";
}

function getPositiveReviewTitle(product, progress) {
  if (product.key === "premium-keyboard") return "Excellent build quality";
  if (product.key === "puzzle-calm") return "Clear listing and great gift";
  if (product.key === "ceramic-dinner-set" && progress > 0.78) return "Arrived safely after packaging change";
  return "Good product overall";
}

function getReviewText(product, index, negative, progress, phase) {
  if (!negative) {
    const positives = {
      "night-watch-print": phase === "baseline"
        ? "The print is dramatic in exactly the way I wanted for a reading room. The dark contrast and large figures make it feel like a museum piece, and the listing was accurate about the matte finish and no frame."
        : "Print quality and shipping were good. The mood is intense, but for a gallery wall that is what I wanted. I would still suggest showing it in a real room so shoppers understand the scale and darkness.",
      "puzzle-calm": phase === "growth"
        ? "We ordered two copies for a family weekend and both were complete. The box, reference poster, piece count and finished size matched the page, which made it easy to buy without checking support notes."
        : "Everything was clear before checkout: the 500-piece count, reference poster, resealable bag and finished size were all exactly as described. It made a calm gift and there were no surprises when we opened the box.",
      "premium-keyboard": progress > 0.65
        ? "This keyboard feels like the listing promised: heavy aluminum frame, clean RGB, clear switch choice and no missing accessories. I bought a second one for the office because the first order was exactly right."
        : "Solid aluminum build, switches feel premium and the listing explained exactly what was included.",
      "soft-yoga-mat": "Very cushioned and comfortable for stretching. The soft feel is exactly what I wanted because I use it for floor work, not fast balance transitions.",
      "earbuds-color": "Sound quality and battery are strong for the price. I ordered Black and the product matched the photos, so my experience was very different from the color complaints I see about Rose.",
      "smart-planter": progress > 0.7
        ? "After reading the setup notes carefully, the planter worked well on my 2.4 GHz network. The herbs sprouted evenly and the LED schedule was easy once the app connected."
        : "The planter looks nice on the counter and the seed pods were labeled clearly. Setup took a little time, but the kit itself felt complete.",
      "linen-shirt-fit": "The Navy large fit as expected and the linen blend is breathable. I checked the measurements before ordering, washed cold and hung it dry, and it kept the shape well.",
      "ceramic-dinner-set": progress > 0.78
        ? "The set arrived safely this time. The glaze is still beautiful and the newer packaging had extra separators around the bowls, which made the delivery feel much more reliable."
        : "The glaze is beautiful and the set looks premium when it arrives safely.",
      "desk-fan-mismatch": phase === "baseline"
        ? "The fan is small, quiet and useful on a desk. The USB cable was in the box and the airflow was enough for a keyboard area."
        : "The actual fan works for a small workspace. My concern is not the fan itself; it is that later reviews on the listing do not always seem to describe this product.",
    };
    return positives[product.key] || `The product matched the listing. ${product.themes[0]} and ${product.themes[1]} were as expected.`;
  }
  const negativeTexts = {
    "night-watch-print": [
      "The artwork scares me more than I expected. It feels dark and unsettling in a bedroom, especially at night. The print quality is fine, but the listing did not prepare me for how intense the faces and shadows feel in a small room.",
      "I thought it would look museum-like and elegant, but the scene feels creepy and heavy in person. This is not a damaged item; it is an expectation problem because the PDP did not explain the dramatic mood clearly enough.",
      "The print is not defective, but the mood is too frightening for our room. I wish the description had said this is a very dark, commanding image rather than simple classic wall decor.",
    ],
    "travel-mug-leak": [
      "The lid leaks into my bag. Calling it leakproof is not accurate because I used it upright in a normal commute and still found coffee around my notebook. The insulation is fine, but the seal claim is the reason I bought it.",
      "Coffee spilled near my laptop because the seal failed during commute. I tightened the cap twice and it still dripped from the button area, so this feels like either a lid defect or a misleading product promise.",
      "The mug looks nice but the cap drips every time I tilt it. If the product is only splash-resistant, the description should say that clearly before people trust it with electronics.",
      "I bought two mugs because the page said leakproof in any bag. One leaked from the push button and the other leaked around the rim after a week. The problem is specific and repeatable enough that I would pause that claim until the lid is checked.",
    ],
    "soft-yoga-mat": [
      "It is too soft for balance poses. I expected more firmness for yoga flows, and my hands sink into the mat when I transition quickly. For stretching it may be good, but the listing should separate cushion use from balance practice.",
      "The cushion is thick but unstable for transitions. This is a personal preference issue, not necessarily a defect, but several buyers may be surprised if they expect a firm yoga surface.",
      "My knees love the cushion, but standing poses feel wobbly. I would not call it a bad mat, but the PDP should be very direct that this is a soft floor-work mat rather than a firm studio mat.",
    ],
    "earbuds-color": [
      "The Rose color looks copper in person and not like the product photo. The earbuds work, but I bought the Rose variant specifically for the soft pink color shown on the page.",
      "Color is different from the pictures, so I returned the Rose variant. Black might be fine, but the Rose image needs a real-life photo next to the current render.",
      "Rose is much warmer and more metallic than the image. The sound is acceptable, so this feels like a variant-media problem instead of a whole-product electronics problem.",
    ],
    "smart-planter": [
      "Setup was confusing because the app and Wi-Fi requirements were not obvious enough. I only saw the 2.4 GHz note after the product arrived, and my router defaults to 5 GHz.",
      "The app is English only and I missed that before buying. The planter itself seems fine, but compatibility and language requirements should be in a visible FAQ before checkout.",
      "The device kept failing setup until support told me to split the router bands. That detail matters more than the marketing copy, so it should be in the top of the description or a compatibility FAQ.",
    ],
    "linen-shirt-fit": [
      "Medium runs small in the shoulders and sleeves, especially in White. The page says relaxed, so I expected a looser shirt, not something that pulled across the chest.",
      "I usually wear M, but this fit like a small after one cold wash. A size chart or fit warning would have saved the return.",
      "The White Medium was the only variant I tried, and it fit much tighter than the Navy large my partner ordered. This feels variant-specific, so a broad description rewrite would be less useful than a sizing note.",
    ],
    "ceramic-dinner-set": [
      "One bowl arrived cracked and the box did not protect the set enough. The glaze is beautiful, so this feels like a packaging or fulfillment problem rather than a product design problem.",
      "Beautiful product but packaging damage made it unusable. Support offered a partial refund, but I would rather see stronger separators between plates and bowls.",
      "Two plates had chips on the rim even though the outer box looked normal. I still like the design, but this should trigger packaging QA, not a claim that customers dislike the dinner set.",
    ],
    "desk-fan-mismatch": [
      "This review talks about snowboard bindings and boots, not a fan. Something is mismatched in the review feed because the text mentions snow conditions, edge hold and bindings while this product is clearly a USB desk fan.",
      "I bought this little desk fan, but several reviews mention boards, boots and mountain conditions. The product may be fine, but I do not trust the rating data because it looks attached to another listing.",
      "The listing says desk fan, but the review examples mention a snowboard, powder days and bindings. Please fix the review feed before using this text to rewrite the PDP.",
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
    orderPattern: product.orderPattern,
    returnRefundPattern: product.returnRefundPattern,
    reviewPattern: product.reviewPattern,
    stressCase: product.stressCase,
    expectedFindings: product.expectedFindings,
    expectedActions: product.expectedActions,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
    })),
    phaseSummary: buildProductPhaseSummary(product, orders, outcomes, reviewRows),
    outcomeThemes: buildProductOutcomeThemes(product, orders, outcomes),
    orderUnits: orders.flatMap((order) => order.lineItems)
      .filter((lineItem) => lineItem.productKey === product.key)
      .reduce((sum, lineItem) => sum + Number(lineItem.quantity || 0), 0),
    returns: outcomes.returns.filter((outcome) => outcomeBelongsToProduct(outcome, product.key, orders)).length,
    refunds: outcomes.refunds.filter((outcome) => outcomeBelongsToProduct(outcome, product.key, orders)).length,
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
    csvReviewFilePath: reviewSource?.filePath || null,
    manifestPath,
    orderCreateDelayMs: orderDelayMs,
    requiredScopes: REQUIRED_SHOPIFY_MOCK_DATASET_SCOPES,
    products: productDocs,
  };

  await mkdir(shopDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(summary, null, 2), "utf8");
  return { summary, manifestPath };
}

async function getStoredMockDatasetConfig(shop) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: SHOPIFY_MOCK_DATASET_SOURCE_KEY } },
  }).catch(() => null);
  return source?.config || {};
}

async function getStoredMockDatasetOutcomes(shop) {
  const config = await getStoredMockDatasetConfig(shop);
  return {
    returns: Array.isArray(config.outcomes?.returns) ? config.outcomes.returns : [],
    refunds: Array.isArray(config.outcomes?.refunds) ? config.outcomes.refunds : [],
  };
}

async function getStoredMockDatasetReviewSource(shop) {
  const config = await getStoredMockDatasetConfig(shop);
  if (!config.csvReviewFilePath) return null;
  return {
    filePath: config.csvReviewFilePath,
    fileName: config.csvReviewFileName || path.basename(config.csvReviewFilePath),
    rowCount: config.reviewCount || 0,
    checksum: config.csvReviewChecksum || null,
  };
}

async function getCurrentMockDatasetSummary(shop, { runId, createdAt, products, orders, outcomes, reviewRows, reviewSource, orderDelayMs }) {
  const config = await getStoredMockDatasetConfig(shop);
  return {
    ...config,
    runId,
    generatedAt: config.generatedAt || createdAt.toISOString(),
    productCount: products.length || config.productCount || 0,
    orderCount: orders.length || config.orderCount || 0,
    returnCount: outcomes.returns.length || config.returnCount || 0,
    refundCount: outcomes.refunds.length || config.refundCount || 0,
    reviewCount: reviewSource ? reviewRows.length : config.reviewCount || 0,
    csvReviewFilePath: reviewSource?.filePath || config.csvReviewFilePath || null,
    manifestPath: config.manifestPath || null,
    orderCreateDelayMs: orderDelayMs,
    requiredScopes: REQUIRED_SHOPIFY_MOCK_DATASET_SCOPES,
  };
}

async function markMockDatasetStageRunning(context, stage) {
  await updateMockDatasetState(context, {
    stages: {
      [stage]: {
        status: "running",
        startedAt: new Date().toISOString(),
      },
    },
  });
  await recordJobLog({
    shop: context.shop,
    jobId: context.jobId,
    event: `mock_dataset.${stage}.started`,
    message: `Mock dataset stage started: ${stage}.`,
    data: { stage, runId: context.runId },
  });
}

async function markMockDatasetStageComplete(context, stage, data = {}) {
  await updateMockDatasetState(context, {
    ...data,
    stages: {
      [stage]: {
        status: "completed",
        completedAt: new Date().toISOString(),
        ...data,
      },
    },
  });
  await recordJobLog({
    shop: context.shop,
    jobId: context.jobId,
    event: `mock_dataset.${stage}.completed`,
    message: `Mock dataset stage completed: ${stage}.`,
    data,
  });
}

async function updateProgressForStage(context, stage, completed, total, source, data = {}) {
  const [start, end] = STAGE_PROGRESS[stage] || [0, 99];
  const ratio = total > 0 ? completed / total : 1;
  await updateProgress(context, start + Math.floor((end - start) * ratio), source, {
    stage,
    completed,
    total,
    ...data,
  });
}

async function updateMockDatasetState(context, patch = {}) {
  const existingSource = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop: context.shop, sourceKey: SHOPIFY_MOCK_DATASET_SOURCE_KEY } },
  }).catch(() => null);
  const existingConfig = existingSource?.config || {};
  const config = mergeMockDatasetConfig(existingConfig, patch);
  await prisma.productPulseSource.upsert({
    where: { shop_sourceKey: { shop: context.shop, sourceKey: SHOPIFY_MOCK_DATASET_SOURCE_KEY } },
    create: {
      shop: context.shop,
      sourceKey: SHOPIFY_MOCK_DATASET_SOURCE_KEY,
      category: "testing",
      name: "Shopify mock dataset",
      connected: true,
      active: true,
      available: true,
      health: "connected",
      coverageWeight: 0,
      connectedAt: context.createdAt,
      lastSyncedAt: new Date(),
      config,
    },
    update: {
      connected: true,
      active: true,
      available: true,
      health: "connected",
      lastSyncedAt: new Date(),
      config,
    },
  });
  return config;
}

function mergeMockDatasetConfig(existingConfig, patch) {
  const next = {
    ...existingConfig,
    ...patch,
  };
  if (existingConfig.stages || patch.stages) {
    next.stages = { ...(existingConfig.stages || {}) };
    for (const [stage, stagePatch] of Object.entries(patch.stages || {})) {
      next.stages[stage] = {
        ...(existingConfig.stages?.[stage] || {}),
        ...stagePatch,
      };
    }
  }
  return next;
}

function buildProductPhaseSummary(product, orders, outcomes, reviewRows) {
  return ["baseline", "growth", "friction", "current"].map((phase) => {
    const phaseLineItems = orders.flatMap((order) => (
      order.plan?.phase === phase
        ? order.lineItems.map((lineItem) => ({ order, lineItem }))
        : []
    )).filter(({ lineItem }) => lineItem.productKey === product.key);
    const phaseReviews = reviewRows.filter((row) => row.source_product_id === product.key && row.scenario_phase === phase);
    const phaseReturns = outcomes.returns.filter((outcome) => outcomeBelongsToProductPhase(outcome, product.key, orders, phase));
    const phaseRefunds = outcomes.refunds.filter((outcome) => outcomeBelongsToProductPhase(outcome, product.key, orders, phase));
    return {
      phase,
      orders: new Set(phaseLineItems.map(({ order }) => order.id)).size,
      units: phaseLineItems.reduce((sum, { lineItem }) => sum + Number(lineItem.quantity || 0), 0),
      returns: phaseReturns.length,
      refunds: phaseRefunds.length,
      reviews: phaseReviews.length,
      negativeReviews: phaseReviews.filter((row) => Number(row.rating || 0) <= 2).length,
    };
  });
}

function buildProductOutcomeThemes(product, orders, outcomes) {
  const themes = [...outcomes.returns, ...outcomes.refunds]
    .filter((outcome) => outcomeBelongsToProduct(outcome, product.key, orders))
    .map((outcome) => outcome.theme || "unclassified");
  return themes.reduce((counts, theme) => ({
    ...counts,
    [theme]: (counts[theme] || 0) + 1,
  }), {});
}

function outcomeBelongsToProductPhase(outcome, productKey, orders, phase) {
  return orders.some((order) => order.id === outcome.orderId
    && order.plan?.phase === phase
    && order.lineItems.some((lineItem) => lineItem.id === outcome.lineItemId && lineItem.productKey === productKey));
}

function outcomeBelongsToProduct(outcome, productKey, orders) {
  return orders.some((order) => order.id === outcome.orderId
    && order.lineItems.some((lineItem) => lineItem.id === outcome.lineItemId && lineItem.productKey === productKey));
}

async function getShopInfo(admin) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseMockShopInfo {
      shop {
        currencyCode
      }
    }
  `, undefined, "Fetch mock dataset shop info");
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
  `, undefined, "Fetch mock dataset primary location").catch(() => null);
  return data?.locations?.nodes?.[0] || null;
}

async function updateProgress(context, progress, source, data = null) {
  await context.onProgress(progress, source, data);
}

async function shopifyGraphql(admin, query, variables, label = "Shopify GraphQL") {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await admin.graphql(query, variables ? { variables } : undefined);
      if (response?.ok === false) throw response;
      const json = await response.json();
      const errors = json.errors || [];
      if (errors.length) {
        throw new Error(`${label}: ${errors.map((error) => error.message).join("; ")}`);
      }
      return json.data;
    } catch (error) {
      lastError = await normalizeShopifyGraphqlError(error, label, attempt);
      if (attempt < 3 && isTransientShopifyGraphqlError(lastError)) {
        await wait(2000 * attempt);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

async function normalizeShopifyGraphqlError(error, label, attempt) {
  if (error && typeof error.text === "function") {
    const body = await error.text().catch(() => "");
    const message = [
      `${label} failed on attempt ${attempt}`,
      `HTTP ${error.status || "unknown"}`,
      body ? body.replace(/\s+/g, " ").slice(0, 600) : null,
    ].filter(Boolean).join(": ");
    const next = new Error(message);
    next.status = error.status;
    return next;
  }
  if (error instanceof Error) {
    error.message = error.message?.startsWith(label) ? error.message : `${label} failed on attempt ${attempt}: ${error.message}`;
    return error;
  }
  return new Error(`${label} failed on attempt ${attempt}: ${String(error)}`);
}

function isTransientShopifyGraphqlError(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  return status === 429
    || status >= 500
    || message.includes("status: 520")
    || message.includes("http 520")
    || message.includes("throttled")
    || message.includes("timeout")
    || message.includes("temporarily unavailable");
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
