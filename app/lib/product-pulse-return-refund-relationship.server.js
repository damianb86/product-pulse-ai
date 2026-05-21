import prisma from "../db.server";

export const RETURN_REFUND_RELATIONSHIP_BUCKETS = Object.freeze({
  returnedAndRefunded: "returned_and_refunded",
  returnedNotRefunded: "returned_not_refunded",
  refundedWithoutReturn: "refunded_without_return",
  exchangeOrReplacement: "exchange_or_replacement",
  pendingReturnResolution: "pending_return_resolution",
  unattributedRefund: "unattributed_refund",
  noReturnNoRefund: "no_return_no_refund",
});

export const RETURN_REFUND_MATCH_CONFIDENCE = Object.freeze({
  exactLineItem: 1,
  sameOrderProductVariant: 0.8,
  singleProductOrder: 0.6,
  weakOrderLevel: 0.3,
  unattributed: 0,
});

const SUMMARY_VERSION = 1;
const AMOUNT_MATCH_TOLERANCE = 0.02;
const HEURISTIC_DATE_WINDOW_DAYS = 45;

export function buildReturnRefundRelationshipSummary({
  shop = null,
  productId,
  products = [],
  events = [],
  sales = [],
  returns = [],
  refunds = [],
} = {}) {
  const summaries = buildReturnRefundRelationshipSummaries({
    shop,
    products,
    events,
    sales,
    returns,
    refunds,
  });
  return summaries.get(productId) || createEmptyRelationshipSummary(productId);
}

export function buildReturnRefundRelationshipSummaries({
  shop = null,
  products = [],
  events = [],
  sales = [],
  returns = [],
  refunds = [],
} = {}) {
  const productIndex = buildProductIndex(products);
  const sourceEvents = normalizeSourceEvents({ shop, events, sales, returns, refunds, productIndex });
  const saleEvents = sourceEvents.filter((event) => event.type === "sale");
  const returnEvents = sourceEvents.filter((event) => event.type === "return");
  const refundEvents = sourceEvents.filter((event) => event.type === "refund");
  const relationshipState = buildRelationshipState({ productIndex, saleEvents });

  returnEvents.forEach((event) => applyReturnEventToRelationshipState(relationshipState, event));
  refundEvents.forEach((event) => applyRefundEventToRelationshipState(relationshipState, event));

  const productIds = new Set([
    ...productIndex.byId.keys(),
    ...sourceEvents.map((event) => event.productId).filter(Boolean),
    ...relationshipState.lines.map((line) => line.productId).filter(Boolean),
  ]);

  const summaries = new Map();
  productIds.forEach((productId) => {
    summaries.set(productId, finalizeProductRelationshipSummary(productId, relationshipState));
  });
  return summaries;
}

export async function getProductReturnRefundRelationshipSummaryForShop(shop, productId, db = prisma) {
  if (!shop || !productId) return null;
  const snapshot = await db.productRiskSnapshot.findFirst({
    where: {
      shop,
      OR: [
        { productGid: productId },
        { handle: productId },
      ],
    },
    select: {
      productGid: true,
      handle: true,
      metrics: true,
    },
  });
  return snapshot?.metrics?.returnRefundRelationshipSummary || null;
}

function buildProductIndex(products = []) {
  const byId = new Map();
  const productIdByVariantId = new Map();

  products.forEach((product) => {
    if (!product?.id) return;
    byId.set(product.id, product);
    getArray(product.variants).forEach((variant) => {
      if (variant?.id) productIdByVariantId.set(variant.id, product.id);
    });
  });

  return { byId, productIdByVariantId };
}

function normalizeSourceEvents({ shop, events = [], sales = [], returns = [], refunds = [], productIndex }) {
  return [
    ...getArray(events),
    ...getArray(sales).map((event) => ({ ...event, type: "sale" })),
    ...getArray(returns).map((event) => ({ ...event, type: "return" })),
    ...getArray(refunds).map((event) => ({ ...event, type: "refund" })),
  ]
    .map((event, index) => normalizeRelationshipEvent(event, index, productIndex))
    .filter((event) => event.type && (!shop || !event.shop || event.shop === shop));
}

