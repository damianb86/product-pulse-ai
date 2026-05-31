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
  "customers",
  "orders",
  "outcomes",
  "reviews",
  "evolution",
  "manifest",
];
export const SHOPIFY_MOCK_DATASET_STAGE_LABELS = {
  all: "Run remaining setup",
  products: "Create products",
  customers: "Create customers",
  orders: "Create orders",
  outcomes: "Create returns and refunds",
  reviews: "Generate CSV reviews",
  evolution: "Create recent evolution batch",
  manifest: "Finalize report",
};
export const REQUIRED_SHOPIFY_MOCK_DATASET_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_all_orders",
  "write_orders",
  "read_customers",
  "write_customers",
  "read_returns",
  "write_returns",
  "read_locations",
];

const GENERATED_TAG = "productpulse-gen";
const GENERATED_ORDER_TAG = "productpulse-gen-order";
const GENERATED_EVOLUTION_ORDER_TAG = "productpulse-gen-evolution-order";
const GENERATED_REVIEW_SOURCE = "ProductPulse mock reviews";
const RELTEST_TAG = "RELTEST";
const RELTEST_ORDER_TAG = "productpulse-reltest-order";
const RELTEST_CUSTOMER_TAG = "productpulse-reltest-customer";
const LEGACY_ORDER_COUNT = 120;
const EXTRA_STRESS_ORDER_COUNT = 80;
const BASE_ORDER_COUNT = LEGACY_ORDER_COUNT + EXTRA_STRESS_ORDER_COUNT;
const RELTEST_SEQUENCE_ORDER_COUNT = 12;
const RELTEST_ORDER_COUNT = 13 + RELTEST_SEQUENCE_ORDER_COUNT;
const DEFAULT_ORDER_COUNT = BASE_ORDER_COUNT + RELTEST_ORDER_COUNT;
const DEFAULT_EVOLUTION_ORDER_COUNT = 41;
export const SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS = {
  all: DEFAULT_ORDER_COUNT,
  products: 0,
  customers: 0,
  orders: DEFAULT_ORDER_COUNT,
  outcomes: DEFAULT_ORDER_COUNT,
  reviews: 0,
  evolution: DEFAULT_EVOLUTION_ORDER_COUNT,
  manifest: DEFAULT_ORDER_COUNT,
};
const MIN_ORDER_CREATE_DELAY_MS = 12_500;
const GENERATED_PRODUCTS_PAGE_SIZE = 25;
const GENERATED_PRODUCT_VARIANTS_PAGE_SIZE = 10;
const GENERATED_ORDERS_PAGE_SIZE = 5;
const GENERATED_ORDERS_WITH_OUTCOMES_PAGE_SIZE = 3;
const GENERATED_ORDER_LINE_ITEMS_PAGE_SIZE = 12;
const GENERATED_ORDER_FULFILLMENTS_PAGE_SIZE = 5;
const GENERATED_ORDER_FULFILLMENT_LINE_ITEMS_PAGE_SIZE = 12;
const GENERATED_ORDER_RETURNS_PAGE_SIZE = 8;
const GENERATED_ORDER_RETURN_LINE_ITEMS_PAGE_SIZE = 8;
const GENERATED_ORDER_REFUND_LINE_ITEMS_PAGE_SIZE = 8;
const STAGE_PROGRESS = {
  products: [5, 25],
  customers: [25, 32],
  orders: [32, 70],
  outcomes: [70, 86],
  reviews: [86, 93],
  evolution: [35, 95],
  manifest: [93, 100],
};
const SHOPIFY_SCOPE_READ_EQUIVALENTS = {
  read_products: ["write_products"],
  read_orders: ["write_orders"],
  read_customers: ["write_customers"],
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
    tags: ["GEN", GENERATED_TAG, "keyboard", "premium", "high-sales-momentum"],
    options: [{ name: "Switch", values: ["Tactile", "Linear"] }],
    variants: [
      { options: { Switch: "Tactile" }, price: "149.00", sku: "GEN-KBD-TAC" },
      { options: { Switch: "Linear" }, price: "149.00", sku: "GEN-KBD-LIN" },
    ],
    story: "A commercially important product with rising sales, high Sales Momentum and mostly positive reviews. It should enter the app through momentum even without high risk.",
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
      "Create baseline scan or run product diagnosis if Catalog Scan only.",
      "No urgent customer-facing fix.",
    ],
    themes: ["premium", "solid", "switches", "fast shipping"],
    reviewProfile: { count: 44, negativeRate: 0.1, average: 4.5 },
  },
  {
    key: "voice-lock-safe",
    title: "GEN EchoLock Voice Safe",
    productType: "Home Security",
    vendor: "ProductPulse Lab",
    seoTitle: "EchoLock Voice Safe",
    seoDescription: "Compact voice-activated safe with keypad backup and removable shelf.",
    descriptionHtml: `
      <section>
        <h2>Voice-activated compact safe</h2>
        <p>Stores passports, keys and small valuables with voice unlock, keypad backup and a removable shelf.</p>
        <p>Voice unlock should be trained in a quiet room before first use.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, "home-security", "voice-unlock", "edge-case", "stress-test"],
    options: [{ name: "Finish", values: ["Matte Black", "Oak"] }],
    variants: [
      { options: { Finish: "Matte Black" }, price: "96.00", sku: "GEN-SAFE-BLK" },
      { options: { Finish: "Oak" }, price: "104.00", sku: "GEN-SAFE-OAK" },
    ],
    story: "A safety-sensitive product with contradictory customer language. Some buyers say voice unlock is convenient, while others say the Oak finish opens to a television voice, refuses the registered owner after a cold, or drains batteries overnight.",
    orderPattern: "Sparse early demand, then a gift-season spike followed by concentrated recent Oak purchases from a creator video.",
    returnRefundPattern: "Returns and refunds are not about appearance. They mention voice recognition, false opens, lockouts, battery drain and anxiety around security.",
    reviewPattern: "Reviews swing between trust and alarm: one buyer says it saved them time, another says it opened for the wrong voice, another says the keypad worked but the spoken phrase did not.",
    stressCase: "Tests whether the system treats security language as high severity without inventing a universal product defect when the Oak variant is the stronger signal.",
    expectedFindings: [
      "Security and trust language should be treated as serious evidence.",
      "Oak finish should show stronger variant concentration than Matte Black.",
      "Contradictory reviews should not collapse into one generic sentiment issue.",
    ],
    expectedActions: [
      "Supplier / QA review.",
      "Add compatibility and training guidance.",
      "Consider pausing the affected variant if confidence is high.",
    ],
    themes: ["voice unlock", "false open", "battery", "security"],
    reviewProfile: { count: 52, negativeRate: 0.58, average: 2.5 },
  },
  {
    key: "cooling-pillow",
    title: "GEN FrostPulse Cooling Pillow",
    productType: "Bedding",
    vendor: "ProductPulse Lab",
    seoTitle: "FrostPulse Cooling Pillow",
    seoDescription: "Cooling pillow with removable gel insert and two loft choices.",
    descriptionHtml: `
      <article>
        <h2>Cooling pillow with removable insert</h2>
        <p>Includes a washable cover, removable cooling insert and two loft profiles for different sleep positions.</p>
        <p>The insert should be aired out before first use.</p>
      </article>
    `,
    tags: ["GEN", GENERATED_TAG, "bedding", "cooling", "odor", "comfort-mismatch"],
    options: [
      { name: "Loft", values: ["Low Loft", "High Loft"] },
      { name: "Cover", values: ["Ice Blue", "Graphite"] },
    ],
    variants: [
      { options: { Loft: "Low Loft", Cover: "Ice Blue" }, price: "58.00", sku: "GEN-PILLOW-LOW-ICE" },
      { options: { Loft: "High Loft", Cover: "Ice Blue" }, price: "64.00", sku: "GEN-PILLOW-HIGH-ICE" },
      { options: { Loft: "Low Loft", Cover: "Graphite" }, price: "58.00", sku: "GEN-PILLOW-LOW-GPH" },
      { options: { Loft: "High Loft", Cover: "Graphite" }, price: "64.00", sku: "GEN-PILLOW-HIGH-GPH" },
    ],
    story: "A comfort product where the evidence points in opposite directions. Some customers say the insert is icy and damp, others say it warms up quickly, while High Loft reviews also mention neck angle.",
    orderPattern: "Steady baseline, a hot-weather growth wave, then recent purchases split between High Loft and Ice Blue after an ad claiming all-night cooling.",
    returnRefundPattern: "Returns mix subjective comfort with concrete odor, dampness and neck-pressure notes. Refunds often mention customers keeping the cover but rejecting the insert.",
    reviewPattern: "Language is deliberately inconsistent: too cold, not cold, wet, chemical smell, great after airing out, and High Loft too tall.",
    stressCase: "Tests whether the app can explain mixed evidence instead of forcing one neat defect story.",
    expectedFindings: [
      "High Loft and Ice Blue should appear in variant-level evidence.",
      "Comfort and odor should be separated from objective damage.",
      "AI synthesis should describe the contradiction instead of overfitting one complaint.",
    ],
    expectedActions: [
      "Add expectation-setting note.",
      "Add care/setup guidance for airing the insert.",
      "Review High Loft positioning if returns concentrate there.",
    ],
    themes: ["too cold", "not cold", "odor", "high loft"],
    reviewProfile: { count: 48, negativeRate: 0.5, average: 2.9 },
  },
  {
    key: "inflatable-standing-desk",
    title: "GEN LiftAir Inflatable Standing Desk",
    productType: "Furniture",
    vendor: "ProductPulse Lab",
    seoTitle: "LiftAir Inflatable Standing Desk",
    seoDescription: "Portable inflatable standing desk riser with compact pump.",
    descriptionHtml: `
      <section>
        <h2>Portable inflatable desk riser</h2>
        <p>Inflates into a temporary standing-height desk surface and packs flat for small spaces.</p>
        <p>Use on a stable table and keep sharp objects away from the air chamber.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, "furniture", "portable-desk", "air-leak", "extreme-test"],
    options: [{ name: "Kit", values: ["Starter", "Tall Kit", "Travel Kit"] }],
    variants: [
      { options: { Kit: "Starter" }, price: "69.00", sku: "GEN-LIFTAIR-START" },
      { options: { Kit: "Tall Kit" }, price: "89.00", sku: "GEN-LIFTAIR-TALL" },
      { options: { Kit: "Travel Kit" }, price: "76.00", sku: "GEN-LIFTAIR-TRAVEL" },
    ],
    story: "An intentionally strange furniture product that sells because it sounds clever, then creates operational and safety language: wobble, slow air loss, laptops sliding and customers unsure whether it is a joke or a real desk.",
    orderPattern: "Small novelty baseline, sharp growth from social traffic, then recent Tall Kit orders with high quantity variance.",
    returnRefundPattern: "Returns mention air leaks, unstable height and fear of equipment damage. Refunds happen when buyers keep the pump but cannot ship the inflated desk back cleanly.",
    reviewPattern: "Reviews should look messy: one buyer loves the tiny apartment use case, another says it sighed itself flat during a call, another says the Tall Kit is both too tall and not tall enough.",
    stressCase: "Tests extreme product plausibility, safety-adjacent wording and whether return notes can drive a real diagnostic even when reviews sound absurd.",
    expectedFindings: [
      "Air leak and wobble themes should dominate recent evidence.",
      "Tall Kit should have stronger return pressure than other kits.",
      "Recommendations should include QA and copy clarification, not only sentiment handling.",
    ],
    expectedActions: [
      "Supplier / QA review.",
      "Add weight and stability limits.",
      "Consider pausing Tall Kit if return concentration remains high.",
    ],
    themes: ["wobble", "air leak", "tilt", "tall kit"],
    reviewProfile: { count: 50, negativeRate: 0.66, average: 2.2 },
  },
  {
    key: "smart-luggage-tag",
    title: "GEN LoopLink Smart Luggage Tag",
    productType: "Travel Accessories",
    vendor: "ProductPulse Lab",
    seoTitle: "LoopLink Smart Luggage Tag",
    seoDescription: "QR and Bluetooth luggage tag for travel contact recovery.",
    descriptionHtml: `
      <article>
        <h2>Smart travel recovery tag</h2>
        <p>Combines QR contact recovery with short-range Bluetooth alerts and a privacy-forward owner profile.</p>
        <p>Location updates depend on scan events and nearby device signals.</p>
      </article>
    `,
    tags: ["GEN", GENERATED_TAG, "travel", "privacy", "tracking", "source-integrity"],
    options: [{ name: "Color", values: ["Carbon", "Citrus", "Cloud"] }],
    variants: [
      { options: { Color: "Carbon" }, price: "29.00", sku: "GEN-LOOP-CARBON" },
      { options: { Color: "Citrus" }, price: "29.00", sku: "GEN-LOOP-CITRUS" },
      { options: { Color: "Cloud" }, price: "29.00", sku: "GEN-LOOP-CLOUD" },
    ],
    story: "A travel accessory where orders look healthy but review language mixes true recovery wins with privacy fear, wrong-city alerts and one review that appears to describe a pet collar instead of luggage.",
    orderPattern: "Low baseline, strong travel-season bundles, then recent family-pack purchases with multiple units per order.",
    returnRefundPattern: "Returns and refunds mention QR privacy, wrong location notifications, dead batteries and confusion about whether the tag is real GPS.",
    reviewPattern: "Positive reviews say the tag recovered a suitcase. Negative reviews say it pinged the wrong airport, exposed too much profile info, or sounds like it came from another product feed.",
    stressCase: "Tests product/source ambiguity, privacy language, bundle quantity math and whether the app distinguishes scan-based tracking from promised GPS.",
    expectedFindings: [
      "Tracking expectation mismatch should be visible.",
      "Citrus and Carbon should have different evidence themes.",
      "Source-integrity warnings should remain separate from native Shopify return evidence.",
    ],
    expectedActions: [
      "Clarify GPS versus scan-based updates.",
      "Review privacy copy and QR profile defaults.",
      "Check review source mapping if unrelated language appears.",
    ],
    themes: ["wrong location", "qr privacy", "battery", "not gps"],
    reviewProfile: { count: 45, negativeRate: 0.47, average: 3.1 },
  },
  {
    key: "coffee-alarm-brewer",
    title: "GEN WhisperBrew Coffee Alarm Clock",
    productType: "Small Appliance",
    vendor: "ProductPulse Lab",
    seoTitle: "WhisperBrew Coffee Alarm Clock",
    seoDescription: "Bedside alarm clock with timed single-cup coffee brewing.",
    descriptionHtml: `
      <section>
        <h2>Bedside coffee alarm</h2>
        <p>Schedules a single-cup brew near wake time with quiet alarm tones and a removable water tank.</p>
        <p>Use only on a stable, water-resistant surface.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, "small-appliance", "alarm", "coffee", "timing-risk"],
    options: [{ name: "Color", values: ["Cream", "Graphite"] }],
    variants: [
      { options: { Color: "Cream" }, price: "118.00", sku: "GEN-BREW-CREAM" },
      { options: { Color: "Graphite" }, price: "122.00", sku: "GEN-BREW-GRAPH" },
    ],
    story: "A weird but plausible appliance with timing contradictions. Some buyers love waking up to coffee, while others say it brewed hours early, stayed silent, produced condensation or made the room smell burnt.",
    orderPattern: "Gift-driven baseline, a recent morning-routine campaign and uneven repeat purchases from buyers ordering multiple units for offices.",
    returnRefundPattern: "Returns mention schedule drift, wet nightstands and alarm silence. Refunds mention keeping the cup tray but losing trust in the timed brew function.",
    reviewPattern: "Reviews move from delight to alarm: great ritual, brewed at 3 a.m., clock lost minutes, coffee was cold, then a positive review says the Graphite unit was perfect after firmware reset.",
    stressCase: "Tests whether contradictory language, appliance trust and time-based complaints produce a useful diagnosis without generating fake precision.",
    expectedFindings: [
      "Timing and condensation evidence should be separated.",
      "Cream should show stronger cosmetic/stain notes than Graphite.",
      "Recent negative reviews should outweigh older novelty praise.",
    ],
    expectedActions: [
      "Supplier / QA review.",
      "Add setup and surface warning guidance.",
      "Create internal support note for firmware reset language.",
    ],
    themes: ["early brew", "clock drift", "condensation", "alarm silent"],
    reviewProfile: { count: 47, negativeRate: 0.6, average: 2.4 },
  },
  {
    key: "reltest-source-product",
    title: "GEN RELTEST Source Product",
    productType: "RELTEST Diagnostics",
    vendor: "ProductPulse Lab",
    seoTitle: "RELTEST Source Product",
    seoDescription: "Source product for ProductPulse relationship, basket and return/refund analytics testing.",
    descriptionHtml: `
      <section>
        <h2>RELTEST source product</h2>
        <p>Deterministic source product used to test bought-together relationships, purchase context, quantity buckets and return/refund impact.</p>
        <p>Search RELTEST after generating the Settings dataset and inspect this product first.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, RELTEST_TAG, "relationship-test", "basket-test", "risk-impact-test"],
    options: [{ name: "Pack", values: ["Standard", "Extended", "Bulk"] }],
    variants: [
      { options: { Pack: "Standard" }, price: "40.00", sku: "GEN-RELTEST-SRC-STD" },
      { options: { Pack: "Extended" }, price: "46.00", sku: "GEN-RELTEST-SRC-EXT" },
      { options: { Pack: "Bulk" }, price: "38.00", sku: "GEN-RELTEST-SRC-BULK" },
    ],
    story: "The anchor product for deterministic relationship analytics. It has exactly controlled solo orders, basket orders, multi-unit quantities, one bulk order, one multi-variant same-product order and same-customer before/after sequences.",
    orderPattern: "Fourteen current-window source orders: eight solo orders and six multi-product baskets. Eleven are single-unit source purchases, two are two-unit source purchases and one is a four-unit bulk purchase.",
    returnRefundPattern: "Source returns/refunds are concentrated in bought-together orders so relationship risk impact can compare baskets against clean solo orders.",
    reviewPattern: "Reviews mention bundle confusion, quantity expectations and variant mixups so customer language supports purchase-context diagnosis.",
    stressCase: "Tests relationship impact, purchase context, multi-variant basket handling and deterministic source-product inspection.",
    expectedFindings: [
      "Bought-together relationship with GEN RELTEST Bought Together Product.",
      "Purchase context should show 8 solo orders and 6 basket orders for the source product.",
      "Bought-before relationship with GEN RELTEST Bought Before Product.",
      "Bought-after relationship with GEN RELTEST Bought After Product.",
      "Return/refund pressure is higher when the source product is bought with the related product.",
    ],
    expectedActions: [
      "Inspect Product Relationships.",
      "Inspect Purchase Context.",
      "Inspect Return & Refund Resolution.",
    ],
    themes: ["reltest", "basket", "relationship", "source"],
    reviewProfile: { count: 12, negativeRate: 0.5, average: 3.1 },
  },
  {
    key: "reltest-bought-together-product",
    title: "GEN RELTEST Bought Together Product",
    productType: "RELTEST Diagnostics",
    vendor: "ProductPulse Lab",
    seoTitle: "RELTEST Bought Together Product",
    seoDescription: "Related product bought together with the RELTEST source product.",
    descriptionHtml: `
      <section>
        <h2>RELTEST bought-together product</h2>
        <p>Deterministic related product that appears in six source-product basket orders.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, RELTEST_TAG, "relationship-test", "bought-together-test"],
    options: [{ name: "Bundle Role", values: ["Companion"] }],
    variants: [{ options: { "Bundle Role": "Companion" }, price: "18.00", sku: "GEN-RELTEST-TOGETHER" }],
    story: "The main same-order related product for Product Relationship Intelligence tests.",
    orderPattern: "Appears with the RELTEST source product in six deterministic current-window orders and does not appear in the four source solo orders.",
    returnRefundPattern: "Some co-purchase orders also have source returns or refunds, creating measurable risk impact for the pair.",
    reviewPattern: "Mostly positive reviews with a small amount of bundle expectation language.",
    stressCase: "Tests bought-together counts, attach rate, lift when store-wide context is available and related-product display.",
    expectedFindings: [
      "Should appear as bought together from the RELTEST source product.",
      "Co-order count should be easy to verify manually.",
    ],
    expectedActions: [
      "Review bundle placement and relationship risk impact.",
    ],
    themes: ["reltest", "bought together", "companion", "bundle"],
    reviewProfile: { count: 8, negativeRate: 0.13, average: 4.4 },
  },
  {
    key: "reltest-bought-before-product",
    title: "GEN RELTEST Bought Before Product",
    productType: "RELTEST Diagnostics",
    vendor: "ProductPulse Lab",
    seoTitle: "RELTEST Bought Before Product",
    seoDescription: "Deterministic before-purchase relationship product for RELTEST customer sequence tests.",
    descriptionHtml: `
      <section>
        <h2>RELTEST bought-before product</h2>
        <p>This product is bought first by the same RELTEST customers who later buy the source product.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, RELTEST_TAG, "relationship-test", "before-sequence-test"],
    options: [{ name: "Sequence Role", values: ["Before"] }],
    variants: [{ options: { "Sequence Role": "Before" }, price: "22.00", sku: "GEN-RELTEST-BEFORE" }],
    story: "Generated to prove previous-purchase relationships from safe Shopify customer IDs.",
    orderPattern: "Four deterministic RELTEST customers buy this product first, then buy GEN RELTEST Source Product 16 days later.",
    returnRefundPattern: "No deterministic return/refund pattern; this product isolates same-customer before-purchase sequence evidence.",
    reviewPattern: "A small number of neutral-positive reviews keep the product easy to find while source-product sequence evidence comes from orders.",
    stressCase: "Tests previous-purchase relationships with customer identity extracted from Shopify order.customer.id.",
    expectedFindings: [
      "Should appear as bought before GEN RELTEST Source Product when customer identity is available.",
    ],
    expectedActions: [
      "Inspect Product Relationships for Bought before.",
    ],
    themes: ["reltest", "before", "customer identity", "sequence"],
    reviewProfile: { count: 4, negativeRate: 0, average: 4.5 },
  },
  {
    key: "reltest-bought-after-product",
    title: "GEN RELTEST Bought After Product",
    productType: "RELTEST Diagnostics",
    vendor: "ProductPulse Lab",
    seoTitle: "RELTEST Bought After Product",
    seoDescription: "Deterministic after-purchase relationship product for RELTEST customer sequence tests.",
    descriptionHtml: `
      <section>
        <h2>RELTEST bought-after product</h2>
        <p>This product is bought later by the same RELTEST customers who previously bought the source product.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, RELTEST_TAG, "relationship-test", "after-sequence-test"],
    options: [{ name: "Sequence Role", values: ["After"] }],
    variants: [{ options: { "Sequence Role": "After" }, price: "24.00", sku: "GEN-RELTEST-AFTER" }],
    story: "Generated to prove next-purchase relationships from safe Shopify customer IDs.",
    orderPattern: "The same four deterministic RELTEST customers buy this product 15 days after buying GEN RELTEST Source Product.",
    returnRefundPattern: "No deterministic return/refund pattern; this product isolates same-customer after-purchase sequence evidence.",
    reviewPattern: "A small number of neutral-positive reviews keep the product searchable while source-product sequence evidence comes from orders.",
    stressCase: "Tests next-purchase relationships with customer identity extracted from Shopify order.customer.id.",
    expectedFindings: [
      "Should appear as bought after GEN RELTEST Source Product when customer identity is available.",
    ],
    expectedActions: [
      "Inspect Product Relationships for Bought after.",
    ],
    themes: ["reltest", "after", "customer identity", "sequence"],
    reviewProfile: { count: 4, negativeRate: 0, average: 4.5 },
  },
  {
    key: "reltest-multi-variant-product",
    title: "GEN RELTEST Multi Variant Product",
    productType: "RELTEST Diagnostics",
    vendor: "ProductPulse Lab",
    seoTitle: "RELTEST Multi Variant Product",
    seoDescription: "Basket companion used by RELTEST purchase context tests.",
    descriptionHtml: `
      <section>
        <h2>RELTEST multi-variant product</h2>
        <p>Generated companion product with multiple variants for basket and variant Product Diagnosis.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, RELTEST_TAG, "basket-test", "variant-test"],
    options: [{ name: "Fit", values: ["Alpha", "Beta"] }],
    variants: [
      { options: { Fit: "Alpha" }, price: "16.00", sku: "GEN-RELTEST-MULTI-A" },
      { options: { Fit: "Beta" }, price: "16.00", sku: "GEN-RELTEST-MULTI-B" },
    ],
    story: "Companion product for basket context tests and variant-language reviews.",
    orderPattern: "Appears in deterministic RELTEST basket orders only when explicitly selected by the appended RELTEST plans.",
    returnRefundPattern: "No dedicated return/refund pattern; it provides clean basket context.",
    reviewPattern: "Reviews mention variant comparison and confusion without driving the source product's main outcome buckets.",
    stressCase: "Tests variant-rich basket data without changing CSV shape.",
    expectedFindings: [
      "Can appear as a co-purchased product when included in RELTEST basket orders.",
    ],
    expectedActions: [
      "Inspect basket line items and variant labels.",
    ],
    themes: ["reltest", "multi variant", "basket", "variant"],
    reviewProfile: { count: 6, negativeRate: 0.17, average: 4.0 },
  },
  {
    key: "reltest-bulk-quantity-product",
    title: "GEN RELTEST Bulk Quantity Product",
    productType: "RELTEST Diagnostics",
    vendor: "ProductPulse Lab",
    seoTitle: "RELTEST Bulk Quantity Product",
    seoDescription: "Basket companion used to make bulk purchase context easy to inspect.",
    descriptionHtml: `
      <section>
        <h2>RELTEST bulk quantity product</h2>
        <p>Companion product for deterministic bulk and basket purchase context tests.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, RELTEST_TAG, "basket-test", "bulk-test"],
    options: [{ name: "Pack", values: ["Case"] }],
    variants: [{ options: { Pack: "Case" }, price: "12.00", sku: "GEN-RELTEST-BULK-COMP" }],
    story: "Companion product that makes RELTEST basket orders easier to identify.",
    orderPattern: "Appears in one RELTEST basket order while the source product has a separate four-unit bulk source order.",
    returnRefundPattern: "No dedicated outcome pattern.",
    reviewPattern: "Short reviews mention case quantity clarity.",
    stressCase: "Tests that source-product bulk buckets come from the source quantity, not unrelated basket companions.",
    expectedFindings: [
      "Source bulk order should be counted from the source line quantity.",
    ],
    expectedActions: [
      "Inspect Purchase Context quantity distribution.",
    ],
    themes: ["reltest", "bulk", "quantity", "basket"],
    reviewProfile: { count: 5, negativeRate: 0.2, average: 3.8 },
  },
  {
    key: "reltest-return-refund-product",
    title: "GEN RELTEST Return Refund Product",
    productType: "RELTEST Diagnostics",
    vendor: "ProductPulse Lab",
    seoTitle: "RELTEST Return Refund Product",
    seoDescription: "Dedicated product for return plus refund and return-only resolution buckets.",
    descriptionHtml: `
      <section>
        <h2>RELTEST return/refund product</h2>
        <p>Dedicated product for deterministic Return & Refund Resolution buckets: returned and refunded, and returned without refund.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, RELTEST_TAG, "return-refund-test", "resolution-test"],
    options: [{ name: "Resolution Case", values: ["Standard"] }],
    variants: [{ options: { "Resolution Case": "Standard" }, price: "34.00", sku: "GEN-RELTEST-RETURN-REFUND" }],
    story: "Dedicated product for return/refund relationship analysis.",
    orderPattern: "Two deterministic orders are generated: one returned and refunded, one returned without refund.",
    returnRefundPattern: "One line item should land in returned_and_refunded and one should land in returned_not_refunded.",
    reviewPattern: "Negative reviews mention defects and resolution expectations aligned with return notes.",
    stressCase: "Tests return/refund matching by exact order line item without changing outcome shape.",
    expectedFindings: [
      "Return + refund bucket should be non-zero.",
      "Return-only bucket should be non-zero.",
    ],
    expectedActions: [
      "Inspect Return & Refund Resolution.",
    ],
    themes: ["reltest", "return", "refund", "resolution"],
    reviewProfile: { count: 8, negativeRate: 0.63, average: 2.6 },
  },
  {
    key: "reltest-refund-only-product",
    title: "GEN RELTEST Refund Only Product",
    productType: "RELTEST Diagnostics",
    vendor: "ProductPulse Lab",
    seoTitle: "RELTEST Refund Only Product",
    seoDescription: "Dedicated product for refund-without-return resolution buckets.",
    descriptionHtml: `
      <section>
        <h2>RELTEST refund-only product</h2>
        <p>Dedicated product for deterministic refund without return testing.</p>
      </section>
    `,
    tags: ["GEN", GENERATED_TAG, RELTEST_TAG, "return-refund-test", "refund-only-test"],
    options: [{ name: "Resolution Case", values: ["Refund Only"] }],
    variants: [{ options: { "Resolution Case": "Refund Only" }, price: "28.00", sku: "GEN-RELTEST-REFUND-ONLY" }],
    story: "Dedicated product for refund-only relationship analysis.",
    orderPattern: "One deterministic order is generated and receives a line-item refund with no return.",
    returnRefundPattern: "The line item should land in refunded_without_return.",
    reviewPattern: "Reviews mention compensation and support goodwill without a physical return.",
    stressCase: "Tests refund-only resolution without adding order-level refund structures.",
    expectedFindings: [
      "Refund-only bucket should be non-zero.",
    ],
    expectedActions: [
      "Inspect Return & Refund Resolution.",
    ],
    themes: ["reltest", "refund only", "goodwill", "resolution"],
    reviewProfile: { count: 6, negativeRate: 0.5, average: 3.0 },
  },
];

