#!/usr/bin/env node
/* eslint-env node */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const API_VERSION = "2026-04";
const execFileAsync = promisify(execFile);
const DEFAULT_SCENARIO_KEY = "gen-lumispan-v1";
const SUPPORTED_SCENARIO_KEYS = new Set(["gen-hazedock-v1", "gen-hazedock-v2", "gen-lumispan-v1"]);
const CUSTOM_REVIEW_SOURCE = "ProductPulse mock reviews";
const CUSTOM_TAG = "productpulse-custom-gen";
const CUSTOM_ORDER_TAG = "productpulse-custom-gen-order";
const RELTEST_CUSTOMER_TAG = "productpulse-reltest-customer";
const DEFAULT_ORDER_CREATE_DELAY_MS = 12_500;
const CUSTOM_DIAGNOSIS_JOB_KIND = "scripted-product-diagnosis";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const NORMALIZED_CSV_COLUMNS = [
  "source_row",
  "product_handle",
  "shopify_product_id",
  "rating",
  "review_title",
  "review_body",
  "review_date",
  "reviewer_name",
  "review_status",
  "source_product_id",
];

export function buildScenario(key = DEFAULT_SCENARIO_KEY, { now = new Date() } = {}) {
  if (!SUPPORTED_SCENARIO_KEYS.has(key)) {
    throw new Error(`Unknown custom mock scenario: ${key}`);
  }
  if (key === "gen-lumispan-v1") return buildLumaSpanScenario(now);

  const cleanCompatibilityRevision = key === "gen-hazedock-v2";
  const scenarioTag = cleanCompatibilityRevision ? "ppcustom-gen-hazedock-v2" : "ppcustom-gen-hazedock-v1";
  const productKey = cleanCompatibilityRevision ? "gen-hazedock-casefit-stand" : "gen-hazedock-magnetic-stand";
  const productTitle = cleanCompatibilityRevision ? "GEN HazeDock CaseFit Charging Stand" : "GEN HazeDock Magnetic Charging Stand";
  const handle = cleanCompatibilityRevision ? "gen-hazedock-casefit-charging-stand" : "gen-hazedock-magnetic-charging-stand";
  const orderRefPrefix = cleanCompatibilityRevision ? "casefit" : "hazedock";

  return {
    key,
    scenarioTag,
    productKey,
    orderTag: `${scenarioTag}-order`,
    product: {
      key: productKey,
      title: productTitle,
      handle,
      productType: "Phone Accessories",
      vendor: "ProductPulse Lab",
      preliminaryIssue: cleanCompatibilityRevision ? "Case compatibility mismatch" : "Magnetic charging alignment and overnight-use expectation mismatch",
      seoTitle: cleanCompatibilityRevision ? "HazeDock CaseFit Charging Stand" : "HazeDock Magnetic Charging Stand",
      seoDescription: "Magnetic charging stand for bare phones or magnetic-compatible cases, with centered placement guidance for shoppers checking case compatibility.",
      descriptionHtml: `
        <section>
          <h2>Compact magnetic charging stand for compatible cases</h2>
          <p>HazeDock is a phone accessories stand that holds compatible phones at an easy viewing angle while charging through USB-C power.</p>
          <p>Best results require a magnetic-compatible case or a bare phone, centered placement, and a power adapter that supports your phone's normal wireless charging needs.</p>
          <p>This is not a universal through-case charger. Thick, metal, wallet, ring, pop-grip, or non-magnetic cases can create alignment and overnight charging compatibility issues.</p>
        </section>
      `,
      tags: [
        "GEN",
        CUSTOM_TAG,
        scenarioTag,
        "charging",
        "magnetic-stand",
        "compatibility",
        "case-compatibility",
        "not-universal-charger",
        "expectation-mismatch",
      ],
      options: [{ name: "Color", values: ["Slate", "Fog"] }],
      variants: [
        { options: { Color: "Slate" }, price: "39.00", sku: "GEN-HAZEDOCK-SLATE" },
        { options: { Color: "Fog" }, price: "39.00", sku: "GEN-HAZEDOCK-FOG" },
      ],
      story: "A compact accessory with an expectation mismatch: the stand works when the phone is centered and the case is magnetic-compatible, but several buyers discover that wallet, ring, and non-magnetic cases are not compatible with the intended setup.",
      expectedFindings: [
        "Return and review text should cluster around case compatibility, centered placement, wallet or ring cases, and shopper expectation-setting.",
        "The issue should be treated as expectation/setup clarity with possible charging QA, not as a broad product-feed mismatch.",
        "Existing RELTEST customers should preserve prior purchase context for sequence and repeat-customer calculations.",
      ],
      expectedActions: [
        "Add an expectation-setting note about case compatibility and centered placement.",
        "Add a short troubleshooting/FAQ block for supported cases, unsupported case types, and centered placement.",
        "Review charging-pad alignment QA only if compatibility-qualified buyers keep reporting the same problem.",
      ],
    },
    customers: [
      { key: "reltest-customer-001", role: "repeat existing buyer with before/source/after sequence history" },
      { key: "reltest-customer-002", role: "existing sequence buyer with prior source-product purchase" },
      { key: "reltest-customer-003", role: "existing sequence buyer used as a clean purchase" },
      { key: "reltest-customer-004", role: "existing sequence buyer with later refund-only signal" },
      { key: "reltest-customer-018", role: "existing general-order buyer from the broad mock dataset" },
    ],
    orderPlans: [
      {
        ref: `${orderRefPrefix}-001`,
        customerKey: "reltest-customer-001",
        daysAgo: 36,
        variantHint: "Slate",
        quantity: 1,
        note: "First HazeDock order from an existing sequence customer; no outcome so retention has one clean baseline.",
      },
      {
        ref: `${orderRefPrefix}-002`,
        customerKey: "reltest-customer-002",
        daysAgo: 29,
        variantHint: "Fog",
        quantity: 1,
        note: "Fog unit bought by a prior RELTEST source-product customer; return language is deliberately indirect.",
      },
      {
        ref: `${orderRefPrefix}-003`,
        customerKey: "reltest-customer-003",
        daysAgo: 22,
        variantHint: "Slate",
        quantity: 1,
        note: "Clean order from an existing sequence customer.",
      },
      {
        ref: `${orderRefPrefix}-004`,
        customerKey: "reltest-customer-004",
        daysAgo: 15,
        variantHint: "Fog",
        quantity: 2,
        note: "Two-unit Fog order with a refund-only goodwill outcome on one unit.",
      },
      {
        ref: `${orderRefPrefix}-005`,
        customerKey: "reltest-customer-001",
        daysAgo: 8,
        variantHint: "Slate",
        quantity: 1,
        note: "Repeat same-product purchase from reltest-customer-001; linked return and refund.",
      },
      {
        ref: `${orderRefPrefix}-006`,
        customerKey: "reltest-customer-018",
        daysAgo: 4,
        variantHint: "Fog",
        quantity: 1,
        note: "Recent general-customer order with no outcome so the product is not all negative.",
      },
      {
        ref: `${orderRefPrefix}-007`,
        customerKey: "reltest-customer-002",
        daysAgo: 2,
        variantHint: "Fog",
        quantity: 1,
        note: "Repeat customer after an earlier return; second Fog return strengthens the expectation mismatch signal.",
      },
    ],
    outcomePlans: [
      {
        type: "return",
        orderRef: `${orderRefPrefix}-002`,
        returnReason: cleanCompatibilityRevision ? "OTHER" : "NOT_AS_DESCRIBED",
        theme: "case-alignment",
        note: cleanCompatibilityRevision
          ? "Other: Compatibility issue. The stand lines up bare-phone, but it is not compatible with my wallet case, and the listing made that boundary feel broader than it is."
          : "Compatibility issue: my everyday case is not magnetic-compatible enough, so the phone looks aligned but does not keep the charging position. The stand is complete; the page needs clearer case and centered-placement limits.",
      },
      {
        type: "refund",
        orderRef: `${orderRefPrefix}-004`,
        theme: "overnight-charge-drop",
        quantity: 1,
        note: "Goodwill refund for one Fog stand because it is not compatible with the buyer's wallet-style case. Support marked this as a compatibility and expectation-setting gap.",
      },
      {
        type: "return",
        orderRef: `${orderRefPrefix}-005`,
        returnReason: "OTHER",
        theme: "warmth-and-trust",
        note: cleanCompatibilityRevision
          ? "Other: The dock works in the supported setup, but it is not compatible with the everyday ring case I use. I needed a compatibility checklist before buying."
          : "Other: The dock works bare-phone, but with the normal case the alignment is too conditional for overnight use. I needed a clear compatibility checklist before buying.",
      },
      {
        type: "refund",
        orderRef: `${orderRefPrefix}-005`,
        theme: "warmth-and-trust",
        quantity: 1,
        note: "Partial refund after the repeat buyer returned the Slate unit for a case compatibility mismatch; refund should attach to the same line item as the return.",
      },
      {
        type: "return",
        orderRef: `${orderRefPrefix}-007`,
        returnReason: "OTHER",
        theme: "case-alignment",
        note: cleanCompatibilityRevision
          ? "Other: Second try was still a compatibility issue. Bare phone is fine, but this is not compatible with the case I actually keep on the phone."
          : "Other: Second try was still a compatibility issue. Bare phone is fine, everyday case is not compatible enough, and the product page should make that boundary impossible to miss.",
      },
    ],
    reviews: buildHazeDockReviews(now, { cleanCompatibilityRevision }),
  };
}

export function calculateScenarioPlanSummary(scenario) {
  const units = scenario.orderPlans.reduce((sum, plan) => sum + Number(plan.quantity || 0), 0);
  const returnCount = scenario.outcomePlans.filter((plan) => plan.type === "return").length;
  const refundCount = scenario.outcomePlans.filter((plan) => plan.type === "refund").length;
  const refundUnits = scenario.outcomePlans
    .filter((plan) => plan.type === "refund")
    .reduce((sum, plan) => sum + Number(plan.quantity || 1), 0);
  const negativeReviewCount = scenario.reviews.filter((review) => Number(review.rating) <= 2).length;
  return {
    productTitle: scenario.product.title,
    plannedOrders: scenario.orderPlans.length,
    plannedUnits: units,
    plannedReturns: returnCount,
    plannedRefunds: refundCount,
    plannedRefundUnits: refundUnits,
    plannedReviews: scenario.reviews.length,
    plannedNegativeReviews: negativeReviewCount,
    plannedReturnRate: units ? returnCount / units : 0,
    plannedRefundRate: units ? refundUnits / units : 0,
  };
}