function normalizeRelationshipEvent(event = {}, index, productIndex) {
  const type = normalizeEventType(event.type);
  const variantId = stringOrNull(event.variantId);
  const productId = stringOrNull(event.productId)
    || productIndex.productIdByVariantId.get(variantId)
    || null;
  const lineItemId = stringOrNull(event.lineItemId || event.orderLineItemId || (type === "sale" ? event.id : null));
  const occurredAt = toIso(event.occurredAt || event.createdAt || event.processedAt || event.updatedAt || event.orderDate);

  return {
    ...event,
    type,
    id: stringOrNull(event.id) || `${type || "event"}:${index}`,
    shop: stringOrNull(event.shop),
    productId,
    variantId,
    orderId: stringOrNull(event.orderId),
    lineItemId,
    orderDate: toIso(event.orderDate),
    occurredAt,
    quantity: Math.max(0, number(event.quantity || event.processedQuantity || event.refundedQuantity || 0)),
    amount: Math.max(0, number(event.amount || event.totalRefundedAmount || 0)),
    reason: cleanText(event.reason || event.reasonLabel || event.reasonHandle || event.restockType),
    note: cleanText(event.note || event.reasonNote || event.customerNote),
    status: cleanText(event.status || event.returnStatus || event.displayFinancialStatus),
    fallbackSource: cleanText(event.fallbackSource),
    refundId: stringOrNull(event.refundId),
    returnId: stringOrNull(event.returnId),
    refundLineItemId: stringOrNull(event.refundLineItemId || (type === "refund" ? event.id : null)),
    returnLineItemId: stringOrNull(event.returnLineItemId || (type === "return" ? event.id : null)),
    processedQuantity: Math.max(0, number(event.processedQuantity || 0)),
    refundedQuantity: Math.max(0, number(event.refundedQuantity || 0)),
    selectedOptions: getArray(event.selectedOptions || event.variantOptions),
  };
}

function normalizeEventType(type) {
  const normalized = String(type || "").toLowerCase();
  if (["sale", "order", "order_line_item"].includes(normalized)) return "sale";
  if (["return", "return_line_item"].includes(normalized)) return "return";
  if (["refund", "refund_line_item"].includes(normalized)) return "refund";
  return "";
}

function buildRelationshipState({ productIndex, saleEvents }) {
  const state = {
    productIndex,
    lines: [],
    lineByExact: new Map(),
    linesByOrder: new Map(),
    linesByOrderVariant: new Map(),
    linesByOrderProduct: new Map(),
    linesByProduct: new Map(),
    orderContexts: new Map(),
    productExtras: new Map(),
  };

  saleEvents.forEach((event, index) => {
    const productId = event.productId;
    if (!productId) return;
    const orderId = event.orderId || `unknown-order:${productId}:${index}`;
    const lineItemId = event.lineItemId || event.id || `unknown-line:${productId}:${index}`;
    const line = {
      key: `${orderId}:${lineItemId}`,
      productId,
      variantId: event.variantId || null,
      orderId,
      lineItemId,
      soldUnits: event.quantity || 0,
      soldRevenue: event.amount || 0,
      saleDate: event.orderDate || event.occurredAt || null,
      returns: [],
      refunds: [],
    };
    state.lines.push(line);
    addToMapArray(state.lineByExact, exactLineKey(orderId, lineItemId), line);
    if (event.variantId) addToMapArray(state.linesByOrderVariant, orderVariantKey(orderId, event.variantId), line);
    addToMapArray(state.linesByOrderProduct, orderProductKey(orderId, productId), line);
    addToMapArray(state.linesByOrder, orderId, line);
    addToMapArray(state.linesByProduct, productId, line);

    const order = getOrderContext(state, orderId);
    order.productIds.add(productId);
    order.lineKeys.add(line.key);
  });

  return state;
}

function applyReturnEventToRelationshipState(state, event) {
  const match = matchOperationalEventToLine(state, event);
  if (match.line) {
    match.line.returns.push({
      event,
      quantity: operationalQuantity(event),
      confidence: match.confidence,
      bucketHint: getReturnEventBucketHint(event),
      reasonCategory: classifyRelationshipReason(event),
    });
    return;
  }

  const productIds = getUnattributedProductIdsForEvent(state, event);
  productIds.forEach((productId) => {
    const extras = getProductExtras(state, productId);
    extras.unmatchedReturns.push({ event, confidence: RETURN_REFUND_MATCH_CONFIDENCE.unattributed });
    extras.matchConfidences.push(RETURN_REFUND_MATCH_CONFIDENCE.unattributed);
    extras.unknownCount += 1;
  });
}