export const SHOPIFY_MOCK_DATASET_PRODUCT_COUNT = MOCK_PRODUCTS.length;

const RELTEST_SEQUENCE_CUSTOMER_COUNT = 4;
const RELTEST_ISOLATED_ORDER_CUSTOMER_COUNT = 13;
const RELTEST_GENERAL_CUSTOMER_COUNT = 7;
const RELTEST_CUSTOMER_COUNT = RELTEST_SEQUENCE_CUSTOMER_COUNT
  + RELTEST_ISOLATED_ORDER_CUSTOMER_COUNT
  + RELTEST_GENERAL_CUSTOMER_COUNT;
const RELTEST_GENERAL_CUSTOMER_START = RELTEST_SEQUENCE_CUSTOMER_COUNT + RELTEST_ISOLATED_ORDER_CUSTOMER_COUNT + 1;

const RELTEST_CUSTOMERS = Object.freeze(Array.from({ length: RELTEST_CUSTOMER_COUNT }, (_, index) => {
  const number = String(index + 1).padStart(3, "0");
  const customerNumber = index + 1;
  const roleTag = customerNumber <= RELTEST_SEQUENCE_CUSTOMER_COUNT
    ? "reltest-sequence-customer"
    : customerNumber < RELTEST_GENERAL_CUSTOMER_START
      ? "reltest-isolated-order-customer"
      : "reltest-general-order-customer";
  return {
    key: `reltest-customer-${number}`,
    label: `RELTEST_CUSTOMER_${number}`,
    tags: [
      RELTEST_TAG,
      RELTEST_CUSTOMER_TAG,
      `reltest-customer-${number}`,
      roleTag,
    ],
    note: `ProductPulse RELTEST deterministic customer profile (${roleTag}). Safe mock data only.`,
  };
}));

export const SHOPIFY_MOCK_DATASET_CUSTOMER_COUNT = RELTEST_CUSTOMERS.length;

const STRESS_PRODUCT_KEYS = new Set([
  "voice-lock-safe",
  "cooling-pillow",
  "inflatable-standing-desk",
  "smart-luggage-tag",
  "coffee-alarm-brewer",
]);

const RELTEST_PRODUCT_KEYS = Object.freeze([
  "reltest-source-product",
  "reltest-bought-together-product",
  "reltest-bought-before-product",
  "reltest-bought-after-product",
  "reltest-multi-variant-product",
  "reltest-bulk-quantity-product",
  "reltest-return-refund-product",
  "reltest-refund-only-product",
]);