function buildLumaSpanScenario(now) {
  const scenarioTag = "ppcustom-gen-lumispan-v1";
  const productKey = "gen-lumispan-desk-rail-light";
  const orderRefPrefix = "lumispan";

  return {
    key: "gen-lumispan-v1",
    scenarioTag,
    productKey,
    orderTag: `${scenarioTag}-order`,
    relationshipAddOns: [
      { key: "reltest-together", sku: "GEN-RELTEST-TOGETHER", expectedTitle: "GEN RELTEST Bought Together Product" },
      { key: "reltest-before", sku: "GEN-RELTEST-BEFORE", expectedTitle: "GEN RELTEST Bought Before Product" },
      { key: "reltest-after", sku: "GEN-RELTEST-AFTER", expectedTitle: "GEN RELTEST Bought After Product" },
    ],
    product: {
      key: productKey,
      title: "GEN LumaSpan Modular Desk Rail Light",
      handle: "gen-lumispan-modular-desk-rail-light",
      productType: "Desk Lighting",
      vendor: "ProductPulse Lab",
      preliminaryIssue: "Mounting surface and low-dim camera flicker expectation mismatch",
      seoTitle: "LumaSpan Modular Desk Rail Light",
      seoDescription: "Modular desk rail light with adhesive or clamp mounting, USB-C power, and explicit setup notes for surfaces, cable exit, and low-dim camera flicker.",
      descriptionHtml: `
        <section>
          <h2>Modular rail light for work desks, monitor shelves, and focused corners</h2>
          <p>GEN LumaSpan is a slim rail light that mounts along the back edge of a desk, under a monitor shelf, or inside a compact work nook. It is designed for soft task illumination, cable-aware desks, and shoppers who want a cleaner light source than a freestanding lamp.</p>
          <p>The rail uses a frosted magnetic diffuser, five brightness levels, and three color temperatures. It is intended for daily desktop use, reading, keyboard visibility, and ambient work lighting. It is not a video key light, a waterproof light strip, or a universal adhesive mount for every furniture finish.</p>
        </section>
        <section>
          <h3>Included in the box</h3>
          <ul>
            <li>One LumaSpan rail light with removable magnetic diffuser.</li>
            <li>Two adhesive mounting plates for smooth sealed surfaces.</li>
            <li>Two clamp feet for desks or shelves where adhesive is not appropriate.</li>
            <li>Three low-profile cable clips.</li>
            <li>One 1.2 m USB-C to USB-C cable. Wall adapter is not included.</li>
          </ul>
        </section>
        <section>
          <h3>Before you buy: surface and setup checklist</h3>
          <p>Use adhesive only on smooth, sealed, clean surfaces such as painted metal, sealed laminate, glass, or finished veneer. Textured laminate, unfinished wood, oiled walnut, waxed finishes, dusty undersides, warm monitor-shelf undersides, and porous surfaces should use the clamp feet instead of adhesive. For adhesive setup, clean the surface first and allow a 24 hour cure before hanging the rail.</p>
          <p>The USB-C cable exits from the left side by default. Right-side cable routing is possible by flipping the rail, but the control button will face inward and may feel less natural. Measure the 1.2 m cable path before checkout if your outlet or hub is on the opposite side of the desk.</p>
          <p>The lowest two dimming levels can show banding or pulse lines on webcams, phone cameras, or high shutter-speed footage. This does not affect normal desk use, but LumaSpan should not be purchased as a camera-facing video light.</p>
          <p>For glossy monitors or glass desk tops, angle the diffuser away from direct reflections. The light is indoor-only and should not be installed in damp rooms or outdoor shelving.</p>
        </section>
        <section>
          <h3>Power expectations</h3>
          <p>LumaSpan is powered by USB-C and works best from a steady 5 V / 2 A source. Laptop ports, monitor hubs, and low-power adapters can behave differently when the brightness changes. If the rail flickers visibly to your eye at mid or high brightness, move it to a dedicated 5 V / 2 A adapter or a powered hub.</p>
          <p>The box includes the cable but not a wall adapter. This is intentional so customers can reuse a desk hub or an adapter they already own.</p>
        </section>
      `,
      tags: [
        "GEN",
        CUSTOM_TAG,
        scenarioTag,
        "desk-lighting",
        "modular-rail-light",
        "surface-setup",
        "usb-c-powered",
        "camera-flicker-note",
        "relationship-test",
        "retention-test",
        "expectation-mismatch",
      ],
      options: [
        { name: "Color", values: ["Graphite", "Mist"] },
        { name: "Length", values: ["63 cm", "92 cm"] },
      ],
      variants: [
        { options: { Color: "Graphite", Length: "63 cm" }, price: "54.00", sku: "GEN-LUMISPAN-GRAPHITE-63" },
        { options: { Color: "Mist", Length: "63 cm" }, price: "54.00", sku: "GEN-LUMISPAN-MIST-63" },
        { options: { Color: "Graphite", Length: "92 cm" }, price: "68.00", sku: "GEN-LUMISPAN-GRAPHITE-92" },
        { options: { Color: "Mist", Length: "92 cm" }, price: "68.00", sku: "GEN-LUMISPAN-MIST-92" },
      ],
      story: "A desk-lighting product where the explicit PDP checklist already covers several complaints. The analysis should still detect mounting and low-dim flicker friction, but should be careful not to treat no adapter, left cable exit, surface limits, or camera banding as missing PDP content.",
      expectedFindings: [
        "Returns, refunds, and reviews should cluster around mounting surfaces, adhesive cure, left-side cable exit, missing adapter expectations, and low-dim camera banding.",
        "The long description already covers no adapter, surface limits, adhesive cure, left cable exit, glossy reflections, and low-dim camera banding, so description-gap actions should be conservative.",
        "Repeat RELTEST buyers and same-customer purchase histories should produce usable retention and relationship timeline context.",
        "Same-order RELTEST add-ons should create product relationship evidence when those products exist in the store.",
      ],
      expectedActions: [
        "Prefer making the existing setup checklist more scannable over adding duplicate PDP warnings.",
        "Create support/QA triage around adhesive failure on warm or textured surfaces and low-dim camera banding language.",
        "Do not recommend adding wall-adapter, left-cable, surface, or camera-flicker notes as if they are absent from the description.",
      ],
    },
    customers: [
      { key: "reltest-customer-001", role: "existing buyer with prior relationship sequence and repeat LumaSpan purchase" },
      { key: "reltest-customer-002", role: "existing sequence buyer who returns first unit and later buys again" },
      { key: "reltest-customer-003", role: "existing sequence buyer used for clean repeat purchase and add-on relationship signal" },
      { key: "reltest-customer-004", role: "existing sequence buyer with refund-only friction and later repeat purchase" },
      { key: "reltest-customer-005", role: "existing or fallback buyer for adapter expectation friction" },
      { key: "reltest-customer-018", role: "existing general-order buyer from the broad mock dataset" },
    ],
    orderPlans: [
      {
        ref: `${orderRefPrefix}-001`,
        customerKey: "reltest-customer-001",
        daysAgo: 78,
        variantHint: "Graphite / 63 cm",
        quantity: 1,
        addOns: [{ key: "reltest-before", quantity: 1 }],
        note: "First clean LumaSpan order from an existing sequence customer, with a RELTEST add-on to exercise same-order relationship context.",
      },
      {
        ref: `${orderRefPrefix}-002`,
        customerKey: "reltest-customer-002",
        daysAgo: 64,
        variantHint: "Mist / 63 cm",
        quantity: 1,
        note: "Return case where the buyer used adhesive on an oiled/textured shelf even though the PDP has a surface checklist.",
      },
      {
        ref: `${orderRefPrefix}-003`,
        customerKey: "reltest-customer-003",
        daysAgo: 56,
        variantHint: "Graphite / 92 cm",
        quantity: 1,
        addOns: [{ key: "reltest-together", quantity: 1 }],
        note: "Clean 92 cm purchase with a bought-together RELTEST companion for product relationship timeline.",
      },
      {
        ref: `${orderRefPrefix}-004`,
        customerKey: "reltest-customer-004",
        daysAgo: 45,
        variantHint: "Mist / 63 cm",
        quantity: 2,
        note: "Two-unit Mist order with a refund-only outcome tied to low-dim webcam banding.",
      },
      {
        ref: `${orderRefPrefix}-005`,
        customerKey: "reltest-customer-001",
        daysAgo: 30,
        variantHint: "Graphite / 92 cm",
        quantity: 1,
        note: "Repeat same-product purchase from reltest-customer-001; return/refund tests cable-exit expectation language.",
      },
      {
        ref: `${orderRefPrefix}-006`,
        customerKey: "reltest-customer-018",
        daysAgo: 22,
        variantHint: "Mist / 63 cm",
        quantity: 1,
        note: "Recent general-customer clean purchase so the product is not all negative.",
      },
      {
        ref: `${orderRefPrefix}-007`,
        customerKey: "reltest-customer-002",
        daysAgo: 16,
        variantHint: "Graphite / 63 cm",
        quantity: 1,
        addOns: [{ key: "reltest-together", quantity: 1 }],
        note: "Repeat buyer after an earlier return; clean second purchase tests retention after friction.",
      },
      {
        ref: `${orderRefPrefix}-008`,
        customerKey: "reltest-customer-005",
        daysAgo: 10,
        variantHint: "Mist / 92 cm",
        quantity: 1,
        note: "Return language mixes missing-adapter frustration with glossy reflection complaints, both intentionally described in the PDP.",
      },
      {
        ref: `${orderRefPrefix}-009`,
        customerKey: "reltest-customer-003",
        daysAgo: 6,
        variantHint: "Graphite / 92 cm",
        quantity: 1,
        addOns: [{ key: "reltest-after", quantity: 1 }],
        note: "Repeat clean 92 cm order from reltest-customer-003 with a different RELTEST add-on to widen relationship evidence.",
      },
      {
        ref: `${orderRefPrefix}-010`,
        customerKey: "reltest-customer-004",
        daysAgo: 2,
        variantHint: "Mist / 63 cm",
        quantity: 1,
        note: "Recent refund-only issue after adhesive loses grip on a warm underside; tests whether watchlist detects fresh risk.",
      },
    ],
    outcomePlans: [
      {
        type: "return",
        orderRef: `${orderRefPrefix}-002`,
        returnReason: "OTHER",
        theme: "surface-and-adhesive",
        note: "Other: The light works, but I put the adhesive under an oiled, slightly ribbed monitor shelf and it slowly let go. I later found the smooth sealed surface/clamp note in the listing, but I did not understand that rule at checkout.",
      },
      {
        type: "refund",
        orderRef: `${orderRefPrefix}-004`,
        theme: "low-dim-camera-banding",
        quantity: 1,
        note: "Goodwill refund for one Mist rail. Customer sees bands on webcam calls at the lowest dim level; support notes the PDP mentions camera banding/high shutter behavior, but the buyer read it as normal desk-light language, not a video-call limitation.",
      },
      {
        type: "return",
        orderRef: `${orderRefPrefix}-005`,
        returnReason: "OTHER",
        theme: "left-cable-exit",
        note: "Other: Returned because the cable exits left by default and the buyer needed a right-side drop behind a monitor arm. The page technically explains the flip option, but they missed the control-button tradeoff until installation.",
      },
      {
        type: "refund",
        orderRef: `${orderRefPrefix}-005`,
        theme: "left-cable-exit",
        quantity: 1,
        note: "Partial refund after return. Reason is not damage; it is cable-routing expectation mismatch on a repeat buyer's second LumaSpan order.",
      },
      {
        type: "return",
        orderRef: `${orderRefPrefix}-008`,
        returnReason: "OTHER",
        theme: "adapter-and-glare",
        note: "Other: Box had the USB-C cable but no wall adapter, and the glossy monitor picked up a strip reflection. The customer says those notes were probably present, just buried under setup detail.",
      },
      {
        type: "refund",
        orderRef: `${orderRefPrefix}-010`,
        theme: "surface-and-adhesive",
        quantity: 1,
        note: "Refund-only courtesy credit. Adhesive plate released from a warm textured underside after three days; support classified as surface/setup mismatch and recommended clamp feet per the existing checklist.",
      },
    ],
    reviews: buildLumaSpanReviews(now),
  };
}