function applyRefundEventToRelationshipState(state, event) {
  const match = matchOperationalEventToLine(state, event);
  if (match.line) {
    match.line.refunds.push({
      event,
      quantity: operationalQuantity(event),
      amount: number(event.amount),
      confidence: match.confidence,
      reasonCategory: classifyRelationshipReason(event),
    });
    return;
  }

  const productIds = getUnattributedProductIdsForEvent(state, event);
  productIds.forEach((productId) => {
    const extras = getProductExtras(state, productId);
    extras.unattributedRefundAmount += number(event.amount || event.totalRefundedAmount);
    extras.unattributedRefundOrders.add(event.orderId || event.id);
    extras.unattributedRefundEvents.push(event);
    extras.matchConfidences.push(RETURN_REFUND_MATCH_CONFIDENCE.unattributed);
    extras.unknownCount += 1;
  });
}

function matchOperationalEventToLine(state, event) {
  const orderId = event.orderId;
  const lineItemId = event.lineItemId;
  const orderLines = orderId ? getArray(state.linesByOrder.get(orderId)) : [];
  const isOrderLevelRefund = event.type === "refund" && event.fallbackSource === "order_financial_status";

  if (isOrderLevelRefund && orderLines.length > 1) {
    return { line: null, confidence: RETURN_REFUND_MATCH_CONFIDENCE.unattributed, strategy: "unattributed_order_level_refund" };
  }

  if (orderId && lineItemId) {
    const exactMatches = getArray(state.lineByExact.get(exactLineKey(orderId, lineItemId)));
    const exact = chooseSingleCompatibleLine(exactMatches, event);
    if (exact && !isOrderLevelRefund) {
      return { line: exact, confidence: RETURN_REFUND_MATCH_CONFIDENCE.exactLineItem, strategy: "exact_line_item" };
    }
  }

  if (orderId && event.variantId) {
    const variant = chooseSingleCompatibleLine(state.linesByOrderVariant.get(orderVariantKey(orderId, event.variantId)), event);
    if (variant) {
      return { line: variant, confidence: RETURN_REFUND_MATCH_CONFIDENCE.sameOrderProductVariant, strategy: "same_order_variant" };
    }
  }

  if (orderId && event.productId) {
    const product = chooseSingleCompatibleLine(state.linesByOrderProduct.get(orderProductKey(orderId, event.productId)), event);
    if (product) {
      return { line: product, confidence: RETURN_REFUND_MATCH_CONFIDENCE.sameOrderProductVariant, strategy: "same_order_product" };
    }
  }

  if (orderLines.length === 1 && isLineCompatibleWithEvent(orderLines[0], event)) {
    return { line: orderLines[0], confidence: RETURN_REFUND_MATCH_CONFIDENCE.singleProductOrder, strategy: "single_product_order" };
  }

  const heuristic = matchByAmountQuantityAndDate(state, event);
  if (heuristic) {
    return { line: heuristic, confidence: RETURN_REFUND_MATCH_CONFIDENCE.weakOrderLevel, strategy: "amount_quantity_date" };
  }

  return { line: null, confidence: RETURN_REFUND_MATCH_CONFIDENCE.unattributed, strategy: "unattributed" };
}

function chooseSingleCompatibleLine(lines, event) {
  const compatible = getArray(lines).filter((line) => isLineCompatibleWithEvent(line, event));
  return compatible.length === 1 ? compatible[0] : null;
}

function isLineCompatibleWithEvent(line, event) {
  if (!line) return false;
  if (event.productId && line.productId !== event.productId) return false;
  if (event.variantId && line.variantId && line.variantId !== event.variantId) return false;
  return true;
}

