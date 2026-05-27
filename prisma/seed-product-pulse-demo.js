/* eslint-env node */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_SHOP = process.env.PRODUCT_PULSE_DEMO_SHOP || "damian-xdcxxupp";
const SEED_NOW = parseDate(process.env.PRODUCT_PULSE_DEMO_SEED_NOW) || new Date();
const DEMO_SEED_SOURCE = "product_pulse_demo_seed";
const MONTHS_TO_SEED = 12;
const HISTORY_POINTS = 24;

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

  await seedWatchlist(shop, seededProducts.slice(0, 5));

  const durationMs = Date.now() - startedAt.getTime();
  console.log(JSON.stringify({
    status: "ok",
    shop,
    productsSeeded: seededProducts.length,
    scoreHistoryRows: seededProducts.length * HISTORY_POINTS,
    timelineEvents: seededProducts.reduce((sum, product) => sum + Number(product.timelineEventCount || 0), 0),
    watchlistItems: Math.min(5, seededProducts.length),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    command: "npm run seed:demo",
  }, null, 2));
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
      creditsConsumed: 1,
      createdAt: diagnosisCreatedAt,
      completedAt: diagnosisCompletedAt,
    },
  });

  const metricsWithDiagnosis = {
    ...metrics,
    latestDiagnosisId: diagnosis.id,
    latestDiagnosisAt: diagnosisCompletedAt.toISOString(),
    lastDetailedDiagnosisAt: diagnosisCompletedAt.toISOString(),
    lastAnalyzedAt: diagnosisCompletedAt.toISOString(),
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
    index < 5 ? {
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
    const status = index === 3 ? "Paused" : "Watching";
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
        addedAt: daysAgo(18 - index, SEED_NOW),
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

    await prisma.productWatchActivity.createMany({
      data: [
        {
          shop,
          productGid: product.productGid,
          productTitle: product.productTitle,
          watchlistItemId: watchlistItem.id,
          eventType: "product_added",
          title: "Product added to watchlist",
          detail: `${product.productTitle} entered automatic monitoring.`,
          metadata: { seedSource: DEMO_SEED_SOURCE },
          createdAt: daysAgo(18 - index, SEED_NOW),
        },
        {
          shop,
          productGid: product.productGid,
          productTitle: product.productTitle,
          watchlistItemId: watchlistItem.id,
          eventType: index === 3 ? "product_paused" : "watch_scan_completed",
          title: index === 3 ? "Product paused" : "Watch scan completed",
          detail: index === 3
            ? "Automatic rescans were paused for this demo product."
            : `Risk score refreshed at ${product.riskScore}/100.`,
          metadata: {
            seedSource: DEMO_SEED_SOURCE,
            riskScore: product.riskScore,
            confidence: product.confidence,
          },
          createdAt: daysAgo(2 + index, SEED_NOW),
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
    tags: product.tags,
    collections: product.collections,
    price: product.price,
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
      judgeMe: { reviewCount: Math.round(reviewCount * 0.62), negativeReviewCount: Math.round(negativeReviewCount * 0.62), averageRating: avgRating },
      csv: { reviewCount: reviewCount - Math.round(reviewCount * 0.62), negativeReviewCount: negativeReviewCount - Math.round(negativeReviewCount * 0.62), averageRating: round(Math.max(1, avgRating - 0.2), 1) },
    },
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
        returnRate: month.returnRate,
        refundRate: month.refundRate,
        soldUnits: month.orderUnits,
        returnUnits: month.returnedUnits,
        refundUnits: month.refundedUnits,
        revenueAtRisk: round(month.revenue * (riskScore / 100) * 0.18, 2),
        marginAtRisk: round(month.revenue * (riskScore / 100) * 0.07, 2),
        signalCount: Math.max(2, Math.round(riskScore / 6) + momentumOffset + (index % 3)),
        productMomentumScore: productMomentum.score,
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
  const sources = ["Shopify product", "Shopify orders", "Shopify returns", "Shopify refunds", "Judge.me reviews"];
  if (index % 3 !== 0) sources.push("CSV reviews");
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