function buildLumaSpanReviews(now) {
  const specs = [
    {
      daysAgo: 83,
      rating: 5,
      title: "Clean rail when the surface is right",
      body: "Graphite 63 cm looks built-in on a sealed metal shelf. The adhesive cured overnight and the cable clips made the desk look intentional. I used a powered hub and had no flicker to my eye.",
      reviewer: "Mock Reviewer Luma 01",
    },
    {
      daysAgo: 71,
      rating: 2,
      title: "It failed slowly, not immediately",
      body: "Mist stayed up for a few days, then eased off the underside of my oiled wood riser. The odd part is the rail itself is good; the surface rule was somewhere on the page, but I did not convert that into 'use the clamps, not adhesive' until too late.",
      reviewer: "Mock Reviewer Luma 02",
    },
    {
      daysAgo: 63,
      rating: 4,
      title: "Good light, read the cable bit",
      body: "The left exit is real. It worked for my desk because my hub is on that side, but anyone with a right-side monitor arm should measure first or accept the flipped button orientation.",
      reviewer: "Mock Reviewer Luma 03",
    },
    {
      daysAgo: 51,
      rating: 2,
      title: "Webcam made it look defective",
      body: "To my eyes the light is fine, but on calls the low setting creates rolling bands. I later noticed the camera warning in the description, which is why this is frustrating rather than mysterious.",
      reviewer: "Mock Reviewer Luma 04",
    },
    {
      daysAgo: 43,
      rating: 5,
      title: "The 92 cm graphite is useful",
      body: "Mounted under a sealed laminate shelf with clamps first, then adhesive after cleaning. It spreads light better than my old puck lights and does not crowd the keyboard area.",
      reviewer: "Mock Reviewer Luma 05",
    },
    {
      daysAgo: 35,
      rating: 2,
      title: "Cable path surprised me",
      body: "I bought the longer one and only realized during setup that the default USB-C exit wants the left side. The page says that, but it was mixed in with a lot of other setup text, so I still ended up returning it.",
      reviewer: "Mock Reviewer Luma 06",
    },
    {
      daysAgo: 27,
      rating: 3,
      title: "Adapter assumption was on me, maybe",
      body: "It includes a cable and no wall brick. I am annoyed because I had to steal an adapter from another desk, but I can see the listing says no wall adapter. The product is usable once powered.",
      reviewer: "Mock Reviewer Luma 07",
    },
    {
      daysAgo: 19,
      rating: 4,
      title: "Second purchase went better",
      body: "After the first install taught me to use clamps on anything textured, the second rail was straightforward. That setup checklist matters more than the pictures make it seem.",
      reviewer: "Mock Reviewer Luma 08",
    },
    {
      daysAgo: 12,
      rating: 1,
      title: "Too much setup interpretation",
      body: "The light has all the caveats, but they did not land for my desk: warm shelf underside, glossy monitor, right-side cable, video calls. Nothing is broken in one simple way, yet the whole install felt conditional.",
      reviewer: "Mock Reviewer Luma 09",
    },
    {
      daysAgo: 9,
      rating: 5,
      title: "Works with a powered hub",
      body: "Using the rail from a powered USB-C hub made brightness changes stable. The diffuser is soft enough for normal work, and I appreciate that it does not pretend to be a studio light.",
      reviewer: "Mock Reviewer Luma 10",
    },
    {
      daysAgo: 6,
      rating: 2,
      title: "Gloss reflection and missing brick",
      body: "My return was half reflection on a glossy monitor and half realizing the wall adapter was not in the box. Both details are probably written down, but the buying decision still felt easier than the install.",
      reviewer: "Mock Reviewer Luma 11",
    },
    {
      daysAgo: 3,
      rating: 4,
      title: "Clamps solved the surface problem",
      body: "I ignored adhesive for my textured shelf and used the clamp feet. That made the rail stable, so the product can work if the setup note is followed literally.",
      reviewer: "Mock Reviewer Luma 12",
    },
    {
      daysAgo: 1,
      rating: 2,
      title: "Not missing info, just easy to misread",
      body: "Support pointed me to every answer: no adapter, left cable, camera bands, smooth sealed surfaces. I still would not call the page clear because the important yes/no decisions are inside a long explanation.",
      reviewer: "Mock Reviewer Luma 13",
    },
  ];

  return specs.map((spec) => ({
    ...spec,
    date: new Date(now.getTime() - spec.daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  }));
}

function buildHazeDockReviews(now, { cleanCompatibilityRevision = false } = {}) {
  if (cleanCompatibilityRevision) {
    const specs = [
      {
        daysAgo: 54,
        rating: 5,
        title: "Good with the right case",
        body: "Slate sits neatly next to my monitor and works with my magnetic-compatible case. The centered placement note is true, but it is manageable in the supported setup.",
        reviewer: "Mock Reviewer CaseFit 01",
      },
      {
        daysAgo: 42,
        rating: 4,
        title: "Compatibility note matters",
        body: "The stand is useful, though the case note should be louder. Anyone using a wallet, ring, or non-magnetic case needs to know this is not compatible before checkout.",
        reviewer: "Mock Reviewer CaseFit 02",
      },
      {
        daysAgo: 31,
        rating: 2,
        title: "Not compatible with my wallet case",
        body: "Fog looked like the right answer for my nightstand, but it is not compatible with the wallet case I actually use. Bare phone is a different scenario than my daily setup.",
        reviewer: "Mock Reviewer CaseFit 03",
      },
      {
        daysAgo: 24,
        rating: 5,
        title: "Works bare-phone",
        body: "With no case, the stand grabs the phone and charges normally. It is a clean desk accessory for me, though case compatibility is still the key qualifier.",
        reviewer: "Mock Reviewer CaseFit 04",
      },
      {
        daysAgo: 18,
        rating: 2,
        title: "Compatibility issue, not obvious at first",
        body: "The confusing part is that it looks close to working. My everyday case is not compatible, and the page made the supported setup sound broader than it really is.",
        reviewer: "Mock Reviewer CaseFit 05",
      },
      {
        daysAgo: 11,
        rating: 2,
        title: "Wrong setup for my case",
        body: "I bought it for the phone as I carry it, case and all. That case is not compatible with the stand, so the product needed a clearer first-paragraph compatibility warning.",
        reviewer: "Mock Reviewer CaseFit 06",
      },
      {
        daysAgo: 7,
        rating: 3,
        title: "Works after changing the case",
        body: "Once I switched to a magnetic-compatible case, the behavior made more sense. The stand is fine for that setup, but the purchase decision depends on case compatibility.",
        reviewer: "Mock Reviewer CaseFit 07",
      },
      {
        daysAgo: 5,
        rating: 2,
        title: "Case compatibility is the real product",
        body: "The stand may fit someone else's phone setup, but it is not compatible with mine. I would have kept it if the product page had a case checklist instead of a broad charging promise.",
        reviewer: "Mock Reviewer CaseFit 08",
      },
      {
        daysAgo: 3,
        rating: 4,
        title: "Clearer with a magnetic case",
        body: "After switching cases it behaved much better. That makes the accessory useful, but it also proves the case compatibility warning should be impossible to miss.",
        reviewer: "Mock Reviewer CaseFit 09",
      },
      {
        daysAgo: 1,
        rating: 2,
        title: "Returned over compatibility",
        body: "I could make it line up bare-phone on the counter, but the everyday use case was different. It is not compatible with the case I use, and that was the missing buying detail.",
        reviewer: "Mock Reviewer CaseFit 10",
      },
    ];

    return specs.map((spec) => ({
      ...spec,
      date: new Date(now.getTime() - spec.daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    }));
  }

  const specs = [
    {
      daysAgo: 54,
      rating: 5,
      title: "Useful desk angle",
      body: "Slate sits neatly next to my monitor and charges when the phone is centered. I use a magnetic-compatible case, so the product matched what I expected.",
      reviewer: "Mock Reviewer Haze 01",
    },
    {
      daysAgo: 42,
      rating: 4,
      title: "Good, but case note matters",
      body: "The stand is small and easy to position. I can see why someone with a thick or non-magnetic case would miss the alignment, so the page should probably say that louder.",
      reviewer: "Mock Reviewer Haze 02",
    },
    {
      daysAgo: 31,
      rating: 2,
      title: "I could not tell if it was charging",
      body: "Fog looked nice, but my wallet case was not compatible enough for centered overnight charging. Maybe the dock is fine bare-phone; the page made the case requirement sound easier than it is.",
      reviewer: "Mock Reviewer Haze 03",
    },
    {
      daysAgo: 24,
      rating: 5,
      title: "Works bare-phone",
      body: "With no case, the stand grabs the phone and charges normally. It is a clean desk accessory for me, though I would not call it universal for every case.",
      reviewer: "Mock Reviewer Haze 04",
    },
    {
      daysAgo: 18,
      rating: 2,
      title: "The issue is hard to describe",
      body: "It did not feel broken. It felt conditional: bare phone lines up, everyday case does not. If the intended setup is bare phone or a magnetic-compatible case, that belongs in the first paragraph.",
      reviewer: "Mock Reviewer Haze 05",
    },
    {
      daysAgo: 11,
      rating: 1,
      title: "Nightstand trust problem",
      body: "I bought it for overnight charging, which is the one job where I do not want a maybe. Support asked about my case, and that made the compatibility limits feel missing from the listing.",
      reviewer: "Mock Reviewer Haze 06",
    },
    {
      daysAgo: 7,
      rating: 3,
      title: "Works only when I babysit it",
      body: "If I place the phone slowly and watch the icon, it works. If I use it like a normal nightstand dock with my case on, the alignment is too conditional. Not broken in an obvious way, just too dependent on case type.",
      reviewer: "Mock Reviewer Haze 07",
    },
    {
      daysAgo: 5,
      rating: 2,
      title: "Case compatibility is the real product",
      body: "The stand may be fine, but my everyday case turns the whole thing into a compatibility guessing game. I would have kept it if the product page had a case checklist instead of a broad magnetic charging promise.",
      reviewer: "Mock Reviewer Haze 08",
    },
    {
      daysAgo: 3,
      rating: 4,
      title: "Clearer with the right case",
      body: "After switching to a magnetic case it behaved much better. That makes the accessory useful, but it also proves the setup warning should be impossible to miss.",
      reviewer: "Mock Reviewer Haze 09",
    },
    {
      daysAgo: 1,
      rating: 2,
      title: "Not a simple defect, still a return",
      body: "I cannot prove the stand is defective because it charges bare-phone on the counter. I returned it because the everyday use case was too uncertain: case on, alignment unclear, overnight result not predictable.",
      reviewer: "Mock Reviewer Haze 10",
    },
  ];

  return specs.map((spec) => ({
    ...spec,
    date: new Date(now.getTime() - spec.daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  }));
}

function loadDotEnv(filePath = ".env") {
  const text = readFileSyncSafe(filePath);
  if (!text) return;
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    if (!key || process.env[key] != null) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function readFileSyncSafe(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {
    scenario: DEFAULT_SCENARIO_KEY,
    runDiagnosis: true,
    adminMode: process.env.PRODUCT_PULSE_SHOPIFY_ADMIN_MODE || "auto",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--shop") args.shop = argv[++index];
    else if (arg.startsWith("--shop=")) args.shop = arg.slice("--shop=".length);
    else if (arg === "--scenario") args.scenario = argv[++index];
    else if (arg.startsWith("--scenario=")) args.scenario = arg.slice("--scenario=".length);
    else if (arg === "--admin-mode") args.adminMode = argv[++index];
    else if (arg.startsWith("--admin-mode=")) args.adminMode = arg.slice("--admin-mode=".length);
    else if (arg === "--skip-diagnosis") args.runDiagnosis = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: npm run seed:custom-mock-product -- [--shop shop.myshopify.com] [--scenario gen-lumispan-v1] [--admin-mode auto|direct|cli] [--skip-diagnosis]",
    "",
    "Creates or reuses one custom GEN product, existing mock customers, orders, returns, refunds, CSV reviews,",
    "a ProductPulse snapshot, a watchlist baseline, and optionally a deep diagnosis.",
    "Supported scenarios: gen-lumispan-v1, gen-hazedock-v2, gen-hazedock-v1.",
  ].join("\n"));
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const appModulesHandle = await loadAppModules({ diagnosis: args.runDiagnosis });

  const prisma = new PrismaClient();
  try {
    const shop = await resolveShop(prisma, args.shop);
    const session = await getOfflineSession(prisma, shop);
    const admin = await createScenarioAdmin({ shop, session, mode: args.adminMode });
    admin.productPulseScopes = session.scope || "";

    const scenario = buildScenario(args.scenario);

    const shopInfo = await getShopInfo(admin);
    const location = await getPrimaryLocation(admin);
    const product = await loadOrCreateProduct({ admin, scenario, location, currencyCode: shopInfo.currencyCode });
    const relationshipAddOns = await loadRelationshipAddOns({ admin, scenario, currencyCode: shopInfo.currencyCode });
    const customers = await loadScenarioCustomers({ admin, scenario });
    const purchaseHistoryBefore = await loadCustomerPurchaseHistories({ admin, customers });
    const orders = await loadOrCreateOrders({
      admin,
      scenario,
      product,
      relationshipAddOns,
      customers,
      location,
      currencyCode: shopInfo.currencyCode,
    });
    const ordersWithOutcomes = await fetchScenarioOrders({ admin, scenario, product, includeOutcomes: true });
    const ordersForOutcomes = mergeOrdersByRef(orders, ordersWithOutcomes);
    const outcomes = await createScenarioOutcomes({
      admin,
      scenario,
      product,
      orders: ordersForOutcomes,
      currencyCode: shopInfo.currencyCode,
    });
    const fetchedFinalOrders = await fetchScenarioOrders({ admin, scenario, product, includeOutcomes: true });
    const finalOrders = mergeOrdersByRef(ordersForOutcomes, fetchedFinalOrders);
    const reviewSource = await appendScenarioReviews({
      prisma,
      shop,
      scenario,
      product,
    });
    const snapshot = await upsertPreliminarySnapshot({
      prisma,
      shop,
      scenario,
      product,
      orders: finalOrders,
      outcomes,
      reviewSource,
    });
    const watchlist = await addScenarioProductToWatchlist({
      watchlistModule: appModulesHandle.watchlistModule,
      shop,
      product,
      snapshot,
    });
    const diagnosis = args.runDiagnosis
      ? await runDeepDiagnosis({
        prisma,
        diagnosisModule: appModulesHandle.diagnosisModule,
        shop,
        admin,
        snapshot,
      })
      : null;
    const purchaseHistoryAfter = await loadCustomerPurchaseHistories({ admin, customers });
    const validation = await validateScenarioSeed({
      prisma,
      shop,
      scenario,
      product,
      orders: finalOrders,
      outcomes,
      reviewSource,
      watchlist,
      diagnosis,
    });
    const report = await saveScenarioReport({
      shop,
      scenario,
      product,
      relationshipAddOns,
      customers,
      purchaseHistoryBefore,
      purchaseHistoryAfter,
      orders: finalOrders,
      outcomes,
      reviewSource,
      watchlist,
      snapshot,
      diagnosis,
      validation,
    });

    console.log(JSON.stringify({
      status: validation.ok ? "success" : "warning",
      shop,
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
      },
      planned: calculateScenarioPlanSummary(scenario),
      actual: validation.actual,
      diagnosis: diagnosis ? {
        diagnosisId: diagnosis.diagnosisId,
        riskScore: diagnosis.riskScore,
        confidence: diagnosis.confidence,
        estimatedImpact: diagnosis.estimatedImpact,
      } : null,
      reviewSource: {
        filePath: reviewSource.filePath,
        previousRowCount: reviewSource.previousRowCount,
        rowCount: reviewSource.rowCount,
        addedRows: reviewSource.addedRows,
      },
      watchlist,
      reportPath: report.reportPath,
      validation,
    }, null, 2));
  } finally {
    await appModulesHandle?.close?.();
    await prisma.$disconnect();
  }
}

async function loadAppModules({ diagnosis = true } = {}) {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: process.cwd(),
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true },
  });
  const [watchlistModule, diagnosisModule] = await Promise.all([
    server.ssrLoadModule("/app/lib/product-pulse-watchlist.server.js"),
    diagnosis ? server.ssrLoadModule("/app/lib/product-pulse-diagnosis.server.js") : Promise.resolve(null),
  ]);
  return {
    watchlistModule,
    diagnosisModule,
    close: () => server.close(),
  };
}