function matchByAmountQuantityAndDate(state, event) {
  if (!event.productId) return null;
  const candidates = getArray(state.linesByProduct.get(event.productId)).filter((line) => {
    if (event.variantId && line.variantId && line.variantId !== event.variantId) return false;
    if (event.quantity && line.soldUnits && event.quantity > line.soldUnits) return false;
    if (!event.amount || !line.soldRevenue) return false;
    const unitAmount = line.soldUnits ? line.soldRevenue / line.soldUnits : line.soldRevenue;
    const expectedAmount = event.quantity ? unitAmount * event.quantity : line.soldRevenue;
    if (Math.abs(expectedAmount - event.amount) > AMOUNT_MATCH_TOLERANCE) return false;
    return areDatesNear(line.saleDate, event.occurredAt || event.orderDate, HEURISTIC_DATE_WINDOW_DAYS);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function getUnattributedProductIdsForEvent(state, event) {
  if (event.productId) return [event.productId];
  if (event.orderId && state.linesByOrder.has(event.orderId)) {
    return Array.from(new Set(state.linesByOrder.get(event.orderId).map((line) => line.productId).filter(Boolean)));
  }
  return [];
}

function finalizeProductRelationshipSummary(productId, state) {
  const lines = state.lines.filter((line) => line.productId === productId);
  const extras = getProductExtras(state, productId);
  const summary = createEmptyRelationshipSummary(productId);
  summary.sold_units = sum(lines, "soldUnits");
  summary.total_product_revenue = roundMoney(sum(lines, "soldRevenue"));
  lines.forEach((line) => applyLineToSummary(summary, line));
  applyExtrasToSummary(summary, extras);
  finalizeSummaryRates(summary);
  return summary;
}

function applyLineToSummary(summary, line) {
  if (line.orderId && line.soldUnits > 0) summary._soldOrderIds.add(line.orderId);
  const returnUnits = sum(line.returns, "quantity");
  const refundUnits = sum(line.refunds, "quantity");
  const refundAmount = sum(line.refunds, "amount");
  const exchangeUnits = Math.min(returnUnits, sum(line.returns.filter((item) => item.bucketHint === RETURN_REFUND_RELATIONSHIP_BUCKETS.exchangeOrReplacement), "quantity"));
  const returnUnitsExcludingExchange = Math.max(0, returnUnits - exchangeUnits);
  const returnedAndRefundedUnits = Math.min(returnUnitsExcludingExchange, refundUnits);
  const pendingRawUnits = sum(line.returns.filter((item) => item.bucketHint === RETURN_REFUND_RELATIONSHIP_BUCKETS.pendingReturnResolution), "quantity");
  const pendingReturnUnits = Math.min(pendingRawUnits, Math.max(0, returnUnitsExcludingExchange - returnedAndRefundedUnits));
  const returnedNotRefundedUnits = Math.max(0, returnUnitsExcludingExchange - returnedAndRefundedUnits - pendingReturnUnits);
  const refundedWithoutReturnUnits = Math.max(0, refundUnits - returnedAndRefundedUnits);
  const consumedSoldUnits = Math.min(
    line.soldUnits,
    exchangeUnits + returnedAndRefundedUnits + pendingReturnUnits + returnedNotRefundedUnits + refundedWithoutReturnUnits,
  );
  const noReturnNoRefundUnits = Math.max(0, line.soldUnits - consumedSoldUnits);
  const refundAmountWithReturn = allocateRefundAmount(refundAmount, refundUnits, returnedAndRefundedUnits);
  const refundAmountWithoutReturn = Math.max(0, refundAmount - refundAmountWithReturn);

  summary.returned_units += returnUnits;
  summary.refunded_units += refundUnits;
  summary.attributed_refund_amount += refundAmount;
  summary.refund_amount_with_return += refundAmountWithReturn;
  summary.refund_amount_without_return += refundAmountWithoutReturn;
  addBucket(summary, RETURN_REFUND_RELATIONSHIP_BUCKETS.exchangeOrReplacement, exchangeUnits, line.orderId);
  addBucket(summary, RETURN_REFUND_RELATIONSHIP_BUCKETS.returnedAndRefunded, returnedAndRefundedUnits, line.orderId);
  addBucket(summary, RETURN_REFUND_RELATIONSHIP_BUCKETS.pendingReturnResolution, pendingReturnUnits, line.orderId);
  addBucket(summary, RETURN_REFUND_RELATIONSHIP_BUCKETS.returnedNotRefunded, returnedNotRefundedUnits, line.orderId);
  addBucket(summary, RETURN_REFUND_RELATIONSHIP_BUCKETS.refundedWithoutReturn, refundedWithoutReturnUnits, line.orderId);
  addBucket(summary, RETURN_REFUND_RELATIONSHIP_BUCKETS.noReturnNoRefund, noReturnNoRefundUnits, line.orderId);

  if (returnUnits > 0 && line.orderId) summary._returnedOrderIds.add(line.orderId);
  if (refundUnits > 0 && line.orderId) summary._refundedOrderIds.add(line.orderId);
  line.returns.forEach((item) => {
    summary._matchConfidences.push(item.confidence);
    addReasonCategory(summary, "return_reason_categories", item.reasonCategory, item.quantity);
  });
  line.refunds.forEach((item) => {
    summary._matchConfidences.push(item.confidence);
    addReasonCategory(summary, "refund_reason_categories", item.reasonCategory, item.quantity);
  });
}

function applyExtrasToSummary(summary, extras) {
  summary.unattributed_refund_amount += extras.unattributedRefundAmount;
  summary.relationship_unknown_count += extras.unknownCount;
  summary._matchConfidences.push(...extras.matchConfidences);
  extras.unmatchedReturns.forEach(({ event }) => {
    const quantity = operationalQuantity(event);
    const bucket = getReturnEventBucketHint(event);
    summary.returned_units += quantity;
    if (event.orderId) summary._returnedOrderIds.add(event.orderId);
    addBucket(summary, bucket, quantity, event.orderId);
    addReasonCategory(summary, "return_reason_categories", classifyRelationshipReason(event), quantity);
  });
  extras.unattributedRefundEvents.forEach((event) => {
    addBucket(summary, RETURN_REFUND_RELATIONSHIP_BUCKETS.unattributedRefund, 0, event.orderId || event.id);
    addReasonCategory(summary, "refund_reason_categories", classifyRelationshipReason(event), 1);
  });
}

function finalizeSummaryRates(summary) {
  summary.sold_orders = summary._soldOrderIds.size;
  summary.returned_orders = summary._returnedOrderIds.size;
  summary.refunded_orders = summary._refundedOrderIds.size;
  Object.entries(summary.relationship_buckets).forEach(([bucket, data]) => {
    const orderCount = data._orderIds.size;
    data.orders = orderCount;
    delete data._orderIds;
    setSuggestedBucketFields(summary, bucket, data.units, orderCount);
  });
  summary.attributed_refund_amount = roundMoney(summary.attributed_refund_amount);
  summary.unattributed_refund_amount = roundMoney(summary.unattributed_refund_amount);
  summary.refund_amount_with_return = roundMoney(summary.refund_amount_with_return);
  summary.refund_amount_without_return = roundMoney(summary.refund_amount_without_return);
  summary.total_product_revenue = roundMoney(summary.total_product_revenue);
  summary.total_refund_amount_related_to_product_or_orders = roundMoney(summary.attributed_refund_amount + summary.unattributed_refund_amount);
  summary.relationship_match_confidence_avg = roundRate(average(summary._matchConfidences));
  summary.relationship_match_confidence_min = summary._matchConfidences.length ? roundRate(Math.min(...summary._matchConfidences)) : 0;
  summary.return_rate_units = roundRate(safeDivide(summary.returned_units, summary.sold_units));
  summary.return_rate_orders = roundRate(safeDivide(summary.returned_orders, summary.sold_orders));
  summary.refund_rate_revenue = roundRate(safeDivide(summary.attributed_refund_amount, summary.total_product_revenue));
  summary.refund_rate_units = roundRate(safeDivide(summary.refunded_units, summary.sold_units));
  summary.return_to_refund_rate = roundRate(safeDivide(summary.returned_and_refunded_units, summary.returned_units));
  summary.refund_with_return_rate = roundRate(safeDivide(summary.returned_and_refunded_units, summary.refunded_units));
  summary.refund_without_return_rate = roundRate(safeDivide(summary.refunded_without_return_units, summary.sold_units));
  summary.return_without_refund_rate = roundRate(safeDivide(summary.returned_not_refunded_units, summary.sold_units));
  summary.exchange_rate = roundRate(safeDivide(summary.exchange_or_replacement_units, summary.sold_units));
  summary.unattributed_refund_rate = roundRate(safeDivide(summary.unattributed_refund_amount, summary.total_product_revenue));
  summary.refund_attribution_rate = roundRate(safeDivide(summary.attributed_refund_amount, summary.total_refund_amount_related_to_product_or_orders));
  delete summary._soldOrderIds;
  delete summary._returnedOrderIds;
  delete summary._refundedOrderIds;
  delete summary._matchConfidences;
  if (!Object.keys(summary.return_reason_categories).length) delete summary.return_reason_categories;
  if (!Object.keys(summary.refund_reason_categories).length) delete summary.refund_reason_categories;
}

function createEmptyRelationshipSummary(productId = null) {
  return {
    schema_version: SUMMARY_VERSION,
    product_id: productId || null,
    sold_units: 0,
    sold_orders: 0,
    returned_units: 0,
    returned_orders: 0,
    refunded_units: 0,
    refunded_orders: 0,
    returned_and_refunded_units: 0,
    returned_and_refunded_orders: 0,
    returned_not_refunded_units: 0,
    returned_not_refunded_orders: 0,
    refunded_without_return_units: 0,
    refunded_without_return_orders: 0,
    exchange_or_replacement_units: 0,
    exchange_or_replacement_orders: 0,
    pending_return_units: 0,
    pending_return_orders: 0,
    unattributed_refund_amount: 0,
    attributed_refund_amount: 0,
    refund_amount_with_return: 0,
    refund_amount_without_return: 0,
    total_product_revenue: 0,
    total_refund_amount_related_to_product_or_orders: 0,
    relationship_match_confidence_avg: 0,
    relationship_match_confidence_min: 0,
    relationship_unknown_count: 0,
    return_rate_units: 0,
    return_rate_orders: 0,
    refund_rate_revenue: 0,
    refund_rate_units: 0,
    return_to_refund_rate: 0,
    refund_with_return_rate: 0,
    refund_without_return_rate: 0,
    return_without_refund_rate: 0,
    exchange_rate: 0,
    unattributed_refund_rate: 0,
    refund_attribution_rate: 0,
    relationship_buckets: createBucketSummary(),
    return_reason_categories: {},
    refund_reason_categories: {},
    _soldOrderIds: new Set(),
    _returnedOrderIds: new Set(),
    _refundedOrderIds: new Set(),
    _matchConfidences: [],
  };
}

function createBucketSummary() {
  return Object.values(RETURN_REFUND_RELATIONSHIP_BUCKETS).reduce((buckets, bucket) => {
    buckets[bucket] = { units: 0, orders: 0, _orderIds: new Set() };
    return buckets;
  }, {});
}

function getProductExtras(state, productId) {
  if (!state.productExtras.has(productId)) {
    state.productExtras.set(productId, {
      unmatchedReturns: [],
      unattributedRefundEvents: [],
      unattributedRefundAmount: 0,
      unattributedRefundOrders: new Set(),
      matchConfidences: [],
      unknownCount: 0,
    });
  }
  return state.productExtras.get(productId);
}

function getOrderContext(state, orderId) {
  if (!state.orderContexts.has(orderId)) {
    state.orderContexts.set(orderId, {
      id: orderId,
      lineKeys: new Set(),
      productIds: new Set(),
    });
  }
  return state.orderContexts.get(orderId);
}

function getReturnEventBucketHint(event) {
  const text = `${event.status || ""} ${event.reason || ""} ${event.note || ""}`.toLowerCase();
  if (/\b(exchange|replacement|replace|replaced)\b/.test(text)) return RETURN_REFUND_RELATIONSHIP_BUCKETS.exchangeOrReplacement;
  if (/open|requested|pending|in progress|inspection|inspect|processing|authorized/.test(text)) {
    return RETURN_REFUND_RELATIONSHIP_BUCKETS.pendingReturnResolution;
  }
  if (event.quantity && event.processedQuantity && event.processedQuantity < event.quantity) {
    return RETURN_REFUND_RELATIONSHIP_BUCKETS.pendingReturnResolution;
  }
  return RETURN_REFUND_RELATIONSHIP_BUCKETS.returnedNotRefunded;
}

export function classifyRelationshipReason(event = {}) {
  const text = cleanText([
    event.reason,
    event.reasonLabel,
    event.reasonHandle,
    event.restockType,
    event.note,
    event.reasonNote,
    event.customerNote,
  ].filter(Boolean).join(" ")).toLowerCase();
  if (!text) return "";
  if (/damage|damaged|defect|defective|broken|faulty|crack|tear|ripped|malfunction/.test(text)) return "damaged_or_defective";
  if (/quality|durability|cheap|poorly made|material|fabric|stitch|zipper/.test(text)) return "product_quality";
  if (/not as described|description|photo|image|picture|color|colour|expectation|misleading/.test(text)) return "not_as_described";
  if (/size|fit|too small|too large|tight|loose|waist|inseam|length/.test(text)) return "size_or_fit";
  if (/wrong item|wrong product|incorrect item|wrong sku|different item/.test(text)) return "wrong_item";
  if (/shipping|shipment|carrier|delivery|delayed|late|lost in transit|transit/.test(text)) return "shipping_issue";
  if (/fulfillment|warehouse|packed|packing|missing item|incomplete|inventory|pick/.test(text)) return "fulfillment_issue";
  if (/service|support|agent|customer care/.test(text)) return "customer_service";
  if (/billing|adjustment|charge|overcharge|tax|discount|price|payment|restock discrepancy|order level refund/.test(text)) return "billing_or_adjustment";
  if (/goodwill|courtesy|appeasement|customer request|gesture/.test(text)) return "goodwill";
  return "unknown";
}

function addBucket(summary, bucket, units, orderId) {
  if (!units && bucket !== RETURN_REFUND_RELATIONSHIP_BUCKETS.unattributedRefund) return;
  const target = summary.relationship_buckets[bucket];
  target.units += units;
  if (orderId) target._orderIds.add(orderId);
}

function setSuggestedBucketFields(summary, bucket, units, orders) {
  if (bucket === RETURN_REFUND_RELATIONSHIP_BUCKETS.returnedAndRefunded) {
    summary.returned_and_refunded_units = units;
    summary.returned_and_refunded_orders = orders;
  } else if (bucket === RETURN_REFUND_RELATIONSHIP_BUCKETS.returnedNotRefunded) {
    summary.returned_not_refunded_units = units;
    summary.returned_not_refunded_orders = orders;
  } else if (bucket === RETURN_REFUND_RELATIONSHIP_BUCKETS.refundedWithoutReturn) {
    summary.refunded_without_return_units = units;
    summary.refunded_without_return_orders = orders;
  } else if (bucket === RETURN_REFUND_RELATIONSHIP_BUCKETS.exchangeOrReplacement) {
    summary.exchange_or_replacement_units = units;
    summary.exchange_or_replacement_orders = orders;
  } else if (bucket === RETURN_REFUND_RELATIONSHIP_BUCKETS.pendingReturnResolution) {
    summary.pending_return_units = units;
    summary.pending_return_orders = orders;
  }
}

function addReasonCategory(summary, key, category, amount = 1) {
  if (!category) return;
  summary[key][category] = (summary[key][category] || 0) + Math.max(1, number(amount));
}

function allocateRefundAmount(totalAmount, refundUnits, matchedUnits) {
  if (!totalAmount || !refundUnits || !matchedUnits) return 0;
  return roundMoney(totalAmount * Math.min(1, matchedUnits / refundUnits));
}

function operationalQuantity(event = {}) {
  return Math.max(0, number(event.quantity || event.processedQuantity || event.refundedQuantity || 0)) || (event.amount ? 1 : 0);
}

function addToMapArray(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function exactLineKey(orderId, lineItemId) {
  return `${orderId || ""}::${lineItemId || ""}`;
}

function orderVariantKey(orderId, variantId) {
  return `${orderId || ""}::${variantId || ""}`;
}

function orderProductKey(orderId, productId) {
  return `${orderId || ""}::${productId || ""}`;
}

function areDatesNear(first, second, windowDays) {
  const firstDate = parseDate(first);
  const secondDate = parseDate(second);
  if (!firstDate || !secondDate) return false;
  return Math.abs(firstDate.getTime() - secondDate.getTime()) <= windowDays * 24 * 60 * 60 * 1000;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

function stringOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function sum(items = [], key) {
  return items.reduce((total, item) => total + number(item?.[key]), 0);
}

function average(values = []) {
  const numeric = values.map(number).filter((value) => Number.isFinite(value));
  if (!numeric.length) return 0;
  return numeric.reduce((total, value) => total + value, 0) / numeric.length;
}

function safeDivide(numerator, denominator) {
  const bottom = number(denominator);
  if (!bottom) return 0;
  return number(numerator) / bottom;
}

function number(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundRate(value) {
  return Math.round(Math.max(0, number(value)) * 10000) / 10000;
}

function roundMoney(value) {
  return Math.round(number(value) * 100) / 100;
}
