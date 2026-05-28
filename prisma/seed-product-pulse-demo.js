/* eslint-env node */
/* global BigInt */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_SHOP = process.env.PRODUCT_PULSE_DEMO_SHOP || "damian-xdcxxupp";
const SEED_NOW = parseDate(process.env.PRODUCT_PULSE_DEMO_SEED_NOW) || new Date();
const DEMO_SEED_SOURCE = "product_pulse_demo_seed";
const MONTHS_TO_SEED = 12;
const HISTORY_POINTS = 24;
const WATCHLIST_PRODUCT_COUNT = 10;
const WATCHLIST_RUNS_PER_PRODUCT = 6;
const RETENTION_LOOKBACK_DAYS = 365;
const RETENTION_MAX_COHORT_AGE_DAYS = 180;

const SOURCE_FIXTURES = [
  {
    sourceKey: "shopifyProducts",
    category: "product-data",
    name: "Shopify data",
    connected: true,
    active: true,
    available: true,
    health: "connected",
    coverageWeight: 0,
  },
  {
    sourceKey: "shopifyOrders",
    category: "returns",
    name: "Shopify Orders",
    connected: true,
    active: true,
    available: true,
    health: "connected",
    coverageWeight: 0,
  },
  {
    sourceKey: "shopifyReturns",
    category: "returns",
    name: "Shopify Returns & Refunds",
    connected: true,
    active: true,
    available: true,
    health: "connected",
    coverageWeight: 0,
  },
  {
    sourceKey: "judgemeReviews",
    category: "reviews",
    name: "Judge.me Reviews",
    connected: true,
    active: true,
    available: true,
    health: "connected",
    coverageWeight: 60,
  },
  {
    sourceKey: "csvReviews",
    category: "reviews",
    name: "CSV Upload",
    connected: true,
    active: true,
    available: true,
    health: "connected",
    coverageWeight: 60,
  },
  {
    sourceKey: "chatmeReviews",
    category: "reviews",
    name: "ChatMe Reviews",
    connected: false,
    active: false,
    available: false,
    health: "not_connected",
    coverageWeight: 10,
  },
  {
    sourceKey: "supportTickets",
    category: "support",
    name: "Support tickets",
    connected: true,
    active: true,
    available: true,
    health: "connected",
    coverageWeight: 8,
  },
  {
    sourceKey: "pdpQuestions",
    category: "pdp-questions",
    name: "ProductPulse Q&A Block",
    connected: true,
    active: true,
    available: true,
    health: "connected",
    coverageWeight: 6,
  },
];