async function resolveShop(prisma, requestedShop) {
  const normalizedRequested = normalizeShopDomain(requestedShop);
  if (normalizedRequested) return normalizedRequested;

  const envShop = normalizeShopDomain(process.env.PRODUCT_PULSE_DEFAULT_SHOP || process.env.PRODUCT_PULSE_DEMO_SHOP);
  if (envShop) return envShop;

  const activeCsvSources = await prisma.productPulseSource.findMany({
    where: { sourceKey: "csvReviews", connected: true, active: true },
    select: { shop: true, lastSyncedAt: true },
    orderBy: [{ lastSyncedAt: "desc" }],
  });
  for (const source of activeCsvSources) {
    const session = await prisma.session.findFirst({
      where: { shop: source.shop, isOnline: false },
      select: { id: true },
    });
    if (session) return source.shop;
  }

  const session = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: { shop: "asc" },
  });
  if (session?.shop) return session.shop;
  throw new Error("No offline Shopify session was found. Install or reauthorize the app first.");
}

function normalizeShopDomain(shop) {
  const text = String(shop || "").trim().toLowerCase();
  if (!text) return "";
  if (text.endsWith(".myshopify.com")) return text;
  if (/^[a-z0-9][a-z0-9-]*$/.test(text)) return `${text}.myshopify.com`;
  return text;
}

async function getOfflineSession(prisma, shop) {
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { id: "asc" },
  });
  if (!session?.accessToken) throw new Error(`No offline Shopify access token found for ${shop}.`);
  return session;
}

async function createScenarioAdmin({ shop, session, mode = "auto" }) {
  const normalizedMode = String(mode || "auto").trim().toLowerCase();
  if (!["auto", "direct", "cli"].includes(normalizedMode)) {
    throw new Error(`Unsupported admin mode: ${mode}. Use auto, direct, or cli.`);
  }

  if (normalizedMode === "cli") return createShopifyCliAdmin({ shop });

  const directAdmin = createDirectAdmin({ shop, accessToken: session.accessToken });
  if (normalizedMode === "direct") return directAdmin;

  try {
    await shopifyGraphql(directAdmin, `#graphql
      query ProductPulseCustomMockAdminProbe {
        shop { myshopifyDomain }
      }
    `, undefined, "Probe direct Shopify admin token");
    return directAdmin;
  } catch (error) {
    console.warn(`Direct offline token probe failed for ${shop}; falling back to Shopify CLI auth. ${error instanceof Error ? error.message : String(error)}`);
    return createShopifyCliAdmin({ shop });
  }
}

function createDirectAdmin({ shop, accessToken }) {
  return {
    graphql(query, options = undefined) {
      return fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options?.variables,
        }),
      });
    },
  };
}

function createShopifyCliAdmin({ shop }) {
  return {
    async graphql(query, options = undefined) {
      const tempDir = await mkdtemp(path.join(tmpdir(), "product-pulse-shopify-"));
      const queryPath = path.join(tempDir, "operation.graphql");
      const variablesPath = path.join(tempDir, "variables.json");
      try {
        await writeFile(queryPath, String(query || ""), "utf8");
        await writeFile(variablesPath, JSON.stringify(options?.variables || {}), "utf8");
        const args = [
          "store",
          "execute",
          "--store",
          shop,
          "--version",
          API_VERSION,
          "--query-file",
          queryPath,
          "--variable-file",
          variablesPath,
          "--json",
        ];
        if (/\bmutation\b/i.test(String(query || ""))) args.push("--allow-mutations");
        const { stdout } = await execFileAsync("shopify", args, {
          cwd: process.cwd(),
          maxBuffer: 20 * 1024 * 1024,
        });
        const parsed = parseShopifyCliJson(stdout);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: parsed?.data || parsed,
            errors: parsed?.errors,
          }),
        };
      } catch (error) {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            errors: [{
              message: [
                error instanceof Error ? error.message : String(error),
                error?.stdout ? `stdout: ${stripAnsi(error.stdout).slice(0, 3000)}` : "",
                error?.stderr ? `stderr: ${stripAnsi(error.stderr).slice(0, 3000)}` : "",
              ].filter(Boolean).join(" "),
            }],
          }),
        };
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

function parseShopifyCliJson(output) {
  const text = stripAnsi(output);
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`Shopify CLI did not return JSON: ${text.slice(0, 500)}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  throw new Error(`Shopify CLI returned incomplete JSON: ${text.slice(start, start + 500)}`);
}

function stripAnsi(value) {
  return String(value || "").replace(ANSI_ESCAPE_PATTERN, "");
}

async function shopifyGraphql(admin, query, variables, label = "Shopify GraphQL") {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} ${JSON.stringify(json).slice(0, 4000)}`);
  }
  if (json.errors?.length) {
    throw new Error(`${label}: ${json.errors.map((error) => error.message).join("; ")}`);
  }
  return json.data;
}