const RELTEST_OUTCOME_PLANS = Object.freeze([
  {
    orderTag: "reltest-risk-return-refund",
    type: "return",
    productKey: "reltest-source-product",
    returnReason: "OTHER",
    note: "Other: RELTEST source felt confusing when bought with the companion product and the buyer returned it.",
    theme: "reltest-risk-impact",
  },
  {
    orderTag: "reltest-risk-return-refund",
    type: "refund",
    productKey: "reltest-source-product",
    note: "RELTEST refund after source product was returned from a bought-together basket.",
    theme: "reltest-risk-impact",
    quantity: 1,
  },
  {
    orderTag: "reltest-risk-return-only",
    type: "return",
    productKey: "reltest-source-product",
    returnReason: "NOT_AS_DESCRIBED",
    note: "Not as described: RELTEST bundle context made the source product look like a different kit.",
    theme: "reltest-risk-impact",
  },
  {
    orderTag: "reltest-risk-refund-only",
    type: "refund",
    productKey: "reltest-source-product",
    note: "RELTEST goodwill refund on source product from bought-together basket without a return.",
    theme: "reltest-risk-impact",
    quantity: 1,
  },
  {
    orderTag: "reltest-source-together-multi-variant",
    type: "return",
    productKey: "reltest-source-product",
    returnReason: "OTHER",
    note: "Exchange requested: customer returned the Standard Pack and the shop sent the Extended Pack variant as a replacement without a refund.",
    theme: "reltest-variant-exchange",
  },
  {
    orderTag: "reltest-return-refund-both",
    type: "return",
    productKey: "reltest-return-refund-product",
    returnReason: "OTHER",
    note: "Other: RELTEST return/refund product arrived defective and customer requested a return.",
    theme: "reltest-return-refund-linked",
  },
  {
    orderTag: "reltest-return-refund-both",
    type: "refund",
    productKey: "reltest-return-refund-product",
    note: "RELTEST refund issued after the returned defective unit was matched to the same line item.",
    theme: "reltest-return-refund-linked",
    quantity: 1,
  },
  {
    orderTag: "reltest-return-only",
    type: "return",
    productKey: "reltest-return-refund-product",
    returnReason: "OTHER",
    note: "Other: RELTEST item was returned but no refund has been issued yet.",
    theme: "reltest-return-only",
  },
  {
    orderTag: "reltest-refund-only",
    type: "refund",
    productKey: "reltest-refund-only-product",
    note: "RELTEST goodwill refund issued without a physical return.",
    theme: "reltest-refund-only",
    quantity: 1,
  },
]);

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
  const needsProducts = requestedStage !== "customers";
  const createMissingProducts = shouldRunMockDatasetStage(requestedStage, "products")
    || ["orders", "reviews", "evolution"].includes(requestedStage);
  let products = needsProducts
    ? await loadOrCreateMockProducts(context, location, shopInfo.currencyCode, {
      createMissing: createMissingProducts,
    })
    : [];

  let customers = [];
  const shouldPrepareCustomers = shouldRunMockDatasetStage(requestedStage, "customers")
    || ["orders", "evolution", "all"].includes(requestedStage);
  if (shouldPrepareCustomers) {
    await updateProgress(context, 25, "Creating or reusing RELTEST customer profiles for generated Shopify orders.");
    customers = await loadOrCreateMockCustomers(context, { createMissing: true });
  } else if (["manifest"].includes(requestedStage)) {
    customers = await loadOrCreateMockCustomers(context, { createMissing: false, recordStage: false });
  }

  let orders = [];
  if (shouldRunMockDatasetStage(requestedStage, "orders")) {
    await updateProgress(context, 32, `Creating or resuming ${DEFAULT_ORDER_COUNT} historical Shopify orders.`);
    if (!customers.length) customers = await loadOrCreateMockCustomers(context, { createMissing: true });
    orders = await loadOrCreateMockOrders(context, products, customers, location, shopInfo.currencyCode, orderDelayMs);
  } else if (requestedStage === "outcomes") {
    orders = await loadExistingMockOrders(context, products, shopInfo.currencyCode, { includeOutcomes: true });
  } else if (["manifest", "all"].includes(requestedStage)) {
    orders = await loadExistingMockOrders(context, products, shopInfo.currencyCode);
  }

  let outcomes = await getStoredMockDatasetOutcomes(shop);
  if (shouldRunMockDatasetStage(requestedStage, "outcomes")) {
    orders = await loadExistingMockOrders(context, products, shopInfo.currencyCode, { includeOutcomes: true });
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

  let evolution = existingConfig.evolutionBatch || null;
  if (shouldRunMockDatasetStage(requestedStage, "evolution")) {
    await markMockDatasetStageRunning(context, "evolution");
    await updateProgress(context, 35, "Creating recent evolution orders, outcomes and CSV review updates.");
    if (!customers.length) customers = await loadOrCreateMockCustomers(context, { createMissing: true });
    evolution = await createMockEvolutionBatch(context, products, location, shopInfo.currencyCode, {
      baseCreatedAt: createdAt,
      orderDelayMs,
      customers,
    });
    reviewRows = buildReviewRows(products, createdAt);
    const evolutionReviewRows = buildEvolutionReviewRows(products, evolution, reviewRows.length + 2);
    const combinedReviewRows = [...reviewRows, ...evolutionReviewRows];
    reviewSource = await saveMockCsvReviewSource({ shop, runId: `${runId}-evolution`, rows: combinedReviewRows });
    const report = await saveMockEvolutionReport({
      shop,
      runId,
      products,
      evolution,
      reviewRows: evolutionReviewRows,
      reviewSource,
    });
    await markMockDatasetStageComplete(context, "evolution", {
      evolutionBatch: {
        ...evolution,
        reportPath: report.reportPath,
        expectedChanges: report.expectedChanges,
      },
      evolutionOrderCount: evolution.orders.length,
      evolutionReturnCount: evolution.returns.length,
      evolutionRefundCount: evolution.refunds.length,
      evolutionReviewCount: evolutionReviewRows.length,
      reviewCount: combinedReviewRows.length,
      csvReviewFilePath: reviewSource.filePath,
      csvReviewFileName: reviewSource.fileName,
      csvReviewChecksum: reviewSource.checksum,
    });
    reviewRows = combinedReviewRows;
  }

  let summary = await getCurrentMockDatasetSummary(shop, {
    runId,
    createdAt,
    products,
    customers,
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
      customers,
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
    query ProductPulseGeneratedProducts($query: String!, $productsFirst: Int!, $variantsFirst: Int!) {
      products(first: $productsFirst, query: $query, sortKey: CREATED_AT, reverse: true) {
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
          variants(first: $variantsFirst) {
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
  `, {
    query: `tag:${GENERATED_TAG}`,
    productsFirst: GENERATED_PRODUCTS_PAGE_SIZE,
    variantsFirst: GENERATED_PRODUCT_VARIANTS_PAGE_SIZE,
  }, "Fetch existing GEN products");
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

async function loadOrCreateMockCustomers(context, { createMissing = false, recordStage = true } = {}) {
  if (recordStage) await markMockDatasetStageRunning(context, "customers");
  const existingCustomers = await fetchGeneratedReltestCustomers(context);
  const existingByKey = new Map(existingCustomers.map((customer) => [getReltestCustomerKey(customer), customer]).filter(([key]) => key));
  const customers = [];
  const missing = [];

  for (const spec of RELTEST_CUSTOMERS) {
    const existing = existingByKey.get(spec.key);
    if (existing) {
      customers.push(normalizeExistingReltestCustomer(spec, existing));
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        event: "mock_dataset.customer_reused",
        message: `Reused existing RELTEST customer: ${spec.label}.`,
        data: { customerId: existing.id, key: spec.key },
      });
      continue;
    }

    if (!createMissing) {
      missing.push(spec.label);
      continue;
    }

    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.customer_create_started",
      message: `Creating RELTEST customer: ${spec.label}.`,
      data: { key: spec.key },
    });
    const createdCustomer = await createMockCustomer(context, spec);
    customers.push(createdCustomer);
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.customer_created",
      message: `Created RELTEST customer: ${spec.label}.`,
      data: { customerId: createdCustomer.id, key: spec.key },
    });
    if (recordStage) {
      await updateProgressForStage(context, "customers", customers.length, RELTEST_CUSTOMERS.length, `Prepared ${customers.length} of ${RELTEST_CUSTOMERS.length} RELTEST customers.`);
    }
  }

  if (missing.length) {
    throw new Error(`RELTEST customers are missing. Run the customers stage first: ${missing.join(", ")}`);
  }

  if (recordStage) await markMockDatasetStageComplete(context, "customers", {
    customerCount: customers.length,
    customers: customers.map(serializeCustomerForState),
  });
  return customers;
}

async function fetchGeneratedReltestCustomers(context) {
  const data = await shopifyGraphql(context.admin, `#graphql
    query ProductPulseReltestCustomers($query: String!, $customersFirst: Int!) {
      customers(first: $customersFirst, query: $query) {
        nodes {
          id
          tags
        }
      }
    }
  `, {
    query: `tag:${RELTEST_CUSTOMER_TAG}`,
    customersFirst: Math.max(RELTEST_CUSTOMERS.length * 3, 12),
  }, "Fetch existing RELTEST customers");
  return data?.customers?.nodes || [];
}

function getReltestCustomerKey(customer = {}) {
  return (customer.tags || [])
    .map((tag) => String(tag || "").trim())
    .find((tag) => /^reltest-customer-\d{3}$/i.test(tag))
    ?.toLowerCase() || null;
}

function normalizeExistingReltestCustomer(spec, customer) {
  return {
    ...spec,
    id: customer.id,
    tags: customer.tags || spec.tags,
  };
}

async function createMockCustomer(context, spec) {
  const customerInput = {
    note: spec.note,
    tags: [...spec.tags, `run-${context.runSuffix}`],
  };
  const data = await shopifyGraphql(context.admin, `#graphql
    mutation ProductPulseCreateMockCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer {
          id
          tags
        }
        userErrors { field message }
      }
    }
  `, { input: customerInput }, `Create RELTEST customer ${spec.label}`);
  assertNoUserErrors(data?.customerCreate?.userErrors, `Create RELTEST customer ${spec.label}`);
  return normalizeExistingReltestCustomer(spec, data.customerCreate.customer);
}

function serializeCustomerForState(customer) {
  return {
    key: customer.key,
    label: customer.label,
    id: customer.id,
    tags: customer.tags,
  };
}

function getReltestCustomerProfileKey(number) {
  return `reltest-customer-${String(number).padStart(3, "0")}`;
}

function getGeneralOrderCustomerProfileKey(index) {
  const offset = Math.abs(Number(index) || 0) % RELTEST_GENERAL_CUSTOMER_COUNT;
  return getReltestCustomerProfileKey(RELTEST_GENERAL_CUSTOMER_START + offset);
}

function getCustomerProfileKeyForOrderPlan(plan = {}) {
  if (plan.customerProfileKey) return plan.customerProfileKey;
  const reltestOrderIndex = Number(plan.index) - BASE_ORDER_COUNT;
  if ((plan.tags || []).includes(RELTEST_ORDER_TAG)
    && reltestOrderIndex >= 0
    && reltestOrderIndex < RELTEST_ISOLATED_ORDER_CUSTOMER_COUNT) {
    return getReltestCustomerProfileKey(RELTEST_SEQUENCE_CUSTOMER_COUNT + reltestOrderIndex + 1);
  }
  return getGeneralOrderCustomerProfileKey(Number.isInteger(plan.evolutionIndex) ? plan.evolutionIndex : plan.index);
}

function ensureOrderPlanCustomerProfileKey(plan) {
  const customerProfileKey = getCustomerProfileKeyForOrderPlan(plan);
  return {
    ...plan,
    customerProfileKey,
  };
}

function attachCustomersToOrderPlans(orderPlans, customers = []) {
  const customersByKey = new Map(customers.map((customer) => [customer.key, customer]));
  return orderPlans.map((rawPlan) => {
    const plan = ensureOrderPlanCustomerProfileKey(rawPlan);
    const customer = customersByKey.get(plan.customerProfileKey);
    if (!customer?.id) throw new Error(`Missing RELTEST customer for order plan ${plan.index + 1}: ${plan.customerProfileKey}`);
    return {
      ...plan,
      customerId: customer.id,
      customerLabel: customer.label,
    };
  });
}

async function loadOrCreateMockOrders(context, products, customers, location, currencyCode, orderDelayMs) {
  await markMockDatasetStageRunning(context, "orders");
  const orderPlans = attachCustomersToOrderPlans(buildOrderPlans(products, currencyCode), customers);
  const fetchedExistingOrders = await fetchGeneratedOrders(context, products, orderPlans, currencyCode);
  const { reusableOrders: existingOrders, skippedIndexes } = await splitReusableGeneratedOrders(context, fetchedExistingOrders, "historical mock orders");
  const existingByIndex = new Map(existingOrders.map((order) => [order.plan?.index, order]).filter(([index]) => Number.isInteger(index)));
  const orders = [];
  let createdCount = 0;
  let reusedCount = 0;
  let skippedLegacyCustomerlessCount = 0;

  for (let index = 0; index < orderPlans.length; index += 1) {
    const plan = orderPlans[index];
    const existing = existingByIndex.get(plan.index);
    const replacingCustomerlessOrder = skippedIndexes.has(plan.index);
    if (existing) {
      orders.push(existing);
      reusedCount += 1;
      if (index % 10 === 0) {
        await recordJobLog({
          shop: context.shop,
          jobId: context.jobId,
          event: "mock_dataset.order_reused",
          message: `Reused existing mock order ${index + 1} of ${orderPlans.length}.`,
          data: { orderName: existing.name, generatedOrderIndex: plan.index + 1, phase: plan.phase },
        });
      }
    } else {
      if (replacingCustomerlessOrder) {
        skippedLegacyCustomerlessCount += 1;
        await recordJobLog({
          shop: context.shop,
          jobId: context.jobId,
          level: "warning",
          event: "mock_dataset.order_replacing_customerless",
          message: `Creating a customer-attributed replacement for legacy customerless mock order ${index + 1} of ${orderPlans.length}.`,
          data: { generatedOrderIndex: plan.index + 1, phase: plan.phase },
        });
      }
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        event: "mock_dataset.order_create_started",
        message: replacingCustomerlessOrder
          ? `Creating replacement mock order ${index + 1} of ${orderPlans.length}.`
          : `Creating mock order ${index + 1} of ${orderPlans.length}.`,
        data: {
          generatedOrderIndex: plan.index + 1,
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
            generatedOrderIndex: plan.index + 1,
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
        data: { orderName: createdOrder.name, orderId: createdOrder.id, generatedOrderIndex: plan.index + 1 },
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
          skippedLegacyCustomerlessCount,
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
      skippedLegacyCustomerlessCount,
      lastOrderIndex: orderPlans.length,
    },
  });
  return orders;
}

async function loadExistingMockOrders(context, products, currencyCode, { includeOutcomes = false } = {}) {
  const plans = buildOrderPlans(products, currencyCode);
  const fetchedOrders = await fetchGeneratedOrders(context, products, plans, currencyCode, { includeOutcomes });
  const { reusableOrders: orders } = await splitReusableGeneratedOrders(context, fetchedOrders, "historical mock orders");
  if (!fetchedOrders.length) {
    throw new Error("No generated mock orders were found. Run the orders stage before creating returns, refunds or the manifest.");
  }
  await recordJobLog({
    shop: context.shop,
    jobId: context.jobId,
    event: "mock_dataset.orders_loaded",
    message: `Loaded ${orders.length} existing generated mock orders from Shopify.`,
    data: { orderCount: orders.length, skippedCustomerlessOrders: fetchedOrders.length - orders.length, includeOutcomes },
  });
  return orders;
}

async function splitReusableGeneratedOrders(context, orders, label) {
  const customerlessOrders = [];
  const reusableOrders = [];
  for (const order of orders || []) {
    if (order.customerId) reusableOrders.push(order);
    else customerlessOrders.push(order);
  }
  const skippedIndexes = new Set(customerlessOrders.map((order) => order.plan?.index).filter((index) => Number.isInteger(index)));
  const skippedEvolutionIndexes = new Set(customerlessOrders.map((order) => order.plan?.evolutionIndex).filter((index) => Number.isInteger(index)));
  if (!customerlessOrders.length) return { reusableOrders, skippedOrders: [], skippedIndexes, skippedEvolutionIndexes };
  const examples = customerlessOrders.slice(0, 5).map((order) => order.name).filter(Boolean).join(", ");
  await recordJobLog({
    shop: context.shop,
    jobId: context.jobId,
    level: "warning",
    event: "mock_dataset.customerless_orders_skipped",
    message: `Skipped ${customerlessOrders.length} existing ${label} without customers; the dataset job will continue with reusable or missing orders.`,
    data: {
      skippedCustomerlessOrders: customerlessOrders.length,
      examples,
      generatedOrderIndexes: [...skippedIndexes].map((index) => index + 1).slice(0, 25),
      evolutionOrderIndexes: [...skippedEvolutionIndexes].map((index) => index + 1).slice(0, 25),
    },
  });
  return { reusableOrders, skippedOrders: customerlessOrders, skippedIndexes, skippedEvolutionIndexes };
}

async function fetchGeneratedOrders(context, products, orderPlans, currencyCode, { includeOutcomes = false } = {}) {
  const orders = [];
  let cursor = null;
  let page = 0;
  const ordersFirst = includeOutcomes ? GENERATED_ORDERS_WITH_OUTCOMES_PAGE_SIZE : GENERATED_ORDERS_PAGE_SIZE;
  do {
    page += 1;
    const data = await shopifyGraphql(context.admin, buildGeneratedOrdersQuery(includeOutcomes), {
      query: `tag:${GENERATED_ORDER_TAG}`,
      after: cursor,
      ordersFirst,
      lineItemsFirst: GENERATED_ORDER_LINE_ITEMS_PAGE_SIZE,
      fulfillmentsFirst: GENERATED_ORDER_FULFILLMENTS_PAGE_SIZE,
      fulfillmentLineItemsFirst: GENERATED_ORDER_FULFILLMENT_LINE_ITEMS_PAGE_SIZE,
      ...(includeOutcomes ? {
        returnsFirst: GENERATED_ORDER_RETURNS_PAGE_SIZE,
        returnLineItemsFirst: GENERATED_ORDER_RETURN_LINE_ITEMS_PAGE_SIZE,
        refundLineItemsFirst: GENERATED_ORDER_REFUND_LINE_ITEMS_PAGE_SIZE,
      } : {}),
    }, includeOutcomes ? "Fetch existing generated mock orders with outcomes" : "Fetch existing generated mock orders");
    const nodes = data?.orders?.nodes || [];
    orders.push(...nodes);
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.generated_orders_page_loaded",
      message: `Loaded generated mock orders page ${page}.`,
      data: {
        page,
        count: nodes.length,
        totalLoaded: orders.length,
        includeOutcomes,
        ordersFirst,
        cost: getGraphqlCostSummary(data),
      },
    });
    cursor = data?.orders?.pageInfo?.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (cursor);

  const plansByIndex = new Map(orderPlans.map((plan) => [plan.index, plan]));
  const productsByVariantId = new Map(products.flatMap((product) => (
    (product.variants || []).map((variant) => [variant.id, { product, variant }])
  )));
  return orders
    .map((order) => normalizeExistingMockOrder(order, plansByIndex, productsByVariantId, currencyCode))
    .filter(Boolean);
}

function buildGeneratedOrdersQuery(includeOutcomes) {
  return `#graphql
    query ProductPulseGeneratedOrders(
      $query: String!,
      $after: String,
      $ordersFirst: Int!,
      $lineItemsFirst: Int!,
      $fulfillmentsFirst: Int!,
      $fulfillmentLineItemsFirst: Int!${includeOutcomes ? `,
      $returnsFirst: Int!,
      $returnLineItemsFirst: Int!,
      $refundLineItemsFirst: Int!` : ""}
    ) {
      orders(first: $ordersFirst, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: false) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          processedAt
          note
          tags
          customer {
            id
          }
          lineItems(first: $lineItemsFirst) {
            nodes {
              id
              title
              quantity
              variant {
                id
              }
            }
          }
          fulfillments(first: $fulfillmentsFirst) {
            id
            fulfillmentLineItems(first: $fulfillmentLineItemsFirst) {
              nodes {
                id
                quantity
                lineItem {
                  id
                }
              }
            }
          }
          ${includeOutcomes ? `
          refunds {
            id
            note
            createdAt
            processedAt
            refundLineItems(first: $refundLineItemsFirst) {
              nodes {
                id
                quantity
                lineItem {
                  id
                }
              }
            }
          }
          returns(first: $returnsFirst) {
            nodes {
              id
              createdAt
              returnLineItems(first: $returnLineItemsFirst) {
                nodes {
                  ... on ReturnLineItem {
                    id
                    quantity
                    returnReason
                    returnReasonNote
                    customerNote
                    fulfillmentLineItem {
                      lineItem {
                        id
                      }
                    }
                  }
                }
              }
            }
          }` : ""}
        }
      }
    }
  `;
}

function getGeneratedOrderIndex(order) {
  const tagIndex = (order.tags || [])
    .map((tag) => String(tag || "").match(/^ppgen-order-(\d+)$/i)?.[1])
    .find(Boolean);
  const noteIndex = String(order.note || "").match(/ProductPulse generated order\s+(\d+)/i)?.[1];
  const index = Number(tagIndex || noteIndex || 0);
  return Number.isFinite(index) && index > 0 ? index - 1 : null;
}

function normalizeExistingMockOrder(order, plansByIndex, productsByVariantId, currencyCode) {
  const plan = plansByIndex.get(getGeneratedOrderIndex(order));
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
  const lineItemsById = new Map(lineItems.map((lineItem) => [lineItem.id, lineItem]));
  const existingReturns = getConnectionNodes(order.returns).flatMap((itemReturn) => (
    getConnectionNodes(itemReturn.returnLineItems)
      .map((returnLineItem) => {
        const lineItemId = returnLineItem.fulfillmentLineItem?.lineItem?.id;
        const lineItem = lineItemsById.get(lineItemId);
        if (!lineItem) return null;
        return {
          id: itemReturn.id,
          returnLineItemId: returnLineItem.id,
          orderId: order.id,
          orderName: order.name,
          lineItemId,
          productKey: lineItem.productKey,
          productTitle: lineItem.productTitle,
          returnReason: returnLineItem.returnReason || null,
          note: returnLineItem.returnReasonNote || returnLineItem.customerNote || null,
          theme: "shopify-existing",
        };
      })
      .filter(Boolean)
  ));
  const existingRefunds = (order.refunds || []).flatMap((refund) => (
    getConnectionNodes(refund.refundLineItems)
      .map((refundLineItem) => {
        const lineItemId = refundLineItem.lineItem?.id;
        const lineItem = lineItemsById.get(lineItemId);
        if (!lineItem) return null;
        return {
          id: refund.id,
          refundLineItemId: refundLineItem.id,
          orderId: order.id,
          orderName: order.name,
          lineItemId,
          productKey: lineItem.productKey,
          productTitle: lineItem.productTitle,
          note: refund.note || null,
          theme: "shopify-existing",
          quantity: refundLineItem.quantity || 1,
        };
      })
      .filter(Boolean)
  ));
  return {
    id: order.id,
    name: order.name,
    processedAt: order.processedAt,
    customerId: order.customer?.id || null,
    customerKey: order.customer?.id || null,
    transactions: order.transactions || [],
    lineItems,
    plan: { ...plan, currencyCode, customerId: order.customer?.id || plan.customerId || null },
    existingOutcomes: {
      returns: existingReturns,
      refunds: existingRefunds,
    },
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

function buildOrderPlans(products, currencyCode, { now = Date.now() } = {}) {
  const start = now - 300 * 24 * 60 * 60 * 1000;
  const byKey = new Map(products.map((product) => [product.key, product]));

  const basePlans = Array.from({ length: BASE_ORDER_COUNT }, (_, index) => {
    const stressOrder = index >= LEGACY_ORDER_COUNT;
    const sequenceIndex = stressOrder ? index - LEGACY_ORDER_COUNT : index;
    const sequenceCount = stressOrder ? EXTRA_STRESS_ORDER_COUNT : LEGACY_ORDER_COUNT;
    const progress = sequenceIndex / Math.max(1, sequenceCount - 1);
    const phase = getOrderPhase(progress);
    const step = (300 * 24 * 60 * 60 * 1000) / sequenceCount;
    const dateOffset = stressOrder
      ? 33 * 60 * 1000 + (index % 11) * 45 * 60 * 1000
      : (index % 9) * 60 * 60 * 1000;
    const date = new Date(start + sequenceIndex * step + dateOffset);
    const primaryKey = stressOrder
      ? getStressPrimaryProductKeyForOrder(sequenceIndex, progress)
      : getPrimaryProductKeyForOrder(sequenceIndex, progress);
    const secondaryKeys = stressOrder
      ? getStressSecondaryProductKeysForOrder(sequenceIndex, progress)
      : getSecondaryProductKeysForOrder(sequenceIndex, progress);
    const orderProducts = [...new Set([primaryKey, ...secondaryKeys].filter(Boolean))]
      .map((key) => byKey.get(key))
      .filter(Boolean);
    const items = orderProducts.map((product, itemIndex) => {
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
      phase,
      processedAt: date.toISOString(),
      currencyCode,
      note: stressOrder
        ? `ProductPulse generated order ${index + 1}. ${phase} phase. Extreme mock stress dataset for Product Diagnosis.`
        : `ProductPulse generated order ${index + 1}. ${phase} phase. Controlled mock dataset for Product Diagnosis.`,
      tags: [GENERATED_ORDER_TAG, `ppgen-order-${index + 1}`, `run-${products[0]?.handle?.split("-").pop() || "mock"}`],
      items,
      total,
    };
  });
  return [
    ...basePlans,
    ...buildReltestOrderPlans(products, currencyCode, now, basePlans.length),
  ].map(ensureOrderPlanCustomerProfileKey);
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

function getStressPrimaryProductKeyForOrder(index, progress) {
  const phaseCycles = {
    baseline: [
      "voice-lock-safe",
      "cooling-pillow",
      "smart-luggage-tag",
      "coffee-alarm-brewer",
      "inflatable-standing-desk",
      "smart-luggage-tag",
      "cooling-pillow",
      "voice-lock-safe",
    ],
    growth: [
      "coffee-alarm-brewer",
      "inflatable-standing-desk",
      "cooling-pillow",
      "smart-luggage-tag",
      "voice-lock-safe",
      "inflatable-standing-desk",
      "coffee-alarm-brewer",
      "cooling-pillow",
    ],
    friction: [
      "inflatable-standing-desk",
      "voice-lock-safe",
      "coffee-alarm-brewer",
      "cooling-pillow",
      "smart-luggage-tag",
      "inflatable-standing-desk",
      "voice-lock-safe",
      "coffee-alarm-brewer",
    ],
    current: [
      "coffee-alarm-brewer",
      "voice-lock-safe",
      "smart-luggage-tag",
      "inflatable-standing-desk",
      "cooling-pillow",
      "coffee-alarm-brewer",
      "voice-lock-safe",
      "smart-luggage-tag",
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

function getStressSecondaryProductKeysForOrder(index, progress) {
  const phase = getOrderPhase(progress);
  const keys = [];
  if (index % 6 === 0) keys.push(phase === "baseline" ? "puzzle-calm" : "smart-luggage-tag");
  if (index % 10 === 0) keys.push(phase === "current" ? "coffee-alarm-brewer" : "cooling-pillow");
  if (index % 13 === 0) keys.push(phase === "friction" ? "voice-lock-safe" : "inflatable-standing-desk");
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
  if (product.key === "voice-lock-safe") {
    const oak = variants.find((variant) => variant.title.toLowerCase().includes("oak"));
    if (index % 3 !== 0 && oak) return oak;
  }
  if (product.key === "cooling-pillow") {
    const high = variants.find((variant) => variant.title.toLowerCase().includes("high loft"));
    if (index % 2 === 0 && high) return high;
    const ice = variants.find((variant) => variant.title.toLowerCase().includes("ice blue"));
    if (index % 3 === 0 && ice) return ice;
  }
  if (product.key === "inflatable-standing-desk") {
    const tall = variants.find((variant) => variant.title.toLowerCase().includes("tall kit"));
    if (index % 2 === 0 && tall) return tall;
  }
  if (product.key === "smart-luggage-tag") {
    const citrus = variants.find((variant) => variant.title.toLowerCase().includes("citrus"));
    if (index % 4 < 2 && citrus) return citrus;
    const carbon = variants.find((variant) => variant.title.toLowerCase().includes("carbon"));
    if (index % 4 === 2 && carbon) return carbon;
  }
  if (product.key === "coffee-alarm-brewer") {
    const cream = variants.find((variant) => variant.title.toLowerCase().includes("cream"));
    if (index % 2 === 0 && cream) return cream;
  }
  return variants[index % variants.length];
}

function getOrderQuantity(productKey, index, progress) {
  if (productKey === "puzzle-calm" && index % 4 === 0) return 2;
  if (productKey === "premium-keyboard" && progress > 0.7 && index % 4 === 0) return 2;
  if (productKey === "ceramic-dinner-set" && progress > 0.42 && progress < 0.72 && index % 5 === 0) return 2;
  if (productKey === "linen-shirt-fit" && progress > 0.68 && index % 8 === 0) return 2;
  if (productKey === "smart-luggage-tag" && index % 5 === 0) return 3;
  if (productKey === "cooling-pillow" && index % 6 === 0) return 2;
  if (productKey === "coffee-alarm-brewer" && progress > 0.7 && index % 7 === 0) return 2;
  return 1;
}

function buildReltestOrderPlans(products, currencyCode, now, startIndex) {
  const byKey = new Map(products.map((product) => [product.key, product]));
  const runTag = `run-${products[0]?.handle?.split("-").pop() || "mock"}`;
  const specs = [
    { daysAgo: 34, tags: ["reltest-source-solo-01", "reltest-solo", "reltest-single-unit"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 1 }] },
    { daysAgo: 32, tags: ["reltest-source-solo-02", "reltest-solo", "reltest-single-unit"], items: [{ key: "reltest-source-product", variantHint: "Extended", quantity: 1 }] },
    { daysAgo: 30, tags: ["reltest-source-solo-03", "reltest-solo", "reltest-single-unit"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 1 }] },
    { daysAgo: 28, tags: ["reltest-source-solo-bulk", "reltest-solo", "reltest-bulk"], items: [{ key: "reltest-source-product", variantHint: "Bulk", quantity: 4 }] },
    { daysAgo: 24, tags: ["reltest-source-together-01", "reltest-basket", "reltest-bought-together"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 1 }, { key: "reltest-bought-together-product", variantHint: "Companion", quantity: 1 }] },
    { daysAgo: 22, tags: ["reltest-source-together-02", "reltest-basket", "reltest-bought-together", "reltest-risk-return-refund"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 1 }, { key: "reltest-bought-together-product", variantHint: "Companion", quantity: 1 }] },
    { daysAgo: 20, tags: ["reltest-source-together-03", "reltest-basket", "reltest-bought-together", "reltest-risk-return-only"], items: [{ key: "reltest-source-product", variantHint: "Extended", quantity: 1 }, { key: "reltest-bought-together-product", variantHint: "Companion", quantity: 1 }] },
    { daysAgo: 16, tags: ["reltest-source-together-04", "reltest-basket", "reltest-bought-together"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 1 }, { key: "reltest-bought-together-product", variantHint: "Companion", quantity: 2 }, { key: "reltest-bulk-quantity-product", variantHint: "Case", quantity: 1 }] },
    { daysAgo: 12, tags: ["reltest-source-together-multi-variant", "reltest-basket", "reltest-bought-together", "reltest-multi-variant-source"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 1 }, { key: "reltest-source-product", variantHint: "Extended", quantity: 1 }, { key: "reltest-bought-together-product", variantHint: "Companion", quantity: 1 }] },
    { daysAgo: 8, tags: ["reltest-source-together-05", "reltest-basket", "reltest-bought-together", "reltest-risk-refund-only"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 2 }, { key: "reltest-bought-together-product", variantHint: "Companion", quantity: 1 }] },
    { daysAgo: 18, tags: ["reltest-return-refund-both"], items: [{ key: "reltest-return-refund-product", variantHint: "Standard", quantity: 1 }] },
    { daysAgo: 10, tags: ["reltest-return-only"], items: [{ key: "reltest-return-refund-product", variantHint: "Standard", quantity: 1 }] },
    { daysAgo: 6, tags: ["reltest-refund-only"], items: [{ key: "reltest-refund-only-product", variantHint: "Refund Only", quantity: 1 }] },
    { daysAgo: 58, customerProfileKey: "reltest-customer-001", tags: ["reltest-sequence-before-01", "reltest-bought-before-sequence"], items: [{ key: "reltest-bought-before-product", variantHint: "Before", quantity: 1 }] },
    { daysAgo: 42, customerProfileKey: "reltest-customer-001", tags: ["reltest-sequence-source-01", "reltest-source-sequence", "reltest-single-unit"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 1 }] },
    { daysAgo: 27, customerProfileKey: "reltest-customer-001", tags: ["reltest-sequence-after-01", "reltest-bought-after-sequence"], items: [{ key: "reltest-bought-after-product", variantHint: "After", quantity: 1 }] },
    { daysAgo: 55, customerProfileKey: "reltest-customer-002", tags: ["reltest-sequence-before-02", "reltest-bought-before-sequence"], items: [{ key: "reltest-bought-before-product", variantHint: "Before", quantity: 1 }] },
    { daysAgo: 39, customerProfileKey: "reltest-customer-002", tags: ["reltest-sequence-source-02", "reltest-source-sequence", "reltest-single-unit"], items: [{ key: "reltest-source-product", variantHint: "Extended", quantity: 1 }] },
    { daysAgo: 24, customerProfileKey: "reltest-customer-002", tags: ["reltest-sequence-after-02", "reltest-bought-after-sequence"], items: [{ key: "reltest-bought-after-product", variantHint: "After", quantity: 1 }] },
    { daysAgo: 52, customerProfileKey: "reltest-customer-003", tags: ["reltest-sequence-before-03", "reltest-bought-before-sequence"], items: [{ key: "reltest-bought-before-product", variantHint: "Before", quantity: 1 }] },
    { daysAgo: 36, customerProfileKey: "reltest-customer-003", tags: ["reltest-sequence-source-03", "reltest-source-sequence", "reltest-single-unit"], items: [{ key: "reltest-source-product", variantHint: "Standard", quantity: 1 }] },
    { daysAgo: 21, customerProfileKey: "reltest-customer-003", tags: ["reltest-sequence-after-03", "reltest-bought-after-sequence"], items: [{ key: "reltest-bought-after-product", variantHint: "After", quantity: 1 }] },
    { daysAgo: 49, customerProfileKey: "reltest-customer-004", tags: ["reltest-sequence-before-04", "reltest-bought-before-sequence"], items: [{ key: "reltest-bought-before-product", variantHint: "Before", quantity: 1 }] },
    { daysAgo: 33, customerProfileKey: "reltest-customer-004", tags: ["reltest-sequence-source-04", "reltest-source-sequence", "reltest-single-unit"], items: [{ key: "reltest-source-product", variantHint: "Bulk", quantity: 1 }] },
    { daysAgo: 18, customerProfileKey: "reltest-customer-004", tags: ["reltest-sequence-after-04", "reltest-bought-after-sequence"], items: [{ key: "reltest-bought-after-product", variantHint: "After", quantity: 1 }] },
  ];

  return specs.map((spec, reltestIndex) => {
    const index = startIndex + reltestIndex;
    const items = spec.items.map((itemSpec, itemIndex) => {
      const product = byKey.get(itemSpec.key);
      if (!product) throw new Error(`Missing generated RELTEST product for order plan: ${itemSpec.key}`);
      const variant = pickReltestVariant(product, itemSpec.variantHint, reltestIndex + itemIndex);
      return {
        productKey: product.key,
        productTitle: product.title,
        handle: product.handle,
        variantId: variant.id,
        variantTitle: variant.title,
        sku: variant.sku,
        quantity: itemSpec.quantity,
        unitPrice: Number(variant.price || 0),
      };
    });
    const processedAt = new Date(now - spec.daysAgo * 24 * 60 * 60 * 1000 + reltestIndex * 75 * 60 * 1000);
      return {
        index,
        phase: "current",
        processedAt: processedAt.toISOString(),
        currencyCode,
        note: `ProductPulse generated order ${index + 1}. current phase. RELTEST deterministic scenario: ${spec.tags[0]}.`,
        tags: [GENERATED_ORDER_TAG, RELTEST_ORDER_TAG, `ppgen-order-${index + 1}`, runTag, ...spec.tags],
        customerProfileKey: spec.customerProfileKey || null,
        items,
        total: items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
      };
  });
}

function pickReltestVariant(product, hint, fallbackIndex) {
  const variants = product.variants || [];
  if (!variants.length) throw new Error(`Product ${product.title} has no variants after creation.`);
  if (hint) {
    const normalizedHint = String(hint).toLowerCase();
    const matched = variants.find((variant) => String(variant.title || "").toLowerCase().includes(normalizedHint)
      || String(variant.sku || "").toLowerCase().includes(normalizedHint));
    if (matched) return matched;
  }
  return variants[fallbackIndex % variants.length];
}

async function createMockOrder(context, plan, location, currencyCode) {
  const orderInput = {
    currency: currencyCode,
    processedAt: plan.processedAt,
    financialStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    test: true,
    note: plan.note,
    tags: plan.tags,
    ...(plan.customerId ? { customer: { toAssociate: { id: plan.customerId } } } : {}),
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
      requiresShipping: false,
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
    mutation ProductPulseCreateMockOrder(
      $order: OrderCreateOrderInput!,
      $options: OrderCreateOptionsInput,
      $lineItemsFirst: Int!,
      $fulfillmentsFirst: Int!,
      $fulfillmentLineItemsFirst: Int!
      ) {
        orderCreate(order: $order, options: $options) {
          order {
            id
            name
            processedAt
            customer {
              id
            }
            lineItems(first: $lineItemsFirst) {
              nodes {
                id
                title
                quantity
                variant {
                  id
                }
              }
            }
            fulfillments(first: $fulfillmentsFirst) {
            id
            fulfillmentLineItems(first: $fulfillmentLineItemsFirst) {
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
    lineItemsFirst: GENERATED_ORDER_LINE_ITEMS_PAGE_SIZE,
    fulfillmentsFirst: GENERATED_ORDER_FULFILLMENTS_PAGE_SIZE,
    fulfillmentLineItemsFirst: GENERATED_ORDER_FULFILLMENT_LINE_ITEMS_PAGE_SIZE,
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
      customerId: order.customer?.id || plan.customerId || null,
      customerKey: order.customer?.id || plan.customerId || null,
      transactions: order.transactions || [],
      lineItems,
      plan: { ...plan, customerId: order.customer?.id || plan.customerId || null },
    };
}

async function createMockReturnsAndRefunds(context, orders, currencyCode, { existingOutcomes = {}, onOutcome } = {}) {
  const existingShopifyOutcomes = collectExistingOutcomesFromOrders(orders);
  const returns = dedupeOutcomes([
    ...(Array.isArray(existingOutcomes.returns) ? existingOutcomes.returns : []),
    ...existingShopifyOutcomes.returns,
  ]);
  const refunds = dedupeOutcomes([
    ...(Array.isArray(existingOutcomes.refunds) ? existingOutcomes.refunds : []),
    ...existingShopifyOutcomes.refunds,
  ]);
  if (existingShopifyOutcomes.returns.length || existingShopifyOutcomes.refunds.length) {
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.outcomes_reused",
      message: "Reused existing mock returns and refunds already present on generated Shopify orders.",
      data: {
        detectedReturns: existingShopifyOutcomes.returns.length,
        detectedRefunds: existingShopifyOutcomes.refunds.length,
        reusableReturns: returns.length,
        reusableRefunds: refunds.length,
      },
    });
    await onOutcome?.({ returns, refunds });
  }
  const usedLineItems = new Set([...returns, ...refunds].map((outcome) => outcome.lineItemId).filter(Boolean));
  const returnTargets = new Map(Object.entries({
    "travel-mug-leak": 8,
    "night-watch-print": 6,
    "linen-shirt-fit": 6,
    "earbuds-color": 5,
    "soft-yoga-mat": 4,
    "smart-planter": 3,
    "desk-fan-mismatch": 1,
    "voice-lock-safe": 7,
    "cooling-pillow": 6,
    "inflatable-standing-desk": 8,
    "smart-luggage-tag": 5,
    "coffee-alarm-brewer": 7,
  }));
  const refundTargets = new Map(Object.entries({
    "ceramic-dinner-set": 7,
    "travel-mug-leak": 5,
    "smart-planter": 4,
    "earbuds-color": 2,
    "linen-shirt-fit": 2,
    "voice-lock-safe": 4,
    "cooling-pillow": 4,
    "inflatable-standing-desk": 5,
    "smart-luggage-tag": 3,
    "coffee-alarm-brewer": 4,
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
    if (areOutcomeTargetsSatisfied(returnTargets, returnCounts)) break;
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
    if (areOutcomeTargetsSatisfied(refundTargets, refundCounts)) break;
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

  return createReltestReturnsAndRefunds(context, orders, currencyCode, returns, refunds, onOutcome);
}

async function createReltestReturnsAndRefunds(context, orders, currencyCode, returns, refunds, onOutcome) {
  const outcomeKeys = new Set([
    ...returns.map((outcome) => `return:${outcome.orderId}:${outcome.lineItemId}`),
    ...refunds.map((outcome) => `refund:${outcome.orderId}:${outcome.lineItemId}`),
  ]);

  for (const plan of RELTEST_OUTCOME_PLANS) {
    const order = orders.find((candidate) => orderHasTag(candidate, plan.orderTag));
    if (!order) continue;
    const lineItem = order.lineItems.find((item) => item.productKey === plan.productKey);
    if (!lineItem) continue;
    const outcomeKey = `${plan.type}:${order.id}:${lineItem.id}`;
    if (outcomeKeys.has(outcomeKey)) continue;
    if (plan.type === "return" && !lineItem.fulfillmentLineItemId) continue;

    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: `mock_dataset.reltest_${plan.type}_create_started`,
      message: `Creating RELTEST ${plan.type} for ${lineItem.productTitle || lineItem.title}.`,
      data: { orderName: order.name, orderTag: plan.orderTag, lineItemId: lineItem.id, productKey: lineItem.productKey },
    });

    if (plan.type === "return") {
      const result = await createReturn(context, order, lineItem, plan);
      if (result?.id) {
        outcomeKeys.add(outcomeKey);
        returns.push({
          orderId: order.id,
          orderName: order.name,
          lineItemId: lineItem.id,
          productKey: lineItem.productKey,
          productTitle: lineItem.productTitle,
          returnReason: plan.returnReason,
          note: plan.note,
          theme: plan.theme,
          id: result.id,
        });
        await onOutcome?.({ returns, refunds });
      }
    }

    if (plan.type === "refund") {
      const result = await createRefund(context, order, lineItem, plan, currencyCode);
      if (result?.id) {
        outcomeKeys.add(outcomeKey);
        refunds.push({
          orderId: order.id,
          orderName: order.name,
          lineItemId: lineItem.id,
          productKey: lineItem.productKey,
          productTitle: lineItem.productTitle,
          note: plan.note,
          theme: plan.theme,
          quantity: plan.quantity || 1,
          id: result.id,
        });
        await onOutcome?.({ returns, refunds });
      }
    }
  }

  return { returns: dedupeOutcomes(returns), refunds: dedupeOutcomes(refunds) };
}

function orderHasTag(order, tag) {
  return (order.plan?.tags || []).some((value) => String(value || "").toLowerCase() === String(tag || "").toLowerCase());
}

function areOutcomeTargetsSatisfied(targets, counts) {
  return [...targets.entries()].every(([productKey, target]) => Number(counts.get(productKey) || 0) >= Number(target || 0));
}

async function createMockEvolutionBatch(context, products, location, currencyCode, { baseCreatedAt, orderDelayMs, customers = [] }) {
  const batchId = "recent-watchlist-evolution-v1";
  const createdAt = new Date();
  const plans = attachCustomersToOrderPlans(buildEvolutionOrderPlans(products, currencyCode, createdAt, batchId), customers);
  const orders = await loadOrCreateMockEvolutionOrders(context, plans, location, currencyCode, orderDelayMs);
  const ordersWithOutcomes = await fetchGeneratedEvolutionOrders(context, products, plans, currencyCode, { includeOutcomes: true });
  const outcomes = await createEvolutionReturnsAndRefunds(context, ordersWithOutcomes, plans, currencyCode);
  const scenarios = buildEvolutionScenarioDocs(products, plans, outcomes);

  await updateMockDatasetState(context, {
    evolutionBatch: {
      batchId,
      generatedAt: createdAt.toISOString(),
      baseDatasetGeneratedAt: baseCreatedAt?.toISOString?.() || null,
      orderCount: orders.length,
      returnCount: outcomes.returns.length,
      refundCount: outcomes.refunds.length,
      scenarios,
    },
  });

  return {
    batchId,
    generatedAt: createdAt.toISOString(),
    orders,
    returns: outcomes.returns,
    refunds: outcomes.refunds,
    scenarios,
  };
}

async function loadOrCreateMockEvolutionOrders(context, plans, location, currencyCode, orderDelayMs) {
  const fetchedExistingOrders = await fetchGeneratedEvolutionOrders(context, [], plans, currencyCode);
  const { reusableOrders: existingOrders, skippedEvolutionIndexes } = await splitReusableGeneratedOrders(context, fetchedExistingOrders, "recent evolution mock orders");
  const existingByIndex = new Map(existingOrders.map((order) => [order.plan?.evolutionIndex, order]).filter(([index]) => Number.isInteger(index)));
  const orders = [];
  let createdCount = 0;
  let reusedCount = 0;
  let skippedLegacyCustomerlessCount = 0;

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const existing = existingByIndex.get(plan.evolutionIndex);
    const replacingCustomerlessOrder = skippedEvolutionIndexes.has(plan.evolutionIndex);
    if (existing) {
      orders.push(existing);
      reusedCount += 1;
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        event: "mock_dataset.evolution_order_reused",
        message: `Reused recent evolution order ${index + 1} of ${plans.length}.`,
        data: { orderName: existing.name, evolutionIndex: plan.evolutionIndex + 1, productKeys: plan.items.map((item) => item.productKey) },
      });
    } else {
      if (replacingCustomerlessOrder) {
        skippedLegacyCustomerlessCount += 1;
        await recordJobLog({
          shop: context.shop,
          jobId: context.jobId,
          level: "warning",
          event: "mock_dataset.evolution_order_replacing_customerless",
          message: `Creating a customer-attributed replacement for legacy customerless recent evolution order ${index + 1} of ${plans.length}.`,
          data: { evolutionIndex: plan.evolutionIndex + 1, productKeys: plan.items.map((item) => item.productKey) },
        });
      }
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        event: "mock_dataset.evolution_order_create_started",
        message: replacingCustomerlessOrder
          ? `Creating replacement recent evolution order ${index + 1} of ${plans.length}.`
          : `Creating recent evolution order ${index + 1} of ${plans.length}.`,
        data: {
          evolutionIndex: plan.evolutionIndex + 1,
          processedAt: plan.processedAt,
          productKeys: plan.items.map((item) => item.productKey),
          outcomes: plan.outcomes.map((outcome) => `${outcome.type}:${outcome.productKey}`),
        },
      });
      const createdOrder = await createMockOrder(context, plan, location, currencyCode);
      orders.push(createdOrder);
      createdCount += 1;
      await recordJobLog({
        shop: context.shop,
        jobId: context.jobId,
        event: "mock_dataset.evolution_order_created",
        message: `Created recent evolution order ${index + 1} of ${plans.length}.`,
        data: { orderName: createdOrder.name, orderId: createdOrder.id, evolutionIndex: plan.evolutionIndex + 1 },
      });
      if (index < plans.length - 1 && orderDelayMs > 0) await wait(orderDelayMs);
    }

    await updateProgressForStage(context, "evolution", index + 1, plans.length + 8, `Prepared ${index + 1} of ${plans.length} recent evolution orders.`, {
      evolutionCreatedOrders: createdCount,
      evolutionReusedOrders: reusedCount,
      evolutionSkippedCustomerlessOrders: skippedLegacyCustomerlessCount,
    });
  }

  return orders;
}

async function fetchGeneratedEvolutionOrders(context, products, plans, currencyCode, { includeOutcomes = false } = {}) {
  const orders = [];
  let cursor = null;
  let page = 0;
  const ordersFirst = includeOutcomes ? GENERATED_ORDERS_WITH_OUTCOMES_PAGE_SIZE : GENERATED_ORDERS_PAGE_SIZE;
  const productsByVariantId = new Map((products || []).flatMap((product) => (
    (product.variants || []).map((variant) => [variant.id, { product, variant }])
  )));

  do {
    page += 1;
    const data = await shopifyGraphql(context.admin, buildGeneratedOrdersQuery(includeOutcomes), {
      query: `tag:${GENERATED_EVOLUTION_ORDER_TAG}`,
      after: cursor,
      ordersFirst,
      lineItemsFirst: GENERATED_ORDER_LINE_ITEMS_PAGE_SIZE,
      fulfillmentsFirst: GENERATED_ORDER_FULFILLMENTS_PAGE_SIZE,
      fulfillmentLineItemsFirst: GENERATED_ORDER_FULFILLMENT_LINE_ITEMS_PAGE_SIZE,
      ...(includeOutcomes ? {
        returnsFirst: GENERATED_ORDER_RETURNS_PAGE_SIZE,
        returnLineItemsFirst: GENERATED_ORDER_RETURN_LINE_ITEMS_PAGE_SIZE,
        refundLineItemsFirst: GENERATED_ORDER_REFUND_LINE_ITEMS_PAGE_SIZE,
      } : {}),
    }, includeOutcomes ? "Fetch existing recent evolution orders with outcomes" : "Fetch existing recent evolution orders");
    const nodes = data?.orders?.nodes || [];
    orders.push(...nodes);
    await recordJobLog({
      shop: context.shop,
      jobId: context.jobId,
      event: "mock_dataset.evolution_orders_page_loaded",
      message: `Loaded recent evolution orders page ${page}.`,
      data: {
        page,
        count: nodes.length,
        totalLoaded: orders.length,
        includeOutcomes,
        ordersFirst,
        cost: getGraphqlCostSummary(data),
      },
    });
    cursor = data?.orders?.pageInfo?.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (cursor);

  const plansByIndex = new Map(plans.map((plan) => [plan.evolutionIndex, plan]));
  return orders
    .map((order) => normalizeExistingEvolutionOrder(order, plansByIndex, productsByVariantId, currencyCode))
    .filter(Boolean);
}

function normalizeExistingEvolutionOrder(order, plansByIndex, productsByVariantId, currencyCode) {
  const plan = plansByIndex.get(getEvolutionOrderIndex(order));
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
  const lineItemsById = new Map(lineItems.map((lineItem) => [lineItem.id, lineItem]));
  const existingReturns = getConnectionNodes(order.returns).flatMap((itemReturn) => (
    getConnectionNodes(itemReturn.returnLineItems)
      .map((returnLineItem) => {
        const lineItemId = returnLineItem.fulfillmentLineItem?.lineItem?.id;
        const lineItem = lineItemsById.get(lineItemId);
        if (!lineItem) return null;
        return {
          id: itemReturn.id,
          returnLineItemId: returnLineItem.id,
          orderId: order.id,
          orderName: order.name,
          lineItemId,
          productKey: lineItem.productKey,
          productTitle: lineItem.productTitle,
          returnReason: returnLineItem.returnReason || null,
          note: returnLineItem.returnReasonNote || returnLineItem.customerNote || null,
          theme: "shopify-existing",
        };
      })
      .filter(Boolean)
  ));
  const existingRefunds = (order.refunds || []).flatMap((refund) => (
    getConnectionNodes(refund.refundLineItems)
      .map((refundLineItem) => {
        const lineItemId = refundLineItem.lineItem?.id;
        const lineItem = lineItemsById.get(lineItemId);
        if (!lineItem) return null;
        return {
          id: refund.id,
          refundLineItemId: refundLineItem.id,
          orderId: order.id,
          orderName: order.name,
          lineItemId,
          productKey: lineItem.productKey,
          productTitle: lineItem.productTitle,
          note: refund.note || null,
          theme: "shopify-existing",
          quantity: refundLineItem.quantity || 1,
        };
      })
      .filter(Boolean)
  ));

  return {
    id: order.id,
    name: order.name,
    processedAt: order.processedAt,
    customerId: order.customer?.id || null,
    customerKey: order.customer?.id || null,
    lineItems,
    plan: { ...plan, currencyCode, customerId: order.customer?.id || plan.customerId || null },
    existingOutcomes: {
      returns: existingReturns,
      refunds: existingRefunds,
    },
  };
}

function getEvolutionOrderIndex(order) {
  const tagIndex = (order.tags || [])
    .map((tag) => String(tag || "").match(/^ppgen-evolution-order-(\d+)$/i)?.[1])
    .find(Boolean);
  const noteIndex = String(order.note || "").match(/ProductPulse recent evolution order\s+(\d+)/i)?.[1];
  const index = Number(tagIndex || noteIndex || 0);
  return Number.isFinite(index) && index > 0 ? index - 1 : null;
}

async function createEvolutionReturnsAndRefunds(context, orders, plans, currencyCode) {
  const returns = collectExistingOutcomesFromOrders(orders).returns;
  const refunds = collectExistingOutcomesFromOrders(orders).refunds;
  const outcomeKeys = new Set([
    ...returns.map((outcome) => `return:${outcome.orderId}:${outcome.lineItemId}`),
    ...refunds.map((outcome) => `refund:${outcome.orderId}:${outcome.lineItemId}`),
  ]);
  const planByIndex = new Map(plans.map((plan) => [plan.evolutionIndex, plan]));

  for (let orderIndex = 0; orderIndex < orders.length; orderIndex += 1) {
    const order = orders[orderIndex];
    const plan = planByIndex.get(order.plan?.evolutionIndex);
    if (!plan) continue;
    for (const plannedOutcome of plan.outcomes) {
      const lineItem = order.lineItems.find((item) => item.productKey === plannedOutcome.productKey);
      if (!lineItem) continue;
      const outcomeKey = `${plannedOutcome.type}:${order.id}:${lineItem.id}`;
      if (outcomeKeys.has(outcomeKey)) continue;
      if (plannedOutcome.type === "return") {
        const result = await createReturn(context, order, lineItem, plannedOutcome);
        if (result?.id) {
          outcomeKeys.add(outcomeKey);
          returns.push({
            orderId: order.id,
            orderName: order.name,
            lineItemId: lineItem.id,
            productKey: lineItem.productKey,
            productTitle: lineItem.productTitle,
            returnReason: plannedOutcome.returnReason,
            note: plannedOutcome.note,
            theme: plannedOutcome.theme,
            id: result.id,
          });
        }
      }
      if (plannedOutcome.type === "refund") {
        const result = await createRefund(context, order, lineItem, plannedOutcome, currencyCode);
        if (result?.id) {
          outcomeKeys.add(outcomeKey);
          refunds.push({
            orderId: order.id,
            orderName: order.name,
            lineItemId: lineItem.id,
            productKey: lineItem.productKey,
            productTitle: lineItem.productTitle,
            note: plannedOutcome.note,
            theme: plannedOutcome.theme,
            quantity: plannedOutcome.quantity || 1,
            id: result.id,
          });
        }
      }
    }
    await updateProgressForStage(context, "evolution", plans.length + orderIndex + 1, plans.length + orders.length + 4, `Prepared recent returns and refunds for ${orderIndex + 1} of ${orders.length} evolution orders.`);
  }

  await recordJobLog({
    shop: context.shop,
    jobId: context.jobId,
    event: "mock_dataset.evolution_outcomes_completed",
    message: "Recent evolution returns and refunds are ready.",
    data: { returnCount: returns.length, refundCount: refunds.length },
  });

  return { returns: dedupeOutcomes(returns), refunds: dedupeOutcomes(refunds) };
}

function buildEvolutionOrderPlans(products, currencyCode, createdAt, batchId) {
  const byKey = new Map(products.map((product) => [product.key, product]));
  const specs = [
    { key: "night-watch-print", daysAgo: 14, count: 1 },
    { key: "premium-keyboard", daysAgo: 13, count: 2 },
    { key: "puzzle-calm", daysAgo: 12, count: 2 },
    { key: "travel-mug-leak", daysAgo: 11, count: 1, outcome: "return", note: "Other: New gasket batch leaked immediately during commute.", reason: "OTHER", theme: "leak" },
    { key: "soft-yoga-mat", daysAgo: 10, count: 1 },
    { key: "ceramic-dinner-set", daysAgo: 9, count: 1 },
    { key: "linen-shirt-fit", daysAgo: 8, count: 1, variantHint: "M", outcome: "return", note: "Exchange requested: Medium White still runs small after one cold wash, so support sent size Large.", reason: "SIZE_TOO_SMALL", theme: "fit-exchange" },
    { key: "smart-planter", daysAgo: 8, count: 1, outcome: "refund", note: "Compatibility refund: buyer only has 5 GHz Wi-Fi and missed the setup limitation.", theme: "compatibility" },
    { key: "travel-mug-leak", daysAgo: 7, count: 1, outcome: "return", note: "Other: Lid seal failed near a laptop and customer asked for a return.", reason: "OTHER", theme: "leak" },
    { key: "earbuds-color", daysAgo: 7, count: 1, variantHint: "Rose", outcome: "return", note: "Exchange requested: Rose variant still looks copper compared with current PDP photos, so support sent Black.", reason: "COLOR", theme: "color-exchange" },
    { key: "desk-fan-mismatch", daysAgo: 6, count: 1 },
    { key: "night-watch-print", daysAgo: 6, count: 1, outcome: "return", note: "Other: The darker print made the hallway feel frightening after installation.", reason: "OTHER", theme: "fear" },
    { key: "premium-keyboard", daysAgo: 6, count: 1 },
    { key: "travel-mug-leak", daysAgo: 5, count: 2, outcome: "refund", note: "Partial refund after second leak report on the updated gasket batch.", theme: "leak" },
    { key: "ceramic-dinner-set", daysAgo: 5, count: 1 },
    { key: "linen-shirt-fit", daysAgo: 5, count: 1 },
    { key: "puzzle-calm", daysAgo: 4, count: 1 },
    { key: "travel-mug-leak", daysAgo: 4, count: 1, outcome: "return", note: "Other: Third recent leak note; customer says the leakproof promise is unsafe for commuting.", reason: "OTHER", theme: "leak" },
    { key: "soft-yoga-mat", daysAgo: 4, count: 1 },
    { key: "night-watch-print", daysAgo: 3, count: 1, outcome: "return", note: "Other: Buyer says the room feels too dark and heavy with the print installed.", reason: "OTHER", theme: "fear" },
    { key: "smart-planter", daysAgo: 3, count: 1, outcome: "return", note: "Not as described: app language and 2.4 GHz Wi-Fi requirements were missed before purchase.", reason: "NOT_AS_DESCRIBED", theme: "compatibility" },
    { key: "ceramic-dinner-set", daysAgo: 2, count: 1 },
    { key: "desk-fan-mismatch", daysAgo: 2, count: 1 },
    { key: "linen-shirt-fit", daysAgo: 1, count: 1 },
    { key: "premium-keyboard", daysAgo: 1, count: 2 },
    { key: "earbuds-color", daysAgo: 1, count: 1 },
    { key: "voice-lock-safe", daysAgo: 10, count: 1, variantHint: "Oak", outcome: "return", note: "Other: Oak voice safe opened to a television phrase and ignored the registered owner the next morning.", reason: "OTHER", theme: "voice-security" },
    { key: "voice-lock-safe", daysAgo: 4, count: 1, variantHint: "Oak", outcome: "refund", note: "Refund after customer stopped trusting Oak voice unlock because of false-open and battery-drain reports.", theme: "voice-security" },
    { key: "voice-lock-safe", daysAgo: 1, count: 1, variantHint: "Matte" },
    { key: "cooling-pillow", daysAgo: 9, count: 2, variantHint: "High", outcome: "return", note: "Not as described: High Loft Ice Blue was too tall, smelled sharp, and stopped cooling by morning.", reason: "NOT_AS_DESCRIBED", theme: "cooling-comfort" },
    { key: "cooling-pillow", daysAgo: 3, count: 1, variantHint: "Ice", outcome: "refund", note: "Partial refund after buyer kept the cover but rejected the damp cooling insert.", theme: "cooling-odor" },
    { key: "cooling-pillow", daysAgo: 1, count: 1, variantHint: "Low" },
    { key: "inflatable-standing-desk", daysAgo: 8, count: 1, variantHint: "Tall", outcome: "return", note: "Other: Tall Kit lost air during a call and the laptop started sliding toward the edge.", reason: "OTHER", theme: "tall-kit-wobble" },
    { key: "inflatable-standing-desk", daysAgo: 4, count: 1, variantHint: "Tall", outcome: "refund", note: "Refund after video showed the Tall Kit deflating under normal typing pressure.", theme: "air-leak" },
    { key: "inflatable-standing-desk", daysAgo: 2, count: 1, variantHint: "Travel" },
    { key: "smart-luggage-tag", daysAgo: 7, count: 3, variantHint: "Citrus", outcome: "return", note: "Not as described: Citrus tag exposed more QR profile detail than expected and still was not live GPS.", reason: "NOT_AS_DESCRIBED", theme: "qr-privacy" },
    { key: "smart-luggage-tag", daysAgo: 3, count: 2, variantHint: "Carbon", outcome: "refund", note: "Refund for wrong-city location alert during travel and scan-based tracking confusion.", theme: "tracking-expectation" },
    { key: "smart-luggage-tag", daysAgo: 1, count: 2, variantHint: "Cloud" },
    { key: "coffee-alarm-brewer", daysAgo: 6, count: 1, variantHint: "Cream", outcome: "return", note: "Other: Cream unit brewed before the alarm, stained the side, and left condensation on the nightstand.", reason: "OTHER", theme: "cream-condensation" },
    { key: "coffee-alarm-brewer", daysAgo: 2, count: 1, variantHint: "Graphite", outcome: "refund", note: "Goodwill refund for clock drift and silent alarm after firmware reset did not hold.", theme: "schedule-drift" },
    { key: "coffee-alarm-brewer", daysAgo: 1, count: 2, variantHint: "Cream" },
  ];

  return specs.map((spec, index) => {
    const product = byKey.get(spec.key);
    if (!product) throw new Error(`Missing generated product for evolution batch: ${spec.key}`);
    const variant = pickVariantForEvolution(product, index, spec.variantHint);
    const processedAt = new Date(createdAt.getTime() - spec.daysAgo * 24 * 60 * 60 * 1000 + (index % 5) * 90 * 60 * 1000);
    const items = [{
      productKey: product.key,
      productTitle: product.title,
      handle: product.handle,
      variantId: variant.id,
      variantTitle: variant.title,
      sku: variant.sku,
      quantity: spec.count,
      unitPrice: Number(variant.price || 0),
    }];
    const outcomes = spec.outcome ? [{
      type: spec.outcome,
      productKey: spec.key,
      returnReason: spec.reason || "OTHER",
      note: spec.note,
      theme: spec.theme,
      quantity: 1,
    }] : [];
    return ensureOrderPlanCustomerProfileKey({
      index: 1000 + index,
      evolutionIndex: index,
      phase: "evolution",
      processedAt: processedAt.toISOString(),
      currencyCode,
      note: `ProductPulse recent evolution order ${index + 1}. ${batchId}. Designed for Watchlist change-report testing.`,
      tags: [GENERATED_EVOLUTION_ORDER_TAG, `ppgen-evolution-order-${index + 1}`, batchId],
      items,
      outcomes,
      total: items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    });
  });
}

function pickVariantForEvolution(product, index, hint) {
  const variants = product.variants || [];
  if (!variants.length) throw new Error(`Product ${product.title} has no variants after creation.`);
  if (hint) {
    const normalizedHint = String(hint).toLowerCase();
    const matched = variants.find((variant) => String(variant.title || "").toLowerCase().includes(normalizedHint)
      || String(variant.sku || "").toLowerCase().includes(normalizedHint));
    if (matched) return matched;
  }
  return variants[index % variants.length];
}

function buildEvolutionScenarioDocs(products, plans, outcomes) {
  return products.map((product) => {
    const productPlans = plans.filter((plan) => plan.items.some((item) => item.productKey === product.key));
    const productReturns = outcomes.returns.filter((outcome) => outcome.productKey === product.key);
    const productRefunds = outcomes.refunds.filter((outcome) => outcome.productKey === product.key);
    return {
      productKey: product.key,
      title: product.title,
      handle: product.handle,
      expectedWatchlistChange: getEvolutionExpectedChange(product.key),
      newOrders: productPlans.length,
      newUnits: productPlans.flatMap((plan) => plan.items).filter((item) => item.productKey === product.key).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      newReturns: productReturns.length,
      newRefunds: productRefunds.length,
      newThemes: [...new Set([...productReturns, ...productRefunds].map((outcome) => outcome.theme).filter(Boolean))],
    };
  });
}

function getEvolutionExpectedChange(productKey) {
  const changes = {
    "night-watch-print": "Worsens: fresh subjective fear returns should increase risk and keep description/expectation guidance relevant.",
    "puzzle-calm": "Improves/stays healthy: positive recent sales and reviews should not create new risk actions.",
    "travel-mug-leak": "Worsens sharply: new leak returns and a refund should surface as an emerging gasket/lid issue.",
    "soft-yoga-mat": "Stabilizes: recent sales without new returns should soften the forecast.",
    "earbuds-color": "Small new variant issue: Rose color mismatch should remain variant/media-specific.",
    "smart-planter": "New compatibility friction: Wi-Fi/app-language notes should surface before becoming severe.",
    "linen-shirt-fit": "Ongoing fit issue: Medium White should continue to show variant-specific sizing friction.",
    "ceramic-dinner-set": "Improves: new sales without damage refunds should show packaging risk cooling.",
    "desk-fan-mismatch": "Source-integrity issue grows through reviews, not orders or returns.",
    "premium-keyboard": "Improves momentum with clean orders and positive reviews; should remain low risk.",
    "voice-lock-safe": "Worsens: recent Oak voice-lock evidence should raise a safety/trust issue with variant concentration.",
    "cooling-pillow": "Mixed: recent High Loft and insert complaints should keep the synthesis honest about contradictory cooling evidence.",
    "inflatable-standing-desk": "Worsens sharply: Tall Kit wobble and air-loss returns should surface as a QA and copy-clarity issue.",
    "smart-luggage-tag": "Mixed: bundle sales continue, but tracking and QR privacy complaints should separate expectation mismatch from source integrity.",
    "coffee-alarm-brewer": "Worsens: fresh timing and condensation evidence should outweigh older novelty praise.",
  };
  return changes[productKey] || "Recent evolution added for watchlist testing.";
}


function collectExistingOutcomesFromOrders(orders) {
  return orders.reduce((accumulator, order) => {
    accumulator.returns.push(...(order.existingOutcomes?.returns || []));
    accumulator.refunds.push(...(order.existingOutcomes?.refunds || []));
    return accumulator;
  }, { returns: [], refunds: [] });
}

function dedupeOutcomes(outcomes) {
  const seen = new Set();
  return outcomes.filter((outcome) => {
    const key = outcome.id
      ? `id:${outcome.id}`
      : `line:${outcome.orderId || ""}:${outcome.lineItemId || ""}:${outcome.returnReason || ""}:${outcome.note || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      "Exchange requested: Medium White runs small around shoulders, so the customer returned it and the shop sent size Large.",
      "The fit copy says relaxed, but the Medium White shirt is tight after washing.",
      "I ordered my usual Medium and could not button the chest comfortably.",
    ];
    return { returnReason: "SIZE_TOO_SMALL", note: notes[productReturnCount % notes.length], theme: "fit" };
  }
  if (lineItem.productKey === "earbuds-color" && lineItem.variantTitle?.toLowerCase().includes("rose") && phase !== "baseline") {
    const notes = [
      "Exchange requested: Rose color looks copper, so the customer returned it and the shop sent the Black variant.",
      "Rose color looks copper and not like the product images.",
    ];
    return { returnReason: "COLOR", note: notes[productReturnCount % notes.length], theme: "color" };
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
  if (lineItem.productKey === "voice-lock-safe" && phase !== "baseline") {
    const oak = lineItem.variantTitle?.toLowerCase().includes("oak");
    const notes = oak ? [
      "Other: Oak voice safe opened when a TV said a similar phrase, then refused my own voice after I had a cold.",
      "Not as described: Oak finish unit heard the wrong person but ignored the registered unlock phrase twice.",
      "Other: Battery dropped overnight and the voice lock made me less confident storing documents.",
    ] : [
      "Other: Voice unlock worked one day and then locked me out until keypad reset.",
      "Not as described: It is a safe, but I do not trust a lock that argues with my voice.",
    ];
    return { returnReason: productReturnCount % 2 === 0 ? "OTHER" : "NOT_AS_DESCRIBED", note: notes[productReturnCount % notes.length], theme: oak ? "oak-voice-security" : "voice-security" };
  }
  if (lineItem.productKey === "cooling-pillow" && phase !== "baseline") {
    const high = lineItem.variantTitle?.toLowerCase().includes("high loft");
    const notes = high ? [
      "Other: High Loft pushed my neck up while the cooling insert felt damp and then warm.",
      "Not as described: High Loft Ice Blue was too tall, smelled sharp, and was not cooling by morning.",
    ] : [
      "Other: The pillow was icy at first, then weirdly hot, and the insert smelled like a pool bag.",
      "Not as described: Cooling claim was inconsistent; one side felt wet and the other side felt warm.",
    ];
    return { returnReason: productReturnCount % 2 === 0 ? "OTHER" : "NOT_AS_DESCRIBED", note: notes[productReturnCount % notes.length], theme: high ? "high-loft-comfort" : "cooling-odor" };
  }
  if (lineItem.productKey === "inflatable-standing-desk" && phase !== "baseline") {
    const tall = lineItem.variantTitle?.toLowerCase().includes("tall kit");
    const notes = tall ? [
      "Other: Tall Kit slowly lost air during a call and the laptop started sliding toward the edge.",
      "Not as described: Tall Kit was too wobbly for typing but somehow still not tall enough for standing.",
      "Other: The desk sighed itself flat after lunch. Funny once, not useful for work.",
    ] : [
      "Other: Air chamber would not hold pressure and the surface tilted toward the keyboard.",
      "Not as described: Portable idea is clever, but the desk flexed too much for normal work.",
    ];
    return { returnReason: productReturnCount % 2 === 0 ? "OTHER" : "NOT_AS_DESCRIBED", note: notes[productReturnCount % notes.length], theme: tall ? "tall-kit-wobble" : "air-leak" };
  }
  if (lineItem.productKey === "smart-luggage-tag" && phase !== "baseline") {
    const citrus = lineItem.variantTitle?.toLowerCase().includes("citrus");
    const notes = citrus ? [
      "Other: Citrus QR profile showed more contact detail than expected and made the buyer nervous.",
      "Not as described: Citrus tag reported the bag in a city I never visited, then updated two days late.",
    ] : [
      "Other: The tag is not GPS but the page made it sound more live than scan-based tracking.",
      "Not as described: Battery and location alerts were inconsistent across the trip.",
    ];
    return { returnReason: productReturnCount % 2 === 0 ? "OTHER" : "NOT_AS_DESCRIBED", note: notes[productReturnCount % notes.length], theme: citrus ? "qr-privacy" : "tracking-expectation" };
  }
  if (lineItem.productKey === "coffee-alarm-brewer" && phase !== "baseline") {
    const cream = lineItem.variantTitle?.toLowerCase().includes("cream");
    const notes = cream ? [
      "Other: Cream unit brewed before the alarm, left condensation rings, and stained the side panel.",
      "Not as described: It made coffee at 3 a.m. once and stayed silent on the morning I needed it.",
    ] : [
      "Other: Clock drifted enough that the brew time moved around all week.",
      "Not as described: Alarm was quiet, coffee was cold, and the timing felt random.",
    ];
    return { returnReason: productReturnCount % 2 === 0 ? "OTHER" : "NOT_AS_DESCRIBED", note: notes[productReturnCount % notes.length], theme: cream ? "cream-condensation" : "schedule-drift" };
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
  if (lineItem.productKey === "voice-lock-safe" && ["friction", "current"].includes(phase)) {
    const notes = [
      "Refund after voice lock opened to a similar voice phrase and customer no longer trusted the safe.",
      "Goodwill refund for Oak unit battery drain and false-open report.",
    ];
    return { note: notes[productRefundCount % notes.length], theme: "voice-security", quantity: 1 };
  }
  if (lineItem.productKey === "cooling-pillow" && ["growth", "friction", "current"].includes(phase)) {
    const notes = [
      "Partial refund after customer kept the cover but rejected the cooling insert because of odor.",
      "Refund for High Loft neck-angle complaint plus damp cooling insert report.",
    ];
    return { note: notes[productRefundCount % notes.length], theme: "cooling-comfort", quantity: 1 };
  }
  if (lineItem.productKey === "inflatable-standing-desk" && ["friction", "current"].includes(phase)) {
    const notes = [
      "Refund issued after air chamber leak made the desk unsafe for a laptop.",
      "Partial refund because buyer kept the pump but the Tall Kit would not hold pressure.",
      "Refund for wobble complaint after customer sent video of the desk deflating.",
    ];
    return { note: notes[productRefundCount % notes.length], theme: "air-leak", quantity: 1 };
  }
  if (lineItem.productKey === "smart-luggage-tag" && ["friction", "current"].includes(phase)) {
    const notes = [
      "Refund for scan-based tracking expectation mismatch; customer thought it was live GPS.",
      "Privacy refund after QR profile exposed more owner detail than expected.",
    ];
    return { note: notes[productRefundCount % notes.length], theme: "tracking-privacy", quantity: 1 };
  }
  if (lineItem.productKey === "coffee-alarm-brewer" && ["growth", "friction", "current"].includes(phase)) {
    const notes = [
      "Refund after timed brew ran hours early and left condensation on the nightstand.",
      "Goodwill refund for schedule drift and silent alarm complaint.",
    ];
    return { note: notes[productRefundCount % notes.length], theme: "schedule-drift", quantity: 1 };
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
      const ageDays = getReviewAgeDays(product, index, count);
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

export const __productPulseShopifyMockDatasetTestHooks = {
  MOCK_PRODUCTS,
  RELTEST_CUSTOMERS,
  RELTEST_PRODUCT_KEYS,
  RELTEST_ORDER_TAG,
  RELTEST_ORDER_COUNT,
  SHOPIFY_MOCK_DATASET_CUSTOMER_COUNT,
  RELTEST_OUTCOME_PLANS,
  attachCustomersToOrderPlans,
  buildEvolutionOrderPlans,
  buildOrderPlans,
  buildReviewRows,
};

function getReviewAgeDays(product, index, count) {
  const progress = index / Math.max(1, count - 1);
  if (STRESS_PRODUCT_KEYS.has(product.key)) {
    return Math.max(0, Math.round(330 - progress * 330));
  }
  return Math.round(295 - progress * 285);
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
  if (product.key === "voice-lock-safe") return progress > 0.25 ? index % 2 === 0 || index % 5 === 0 : index % 7 === 0;
  if (product.key === "cooling-pillow") return index % 3 === 0 || (progress > 0.5 && index % 2 === 0) || (progress > 0.82 && index % 5 === 0);
  if (product.key === "inflatable-standing-desk") return progress > 0.28 ? index % 2 === 0 || index % 3 === 0 : index % 6 === 0;
  if (product.key === "smart-luggage-tag") return progress > 0.35 ? index % 2 === 0 || index % 7 === 0 : index % 8 === 0;
  if (product.key === "coffee-alarm-brewer") return progress > 0.32 ? index % 2 === 0 || index % 3 === 0 : index % 6 === 0;
  if (product.key === "reltest-source-product") return [2, 4, 6, 8, 10, 11].includes(index);
  if (product.key === "reltest-bought-together-product") return index === 5;
  if (product.key === "reltest-multi-variant-product") return index === 2;
  if (product.key === "reltest-bulk-quantity-product") return index === 3;
  if (product.key === "reltest-return-refund-product") return index % 2 === 0 || index === 7;
  if (product.key === "reltest-refund-only-product") return index % 2 === 0;
  const threshold = Math.round(product.reviewProfile.count * product.reviewProfile.negativeRate);
  return index < threshold;
}

function getReviewRating(product, index, negative, progress) {
  if (!negative) return index % 7 === 0 ? 4 : 5;
  if (product.key === "travel-mug-leak" && progress > 0.55) return index % 3 === 0 ? 1 : 2;
  if (product.key === "night-watch-print" && progress > 0.65) return index % 3 === 0 ? 1 : 2;
  if (product.key === "desk-fan-mismatch" && progress > 0.68) return index % 4 === 0 ? 1 : 2;
  if (product.key === "voice-lock-safe" && progress > 0.45) return index % 4 === 0 ? 1 : 2;
  if (product.key === "inflatable-standing-desk" && progress > 0.4) return index % 3 === 0 ? 1 : 2;
  if (product.key === "coffee-alarm-brewer" && progress > 0.5) return index % 3 === 0 ? 1 : 2;
  if (product.key === "reltest-return-refund-product") return index % 3 === 0 ? 1 : 2;
  if (product.key === "reltest-refund-only-product") return index % 2 === 0 ? 2 : 3;
  if (product.key === "reltest-source-product") return index % 4 === 0 ? 2 : 3;
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
    "voice-lock-safe": progress > 0.55 ? "Opened for the wrong voice" : "Voice lock feels inconsistent",
    "cooling-pillow": "Cooling evidence is all over the place",
    "inflatable-standing-desk": "The desk slowly deflated",
    "smart-luggage-tag": progress > 0.55 ? "Wrong city and privacy worries" : "Not live GPS like I expected",
    "coffee-alarm-brewer": progress > 0.55 ? "Brewed at the wrong time" : "Great idea, unreliable timing",
    "reltest-source-product": "RELTEST bundle made the source confusing",
    "reltest-bought-together-product": "Bundle wording needs context",
    "reltest-multi-variant-product": "Variant mix was unclear",
    "reltest-bulk-quantity-product": "Quantity expectation was unclear",
    "reltest-return-refund-product": "Returned and waiting on resolution",
    "reltest-refund-only-product": "Refund helped but I did not return it",
  };
  return titles[product.key] || "Not what I expected";
}

function getPositiveReviewTitle(product, progress) {
  if (product.key === "premium-keyboard") return "Excellent build quality";
  if (product.key === "puzzle-calm") return "Clear listing and great gift";
  if (product.key === "ceramic-dinner-set" && progress > 0.78) return "Arrived safely after packaging change";
  if (product.key === "voice-lock-safe") return "Convenient after careful setup";
  if (product.key === "cooling-pillow") return "Comfortable once aired out";
  if (product.key === "inflatable-standing-desk") return "Clever for tiny spaces";
  if (product.key === "smart-luggage-tag") return "Recovered my suitcase";
  if (product.key === "coffee-alarm-brewer") return "Morning ritual worked";
  if (product.key?.startsWith("reltest-")) return "RELTEST scenario behaved as expected";
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
      "voice-lock-safe": phase === "baseline"
        ? "The Matte Black safe worked after I trained the phrase twice. The keypad backup was clear, and for a closet safe it felt convenient."
        : "After retraining in a quiet room, the safe opened reliably for me. I would still make the voice setup warning louder because small changes in voice seem to matter.",
      "cooling-pillow": "After airing out the insert for a day, the Low Loft pillow felt comfortable. It was cool at first, then normal, which is what I wanted rather than an ice pack.",
      "inflatable-standing-desk": "For a tiny apartment, the Starter kit was useful as a temporary riser. I would not put a heavy monitor on it, but the lightweight laptop setup worked for short sessions.",
      "smart-luggage-tag": "The Cloud tag helped a baggage desk contact me after a scan. I understood it was not live GPS, so the delayed update did not surprise me.",
      "coffee-alarm-brewer": "The Graphite unit brewed near my alarm time after setup, and waking up to the smell was fun. I keep it on a tray because it is still a water appliance.",
      "reltest-source-product": "RELTEST source order matched the scenario. The source product was easy to inspect and the basket context was visible in the related order.",
      "reltest-bought-together-product": "RELTEST companion product was bought with the source product and the bundle made sense in this order.",
      "reltest-bought-before-product": "RELTEST before product exists for sequence testing, and the generated Shopify order is tied to the same fake customer who later buys the source product.",
      "reltest-bought-after-product": "RELTEST after product exists for sequence testing, and the generated Shopify order is tied to the same fake customer who previously bought the source product.",
      "reltest-multi-variant-product": "RELTEST multi-variant product made the basket easier to inspect because the Alpha and Beta variant labels were clear.",
      "reltest-bulk-quantity-product": "RELTEST bulk companion product had clear case quantity expectations.",
      "reltest-return-refund-product": "RELTEST resolution product was useful for checking how a return and refund are matched on the same line item.",
      "reltest-refund-only-product": "RELTEST refund-only product helped verify a goodwill refund without a physical return.",
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
    "voice-lock-safe": [
      "The Oak voice safe opened when the TV said a phrase that only sounded close to mine, then refused my actual voice after I had a cold. That is too strange for something sold as a safe.",
      "I like the idea, but the lock made me trust it less. One review says it saved time, mine locked me out, and support told me to retrain it in a silent room.",
      "Battery dropped overnight and the voice sensor behaved differently every morning. The keypad worked, so the box is not useless, but the voice claim is the risk.",
      "Matte Black was okay for my partner, Oak failed for me. This feels variant or microphone-batch specific and should not be summarized as normal user error.",
    ],
    "cooling-pillow": [
      "The pillow was too cold for ten minutes, then warm, then somehow damp. I cannot tell if the insert is brilliant or broken, but the page promises a simple cooling story that my sleep did not match.",
      "High Loft Ice Blue lifted my neck too high and smelled sharp. Another reviewer says it was not cold enough, while mine felt like a cold wet towel at first.",
      "The Low Loft cover felt nice, but the gel insert smelled like a pool bag. I kept the cover and stopped using the insert, which makes the product hard to rate honestly.",
      "It is not exactly bad and not exactly good. I woke up warm on one side and chilly on the other, so the cooling claim needs a lot more expectation-setting.",
    ],
    "inflatable-standing-desk": [
      "The Tall Kit slowly sighed itself flat during a video call. My laptop started sliding and I spent the rest of the meeting holding the corner like a steering wheel.",
      "This product sounds fake but it is real enough to be annoying. It inflated, wobbled, worked for ten minutes, then tilted toward the keyboard.",
      "Starter kit was clever for a tiny desk, but the Tall Kit is both too tall for typing and not tall enough for standing. I know that sounds impossible; that is what happened.",
      "The pump is useful, the desk chamber is not. Air leaked from the seam and I do not want to test gravity with a laptop again.",
    ],
    "smart-luggage-tag": [
      "I thought this was live GPS. The tag updated only after scans and once showed a city I never visited, so the travel anxiety got worse instead of better.",
      "Citrus QR profile looked cute, but the scan page exposed more contact detail than I expected. The product needs clearer privacy defaults before a stranger scans it.",
      "One review talks about a collar and walking routes, not luggage. If that text belongs to a different source, please do not use it to rewrite this travel tag listing.",
      "It did help one bag get returned, but the Carbon tag battery warning appeared right before a trip. The evidence is mixed in a way the page does not explain.",
    ],
    "coffee-alarm-brewer": [
      "The Cream unit brewed at 3 a.m. and the alarm stayed silent at 7. I woke up to cold coffee, a wet nightstand and a burnt smell that made no sense.",
      "Graphite worked after reset for two days, then the clock drifted again. The idea is charming, but time is the one feature this product cannot be casual about.",
      "It brewed before the alarm and stained the Cream side panel. The cup tray is fine, but I do not trust the schedule near books or electronics.",
      "Some mornings it was delightful, some mornings it sounded like it was whispering steam into the dark. The listing should warn about condensation and firmware reset steps.",
    ],
    "reltest-source-product": [
      "RELTEST source product became confusing when it was bought with the companion item. The order looked like a bundle, but the source page did not explain what belonged together.",
      "I bought two source variants in the same RELTEST order to compare them. The variant labels were visible, but the page should explain why shoppers might buy both.",
      "The RELTEST source product was fine alone, but the bought-together basket made the kit expectations unclear and led me to request a return.",
      "The bulk source quantity was easy to trigger, but it needs clearer guidance for customers buying four units at once.",
    ],
    "reltest-bought-together-product": [
      "RELTEST companion product is useful, but the source page should make the relationship more explicit so the bundle does not feel accidental.",
      "The bought-together item made sense after checkout, but before purchase I was not sure whether it was required or optional.",
    ],
    "reltest-multi-variant-product": [
      "RELTEST variant labels were close enough that I had to read the order details twice. This is useful for testing variant confusion evidence.",
      "Alpha and Beta sounded too similar in the RELTEST basket, so the variant context should stay visible in analysis.",
    ],
    "reltest-bulk-quantity-product": [
      "RELTEST bulk companion order made me question whether case quantity belonged to this item or the source product.",
      "The case quantity was not defective, but the basket made quantity expectations easy to misread.",
    ],
    "reltest-return-refund-product": [
      "RELTEST return/refund product arrived defective and I expected the refund to match the returned line item exactly.",
      "I returned the RELTEST resolution product but did not see a refund yet, so this should remain a return-only case.",
      "The product issue was concrete: defective part, return requested, and support should connect the refund to the same line item.",
    ],
    "reltest-refund-only-product": [
      "Support refunded the RELTEST refund-only product without asking me to return it, which should not be counted as a returned item.",
      "The refund solved the goodwill issue, but there was no physical return and the product stayed with me.",
    ],
  };
  const options = negativeTexts[product.key] || [`The product had issues with ${product.themes.join(", ")}.`];
  return options[index % options.length];
}

function buildEvolutionReviewRows(products, evolution, startSourceRow = 2) {
  const productByKey = new Map(products.map((product) => [product.key, product]));
  let sourceRow = startSourceRow;
  const generatedAt = new Date(evolution?.generatedAt || Date.now());
  const specs = [
    {
      key: "night-watch-print",
      daysAgo: 5,
      rating: 2,
      title: "Still too dark for a hallway",
      body: "The print quality is good, but the mood felt darker and heavier than the page suggested. After hanging it for a few days, the faces and shadows made the hallway feel unsettling instead of classic.",
      phase: "evolution_worsening",
    },
    {
      key: "night-watch-print",
      daysAgo: 2,
      rating: 1,
      title: "Frightening once installed",
      body: "This is not damaged, but it is much more frightening in a real room than I expected. The listing should clearly warn that the artwork is intense, dark, and not neutral wall decor.",
      phase: "evolution_worsening",
    },
    {
      key: "travel-mug-leak",
      daysAgo: 10,
      rating: 1,
      title: "New lid gasket still leaks",
      body: "I bought this after seeing the leakproof claim and the updated gasket still leaked inside my commute bag. The liquid came out near the button and made me nervous about carrying it near a laptop.",
      phase: "evolution_spike",
    },
    {
      key: "travel-mug-leak",
      daysAgo: 4,
      rating: 1,
      title: "Do not trust it in a backpack",
      body: "The mug looks nice, but the lid failed twice in one week. This feels like a specific gasket or seal issue, not just normal user error, and the product page should stop calling it leakproof.",
      phase: "evolution_spike",
    },
    {
      key: "smart-planter",
      daysAgo: 3,
      rating: 2,
      title: "Setup requirements need to be obvious",
      body: "The planter is attractive, but I missed that it needs 2.4 GHz Wi-Fi and that the app is English only. These requirements should be shown before checkout because they completely change whether the product works for a buyer.",
      phase: "evolution_new_issue",
    },
    {
      key: "desk-fan-mismatch",
      daysAgo: 6,
      rating: 2,
      title: "Reviews still look mismatched",
      body: "I bought a desk fan, but the recent review feed still talks about snowboards, bindings, mountain conditions, and boots. That makes it hard to trust the rating even if the actual fan is fine.",
      phase: "evolution_source_integrity",
    },
    {
      key: "desk-fan-mismatch",
      daysAgo: 1,
      rating: 2,
      title: "Wrong product language in review feed",
      body: "The product title says mini fan, yet the visible review text mentions boards and powder days. Please fix the source mapping before using these reviews as evidence against the fan.",
      phase: "evolution_source_integrity",
    },
    {
      key: "linen-shirt-fit",
      daysAgo: 2,
      rating: 2,
      title: "Medium White still runs small",
      body: "The Medium White shirt is tight in the shoulders after a cold wash. I like the fabric, but the fit note needs to be more direct and variant-specific so customers size up before ordering.",
      phase: "evolution_ongoing",
    },
    {
      key: "ceramic-dinner-set",
      daysAgo: 2,
      rating: 5,
      title: "Packaging looked much better",
      body: "The plates arrived safely with better separators and no chips. The glaze is beautiful, and this recent delivery makes me more confident that the shipping damage problem is being handled.",
      phase: "evolution_improving",
    },
    {
      key: "puzzle-calm",
      daysAgo: 3,
      rating: 5,
      title: "Still a very clear gift purchase",
      body: "The page made the piece count, finished size, reference poster, and resealable bag easy to understand. No surprises, and the recipient finished it without missing pieces.",
      phase: "evolution_healthy",
    },
    {
      key: "premium-keyboard",
      daysAgo: 1,
      rating: 5,
      title: "Sales Momentum feels deserved",
      body: "The keyboard feels premium and the switch options were clear before ordering. I bought a second unit because the build quality, accessories, and delivery matched the page exactly.",
      phase: "evolution_improving",
    },
    {
      key: "soft-yoga-mat",
      daysAgo: 4,
      rating: 4,
      title: "Great for stretching, not balance",
      body: "As long as you read it as a soft floor-work mat, it is comfortable and useful. The page could still separate stretching from balance flows more clearly, but my recent order was fine.",
      phase: "evolution_stabilizing",
    },
    {
      key: "earbuds-color",
      daysAgo: 1,
      rating: 3,
      title: "Rose still needs real-life photos",
      body: "The earbuds sound fine, but Rose is warmer and more copper than expected. This feels like a media and variant expectation issue rather than a general electronics quality problem.",
      phase: "evolution_variant_media",
    },
    {
      key: "voice-lock-safe",
      daysAgo: 4,
      rating: 1,
      title: "Oak opened for the wrong phrase",
      body: "The Oak voice safe opened when a TV voice sounded close to my phrase, then ignored me after I had a cold. I would treat this as a trust issue, not just a setup issue.",
      phase: "evolution_security_spike",
    },
    {
      key: "voice-lock-safe",
      daysAgo: 1,
      rating: 4,
      title: "Matte Black worked after retraining",
      body: "My Matte Black unit worked after I retrained the phrase in a quiet room. The contrast with Oak complaints makes me wonder whether the microphone batch or finish is part of the issue.",
      phase: "evolution_variant_split",
    },
    {
      key: "cooling-pillow",
      daysAgo: 5,
      rating: 2,
      title: "Too cold, then too warm",
      body: "The High Loft Ice Blue pillow felt icy and damp for a few minutes, then warmed up before morning. I kept the cover but stopped using the insert because the experience was too inconsistent.",
      phase: "evolution_mixed_comfort",
    },
    {
      key: "cooling-pillow",
      daysAgo: 2,
      rating: 5,
      title: "Low Loft worked after airing out",
      body: "Low Loft Graphite was comfortable after I aired out the insert for a day. The setup note matters because without that step the first smell would have made me return it.",
      phase: "evolution_recovery_signal",
    },
    {
      key: "inflatable-standing-desk",
      daysAgo: 6,
      rating: 1,
      title: "Tall Kit deflated during a call",
      body: "The Tall Kit slowly lost air while I was typing and my laptop slid toward the edge. The portable idea is clever, but this needs a stability limit and QA review before I would trust it.",
      phase: "evolution_qa_spike",
    },
    {
      key: "inflatable-standing-desk",
      daysAgo: 2,
      rating: 2,
      title: "Travel Kit is funny but unstable",
      body: "The Travel Kit packed flat and made me laugh, then tilted toward my keyboard. It is not only a sentiment problem; the surface needs clearer weight and use limits.",
      phase: "evolution_copy_and_qa",
    },
    {
      key: "smart-luggage-tag",
      daysAgo: 5,
      rating: 2,
      title: "Citrus QR privacy surprised me",
      body: "The Citrus tag looked bright and easy to scan, but the profile page exposed more contact detail than I expected. The page should make QR privacy defaults obvious.",
      phase: "evolution_privacy",
    },
    {
      key: "smart-luggage-tag",
      daysAgo: 1,
      rating: 3,
      title: "Recovered one bag, confused another",
      body: "One Cloud tag helped recover a suitcase, while a Carbon tag showed a delayed wrong-city alert. This is mixed tracking evidence, not a simple good or bad product story.",
      phase: "evolution_mixed_tracking",
    },
    {
      key: "coffee-alarm-brewer",
      daysAgo: 3,
      rating: 1,
      title: "Cream brewed at 3 a.m.",
      body: "The Cream unit brewed hours before the alarm and left condensation on my nightstand. A coffee alarm cannot be casual about time, water and sleeping next to electronics.",
      phase: "evolution_timing_spike",
    },
    {
      key: "coffee-alarm-brewer",
      daysAgo: 1,
      rating: 4,
      title: "Graphite worked after reset",
      body: "Graphite worked for me after a firmware reset, but reading the Cream timing complaints makes me think the setup and reset instructions need to be front and center.",
      phase: "evolution_variant_recovery",
    },
  ];

  return specs.map((spec) => {
    const product = productByKey.get(spec.key);
    if (!product) return null;
    const reviewDate = new Date(generatedAt.getTime() - spec.daysAgo * 24 * 60 * 60 * 1000);
    return {
      source_row: sourceRow++,
      product_handle: product.handle,
      shopify_product_id: product.id,
      rating: spec.rating,
      review_title: spec.title,
      review_body: spec.body,
      review_date: reviewDate.toISOString(),
      reviewer_name: `Evolution Reviewer ${sourceRow - startSourceRow}`,
      review_status: "published",
      source_product_id: product.key,
      scenario_phase: spec.phase,
    };
  }).filter(Boolean);
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

async function saveMockDatasetManifest({ shop, runId, createdAt, products, customers = [], orders, outcomes, reviewRows, reviewSource, orderDelayMs }) {
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
      customerCount: customers.length,
      orderCount: orders.length,
    returnCount: outcomes.returns.length,
    refundCount: outcomes.refunds.length,
    reviewCount: reviewRows.length,
    csvReviewFilePath: reviewSource?.filePath || null,
    manifestPath,
    orderCreateDelayMs: orderDelayMs,
      requiredScopes: REQUIRED_SHOPIFY_MOCK_DATASET_SCOPES,
      customers: customers.map(serializeCustomerForState),
      products: productDocs,
    };

  await mkdir(shopDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(summary, null, 2), "utf8");
  return { summary, manifestPath };
}

async function saveMockEvolutionReport({ shop, runId, products, evolution, reviewRows, reviewSource }) {
  const storageRoot = process.env.PRODUCT_PULSE_MOCK_DATASET_DIR
    || path.join(process.cwd(), ".cache", "product-pulse", "mock-datasets");
  const shopDir = path.join(storageRoot, sanitizeStorageSegment(shop || "unknown-shop"));
  const reportPath = path.join(shopDir, `${runId}.evolution-report.json`);
  const reviewCountsByProduct = reviewRows.reduce((counts, row) => ({
    ...counts,
    [row.source_product_id]: (counts[row.source_product_id] || 0) + 1,
  }), {});
  const negativeReviewCountsByProduct = reviewRows.reduce((counts, row) => {
    if (Number(row.rating || 0) > 2) return counts;
    return {
      ...counts,
      [row.source_product_id]: (counts[row.source_product_id] || 0) + 1,
    };
  }, {});
  const expectedChanges = products.map((product) => {
    const scenario = (evolution.scenarios || []).find((item) => item.productKey === product.key) || {};
    return {
      productKey: product.key,
      title: product.title,
      handle: product.handle,
      summary: scenario.expectedWatchlistChange || getEvolutionExpectedChange(product.key),
      newOrders: scenario.newOrders || 0,
      newUnits: scenario.newUnits || 0,
      newReturns: scenario.newReturns || 0,
      newRefunds: scenario.newRefunds || 0,
      newCsvReviews: reviewCountsByProduct[product.key] || 0,
      newNegativeCsvReviews: negativeReviewCountsByProduct[product.key] || 0,
      expectedThemes: scenario.newThemes || [],
    };
  });
  const report = {
    runId,
    batchId: evolution.batchId,
    generatedAt: evolution.generatedAt,
    csvReviewFilePath: reviewSource?.filePath || null,
    csvReviewRowCount: reviewSource?.rowCount || null,
    orderCount: evolution.orders.length,
    returnCount: evolution.returns.length,
    refundCount: evolution.refunds.length,
    reviewCount: reviewRows.length,
    expectedChanges,
  };

  await mkdir(shopDir, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { reportPath, expectedChanges };
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

async function getCurrentMockDatasetSummary(shop, { runId, createdAt, products, customers = [], orders, outcomes, reviewRows, reviewSource, orderDelayMs }) {
  const config = await getStoredMockDatasetConfig(shop);
  return {
    ...config,
    runId,
    generatedAt: config.generatedAt || createdAt.toISOString(),
      productCount: products.length || config.productCount || 0,
      customerCount: customers.length || config.customerCount || 0,
      orderCount: orders.length || config.orderCount || 0,
    returnCount: outcomes.returns.length || config.returnCount || 0,
    refundCount: outcomes.refunds.length || config.refundCount || 0,
    reviewCount: reviewSource ? reviewRows.length : config.reviewCount || 0,
    csvReviewFilePath: reviewSource?.filePath || config.csvReviewFilePath || null,
    manifestPath: config.manifestPath || null,
    evolutionBatch: config.evolutionBatch || null,
    evolutionOrderCount: config.evolutionOrderCount || 0,
    evolutionReturnCount: config.evolutionReturnCount || 0,
    evolutionRefundCount: config.evolutionRefundCount || 0,
    evolutionReviewCount: config.evolutionReviewCount || 0,
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
      if (json.data && json.extensions) {
        Object.defineProperty(json.data, "__extensions", {
          value: json.extensions,
          enumerable: false,
          configurable: false,
        });
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
    const status = Number(error.status || 0);
    const authMessage = status === 401
      ? "Shopify rejected the Admin API credentials. Reauthorize the app and rerun this stage; background mock dataset jobs require a valid offline Admin API token."
      : null;
    const message = [
      `${label} failed on attempt ${attempt}`,
      `HTTP ${error.status || "unknown"}`,
      authMessage,
      body ? body.replace(/\s+/g, " ").slice(0, 600) : null,
    ].filter(Boolean).join(": ");
    const next = new Error(message);
    next.status = error.status;
    if (status === 401) next.code = "SHOPIFY_UNAUTHORIZED";
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

function getGraphqlCostSummary(data) {
  const cost = data?.__extensions?.cost;
  if (!cost) return null;
  return {
    requested: cost.requestedQueryCost ?? null,
    actual: cost.actualQueryCost ?? null,
    available: cost.throttleStatus?.currentlyAvailable ?? null,
    restoreRate: cost.throttleStatus?.restoreRate ?? null,
  };
}

function getConnectionNodes(connection) {
  if (Array.isArray(connection?.nodes)) return connection.nodes;
  if (Array.isArray(connection)) return connection;
  return [];
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