const PRODUCT_FIXTURES = [
  {
    productGid: "gid://shopify/Product/8625417584719",
    productTitle: "Mega Construx Pokemon Pikachu vs. Bulbasaur",
    handle: "mega-construx-pokemon-pikachu-vs-bulbasaur",
    riskScore: 63,
    impactScore: 18,
    confidence: 80,
    primaryIssue: "Color expectations",
    price: 16.13,
    vendor: "Mega Construx",
    productType: "Construction toy",
    collections: ["Toys", "Building sets", "Pokemon"],
    tags: ["pokemon", "building-set", "color-expectation", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625395138639",
    productTitle: "Nintendo New 3DS XL",
    handle: "nintendo-new-3ds-xl",
    riskScore: 58,
    impactScore: 44,
    confidence: 80,
    primaryIssue: "Product quality",
    price: 249,
    vendor: "Nintendo",
    productType: "Game console",
    collections: ["Electronics", "Gaming", "Consoles"],
    tags: ["console", "quality-review", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625394909263",
    productTitle: "Nintendo Switch with Neon Blue/Neon Red Joy-Con",
    handle: "nintendo-switch-with-neon-blue-neon-red-joy-con",
    riskScore: 50,
    impactScore: 46,
    confidence: 84,
    primaryIssue: "Return-rate pressure improving after expectation fixes",
    price: 389,
    vendor: "Nintendo",
    productType: "Game console",
    collections: ["Electronics", "Gaming", "Consoles"],
    tags: ["console", "watchlist", "return-rate-improving", "demo-seed"],
    forcedRiskCurve: [90, 87, 84, 78, 72, 65, 58, 51, 45, 40, 43, 49, 57, 66, 74, 80, 76, 72, 68, 64, 61, 58, 54, 50],
  },
  {
    productGid: "gid://shopify/Product/8608632373327",
    productTitle: "The Collection Snowboard: Hydrogen",
    handle: "the-collection-snowboard-hydrogen",
    riskScore: 47,
    impactScore: 26,
    confidence: 65,
    primaryIssue: "Product quality",
    price: 749.95,
    vendor: "Hydrogen",
    productType: "Snowboard",
    collections: ["Snowboards", "Winter sports"],
    tags: ["snowboard", "quality-review", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625405558863",
    productTitle: "Transformers Power of the Primes Voyager Terrorcon Hun-Gurrr 1 7-Inch Figure",
    handle: "transformers-power-of-the-primes-voyager-terrorcon-hun-gurrr-1-7-inch-figure",
    riskScore: 43,
    impactScore: 9,
    confidence: 65,
    primaryIssue: "Color expectations",
    price: 29.99,
    vendor: "Hasbro",
    productType: "Action figure",
    collections: ["Toys", "Action figures"],
    tags: ["transformers", "color-expectation", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8631417241679",
    productTitle: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
    handle: "the-night-watch-rembrandt-van-rijn",
    riskScore: 41,
    impactScore: 31,
    confidence: 65,
    primaryIssue: "Subjective negative reaction",
    price: 1000,
    vendor: "Gallery Editions",
    productType: "Art print",
    collections: ["Art prints", "Museum collection"],
    tags: ["art-print", "expectation-note", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625409720399",
    productTitle: "Mega Bloks Teenage Mutant Ninja Turtles Leo Shredder Showdown",
    handle: "mega-bloks-teenage-mutant-ninja-turtles-leo-shredder-showdown",
    riskScore: 41,
    impactScore: 8,
    confidence: 65,
    primaryIssue: "Subjective Negative Reaction",
    price: 2.99,
    vendor: "Mega Bloks",
    productType: "Construction toy",
    collections: ["Toys", "Building sets"],
    tags: ["tmnt", "low-price", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625404215375",
    productTitle: "My Little Pony Classic Doll Pinkie Pie",
    handle: "my-little-pony-classic-doll-pinkie-pie",
    riskScore: 41,
    impactScore: 10,
    confidence: 65,
    primaryIssue: "Product quality",
    price: 13.99,
    vendor: "Hasbro",
    productType: "Doll",
    collections: ["Toys", "Dolls"],
    tags: ["my-little-pony", "quality-review", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8608633159759",
    productTitle: "The Collection Snowboard: Liquid",
    handle: "the-collection-snowboard-liquid",
    riskScore: 40,
    impactScore: 25,
    confidence: 84,
    primaryIssue: "Subjective negative reaction",
    price: 749.95,
    vendor: "Liquid",
    productType: "Snowboard",
    collections: ["Snowboards", "Winter sports"],
    tags: ["snowboard", "customer-sentiment", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625399889999",
    productTitle: "Ben 10 Omniverse 4 Inch Action Figure Malware",
    handle: "ben-10-omniverse-4-inch-action-figure-malware",
    riskScore: 40,
    impactScore: 8,
    confidence: 65,
    primaryIssue: "Sizing and fit",
    price: 12.99,
    vendor: "Bandai",
    productType: "Action figure",
    collections: ["Toys", "Action figures"],
    tags: ["ben-10", "size-expectation", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625384095823",
    productTitle: "TIMBERLAND | MENS 6 INCH PREMIUM BOOT",
    handle: "timberland-mens-6-inch-premium-boot",
    riskScore: 40,
    impactScore: 18,
    confidence: 65,
    primaryIssue: "Quality defect",
    price: 299.95,
    vendor: "Timberland",
    productType: "Boots",
    collections: ["Footwear", "Mens"],
    tags: ["boots", "durability", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8608632799311",
    productTitle: "The Multi-managed Snowboard but not",
    handle: "the-multi-managed-snowboard",
    riskScore: 39,
    impactScore: 14,
    confidence: 61,
    primaryIssue: "Product quality",
    price: 654.95,
    vendor: "Snowboard Supply",
    productType: "Snowboard",
    collections: ["Snowboards", "Winter sports"],
    tags: ["snowboard", "catalog-review", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8631416979535",
    productTitle: "MONA LISA | LEONARDO DA VINCI",
    handle: "mona-lisa-leonardo-da-vinci",
    riskScore: 36,
    impactScore: 31,
    confidence: 65,
    primaryIssue: "Other",
    price: 1000,
    vendor: "Gallery Editions",
    productType: "Art print",
    collections: ["Art prints", "Museum collection"],
    tags: ["art-print", "description-clarity", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625400217679",
    productTitle: "Digimon Adventure Patamon Plush Toy Cute Stuffed Animals Children Soft Dolls",
    handle: "digimon-adventure-patamon-plush-toy-cute-stuffed-animals-children-soft-dolls",
    riskScore: 36,
    impactScore: 11,
    confidence: 65,
    primaryIssue: "Product quality",
    price: 26.99,
    vendor: "Digimon",
    productType: "Plush toy",
    collections: ["Toys", "Plush"],
    tags: ["plush", "softness", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625405231183",
    productTitle: "Hot Wheels Star Wars The Force Awakens Starship, Millennium Falcon Die-Cast Vehicle",
    handle: "hot-wheels-star-wars-the-force-awakens-starship-millennium-falcon-die-cast-vehicle",
    riskScore: 35,
    impactScore: 8,
    confidence: 65,
    primaryIssue: "Operational/Generic Refund Reasons",
    price: 4.99,
    vendor: "Mattel",
    productType: "Die-cast vehicle",
    collections: ["Toys", "Vehicles"],
    tags: ["hot-wheels", "refund-review", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625395630159",
    productTitle: "Nerf Modulus Tri-Strike Blaster Toy",
    handle: "nerf-modulus-tri-strike-blaster-toy",
    riskScore: 35,
    impactScore: 12,
    confidence: 65,
    primaryIssue: "Order Level Refunds",
    price: 76,
    vendor: "Nerf",
    productType: "Blaster toy",
    collections: ["Toys", "Outdoor play"],
    tags: ["nerf", "refund-review", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625416470607",
    productTitle: "Kuu Kuu Harajuku Super Strawberry Fashion Pack",
    handle: "kuu-kuu-harajuku-super-strawberry-fashion-pack",
    riskScore: 34,
    impactScore: 7,
    confidence: 65,
    primaryIssue: "Subjective negative reaction",
    price: 9.99,
    vendor: "Kuu Kuu Harajuku",
    productType: "Fashion accessory",
    collections: ["Toys", "Accessories"],
    tags: ["fashion-pack", "expectation-note", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625395236943",
    productTitle: "Nerf N-Strike Elite Retaliator Blaster Toy",
    handle: "nerf-n-strike-elite-retaliator-blaster-toy",
    riskScore: 33,
    impactScore: 11,
    confidence: 65,
    primaryIssue: "Quality defect",
    price: 32,
    vendor: "Nerf",
    productType: "Blaster toy",
    collections: ["Toys", "Outdoor play"],
    tags: ["nerf", "quality-review", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8625395499087",
    productTitle: "Nerf Modulus ECS-10 Blaster Toy",
    handle: "nerf-modulus-ecs-10-blaster-toy",
    riskScore: 32,
    impactScore: 11,
    confidence: 65,
    primaryIssue: "Quality Defect",
    price: 57,
    vendor: "Nerf",
    productType: "Blaster toy",
    collections: ["Toys", "Outdoor play"],
    tags: ["nerf", "durability", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/8631417110607",
    productTitle: "THE SCREAM | EDVARD MUNCH",
    handle: "the-scream-edvard-munch",
    riskScore: 32,
    impactScore: 55,
    confidence: 65,
    primaryIssue: "Fulfillment and subjective reaction",
    price: 2400,
    vendor: "Gallery Editions",
    productType: "Art print",
    collections: ["Art prints", "Museum collection"],
    tags: ["art-print", "fulfillment-review", "demo-seed"],
  },
  {
    productGid: "gid://shopify/Product/9000000001011",
    productTitle: "Vans SK8-Hi True White Listing With Black Variant",
    handle: "vans-sk8-hi-true-white-black-mismatch",
    riskScore: 94,
    impactScore: 72,
    confidence: 88,
    primaryIssue: "Sizing and fit with product content mismatch",
    price: 79.95,
    vendor: "Vans",
    productType: "Boots",
    collections: ["Footwear", "Sneakers", "High-risk demo"],
    tags: ["shoe", "size-expectation", "title-description-mismatch", "high-return-risk", "demo-seed"],
    forcedRiskCurve: [48, 52, 56, 61, 67, 72, 78, 84, 88, 91, 93, 94, 95, 94, 93, 92, 91, 93, 94, 95, 94, 93, 94, 94],
  },
  {
    productGid: "gid://shopify/Product/9000000001028",
    productTitle: "UltraSoft Plush Blanket - Thin Fill Batch",
    handle: "ultrasoft-plush-blanket-thin-fill-batch",
    riskScore: 91,
    impactScore: 67,
    confidence: 86,
    primaryIssue: "Product quality and defect reports",
    price: 64.5,
    vendor: "UltraSoft",
    productType: "Home textile",
    collections: ["Home", "Bedding", "High-risk demo"],
    tags: ["softness", "quality-review", "thin-material", "high-refund-risk", "demo-seed"],
    forcedRiskCurve: [35, 39, 44, 51, 59, 68, 76, 83, 87, 90, 92, 91, 89, 88, 90, 91, 92, 91, 90, 89, 91, 92, 91, 91],
  },
  {
    productGid: "gid://shopify/Product/9000000001042",
    productTitle: "Hydrogen Pro Snowboard Binding Compatibility Kit",
    handle: "hydrogen-pro-snowboard-binding-compatibility-kit",
    riskScore: 89,
    impactScore: 76,
    confidence: 84,
    primaryIssue: "Sizing and fit compatibility returns",
    price: 159.95,
    vendor: "Hydrogen",
    productType: "Snowboard",
    collections: ["Snowboards", "Winter sports", "High-risk demo"],
    tags: ["snowboard", "compatibility", "wrong-size", "variant-review", "demo-seed"],
    forcedRiskCurve: [42, 49, 57, 64, 70, 77, 85, 91, 93, 90, 86, 82, 79, 83, 88, 91, 92, 90, 88, 87, 88, 90, 89, 89],
  },
  {
    productGid: "gid://shopify/Product/9000000001059",
    productTitle: "Gallery Canvas Oversized Frame - Color Not As Pictured",
    handle: "gallery-canvas-oversized-frame-color-not-as-pictured",
    riskScore: 86,
    impactScore: 81,
    confidence: 82,
    primaryIssue: "Color expectations and missing image context",
    price: 699,
    vendor: "Gallery Editions",
    productType: "Art print",
    collections: ["Art prints", "Museum collection", "High-risk demo"],
    tags: ["art-print", "color-expectation", "media-context", "high-margin-risk", "demo-seed"],
    forcedRiskCurve: [24, 28, 34, 45, 59, 73, 84, 90, 88, 83, 78, 72, 69, 74, 80, 84, 86, 88, 87, 85, 84, 85, 86, 86],
  },
  {
    productGid: "gid://shopify/Product/9000000001073",
    productTitle: "Nerf Elite Motorized Blaster Missing Darts Bundle",
    handle: "nerf-elite-motorized-blaster-missing-darts-bundle",
    riskScore: 88,
    impactScore: 58,
    confidence: 85,
    primaryIssue: "Product quality and missing included items",
    price: 52,
    vendor: "Nerf",
    productType: "Blaster toy",
    collections: ["Toys", "Outdoor play", "High-risk demo"],
    tags: ["nerf", "missing-accessories", "quality-review", "refund-review", "demo-seed"],
    forcedRiskCurve: [31, 35, 38, 44, 49, 55, 62, 71, 79, 84, 87, 90, 91, 89, 87, 85, 83, 84, 86, 87, 88, 89, 88, 88],
  },
  {
    productGid: "gid://shopify/Product/9000000001080",
    productTitle: "Kids USB-C Learning Tablet Charger 65W",
    handle: "kids-usb-c-learning-tablet-charger-65w",
    riskScore: 93,
    impactScore: 63,
    confidence: 90,
    primaryIssue: "Product quality and defect safety concerns",
    price: 34.99,
    vendor: "LearningTech",
    productType: "Electronics accessory",
    collections: ["Electronics", "Accessories", "High-risk demo"],
    tags: ["charger", "quality-review", "defect", "safety-review", "high-risk-demo", "demo-seed"],
    forcedRiskCurve: [44, 46, 52, 60, 69, 76, 82, 88, 91, 94, 95, 94, 92, 90, 89, 91, 93, 95, 94, 92, 91, 92, 93, 93],
  },
];

const ISSUE_PROFILES = [
  {
    match: ["color"],
    issueCode: "color_expectation",
    issueTitle: "Color expectations are not matching PDP imagery",
    mainIssue: "Color expectations",
    sentiment: "confused",
    reason: "customers expected a different color tone from the product images",
    actionTitle: "Improve image guidance and alt text",
    secondaryActionTitle: "Add color expectation note",
    returnReasons: ["Color not as expected", "Not as pictured", "Expectation mismatch"],
    repeatedLanguage: ["different color", "not as pictured", "looks brighter"],
  },
  {
    match: ["sizing", "fit", "boot"],
    issueCode: "fit_sizing",
    issueTitle: "Size or fit expectations are unclear",
    mainIssue: "Fit and sizing",
    sentiment: "frustrated",
    reason: "customers mention sizing confusion and uncertainty before return",
    actionTitle: "Add sizing guidance to product description",
    secondaryActionTitle: "Review variant and size labels",
    returnReasons: ["Too small", "Does not fit", "Wrong size"],
    repeatedLanguage: ["runs small", "does not fit", "size up"],
  },
  {
    match: ["refund", "order level", "operational"],
    issueCode: "refund_pressure",
    issueTitle: "Refund pressure is higher than normal",
    mainIssue: "Refund pressure",
    sentiment: "neutral",
    reason: "refund events repeat without enough structured reason detail",
    actionTitle: "Add internal refund review tag",
    secondaryActionTitle: "Review refund reason taxonomy",
    returnReasons: ["Order level refund", "Customer request", "Canceled before fulfillment"],
    repeatedLanguage: ["order level refund", "customer request", "refund before ship"],
  },
  {
    match: ["subjective", "other", "scream", "night watch", "mona lisa"],
    issueCode: "subjective_negative_reaction",
    issueTitle: "Subjective reactions need better expectation setting",
    mainIssue: "Subjective reaction",
    sentiment: "unsettled",
    reason: "customer language is subjective and negative, but repeated enough to explain clearly",
    actionTitle: "Add expectation-setting note",
    secondaryActionTitle: "Create product FAQ",
    returnReasons: ["Other", "Changed my mind", "Not what I expected"],
    repeatedLanguage: ["scares me", "not what I expected", "too intense"],
  },
  {
    match: ["fulfillment"],
    issueCode: "fulfillment_expectation",
    issueTitle: "Fulfillment expectations need a clearer buyer note",
    mainIssue: "Fulfillment mismatch",
    sentiment: "disappointed",
    reason: "customers mention timing, packaging, or delivery expectation mismatch",
    actionTitle: "Add fulfillment expectation note",
    secondaryActionTitle: "Create support macro",
    returnReasons: ["Arrived late", "Packaging issue", "Changed my mind"],
    repeatedLanguage: ["late delivery", "packaging", "expected faster"],
  },
  {
    match: ["quality", "defect", "product"],
    issueCode: "product_quality",
    issueTitle: "Product quality concerns repeat across sources",
    mainIssue: "Product quality",
    sentiment: "negative",
    reason: "returns and reviews mention quality, durability, or finish concerns",
    actionTitle: "Draft product quality note",
    secondaryActionTitle: "Start supplier or QA review",
    returnReasons: ["Product quality", "Defective", "Not durable"],
    repeatedLanguage: ["feels cheap", "broke quickly", "quality issue"],
  },
];

async function main() {
  const shop = DEFAULT_SHOP;
  const startedAt = new Date();

  await seedSources(shop);
  await seedWatchSettings(shop);
  await seedCreditBalance(shop);

  const productGids = PRODUCT_FIXTURES.map((product) => product.productGid);
  await deleteSeededRetentionData(shop, productGids);
  await deleteSeededJobHistory(shop);
  await prisma.productAction.deleteMany({ where: { shop, productGid: { in: productGids } } });
  await prisma.productDiagnosis.deleteMany({ where: { shop, productGid: { in: productGids } } });
  await prisma.productScoreHistory.deleteMany({ where: { shop, productGid: { in: productGids } } });
  await prisma.productTimelineEvent.deleteMany({ where: { shop, productGid: { in: productGids } } });
  await prisma.productWatchActivity.deleteMany({ where: { shop, productGid: { in: productGids } } });
  await prisma.productWatchlistItem.deleteMany({ where: { shop, productGid: { in: productGids } } });

  const seededProducts = [];
  for (const [index, product] of PRODUCT_FIXTURES.entries()) {
    const seededProduct = await seedProduct(shop, product, index);
    seededProducts.push(seededProduct);
  }

  await seedWatchlist(shop, seededProducts.slice(0, WATCHLIST_PRODUCT_COUNT));
  await seedJobHistory(shop, seededProducts);

  const durationMs = Date.now() - startedAt.getTime();
  console.log(JSON.stringify({
    status: "ok",
    shop,
    productsSeeded: seededProducts.length,
    scoreHistoryRows: seededProducts.length * HISTORY_POINTS,
    timelineEvents: seededProducts.reduce((sum, product) => sum + Number(product.timelineEventCount || 0), 0),
    retentionRuns: seededProducts.length,
    watchlistItems: Math.min(WATCHLIST_PRODUCT_COUNT, seededProducts.length),
    watchlistRunsPerProduct: WATCHLIST_RUNS_PER_PRODUCT,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    command: "npm run seed:demo",
  }, null, 2));
}

async function deleteSeededRetentionData(shop, productGids) {
  const where = { shopId: shop, productGid: { in: productGids } };
  await prisma.productRetentionSummary.deleteMany({ where });
  await prisma.productRetentionSegmentDaily.deleteMany({ where });
  await prisma.productRetentionDailyActivity.deleteMany({ where });
  await prisma.productRetentionCohortCell.deleteMany({ where });
  await prisma.productRetentionDailyCohort.deleteMany({ where });
  await prisma.productRetentionRun.deleteMany({ where });
}

async function deleteSeededJobHistory(shop) {
  const jobs = await prisma.catalogSignalJob.findMany({
    where: {
      shop,
      source: { startsWith: "ProductPulse demo seed" },
    },
    select: { id: true },
  });
  const jobIds = jobs.map((job) => job.id);
  if (jobIds.length) {
    await prisma.productPulseJobLog.deleteMany({ where: { shop, jobId: { in: jobIds } } });
    await prisma.catalogSignalJob.deleteMany({ where: { shop, id: { in: jobIds } } });
  }
}

async function seedSources(shop) {
  const settings = {
    risk: { minimumScore: 18, mediumThreshold: 55, highThreshold: 75 },
    momentum: { minimumScore: 70 },
    analysis: { lookbackDays: 365 },
  };

  await prisma.productPulseSource.upsert({
    where: { shop_sourceKey: { shop, sourceKey: "__productpulse_settings" } },
    create: {
      shop,
      sourceKey: "__productpulse_settings",
      category: "settings",
      name: "ProductPulse Settings",
      connected: true,
      active: true,
      available: true,
      health: "configured",
      coverageWeight: 0,
      config: settings,
    },
    update: {
      connected: true,
      active: true,
      available: true,
      health: "configured",
      config: settings,
    },
  });

  for (const source of SOURCE_FIXTURES) {
    await prisma.productPulseSource.upsert({
      where: { shop_sourceKey: { shop, sourceKey: source.sourceKey } },
      create: {
        ...source,
        shop,
        connectedAt: monthsAgo(11, SEED_NOW),
        lastSyncedAt: daysAgo(1 + deterministicInt(source.sourceKey, 0, 3), SEED_NOW),
        config: {
          seeded: true,
          seedSource: DEMO_SEED_SOURCE,
          coverageWindowDays: 365,
        },
      },
      update: {
        ...source,
        disabledAt: null,
        connectedAt: monthsAgo(11, SEED_NOW),
        lastSyncedAt: daysAgo(1 + deterministicInt(source.sourceKey, 0, 3), SEED_NOW),
        config: {
          seeded: true,
          seedSource: DEMO_SEED_SOURCE,
          coverageWindowDays: 365,
        },
      },
    });
  }
}

async function seedWatchSettings(shop) {
  await prisma.productWatchSettings.upsert({
    where: { shop },
    create: {
      shop,
      scanCadenceDays: 3,
      alertRecipients: ["ops@example.com", "qa@example.com"],
      triggerRule: "new_or_rising_risk",
      summarySchedule: "daily_digest_8am",
      alertsEnabled: true,
    },
    update: {
      scanCadenceDays: 3,
      alertRecipients: ["ops@example.com", "qa@example.com"],
      triggerRule: "new_or_rising_risk",
      summarySchedule: "daily_digest_8am",
      alertsEnabled: true,
    },
  });
}

async function seedCreditBalance(shop) {
  const existing = await prisma.creditLedgerEntry.findFirst({
    where: { shop, reason: "Demo seed credit balance" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return;
  await prisma.creditLedgerEntry.create({
    data: {
      shop,
      direction: "credit",
      amount: 500,
      reason: "Demo seed credit balance",
      balanceAfter: 500,
      createdAt: daysAgo(1, SEED_NOW),
    },
  });
}

async function seedProduct(shop, product, index) {
  const profile = getIssueProfile(product);
  const diagnosisCreatedAt = daysAgo(2 + index, SEED_NOW);
  const diagnosisCompletedAt = daysAgo(1 + index, SEED_NOW);
  const riskCurve = buildRiskCurve(product, index);
  const monthlyOrderActivity = buildMonthlyOrderActivity(product, riskCurve, index);
  const monthlySummary = monthlyOrderActivity.summary;
  const productMomentum = buildProductMomentum(product, monthlyOrderActivity, index);
  const recommendations = buildRecommendations(product, profile, monthlySummary, index);
  const issues = buildIssues(product, profile, monthlySummary, riskCurve, index);
  const evidence = buildEvidence(product, profile, monthlyOrderActivity, productMomentum, riskCurve, index);
  const returnRatePrediction = buildReturnRatePrediction(monthlyOrderActivity, recommendations, index);
  const riskHistory = buildRiskHistory(product, riskCurve, monthlyOrderActivity, productMomentum, profile, index);
  const signalTrend = buildSignalTrendFromRisk(riskCurve);
  const riskTrend = riskCurve.slice(-8);
  const metrics = buildMetrics({
    product,
    profile,
    index,
    monthlyOrderActivity,
    returnRatePrediction,
    productMomentum,
    recommendations,
    issues,
    evidence,
    riskHistory,
    signalTrend,
    riskTrend,
    diagnosisCreatedAt,
    diagnosisCompletedAt,
  });
  const sourceCoverage = getSourceCoverage(index);

  let snapshot = await prisma.productRiskSnapshot.upsert({
    where: { shop_productGid: { shop, productGid: product.productGid } },
    create: {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      riskScore: product.riskScore,
      impactScore: product.impactScore,
      confidence: product.confidence,
      primaryIssue: profile.mainIssue,
      sourceCoverage,
      metrics,
      calculatedAt: SEED_NOW,
    },
    update: {
      productTitle: product.productTitle,
      handle: product.handle,
      riskScore: product.riskScore,
      impactScore: product.impactScore,
      confidence: product.confidence,
      primaryIssue: profile.mainIssue,
      sourceCoverage,
      metrics,
      calculatedAt: SEED_NOW,
    },
  });

  const diagnosis = await prisma.productDiagnosis.create({
    data: {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      status: "Completed",
      riskScore: product.riskScore,
      confidence: product.confidence,
      likelyCause: buildLikelyCause(product, profile, monthlySummary),
      issues,
      evidence,
      recommendations,
      metrics,
      creditsConsumed: 1,
      createdAt: diagnosisCreatedAt,
      completedAt: diagnosisCompletedAt,
    },
  });

  const retentionResult = await seedProductRetention(shop, product, diagnosis.id, index, monthlyOrderActivity);
  const productRetention = retentionResult?.payload || null;
  const productRetentionSummary = productRetention?.summary || null;

  const metricsWithDiagnosis = {
    ...metrics,
    latestDiagnosisId: diagnosis.id,
    latestDiagnosisAt: diagnosisCompletedAt.toISOString(),
    lastDetailedDiagnosisAt: diagnosisCompletedAt.toISOString(),
    lastAnalyzedAt: diagnosisCompletedAt.toISOString(),
    productRetention,
    productRetentionSummary,
    latestRetentionRunId: productRetention?.run?.id || retentionResult?.retentionRunId || null,
    retentionHealthScore: productRetentionSummary?.retentionHealthScore || null,
    incrementalDiagnosis: {
      ...(metrics.incrementalDiagnosis || {}),
      diagnosisId: diagnosis.id,
      latestDiagnosisId: diagnosis.id,
    },
  };

  snapshot = await prisma.productRiskSnapshot.update({
    where: { shop_productGid: { shop, productGid: product.productGid } },
    data: { metrics: metricsWithDiagnosis },
  });
  await prisma.productDiagnosis.update({
    where: { id: diagnosis.id },
    data: { metrics: metricsWithDiagnosis },
  });

  await prisma.productScoreHistory.createMany({
    data: riskHistory.map((history) => ({
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      source: history.source,
      riskScore: history.riskScore,
      impactScore: history.impactScore,
      confidence: history.confidence,
      primaryIssue: history.primaryIssue,
      metrics: history.metrics,
      snapshotId: snapshot.id,
      diagnosisId: diagnosis.id,
      recordedAt: new Date(history.recordedAt),
    })),
  });

  const actionRecords = await seedActionRecords(shop, product, diagnosis.id, recommendations, index);
  const timelineEventCount = await seedTimelineEvents({
    shop,
    product,
    profile,
    diagnosis,
    actionRecords,
    riskHistory,
    metrics: metricsWithDiagnosis,
    monthlySummary,
    index,
  });

  return {
    ...product,
    snapshotId: snapshot.id,
    diagnosisId: diagnosis.id,
    timelineEventCount,
    profile,
    metrics: metricsWithDiagnosis,
  };
}

async function seedProductRetention(shop, product, diagnosisId, index, monthlyOrderActivity) {
  const orders = buildSeedRetentionOrders(product, index);
  const dataset = buildSeedRetentionDataset({ shop, product, diagnosisId, index, monthlyOrderActivity, syntheticOrderCount: orders.length });
  const retentionRunUpdate = { ...dataset.run };
  delete retentionRunUpdate.id;

  await prisma.$transaction(async (tx) => {
    await tx.productRetentionRun.upsert({
      where: {
        shopId_productGid_diagnosisId: {
          shopId: shop,
          productGid: product.productGid,
          diagnosisId,
        },
      },
      create: dataset.run,
      update: retentionRunUpdate,
    });
    const where = { shopId: shop, productGid: product.productGid, diagnosisId };
    await tx.productRetentionSummary.deleteMany({ where });
    await tx.productRetentionSegmentDaily.deleteMany({ where });
    await tx.productRetentionDailyActivity.deleteMany({ where });
    await tx.productRetentionCohortCell.deleteMany({ where });
    await tx.productRetentionDailyCohort.deleteMany({ where });

    await tx.productRetentionDailyCohort.createMany({ data: dataset.dailyCohorts });
    await tx.productRetentionCohortCell.createMany({ data: dataset.cohortCells });
    await tx.productRetentionDailyActivity.createMany({ data: dataset.dailyActivity });
    await tx.productRetentionSegmentDaily.createMany({ data: dataset.segmentDaily });
    await tx.productRetentionSummary.create({ data: dataset.summary });
  });

  return {
    status: dataset.run.status,
    retentionRunId: dataset.run.id,
    payload: dataset.payload,
    syntheticOrderCount: orders.length,
  };
}

function buildSeedRetentionDataset({ shop, product, diagnosisId, index, monthlyOrderActivity, syntheticOrderCount }) {
  const retentionRunId = `seed-retention-${stableProductNumber(product)}`;
  const asOfDate = SEED_NOW;
  const windowStartDate = daysAgo(RETENTION_LOOKBACK_DAYS, SEED_NOW);
  const windowEndDate = SEED_NOW;
  const cohortDates = [0, 1, 2, 4, 6, 8, 10].map((monthIndex, cohortIndex) => {
    const month = getMonthStarts(SEED_NOW, MONTHS_TO_SEED)[monthIndex] || monthsAgo(11 - monthIndex, SEED_NOW);
    return formatDateKey(addDays(month, 5 + cohortIndex * 2));
  });
  const cohorts = cohortDates.map((cohortDate, cohortIndex) => buildSeedRetentionDailyCohort({
    shop,
    product,
    diagnosisId,
    retentionRunId,
    cohortDate,
    cohortIndex,
    index,
  }));
  const cohortCells = cohorts.flatMap((cohort) => buildSeedRetentionCohortCells({
    shop,
    product,
    diagnosisId,
    retentionRunId,
    cohort,
    index,
  }));
  const dailyActivity = buildSeedRetentionDailyActivity({
    shop,
    product,
    diagnosisId,
    retentionRunId,
    monthlyOrderActivity,
  });
  const segmentDaily = cohorts.flatMap((cohort) => buildSeedRetentionSegments({
    shop,
    product,
    diagnosisId,
    retentionRunId,
    cohort,
    index,
  }));
  const summary = buildSeedRetentionSummary({
    shop,
    product,
    diagnosisId,
    retentionRunId,
    asOfDate,
    cohorts,
    dailyActivity,
    syntheticOrderCount,
  });
  const run = {
    id: retentionRunId,
    shopId: shop,
    productGid: product.productGid,
    diagnosisId,
    asOfDate,
    timezone: "UTC",
    windowStartDate,
    windowEndDate,
    lookbackDays: RETENTION_LOOKBACK_DAYS,
    maxCohortAgeDays: RETENTION_MAX_COHORT_AGE_DAYS,
    currency: "USD",
    schemaVersion: 1,
    status: summary.hasEnoughData ? "completed" : "partial",
    errorMessage: null,
    metadata: {
      seedSource: DEMO_SEED_SOURCE,
      syntheticOrderCount,
      dataQuality: {
        totalCustomersAnalyzed: summary.totalCustomersAnalyzed,
        totalProductOrdersAnalyzed: summary.totalProductOrdersAnalyzed,
      },
    },
  };
  const payload = buildSeedRetentionPayload({ run, summary, cohorts, cohortCells, dailyActivity, segmentDaily });

  return {
    run,
    summary: toSeedRetentionSummaryDbRow(summary),
    dailyCohorts: cohorts.map(toSeedRetentionDailyCohortDbRow),
    cohortCells: cohortCells.map(toSeedRetentionCohortCellDbRow),
    dailyActivity: dailyActivity.map(toSeedRetentionDailyActivityDbRow),
    segmentDaily: segmentDaily.map(toSeedRetentionSegmentDailyDbRow),
    payload,
  };
}

function buildSeedRetentionDailyCohort({ shop, product, diagnosisId, retentionRunId, cohortDate, cohortIndex, index }) {
  const cohortSize = 5 + ((index + cohortIndex) % 5);
  const observedDays = Math.max(0, Math.floor((SEED_NOW.getTime() - new Date(`${cohortDate}T12:00:00.000Z`).getTime()) / (24 * 60 * 60 * 1000)));
  const repeat90 = Math.min(cohortSize, Math.max(1, Math.round(cohortSize * (0.22 + (index % 4) * 0.04 - cohortIndex * 0.008))));
  const same90 = Math.min(repeat90, Math.max(0, Math.round(repeat90 * (product.riskScore >= 80 ? 0.32 : 0.52))));
  const other90 = Math.min(repeat90, Math.max(0, repeat90 - same90 + (cohortIndex % 2)));
  const firstRevenueCents = BigInt(Math.round(cohortSize * product.price * 100));
  const ltv90Cents = BigInt(Math.round(cohortSize * product.price * 100 * (1.08 + repeat90 / Math.max(1, cohortSize) * 0.55)));
  const sameRevenue90 = BigInt(Math.round(Number(ltv90Cents) * 0.46));
  const otherRevenue90 = BigInt(Math.max(0, Number(ltv90Cents) - Number(firstRevenueCents) - Number(sameRevenue90)));

  return {
    shopId: shop,
    productGid: product.productGid,
    diagnosisId,
    retentionRunId,
    cohortDate,
    cohortSize,
    anyRepeatWithin7dCount: Math.min(repeat90, Math.round(repeat90 * 0.18)),
    anyRepeatWithin14dCount: Math.min(repeat90, Math.round(repeat90 * 0.28)),
    anyRepeatWithin30dCount: Math.min(repeat90, Math.round(repeat90 * 0.48)),
    anyRepeatWithin60dCount: Math.min(repeat90, Math.round(repeat90 * 0.72)),
    anyRepeatWithin90dCount: repeat90,
    anyRepeatWithin180dCount: Math.min(cohortSize, repeat90 + Math.round(cohortSize * 0.12)),
    sameProductRepeatWithin7dCount: Math.min(same90, Math.round(same90 * 0.12)),
    sameProductRepeatWithin14dCount: Math.min(same90, Math.round(same90 * 0.2)),
    sameProductRepeatWithin30dCount: Math.min(same90, Math.round(same90 * 0.42)),
    sameProductRepeatWithin60dCount: Math.min(same90, Math.round(same90 * 0.68)),
    sameProductRepeatWithin90dCount: same90,
    sameProductRepeatWithin180dCount: Math.min(cohortSize, same90 + Math.round(cohortSize * 0.06)),
    boughtOtherProductWithin7dCount: Math.min(other90, Math.round(other90 * 0.1)),
    boughtOtherProductWithin14dCount: Math.min(other90, Math.round(other90 * 0.22)),
    boughtOtherProductWithin30dCount: Math.min(other90, Math.round(other90 * 0.45)),
    boughtOtherProductWithin60dCount: Math.min(other90, Math.round(other90 * 0.72)),
    boughtOtherProductWithin90dCount: other90,
    boughtOtherProductWithin180dCount: Math.min(cohortSize, other90 + Math.round(cohortSize * 0.1)),
    nextPurchaseSameProductCount: same90,
    nextPurchaseOtherProductCount: Math.max(0, repeat90 - same90),
    didNotReturnCount: Math.max(0, cohortSize - repeat90),
    firstOrderNetRevenueCents: firstRevenueCents,
    totalNetRevenueWithin30dCents: BigInt(Math.round(Number(firstRevenueCents) * 1.08)),
    totalNetRevenueWithin60dCents: BigInt(Math.round(Number(firstRevenueCents) * 1.18)),
    totalNetRevenueWithin90dCents: ltv90Cents,
    totalNetRevenueWithin180dCents: BigInt(Math.round(Number(ltv90Cents) * 1.18)),
    sameProductRevenueWithin90dCents: sameRevenue90,
    otherProductRevenueWithin90dCents: otherRevenue90,
    ltv30Cents: BigInt(Math.round(Number(firstRevenueCents) * 1.08 / cohortSize)),
    ltv60Cents: BigInt(Math.round(Number(firstRevenueCents) * 1.18 / cohortSize)),
    ltv90Cents: BigInt(Math.round(Number(ltv90Cents) / cohortSize)),
    ltv180Cents: BigInt(Math.round(Number(ltv90Cents) * 1.18 / cohortSize)),
    avgDaysToNextPurchase: repeat90 ? 32 + cohortIndex * 4 + index : null,
    medianDaysToNextPurchase: repeat90 ? 28 + cohortIndex * 3 + index : null,
    avgDaysToSameProductRepurchase: same90 ? 42 + cohortIndex * 5 : null,
    medianDaysToSameProductRepurchase: same90 ? 36 + cohortIndex * 4 : null,
    isMature7d: observedDays >= 7,
    isMature14d: observedDays >= 14,
    isMature30d: observedDays >= 30,
    isMature60d: observedDays >= 60,
    isMature90d: observedDays >= 90,
    isMature180d: observedDays >= 180,
    observedDays,
  };
}

function buildSeedRetentionCohortCells({ shop, product, diagnosisId, retentionRunId, cohort, index }) {
  const ageDays = [0, 7, 14, 30, 60, 90, 180];
  return ageDays.map((ageDay) => {
    const progress = ageDay / RETENTION_MAX_COHORT_AGE_DAYS;
    const isObserved = cohort.observedDays >= ageDay;
    const anyRepeatCumulativeCount = isObserved ? Math.min(cohort.cohortSize, Math.round(cohort.anyRepeatWithin180dCount * progress)) : 0;
    const sameProductRepeatCumulativeCount = isObserved ? Math.min(cohort.cohortSize, Math.round(cohort.sameProductRepeatWithin180dCount * progress)) : 0;
    const boughtOtherProductCumulativeCount = isObserved ? Math.min(cohort.cohortSize, Math.round(cohort.boughtOtherProductWithin180dCount * progress)) : 0;
    const baseLtv = Number(cohort.ltv180Cents || 0);
    const cumulativeLtvCents = isObserved ? BigInt(Math.round(baseLtv * (0.82 + progress * 0.18))) : 0n;
    const sameProductCumulativeLtvCents = isObserved ? BigInt(Math.round(Number(cumulativeLtvCents) * (0.34 + (index % 3) * 0.04))) : 0n;
    const otherProductCumulativeLtvCents = isObserved ? BigInt(Math.max(0, Math.round(Number(cumulativeLtvCents) - Number(sameProductCumulativeLtvCents)))) : 0n;
    return {
      shopId: shop,
      productGid: product.productGid,
      diagnosisId,
      retentionRunId,
      cohortDate: cohort.cohortDate,
      ageDay,
      cohortSize: cohort.cohortSize,
      anyRepeatCumulativeCount,
      sameProductRepeatCumulativeCount,
      boughtOtherProductCumulativeCount,
      anyRepeatRate: ratioDecimal(anyRepeatCumulativeCount, cohort.cohortSize),
      sameProductRepeatRate: ratioDecimal(sameProductRepeatCumulativeCount, cohort.cohortSize),
      boughtOtherProductRate: ratioDecimal(boughtOtherProductCumulativeCount, cohort.cohortSize),
      cumulativeNetRevenueCents: BigInt(Math.round(Number(cumulativeLtvCents) * cohort.cohortSize)),
      cumulativeLtvCents,
      sameProductCumulativeRevenueCents: BigInt(Math.round(Number(sameProductCumulativeLtvCents) * cohort.cohortSize)),
      otherProductCumulativeRevenueCents: BigInt(Math.round(Number(otherProductCumulativeLtvCents) * cohort.cohortSize)),
      sameProductCumulativeLtvCents,
      otherProductCumulativeLtvCents,
      isObserved,
    };
  });
}

function buildSeedRetentionDailyActivity({ shop, product, diagnosisId, retentionRunId, monthlyOrderActivity }) {
  return monthlyOrderActivity.months.map((month) => ({
    shopId: shop,
    productGid: product.productGid,
    diagnosisId,
    retentionRunId,
    metricDate: `${month.key}-15`,
    productOrdersCount: month.orders,
    productUnitsSold: month.orderUnits,
    uniqueProductBuyers: Math.max(1, Math.round(month.orders * 0.84)),
    newProductBuyers: Math.max(1, Math.round(month.orders * 0.58)),
    returningProductBuyers: Math.max(0, Math.round(month.orders * 0.26)),
    productGrossRevenueCents: centsBigInt(month.revenue),
    productNetRevenueCents: centsBigInt(Math.max(0, month.revenue - month.refundAmount)),
    sameProductRepeatRevenueCents: centsBigInt(month.revenue * 0.12),
    postProductCustomerRevenueCents: centsBigInt(month.revenue * 1.28),
    otherProductRevenueFromProductCustomersCents: centsBigInt(month.revenue * 0.22),
    customersBuyingProductAgainCount: Math.max(0, Math.round(month.orders * 0.11)),
    customersBuyingOtherProductAfterThisProductCount: Math.max(0, Math.round(month.orders * 0.16)),
    customersWithAnyRepeatOrderCount: Math.max(0, Math.round(month.orders * 0.24)),
    returningProductBuyerShare: ratioDecimal(Math.round(month.orders * 0.26), Math.max(1, Math.round(month.orders * 0.84))),
    sameProductRepurchaseShare: ratioDecimal(Math.round(month.orders * 0.11), Math.max(1, Math.round(month.orders * 0.84))),
    crossSellShare: ratioDecimal(Math.round(month.orders * 0.16), Math.max(1, Math.round(month.orders * 0.84))),
    returningRevenueShare: ratioDecimal(Math.round(month.revenue * 0.34), Math.max(1, Math.round(month.revenue * 1.28))),
    refundedOrdersCount: month.refundedOrders,
    refundedRevenueCents: centsBigInt(month.refundAmount),
    returnRate: ratioDecimal(month.returnedUnits, month.orderUnits),
    refundRate: ratioDecimal(month.refundAmount, month.revenue),
  }));
}

function buildSeedRetentionSegments({ shop, product, diagnosisId, retentionRunId, cohort, index }) {
  const variants = buildAffectedVariants(product, index);
  const segmentSpecs = [
    { segmentType: "variant", segmentValue: variants[index % variants.length] || "Default Title", modifier: 1.05 },
    { segmentType: "customer_type_at_first_product_purchase", segmentValue: index % 2 ? "existing_customer" : "new_to_store", modifier: index % 2 ? 1.18 : 0.94 },
    { segmentType: "discount_used", segmentValue: index % 3 ? "no" : "yes", modifier: index % 3 ? 1 : 1.12 },
  ];
  return segmentSpecs.map((segment, segmentIndex) => {
    const cohortSize = Math.max(2, Math.round(cohort.cohortSize * (0.42 - segmentIndex * 0.06)));
    const anyRepeatWithin90dCount = Math.min(cohortSize, Math.round(cohort.anyRepeatWithin90dCount * segment.modifier));
    const sameProductRepeatWithin90dCount = Math.min(anyRepeatWithin90dCount, Math.round(cohort.sameProductRepeatWithin90dCount * segment.modifier));
    const boughtOtherProductWithin90dCount = Math.max(0, anyRepeatWithin90dCount - sameProductRepeatWithin90dCount);
    const netRevenueWithin90dCents = BigInt(Math.round(Number(cohort.totalNetRevenueWithin90dCents || 0) * (cohortSize / Math.max(1, cohort.cohortSize))));
    return {
      shopId: shop,
      productGid: product.productGid,
      diagnosisId,
      retentionRunId,
      cohortDate: cohort.cohortDate,
      segmentType: segment.segmentType,
      segmentValue: segment.segmentValue,
      cohortSize,
      anyRepeatWithin30dCount: Math.min(anyRepeatWithin90dCount, Math.round(anyRepeatWithin90dCount * 0.48)),
      anyRepeatWithin90dCount,
      sameProductRepeatWithin90dCount,
      boughtOtherProductWithin90dCount,
      netRevenueWithin90dCents,
      ltv90Cents: BigInt(Math.round(Number(netRevenueWithin90dCents) / cohortSize)),
      avgDaysToNextPurchase: anyRepeatWithin90dCount ? 30 + index + segmentIndex * 4 : null,
      medianDaysToNextPurchase: anyRepeatWithin90dCount ? 26 + index + segmentIndex * 3 : null,
      isMature90d: cohort.isMature90d,
      isLowSampleSize: cohortSize < 5,
    };
  });
}

function buildSeedRetentionSummary({ shop, product, diagnosisId, retentionRunId, asOfDate, cohorts, dailyActivity, syntheticOrderCount }) {
  const mature90 = cohorts.filter((cohort) => cohort.isMature90d);
  const mature180 = cohorts.filter((cohort) => cohort.isMature180d);
  const totalCustomersAnalyzed = cohorts.reduce((sum, cohort) => sum + cohort.cohortSize, 0);
  const totalProductOrdersAnalyzed = dailyActivity.reduce((sum, row) => sum + row.productOrdersCount, 0);
  const repeat90 = ratioFromRows(mature90, "anyRepeatWithin90dCount", "cohortSize");
  const repeat180 = ratioFromRows(mature180, "anyRepeatWithin180dCount", "cohortSize");
  const same90 = ratioFromRows(mature90, "sameProductRepeatWithin90dCount", "cohortSize");
  const same180 = ratioFromRows(mature180, "sameProductRepeatWithin180dCount", "cohortSize");
  const cross90 = ratioFromRows(mature90, "boughtOtherProductWithin90dCount", "cohortSize");
  const returningRevenueShare = average(dailyActivity.map((row) => row.returningRevenueShare));
  const productLtv90Cents = Math.round(average(mature90.map((cohort) => Number(cohort.ltv90Cents || 0))));
  const productLtv180Cents = Math.round(average(mature180.map((cohort) => Number(cohort.ltv180Cents || 0))) || productLtv90Cents * 1.14);
  const medianDaysToSecondPurchase = average(mature90.map((cohort) => Number(cohort.medianDaysToNextPurchase || 0)).filter(Boolean));
  const retentionHealthScore = clamp(Math.round(34 + repeat90 * 36 + same90 * 22 + cross90 * 18 - product.riskScore * 0.08), 20, 96);
  const repeatPurchaseRate90dPrevious = clamp(repeat90 - 0.035 + deterministicWave(product.handle, 20) * 0.015, 0, 1);
  const sameProductRepurchaseRate90dPrevious = clamp(same90 - 0.02 + deterministicWave(product.handle, 21) * 0.012, 0, 1);
  const returningRevenueSharePrevious = clamp(returningRevenueShare - 0.025, 0, 1);
  const ltv90PreviousCents = Math.max(0, Math.round(productLtv90Cents * 0.94));

  return {
    shopId: shop,
    productGid: product.productGid,
    diagnosisId,
    retentionRunId,
    asOfDate,
    repeatPurchaseRate90d: repeat90,
    repeatPurchaseRate180d: repeat180,
    sameProductRepurchaseRate90d: same90,
    sameProductRepurchaseRate180d: same180,
    crossSellRetentionRate90d: cross90,
    returningRevenueShare,
    avgDaysToSecondPurchase: average(mature90.map((cohort) => Number(cohort.avgDaysToNextPurchase || 0)).filter(Boolean)),
    medianDaysToSecondPurchase,
    productLtv90Cents: BigInt(productLtv90Cents),
    productLtv180Cents: BigInt(productLtv180Cents),
    retentionHealthScore,
    repeatPurchaseRate90dPrevious,
    repeatPurchaseRate90dDelta: repeat90 - repeatPurchaseRate90dPrevious,
    sameProductRepurchaseRate90dPrevious,
    sameProductRepurchaseRate90dDelta: same90 - sameProductRepurchaseRate90dPrevious,
    ltv90PreviousCents: BigInt(ltv90PreviousCents),
    ltv90DeltaCents: BigInt(productLtv90Cents - ltv90PreviousCents),
    returningRevenueSharePrevious,
    returningRevenueShareDelta: returningRevenueShare - returningRevenueSharePrevious,
    totalCustomersAnalyzed,
    totalOrdersAnalyzed: syntheticOrderCount,
    totalProductOrdersAnalyzed,
    earliestOrderDate: new Date(`${cohorts[0]?.cohortDate || formatDateKey(daysAgo(RETENTION_LOOKBACK_DAYS, SEED_NOW))}T12:00:00.000Z`),
    latestOrderDate: SEED_NOW,
    hasEnoughData: totalCustomersAnalyzed >= 10,
    lowSampleWarning: totalCustomersAnalyzed < 30,
  };
}

function buildSeedRetentionPayload({ run, summary, cohorts, cohortCells, dailyActivity, segmentDaily }) {
  const serializedSummary = serializeSeedRetentionRecord(summary);
  const serializedCohorts = cohorts.map(serializeSeedRetentionRecord);
  const serializedCells = cohortCells.map(serializeSeedRetentionRecord);
  const serializedDailyActivity = dailyActivity.map(serializeSeedRetentionRecord);
  const serializedSegmentDaily = segmentDaily.map(serializeSeedRetentionRecord);
  const ageAggregates = aggregateSeedRetentionCellsByAge(serializedCells);

  return {
    run: {
      id: run.id,
      status: run.status,
      schemaVersion: run.schemaVersion,
      asOfDate: run.asOfDate.toISOString(),
      timezone: run.timezone,
      windowStartDate: run.windowStartDate.toISOString(),
      windowEndDate: run.windowEndDate.toISOString(),
      lookbackDays: run.lookbackDays,
      maxCohortAgeDays: run.maxCohortAgeDays,
      currency: run.currency,
    },
    summary: {
      ...serializedSummary,
      earliestOrderDate: summary.earliestOrderDate?.toISOString?.() || summary.earliestOrderDate,
      latestOrderDate: summary.latestOrderDate?.toISOString?.() || summary.latestOrderDate,
    },
    dailyRetentionTrend: serializedCohorts.map((cohort) => ({
      date: cohort.cohortDate,
      cohortSize: cohort.cohortSize,
      repeatPurchaseRate90d: cohort.isMature90d ? ratioDecimal(cohort.anyRepeatWithin90dCount, cohort.cohortSize) : null,
      sameProductRepurchaseRate90d: cohort.isMature90d ? ratioDecimal(cohort.sameProductRepeatWithin90dCount, cohort.cohortSize) : null,
      crossSellRetentionRate90d: cohort.isMature90d ? ratioDecimal(cohort.boughtOtherProductWithin90dCount, cohort.cohortSize) : null,
      isMature90d: cohort.isMature90d,
    })),
    nextPurchaseOutcome: serializedCohorts.map((cohort) => ({
      date: cohort.cohortDate,
      sameProductAgainPercent: ratioDecimal(cohort.nextPurchaseSameProductCount, cohort.cohortSize),
      boughtAnotherProductPercent: ratioDecimal(cohort.nextPurchaseOtherProductCount, cohort.cohortSize),
      didNotReturnPercent: ratioDecimal(cohort.didNotReturnCount, cohort.cohortSize),
    })),
    cohortHeatmap: serializedCells.map((cell) => ({
      cohortDate: cell.cohortDate,
      ageDay: cell.ageDay,
      cohortSize: cell.cohortSize,
      anyRepeatRate: cell.anyRepeatRate,
      sameProductRepeatRate: cell.sameProductRepeatRate,
      boughtOtherProductRate: cell.boughtOtherProductRate,
      cumulativeLtvCents: cell.cumulativeLtvCents,
      isObserved: cell.isObserved,
    })),
    timeToRepeatPurchase: ageAggregates.map((cell) => ({
      ageDay: cell.ageDay,
      anyRepeatCumulativeRate: cell.anyRepeatRate,
      sameProductRepeatCumulativeRate: cell.sameProductRepeatRate,
      boughtOtherProductCumulativeRate: cell.boughtOtherProductRate,
    })),
    ltvCurve: ageAggregates.map((cell) => ({
      ageDay: cell.ageDay,
      cumulativeLtvCents: cell.cumulativeLtvCents,
      sameProductLtvCents: cell.sameProductCumulativeLtvCents,
      otherProductLtvCents: cell.otherProductCumulativeLtvCents,
    })),
    retentionHealthTrend: serializedCohorts
      .filter((cohort) => cohort.isMature90d)
      .map((cohort, trendIndex) => ({
        date: cohort.cohortDate,
        retentionHealthScore: clamp(Math.round(Number(summary.retentionHealthScore || 0) - 8 + trendIndex * 2), 10, 100),
        repeatPurchaseRate90d: ratioDecimal(cohort.anyRepeatWithin90dCount, cohort.cohortSize),
        sameProductRepurchaseRate90d: ratioDecimal(cohort.sameProductRepeatWithin90dCount, cohort.cohortSize),
        crossSellRetentionRate90d: ratioDecimal(cohort.boughtOtherProductWithin90dCount, cohort.cohortSize),
        productLtv90Cents: cohort.ltv90Cents,
        totalCustomersAnalyzed: cohort.cohortSize,
        source: DEMO_SEED_SOURCE,
      })),
    segments: aggregateSeedRetentionSegments(serializedSegmentDaily),
    dailyActivity: serializedDailyActivity,
    segmentDaily: serializedSegmentDaily,
  };
}

function aggregateSeedRetentionCellsByAge(cells) {
  const byAge = new Map();
  cells.forEach((cell) => {
    const current = byAge.get(cell.ageDay) || {
      ageDay: cell.ageDay,
      count: 0,
      anyRepeatRate: 0,
      sameProductRepeatRate: 0,
      boughtOtherProductRate: 0,
      cumulativeLtvCents: 0,
      sameProductCumulativeLtvCents: 0,
      otherProductCumulativeLtvCents: 0,
    };
    current.count += 1;
    current.anyRepeatRate += Number(cell.anyRepeatRate || 0);
    current.sameProductRepeatRate += Number(cell.sameProductRepeatRate || 0);
    current.boughtOtherProductRate += Number(cell.boughtOtherProductRate || 0);
    current.cumulativeLtvCents += Number(cell.cumulativeLtvCents || 0);
    current.sameProductCumulativeLtvCents += Number(cell.sameProductCumulativeLtvCents || 0);
    current.otherProductCumulativeLtvCents += Number(cell.otherProductCumulativeLtvCents || 0);
    byAge.set(cell.ageDay, current);
  });
  return Array.from(byAge.values()).map((cell) => ({
    ageDay: cell.ageDay,
    anyRepeatRate: round(cell.anyRepeatRate / Math.max(1, cell.count), 4),
    sameProductRepeatRate: round(cell.sameProductRepeatRate / Math.max(1, cell.count), 4),
    boughtOtherProductRate: round(cell.boughtOtherProductRate / Math.max(1, cell.count), 4),
    cumulativeLtvCents: Math.round(cell.cumulativeLtvCents / Math.max(1, cell.count)),
    sameProductCumulativeLtvCents: Math.round(cell.sameProductCumulativeLtvCents / Math.max(1, cell.count)),
    otherProductCumulativeLtvCents: Math.round(cell.otherProductCumulativeLtvCents / Math.max(1, cell.count)),
  })).sort((left, right) => left.ageDay - right.ageDay);
}

function aggregateSeedRetentionSegments(segmentDaily) {
  const bySegment = new Map();
  segmentDaily.forEach((segment) => {
    const key = `${segment.segmentType}:${segment.segmentValue}`;
    const current = bySegment.get(key) || {
      segmentType: segment.segmentType,
      segmentValue: segment.segmentValue,
      cohortSize: 0,
      anyRepeatWithin90dCount: 0,
      sameProductRepeatWithin90dCount: 0,
      boughtOtherProductWithin90dCount: 0,
      ltv90Cents: 0,
      medianDaysToSecondPurchaseValues: [],
      isLowSampleSize: false,
    };
    current.cohortSize += Number(segment.cohortSize || 0);
    current.anyRepeatWithin90dCount += Number(segment.anyRepeatWithin90dCount || 0);
    current.sameProductRepeatWithin90dCount += Number(segment.sameProductRepeatWithin90dCount || 0);
    current.boughtOtherProductWithin90dCount += Number(segment.boughtOtherProductWithin90dCount || 0);
    current.ltv90Cents += Number(segment.ltv90Cents || 0);
    if (segment.medianDaysToNextPurchase != null) current.medianDaysToSecondPurchaseValues.push(Number(segment.medianDaysToNextPurchase));
    current.isLowSampleSize = current.isLowSampleSize || Boolean(segment.isLowSampleSize);
    bySegment.set(key, current);
  });
  return Array.from(bySegment.values()).map((segment) => ({
    segmentType: segment.segmentType,
    segmentValue: segment.segmentValue,
    cohortSize: segment.cohortSize,
    repeatPurchaseRate90d: ratioDecimal(segment.anyRepeatWithin90dCount, segment.cohortSize),
    sameProductRepurchaseRate90d: ratioDecimal(segment.sameProductRepeatWithin90dCount, segment.cohortSize),
    crossSellRetentionRate90d: ratioDecimal(segment.boughtOtherProductWithin90dCount, segment.cohortSize),
    ltv90Cents: Math.round(segment.ltv90Cents / Math.max(1, segmentDaily.filter((item) => item.segmentType === segment.segmentType && item.segmentValue === segment.segmentValue).length)),
    medianDaysToSecondPurchase: average(segment.medianDaysToSecondPurchaseValues),
    isLowSampleSize: segment.isLowSampleSize,
  })).slice(0, 12);
}

function serializeSeedRetentionRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, serializeSeedRetentionValue(value)]));
}

function serializeSeedRetentionValue(value) {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && !Array.isArray(value)) return serializeSeedRetentionRecord(value);
  if (Array.isArray(value)) return value.map(serializeSeedRetentionValue);
  return value;
}

function toSeedRetentionSummaryDbRow(row) {
  return row;
}

function toSeedRetentionDailyCohortDbRow(row) {
  return row;
}

function toSeedRetentionCohortCellDbRow(row) {
  return row;
}

function toSeedRetentionDailyActivityDbRow(row) {
  return row;
}

function toSeedRetentionSegmentDailyDbRow(row) {
  return row;
}

function centsBigInt(value) {
  return BigInt(Math.max(0, Math.round(Number(value || 0) * 100)));
}

function ratioDecimal(numerator, denominator) {
  const den = Number(denominator || 0);
  if (den <= 0) return 0;
  return round(Number(numerator || 0) / den, 6);
}

function ratioFromRows(rows, numeratorKey, denominatorKey) {
  const numerator = rows.reduce((sum, row) => sum + Number(row[numeratorKey] || 0), 0);
  const denominator = rows.reduce((sum, row) => sum + Number(row[denominatorKey] || 0), 0);
  return ratioDecimal(numerator, denominator);
}

function buildSeedRetentionOrders(product, index) {
  const months = getMonthStarts(SEED_NOW, MONTHS_TO_SEED);
  const cohortMonthIndexes = [0, 1, 2, 4, 6, 8, 10];
  const customerCount = 28 + (index % 5) * 2;
  const orders = [];

  for (let customerIndex = 0; customerIndex < customerCount; customerIndex += 1) {
    const cohortMonth = months[cohortMonthIndexes[customerIndex % cohortMonthIndexes.length]] || months[0];
    const firstOrderDate = clampDateBeforeNow(addDays(cohortMonth, 4 + (customerIndex % 4) * 5));
    const customerGid = `gid://shopify/Customer/pp-demo-${stableProductNumber(product)}-${String(customerIndex + 1).padStart(3, "0")}`;
    const firstQuantity = customerIndex % 11 === 0 ? 3 : customerIndex % 5 === 0 ? 2 : 1;
    const firstOrder = buildSeedRetentionOrder({
      product,
      index,
      customerIndex,
      orderIndex: 0,
      customerGid,
      orderDate: firstOrderDate,
      quantity: firstQuantity,
      includeDiscount: customerIndex % 4 === 0,
      includeRefund: shouldSeedRetentionRefund(product, customerIndex, index),
      includeOtherLine: customerIndex % 6 === 0,
      sourceName: customerIndex % 3 === 0 ? "online_store" : "shopify_draft_order",
    });
    orders.push(firstOrder);

    const sameProductRepeat = customerIndex % 3 === 0 || (product.riskScore < 55 && customerIndex % 4 === 0);
    const crossSellRepeat = customerIndex % 3 === 1 || customerIndex % 7 === 0;
    const secondOrderDate = addDays(firstOrderDate, sameProductRepeat ? 24 + (customerIndex % 5) * 9 : 32 + (customerIndex % 6) * 8);
    if ((sameProductRepeat || crossSellRepeat) && secondOrderDate <= SEED_NOW) {
      orders.push(buildSeedRetentionOrder({
        product: sameProductRepeat ? product : getRelatedSeedProduct(product, index, customerIndex),
        anchorProduct: product,
        index,
        customerIndex,
        orderIndex: 1,
        customerGid,
        orderDate: secondOrderDate,
        quantity: sameProductRepeat && customerIndex % 8 === 0 ? 2 : 1,
        includeDiscount: customerIndex % 5 === 0,
        includeRefund: sameProductRepeat && shouldSeedRetentionRefund(product, customerIndex + 3, index),
        includeOtherLine: sameProductRepeat && crossSellRepeat,
        sourceName: "online_store",
      }));
    }

    const thirdOrderDate = addDays(firstOrderDate, 76 + (customerIndex % 5) * 13);
    if (customerIndex % 5 === 0 && thirdOrderDate <= SEED_NOW) {
      orders.push(buildSeedRetentionOrder({
        product: customerIndex % 10 === 0 ? product : getRelatedSeedProduct(product, index, customerIndex + 4),
        anchorProduct: product,
        index,
        customerIndex,
        orderIndex: 2,
        customerGid,
        orderDate: thirdOrderDate,
        quantity: 1,
        includeDiscount: customerIndex % 10 === 0,
        includeRefund: false,
        includeOtherLine: customerIndex % 2 === 0,
        sourceName: "pos",
      }));
    }
  }

  return orders.sort((left, right) => new Date(left.processedAt).getTime() - new Date(right.processedAt).getTime());
}

function buildSeedRetentionOrder({
  product,
  anchorProduct = product,
  index,
  customerIndex,
  orderIndex,
  customerGid,
  orderDate,
  quantity = 1,
  includeDiscount = false,
  includeRefund = false,
  includeOtherLine = false,
  sourceName = "online_store",
}) {
  const productNumber = stableProductNumber(anchorProduct);
  const orderNumber = `${productNumber}${String(customerIndex + 1).padStart(3, "0")}${orderIndex + 1}`;
  const discountRate = includeDiscount ? 0.12 : 0;
  const productLine = buildSeedRetentionLineItem({
    product,
    anchorProduct,
    index,
    customerIndex,
    orderIndex,
    lineIndex: 0,
    quantity,
    discountRate,
    includeRefund,
    orderDate,
  });
  const lineItems = [productLine];

  if (includeOtherLine) {
    const related = getRelatedSeedProduct(anchorProduct, index, customerIndex + orderIndex + 1);
    lineItems.push(buildSeedRetentionLineItem({
      product: related,
      anchorProduct,
      index,
      customerIndex,
      orderIndex,
      lineIndex: 1,
      quantity: 1,
      discountRate: includeDiscount ? 0.08 : 0,
      includeRefund: false,
      orderDate,
    }));
  }

  return {
    id: `gid://shopify/Order/pp-demo-${orderNumber}`,
    name: `#PPD-${orderNumber}`,
    customerGid,
    processedAt: orderDate.toISOString(),
    createdAt: addDays(orderDate, -1).toISOString(),
    financialStatus: "PAID",
    displayFinancialStatus: includeRefund ? "PARTIALLY_REFUNDED" : "PAID",
    sourceName,
    customerTags: [
      "productpulse-demo",
      customerIndex % 2 === 0 ? "loyalty" : "first-time",
      customerIndex % 4 === 0 ? "email" : "organic",
    ],
    discountCodes: includeDiscount ? [`PPDEMO${(index % 4) + 1}`] : [],
    currency: "USD",
    lineItems,
    test: true,
  };
}

function buildSeedRetentionLineItem({
  product,
  anchorProduct,
  index,
  customerIndex,
  orderIndex,
  lineIndex,
  quantity,
  discountRate,
  includeRefund,
  orderDate,
}) {
  const priceCents = Math.max(199, Math.round(Number(product.price || 20) * 100));
  const grossRevenueCents = priceCents * quantity;
  const discountedRevenueCents = Math.round(grossRevenueCents * (1 - discountRate));
  const refundQuantity = includeRefund ? Math.max(1, Math.min(quantity, customerIndex % 4 === 0 ? 2 : 1)) : 0;
  const refundAmountCents = refundQuantity ? Math.round((discountedRevenueCents / Math.max(1, quantity)) * refundQuantity * 0.92) : 0;
  const lineId = `gid://shopify/LineItem/pp-demo-${stableProductNumber(anchorProduct)}-${customerIndex + 1}-${orderIndex + 1}-${lineIndex + 1}`;
  return {
    id: lineId,
    productGid: product.productGid,
    variantGid: `${product.productGid.replace("/Product/", "/ProductVariant/")}${lineIndex + 1}`,
    title: product.productTitle,
    sku: `${buildSku(product)}-${lineIndex + 1}`,
    variantTitle: buildAffectedVariants(product, index + customerIndex)[0] || "Default Title",
    quantity,
    grossRevenueCents,
    discountedRevenueCents,
    refundedRevenueCents: refundAmountCents,
    netRevenueCents: Math.max(0, discountedRevenueCents - refundAmountCents),
    currency: "USD",
    discountCodes: discountRate ? [`PPDEMO${(index % 4) + 1}`] : [],
    refunds: refundAmountCents
      ? [{
          id: `gid://shopify/Refund/pp-demo-${stableProductNumber(anchorProduct)}-${customerIndex + 1}-${orderIndex + 1}-${lineIndex + 1}`,
          processedAt: clampDateBeforeNow(addDays(orderDate, 9 + (customerIndex % 6))).toISOString(),
          amountCents: refundAmountCents,
        }]
      : [],
  };
}

function shouldSeedRetentionRefund(product, customerIndex, index) {
  const riskBucket = product.riskScore >= 85 ? 3 : product.riskScore >= 65 ? 5 : 8;
  return (customerIndex + index) % riskBucket === 0;
}

function getRelatedSeedProduct(product, index, offset) {
  const candidates = PRODUCT_FIXTURES.filter((candidate) => candidate.productGid !== product.productGid);
  return candidates[(index + offset) % candidates.length] || product;
}

function stableProductNumber(product) {
  const digits = String(product.productGid || "").replace(/\D+/g, "");
  if (digits) return digits.slice(-8);
  return String(hashString(product.productTitle || product.handle || "product")).slice(-8);
}

function clampDateBeforeNow(date) {
  const parsed = parseDate(date) || SEED_NOW;
  if (parsed <= SEED_NOW) return parsed;
  return daysAgo(1, SEED_NOW);
}

async function seedActionRecords(shop, product, diagnosisId, recommendations, index) {
  const statuses = getSeedActionStatuses(index);
  const records = recommendations
    .map((recommendation, recommendationIndex) => ({
      recommendation,
      status: statuses[recommendationIndex] || null,
      createdAt: daysAgo(10 - recommendationIndex + index, SEED_NOW),
    }))
    .filter((item) => item.status);

  const createdRecords = [];
  for (const record of records) {
    const created = await prisma.productAction.create({
      data: {
        shop,
        diagnosisId,
        productGid: product.productGid,
        actionType: record.recommendation.id,
        label: record.recommendation.label,
        status: record.status,
        payload: {
          ...record.recommendation.payload,
          seeded: true,
          seedSource: DEMO_SEED_SOURCE,
        },
        createdAt: record.createdAt,
        appliedAt: ["applied", "reviewed", "dismissed"].includes(record.status) ? daysAgo(3 + index, SEED_NOW) : null,
      },
    });
    createdRecords.push(created);
  }
  return createdRecords;
}

async function seedTimelineEvents({
  shop,
  product,
  profile,
  diagnosis,
  actionRecords = [],
  riskHistory = [],
  metrics = {},
  monthlySummary = {},
  index = 0,
}) {
  const currentHistory = riskHistory[riskHistory.length - 1] || {};
  const previousHistory = riskHistory[riskHistory.length - 3] || riskHistory[riskHistory.length - 2] || {};
  const riskDelta = Number(currentHistory.riskScore || product.riskScore || 0) - Number(previousHistory.riskScore || product.riskScore || 0);
  const primaryActionRecord = actionRecords[0] || null;
  const contentChange = metrics.productChangeLog?.[0] || {};
  const now = new Date();
  const rows = [
    {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "quickscan_completed",
      category: "scan",
      source: "Shopify QuickScan",
      title: "QuickScan completed",
      summary: `QuickScan stored ${previousHistory.riskScore || product.riskScore}/100 risk with ${previousHistory.primaryIssue || profile.mainIssue}.`,
      occurredAt: parseDate(previousHistory.recordedAt) || daysAgo(14 + index, SEED_NOW),
      severityTone: product.riskScore >= 75 ? "critical" : product.riskScore >= 55 ? "warning" : "info",
      importance: 42,
      confidence: previousHistory.confidence || product.confidence,
      afterValue: { riskScore: previousHistory.riskScore || product.riskScore, primaryIssue: previousHistory.primaryIssue || profile.mainIssue },
      metadata: { seedSource: DEMO_SEED_SOURCE, riskLabel: getSeedRiskLabel(previousHistory.riskScore || product.riskScore) },
      dedupeKey: `seed:${product.productGid}:quickscan`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    },
    {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "diagnosis_completed",
      category: "diagnosis",
      source: "ProductPulse AI diagnosis",
      title: "Full diagnosis completed",
      summary: `${product.productTitle} received a full seeded diagnosis with ${metrics.signalCount || metrics.signalsCount || 0} signals and ${product.confidence}% confidence.`,
      occurredAt: diagnosis.completedAt || daysAgo(1 + index, SEED_NOW),
      severityTone: product.riskScore >= 75 ? "critical" : product.riskScore >= 55 ? "warning" : "success",
      importance: 76,
      confidence: product.confidence,
      afterValue: { riskScore: product.riskScore, impactScore: product.impactScore, confidence: product.confidence },
      metadata: { seedSource: DEMO_SEED_SOURCE, latestDiagnosisId: diagnosis.id, analysisDepth: "full" },
      dedupeKey: `seed:${product.productGid}:diagnosis-completed`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    },
    Math.abs(riskDelta) >= 5 ? {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: riskDelta >= 0 ? "risk_score_increased" : "risk_score_decreased",
      category: "risk",
      source: "ProductPulse score history",
      title: riskDelta >= 0 ? "Product risk increased" : "Product risk decreased",
      summary: `Risk moved from ${previousHistory.riskScore}/100 to ${currentHistory.riskScore || product.riskScore}/100.`,
      occurredAt: parseDate(currentHistory.recordedAt) || diagnosis.completedAt || SEED_NOW,
      severityTone: riskDelta >= 0 ? "warning" : "success",
      importance: 64,
      confidence: product.confidence,
      beforeValue: { riskScore: previousHistory.riskScore, riskLabel: getSeedRiskLabel(previousHistory.riskScore) },
      afterValue: { riskScore: currentHistory.riskScore || product.riskScore, riskLabel: getSeedRiskLabel(currentHistory.riskScore || product.riskScore) },
      metadata: { seedSource: DEMO_SEED_SOURCE, delta: riskDelta },
      dedupeKey: `seed:${product.productGid}:risk-change`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    } : null,
    {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "main_issue_changed",
      category: "risk",
      source: "ProductPulse diagnosis",
      title: "Main issue changed",
      summary: `Main issue changed from ${profile.issueTitle} to ${profile.mainIssue}.`,
      occurredAt: daysAgo(1 + index, SEED_NOW),
      severityTone: product.riskScore >= 55 ? "warning" : "info",
      importance: 68,
      confidence: product.confidence,
      beforeValue: { primaryIssue: profile.issueTitle },
      afterValue: { primaryIssue: profile.mainIssue },
      metadata: { seedSource: DEMO_SEED_SOURCE, previousPrimaryIssue: profile.issueTitle, currentPrimaryIssue: profile.mainIssue },
      dedupeKey: `seed:${product.productGid}:main-issue`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    },
    {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "new_negative_reviews_detected",
      category: "reviews",
      source: "Reviews",
      title: "New negative reviews detected",
      summary: `${Math.max(2, Math.round(product.riskScore / 12))} negative review signals mention ${profile.repeatedLanguage[0]}.`,
      occurredAt: daysAgo(5 + index, SEED_NOW),
      severityTone: "warning",
      importance: 61,
      confidence: product.confidence,
      afterValue: { negativeReviewCount: metrics.negativeReviewCount || null, avgRating: metrics.avgRating || null },
      metadata: { seedSource: DEMO_SEED_SOURCE, dominantEmotion: profile.sentiment },
      dedupeKey: `seed:${product.productGid}:negative-reviews`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    },
    {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "return_pressure_changed",
      category: "returns",
      source: "Returns",
      title: "Top return reason changed",
      summary: `Top return reason is now ${profile.returnReasons[0]} across ${monthlySummary.totalReturnedUnits || 0} returned units.`,
      occurredAt: daysAgo(4 + index, SEED_NOW),
      severityTone: "warning",
      importance: 60,
      afterValue: { returnRate: monthlySummary.returnRate || null, returnUnits: monthlySummary.totalReturnedUnits || null, topReturnReason: profile.returnReasons[0] },
      metadata: { seedSource: DEMO_SEED_SOURCE, reasonChanged: true },
      dedupeKey: `seed:${product.productGid}:returns`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    },
    metrics.refundAmount ? {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "refund_exposure_increased",
      category: "refunds",
      source: "Refunds",
      title: "Refund exposure updated",
      summary: `Refund exposure is ${formatMoney(metrics.refundAmount)} across current evidence.`,
      occurredAt: daysAgo(3 + index, SEED_NOW),
      severityTone: "warning",
      importance: 58,
      afterValue: { refundAmount: metrics.refundAmount, refundUnits: metrics.refundUnits || null },
      metadata: { seedSource: DEMO_SEED_SOURCE },
      dedupeKey: `seed:${product.productGid}:refunds`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    } : null,
    metrics.productMomentum ? {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "product_momentum_updated",
      category: "momentum",
      source: "Product Momentum",
      title: "Product Momentum updated",
      summary: `Momentum is ${metrics.productMomentum.score}/100 (${metrics.productMomentum.tier}) with ${metrics.productMomentum.direction} direction.`,
      occurredAt: daysAgo(6 + index, SEED_NOW),
      severityTone: metrics.productMomentum.score >= 70 ? "success" : "info",
      importance: 57,
      confidence: metrics.productMomentum.confidence,
      afterValue: { productMomentumScore: metrics.productMomentum.score, tier: metrics.productMomentum.tier, direction: metrics.productMomentum.direction },
      metadata: { seedSource: DEMO_SEED_SOURCE, productMomentum: metrics.productMomentum },
      dedupeKey: `seed:${product.productGid}:momentum`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    } : null,
    metrics.productRetention?.summary ? {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "product_retention_calculated",
      category: "evidence",
      source: "Product retention",
      title: "Retention metrics calculated",
      summary: `${metrics.productRetention.summary.totalCustomersAnalyzed || 0} cohort customers and ${metrics.productRetention.summary.retentionHealthScore || "low-sample"} retention health were stored.`,
      occurredAt: daysAgo(2 + index, SEED_NOW),
      severityTone: "info",
      importance: 59,
      confidence: product.confidence,
      afterValue: metrics.productRetention.summary,
      metadata: { seedSource: DEMO_SEED_SOURCE, retentionRunId: metrics.productRetention.run?.id || null },
      dedupeKey: `seed:${product.productGid}:retention`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    } : null,
    metrics.productRelationshipIntelligenceSummary ? {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "product_relationships_detected",
      category: "evidence",
      source: "Product relationships",
      title: "Product relationships detected",
      summary: `${metrics.productRelationshipIntelligenceSummary.strongestRelationships?.length || 0} relationship patterns were stored for basket and sequence analysis.`,
      occurredAt: daysAgo(7 + index, SEED_NOW),
      severityTone: "info",
      importance: 55,
      confidence: metrics.productRelationshipIntelligenceSummary.confidence?.score || product.confidence,
      afterValue: {
        strongestRelationships: metrics.productRelationshipIntelligenceSummary.strongestRelationships?.length || 0,
        topBoughtTogether: metrics.productRelationshipIntelligenceSummary.topBoughtTogether?.[0]?.relatedProductTitle || null,
      },
      metadata: { seedSource: DEMO_SEED_SOURCE },
      dedupeKey: `seed:${product.productGid}:relationships`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    } : null,
    primaryActionRecord ? {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: primaryActionRecord.status === "dismissed" ? "recommended_action_dismissed" : "recommended_action_applied",
      category: "action",
      source: "ProductPulse action",
      title: primaryActionRecord.status === "dismissed" ? "Recommended action dismissed" : "Recommended action applied",
      summary: `${primaryActionRecord.label} was ${primaryActionRecord.status}.`,
      occurredAt: primaryActionRecord.appliedAt || primaryActionRecord.createdAt,
      severityTone: primaryActionRecord.status === "dismissed" ? "neutral" : "success",
      importance: primaryActionRecord.status === "dismissed" ? 54 : 70,
      afterValue: { status: primaryActionRecord.status },
      metadata: { seedSource: DEMO_SEED_SOURCE, actionType: primaryActionRecord.actionType, label: primaryActionRecord.label },
      dedupeKey: `seed:${product.productGid}:action:${primaryActionRecord.id}`,
      diagnosisId: diagnosis.id,
      actionId: primaryActionRecord.id,
      updatedAt: now,
    } : null,
    contentChange?.label || contentChange?.title ? {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "product_content_changed",
      category: "catalog",
      source: "Shopify product data",
      title: "Product content changed",
      summary: contentChange.detail || contentChange.title || contentChange.label,
      occurredAt: daysAgo(8 + index, SEED_NOW),
      severityTone: "info",
      importance: 56,
      afterValue: { productStatus: metrics.productStatus || "ACTIVE", variantCount: metrics.variantCount || null },
      metadata: { seedSource: DEMO_SEED_SOURCE, reason: contentChange.label || contentChange.title },
      dedupeKey: `seed:${product.productGid}:content`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    } : null,
    index < WATCHLIST_PRODUCT_COUNT ? {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: "watchlist_changes_detected",
      category: "watchlist",
      source: "ProductPulse Watchlist",
      title: index === 3 ? "Watch paused" : "Watchlist run completed",
      summary: index === 3
        ? "Automatic rescans were paused for this demo product."
        : `Watchlist compared the latest state and found ${Math.max(1, index + 1)} meaningful product signal changes.`,
      occurredAt: daysAgo(2 + index, SEED_NOW),
      severityTone: index === 3 ? "neutral" : "warning",
      importance: index === 3 ? 42 : 66,
      afterValue: { riskScore: product.riskScore, riskLabel: getSeedRiskLabel(product.riskScore) },
      metadata: { seedSource: DEMO_SEED_SOURCE, changeCount: Math.max(1, index + 1), sourceChangeCount: 2 },
      dedupeKey: `seed:${product.productGid}:watchlist`,
      diagnosisId: diagnosis.id,
      updatedAt: now,
    } : null,
  ].filter(Boolean);

  if (!rows.length) return 0;
  const result = await prisma.productTimelineEvent.createMany({ data: rows, skipDuplicates: true });
  return Number(result.count || rows.length);
}

async function seedWatchlist(shop, products) {
  for (const [index, product] of products.entries()) {
    const status = index === 3 || index === 8 ? "Paused" : "Watching";
    const addedAt = daysAgo(160 - index * 4, SEED_NOW);
    const watchlistItem = await prisma.productWatchlistItem.upsert({
      where: { shop_productGid: { shop, productGid: product.productGid } },
      create: {
        shop,
        productGid: product.productGid,
        productTitle: product.productTitle,
        handle: product.handle,
        sku: buildSku(product),
        status,
        imageUrl: buildImageUrl(product),
        imageAlt: product.productTitle,
        addedAt,
      },
      update: {
        productTitle: product.productTitle,
        handle: product.handle,
        sku: buildSku(product),
        status,
        imageUrl: buildImageUrl(product),
        imageAlt: product.productTitle,
      },
    });

    const addedActivity = await prisma.productWatchActivity.create({
      data: {
        shop,
        productGid: product.productGid,
        productTitle: product.productTitle,
        watchlistItemId: watchlistItem.id,
        eventType: "product_added",
        title: "Product added to watchlist",
        detail: `${product.productTitle} entered automatic monitoring.`,
        metadata: { seedSource: DEMO_SEED_SOURCE },
        createdAt: addedAt,
      },
    });
    await seedWatchTimelineEvent(shop, product, addedActivity);

    let previousReport = null;
    for (let runIndex = 0; runIndex < WATCHLIST_RUNS_PER_PRODUCT; runIndex += 1) {
      const runDate = daysAgo((WATCHLIST_RUNS_PER_PRODUCT - runIndex) * 15 + index, SEED_NOW);
      const report = buildSeedWatchChangeReport(product, previousReport, runIndex, runDate);
      const reportActivity = await prisma.productWatchActivity.create({
        data: {
          shop,
          productGid: product.productGid,
          productTitle: product.productTitle,
          watchlistItemId: watchlistItem.id,
          eventType: "watch_change_report",
          title: report.title,
          detail: report.narrative || report.summary,
          metadata: {
            seedSource: DEMO_SEED_SOURCE,
            source: runIndex === 0 ? "watchlist-baseline" : "full-diagnosis",
            noChangesReused: report.status === "unchanged",
            riskScore: report.current.riskScore,
            riskLabel: report.current.riskLabel,
            confidence: report.current.confidence,
            impactScore: report.current.impactScore,
            primaryIssue: report.current.primaryIssue,
            report,
            snapshotSummary: report.current,
          },
          createdAt: runDate,
        },
      });
      await seedWatchTimelineEvent(shop, product, reportActivity);

      const scanActivity = await prisma.productWatchActivity.create({
        data: {
          shop,
          productGid: product.productGid,
          productTitle: product.productTitle,
          watchlistItemId: watchlistItem.id,
          eventType: runIndex === 0 ? "watch_baseline_captured" : "diagnosis_completed",
          title: runIndex === 0 ? "Watchlist baseline captured" : "Product diagnosis completed",
          detail: runIndex === 0
            ? `Baseline captured · ${report.current.riskLabel} risk (${report.current.riskScore}/100) · ${report.current.primaryIssue}`
            : `${report.current.riskLabel} risk (${report.current.riskScore}/100) · ${report.current.primaryIssue}`,
          metadata: {
            seedSource: DEMO_SEED_SOURCE,
            source: runIndex === 0 ? "watchlist-baseline" : "full-diagnosis",
            riskScore: report.current.riskScore,
            riskLabel: report.current.riskLabel,
            confidence: report.current.confidence,
            impactScore: report.current.impactScore,
            primaryIssue: report.current.primaryIssue,
            changeCount: report.changeCount,
          },
          createdAt: addMinutes(runDate, 2),
        },
      });
      await seedWatchTimelineEvent(shop, product, scanActivity);
      previousReport = report;
    }

    if (status === "Paused") {
      const pausedActivity = await prisma.productWatchActivity.create({
        data: {
          shop,
          productGid: product.productGid,
          productTitle: product.productTitle,
          watchlistItemId: watchlistItem.id,
          eventType: "product_paused",
          title: "Product paused",
          detail: "Automatic rescans were paused for this demo product after the latest seeded run.",
          metadata: { seedSource: DEMO_SEED_SOURCE, riskScore: product.riskScore, confidence: product.confidence },
          createdAt: daysAgo(2 + index, SEED_NOW),
        },
      });
      await seedWatchTimelineEvent(shop, product, pausedActivity);
    }
  }
}

async function seedWatchTimelineEvent(shop, product, activity) {
  await prisma.productTimelineEvent.create({
    data: {
      shop,
      productGid: product.productGid,
      productTitle: product.productTitle,
      handle: product.handle,
      eventType: activity.eventType,
      category: "watchlist",
      source: "ProductPulse Watchlist",
      title: activity.title,
      summary: activity.detail,
      occurredAt: activity.createdAt,
      severityTone: getWatchTimelineTone(activity),
      importance: activity.eventType === "watch_change_report" ? 72 : 52,
      confidence: activity.metadata?.confidence || product.confidence,
      afterValue: {
        riskScore: activity.metadata?.riskScore || null,
        riskLabel: activity.metadata?.riskLabel || null,
        changeCount: activity.metadata?.changeCount || activity.metadata?.report?.changeCount || 0,
      },
      metadata: activity.metadata || { seedSource: DEMO_SEED_SOURCE },
      dedupeKey: `seed:${product.productGid}:watch:${activity.eventType}:${activity.createdAt.toISOString()}`,
      watchActivityId: activity.id,
    },
  });
}

function buildSeedWatchChangeReport(product, previousReport, runIndex, runDate) {
  const current = buildSeedWatchSnapshotSummary(product, runIndex, runDate);
  const previous = previousReport?.current || null;
  const history = previousReport?.history ? [...previousReport.history] : [];
  const status = !previous ? "baseline" : runIndex % 4 === 2 ? "unchanged" : "changed";
  const sourceChanges = previous && status !== "unchanged" ? buildSeedWatchSourceChanges(product, previous, current, runIndex) : [];
  const sections = previous && status !== "unchanged" ? buildSeedWatchSections(previous, current) : [];
  const changes = sections.flatMap((section) => section.changes.map((change) => ({ ...change, sectionId: section.id, sectionTitle: section.title })));
  const sourceInsights = sourceChanges.map((change) => ({
    id: `${change.id}-insight`,
    title: change.title,
    summary: change.detail,
    bullets: (change.items || []).slice(0, 2).map((item) => item.text || item.summary || item.title).filter(Boolean),
  }));
  const changeCount = sourceChanges.length + changes.filter((change) => change.delta && change.delta !== "0").length;
  const report = {
    id: `seed-watch-report-${stableProductNumber(product)}-${runIndex + 1}`,
    status,
    title: status === "baseline" ? "Watch baseline captured" : status === "unchanged" ? "No Watchlist changes detected" : "Watchlist changes detected",
    headline: status === "baseline"
      ? "No previous Watchlist data"
      : status === "unchanged"
        ? "No meaningful changes detected"
        : getSeedWatchHeadline(previous, current),
    summary: status === "baseline"
      ? "This is the first seeded Watchlist run for this product."
      : status === "unchanged"
        ? "No new orders, returns, refunds, reviews or meaningful calculated product-state movement were detected since the previous seeded run."
        : `${sourceChanges.length} source changes and ${changes.length} calculated product-state changes since the previous Watchlist run.`,
    source: runIndex === 0 ? "watchlist-baseline" : "full-diagnosis",
    noChangesReused: status === "unchanged",
    changeCount,
    sourceChangeCount: sourceChanges.length,
    previousRunAt: previous?.capturedAt || null,
    currentRunAt: current.capturedAt,
    previous,
    current,
    narrative: status === "baseline"
      ? `ProductPulse captured ${product.productTitle} as a Watchlist baseline with ${current.riskScore}/100 risk.`
      : `${product.productTitle} moved from ${previous?.riskScore ?? current.riskScore}/100 to ${current.riskScore}/100 risk while orders, returns, refunds, reviews and momentum were compared against the previous seeded run.`,
    sourceChanges,
    sourceInsights,
    sections,
    changes,
  };
  report.history = [...history, formatSeedWatchRunHistoryPoint(report)];
  return report;
}

function buildSeedWatchSnapshotSummary(product, runIndex, runDate) {
  const metrics = product.metrics || {};
  const history = metrics.riskHistory || [];
  const historyIndex = Math.min(history.length - 1, Math.max(0, Math.round((runIndex / Math.max(1, WATCHLIST_RUNS_PER_PRODUCT - 1)) * (history.length - 1))));
  const historyPoint = history[historyIndex] || history[history.length - 1] || {};
  const months = metrics.monthlyOrderActivity?.months || [];
  const month = months[Math.min(months.length - 1, Math.max(0, Math.round((runIndex / Math.max(1, WATCHLIST_RUNS_PER_PRODUCT - 1)) * (months.length - 1))))] || {};
  const riskScore = Number(historyPoint.riskScore || product.riskScore || 0);
  const productMomentumScore = Number(historyPoint.metrics?.productMomentumScore || metrics.productMomentumScore || metrics.productMomentum?.score || 0);
  return {
    capturedAt: runDate.toISOString(),
    riskScore,
    riskLabel: getSeedRiskLabel(riskScore),
    confidence: Number(historyPoint.confidence || product.confidence || 0),
    impactScore: Number(historyPoint.impactScore || product.impactScore || 0),
    estimatedImpact: round(Number(historyPoint.metrics?.financialExposure || metrics.estimatedImpact || 0), 2),
    marginAtRisk: round(Number(historyPoint.metrics?.marginAtRisk || metrics.marginAtRisk || 0), 2),
    revenueAtRisk: round(Number(historyPoint.metrics?.revenueAtRisk || metrics.revenueAtRisk || 0), 2),
    primaryIssue: historyPoint.primaryIssue || metrics.primaryIssue || product.primaryIssue,
    orderCount: Number(month.orders || 0),
    soldUnits: Number(month.orderUnits || historyPoint.metrics?.soldUnits || 0),
    salesAmount: round(Number(month.revenue || historyPoint.metrics?.salesAmount || 0), 2),
    refundAmount: round(Number(month.refundAmount || historyPoint.metrics?.refundAmount || 0), 2),
    returnRatePercent: Number(month.returnRate || historyPoint.metrics?.returnRate || 0),
    refundRatePercent: Number(month.refundRate || historyPoint.metrics?.refundRate || 0),
    returnUnits: Number(month.returnedUnits || historyPoint.metrics?.returnUnits || 0),
    refundUnits: Number(month.refundedUnits || historyPoint.metrics?.refundUnits || 0),
    negativeReviewCount: Math.max(1, Math.round(Number(metrics.negativeReviewCount || 0) * (0.58 + runIndex * 0.08))),
    reviewCount: Math.max(1, Math.round(Number(metrics.reviewCount || 0) * (0.62 + runIndex * 0.07))),
    signalCount: Number(historyPoint.metrics?.signalCount || metrics.signalCount || metrics.signalsCount || 0),
    topReturnReason: metrics.topReturnReasons?.[0] || "",
    topRefundReason: metrics.topRefundReasons?.[0] || "",
    productMomentumScore,
    productMomentumTier: metrics.productMomentumTier || metrics.productMomentum?.tier || "Stable",
    productMomentumDirection: metrics.momentumDirection || metrics.productMomentum?.direction || "High-volume stable",
    evidenceDetails: {
      orders: { totalOrders: Number(month.orders || 0), totalUnits: Number(month.orderUnits || 0), totalRevenue: round(Number(month.revenue || 0), 2) },
      returns: { totalUnits: Number(month.returnedUnits || 0), topReason: metrics.topReturnReasons?.[0] || "" },
      refunds: { totalUnits: Number(month.refundedUnits || 0), amount: round(Number(month.refundAmount || 0), 2) },
      reviews: { negativeReviews: Math.max(1, Math.round(Number(metrics.negativeReviewCount || 0) * (0.58 + runIndex * 0.08))), averageRating: metrics.avgRating || metrics.reviewRating || 0 },
    },
    sourceFingerprint: metrics.incrementalDiagnosis?.cache?.sourceFingerprint || null,
    contentUpdated: runIndex === 2 || runIndex === 4,
  };
}

function buildSeedWatchSourceChanges(product, previous, current, runIndex) {
  const profile = product.profile || getIssueProfile(product);
  return [
    {
      id: "new-returns",
      source: "returns",
      title: "Return evidence changed",
      metric: "Returned units",
      from: previous.returnUnits,
      to: current.returnUnits,
      delta: formatSignedNumber(current.returnUnits - previous.returnUnits),
      direction: current.returnUnits >= previous.returnUnits ? "up" : "down",
      detail: `${Math.abs(current.returnUnits - previous.returnUnits)} returned-unit movement mentioning ${profile.repeatedLanguage[0]}.`,
      items: [
        { text: `${profile.returnReasons[0]}: customer mentioned ${profile.repeatedLanguage[0]}.`, sentiment: "negative" },
        { text: `${profile.returnReasons[1] || profile.returnReasons[0]}: expectation gap remained visible.`, sentiment: "mixed" },
      ],
    },
    {
      id: "new-refunds",
      source: "refunds",
      title: "Refund evidence changed",
      metric: "Refund amount",
      from: previous.refundAmount,
      to: current.refundAmount,
      delta: formatSignedMoney(current.refundAmount - previous.refundAmount),
      direction: current.refundAmount >= previous.refundAmount ? "up" : "down",
      detail: `Refund amount changed by ${formatMoney(Math.abs(current.refundAmount - previous.refundAmount))}.`,
      items: [
        { text: `Seeded refund note tied to ${profile.mainIssue.toLowerCase()}.`, sentiment: "neutral" },
      ],
    },
    runIndex % 2 === 0 ? {
      id: "product-content",
      source: "product_content",
      title: "Product content changed",
      metric: "PDP content",
      from: "Previous copy",
      to: "Updated expectation note",
      delta: "updated",
      direction: "up",
      detail: "Seeded PDP content changed so Watchlist can show a content update marker.",
      items: [
        { text: "Expectation note and FAQ context were refreshed.", sentiment: "positive" },
      ],
    } : {
      id: "new-reviews",
      source: "reviews",
      title: "Review language changed",
      metric: "Negative reviews",
      from: previous.negativeReviewCount,
      to: current.negativeReviewCount,
      delta: formatSignedNumber(current.negativeReviewCount - previous.negativeReviewCount),
      direction: current.negativeReviewCount >= previous.negativeReviewCount ? "up" : "down",
      detail: `Review language still clusters around ${profile.repeatedLanguage[0]}.`,
      items: [
        { text: `Review 2/5: ${product.productTitle} felt ${profile.repeatedLanguage[0]}.`, sentiment: "negative" },
      ],
    },
  ].filter(Boolean);
}

function buildSeedWatchSections(previous, current) {
  return [
    {
      id: "risk",
      title: "Risk",
      changes: [
        buildSeedWatchChange("risk-score", "Risk score", previous.riskScore, current.riskScore, { suffix: "/100", lowerIsGood: true }),
        buildSeedWatchChange("return-rate", "Return rate", previous.returnRatePercent, current.returnRatePercent, { suffix: "%", lowerIsGood: true }),
      ],
    },
    {
      id: "evidence",
      title: "Evidence",
      changes: [
        buildSeedWatchChange("signals", "Evidence signals", previous.signalCount, current.signalCount, { higherIsGood: true }),
        buildSeedWatchChange("negative-reviews", "Negative reviews", previous.negativeReviewCount, current.negativeReviewCount, { lowerIsGood: true }),
      ],
    },
    {
      id: "impact",
      title: "Business impact",
      changes: [
        buildSeedWatchChange("refund-amount", "Refund amount", previous.refundAmount, current.refundAmount, { money: true, lowerIsGood: true }),
        buildSeedWatchChange("sales", "Sales amount", previous.salesAmount, current.salesAmount, { money: true, higherIsGood: true }),
      ],
    },
    {
      id: "momentum",
      title: "Momentum",
      changes: [
        buildSeedWatchChange("momentum-score", "Momentum score", previous.productMomentumScore, current.productMomentumScore, { suffix: "/100", higherIsGood: true }),
      ],
    },
  ];
}

function buildSeedWatchChange(id, label, from, to, options = {}) {
  const delta = Number(to || 0) - Number(from || 0);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const tone = options.lowerIsGood
    ? delta > 0 ? "bad" : delta < 0 ? "good" : "neutral"
    : options.higherIsGood
      ? delta > 0 ? "good" : delta < 0 ? "bad" : "neutral"
      : "neutral";
  return {
    id,
    label,
    from: options.money ? formatMoney(from) : `${round(from, 1)}${options.suffix || ""}`,
    to: options.money ? formatMoney(to) : `${round(to, 1)}${options.suffix || ""}`,
    delta: options.money ? formatSignedMoney(delta) : `${delta > 0 ? "+" : ""}${round(delta, 1)}${options.suffix || ""}`,
    direction,
    tone,
    summary: `${label} moved from ${options.money ? formatMoney(from) : round(from, 1)} to ${options.money ? formatMoney(to) : round(to, 1)}.`,
  };
}

function formatSeedWatchRunHistoryPoint(report) {
  const current = report.current || {};
  return {
    id: report.id,
    status: report.status,
    changeCount: report.changeCount,
    currentRunAt: report.currentRunAt,
    capturedAt: current.capturedAt || report.currentRunAt,
    riskScore: current.riskScore,
    returnRatePercent: current.returnRatePercent,
    refundRatePercent: current.refundRatePercent,
    productMomentumScore: current.productMomentumScore,
    orderCount: current.orderCount,
    soldUnits: current.soldUnits,
    returnUnits: current.returnUnits,
    refundUnits: current.refundUnits,
    salesAmount: current.salesAmount,
    refundAmount: current.refundAmount,
    signalCount: current.signalCount,
    contentUpdated: Boolean(current.contentUpdated),
  };
}

function getSeedWatchHeadline(previous, current) {
  const riskDelta = Number(current.riskScore || 0) - Number(previous.riskScore || 0);
  if (Math.abs(riskDelta) >= 5) return riskDelta > 0 ? "Risk moved up materially" : "Risk improved materially";
  const returnDelta = Number(current.returnRatePercent || 0) - Number(previous.returnRatePercent || 0);
  if (Math.abs(returnDelta) >= 2) return returnDelta > 0 ? "Return pressure increased" : "Return pressure eased";
  return "Evidence changed without a major risk move";
}

function getWatchTimelineTone(activity) {
  if (activity.eventType === "product_paused") return "neutral";
  if (activity.eventType === "watch_change_report") {
    const status = activity.metadata?.report?.status || "";
    if (status === "unchanged") return "success";
    if (status === "baseline") return "info";
    return "warning";
  }
  return "info";
}

async function seedJobHistory(shop, products) {
  const jobSpecs = [
    {
      kind: "fast-product-scan",
      source: "ProductPulse demo seed - quarterly QuickScan",
      daysAgo: 330,
      productCount: products.length,
      eventPrefix: "quick_scan",
    },
    {
      kind: "product-diagnosis",
      source: "ProductPulse demo seed - full diagnosis batch",
      daysAgo: 250,
      productCount: Math.min(8, products.length),
      eventPrefix: "product_diagnosis",
    },
    {
      kind: "watchlist-cron",
      source: "ProductPulse demo seed - watchlist scheduled run",
      daysAgo: 120,
      productCount: Math.min(WATCHLIST_PRODUCT_COUNT, products.length),
      eventPrefix: "watchlist",
    },
    {
      kind: "fast-product-scan",
      source: "ProductPulse demo seed - monthly QuickScan refresh",
      daysAgo: 90,
      productCount: products.length,
      eventPrefix: "quick_scan",
    },
    {
      kind: "product-diagnosis",
      source: "ProductPulse demo seed - high-risk diagnosis refresh",
      daysAgo: 45,
      productCount: products.filter((product) => product.riskScore >= 75).length,
      eventPrefix: "product_diagnosis",
    },
    {
      kind: "watchlist-cron",
      source: "ProductPulse demo seed - watchlist scheduled run",
      daysAgo: 18,
      productCount: Math.min(WATCHLIST_PRODUCT_COUNT, products.length),
      eventPrefix: "watchlist",
    },
  ];

  for (const [index, spec] of jobSpecs.entries()) {
    const startedAt = daysAgo(spec.daysAgo, SEED_NOW);
    const finishedAt = addMinutes(startedAt, 8 + index * 3);
    const job = await prisma.catalogSignalJob.create({
      data: {
        shop,
        kind: spec.kind,
        source: spec.source,
        status: "Completed",
        progress: 100,
        payload: {
          seedSource: DEMO_SEED_SOURCE,
          productCount: spec.productCount,
          productGids: products.slice(0, spec.productCount).map((product) => product.productGid),
          completedBy: "npm run seed:demo",
        },
        startedAt,
        finishedAt,
        updatedAt: finishedAt,
      },
    });
    await prisma.productPulseJobLog.createMany({
      data: [
        {
          shop,
          jobId: job.id,
          event: `${spec.eventPrefix}.queued`,
          message: `${spec.source} queued from seeded data.`,
          data: { seedSource: DEMO_SEED_SOURCE, productCount: spec.productCount },
          createdAt: startedAt,
        },
        {
          shop,
          jobId: job.id,
          event: `${spec.eventPrefix}.running`,
          message: `${spec.source} processed deterministic demo inputs.`,
          data: { seedSource: DEMO_SEED_SOURCE, progress: 65 },
          createdAt: addMinutes(startedAt, 3),
        },
        {
          shop,
          jobId: job.id,
          event: `${spec.eventPrefix}.completed`,
          message: `${spec.source} completed without calling Shopify.`,
          data: { seedSource: DEMO_SEED_SOURCE, productsUpdated: spec.productCount },
          createdAt: finishedAt,
        },
      ],
    });
  }
}

function buildMetrics({
  product,
  profile,
  index,
  monthlyOrderActivity,
  returnRatePrediction,
  productMomentum,
  recommendations,
  issues,
  evidence,
  riskHistory,
  signalTrend,
  riskTrend,
  diagnosisCreatedAt,
  diagnosisCompletedAt,
}) {
  const summary = monthlyOrderActivity.summary;
  const reviewCount = Math.max(8, Math.round(summary.totalOrders * (0.06 + (index % 4) * 0.012)));
  const negativeReviewRate = clamp(product.riskScore * 0.78 + index * 0.6, 8, 72);
  const negativeReviewCount = Math.max(1, Math.round(reviewCount * (negativeReviewRate / 100)));
  const avgRating = round(clamp(4.7 - negativeReviewRate / 34, 2.1, 4.8), 1);
  const marginAtRisk = round(summary.totalRevenue * (0.025 + product.riskScore / 2900), 2);
  const revenueAtRisk = round(marginAtRisk * (2.4 + (index % 3) * 0.4), 2);
  const estimatedImpact = round(marginAtRisk + summary.totalRefundAmount * 0.35, 2);
  const contentIssueCount = product.riskScore >= 90
    ? 5
    : product.riskScore >= 80
      ? 4
      : 1 + (index % 3);
  const descriptionWordCount = product.riskScore >= 90
    ? 18 + deterministicInt(product.handle, 0, 26)
    : product.riskScore >= 80
      ? 32 + deterministicInt(product.handle, 0, 44)
      : 58 + deterministicInt(product.handle, 20, 130);
  const mediaCount = 2 + (index % 5);
  const mediaWithoutAltCount = product.riskScore >= 85 ? Math.min(mediaCount, 2 + (index % 3)) : profile.issueCode === "color_expectation" ? 2 : index % 2;
  const riskComponents = buildSeedRiskComponents({
    product,
    profile,
    summary,
    negativeReviewRate,
    contentIssueCount,
  });
  const contentIssues = buildContentIssues(product, profile, contentIssueCount);
  const contentAdvisories = buildContentAdvisories(product, profile);
  const textInsights = buildTextInsights(profile, negativeReviewCount, summary);
  const refundInsights = buildRefundInsights(summary);
  const incrementalDiagnosis = buildSeedIncrementalDiagnosis({
    product,
    profile,
    index,
    summary,
    contentIssues,
    contentAdvisories,
    textInsights,
    refundInsights,
    contentIssueCount,
    descriptionWordCount,
    mediaCount,
    mediaWithoutAltCount,
    diagnosisCreatedAt,
    diagnosisCompletedAt,
  });
  const catalogDetails = buildSeedCatalogDetails(product, profile, index);
  const relationshipContext = buildSeedRelationshipAndContextMetrics({
    product,
    profile,
    index,
    summary,
    monthlyOrderActivity,
    negativeReviewCount,
  });
  const chartInterpretations = buildSeedChartInterpretations({
    product,
    profile,
    summary,
    returnRatePrediction,
    productMomentum,
    riskHistory,
  });

  return {
    seedSource: DEMO_SEED_SOURCE,
    analysisDepth: "full",
    windowDays: 365,
    createdAt: diagnosisCreatedAt.toISOString(),
    completedAt: diagnosisCompletedAt.toISOString(),
    latestDiagnosisAt: diagnosisCompletedAt.toISOString(),
    lastDetailedDiagnosisAt: diagnosisCompletedAt.toISOString(),
    lastAnalyzedAt: diagnosisCompletedAt.toISOString(),
    productGid: product.productGid,
    handle: product.handle,
    sku: buildSku(product),
    vendor: product.vendor,
    productType: product.productType,
    productStory: buildSeedProductStory(product, profile, index),
    tags: product.tags,
    collections: product.collections,
    price: product.price,
    ...catalogDetails,
    avgUnitRevenue: product.price,
    imageUrl: buildImageUrl(product),
    imageAlt: product.productTitle,
    hasDescription: true,
    descriptionWordCount,
    descriptionLength: descriptionWordCount * 6,
    contentQualityScore: clamp(92 - product.riskScore + deterministicInt(product.handle, 0, 10), 18, 92),
    contentQualityRisk: clamp(product.riskScore * 0.35 + contentIssueCount * 4, 0, 45),
    contentIssueCount,
    contentIssues,
    contentAdvisoryCount: contentIssueCount,
    contentAdvisories,
    mediaCount,
    mediaWithoutAltCount,
    titleNeedsReview: product.riskScore >= 80 || profile.issueCode === "fit_sizing" || product.primaryIssue.toLowerCase().includes("other"),
    variantNamingAdvisory: product.productTitle.toLowerCase().includes("snowboard") || profile.issueCode === "fit_sizing",
    soldUnits: summary.totalOrderUnits,
    salesAmount: summary.totalRevenue,
    returnUnits: summary.totalReturnedUnits,
    returnRate: summary.returnRate,
    refundUnits: summary.totalRefundedUnits,
    refundRate: summary.refundRate,
    refundAmount: summary.totalRefundAmount,
    storeAvgReturnRate: 6.2,
    storeAvgRefundRate: 2.1,
    reviewCount,
    avgRating,
    reviewRating: avgRating,
    negativeReviewCount,
    negativeReviewRate: round(negativeReviewRate, 1),
    recentNegativeReviewCount: Math.max(0, Math.round(negativeReviewCount * 0.28)),
    judgeMeReviewCount: Math.round(reviewCount * 0.62),
    csvReviewCount: reviewCount - Math.round(reviewCount * 0.62),
    csvReviewRatingCount: reviewCount - Math.round(reviewCount * 0.62),
    csvLowRatingCount: Math.round(negativeReviewCount * 0.38),
    csvCriticalRatingCount: Math.max(0, Math.round(negativeReviewCount * 0.12)),
    csvNeutralRatingCount: Math.max(1, Math.round(reviewCount * 0.18)),
    csvPositiveRatingCount: Math.max(0, reviewCount - negativeReviewCount - Math.round(reviewCount * 0.18)),
    csvNegativeRatingRate: round(negativeReviewRate, 1),
    mainIssue: profile.mainIssue,
    primaryIssue: profile.mainIssue,
    signalCount: getSignalCount(summary, negativeReviewCount, contentIssueCount),
    signalsCount: getSignalCount(summary, negativeReviewCount, contentIssueCount),
    effectiveSampleSize: summary.totalReturnedUnits + summary.totalRefundedUnits + reviewCount,
    priorityScore: clamp(Math.round(product.riskScore * 0.52 + product.confidence * 0.18 + productMomentum.score * 0.16 + index), 0, 100),
    evidenceStrengthScore: clamp(Math.round(product.confidence * 0.72 + Math.min(20, reviewCount / 3)), 0, 100),
    impactScore: product.impactScore,
    riskScore: product.riskScore,
    confidence: product.confidence,
    estimatedImpact,
    revenueAtRisk,
    marginAtRisk,
    impactRange: {
      low: round(estimatedImpact * 0.65, 2),
      mid: estimatedImpact,
      high: round(estimatedImpact * 1.55, 2),
    },
    topReturnReasons: profile.returnReasons,
    topReturnReasonDetails: profile.returnReasons.map((label, reasonIndex) => ({
      label,
      count: Math.max(1, Math.round(summary.totalReturnedUnits * (0.38 - reasonIndex * 0.1))),
      rate: round(38 - reasonIndex * 9.5, 1),
    })),
    topRefundReasons: ["Customer request", "Order level refund", "Pre-fulfillment cancellation"],
    topRefundReasonDetails: ["Customer request", "Order level refund", "Pre-fulfillment cancellation"].map((label, reasonIndex) => ({
      label,
      count: Math.max(1, Math.round(summary.totalRefundedUnits * (0.42 - reasonIndex * 0.12))),
      rate: round(42 - reasonIndex * 11.2, 1),
    })),
    affectedVariants: buildAffectedVariants(product, index),
    textInsights,
    refundInsights,
    reviewSourceStats: {
      total: { reviewCount, negativeReviewCount, averageRating: avgRating },
      judgeMe: { reviewCount: Math.round(reviewCount * 0.62), negativeReviewCount: Math.round(negativeReviewCount * 0.62), averageRating: avgRating },
      csv: { reviewCount: reviewCount - Math.round(reviewCount * 0.62), negativeReviewCount: negativeReviewCount - Math.round(negativeReviewCount * 0.62), averageRating: round(Math.max(1, avgRating - 0.2), 1) },
      chatMe: { reviewCount: Math.max(0, Math.round(reviewCount * 0.08)), negativeReviewCount: Math.max(0, Math.round(negativeReviewCount * 0.06)), averageRating: round(Math.max(1, avgRating - 0.1), 1) },
    },
    judgeMeNegativeReviewCount: Math.round(negativeReviewCount * 0.62),
    judgeMeAverageRating: avgRating,
    csvNegativeReviewCount: negativeReviewCount - Math.round(negativeReviewCount * 0.62),
    csvAverageRating: round(Math.max(1, avgRating - 0.2), 1),
    chatMeReviewCount: Math.max(0, Math.round(reviewCount * 0.08)),
    chatMeNegativeReviewCount: Math.max(0, Math.round(negativeReviewCount * 0.06)),
    chatMeAverageRating: round(Math.max(1, avgRating - 0.1), 1),
    monthlyOrderActivity,
    returnRatePrediction,
    productMomentum,
    productMomentumScore: productMomentum.score,
    productMomentumTier: productMomentum.tier,
    momentumDirection: productMomentum.direction,
    momentumConfidence: productMomentum.confidence,
    momentumConfidenceLabel: productMomentum.confidenceLabel,
    signalTrend,
    riskTrend,
    riskHistory,
    sourceCoverage: getSourceCoverage(index),
    checkedSources: getSourceCoverage(index),
    evidenceBySource: evidence.sources,
    issuesDetected: issues,
    recommendedActions: recommendations,
    productChangeLog: buildProductChangeLog(product, profile, index),
    priceHistory: buildPriceHistory(product, monthlyOrderActivity.months, index),
    scoreCalculationStatus: "Score calculated from persisted components",
    riskComponents,
    chartInterpretations,
    ...relationshipContext,
    incrementalDiagnosis,
    evidence,
  };
}

function buildSeedRiskComponents({ product, profile, summary, negativeReviewRate, contentIssueCount }) {
  const base = product.riskScore > 0 ? 6 : 0;
  const agreementBonus = product.riskScore >= 80 ? 8 : product.riskScore >= 55 ? 6 : 5;
  const recencyBonus = product.riskScore >= 80 ? 5 : 3;
  const maxes = {
    returnsScore: 25,
    reviewsScore: 25,
    sentimentScore: 15,
    contentGapScore: 15,
    refundScore: 15,
    variantScore: 10,
  };
  const rawWeights = {
    returnsScore: clamp(summary.returnRate / 38, 0, 1) * maxes.returnsScore,
    reviewsScore: clamp(negativeReviewRate / 72, 0, 1) * maxes.reviewsScore,
    sentimentScore: clamp(product.riskScore / 100, 0, 1) * (profile.issueCode === "subjective_negative_reaction" ? 15 : 10),
    contentGapScore: clamp(contentIssueCount / 5, 0, 1) * maxes.contentGapScore,
    refundScore: clamp(summary.refundRate / 18, 0, 1) * maxes.refundScore,
    variantScore: product.productType === "Snowboard" || product.productType === "Boots" ? maxes.variantScore * 0.72 : maxes.variantScore * 0.28,
  };
  const componentKeys = Object.keys(maxes);
  const targetVariableScore = clamp(product.riskScore - base - agreementBonus - recencyBonus, 0, Object.values(maxes).reduce((sum, value) => sum + value, 0));
  const rawVariableScore = componentKeys.reduce((sum, key) => sum + rawWeights[key], 0) || 1;
  const scaledComponents = Object.fromEntries(componentKeys.map((key) => [
    key,
    clamp(rawWeights[key] * (targetVariableScore / rawVariableScore), 0, maxes[key]),
  ]));

  let remaining = targetVariableScore - componentKeys.reduce((sum, key) => sum + scaledComponents[key], 0);
  for (const key of componentKeys.sort((left, right) => (maxes[right] - scaledComponents[right]) - (maxes[left] - scaledComponents[left]))) {
    if (remaining <= 0) break;
    const addition = Math.min(maxes[key] - scaledComponents[key], remaining);
    scaledComponents[key] += addition;
    remaining -= addition;
  }

  const rawScore = base
    + agreementBonus
    + recencyBonus
    + componentKeys.reduce((sum, key) => sum + scaledComponents[key], 0);

  return {
    calculationState: "score_calculated_from_seeded_components",
    base: round(base, 1),
    returnsScore: round(scaledComponents.returnsScore, 1),
    reviewsScore: round(scaledComponents.reviewsScore, 1),
    sentimentScore: round(scaledComponents.sentimentScore, 1),
    contentGapScore: round(scaledComponents.contentGapScore, 1),
    refundScore: round(scaledComponents.refundScore, 1),
    variantScore: round(scaledComponents.variantScore, 1),
    agreementBonus: round(agreementBonus, 1),
    recencyBonus: round(recencyBonus, 1),
    rawScore: round(rawScore, 1),
    calculated: Math.round(rawScore),
    riskScore: product.riskScore,
  };
}

function buildSeedCatalogDetails(product, profile, index) {
  const affectedVariants = buildAffectedVariants(product, index);
  const variants = affectedVariants.map((title, variantIndex) => ({
    id: `${product.productGid.replace("/Product/", "/ProductVariant/")}${variantIndex + 1}`,
    title,
    sku: `${buildSku(product)}-${variantIndex + 1}`,
    price: getMonthPrice(product.price, MONTHS_TO_SEED - 1, index),
    inventoryQuantity: Math.max(0, 42 - product.riskScore + variantIndex * 9 + deterministicInt(`${product.handle}:inventory:${variantIndex}`, 0, 32)),
    selectedOptions: getSeedVariantOptions(product, title),
  }));
  const media = Array.from({ length: 2 + (index % 4) }, (_, mediaIndex) => ({
    id: `seed-media-${stableProductNumber(product)}-${mediaIndex + 1}`,
    type: "IMAGE",
    url: buildImageUrl({ productTitle: `${product.productTitle} ${mediaIndex + 1}` }),
    alt: mediaIndex === 0 ? product.productTitle : `${profile.mainIssue} context ${mediaIndex + 1}`,
  }));
  const strongestVariant = affectedVariants[index % affectedVariants.length] || "Default Title";

  return {
    productStatus: index % 11 === 0 ? "DRAFT" : "ACTIVE",
    seoTitle: `${product.productTitle} | Seeded ProductPulse Demo`,
    seoDescription: `Seeded demo PDP context for ${product.productTitle}, focused on ${profile.mainIssue.toLowerCase()} and one year of synthetic customer evidence.`,
    templateSuffix: index % 3 === 0 ? "product-risk-review" : "",
    optionNames: getSeedOptionNames(product),
    variantCount: variants.length,
    skuCount: variants.length,
    variants,
    media,
    affectedVariantDetails: affectedVariants.map((variant, variantIndex) => ({
      variant,
      sku: variants[variantIndex]?.sku || buildSku(product),
      count: Math.max(1, Math.round((product.riskScore / 9) - variantIndex * 1.4)),
      returnRate: round(Math.max(1, product.riskScore / 5 - variantIndex * 1.8), 1),
      issue: variant === strongestVariant ? profile.mainIssue : profile.issueTitle,
    })),
    variantInsights: [
      {
        title: `${strongestVariant} carries the clearest signal`,
        detail: `${profile.repeatedLanguage[0]} appears most often in this variant cluster.`,
        tone: product.riskScore >= 75 ? "critical" : "warning",
      },
      {
        title: "Variant naming can reduce ambiguity",
        detail: `Seeded PDP evidence links variant choice to ${profile.mainIssue.toLowerCase()}.`,
        tone: "info",
      },
    ],
  };
}

function getSeedOptionNames(product) {
  const title = product.productTitle.toLowerCase();
  if (product.productType === "Boots") return ["Size", "Color"];
  if (product.productType === "Snowboard") return ["Length", "Flex"];
  if (title.includes("nintendo")) return ["Bundle"];
  if (product.productType.includes("toy") || product.productType.includes("figure")) return ["Pack"];
  return ["Style"];
}

function getSeedVariantOptions(product, title) {
  const optionNames = getSeedOptionNames(product);
  return optionNames.map((name, index) => ({
    name,
    value: index === 0 ? title : index === 1 ? "Standard" : "Default",
  }));
}

function buildSeedRelationshipAndContextMetrics({ product, profile, index, summary, monthlyOrderActivity, negativeReviewCount }) {
  const soldUnits = Math.max(1, Number(summary.totalOrderUnits || 0));
  const soldOrders = Math.max(1, Number(summary.totalOrders || 0));
  const returnedUnits = Math.max(0, Number(summary.totalReturnedUnits || 0));
  const returnedOrders = Math.max(0, Number(summary.totalReturnedOrders || 0));
  const refundedUnits = Math.max(0, Number(summary.totalRefundedUnits || 0));
  const refundedOrders = Math.max(0, Number(summary.totalRefundedOrders || 0));
  const linkedUnits = Math.min(returnedUnits, refundedUnits, Math.max(0, Math.round(returnedUnits * (0.42 + (index % 3) * 0.08))));
  const returnOnlyUnits = Math.max(0, returnedUnits - linkedUnits - Math.round(returnedUnits * 0.08));
  const refundOnlyUnits = Math.max(0, refundedUnits - linkedUnits);
  const exchangeUnits = Math.max(0, Math.round(returnedUnits * (product.riskScore >= 80 ? 0.08 : 0.16)));
  const pendingUnits = Math.max(0, returnedUnits - linkedUnits - returnOnlyUnits - exchangeUnits);
  const attributedRefundAmount = round(summary.totalRefundAmount * 0.82, 2);
  const refundAmountWithReturn = round(summary.totalRefundAmount * (linkedUnits && refundedUnits ? linkedUnits / refundedUnits : 0.45), 2);
  const refundAmountWithoutReturn = round(Math.max(0, attributedRefundAmount - refundAmountWithReturn), 2);
  const unattributedRefundAmount = round(summary.totalRefundAmount - attributedRefundAmount, 2);
  const returnPressureScore = clamp(Math.round(summary.returnRate * 2.4 + product.riskScore * 0.32), 0, 100);
  const refundLeakageScore = clamp(Math.round(summary.refundRate * 3.3 + refundOnlyUnits * 1.4 + product.riskScore * 0.18), 0, 100);
  const estimatedFutureRefundFromReturnOnlyCases = round(returnOnlyUnits * product.price * 0.58, 2);
  const financialExposureBreakdown = {
    hasRelationshipSummary: true,
    confirmedRefundAmount: attributedRefundAmount,
    attributedRefundAmount,
    refundAmountWithReturn,
    refundAmountWithoutReturn,
    unattributedRefundAmount,
    estimatedFutureRefundFromReturnOnlyCases,
    returnRelatedRiskAmount: estimatedFutureRefundFromReturnOnlyCases,
    relationshipAdjustedRefundAmount: round(attributedRefundAmount + estimatedFutureRefundFromReturnOnlyCases + unattributedRefundAmount * 0.25, 2),
    totalRefundAmountRelated: round(attributedRefundAmount + unattributedRefundAmount, 2),
    refundAttributionRate: percent(attributedRefundAmount, attributedRefundAmount + unattributedRefundAmount),
  };
  const returnPressure = {
    score: returnPressureScore,
    productFrictionUnits: returnedUnits,
    returnedAndRefundedUnits: linkedUnits,
    returnedNotRefundedUnits: returnOnlyUnits,
    exchangeOrReplacementUnits: exchangeUnits,
    pendingReturnUnits: pendingUnits,
    returnRateUnits: summary.returnRate,
    returnRateUnitsPercent: summary.returnRate,
  };
  const refundLeakage = {
    score: refundLeakageScore,
    attributedRefundAmount,
    unattributedRefundAmount,
    refundAmountWithReturn,
    refundAmountWithoutReturn,
    refundAttributionRate: percent(attributedRefundAmount, attributedRefundAmount + unattributedRefundAmount),
  };
  const customerSignalBreakdown = {
    linkedReturnRefundCount: linkedUnits,
    returnOnlyCount: returnOnlyUnits,
    refundOnlyCount: refundOnlyUnits,
    exchangeOrReplacementCount: exchangeUnits,
    pendingOrUnknownCount: pendingUnits,
    negativeReviewCount,
    returnLanguageCount: Math.max(1, Math.round(returnedUnits * 0.36)),
  };
  const returnRefundRelationshipSummary = {
    soldUnits,
    soldOrders,
    returnedUnits,
    returnedOrders,
    refundedUnits,
    refundedOrders,
    returnedAndRefundedUnits: linkedUnits,
    returnedAndRefundedOrders: Math.min(returnedOrders, refundedOrders, Math.round(linkedUnits * 0.8)),
    returnedNotRefundedUnits: returnOnlyUnits,
    returnedNotRefundedOrders: Math.round(returnOnlyUnits * 0.8),
    refundedWithoutReturnUnits: refundOnlyUnits,
    refundedWithoutReturnOrders: Math.round(refundOnlyUnits * 0.9),
    exchangeOrReplacementUnits: exchangeUnits,
    pendingReturnUnits: pendingUnits,
    relationshipUnknownCount: pendingUnits,
    unattributedRefundAmount,
    attributedRefundAmount,
    refundAmountWithReturn,
    refundAmountWithoutReturn,
    totalProductRevenue: summary.totalRevenue,
    totalRefundAmountRelated: round(attributedRefundAmount + unattributedRefundAmount, 2),
    returnRateUnits: summary.returnRate,
    refundRateUnits: summary.refundRate,
    relationshipMatchConfidenceAvg: clamp(84 - index + Math.round(product.confidence / 12), 55, 96),
  };
  const productPurchaseContext = buildSeedPurchaseContext({ product, profile, index, summary, monthlyOrderActivity });
  const productRelationship = buildSeedProductRelationshipIntelligence({ product, profile, index, summary, monthlyOrderActivity });

  return {
    returnRefundRelationshipSummary,
    returnRefundRelationshipFactors: {
      version: "seed-v2",
      hasRelationshipSummary: true,
      returnPressure,
      refundLeakage,
      financialExposure: financialExposureBreakdown,
      customerSignalBreakdown,
      diagnosisConfidence: {
        relationshipMatchConfidenceAvg: returnRefundRelationshipSummary.relationshipMatchConfidenceAvg,
      },
    },
    returnRefundScoringImpact: [
      `Return/refund matching separated ${linkedUnits} linked units from ${returnOnlyUnits} return-only units.`,
      `${formatMoney(financialExposureBreakdown.relationshipAdjustedRefundAmount)} relationship-adjusted exposure is stored for timeline charts.`,
    ],
    financialExposureBreakdown,
    returnPressure,
    refundLeakage,
    returnPressureScore,
    returnPressureRate: summary.returnRate,
    refundLeakageScore,
    customerSignalBreakdown,
    productPurchaseContextSummary: productPurchaseContext.summary,
    productPurchaseContextFactors: productPurchaseContext.factors,
    productPurchaseContextScoringImpact: productPurchaseContext.scoringImpact,
    purchaseContextSignalBreakdown: productPurchaseContext.signalBreakdown,
    productRelationshipIntelligenceSummary: productRelationship.summary,
    productRelationshipFactors: productRelationship.factors,
    productRelationshipScoringImpact: productRelationship.scoringImpact,
    productRelationshipAiInsights: productRelationship.aiInsights,
  };
}

function buildSeedPurchaseContext({ product, profile, index, summary, monthlyOrderActivity }) {
  const totalOrders = Math.max(1, summary.totalOrders);
  const soloOrders = Math.max(1, Math.round(totalOrders * (0.38 + (index % 3) * 0.06)));
  const multiProductOrders = Math.max(0, totalOrders - soloOrders);
  const singleUnitOrders = Math.max(1, Math.round(totalOrders * 0.68));
  const multiUnitOrders = Math.max(0, totalOrders - singleUnitOrders);
  const bulkOrders = Math.max(0, Math.round(totalOrders * (product.price < 20 ? 0.12 : 0.04 + (index % 2) * 0.02)));
  const multiVariantOrders = product.productType === "Boots" || product.productType === "Snowboard"
    ? Math.max(2, Math.round(totalOrders * 0.18))
    : Math.max(0, Math.round(totalOrders * 0.05));
  const relatedProducts = buildSeedRelatedProducts(product, index);
  const segments = {
    bought_alone: buildSeedPurchaseSegment(soloOrders, summary, 0.88),
    bought_with_others: buildSeedPurchaseSegment(multiProductOrders, summary, 1.14),
    multi_variant_orders: buildSeedPurchaseSegment(multiVariantOrders, summary, product.productType === "Boots" || product.productType === "Snowboard" ? 1.35 : 0.96),
    bulk_orders: buildSeedPurchaseSegment(bulkOrders, summary, product.price < 25 ? 1.18 : 0.9),
  };
  const signalBreakdown = {
    primaryContext: multiProductOrders > soloOrders ? "mixed_basket" : "solo_purchase",
    multiProductOrders,
    soloOrders,
    bulkOrders,
    multiVariantOrders,
    strongestSegment: product.productType === "Boots" || product.productType === "Snowboard" ? "multi_variant_orders" : "bought_with_others",
  };

  return {
    summary: {
      totalOrdersContainingProduct: totalOrders,
      totalUnitsSold: summary.totalOrderUnits,
      totalRevenueIfAvailable: summary.totalRevenue,
      soloProductOrderCount: soloOrders,
      multiProductOrderCount: multiProductOrders,
      singleUnitOrderCount: singleUnitOrders,
      multiUnitOrderCount: multiUnitOrders,
      bulkOrderCount: bulkOrders,
      multiVariantOrderCount: multiVariantOrders,
      unknownOrIncompleteOrderCount: Math.max(0, Math.round(totalOrders * 0.02)),
      bulkPurchaseThreshold: 4,
      avgProductQuantityPerOrder: round(summary.totalOrderUnits / totalOrders, 2),
      medianProductQuantityPerOrder: product.price < 20 ? 2 : 1,
      avgDistinctProductsPerOrder: round(1 + multiProductOrders / totalOrders * 1.8, 2),
      avgTotalUnitsPerOrder: round(summary.totalOrderUnits / totalOrders + multiProductOrders / totalOrders, 2),
      quantityDistribution: {
        oneUnitCount: singleUnitOrders,
        twoUnitCount: Math.round(multiUnitOrders * 0.58),
        threeUnitCount: Math.round(multiUnitOrders * 0.27),
        fourPlusUnitCount: Math.max(0, multiUnitOrders - Math.round(multiUnitOrders * 0.85)),
      },
      topCoPurchasedProducts: relatedProducts.map((related, relatedIndex) => ({
        productId: related.productGid,
        title: related.productTitle,
        handle: related.handle,
        coOrderCount: Math.max(2, Math.round(multiProductOrders * (0.34 - relatedIndex * 0.08))),
        coOrderRate: round(26 - relatedIndex * 5.5, 1),
        affinityScore: clamp(82 - relatedIndex * 9 - (index % 4), 35, 96),
      })),
      monthlyContext: monthlyOrderActivity.months.map((month, monthIndex) => ({
        key: month.key,
        label: month.shortLabel,
        ordersContainingProduct: month.orders,
        unitsSold: month.orderUnits,
        soloProductOrders: Math.round(month.orders * soloOrders / totalOrders),
        multiProductOrders: Math.round(month.orders * multiProductOrders / totalOrders),
        avgProductQuantityPerOrder: round(month.orderUnits / Math.max(1, month.orders), 2),
        avgDistinctProductsPerOrder: round(1 + (multiProductOrders / totalOrders) + deterministicWave(product.handle, monthIndex) * 0.18, 2),
        avgTotalUnitsPerOrder: round(month.orderUnits / Math.max(1, month.orders) + 0.7, 2),
        totalBasketUnits: Math.round(month.orderUnits * 1.34),
        otherProductUnits: Math.max(0, Math.round(month.orderUnits * 0.34)),
        productBasketShare: round(percent(month.orderUnits, Math.round(month.orderUnits * 1.34)), 1),
        multiVariantOrders: Math.round(month.orders * multiVariantOrders / totalOrders),
        bulkOrders: Math.round(month.orders * bulkOrders / totalOrders),
      })),
      purchaseContextSegments: segments,
      purchaseContextConfidence: clamp(78 + (index % 5) * 3, 58, 95),
      purchaseContextConfidenceLabel: product.riskScore >= 80 ? "High" : "Medium",
      primaryContext: signalBreakdown.primaryContext,
      interpretation: `Seeded basket context shows ${product.productTitle} is usually bought ${signalBreakdown.primaryContext === "mixed_basket" ? "with related products" : "as a solo item"}, with ${profile.mainIssue.toLowerCase()} concentrated in ${signalBreakdown.strongestSegment.replace(/_/g, " ")}.`,
      variantDataAvailable: true,
    },
    factors: {
      hasPurchaseContextSummary: true,
      customerSignalBreakdown: signalBreakdown,
      productRisk: { score: clamp(Math.round(summary.returnRate * 1.8), 0, 100), primaryContext: signalBreakdown.primaryContext },
      financialExposure: { bulkQuantityExposure: round(bulkOrders * product.price * 0.42, 2) },
      returnPressure: {
        returnRateWhenBoughtAlone: segments.bought_alone.returnRateUnits,
        returnRateWhenBoughtWithOthers: segments.bought_with_others.returnRateUnits,
        returnRateForMultiVariantOrders: segments.multi_variant_orders.returnRateUnits,
      },
      refundLeakage: {
        refundRateWhenBoughtAlone: segments.bought_alone.refundRateUnits,
        refundRateWhenBoughtWithOthers: segments.bought_with_others.refundRateUnits,
      },
      diagnosisConfidence: { complexBasketAmbiguityPenalty: multiProductOrders > soloOrders ? 4 : 0 },
    },
    signalBreakdown,
    scoringImpact: [
      `${multiProductOrders} seeded orders include another product, giving basket context to Product Risk.`,
      `${multiVariantOrders} multi-variant orders support variant and expectation analysis.`,
    ],
  };
}

function buildSeedPurchaseSegment(orderCount, summary, multiplier) {
  const orders = Math.max(0, Math.round(orderCount || 0));
  const soldUnits = Math.max(0, Math.round(summary.totalOrderUnits * orders / Math.max(1, summary.totalOrders)));
  const returnedUnits = Math.max(0, Math.round(summary.totalReturnedUnits * orders / Math.max(1, summary.totalOrders) * multiplier));
  const refundedUnits = Math.max(0, Math.round(summary.totalRefundedUnits * orders / Math.max(1, summary.totalOrders) * multiplier));
  const refundAmount = round(summary.totalRefundAmount * orders / Math.max(1, summary.totalOrders) * multiplier, 2);
  return {
    orders,
    soldUnits,
    returnedUnits,
    refundedUnits,
    refundAmount,
    affectedOrders: Math.max(returnedUnits, refundedUnits),
    returnRateUnits: percent(returnedUnits, soldUnits),
    refundRateUnits: percent(refundedUnits, soldUnits),
    affectedOrderRate: percent(Math.max(returnedUnits, refundedUnits), orders),
    sufficientData: orders >= 5,
  };
}

function buildSeedProductRelationshipIntelligence({ product, profile, index, summary, monthlyOrderActivity }) {
  const relatedProducts = buildSeedRelatedProducts(product, index);
  const relationshipItems = relatedProducts.map((related, relatedIndex) => buildSeedRelationshipItem({
    product,
    related,
    profile,
    summary,
    months: monthlyOrderActivity.months,
    index,
    relatedIndex,
  }));
  const riskRelationships = relationshipItems.filter((item) => Number(item.deltaReturnRate || 0) > 0 || Number(item.deltaRefundRate || 0) > 0);

  return {
    summary: {
      sourceProductId: product.productGid,
      sourceProductHandle: product.handle,
      sourceProductTitle: product.productTitle,
      dataBasis: {
        sameOrderAvailable: true,
        customerSequenceAvailable: true,
        orderCount: summary.totalOrders,
        customerCount: Math.max(12, Math.round(summary.totalOrders * 0.78)),
        knownBasketOrderCount: Math.max(1, Math.round(summary.totalOrders * 0.68)),
        unknownBasketOrderCount: Math.max(0, Math.round(summary.totalOrders * 0.04)),
      },
      confidence: {
        score: clamp(76 + (index % 6) * 3, 58, 95),
        label: product.riskScore >= 80 ? "High" : "Medium",
      },
      topBoughtTogether: relationshipItems.slice(0, 3),
      topBoughtBefore: relationshipItems.slice(1, 3).map((item) => ({
        ...item,
        relationshipDirection: "before",
        relationshipType: "previous_purchase",
        timeWindow: "90d_before",
        medianDaysBefore: 34 + index,
      })),
      topBoughtAfter: relationshipItems.slice(0, 2).map((item) => ({
        ...item,
        relationshipDirection: "after",
        relationshipType: "next_purchase",
        timeWindow: "90d_after",
        medianDaysAfter: 28 + index,
        followOnRevenue: round(item.coOrderCount * product.price * 0.44, 2),
      })),
      strongestRelationships: relationshipItems,
      emergingRelationships: relationshipItems.slice(0, 1).map((item) => ({
        ...item,
        trend: "rising",
        relationshipStrength: "emerging",
      })),
      relationshipsWithReturnRiskImpact: riskRelationships,
      relationshipsWithCrossSellOpportunity: relationshipItems.filter((item) => item.lift >= 1.2),
      relationshipTrends: relationshipItems.slice(0, 2),
      interpretation: riskRelationships.length
        ? `Return and refund pressure is higher when ${product.productTitle} is connected to ${riskRelationships[0].relatedProductTitle}. Treat this as seeded context, not causality.`
        : `${relationshipItems[0]?.relatedProductTitle || "A related product"} is the strongest seeded relationship for merchandising review.`,
      warnings: index % 5 === 0 ? ["low_sample_size_for_one_related_product"] : [],
    },
    factors: {
      hasProductRelationshipSummary: true,
      context: {
        sourceProductId: product.productGid,
        sourceProductHandle: product.handle,
        sourceProductTitle: product.productTitle,
        strongestRelationships: relationshipItems,
        topBoughtTogether: relationshipItems.slice(0, 3),
        topBoughtAfter: relationshipItems.slice(0, 2),
        dataBasis: {
          sameOrderAvailable: true,
          customerSequenceAvailable: true,
          orderCount: summary.totalOrders,
          customerCount: Math.max(12, Math.round(summary.totalOrders * 0.78)),
        },
        confidenceScore: clamp(76 + (index % 6) * 3, 58, 95),
      },
      productRiskContext: {
        hasRiskImpact: riskRelationships.length > 0,
        topRelationship: riskRelationships[0]?.relatedProductTitle || null,
      },
      diagnosisConfidence: {
        complexBasketAmbiguityPenalty: riskRelationships.length ? 3 : 0,
        sequenceStabilityScore: relationshipItems.length ? 8 : 0,
      },
      recommendedActionSignals: {
        compatibilityWarning: profile.issueCode === "fit_sizing" || profile.issueCode === "color_expectation",
        bundleOpportunity: relationshipItems.some((item) => item.lift >= 1.25),
        crossSellOpportunity: relationshipItems.length > 1,
      },
      aiInsightInput: {
        riskRelationships,
        crossSellOpportunities: relationshipItems.filter((item) => item.lift >= 1.2),
      },
    },
    scoringImpact: [
      `${relationshipItems.length} related-product patterns were seeded for relationship tables and cross-sell context.`,
      riskRelationships.length ? `${riskRelationships[0].relatedProductTitle} adds return/refund context to the diagnosis.` : "Relationship data is contextual and does not directly change Product Risk.",
    ],
    aiInsights: {
      available: true,
      status: "seeded",
      generatedAt: SEED_NOW.toISOString(),
      model: "deterministic-demo-seed",
      insights: relationshipItems.slice(0, 2).map((item, insightIndex) => ({
        id: `seed-relationship-insight-${index}-${insightIndex}`,
        type: insightIndex === 0 ? "risk_context" : "cross_sell_context",
        sourceRelationshipId: item.relatedProductId,
        relatedProductTitle: item.relatedProductTitle,
        summary: `${item.relatedProductTitle} appears as a seeded ${item.relationshipType.replace(/_/g, " ")} relationship for ${product.productTitle}.`,
        recommendation: insightIndex === 0 ? "Review PDP compatibility and bundle language." : "Consider post-purchase cross-sell testing.",
        caveat: "Seeded relationship data is synthetic and should be used for UI validation only.",
        metrics: {
          lift: item.lift,
          confidence: item.confidence,
          sampleSize: item.sampleSize,
        },
      })),
    },
  };
}

function buildSeedRelationshipItem({ product, related, profile, summary, months, index, relatedIndex }) {
  const rate = clamp(18 - relatedIndex * 3 + (index % 4), 4, 38);
  const lift = round(1.35 - relatedIndex * 0.16 + deterministicWave(product.handle, relatedIndex) * 0.08, 2);
  const sampleSize = Math.max(4, Math.round(summary.totalOrders * (rate / 100)));
  return {
    relatedProductId: related.productGid,
    relatedProductHandle: related.handle,
    relatedProductTitle: related.productTitle,
    relationshipDirection: "together",
    relationshipType: "same_order",
    timeWindow: "same_order",
    relationshipRate: rate,
    attachRate: rate,
    relatedProductBaseRate: round(rate / Math.max(lift, 0.2), 1),
    lift,
    confidence: clamp(84 - relatedIndex * 9 - (index % 3), 58, 96),
    confidenceLabel: relatedIndex === 0 ? "High" : "Medium",
    sampleSize,
    coOrderCount: sampleSize,
    orderCount: sampleSize,
    relationshipStrength: lift >= 1.2 ? "strong" : "moderate",
    trend: relatedIndex === 0 ? "rising" : "stable",
    deltaReturnRate: profile.issueCode === "fit_sizing" || relatedIndex === 0 ? round(2.4 + relatedIndex + index % 3, 1) : 0,
    deltaRefundRate: profile.issueCode === "refund_pressure" || product.riskScore >= 80 ? round(1.1 + relatedIndex * 0.5, 1) : 0,
    returnRateWhenBoughtTogether: round(summary.returnRate + relatedIndex * 1.2, 1),
    refundRateWhenBoughtTogether: round(summary.refundRate + relatedIndex * 0.8, 1),
    monthly: months.slice(-6).map((month, monthIndex) => ({
      month: month.key,
      label: month.shortLabel,
      sourceProductOrders: month.orders,
      relatedOrderCount: Math.max(1, Math.round(month.orders * (rate / 100) * (0.72 + monthIndex * 0.05))),
      customerCount: Math.max(1, Math.round(month.orders * (rate / 100) * 0.86)),
      relationshipRate: clamp(rate + deterministicWave(`${product.handle}:${related.handle}`, monthIndex) * 2.2, 1, 50),
      lift: round(lift + deterministicWave(related.handle, monthIndex) * 0.08, 2),
      confidence: clamp(70 + monthIndex * 3 - relatedIndex * 4, 45, 95),
    })),
    warnings: relatedIndex === 2 ? ["seeded_low_sample"] : [],
  };
}

function buildSeedRelatedProducts(product, index) {
  return [1, 2, 4].map((offset) => getRelatedSeedProduct(product, index, offset + index));
}

function buildSeedChartInterpretations({ product, profile, summary, returnRatePrediction, productMomentum, riskHistory }) {
  const riskShape = describeRiskShape(riskHistory.map((point) => point.riskScore));
  return {
    status: "seeded",
    generatedAt: SEED_NOW.toISOString(),
    model: "deterministic-demo-seed",
    interpretations: {
      monthlyOrderActivity: {
        text: `${product.productTitle} has ${summary.totalOrders} seeded orders across the last year. Returns and refunds are intentionally varied by month so the order activity chart shows seasonality and ${profile.mainIssue.toLowerCase()} pressure.`,
      },
      returnRatePrediction: {
        text: `The seeded forecast projects ${returnRatePrediction.summary.forecastNext90ReturnRate}% return rate over the next 90 days, using current action status and weekly historical cohorts.`,
      },
      productRetentionMetrics: {
        text: "Retention cohorts are generated from synthetic repeat purchases, cross-sells, discounts and refund events so the retention panel can render cohorts, LTV, repeat curves and segment tables.",
      },
      productRiskOverTime: {
        text: `Risk over time is ${riskShape}; the latest stored score is ${product.riskScore}/100 with ${product.confidence}% confidence.`,
      },
      productMomentum: {
        text: `Product Momentum is ${productMomentum.score}/100 (${productMomentum.tier}) and is stored alongside risk so analytics can compare commercial demand against product friction.`,
      },
    },
  };
}

function buildSeedProductStory(product, profile, index) {
  const launchWindow = monthsAgo(16 + index, SEED_NOW).toISOString().slice(0, 10);
  const arc = describeRiskShape(product.forcedRiskCurve || buildRiskCurve(product, index));
  return `${product.productTitle} launched into the ${product.collections[0] || product.productType} assortment around ${launchWindow}. The seeded story is ${arc}: demand, returns, refunds, reviews, product content, retention and watchlist runs all point to ${profile.mainIssue.toLowerCase()} with enough variation to test ProductPulse dashboard, analytics and product-detail views.`;
}

function buildSeedIncrementalDiagnosis({
  product,
  profile,
  index,
  summary,
  contentIssues,
  contentAdvisories,
  textInsights,
  refundInsights,
  descriptionWordCount,
  mediaCount,
  mediaWithoutAltCount,
  diagnosisCompletedAt,
}) {
  const completedAtIso = diagnosisCompletedAt.toISOString();
  const productUpdatedAt = daysAgo(5 + (index % 11), diagnosisCompletedAt).toISOString();
  const productContent = buildSeedProductContentCache({
    product,
    profile,
    contentIssues,
    contentAdvisories,
    descriptionWordCount,
    mediaCount,
    mediaWithoutAltCount,
    productUpdatedAt,
  });
  const customerText = buildSeedCustomerTextCache({
    product,
    profile,
    summary,
    textInsights,
    diagnosisCompletedAt,
  });
  const refunds = buildSeedRefundTextCache({
    product,
    profile,
    summary,
    refundInsights,
    diagnosisCompletedAt,
  });
  const customerItemCount = customerText.returnItems.length + customerText.reviewItems.length;
  const refundItemCount = refunds.items.length;
  const sourceFingerprint = hashString(JSON.stringify({
    productContentSignature: productContent.signature,
    soldUnits: summary.totalOrderUnits,
    salesAmount: summary.totalRevenue,
    returnUnits: summary.totalReturnedUnits,
    refundUnits: summary.totalRefundedUnits,
    refundAmount: summary.totalRefundAmount,
    customerTextKeys: [...customerText.returnItems, ...customerText.reviewItems].map((item) => item.key).sort(),
    refundTextKeys: refunds.items.map((item) => item.key).sort(),
  })).toString(36);

  return {
    schemaVersion: 1,
    mode: "incremental",
    previousCompletedAt: completedAtIso,
    cutoffAt: completedAtIso,
    productContent: {
      mode: "reused",
      reused: true,
      changed: false,
      signature: productContent.signature,
      productUpdatedAt,
      reason: "seeded_product_content_unchanged_since_previous_diagnosis",
      canReuseContentGaps: true,
    },
    customerText: {
      mode: "incremental",
      analyzedItems: 0,
      reusedItems: customerItemCount,
      totalItems: customerItemCount,
      reason: "seeded_previous_customer_text_cache_reused",
    },
    refunds: {
      mode: "incremental",
      analyzedItems: 0,
      reusedItems: refundItemCount,
      totalItems: refundItemCount,
      reason: "seeded_previous_refund_cache_reused",
    },
    sourceChanges: {
      mode: "compared",
      previousFingerprint: sourceFingerprint,
      currentFingerprint: sourceFingerprint,
      unchanged: true,
      reason: "seeded_source_fingerprint_matches_previous_diagnosis",
    },
    aiEvidenceSnippetCount: 0,
    cache: {
      sourceFingerprint,
      productContent,
      customerText,
      refunds,
    },
  };
}

function buildSeedProductContentCache({
  product,
  profile,
  contentIssues,
  contentAdvisories,
  descriptionWordCount,
  mediaCount,
  mediaWithoutAltCount,
  productUpdatedAt,
}) {
  const contentQualityScore = clamp(92 - product.riskScore + deterministicInt(product.handle, 0, 10), 18, 92);
  const deterministicContent = {
    score: contentQualityScore,
    riskLift: clamp(product.riskScore * 0.35 + contentIssues.length * 4, 0, 45),
    descriptionLength: descriptionWordCount * 6,
    descriptionWordCount,
    hasDescription: true,
    titleNeedsReview: product.riskScore >= 80 || profile.issueCode === "fit_sizing" || product.primaryIssue.toLowerCase().includes("other"),
    seoTitleNeedsReview: product.riskScore >= 70 || contentIssues.length >= 3,
    metaDescriptionNeedsReview: product.riskScore >= 65 || contentIssues.length >= 2,
    handleNeedsReview: product.riskScore >= 85 || product.handle.length > 70,
    specsBlockRecommended: contentIssues.length >= 2,
    classificationNeedsReview: product.riskScore >= 80 && product.productType.length <= 5,
    templateNeedsReview: product.riskScore >= 75 && ["fit_sizing", "subjective_negative_reaction"].includes(profile.issueCode),
    variantNamingAdvisory: product.productTitle.toLowerCase().includes("snowboard") || profile.issueCode === "fit_sizing",
    mediaCount,
    mediaWithoutAltCount,
    issues: contentIssues.map((issue, issueIndex) => ({
      issueCode: issue.issueCode,
      label: issue.label,
      severity: product.riskScore >= 80 && issueIndex === 0 ? "medium" : "low",
      evidence: issue.detail,
      suggestedAction: issue.issueCode === "media_context_gap" ? "Improve media context" : "Update product description",
      riskLift: clamp(4 + issueIndex * 2 + product.riskScore / 25, 2, 12),
    })),
    advisories: contentAdvisories.map((advisory) => ({
      code: advisory.source,
      label: advisory.title,
      evidence: advisory.detail,
      severity: "low",
    })),
  };
  const contentGaps = {
    content_quality_score: contentQualityScore,
    content_summary: `${product.productTitle} has seeded PDP content analysis focused on ${profile.mainIssue.toLowerCase()}.`,
    present: ["title", "description", "vendor", "product type", "price"],
    missing: contentIssues.map((issue) => issue.label),
    notes: `Seeded cache keeps product content analysis reusable until Shopify updatedAt changes after ${productUpdatedAt}.`,
    content_issues: deterministicContent.issues,
    issue_specific_gaps: contentIssues.map((issue) => ({
      issue_category: profile.issueCode,
      missing_content: issue.label,
      why_it_matters: issue.detail,
      suggested_fix: issue.issueCode === "media_context_gap" ? "Add image guidance or alt text." : "Add clearer buyer-facing description copy.",
    })),
  };
  const signature = hashString(JSON.stringify({
    title: product.productTitle,
    handle: product.handle,
    descriptionWordCount,
    tags: product.tags,
    productType: product.productType,
    vendor: product.vendor,
    mediaCount,
    mediaWithoutAltCount,
  })).toString(36);

  return {
    signature,
    productUpdatedAt,
    deterministicContent,
    contentGaps,
  };
}

function buildSeedCustomerTextCache({ product, profile, summary, textInsights, diagnosisCompletedAt }) {
  const returnItems = profile.repeatedLanguage.slice(0, 3).map((term, itemIndex) => {
    const quantity = Math.max(1, Math.round(summary.totalReturnedUnits * (0.16 - itemIndex * 0.035)));
    const createdAt = daysAgo(75 - itemIndex * 17, diagnosisCompletedAt).toISOString();
    const text = `${profile.returnReasons[itemIndex] || profile.returnReasons[0]}: customer said ${quote(term)} while describing ${profile.mainIssue.toLowerCase()}.`;
    return {
      key: `seed:return:${product.handle}:${itemIndex}`,
      source: "returns",
      sourceLabel: "Shopify returns",
      text,
      analysisText: text,
      reason: profile.returnReasons[itemIndex] || profile.returnReasons[0],
      noteText: `Customer said ${quote(term)}.`,
      reasonText: profile.returnReasons[itemIndex] || profile.returnReasons[0],
      issueCode: profile.issueCode,
      sentiment: itemIndex === 0 ? "negative" : "neutral",
      emotion: profile.sentiment === "neutral" ? "confusion" : profile.sentiment,
      subjectiveNegative: profile.issueCode === "subjective_negative_reaction",
      createdAt,
      updatedAt: createdAt,
      variant: buildAffectedVariants(product, itemIndex)[0] || "Default Title",
      quantity,
      amount: round(quantity * product.price, 2),
      isOther: (profile.returnReasons[itemIndex] || "").toLowerCase() === "other",
    };
  });
  const reviewItems = profile.repeatedLanguage.slice(0, 3).map((term, itemIndex) => {
    const createdAt = daysAgo(64 - itemIndex * 19, diagnosisCompletedAt).toISOString();
    const rating = itemIndex === 0 ? 1 : 2;
    const text = `Review ${rating}/5: ${product.productTitle} felt ${term}.`;
    return {
      key: `seed:review:${product.handle}:${itemIndex}`,
      source: itemIndex % 2 ? "csv_review" : "judgeme_review",
      sourceLabel: itemIndex % 2 ? "CSV reviews" : "Judge.me reviews",
      text,
      analysisText: text,
      rating,
      issueCode: profile.issueCode,
      sentiment: "negative",
      emotion: textInsights.emotions[itemIndex % textInsights.emotions.length]?.label || profile.sentiment,
      subjectiveNegative: profile.issueCode === "subjective_negative_reaction",
      createdAt,
      updatedAt: createdAt,
      variant: buildAffectedVariants(product, itemIndex)[0] || "Default Title",
      quantity: 1,
    };
  });

  return {
    returnItems,
    reviewItems,
  };
}

function buildSeedRefundTextCache({ product, profile, summary, refundInsights, diagnosisCompletedAt }) {
  const refundUnits = Math.max(0, Number(refundInsights.refundUnits || summary.totalRefundedUnits || 0));
  const itemCount = Math.min(4, Math.max(0, refundUnits));
  const items = Array.from({ length: itemCount }, (_, itemIndex) => {
    const quantity = Math.max(1, Math.round(refundUnits / Math.max(1, itemCount)));
    const amount = round(quantity * product.price * 0.92, 2);
    const createdAt = daysAgo(58 - itemIndex * 13, diagnosisCompletedAt).toISOString();
    const reason = refundInsights.topReasons[itemIndex % refundInsights.topReasons.length]?.label || "Customer request";
    const text = `${reason}: refund was connected to ${profile.mainIssue.toLowerCase()} follow-up.`;
    return {
      key: `seed:refund:${product.handle}:${itemIndex}`,
      source: "refunds",
      text,
      analysisText: text,
      issueCode: profile.issueCode === "product_quality" ? "refund_impact" : profile.issueCode,
      sentiment: refundInsights.level === "high" ? "negative" : "neutral",
      emotion: refundInsights.level === "high" ? "frustration" : "none",
      createdAt,
      updatedAt: createdAt,
      variant: buildAffectedVariants(product, itemIndex)[0] || "Default Title",
      quantity,
      amount,
      restockType: itemIndex % 2 ? "return" : "no_restock",
      noteText: `Seeded refund note for ${profile.mainIssue.toLowerCase()}.`,
      reasonText: reason,
      adjustmentReasons: [reason],
    };
  });

  return { items };
}

function buildMonthlyOrderActivity(product, riskCurve, index) {
  const months = getMonthStarts(SEED_NOW, MONTHS_TO_SEED).map((date, monthIndex) => {
    const risk = interpolateRiskForMonth(riskCurve, monthIndex);
    const price = getMonthPrice(product.price, monthIndex, index);
    const orderDemand = getBaseMonthlyOrders(product) * getSeasonality(product, date) * getDemandShape(monthIndex, index);
    const orders = Math.max(2, Math.round(orderDemand + deterministicWave(product.handle, monthIndex) * 5));
    const averageQuantity = product.price < 20 ? 1.22 : product.price < 80 ? 1.12 : 1.05;
    const orderUnits = Math.max(orders, Math.round(orders * averageQuantity));
    const returnRate = clamp(2.2 + risk * 0.22 + getIssueReturnLift(product.primaryIssue) + getHighRiskReturnLift(product) + deterministicWave(product.productGid, monthIndex) * 1.8, 0, 72);
    const refundRate = clamp(0.6 + risk * 0.045 + getIssueRefundLift(product.primaryIssue) + getHighRiskRefundLift(product) + deterministicWave(product.handle, monthIndex + 7) * 0.7, 0, 34);
    const returnedUnits = Math.min(orderUnits, Math.round(orderUnits * (returnRate / 100)));
    const refundedUnits = Math.min(orderUnits, Math.round(orderUnits * (refundRate / 100)));
    const returnedOrders = Math.min(orders, Math.max(0, Math.round(returnedUnits * 0.78)));
    const refundedOrders = Math.min(orders, Math.max(0, Math.round(refundedUnits * 0.86)));
    const revenue = round(orderUnits * price * (0.94 + deterministicWave(product.handle, monthIndex + 13) * 0.05), 2);
    const refundAmount = round(refundedUnits * price * 0.92, 2);

    return {
      key: formatMonthKey(date),
      label: formatMonthLabel(date),
      shortLabel: formatShortMonthLabel(date),
      startAt: date.toISOString(),
      orders,
      orderUnits,
      revenue,
      returnedOrders,
      returnedUnits,
      refundedOrders,
      refundedUnits,
      refundAmount,
      returnRate: percent(returnedUnits, orderUnits),
      refundRate: percent(refundedUnits, orderUnits),
      productRisk: risk,
    };
  });

  const summary = months.reduce((totals, month) => ({
    totalOrders: totals.totalOrders + month.orders,
    totalOrderUnits: totals.totalOrderUnits + month.orderUnits,
    totalRevenue: totals.totalRevenue + month.revenue,
    totalReturnedOrders: totals.totalReturnedOrders + month.returnedOrders,
    totalReturnedUnits: totals.totalReturnedUnits + month.returnedUnits,
    totalRefundedOrders: totals.totalRefundedOrders + month.refundedOrders,
    totalRefundedUnits: totals.totalRefundedUnits + month.refundedUnits,
    totalRefundAmount: totals.totalRefundAmount + month.refundAmount,
    maxOrders: Math.max(totals.maxOrders, month.orders, month.returnedOrders, month.refundedOrders),
  }), {
    totalOrders: 0,
    totalOrderUnits: 0,
    totalRevenue: 0,
    totalReturnedOrders: 0,
    totalReturnedUnits: 0,
    totalRefundedOrders: 0,
    totalRefundedUnits: 0,
    totalRefundAmount: 0,
    maxOrders: 0,
  });

  summary.totalRevenue = round(summary.totalRevenue, 2);
  summary.totalRefundAmount = round(summary.totalRefundAmount, 2);
  summary.returnRate = percent(summary.totalReturnedUnits, summary.totalOrderUnits);
  summary.refundRate = percent(summary.totalRefundedUnits, summary.totalOrderUnits);
  summary.maxOrders = Math.max(summary.maxOrders, 1);

  return {
    source: DEMO_SEED_SOURCE,
    windowDays: 365,
    generatedAt: SEED_NOW.toISOString(),
    months,
    summary,
  };
}

function buildReturnRatePrediction(monthlyOrderActivity, recommendations, index) {
  const months = monthlyOrderActivity.months;
  const firstWeek = addDays(months[0].startAt, 0);
  const observedPoints = Array.from({ length: 52 }, (_, weekIndex) => {
    const month = months[Math.min(months.length - 1, Math.floor(weekIndex / 4.35))];
    const date = addDays(firstWeek, weekIndex * 7);
    const orderUnits = Math.max(1, Math.round(month.orderUnits / 4.35 + deterministicWave(month.key, weekIndex) * 2));
    const weeklyReturnRate = clamp(month.returnRate + deterministicWave(month.key, weekIndex + index) * 1.8, 0, 100);
    const returnedUnits = Math.min(orderUnits, Math.max(0, Math.round(orderUnits * weeklyReturnRate / 100)));
    const orders = Math.max(1, Math.round(orderUnits / 1.08));
    const returnedOrders = Math.min(orders, Math.round(returnedUnits * 0.8));

    return {
      kind: "observed",
      key: formatDateKey(date),
      label: `W${String(weekIndex + 1).padStart(2, "0")}`,
      startAt: date.toISOString(),
      orders,
      orderUnits,
      returnedOrders,
      returnedUnits,
      rawReturnRate: percent(returnedUnits, orderUnits),
      rollingOrders: orders,
      rollingReturnedOrders: returnedOrders,
      rollingOrderUnits: orderUnits,
      rollingReturnedUnits: returnedUnits,
      smoothedReturnRate: round(clamp(weeklyReturnRate * 0.65 + month.returnRate * 0.35, 0, 100), 2),
    };
  });

  const handledActions = recommendations.filter((action) => ["applied", "reviewed"].includes(action.seedStatus)).length;
  const pendingActions = recommendations.length - handledActions;
  const currentRate = observedPoints[observedPoints.length - 1]?.smoothedReturnRate || monthlyOrderActivity.summary.returnRate;
  const improvement = handledActions ? 0.76 : pendingActions > 1 ? 1.12 : 0.96;
  const forecastPoints = Array.from({ length: 13 }, (_, forecastIndex) => {
    const date = addDays(SEED_NOW, 7 * (forecastIndex + 1));
    const curve = currentRate * improvement - forecastIndex * (handledActions ? 0.16 : -0.08);
    const predictedReturnRate = clamp(curve + deterministicWave("forecast", forecastIndex + index) * 0.35, 0, 100);
    return {
      kind: "forecast",
      key: formatDateKey(date),
      label: `F${forecastIndex + 1}`,
      startAt: date.toISOString(),
      predictedReturnRate: round(predictedReturnRate, 2),
      basePredictedReturnRate: round(clamp(predictedReturnRate + (handledActions ? 0.8 : 0), 0, 100), 2),
      baselineReturnRate: monthlyOrderActivity.summary.returnRate,
      seasonalReturnRate: clamp(monthlyOrderActivity.summary.returnRate - 0.7, 0, 100),
      trendSlope: handledActions ? -0.16 : 0.08,
    };
  });

  return {
    source: DEMO_SEED_SOURCE,
    granularity: "weekly",
    windowDays: 365,
    generatedAt: SEED_NOW.toISOString(),
    observedPoints,
    forecastPoints,
    summary: {
      totalOrders: monthlyOrderActivity.summary.totalOrders,
      totalReturnedOrders: monthlyOrderActivity.summary.totalReturnedOrders,
      totalOrderUnits: monthlyOrderActivity.summary.totalOrderUnits,
      totalReturnedUnits: monthlyOrderActivity.summary.totalReturnedUnits,
      totalReturnRate: monthlyOrderActivity.summary.returnRate,
      last30DayReturnRate: recentWeeklyReturnRate(observedPoints, 5),
      last60DayReturnRate: recentWeeklyReturnRate(observedPoints, 9),
      forecastNext90ReturnRate: round(average(forecastPoints.map((point) => point.predictedReturnRate)), 2),
      forecastWeeks: forecastPoints.length,
      predictionHorizonDays: 91,
      confidence: monthlyOrderActivity.summary.totalOrderUnits > 250 ? "High" : "Medium",
    },
    actionAdjustment: {
      direction: handledActions > pendingActions ? "improving" : pendingActions > 1 ? "worsening" : "neutral",
      pending: pendingActions,
      applied: recommendations.filter((action) => action.seedStatus === "applied").length,
      reviewed: recommendations.filter((action) => action.seedStatus === "reviewed").length,
      dismissed: recommendations.filter((action) => action.seedStatus === "dismissed").length,
      adjustmentFactor: round(improvement, 2),
    },
    model: {
      method: "seeded_weekly_unit_return_rate_projection",
      notes: [
        "Observed rates use returned units divided by ordered units.",
        "Forecast shape changes when recommended actions are applied or reviewed.",
        "All percentages are clamped between 0 and 100.",
      ],
    },
  };
}

function buildProductMomentum(product, monthlyOrderActivity, index) {
  const months = monthlyOrderActivity.months;
  const currentMonth = months[months.length - 1];
  const previousMonth = months[months.length - 2] || currentMonth;
  const previousQuarter = months.slice(-4, -1);
  const unitsLast30 = currentMonth.orderUnits;
  const unitsPrevious30 = previousMonth.orderUnits;
  const revenueLast30 = currentMonth.revenue;
  const revenuePrevious30 = previousMonth.revenue;
  const unitsPrevious90 = previousQuarter.reduce((total, month) => total + month.orderUnits, 0);
  const revenuePrevious90 = previousQuarter.reduce((total, month) => total + month.revenue, 0);
  const growthRatio = (unitsLast30 + 3) / (unitsPrevious30 + 3);
  const growthScore = clamp(50 + 35 * safeLog2(growthRatio), 0, 100);
  const currentVelocityScore = clamp(40 + Math.log1p(unitsLast30) * 12 + deterministicInt(product.handle, -8, 8), 0, 100);
  const catalogShareScore = clamp(currentVelocityScore - 5 + deterministicInt(product.productGid, -7, 12), 0, 100);
  const weeklyUnits = splitIntoWeeks(unitsLast30, product.handle);
  const trendConsistencyScore = clamp(50 + linearSlope(weeklyUnits) * 7 + weeklyUnits.filter(Boolean).length * 9, 0, 100);
  const recencyScore = unitsLast30 > 0 ? 100 : 0;
  const score = Math.round(clamp(
    currentVelocityScore * 0.35
      + growthScore * 0.25
      + catalogShareScore * 0.2
      + trendConsistencyScore * 0.15
      + recencyScore * 0.05,
    0,
    100,
  ));
  const confidence = Math.round(clamp(58 + Math.log1p(unitsLast30 + currentMonth.orders) * 8, 0, 96));
  const growthPercent = round((growthRatio - 1) * 100, 1);

  return {
    source: DEMO_SEED_SOURCE,
    score,
    tier: getMomentumTier(score),
    direction: getMomentumDirection({ score, growthScore, trendConsistencyScore, unitsLast30, unitsPrevious30 }),
    confidence,
    confidenceLabel: getMomentumConfidenceLabel(confidence),
    calculatedAt: SEED_NOW.toISOString(),
    windowDays: 365,
    baselineDays: 90,
    components: {
      currentVelocityScore: Math.round(currentVelocityScore),
      growthScore: Math.round(growthScore),
      catalogShareScore: Math.round(catalogShareScore),
      trendConsistencyScore: Math.round(trendConsistencyScore),
      recencyScore: Math.round(recencyScore),
    },
    inputs: {
      productCreatedAt: monthsAgo(16 + index, SEED_NOW).toISOString(),
      productAgeDays: 365 + index * 11,
      unitsLast7Days: Math.max(0, weeklyUnits[3]),
      unitsLast14Days: Math.max(0, weeklyUnits[2] + weeklyUnits[3]),
      unitsLast30Days: unitsLast30,
      unitsPrevious30Days: unitsPrevious30,
      unitsPrevious90Days: unitsPrevious90,
      revenueLast30Days: revenueLast30,
      revenuePrevious30Days: revenuePrevious30,
      revenuePrevious90Days: round(revenuePrevious90, 2),
      ordersLast30Days: currentMonth.orders,
      uniqueCustomersLast30Days: Math.round(currentMonth.orders * 0.82),
      weeklyUnitsLast4Weeks: weeklyUnits,
      weeklyRevenueLast4Weeks: splitIntoWeeks(revenueLast30, `${product.handle}:revenue`).map((value) => round(value, 2)),
      lastSaleAt: daysAgo(1 + (index % 4), SEED_NOW).toISOString(),
    },
    catalog: {
      unitsVelocityScore: Math.round(currentVelocityScore),
      revenueVelocityScore: Math.round(clamp(currentVelocityScore + deterministicInt(product.productGid, -10, 10), 0, 100)),
      storeUnitsLast30Days: 1240,
      storeUnitsPrevious90Days: 3480,
      storeRevenueLast30Days: 286000,
      storeRevenuePrevious90Days: 840000,
      medianUnitsLast30Days: 14,
      medianRevenueLast30Days: 4200,
      productShareLast30: round((unitsLast30 / 1240) * 100, 3),
      productShareBaseline: round((unitsPrevious90 / 3480) * 100, 3),
      shareLiftRatio: round(((unitsLast30 / 1240) + 0.0001) / ((unitsPrevious90 / 3480) + 0.0001), 3),
      topCatalogPercent: Math.max(1, 100 - Math.round(currentVelocityScore)),
      catalogProductCount: 126,
      hasCatalogBaseline: true,
    },
    display: {
      growthPercent,
      growthLabel: formatSignedPercent(growthPercent),
      catalogPositionLabel: `Top ${Math.max(1, 100 - Math.round(currentVelocityScore))}%`,
      trendLabel: growthPercent > 12 ? "Sales are increasing over the last 30 days." : growthPercent < -12 ? "Sales are cooling from an earlier peak." : "Sales activity is commercially stable.",
      recommendedUse: score >= 70 ? "Add to Watchlist" : score >= 50 ? "Monitor if risk rises" : "No commercial follow-up needed",
    },
    flags: {
      inventoryConstraint: false,
      availableDaysLast30Days: 30,
      missingCatalogBaseline: false,
      missingCustomerData: false,
      missingInventoryHistory: true,
    },
  };
}

function buildRiskCurve(product, index) {
  if (Array.isArray(product.forcedRiskCurve)) return product.forcedRiskCurve.slice(0, HISTORY_POINTS);
  const current = product.riskScore;
  const startHigh = clamp(current + 18 + (index % 5) * 3, current, 92);
  const startLow = clamp(current - 16 - (index % 4) * 2, 8, current);
  const peak = clamp(current + 22 + (index % 6) * 4, current + 4, 94);

  const values = Array.from({ length: HISTORY_POINTS }, (_, pointIndex) => {
    const t = pointIndex / (HISTORY_POINTS - 1);
    const wave = Math.sin(t * Math.PI * 3 + index) * (3 + index % 4);
    let value;
    switch (index % 6) {
      case 0:
        value = startHigh - (startHigh - current) * t + wave;
        break;
      case 1:
        value = startLow + (peak - startLow) * Math.exp(-((t - 0.72) ** 2) / 0.035) + (current - startLow) * t * 0.55 + wave;
        break;
      case 2:
        value = current + Math.sin(t * Math.PI * 2.4) * 17 + (t < 0.45 ? 10 : -3) + wave;
        break;
      case 3:
        value = startHigh - (startHigh - startLow) * Math.min(t * 1.6, 1) + (current - startLow) * Math.max(0, t - 0.62) * 2.7 + wave;
        break;
      case 4:
        value = current + Math.sin(t * Math.PI * 1.6 - 0.7) * 10 + wave * 0.7;
        break;
      default:
        value = startLow + (current - startLow) * t + Math.max(0, t - 0.58) * 10 + wave;
        break;
    }
    return Math.round(clamp(value, 1, 95));
  });

  values[values.length - 1] = current;
  return values;
}

function buildRiskHistory(product, riskCurve, monthlyOrderActivity, productMomentum, profile, index) {
  const startDate = monthsAgo(12, SEED_NOW);
  const months = monthlyOrderActivity.months;
  return riskCurve.map((riskScore, pointIndex) => {
    const recordedAt = addDays(startDate, pointIndex * 15);
    const month = months[Math.min(months.length - 1, Math.floor(pointIndex / 2))];
    const momentumOffset = Math.round((productMomentum.score - 50) * 0.08);
    return {
      source: `${DEMO_SEED_SOURCE}_history`,
      riskScore,
      impactScore: clamp(Math.round(product.impactScore + riskScore * 0.22 + deterministicWave(product.handle, pointIndex) * 4), 0, 100),
      confidence: clamp(Math.round(product.confidence - 12 + pointIndex * 0.7), 35, 96),
      primaryIssue: pointIndex < riskCurve.length - 4 ? profile.issueTitle : profile.mainIssue,
      recordedAt: recordedAt.toISOString(),
      metrics: {
        seedSource: DEMO_SEED_SOURCE,
        temporalMetricsVersion: 3,
        granularity: "biweekly",
        sequence: pointIndex + 1,
        periodEnd: recordedAt.toISOString(),
        returnRate: month.returnRate,
        refundRate: month.refundRate,
        negativeReviewRate: clamp(riskScore * 0.62 + index, 4, 78),
        avgRating: round(clamp(4.8 - riskScore / 38, 1.8, 4.9), 1),
        soldUnits: month.orderUnits,
        salesAmount: month.revenue,
        returnUnits: month.returnedUnits,
        refundUnits: month.refundedUnits,
        refundAmount: month.refundAmount,
        financialExposure: round(month.revenue * (riskScore / 100) * 0.22 + month.refundAmount * 0.45, 2),
        revenueAtRisk: round(month.revenue * (riskScore / 100) * 0.18, 2),
        marginAtRisk: round(month.revenue * (riskScore / 100) * 0.07, 2),
        signalCount: Math.max(2, Math.round(riskScore / 6) + momentumOffset + (index % 3)),
        customerSignalCount: Math.max(1, month.returnedUnits + month.refundedUnits + Math.round(riskScore / 9)),
        evidenceStrengthScore: clamp(Math.round(45 + riskScore * 0.38 + pointIndex * 0.4), 35, 96),
        returnPressureScore: clamp(Math.round(month.returnRate * 2.4 + riskScore * 0.32), 0, 100),
        returnPressureRate: month.returnRate,
        refundLeakageScore: clamp(Math.round(month.refundRate * 3.3 + riskScore * 0.18), 0, 100),
        productMomentumScore: productMomentum.score,
        productMomentumTier: productMomentum.tier,
        momentumDirection: productMomentum.direction,
        sourceCoverage: getSourceCoverage(index),
      },
    };
  });
}

function buildIssues(product, profile, summary, riskCurve, index) {
  const severity = product.riskScore >= 75 ? "High" : product.riskScore >= 55 ? "Medium" : "Low";
  const signalCount = getSignalCount(summary, Math.round(product.riskScore / 5), 2);
  return [
    {
      id: profile.issueCode,
      issue: profile.issueTitle,
      label: profile.issueTitle,
      issueCode: profile.issueCode,
      severity,
      confidence: product.confidence,
      signals: Math.max(2, Math.round(signalCount * 0.42)),
      action: profile.actionTitle,
      suggestedAction: profile.actionTitle,
      trend: riskCurve.slice(-8),
      sourceTypes: ["shopify_returns", "judgeme_reviews", "csv_reviews"],
      description: `ProductPulse found ${profile.reason}.`,
    },
    {
      id: `${profile.issueCode}_language`,
      issue: `Repeated customer language: ${profile.repeatedLanguage[0]}`,
      label: `Repeated customer language: ${profile.repeatedLanguage[0]}`,
      issueCode: "customer_language",
      severity: signalCount > 22 ? "Medium" : "Low",
      confidence: clamp(product.confidence - 8, 35, 94),
      signals: Math.max(1, Math.round(signalCount * 0.22)),
      action: "Review customer language evidence",
      suggestedAction: "Review customer language evidence",
      trend: riskCurve.slice(-8).map((value) => clamp(value - 5 + (index % 3), 0, 100)),
      sourceTypes: ["shopify_return_notes", "reviews"],
      description: `Repeated language includes ${quote(profile.repeatedLanguage[0])}, which helps explain why the issue is surfaced.`,
    },
    {
      id: `${profile.issueCode}_content`,
      issue: "PDP content can set clearer expectations",
      label: "PDP content can set clearer expectations",
      issueCode: "product_content",
      severity: "Low",
      confidence: clamp(product.confidence - 12, 30, 90),
      signals: 2 + (index % 4),
      action: "Update product description",
      suggestedAction: "Update product description",
      trend: riskCurve.slice(-8).map((value) => clamp(value - 10, 0, 100)),
      sourceTypes: ["shopify_product"],
      description: "Product content can explain the expected format, size, visual tone or included items before purchase.",
    },
  ];
}

function buildEvidence(product, profile, monthlyOrderActivity, productMomentum, riskCurve, index) {
  const summary = monthlyOrderActivity.summary;
  const languageRows = profile.repeatedLanguage.map((term, termIndex) => ({
    term,
    count: Math.max(2, Math.round(summary.totalReturnedUnits * (0.18 - termIndex * 0.035))),
    sentiment: termIndex === 0 ? "negative" : "mixed",
    source: termIndex % 2 ? "reviews" : "returns",
  }));

  return {
    seedSource: DEMO_SEED_SOURCE,
    executiveSummary: `${product.productTitle} shows a one-year ${describeRiskShape(riskCurve)} pattern. The strongest current evidence points to ${profile.mainIssue.toLowerCase()} with ${summary.returnRate}% return rate and ${summary.refundRate}% refund rate.`,
    mainFinding: {
      title: profile.issueTitle,
      detail: `Returns, refunds and reviews indicate that ${profile.reason}. ProductPulse seeded this demo with a year of month-by-month order activity so charts and reports can be tested without Shopify API access.`,
    },
    sources: {
      returns: {
        title: "Returns",
        cards: [
          { label: "Returned units", value: summary.totalReturnedUnits, detail: `${summary.returnRate}% of ordered units` },
          { label: "Top reason", value: profile.returnReasons[0], detail: `${Math.max(1, Math.round(summary.totalReturnedUnits * 0.38))} returned units` },
          { label: "Recent trend", value: getTrendLabel(riskCurve), detail: "Based on the last 8 saved risk points" },
        ],
      },
      refunds: {
        title: "Refunds",
        cards: [
          { label: "Refunded units", value: summary.totalRefundedUnits, detail: `${summary.refundRate}% of ordered units` },
          { label: "Refund amount", value: summary.totalRefundAmount, detail: "Seeded Shopify refund value" },
          { label: "Refund reason", value: "Customer request", detail: "Most common seeded refund label" },
        ],
      },
      reviews: {
        title: "Reviews",
        cards: [
          { label: "Negative reviews", value: Math.max(1, Math.round(product.riskScore / 4)), detail: "Judge.me and CSV reviews combined" },
          { label: "Repeated phrase", value: profile.repeatedLanguage[0], detail: "Customer language cluster" },
          { label: "Sentiment", value: profile.sentiment, detail: "Dominant seeded sentiment" },
        ],
      },
      productContent: {
        title: "Shopify product",
        cards: [
          { label: "Description words", value: 58 + deterministicInt(product.handle, 20, 130), detail: "HTML-cleaned description word count" },
          { label: "Media count", value: 2 + (index % 5), detail: "Seeded product media count" },
          { label: "Product type", value: product.productType, detail: "Shopify product metadata" },
        ],
      },
      customerLanguage: {
        title: "Customer language",
        cards: languageRows,
      },
      productTimeline: {
        title: "Product changes",
        cards: buildProductChangeLog(product, profile, index),
      },
      supportTickets: {
        title: "Support tickets",
        cards: [
          { label: "Ticket themes", value: profile.repeatedLanguage[0], detail: `${Math.max(2, Math.round(summary.totalReturnedUnits * 0.18))} seeded support mentions` },
          { label: "Support macro", value: profile.secondaryActionTitle, detail: "Synthetic support guidance for follow-up workflows" },
        ],
      },
      pdpQuestions: {
        title: "PDP Q&A",
        cards: [
          { label: "Top blocker", value: `Will this avoid ${profile.repeatedLanguage[0]}?`, detail: "Seeded shopper question before purchase" },
          { label: "FAQ opportunity", value: profile.secondaryActionTitle, detail: "Question can be answered on the product page" },
        ],
      },
    },
    raw: {
      monthlyOrderActivity,
      productMomentum,
      riskCurve,
      languageRows,
    },
  };
}

function buildRecommendations(product, profile, summary, index) {
  const currentDescription = buildCurrentDescription(product);
  const expectationCopy = buildExpectationCopy(product, profile);
  const faqItems = buildFaqItems(product, profile);
  const actionStatus = getSeedActionStatuses(index);
  const basePayload = {
    currentDescription,
    returnUnits: summary.totalReturnedUnits,
    returnRate: summary.returnRate,
    refundUnits: summary.totalRefundedUnits,
    refundRate: summary.refundRate,
    topReturnReasons: profile.returnReasons,
    contentIssues: buildContentIssues(product, profile, 2),
    negativeReviewCount: Math.max(1, Math.round(product.riskScore / 6)),
    why: `ProductPulse recommends this because ${summary.totalReturnedUnits} returned units, ${Math.max(1, Math.round(product.riskScore / 6))} negative reviews and repeated language such as ${quote(profile.repeatedLanguage[0])} point to ${profile.mainIssue.toLowerCase()}.`,
  };

  return [
    {
      id: "product-description-changes",
      label: "Update product description",
      type: "PDP copy",
      effort: "Low",
      status: "Ready",
      seedStatus: actionStatus[0] || "pending",
      payload: {
        ...basePayload,
        descriptionChangeGroup: true,
        shopifyField: "Product description",
        operation: "append",
        proposedChange: "Add buyer-facing guidance to the current product description.",
        draftText: expectationCopy,
        textToAdd: expectationCopy,
        updatedValue: `${currentDescription}\\n\\n${expectationCopy}`,
        expectedImpact: "Reduce avoidable returns by setting expectations before purchase.",
        applicationRisk: "Low",
        approval: "Review required before applying",
        descriptionChanges: [
          {
            id: "expectation-note",
            title: profile.secondaryActionTitle,
            operation: "append",
            draftText: expectationCopy,
            reason: basePayload.why,
            selected: true,
          },
        ],
      },
    },
    {
      id: "create-product-faq",
      label: "Create product FAQ",
      type: "PDP FAQ",
      effort: "Medium",
      status: "Ready",
      seedStatus: actionStatus[1] || "pending",
      payload: {
        ...basePayload,
        shopifyField: "Product description",
        operation: "append",
        faqItems,
        proposedChange: "Append an FAQ block that answers the most common pre-purchase questions.",
        draftText: faqItems.map((item) => `${item.question}\\n${item.answer}`).join("\\n\\n"),
        expectedImpact: "Improve buyer clarity and reduce low-confidence returns.",
        applicationRisk: "Low",
        approval: "Review required before applying",
      },
    },
    {
      id: profile.issueCode === "refund_pressure" ? "add-refund-review-tag" : "qa-or-evidence-review",
      label: profile.issueCode === "refund_pressure" ? "Add refund review tag" : profile.actionTitle,
      type: profile.issueCode === "refund_pressure" ? "Product tag" : "Workflow",
      effort: profile.issueCode === "refund_pressure" ? "Low" : "Medium",
      status: "Ready",
      seedStatus: actionStatus[2] || "pending",
      payload: {
        ...basePayload,
        shopifyField: profile.issueCode === "refund_pressure" ? "Product tags" : "Nothing by default",
        proposedChange: profile.issueCode === "refund_pressure"
          ? "Add internal tags risk-review and refund-pressure."
          : "Open the supporting evidence and verify whether the issue requires QA, supplier or PDP follow-up.",
        tagsToAdd: profile.issueCode === "refund_pressure" ? ["risk-review", "refund-pressure"] : [`${profile.issueCode}-review`],
        checklist: [
          `Confirm whether ${profile.mainIssue.toLowerCase()} is still active.`,
          `Review examples containing ${quote(profile.repeatedLanguage[0])}.`,
          "Decide whether a PDP change, QA review or internal tag is the right follow-up.",
        ],
        expectedImpact: "Create a visible operational follow-up path for this product.",
        applicationRisk: "Low",
        approval: "Manual review required",
      },
    },
  ];
}

function buildContentIssues(product, profile, count) {
  const issues = [
    {
      issueCode: "expectation_gap",
      label: "Expectation-setting copy could be clearer",
      detail: `The PDP can explain ${profile.mainIssue.toLowerCase()} before purchase.`,
    },
    {
      issueCode: "media_context_gap",
      label: "Media context could be stronger",
      detail: "Additional image guidance or alt text would reduce ambiguity.",
    },
    {
      issueCode: "metadata_alignment",
      label: "Metadata and tags should support the diagnosis",
      detail: `Tags should help the team find products related to ${profile.issueCode}.`,
    },
    {
      issueCode: "seo_clarity_gap",
      label: "SEO and PDP language do not explain the risk clearly",
      detail: "Search and product copy should make the expected use, format and included items obvious.",
    },
    {
      issueCode: "missing_specifications",
      label: "Important product specifications are missing",
      detail: "The PDP should include the practical details customers need before deciding to buy.",
    },
  ];
  return issues.slice(0, count).map((issue) => ({ ...issue, productTitle: product.productTitle }));
}

function buildContentAdvisories(product, profile) {
  return [
    {
      title: "Expectation note recommended",
      detail: `Add a short note explaining ${profile.mainIssue.toLowerCase()} for ${product.productTitle}.`,
      source: "seeded_product_content",
    },
    {
      title: "Review visual context",
      detail: "Confirm images and alt text show the actual product scale, format and tone.",
      source: "seeded_media_review",
    },
  ];
}

function buildTextInsights(profile, negativeReviewCount, summary) {
  return {
    source: DEMO_SEED_SOURCE,
    sentiment: {
      total: negativeReviewCount + Math.round(summary.totalReturnedUnits * 0.35),
      positive: Math.max(1, Math.round(negativeReviewCount * 0.18)),
      neutral: Math.max(1, Math.round(negativeReviewCount * 0.22)),
      negative: negativeReviewCount,
      dominant: profile.sentiment === "neutral" ? "mixed" : "negative",
      negativeRatio: round(negativeReviewCount / Math.max(negativeReviewCount + 4, 1), 2),
    },
    emotions: [
      { label: profile.sentiment, count: Math.max(2, Math.round(negativeReviewCount * 0.45)), source: "reviews" },
      { label: "confusion", count: Math.max(1, Math.round(negativeReviewCount * 0.25)), source: "returns" },
    ],
    repeatedLanguage: profile.repeatedLanguage.map((term, index) => ({
      term,
      count: Math.max(2, Math.round((negativeReviewCount + summary.totalReturnedUnits * 0.2) / (index + 2))),
      sources: index % 2 ? ["reviews"] : ["returns", "reviews"],
      dominantSentiment: index === 0 ? "negative" : "mixed",
      issueCode: profile.issueCode,
      example: `Customer mentioned ${quote(term)} while describing ${profile.mainIssue.toLowerCase()}.`,
    })),
  };
}

function buildRefundInsights(summary) {
  return {
    source: DEMO_SEED_SOURCE,
    total: summary.totalRefundedUnits,
    soldUnits: summary.totalOrderUnits,
    refundUnits: summary.totalRefundedUnits,
    refundRate: summary.refundRate,
    refundAmount: summary.totalRefundAmount,
    level: summary.refundRate >= 12 ? "high" : summary.refundRate >= 5 ? "medium" : "low",
    highPressure: summary.refundRate >= 20 && summary.totalOrderUnits > 10,
    monitorPressure: summary.refundRate >= 8,
    topReasons: [
      { label: "Customer request", count: Math.max(1, Math.round(summary.totalRefundedUnits * 0.44)) },
      { label: "Order level refund", count: Math.max(1, Math.round(summary.totalRefundedUnits * 0.28)) },
      { label: "Pre-fulfillment cancellation", count: Math.max(1, Math.round(summary.totalRefundedUnits * 0.16)) },
    ],
    sentiment: {
      total: summary.totalRefundedUnits,
      neutral: Math.max(0, Math.round(summary.totalRefundedUnits * 0.62)),
      negative: Math.max(0, Math.round(summary.totalRefundedUnits * 0.24)),
      positive: 0,
      dominant: "neutral",
    },
  };
}

function buildProductChangeLog(product, profile, index) {
  return [
    {
      date: monthsAgo(10, SEED_NOW).toISOString(),
      type: "price_change",
      title: "Price adjusted after early demand test",
      detail: `Price moved from ${formatMoney(product.price * 0.92)} to ${formatMoney(product.price)}.`,
    },
    {
      date: monthsAgo(7, SEED_NOW).toISOString(),
      type: "content_change",
      title: "Description copy updated",
      detail: `Seeded description copy added more context about ${profile.mainIssue.toLowerCase()}.`,
    },
    {
      date: monthsAgo(3, SEED_NOW).toISOString(),
      type: index % 2 ? "tag_change" : "media_change",
      title: index % 2 ? "Internal risk tag added" : "Image order reviewed",
      detail: index % 2 ? `Tag ${profile.issueCode}-review added for operational tracking.` : "Primary media was reviewed to reduce buyer confusion.",
    },
  ];
}

function buildPriceHistory(product, months, index) {
  return months.map((month, monthIndex) => ({
    date: month.startAt,
    price: getMonthPrice(product.price, monthIndex, index),
    compareAtPrice: monthIndex < 3 ? round(product.price * 1.08, 2) : null,
  }));
}

function buildSignalTrendFromRisk(riskCurve) {
  return riskCurve.slice(-12).map((value, index) => Math.max(1, Math.round(value / 8 + index % 3)));
}

function getIssueProfile(product) {
  const haystack = `${product.primaryIssue} ${product.productTitle} ${product.productType}`.toLowerCase();
  return ISSUE_PROFILES.find((profile) => profile.match.some((term) => haystack.includes(term))) || ISSUE_PROFILES[ISSUE_PROFILES.length - 1];
}

function getSeedActionStatuses(index) {
  const patterns = [
    [null, null, null],
    ["applied", null, null],
    ["reviewed", null, "dismissed"],
    [null, "dismissed", null],
    ["applied", "reviewed", null],
  ];
  return patterns[index % patterns.length];
}

function getSourceCoverage(index) {
  const sources = ["Shopify product", "Shopify orders", "Shopify returns", "Shopify refunds", "Judge.me reviews", "Product retention"];
  if (index % 3 !== 0) sources.push("CSV reviews");
  if (index % 4 === 0) sources.push("Support tickets");
  if (index % 5 === 0) sources.push("PDP Q&A");
  return sources;
}

function getBaseMonthlyOrders(product) {
  const title = product.productTitle.toLowerCase();
  if (title.includes("nintendo")) return 72;
  if (title.includes("snowboard")) return 24;
  if (title.includes("mona lisa") || title.includes("night watch") || title.includes("scream")) return 9;
  if (product.price < 10) return 180;
  if (product.price < 25) return 118;
  if (product.price < 90) return 72;
  if (product.price > 500) return 16;
  return 42;
}

function getSeasonality(product, date) {
  const month = date.getUTCMonth();
  const title = product.productTitle.toLowerCase();
  if (title.includes("snowboard")) return [10, 11, 0, 1].includes(month) ? 1.75 : [5, 6, 7].includes(month) ? 0.55 : 0.9;
  if (product.collections.includes("Toys")) return [10, 11].includes(month) ? 1.85 : [0, 6].includes(month) ? 1.14 : 0.94;
  if (title.includes("nintendo")) return [10, 11, 0].includes(month) ? 1.42 : 1.02;
  return 1;
}

function getDemandShape(monthIndex, index) {
  const t = monthIndex / Math.max(1, MONTHS_TO_SEED - 1);
  if (index % 4 === 0) return 1.18 - t * 0.32;
  if (index % 4 === 1) return 0.76 + t * 0.42;
  if (index % 4 === 2) return 1 + Math.sin(t * Math.PI * 2) * 0.18;
  return 0.94 + t * 0.12;
}

function getIssueReturnLift(issue) {
  const normalized = issue.toLowerCase();
  if (normalized.includes("quality") || normalized.includes("defect")) return 3.8;
  if (normalized.includes("fit") || normalized.includes("sizing")) return 4.5;
  if (normalized.includes("subjective")) return 2.5;
  if (normalized.includes("color")) return 3.2;
  return 1.6;
}

function getHighRiskReturnLift(product) {
  if (product.riskScore >= 90) return 10.5;
  if (product.riskScore >= 85) return 7.5;
  if (product.riskScore >= 80) return 5;
  return 0;
}

function getIssueRefundLift(issue) {
  const normalized = issue.toLowerCase();
  if (normalized.includes("refund") || normalized.includes("operational")) return 2.8;
  if (normalized.includes("fulfillment")) return 1.8;
  if (normalized.includes("quality") || normalized.includes("defect")) return 1.4;
  return 0.7;
}

function getHighRiskRefundLift(product) {
  if (product.riskScore >= 90) return 7.2;
  if (product.riskScore >= 85) return 5;
  if (product.riskScore >= 80) return 3.2;
  return 0;
}

function getMonthPrice(price, monthIndex, index) {
  const base = Number(price || 20);
  const change = monthIndex < 3 ? -0.08 : monthIndex > 8 && index % 3 === 0 ? 0.05 : 0;
  return round(base * (1 + change), 2);
}

function interpolateRiskForMonth(riskCurve, monthIndex) {
  const target = (monthIndex / Math.max(1, MONTHS_TO_SEED - 1)) * (riskCurve.length - 1);
  const low = Math.floor(target);
  const high = Math.min(riskCurve.length - 1, low + 1);
  const ratio = target - low;
  return Math.round(riskCurve[low] * (1 - ratio) + riskCurve[high] * ratio);
}

function getSignalCount(summary, negativeReviewCount, contentIssueCount) {
  return Math.max(1, summary.totalReturnedUnits + summary.totalRefundedUnits + negativeReviewCount + contentIssueCount);
}

function buildAffectedVariants(product, index) {
  if (product.productType === "Boots") return ["US 9", "US 10", "US 11"];
  if (product.productType === "Snowboard") return ["Default Title", "155cm", "158cm"];
  if (product.productTitle.toLowerCase().includes("nintendo")) return ["Neon Blue/Neon Red", "Console bundle"];
  return index % 2 ? ["Default Title"] : ["Standard", "Collector pack"];
}

function buildCurrentDescription(product) {
  return `${product.productTitle} is listed as a ${product.productType.toLowerCase()} from ${product.vendor}. This seeded catalog description includes core product context, collection placement and buyer-facing details for ProductPulse demo analysis.`;
}

function buildExpectationCopy(product, profile) {
  return `Please note: ${product.productTitle} may require clearer expectations around ${profile.mainIssue.toLowerCase()}. Review the product images, description and included details before purchase if ${profile.repeatedLanguage[0]} would affect your decision.`;
}

function buildFaqItems(product, profile) {
  return [
    {
      question: `What should I know before buying ${product.productTitle}?`,
      answer: `Customers most often need clarity around ${profile.mainIssue.toLowerCase()}. The product page should explain this before checkout.`,
    },
    {
      question: "Why might shoppers return this product?",
      answer: `Seeded return evidence points to ${profile.returnReasons.slice(0, 2).join(" and ").toLowerCase()}.`,
    },
  ];
}

function buildLikelyCause(product, profile, summary) {
  return `${profile.issueTitle}. Over the seeded one-year window, ${product.productTitle} recorded ${summary.totalReturnedUnits} returned units, ${summary.totalRefundedUnits} refunded units and repeated evidence that ${profile.reason}.`;
}

function describeRiskShape(riskCurve) {
  const first = riskCurve[0];
  const last = riskCurve[riskCurve.length - 1];
  const max = Math.max(...riskCurve);
  const min = Math.min(...riskCurve);
  if (first - last > 18) return "improving";
  if (last - first > 14) return "worsening";
  if (max - min > 30) return "volatile";
  return "stable";
}

function getTrendLabel(riskCurve) {
  const last = riskCurve[riskCurve.length - 1];
  const previous = riskCurve[Math.max(0, riskCurve.length - 5)];
  if (last + 5 < previous) return "Improving";
  if (last > previous + 5) return "Rising";
  return "Stable";
}

function buildSku(product) {
  return product.handle
    .split("-")
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => part.slice(0, 4).toUpperCase())
    .join("-");
}

function buildImageUrl(product) {
  return `https://placehold.co/160x160?text=${encodeURIComponent(product.productTitle.slice(0, 18))}`;
}

function splitIntoWeeks(total, seed) {
  const weights = [0.22, 0.24, 0.25, 0.29].map((weight, index) => Math.max(0.08, weight + deterministicWave(seed, index) * 0.035));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight, index) => {
    const value = total * (weight / totalWeight);
    return index === 3 ? Math.max(0, Math.round(value)) : Math.max(0, Math.floor(value));
  });
}

function recentWeeklyReturnRate(points, weeks) {
  const recent = points.slice(-weeks);
  const orderUnits = recent.reduce((total, point) => total + point.orderUnits, 0);
  const returnedUnits = recent.reduce((total, point) => total + point.returnedUnits, 0);
  return percent(returnedUnits, orderUnits);
}

function getMomentumTier(score) {
  if (score >= 80) return "Hot";
  if (score >= 60) return "Rising";
  if (score >= 40) return "Stable";
  if (score >= 20) return "Cooling";
  return "Low activity";
}

function getMomentumDirection({ growthScore, trendConsistencyScore, unitsLast30, unitsPrevious30 }) {
  if (unitsLast30 === 0) return "Dormant";
  if (unitsPrevious30 <= 3 && unitsLast30 >= 5 && growthScore >= 75) return "New spike";
  if (growthScore >= 70 && trendConsistencyScore >= 65) return "Accelerating";
  if (growthScore < 40) return "Cooling";
  return "High-volume stable";
}

function getMomentumConfidenceLabel(confidence) {
  if (confidence >= 80) return "High confidence";
  if (confidence >= 60) return "Medium confidence";
  if (confidence >= 40) return "Low confidence";
  return "Very low confidence";
}

function linearSlope(values) {
  const meanX = average(values.map((_, index) => index + 1));
  const meanY = average(values);
  const denominator = values.reduce((total, _, index) => total + ((index + 1 - meanX) ** 2), 0);
  if (!denominator) return 0;
  return values.reduce((total, value, index) => total + ((index + 1 - meanX) * (value - meanY)), 0) / denominator;
}

function safeLog2(value) {
  return Math.log2(Math.max(Number(value || 0), 0.0001));
}

function getMonthStarts(now, count) {
  return Array.from({ length: count }, (_, index) => (
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count + 1 + index, 1, 12, 0, 0))
  ));
}

function monthsAgo(count, now = SEED_NOW) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, Math.min(now.getUTCDate(), 28), 12, 0, 0));
}

function daysAgo(count, now = SEED_NOW) {
  return addDays(now, -count);
}

function addDays(value, count) {
  const date = parseDate(value) || new Date(value);
  return new Date(date.getTime() + count * 24 * 60 * 60 * 1000);
}

function addMinutes(value, count) {
  const date = parseDate(value) || new Date(value);
  return new Date(date.getTime() + count * 60 * 1000);
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatShortMonthLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
}

function deterministicInt(seed, min, max) {
  const normalizedMin = Math.ceil(min);
  const normalizedMax = Math.floor(max);
  const range = normalizedMax - normalizedMin + 1;
  return normalizedMin + (hashString(seed) % range);
}

function deterministicWave(seed, index) {
  const hash = hashString(`${seed}:${index}`);
  return Math.sin(hash * 0.017 + index * 0.73);
}

function hashString(value) {
  return String(value).split("").reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSeedRiskLabel(score = 0) {
  const value = Number(score || 0);
  if (value >= 75) return "High";
  if (value >= 55) return "Medium";
  if (value > 0) return "Low";
  return "Unscored";
}

function percent(numerator, denominator) {
  return round(clamp(denominator > 0 ? (Number(numerator || 0) / Number(denominator || 0)) * 100 : 0, 0, 100), 2);
}

function average(values) {
  const numbers = values.map(Number).filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function formatSignedPercent(value) {
  const rounded = Math.abs(round(value, 1));
  if (value > 0) return `+${rounded}%`;
  if (value < 0) return `-${rounded}%`;
  return "0%";
}

function formatSignedNumber(value) {
  const rounded = round(value, 1);
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

function formatSignedMoney(value) {
  const amount = Math.abs(round(value, 2));
  if (value > 0) return `+${formatMoney(amount)}`;
  if (value < 0) return `-${formatMoney(amount)}`;
  return "$0.00";
}

function formatMoney(value) {
  return `$${round(value, 2).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function quote(value) {
  return `"${String(value || "").trim()}"`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