function assertNoUserErrors(errors, label) {
  if (!Array.isArray(errors) || !errors.length) return;
  throw new Error(`${label}: ${errors.map((error) => {
    const field = Array.isArray(error.field) ? error.field.join(".") : error.field;
    return [field, error.message].filter(Boolean).join(": ");
  }).join("; ")}`);
}

async function getShopInfo(admin) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseCustomMockShopInfo {
      shop {
        currencyCode
      }
    }
  `, undefined, "Fetch shop info");
  return { currencyCode: data?.shop?.currencyCode || "USD" };
}

async function getPrimaryLocation(admin) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseCustomMockLocation {
      locations(first: 1) {
        nodes {
          id
          name
        }
      }
    }
  `, undefined, "Fetch primary location").catch(() => null);
  return data?.locations?.nodes?.[0] || null;
}

async function loadOrCreateProduct({ admin, scenario, location, currencyCode }) {
  const existing = await fetchScenarioProduct(admin, scenario, currencyCode);
  if (existing) return updateExistingProduct({ admin, scenario, product: existing, currencyCode });

  const spec = scenario.product;
  const created = await shopifyGraphql(admin, `#graphql
    mutation ProductPulseCustomMockProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          title
          handle
          productType
          vendor
          tags
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
  `, {
    product: {
      title: spec.title,
      handle: spec.handle,
      descriptionHtml: spec.descriptionHtml.trim(),
      productType: spec.productType,
      vendor: spec.vendor,
      tags: spec.tags,
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
    },
  }, `Create product ${spec.title}`);
  assertNoUserErrors(created?.productCreate?.userErrors, `Create product ${spec.title}`);

  const product = created.productCreate.product;
  const variants = spec.variants.map((variant) => ({
    price: variant.price,
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

  const variantData = await shopifyGraphql(admin, `#graphql
    mutation ProductPulseCustomMockVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
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
    variants,
  }, `Create variants for ${spec.title}`);
  assertNoUserErrors(variantData?.productVariantsBulkCreate?.userErrors, `Create variants for ${spec.title}`);

  return {
    ...spec,
    id: product.id,
    title: product.title,
    handle: product.handle,
    currencyCode,
    variants: (variantData?.productVariantsBulkCreate?.productVariants || []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: String(variant.price || "0"),
      sku: variant.sku,
      selectedOptions: variant.selectedOptions || [],
    })),
  };
}

async function updateExistingProduct({ admin, scenario, product, currencyCode }) {
  const spec = scenario.product;
  const data = await shopifyGraphql(admin, `#graphql
    mutation ProductPulseCustomMockProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          title
          handle
          productType
          vendor
          status
          tags
          variants(first: 10) {
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
        userErrors { field message }
      }
    }
  `, {
    product: {
      id: product.id,
      title: spec.title,
      descriptionHtml: spec.descriptionHtml.trim(),
      productType: spec.productType,
      vendor: spec.vendor,
      tags: spec.tags,
      seo: {
        title: spec.seoTitle,
        description: spec.seoDescription,
      },
    },
  }, `Update product ${spec.title}`);
  assertNoUserErrors(data?.productUpdate?.userErrors, `Update product ${spec.title}`);
  const updated = data?.productUpdate?.product || product;
  return {
    ...spec,
    id: updated.id,
    title: updated.title,
    handle: updated.handle || product.handle,
    productType: updated.productType || spec.productType,
    vendor: updated.vendor || spec.vendor,
    tags: updated.tags || spec.tags,
    currencyCode,
    variants: (updated.variants?.nodes || product.variants || []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: String(variant.price || "0"),
      sku: variant.sku,
      selectedOptions: variant.selectedOptions || [],
    })),
  };
}

async function fetchScenarioProduct(admin, scenario, currencyCode) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseCustomMockProduct($query: String!) {
      products(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
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
          variants(first: 10) {
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
    query: `tag:${scenario.scenarioTag}`,
  }, "Fetch scenario product");
  const product = (data?.products?.nodes || []).find((item) => item.status !== "ARCHIVED");
  if (!product) return null;
  return {
    ...scenario.product,
    id: product.id,
    title: product.title,
    handle: product.handle,
    productType: product.productType,
    vendor: product.vendor,
    tags: product.tags || [],
    currencyCode,
    variants: (product.variants?.nodes || []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: String(variant.price || "0"),
      sku: variant.sku,
      selectedOptions: variant.selectedOptions || [],
    })),
  };
}

async function loadRelationshipAddOns({ admin, scenario, currencyCode }) {
  const specs = Array.isArray(scenario.relationshipAddOns) ? scenario.relationshipAddOns : [];
  if (!specs.length) return new Map();

  const candidateMap = new Map();
  const addCandidates = (products = []) => {
    for (const product of products) {
      if (product?.id) candidateMap.set(product.id, product);
    }
  };
  addCandidates(await fetchRelationshipCandidateProducts(admin, "tag:relationship-test", currencyCode).catch(() => []));
  for (const spec of specs) {
    if (!spec.sku) continue;
    const hasSku = Array.from(candidateMap.values()).some((product) => (product.variants || []).some((variant) => variant.sku === spec.sku));
    if (!hasSku) addCandidates(await fetchRelationshipCandidateProducts(admin, `sku:${spec.sku}`, currencyCode).catch(() => []));
  }

  const addOns = new Map();
  for (const spec of specs) {
    const match = Array.from(candidateMap.values())
      .map((candidate) => ({
        product: candidate,
        variant: spec.sku
          ? (candidate.variants || []).find((variant) => variant.sku === spec.sku)
          : candidate.variants?.[0],
      }))
      .find((candidate) => candidate.variant?.id);
    if (!match) continue;
    addOns.set(spec.key, {
      ...spec,
      productId: match.product.id,
      title: match.product.title,
      handle: match.product.handle,
      variant: match.variant,
    });
  }
  return addOns;
}

async function fetchRelationshipCandidateProducts(admin, query, currencyCode) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseCustomMockRelationshipAddOns($query: String!) {
      products(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          title
          handle
          status
          variants(first: 10) {
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
  `, { query }, "Fetch relationship add-on products");
  return (data?.products?.nodes || [])
    .filter((product) => product.status !== "ARCHIVED")
    .map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      currencyCode,
      variants: (product.variants?.nodes || []).map((variant) => ({
        id: variant.id,
        title: variant.title,
        price: String(variant.price || "0"),
        sku: variant.sku,
        selectedOptions: variant.selectedOptions || [],
      })),
    }));
}

async function loadScenarioCustomers({ admin, scenario }) {
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseCustomMockCustomers($query: String!, $first: Int!) {
      customers(first: $first, query: $query) {
        nodes {
          id
          tags
        }
      }
    }
  `, {
    query: `tag:${RELTEST_CUSTOMER_TAG}`,
    first: 40,
  }, "Fetch RELTEST customers");
  const byKey = new Map((data?.customers?.nodes || []).map((customer) => [getCustomerKey(customer), customer]).filter(([key]) => key));
  const customers = [];

  for (const spec of scenario.customers) {
    let customer = byKey.get(spec.key);
    if (!customer) {
      customer = await createFallbackCustomer(admin, scenario, spec);
    }
    customers.push({
      ...spec,
      id: customer.id,
      tags: customer.tags || [],
      reusedExisting: byKey.has(spec.key),
    });
  }

  return customers;
}

function getCustomerKey(customer = {}) {
  return (customer.tags || [])
    .map((tag) => String(tag || "").trim())
    .find((tag) => /^reltest-customer-\d{3}$/i.test(tag))
    ?.toLowerCase() || null;
}

async function createFallbackCustomer(admin, scenario, spec) {
  const data = await shopifyGraphql(admin, `#graphql
    mutation ProductPulseCustomMockCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer {
          id
          tags
        }
        userErrors { field message }
      }
    }
  `, {
    input: {
      tags: ["ProductPulse", CUSTOM_TAG, scenario.scenarioTag, spec.key],
      note: `Fallback customer for ProductPulse custom mock scenario ${scenario.key}.`,
    },
  }, `Create fallback customer ${spec.key}`);
  assertNoUserErrors(data?.customerCreate?.userErrors, `Create fallback customer ${spec.key}`);
  return data.customerCreate.customer;
}

async function loadCustomerPurchaseHistories({ admin, customers }) {
  const histories = {};
  for (const customer of customers) {
    const data = await shopifyGraphql(admin, `#graphql
      query ProductPulseCustomMockCustomerHistory($id: ID!) {
        node(id: $id) {
          ... on Customer {
            id
            orders(first: 25, sortKey: PROCESSED_AT, reverse: false) {
              nodes {
                id
                name
                processedAt
                tags
                lineItems(first: 10) {
                  nodes {
                    title
                    quantity
                    variant {
                      sku
                      title
                      product {
                        id
                        title
                        handle
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, { id: customer.id }, `Fetch customer history ${customer.key}`);
    histories[customer.key] = (data?.node?.orders?.nodes || []).map((order) => ({
      name: order.name,
      processedAt: order.processedAt,
      tags: order.tags || [],
      items: (order.lineItems?.nodes || []).map((lineItem) => ({
        title: lineItem.variant?.product?.title || lineItem.title,
        handle: lineItem.variant?.product?.handle || null,
        productId: lineItem.variant?.product?.id || null,
        variantTitle: lineItem.variant?.title || null,
        sku: lineItem.variant?.sku || null,
        quantity: lineItem.quantity,
      })),
    }));
  }
  return histories;
}

async function loadOrCreateOrders({ admin, scenario, product, relationshipAddOns, customers, location, currencyCode }) {
  const existingOrders = await fetchScenarioOrders({ admin, scenario, product, includeOutcomes: false });
  const existingByRef = new Map(existingOrders.map((order) => [order.ref, order]));
  const customersByKey = new Map(customers.map((customer) => [customer.key, customer]));
  const orders = [];

  for (let index = 0; index < scenario.orderPlans.length; index += 1) {
    const plan = scenario.orderPlans[index];
    const existing = existingByRef.get(plan.ref);
    if (existing) {
      orders.push(existing);
      continue;
    }
    const customer = customersByKey.get(plan.customerKey);
    if (!customer?.id) throw new Error(`Missing customer ${plan.customerKey} for ${plan.ref}.`);
    const variant = pickVariant(product, plan.variantHint);
    const order = await createOrderWithRetry({
      admin,
      scenario,
      product,
      relationshipAddOns,
      plan,
      variant,
      customer,
      location,
      currencyCode,
      index,
    });
    orders.push(order);
    if (index < scenario.orderPlans.length - 1) await wait(getOrderCreateDelayMs());
  }
  return orders;
}

async function createOrderWithRetry(args) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await createOrder(args);
    } catch (error) {
      lastError = error;
      if (!isRetryableShopifyWriteError(error) || attempt === 4) break;
      await wait(Math.max(getOrderCreateDelayMs(), attempt * 15_000));
      const existingOrders = await fetchScenarioOrders({
        admin: args.admin,
        scenario: args.scenario,
        product: args.product,
        includeOutcomes: false,
      }).catch(() => []);
      const existing = existingOrders.find((order) => order.ref === args.plan.ref);
      if (existing) return existing;
    }
  }
  throw lastError;
}

function buildOrderLineItems({ variant, plan, relationshipAddOns }) {
  const lineItems = [{
    variantId: variant.id,
    quantity: Number(plan.quantity || 1),
    price: Number(variant.price || 0),
  }];
  for (const addOnSpec of plan.addOns || []) {
    const addOn = relationshipAddOns?.get?.(addOnSpec.key);
    if (!addOn?.variant?.id) continue;
    lineItems.push({
      variantId: addOn.variant.id,
      quantity: Number(addOnSpec.quantity || 1),
      price: Number(addOn.variant.price || 0),
      addOnKey: addOnSpec.key,
    });
  }
  return lineItems;
}

async function createOrder({ admin, scenario, product, relationshipAddOns, plan, variant, customer, location, currencyCode, index }) {
  const processedAt = new Date(Date.now() - plan.daysAgo * 24 * 60 * 60 * 1000 + index * 73 * 60 * 1000).toISOString();
  const lineItems = buildOrderLineItems({ variant, plan, relationshipAddOns });
  const total = lineItems.reduce((sum, lineItem) => sum + Number(lineItem.price || 0) * Number(lineItem.quantity || 1), 0);
  const orderInput = {
    currency: currencyCode,
    processedAt,
    financialStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    test: true,
    note: `ProductPulse custom mock order ${plan.ref}. ${plan.note}`,
    tags: [
      CUSTOM_ORDER_TAG,
      scenario.orderTag,
      scenario.scenarioTag,
      `ppcustom-order-${plan.ref}`,
      `ppcustom-customer-${plan.customerKey}`,
    ],
    customer: { toAssociate: { id: customer.id } },
    fulfillment: location?.id ? {
      locationId: location.id,
      notifyCustomer: false,
      shipmentStatus: "DELIVERED",
      trackingCompany: "Other",
      trackingNumber: `PPCUSTOM${String(index + 1).padStart(3, "0")}`,
    } : null,
    lineItems: lineItems.map((lineItem) => ({
      variantId: lineItem.variantId,
      quantity: lineItem.quantity,
      requiresShipping: false,
    })),
    transactions: [{
      kind: "SALE",
      status: "SUCCESS",
      test: true,
      gateway: "ProductPulse custom mock gateway",
      processedAt,
      amountSet: {
        shopMoney: {
          amount: total.toFixed(2),
          currencyCode,
        },
      },
    }],
  };

  const data = await shopifyGraphql(admin, `#graphql
    mutation ProductPulseCustomMockOrder(
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
          note
          tags
          customer { id }
          lineItems(first: $lineItemsFirst) {
            nodes {
              id
              title
              quantity
              variant {
                id
                title
                sku
                product {
                  id
                  title
                  handle
                }
              }
            }
          }
          fulfillments(first: $fulfillmentsFirst) {
            id
            fulfillmentLineItems(first: $fulfillmentLineItemsFirst) {
              nodes {
                id
                quantity
                lineItem { id }
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
    lineItemsFirst: 10,
    fulfillmentsFirst: 5,
    fulfillmentLineItemsFirst: 10,
  }, `Create order ${plan.ref}`);
  assertNoUserErrors(data?.orderCreate?.userErrors, `Create order ${plan.ref}`);
  return normalizeOrder(data.orderCreate.order, scenario, product);
}

async function fetchScenarioOrders({ admin, scenario, product, includeOutcomes }) {
  const data = await shopifyGraphql(admin, buildScenarioOrdersQuery(includeOutcomes), {
    query: `tag:${scenario.orderTag}`,
    first: 30,
    lineItemsFirst: 10,
    fulfillmentsFirst: 5,
    fulfillmentLineItemsFirst: 10,
    ...(includeOutcomes ? { returnsFirst: 8, returnLineItemsFirst: 8, refundLineItemsFirst: 8 } : {}),
  }, includeOutcomes ? "Fetch scenario orders with outcomes" : "Fetch scenario orders");
  return (data?.orders?.nodes || [])
    .map((order) => normalizeOrder(order, scenario, product))
    .filter((order) => order.ref)
    .sort((a, b) => scenario.orderPlans.findIndex((plan) => plan.ref === a.ref) - scenario.orderPlans.findIndex((plan) => plan.ref === b.ref));
}

function buildScenarioOrdersQuery(includeOutcomes) {
  return `#graphql
    query ProductPulseCustomMockOrders(
      $query: String!,
      $first: Int!,
      $lineItemsFirst: Int!,
      $fulfillmentsFirst: Int!,
      $fulfillmentLineItemsFirst: Int!${includeOutcomes ? `,
      $returnsFirst: Int!,
      $returnLineItemsFirst: Int!,
      $refundLineItemsFirst: Int!` : ""}
    ) {
      orders(first: $first, query: $query, sortKey: PROCESSED_AT, reverse: false) {
        nodes {
          id
          name
          processedAt
          note
          tags
          customer { id }
          lineItems(first: $lineItemsFirst) {
            nodes {
              id
              title
              quantity
              variant {
                id
                title
                sku
                product {
                  id
                  title
                  handle
                }
              }
            }
          }
          fulfillments(first: $fulfillmentsFirst) {
            id
            fulfillmentLineItems(first: $fulfillmentLineItemsFirst) {
              nodes {
                id
                quantity
                lineItem { id }
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
                lineItem { id }
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
                      lineItem { id }
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

function normalizeOrder(order, scenario, product) {
  const ref = (order.tags || [])
    .map((tag) => String(tag || "").match(/^ppcustom-order-(.+)$/)?.[1])
    .find(Boolean);
  const variantsById = new Map((product.variants || []).map((variant) => [variant.id, variant]));
  const lineItems = (order.lineItems?.nodes || []).map((lineItem) => {
    const variant = variantsById.get(lineItem.variant?.id);
    const fulfillmentLineItem = (order.fulfillments || [])
      .flatMap((fulfillment) => fulfillment.fulfillmentLineItems?.nodes || [])
      .find((item) => item.lineItem?.id === lineItem.id);
    return {
      id: lineItem.id,
      title: lineItem.title,
      quantity: lineItem.quantity,
      variantId: lineItem.variant?.id,
      variantTitle: lineItem.variant?.title || variant?.title || null,
      sku: lineItem.variant?.sku || variant?.sku || null,
      fulfillmentLineItemId: fulfillmentLineItem?.id || null,
      productId: lineItem.variant?.product?.id || product.id,
      productTitle: lineItem.variant?.product?.title || product.title,
      handle: lineItem.variant?.product?.handle || product.handle,
      unitPrice: Number(variant?.price || 0),
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
          returnReason: returnLineItem.returnReason || null,
          note: returnLineItem.returnReasonNote || returnLineItem.customerNote || null,
          quantity: returnLineItem.quantity || 1,
          productId: lineItem.productId,
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
          note: refund.note || null,
          quantity: refundLineItem.quantity || 1,
          productId: lineItem.productId,
        };
      })
      .filter(Boolean)
  ));
  return {
    id: order.id,
    name: order.name,
    ref,
    processedAt: order.processedAt,
    note: order.note,
    tags: order.tags || [],
    customerId: order.customer?.id || null,
    lineItems,
    existingOutcomes: {
      returns: existingReturns,
      refunds: existingRefunds,
    },
  };
}

function getConnectionNodes(connection) {
  if (Array.isArray(connection?.nodes)) return connection.nodes;
  if (Array.isArray(connection)) return connection;
  return [];
}

function mergeOrdersByRef(...orderGroups) {
  const merged = new Map();
  for (const orders of orderGroups) {
    for (const order of orders || []) {
      if (!order?.ref) continue;
      const existing = merged.get(order.ref);
      if (!existing) {
        merged.set(order.ref, order);
        continue;
      }
      const existingOutcomeCount = (existing.existingOutcomes?.returns?.length || 0) + (existing.existingOutcomes?.refunds?.length || 0);
      const nextOutcomeCount = (order.existingOutcomes?.returns?.length || 0) + (order.existingOutcomes?.refunds?.length || 0);
      merged.set(order.ref, nextOutcomeCount >= existingOutcomeCount ? order : existing);
    }
  }
  return Array.from(merged.values());
}

async function createScenarioOutcomes({ admin, scenario, product, orders, currencyCode }) {
  const ordersByRef = new Map(orders.map((order) => [order.ref, order]));
  const returns = orders.flatMap((order) => order.existingOutcomes?.returns || []);
  const refunds = orders.flatMap((order) => order.existingOutcomes?.refunds || []);
  const existingOutcomeKeys = new Set([
    ...returns.map((outcome) => `return:${outcome.lineItemId}`),
    ...refunds.map((outcome) => `refund:${outcome.lineItemId}`),
  ]);

  for (const plan of scenario.outcomePlans) {
    const order = ordersByRef.get(plan.orderRef);
    if (!order) throw new Error(`Missing order ${plan.orderRef} for ${plan.type}.`);
    const lineItem = order.lineItems.find((item) => item.productId === product.id || item.handle === product.handle) || order.lineItems[0];
    if (!lineItem) throw new Error(`Missing line item for ${plan.orderRef}.`);
    const key = plan.type === "return"
      ? `return:${lineItem.id}`
      : `refund:${lineItem.id}`;
    if (existingOutcomeKeys.has(key)) continue;

    if (plan.type === "return") {
      if (!lineItem.fulfillmentLineItemId) throw new Error(`Order ${order.name} has no fulfillment line item for return.`);
      const result = await createReturn(admin, order, lineItem, plan);
      returns.push({
        id: result.id,
        orderId: order.id,
        orderName: order.name,
        lineItemId: lineItem.id,
        returnReason: plan.returnReason,
        note: plan.note,
        quantity: Math.min(1, lineItem.quantity || 1),
        productId: product.id,
        theme: plan.theme,
      });
      existingOutcomeKeys.add(key);
    } else if (plan.type === "refund") {
      const result = await createRefund(admin, order, lineItem, plan, currencyCode);
      refunds.push({
        id: result.id,
        orderId: order.id,
        orderName: order.name,
        lineItemId: lineItem.id,
        note: plan.note,
        quantity: Math.min(plan.quantity || 1, lineItem.quantity || 1),
        productId: product.id,
        theme: plan.theme,
      });
      existingOutcomeKeys.add(key);
    }
    await wait(500);
  }

  return {
    returns: dedupeOutcomeList(returns),
    refunds: dedupeOutcomeList(refunds),
  };
}

function normalizeOutcomeNote(note) {
  return String(note || "").replace(/\s+/g, " ").trim().slice(0, 96);
}

function dedupeOutcomeList(outcomes) {
  const seen = new Set();
  return outcomes.filter((outcome) => {
    const key = outcome.id || `${outcome.orderId}:${outcome.lineItemId}:${normalizeOutcomeNote(outcome.note)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function createReturn(admin, order, lineItem, plan) {
  const data = await shopifyGraphql(admin, `#graphql
    mutation ProductPulseCustomMockReturn($returnInput: ReturnInput!) {
      returnCreate(returnInput: $returnInput) {
        return { id }
        userErrors { field message }
      }
    }
  `, {
    returnInput: {
      orderId: order.id,
      returnLineItems: [{
        fulfillmentLineItemId: lineItem.fulfillmentLineItemId,
        quantity: Math.min(1, lineItem.quantity || 1),
        returnReason: plan.returnReason,
        returnReasonNote: plan.note,
      }],
    },
  }, `Create return ${order.name}`);
  assertNoUserErrors(data?.returnCreate?.userErrors, `Create return ${order.name}`);
  return data.returnCreate.return;
}

async function createRefund(admin, order, lineItem, plan, currencyCode) {
  const data = await shopifyGraphql(admin, `#graphql
    mutation ProductPulseCustomMockRefund($input: RefundInput!, $idempotencyKey: String!) {
      refundCreate(input: $input) @idempotent(key: $idempotencyKey) {
        refund {
          id
          note
        }
        userErrors { field message }
      }
    }
  `, {
    idempotencyKey: randomUUID(),
    input: {
      orderId: order.id,
      note: plan.note,
      notify: false,
      currency: currencyCode,
      refundLineItems: [{
        lineItemId: lineItem.id,
        quantity: Math.min(plan.quantity || 1, lineItem.quantity || 1),
        restockType: "NO_RESTOCK",
      }],
      transactions: [],
    },
  }, `Create refund ${order.name}`);
  assertNoUserErrors(data?.refundCreate?.userErrors, `Create refund ${order.name}`);
  return data.refundCreate.refund;
}

async function appendScenarioReviews({ prisma, shop, scenario, product }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
  }).catch(() => null);
  const config = source?.config || {};
  const existingFilePath = String(config.normalizedFilePath || "").trim();
  const existingRows = existingFilePath
    ? await readNormalizedCsvRows(existingFilePath).catch(() => [])
    : [];
  const previousRowCount = existingRows.length;
  const baseRows = existingRows.filter((row) => row.source_product_id !== scenario.productKey);
  const renumberedBaseRows = renumberCsvRows(baseRows, 2);
  const scenarioRows = buildScenarioReviewRows({
    scenario,
    product,
    startRow: renumberedBaseRows.length + 2,
  });
  const combinedRows = [...renumberedBaseRows, ...scenarioRows];
  const text = serializeCsvRows(combinedRows);
  const checksum = createHash("sha256").update(text).digest("hex");
  const storageRoot = process.env.PRODUCT_PULSE_CSV_STORAGE_DIR
    || path.join(process.cwd(), ".cache", "product-pulse", "csv-reviews");
  const shopDir = path.join(storageRoot, sanitizeStorageSegment(shop));
  const fileName = `custom-reviews-${scenario.key}-${new Date().toISOString().replace(/[^0-9]+/g, "").slice(0, 14)}-${checksum.slice(0, 8)}.normalized.csv`;
  const filePath = path.join(shopDir, fileName);
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
        displayFileName: CUSTOM_REVIEW_SOURCE,
        normalizedFileName: fileName,
        normalizedFilePath: filePath,
        normalizedRowCount: combinedRows.length,
        importId: `custom-${scenario.key}`,
        storageKey: sanitizeStorageSegment(shop),
        checksum,
        uploadedAt: new Date().toISOString(),
        generatedBy: "productpulse-custom-mock-product",
        previousNormalizedFilePath: existingFilePath || null,
        customMockProduct: {
          scenarioKey: scenario.key,
          productKey: scenario.productKey,
          productTitle: product.title,
          shopifyProductId: product.id,
          addedRows: scenarioRows.length,
        },
      },
    },
    update: {
      connected: true,
      active: true,
      available: true,
      health: "connected",
      lastSyncedAt: new Date(),
      config: {
        ...(config || {}),
        displayFileName: config.displayFileName || CUSTOM_REVIEW_SOURCE,
        normalizedFileName: fileName,
        normalizedFilePath: filePath,
        normalizedRowCount: combinedRows.length,
        importId: `custom-${scenario.key}`,
        storageKey: sanitizeStorageSegment(shop),
        checksum,
        uploadedAt: new Date().toISOString(),
        generatedBy: "productpulse-custom-mock-product",
        previousNormalizedFilePath: existingFilePath || null,
        customMockProduct: {
          scenarioKey: scenario.key,
          productKey: scenario.productKey,
          productTitle: product.title,
          shopifyProductId: product.id,
          addedRows: scenarioRows.length,
        },
      },
    },
  });

  await appendMockDatasetMetadata({ prisma, shop, scenario, product, reviewSource: { filePath, fileName, rowCount: combinedRows.length } });

  return {
    filePath,
    fileName,
    checksum,
    previousFilePath: existingFilePath || null,
    previousRowCount,
    rowCount: combinedRows.length,
    addedRows: scenarioRows.length,
    scenarioRows,
  };
}

async function readNormalizedCsvRows(filePath) {
  const text = await readFile(filePath, "utf8");
  const parsed = parseCsvText(text);
  return parsed.rows.map((row) => Object.fromEntries(NORMALIZED_CSV_COLUMNS.map((column) => [column, row.values[column] ?? ""])));
}

function parseCsvText(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("CSV file is empty.");
  const records = parseCsvRecords(text);
  if (records.length < 2) throw new Error("CSV file must include headers and at least one row.");
  const headers = records[0].map((header, index) => String(header || "").replace(/\s+/g, " ").trim() || `column_${index + 1}`);
  const rows = records.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row, rowIndex) => ({
      sourceRow: rowIndex + 2,
      values: headers.reduce((values, header, index) => {
        values[header] = row[index] == null ? "" : String(row[index]);
        return values;
      }, {}),
    }));
  return { headers, rows };
}

function parseCsvRecords(text) {
  const records = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      records.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.replace(/\r$/, ""));
  if (row.length > 1 || row[0].trim()) records.push(row);
  return records;
}

function serializeCsvRows(rows) {
  return [
    NORMALIZED_CSV_COLUMNS.join(","),
    ...rows.map((row) => NORMALIZED_CSV_COLUMNS.map((column) => escapeCsvCell(row[column])).join(",")),
  ].join("\n");
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function renumberCsvRows(rows, startRow) {
  return rows.map((row, index) => ({
    ...row,
    source_row: startRow + index,
  }));
}

export function buildScenarioReviewRows({ scenario, product, startRow = 2 }) {
  return scenario.reviews.map((review, index) => ({
    source_row: startRow + index,
    product_handle: product.handle,
    shopify_product_id: product.id,
    rating: review.rating,
    review_title: review.title,
    review_body: review.body,
    review_date: review.date,
    reviewer_name: review.reviewer,
    review_status: "published",
    source_product_id: scenario.productKey,
  }));
}

async function appendMockDatasetMetadata({ prisma, shop, scenario, product, reviewSource }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "mockDataset" } },
  }).catch(() => null);
  if (!source) return;
  const config = source.config || {};
  const existingBatches = Array.isArray(config.customMockProductBatches) ? config.customMockProductBatches : [];
  const nextBatches = [
    ...existingBatches.filter((batch) => batch.scenarioKey !== scenario.key),
    {
      scenarioKey: scenario.key,
      productKey: scenario.productKey,
      productTitle: product.title,
      shopifyProductId: product.id,
      handle: product.handle,
      generatedAt: new Date().toISOString(),
      orderCount: scenario.orderPlans.length,
      returnCount: scenario.outcomePlans.filter((plan) => plan.type === "return").length,
      refundCount: scenario.outcomePlans.filter((plan) => plan.type === "refund").length,
      reviewCount: scenario.reviews.length,
      csvReviewFilePath: reviewSource.filePath,
      csvReviewFileName: reviewSource.fileName,
      csvReviewRowCount: reviewSource.rowCount,
    },
  ].slice(-10);
  await prisma.productPulseSource.update({
    where: { shop_sourceKey: { shop, sourceKey: "mockDataset" } },
    data: {
      lastSyncedAt: new Date(),
      config: {
        ...config,
        customMockProductBatches: nextBatches,
      },
    },
  });
}

async function upsertPreliminarySnapshot({ prisma, shop, scenario, product, orders, outcomes, reviewSource }) {
  const summary = calculateScenarioPlanSummary(scenario);
  const soldUnits = orders
    .flatMap((order) => order.lineItems)
    .filter((lineItem) => lineItem.productId === product.id || lineItem.handle === product.handle)
    .reduce((sum, lineItem) => sum + Number(lineItem.quantity || 0), 0);
  const refundUnits = outcomes.refunds.reduce((sum, outcome) => sum + Number(outcome.quantity || 0), 0);
  const unitPrice = Number(product.variants?.[0]?.price || 0);
  const metrics = {
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags || scenario.product.tags,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
    })),
    soldUnits,
    returnUnits: outcomes.returns.length,
    refundUnits,
    refundAmount: Math.round(refundUnits * unitPrice * 100) / 100,
    returnRate: soldUnits ? Math.round((outcomes.returns.length / soldUnits) * 1000) / 10 : 0,
    refundRate: soldUnits ? Math.round((refundUnits / soldUnits) * 1000) / 10 : 0,
    reviewCount: scenario.reviews.length,
    negativeReviewCount: summary.plannedNegativeReviews,
    reviewRating: Math.round((scenario.reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / scenario.reviews.length) * 10) / 10,
    csvReviewCount: scenario.reviews.length,
    signalCount: outcomes.returns.length + refundUnits + scenario.reviews.length,
    sourceCoverage: ["Shopify products", "Shopify orders", "Shopify returns", "Shopify refunds", "CSV reviews"],
    customMockScenario: {
      scenarioKey: scenario.key,
      productKey: scenario.productKey,
      expectedFindings: scenario.product.expectedFindings,
      expectedActions: scenario.product.expectedActions,
      csvReviewFilePath: reviewSource.filePath,
    },
  };

  return prisma.productRiskSnapshot.upsert({
    where: { shop_productGid: { shop, productGid: product.id } },
    create: {
      shop,
      productGid: product.id,
      productTitle: product.title,
      handle: product.handle,
      riskScore: 74,
      impactScore: 22,
      confidence: 78,
      primaryIssue: scenario.product.preliminaryIssue,
      sourceCoverage: metrics.sourceCoverage,
      metrics,
    },
    update: {
      productTitle: product.title,
      handle: product.handle,
      riskScore: 74,
      impactScore: 22,
      confidence: 78,
      primaryIssue: scenario.product.preliminaryIssue,
      sourceCoverage: metrics.sourceCoverage,
      metrics,
      updatedAt: new Date(),
    },
  });
}

async function addScenarioProductToWatchlist({ watchlistModule, shop, product, snapshot }) {
  if (!watchlistModule?.addWatchedProductForShop) {
    return { status: "skipped", message: "Watchlist module unavailable." };
  }
  return watchlistModule.addWatchedProductForShop(shop, {
    productGid: product.id,
    title: product.title,
    handle: product.handle,
    sku: product.variants?.[0]?.sku || "",
    imageAlt: product.title,
    riskScore: snapshot.riskScore,
  });
}

async function runDeepDiagnosis({ prisma, diagnosisModule, shop, admin, snapshot }) {
  const job = await prisma.catalogSignalJob.create({
    data: {
      shop,
      kind: CUSTOM_DIAGNOSIS_JOB_KIND,
      source: `Running scripted deep diagnosis - ${snapshot.productTitle}`,
      status: "Running",
      progress: 10,
      payload: {
        productId: snapshot.productGid,
        productGid: snapshot.productGid,
        handle: snapshot.handle,
        productTitle: snapshot.productTitle,
        queuedAt: new Date().toISOString(),
        launchedBy: "scripts/seed-custom-mock-product.js",
      },
    },
  });

  try {
    const result = await diagnosisModule.runDetailedProductDiagnosis({
      shop,
      jobId: job.id,
      admin,
      snapshot,
    });
    await prisma.catalogSignalJob.update({
      where: { id: job.id },
      data: {
        status: "Completed",
        progress: 100,
        source: `Scripted deep diagnosis completed - ${snapshot.productTitle}`,
        finishedAt: new Date(),
        payload: {
          ...(job.payload || {}),
          result,
        },
      },
    });
    return result;
  } catch (error) {
    await prisma.catalogSignalJob.update({
      where: { id: job.id },
      data: {
        status: "Failed",
        progress: 100,
        source: `Scripted deep diagnosis failed - ${snapshot.productTitle}`,
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}

async function validateScenarioSeed({ prisma, shop, scenario, product, orders, outcomes, reviewSource, watchlist, diagnosis }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
  });
  const snapshot = await prisma.productRiskSnapshot.findUnique({
    where: { shop_productGid: { shop, productGid: product.id } },
  });
  const latestDiagnosis = await prisma.productDiagnosis.findFirst({
    where: { shop, productGid: product.id, status: "Completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
  });
  const watchedItem = await prisma.productWatchlistItem.findUnique({
    where: { shop_productGid: { shop, productGid: product.id } },
  });
  const watchBaseline = await prisma.productWatchActivity.findFirst({
    where: { shop, productGid: product.id, eventType: "watch_change_report" },
    orderBy: { createdAt: "asc" },
  });
  const orderRefs = new Set(orders.map((order) => order.ref));
  const planned = calculateScenarioPlanSummary(scenario);
  const productReturns = outcomes.returns.filter((outcome) => outcome.productId === product.id);
  const productRefunds = outcomes.refunds.filter((outcome) => outcome.productId === product.id);
  const productLineItems = orders
    .flatMap((order) => order.lineItems)
    .filter((lineItem) => lineItem.productId === product.id || lineItem.handle === product.handle);
  const refundDuplicateLineItems = countDuplicateOutcomeLineItems(productRefunds);
  const actual = {
    productExists: Boolean(product.id),
    variantCount: product.variants.length,
    orders: orders.length,
    uniqueOrderRefs: orderRefs.size,
    ordersWithCustomers: orders.filter((order) => order.customerId).length,
    units: productLineItems.reduce((sum, lineItem) => sum + Number(lineItem.quantity || 0), 0),
    returns: productReturns.length,
    returnUnits: productReturns.reduce((sum, outcome) => sum + Number(outcome.quantity || 0), 0),
    refunds: productRefunds.length,
    refundUnits: productRefunds.reduce((sum, outcome) => sum + Number(outcome.quantity || 0), 0),
    refundDuplicateLineItems,
    csvRowsForProduct: reviewSource.scenarioRows.length,
    csvSourceRowCount: Number(source?.config?.normalizedRowCount || 0),
    snapshotExists: Boolean(snapshot),
    watchlistExists: Boolean(watchedItem),
    watchlistBaselineExists: Boolean(watchBaseline || watchlist?.baseline?.reportCount),
    diagnosisExists: Boolean(latestDiagnosis || diagnosis?.diagnosisId),
    diagnosisId: latestDiagnosis?.id || diagnosis?.diagnosisId || null,
    diagnosisRiskScore: latestDiagnosis?.riskScore ?? diagnosis?.riskScore ?? null,
    diagnosisConfidence: latestDiagnosis?.confidence ?? diagnosis?.confidence ?? null,
  };
  const checks = [
    { id: "product", ok: actual.productExists && actual.variantCount === scenario.product.variants.length, detail: `${actual.variantCount} variants` },
    { id: "orders", ok: actual.orders === planned.plannedOrders && actual.uniqueOrderRefs === planned.plannedOrders, detail: `${actual.orders}/${planned.plannedOrders} orders` },
    { id: "customers", ok: actual.ordersWithCustomers === planned.plannedOrders, detail: `${actual.ordersWithCustomers}/${planned.plannedOrders} orders have customers` },
    { id: "returns", ok: actual.returns === planned.plannedReturns, detail: `${actual.returns}/${planned.plannedReturns} returns` },
    { id: "refunds", ok: actual.refunds === planned.plannedRefunds, detail: `${actual.refunds}/${planned.plannedRefunds} refunds` },
    { id: "refund_units", ok: actual.refundUnits === planned.plannedRefundUnits, detail: `${actual.refundUnits}/${planned.plannedRefundUnits} refunded units` },
    { id: "refund_duplicates", ok: actual.refundDuplicateLineItems === 0, detail: `${actual.refundDuplicateLineItems} duplicate refunded line items` },
    { id: "csv_reviews", ok: actual.csvRowsForProduct === planned.plannedReviews && actual.csvSourceRowCount === reviewSource.rowCount, detail: `${actual.csvRowsForProduct} rows for product, ${actual.csvSourceRowCount} total` },
    { id: "snapshot", ok: actual.snapshotExists, detail: snapshot?.id || "missing" },
    { id: "watchlist", ok: actual.watchlistExists && actual.watchlistBaselineExists, detail: `${watchedItem?.id || "missing"} baseline=${actual.watchlistBaselineExists ? "yes" : "no"}` },
    { id: "diagnosis", ok: Boolean(actual.diagnosisExists), detail: actual.diagnosisId || "missing" },
  ];
  return {
    ok: checks.every((check) => check.ok),
    checks,
    actual,
  };
}

function countDuplicateOutcomeLineItems(outcomes) {
  const seen = new Set();
  let duplicates = 0;
  for (const outcome of outcomes) {
    const key = `${outcome.orderId || ""}:${outcome.lineItemId || ""}`;
    if (!key.trim()) continue;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

async function saveScenarioReport({
  shop,
  scenario,
  product,
  relationshipAddOns,
  customers,
  purchaseHistoryBefore,
  purchaseHistoryAfter,
  orders,
  outcomes,
  reviewSource,
  watchlist,
  snapshot,
  diagnosis,
  validation,
}) {
  const root = process.env.PRODUCT_PULSE_CUSTOM_MOCK_DIR
    || path.join(process.cwd(), ".cache", "product-pulse", "custom-mock-products");
  const shopDir = path.join(root, sanitizeStorageSegment(shop));
  const reportPath = path.join(shopDir, `${scenario.key}.report.json`);
  const latestDbDiagnosis = diagnosis?.diagnosisId || null;
  const report = {
    shop,
    generatedAt: new Date().toISOString(),
    scenarioKey: scenario.key,
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      variants: product.variants,
      relationshipAddOns: summarizeRelationshipAddOns(relationshipAddOns),
      expectedFindings: scenario.product.expectedFindings,
      expectedActions: scenario.product.expectedActions,
    },
    planned: calculateScenarioPlanSummary(scenario),
    customers: customers.map((customer) => ({
      key: customer.key,
      id: customer.id,
      reusedExisting: customer.reusedExisting,
      role: customer.role,
      purchaseHistoryBefore: summarizeHistory(purchaseHistoryBefore[customer.key] || []),
      purchaseHistoryAfter: summarizeHistory(purchaseHistoryAfter[customer.key] || []),
    })),
    orders: orders.map((order) => ({
      ref: order.ref,
      id: order.id,
      name: order.name,
      customerId: order.customerId,
      processedAt: order.processedAt,
      lineItems: order.lineItems,
    })),
    outcomes,
    reviews: {
      filePath: reviewSource.filePath,
      previousFilePath: reviewSource.previousFilePath,
      previousRowCount: reviewSource.previousRowCount,
      rowCount: reviewSource.rowCount,
      addedRows: reviewSource.addedRows,
      productRows: reviewSource.scenarioRows,
    },
    watchlist,
    snapshot: {
      id: snapshot.id,
      riskScore: snapshot.riskScore,
      confidence: snapshot.confidence,
      primaryIssue: snapshot.primaryIssue,
    },
    diagnosis: {
      diagnosisId: latestDbDiagnosis,
      result: diagnosis,
    },
    validation,
  };
  await mkdir(shopDir, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { reportPath, report };
}

function summarizeRelationshipAddOns(relationshipAddOns) {
  if (!(relationshipAddOns instanceof Map)) return [];
  return Array.from(relationshipAddOns.values()).map((addOn) => ({
    key: addOn.key,
    sku: addOn.sku,
    productId: addOn.productId,
    title: addOn.title,
    handle: addOn.handle,
    variantId: addOn.variant?.id || null,
    variantTitle: addOn.variant?.title || null,
  }));
}

function summarizeHistory(orders) {
  return orders.map((order) => ({
    name: order.name,
    processedAt: order.processedAt,
    productTitles: order.items.map((item) => item.title),
    totalUnits: order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
  }));
}

function pickVariant(product, hint) {
  const normalizedHint = String(hint || "").toLowerCase();
  const matched = (product.variants || []).find((variant) => String(variant.title || "").toLowerCase().includes(normalizedHint)
    || String(variant.sku || "").toLowerCase().includes(normalizedHint));
  if (matched) return matched;
  if (product.variants?.[0]) return product.variants[0];
  throw new Error(`Product ${product.title} has no variants.`);
}

function stripNullish(value) {
  if (Array.isArray(value)) return value.map(stripNullish);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => [key, stripNullish(item)]));
}

function sanitizeStorageSegment(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "unknown";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOrderCreateDelayMs() {
  const configured = Number(process.env.PRODUCT_PULSE_CUSTOM_ORDER_DELAY_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return DEFAULT_ORDER_CREATE_DELAY_MS;
}

function isRetryableShopifyWriteError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("too many attempts")
    || message.includes("throttled")
    || message.includes("temporarily unavailable")
    || message.includes("timeout")
    || message.includes("429");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
