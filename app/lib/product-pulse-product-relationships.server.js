import prisma from "../db.server";

export const PRODUCT_RELATIONSHIP_SCHEMA_VERSION = 1;
export const PRODUCT_RELATIONSHIP_MODEL_VERSION = "product_relationship_v2";
export const PRODUCT_RELATIONSHIP_WINDOWS_DAYS = Object.freeze([7, 30, 90]);

const DEFAULT_TOP_RELATIONSHIP_LIMIT = 5;
const DEFAULT_TREND_MONTH_LIMIT = 12;
const MISSING_CUSTOMER_WARNING = "customer_identity_unavailable";
const LOW_VOLUME_WARNING = "low_sample_size";
const SINGLE_CUSTOMER_WARNING = "single_customer_dominates";
const UNKNOWN_PRODUCT_WARNING = "related_product_not_in_catalog";

export function buildProductRelationshipSummary({
  shop = null,
  productId,
  products = [],
  events = [],
  sales = [],
  returns = [],
  refunds = [],
  windowDays = null,
  assumeCompleteOrderEvents = false,
  topRelationshipLimit = DEFAULT_TOP_RELATIONSHIP_LIMIT,
} = {}) {
  const summaries = buildProductRelationshipSummaries({
    shop,
    products,
    events,
    sales,
    returns,
    refunds,
    windowDays,
    assumeCompleteOrderEvents,
    topRelationshipLimit,
  });
  return summaries.get(productId) || createEmptyProductRelationshipSummary(productId, { windowDays });
}

export function buildProductRelationshipSummaries({
  shop = null,
  products = [],
  events = [],
  sales = [],
  returns = [],
  refunds = [],
  windowDays = null,
  assumeCompleteOrderEvents = true,
  topRelationshipLimit = DEFAULT_TOP_RELATIONSHIP_LIMIT,
} = {}) {
  const productIndex = buildProductIndex(products);
  const saleEvents = normalizeProductRelationshipSaleEvents({ shop, events, sales, productIndex });
  const impactEvents = normalizeProductRelationshipImpactEvents({ shop, events, returns, refunds, productIndex });
  const orderState = buildRelationshipOrderState({ saleEvents, assumeCompleteOrderEvents });
  const productIds = new Set([
    ...productIndex.byId.keys(),
    ...saleEvents.map((event) => event.productId).filter(Boolean),
    ...Array.from(orderState.productOrderIds.keys()),
  ]);
  const summaries = new Map();

  productIds.forEach((productId) => {
    summaries.set(productId, finalizeProductRelationshipSummary({
      productId,
      productIndex,
      orderState,
      impactEvents,
      windowDays,
      topRelationshipLimit,
    }));
  });

  return summaries;
}

export async function getProductRelationshipSummaryForShop(shop, productId, db = prisma) {
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
  return snapshot?.metrics?.productRelationshipIntelligenceSummary || null;
}

export function normalizeProductRelationshipSaleEvents({ shop = null, events = [], sales = [], productIndex = buildProductIndex([]) } = {}) {
  return [
    ...getArray(events),
    ...getArray(sales).map((event) => ({ ...event, type: "sale" })),
  ]
    .map((event, index) => normalizeProductRelationshipSaleEvent(event, index, productIndex))
    .filter((event) => event?.type === "sale" && event.productId)
    .filter((event) => !shop || !event.shop || event.shop === shop);
}

export function normalizeProductRelationshipImpactEvents({ shop = null, events = [], returns = [], refunds = [], productIndex = buildProductIndex([]) } = {}) {
  return [
    ...getArray(events),
    ...getArray(returns).map((event) => ({ ...event, type: "return" })),
    ...getArray(refunds).map((event) => ({ ...event, type: "refund" })),
  ]
    .map((event, index) => normalizeProductRelationshipImpactEvent(event, index, productIndex))
    .filter((event) => event && (event.type === "return" || event.type === "refund"))
    .filter((event) => !shop || !event.shop || event.shop === shop);
}

export function normalizeProductRelationshipSaleEvent(event = {}, index = 0, productIndex = buildProductIndex([])) {
  const type = normalizeEventType(event.type);
  if (type !== "sale") return null;
  const variantId = stringOrNull(event.variantId || event.variantGid || event.variant_id);
  const product = event.product || {};
  const variant = event.variant || {};
  const variantProduct = variant.product || {};
  const productId = stringOrNull(event.productId || event.productGid || event.product_id || product.id || variantProduct.id)
    || productIndex.productIdByVariantId.get(variantId)
    || null;
  const orderId = stringOrNull(event.orderId || event.orderGid || event.order_id);
  const lineItemId = stringOrNull(event.lineItemId || event.orderLineItemId || event.line_item_id || event.id);
  const quantityValue = firstDefined(event.quantity, event.currentQuantity, event.lineItemQuantity);
  const customerKey = normalizeCustomerKey(event.customerKey || event.customerId || event.customerGid || event.customer_id || event.customer?.id);

  return {
    ...event,
    type,
    id: stringOrNull(event.id) || `${type}:${index}`,
    shop: stringOrNull(event.shop),
    orderId,
    lineItemId,
    productId,
    variantId,
    title: stringOrNull(event.title || event.productTitle || product.title || variantProduct.title) || productIndex.byId.get(productId)?.title || "",
    handle: stringOrNull(event.handle || event.productHandle || product.handle || variantProduct.handle) || productIndex.byId.get(productId)?.handle || "",
    imageUrl: stringOrNull(event.imageUrl || event.image_url || product.imageUrl || product.image_url || product.featuredImage?.url || product.image?.url || variantProduct.imageUrl || variantProduct.image_url)
      || productIndex.byId.get(productId)?.imageUrl
      || "",
    quantity: Math.max(0, number(quantityValue)),
    hasQuantity: quantityValue !== undefined && quantityValue !== null && Number.isFinite(Number(quantityValue)),
    amount: Math.max(0, number(firstDefined(event.amount, event.revenue, event.lineRevenue, event.subtotal, event.originalTotalSet?.shopMoney?.amount))),
    orderDate: toIso(event.orderDate || event.createdAt || event.occurredAt || event.processedAt || event.orderProcessedAt || event.orderCreatedAt),
    customerKey,
    basketLineItems: normalizeRelationshipBasketLineItems(event.basketLineItems || event.orderLineItems || event.lineItems, productIndex),
  };
}

export function normalizeProductRelationshipImpactEvent(event = {}, index = 0, productIndex = buildProductIndex([])) {
  const type = normalizeEventType(event.type);
  if (type !== "return" && type !== "refund") return null;
  const variantId = stringOrNull(event.variantId || event.variantGid || event.variant_id);
  const product = event.product || {};
  const variant = event.variant || {};
  const variantProduct = variant.product || {};
  const productId = stringOrNull(event.productId || event.productGid || event.product_id || product.id || variantProduct.id)
    || productIndex.productIdByVariantId.get(variantId)
    || null;

  return {
    ...event,
    type,
    id: stringOrNull(event.id) || `${type}:${index}`,
    shop: stringOrNull(event.shop),
    orderId: stringOrNull(event.orderId || event.orderGid || event.order_id),
    lineItemId: stringOrNull(event.lineItemId || event.orderLineItemId || event.line_item_id),
    productId,
    variantId,
    quantity: Math.max(0, number(firstDefined(event.quantity, event.processedQuantity, event.refundedQuantity))),
    amount: Math.max(0, number(firstDefined(event.amount, event.totalRefundedAmount, event.refundAmount))),
    occurredAt: toIso(event.occurredAt || event.createdAt || event.processedAt || event.updatedAt || event.orderDate),
    fallbackSource: stringOrNull(event.fallbackSource),
  };
}

function buildProductIndex(products = []) {
  const byId = new Map();
  const productIdByVariantId = new Map();

  getArray(products).forEach((product) => {
    const id = stringOrNull(product?.id || product?.productId || product?.productGid);
    if (!id) return;
    const indexed = {
      id,
      title: stringOrNull(product.title || product.productTitle) || "Unknown product",
      handle: stringOrNull(product.handle || product.productHandle) || "",
      imageUrl: stringOrNull(product.imageUrl || product.image_url || product.featuredImage?.url || product.image?.url) || "",
      status: stringOrNull(product.status || product.productStatus) || "",
      variants: getArray(product.variants),
    };
    byId.set(id, indexed);
    indexed.variants.forEach((variant) => {
      const variantId = stringOrNull(variant?.id || variant?.variantId || variant?.variantGid);
      if (variantId) productIdByVariantId.set(variantId, id);
    });
  });

  return { byId, productIdByVariantId };
}

function normalizeRelationshipBasketLineItems(lineItems, productIndex) {
  return getArray(lineItems)
    .map((lineItem, index) => normalizeRelationshipBasketLineItem(lineItem, index, productIndex))
    .filter(Boolean);
}

function normalizeRelationshipBasketLineItem(lineItem = {}, index, productIndex) {
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};
  const variantProduct = variant.product || {};
  const variantId = stringOrNull(lineItem.variantId || lineItem.variantGid || lineItem.variant_id || variant.id);
  const productId = stringOrNull(lineItem.productId || lineItem.productGid || lineItem.product_id || product.id || variantProduct.id)
    || productIndex.productIdByVariantId.get(variantId)
    || null;
  if (!productId && !variantId) return null;
  const quantityValue = firstDefined(lineItem.quantity, lineItem.currentQuantity, lineItem.lineItemQuantity);

  return {
    id: stringOrNull(lineItem.id) || null,
    lineItemId: stringOrNull(lineItem.lineItemId || lineItem.orderLineItemId || lineItem.line_item_id || lineItem.id) || null,
    productId,
    variantId,
    title: stringOrNull(lineItem.title || lineItem.productTitle || product.title || variantProduct.title)
      || productIndex.byId.get(productId)?.title
      || `Product ${index + 1}`,
    handle: stringOrNull(lineItem.handle || lineItem.productHandle || product.handle || variantProduct.handle)
      || productIndex.byId.get(productId)?.handle
      || "",
    imageUrl: stringOrNull(lineItem.imageUrl || lineItem.image_url || product.imageUrl || product.image_url || product.featuredImage?.url || product.image?.url || variantProduct.imageUrl || variantProduct.image_url)
      || productIndex.byId.get(productId)?.imageUrl
      || "",
    quantity: Math.max(0, number(quantityValue)),
    hasQuantity: quantityValue !== undefined && quantityValue !== null && Number.isFinite(Number(quantityValue)),
    amount: Math.max(0, number(firstDefined(
      lineItem.amount,
      lineItem.revenue,
      lineItem.lineRevenue,
      lineItem.subtotal,
      lineItem.originalTotalSet?.shopMoney?.amount,
    ))),
  };
}

function buildRelationshipOrderState({ saleEvents = [], assumeCompleteOrderEvents = true } = {}) {
  const orders = new Map();
  const productOrderIds = new Map();
  const productCustomerKeys = new Map();
  const productMonthOrderIds = new Map();

  saleEvents.forEach((event, index) => {
    const orderId = event.orderId || `unknown-order:${event.productId}:${index}`;
    const order = getRelationshipOrder(orders, orderId);
    if (!order.orderDate && event.orderDate) order.orderDate = event.orderDate;
    if (!order.customerKey && event.customerKey) order.customerKey = event.customerKey;
    order.sourceEventCount += 1;

    if (event.basketLineItems.length) {
      order.hasExplicitBasket = true;
      event.basketLineItems.forEach((lineItem, lineIndex) => {
        addRelationshipLineToOrder(order, { ...lineItem, orderId }, `${event.id || index}:basket:${lineIndex}`);
      });
    } else {
      addRelationshipLineToOrder(order, {
        orderId,
        lineItemId: event.lineItemId,
        productId: event.productId,
        variantId: event.variantId,
        title: event.title,
        handle: event.handle,
        quantity: event.quantity,
        hasQuantity: event.hasQuantity,
        amount: event.amount,
      }, `${event.id || index}:sale`);
    }
  });

  orders.forEach((order) => {
    order.basketKnown = Boolean(order.hasExplicitBasket || assumeCompleteOrderEvents);
    const productIds = new Set();
    order.lines.forEach((line) => {
      if (!line.productId) {
        order.incompleteLineCount += 1;
        return;
      }
      productIds.add(line.productId);
    });
    productIds.forEach((productId) => {
      addSetValue(productOrderIds, productId, order.id);
      if (order.customerKey) addSetValue(productCustomerKeys, productId, order.customerKey);
      const month = monthKey(order.orderDate);
      if (month) addSetValue(productMonthOrderIds, `${productId}::${month}`, order.id);
    });
  });

  return {
    orders,
    productOrderIds,
    productCustomerKeys,
    productMonthOrderIds,
    assumeCompleteOrderEvents,
  };
}

function getRelationshipOrder(orders, orderId) {
  if (!orders.has(orderId)) {
    orders.set(orderId, {
      id: orderId,
      orderDate: null,
      customerKey: "",
      lines: new Map(),
      hasExplicitBasket: false,
      basketKnown: false,
      sourceEventCount: 0,
      incompleteLineCount: 0,
    });
  }
  return orders.get(orderId);
}

function addRelationshipLineToOrder(order, line, fallbackKey) {
  const key = line.lineItemId
    ? `line:${line.lineItemId}`
    : `fallback:${line.productId || "unknown"}:${line.variantId || "unknown"}:${fallbackKey}`;
  if (order.lines.has(key)) return;
  order.lines.set(key, {
    ...line,
    quantity: Math.max(0, number(line.quantity)),
    amount: Math.max(0, number(line.amount)),
    hasQuantity: Boolean(line.hasQuantity),
  });
}

function finalizeProductRelationshipSummary({
  productId,
  productIndex,
  orderState,
  impactEvents = [],
  windowDays = null,
  topRelationshipLimit = DEFAULT_TOP_RELATIONSHIP_LIMIT,
}) {
  const summary = createEmptyProductRelationshipSummary(productId, { windowDays });
  const allOrders = Array.from(orderState.orders.values());
  const knownBasketOrders = allOrders.filter((order) => order.basketKnown && !order.incompleteLineCount);
  const customerOrders = allOrders.filter((order) => order.customerKey && parseDate(order.orderDate));
  const sourceOrderIds = orderState.productOrderIds.get(productId) || new Set();
  const sourceOrders = Array.from(sourceOrderIds).map((orderId) => orderState.orders.get(orderId)).filter(Boolean);
  const sourceKnownBasketOrders = sourceOrders.filter((order) => order.basketKnown && !order.incompleteLineCount);
  const sourceCustomers = orderState.productCustomerKeys.get(productId) || new Set();
  const allCustomers = new Set(customerOrders.map((order) => order.customerKey).filter(Boolean));
  const customerSequenceAvailable = allCustomers.size > 0;
  const warnings = new Set();

  if (!customerSequenceAvailable) warnings.add(MISSING_CUSTOMER_WARNING);
  if (sourceOrders.length < 2) warnings.add(LOW_VOLUME_WARNING);

  summary.data_basis = {
    same_order_available: sourceKnownBasketOrders.length > 0,
    customer_sequence_available: customerSequenceAvailable,
    customer_identity_basis: customerSequenceAvailable ? "shopify_customer_gid_hash" : "none",
    order_count: sourceOrders.length,
    customer_count: sourceCustomers.size,
    known_customer_order_count: sourceOrders.filter((order) => order.customerKey).length,
    unknown_customer_order_count: sourceOrders.filter((order) => !order.customerKey).length,
    known_basket_order_count: sourceKnownBasketOrders.length,
    unknown_basket_order_count: sourceOrders.length - sourceKnownBasketOrders.length,
  };

  const sourceMonthlyOrderCounts = buildSourceMonthlyOrderCounts(productId, orderState);
  const sameOrderRelationships = buildSameOrderRelationships({
    productId,
    productIndex,
    orderState,
    knownBasketOrders,
    sourceKnownBasketOrders,
    impactEvents,
    sourceMonthlyOrderCounts,
  });
  const sequenceRelationships = buildSequenceRelationships({
    productId,
    productIndex,
    orderState,
    customerOrders,
    sourceCustomers,
    allCustomers,
    impactEvents,
    sourceMonthlyOrderCounts,
  });

  summary.same_order_relationships = topRelationshipItems(sameOrderRelationships, topRelationshipLimit);
  summary.previous_purchase_relationships = topRelationshipItems(sequenceRelationships.previous, topRelationshipLimit);
  summary.next_purchase_relationships = topRelationshipItems(sequenceRelationships.next, topRelationshipLimit);
  summary.relationship_trends = [
    ...summary.same_order_relationships,
    ...summary.previous_purchase_relationships,
    ...summary.next_purchase_relationships,
  ]
    .map((item) => buildRelationshipTrendRecord(item))
    .filter(Boolean)
    .slice(0, topRelationshipLimit * 3);
  summary.relationship_impact = buildRelationshipImpactSummary(summary.same_order_relationships);
  summary.top_bought_together = summary.same_order_relationships;
  summary.top_bought_before = summary.previous_purchase_relationships;
  summary.top_bought_after = summary.next_purchase_relationships;
  summary.strongest_relationships = topRelationshipItems([
    ...summary.same_order_relationships,
    ...summary.previous_purchase_relationships,
    ...summary.next_purchase_relationships,
  ], topRelationshipLimit);
  summary.emerging_relationships = topRelationshipItems(summary.strongest_relationships.filter((item) => item.trend === "emerging"), topRelationshipLimit);
  summary.relationships_with_return_risk_impact = topRelationshipItems(
    summary.same_order_relationships.filter((item) => Number(item.delta_return_rate || 0) > 0 || Number(item.delta_refund_rate || 0) > 0),
    topRelationshipLimit,
  );
  summary.relationships_with_cross_sell_opportunity = topRelationshipItems(
    summary.strongest_relationships.filter((item) => (
      item.relationship_direction === "after"
      || (item.relationship_direction === "together" && Number(item.lift || 0) >= 1.25)
    ) && Number(item.delta_return_rate || 0) <= 0.1),
    topRelationshipLimit,
  );
  summary.confidence = calculateSummaryConfidence({
    sourceOrders: sourceOrders.length,
    knownBasketOrders: sourceKnownBasketOrders.length,
    sourceCustomers: sourceCustomers.size,
    customerSequenceAvailable,
    relationships: summary.strongest_relationships,
    warnings,
  });
  summary.warnings = Array.from(new Set([...warnings, ...summary.confidence.reasons.filter((reason) => reason.endsWith("_warning"))]));
  return summary;
}

function buildSameOrderRelationships({
  productId,
  productIndex,
  orderState,
  knownBasketOrders,
  sourceKnownBasketOrders,
  impactEvents,
  sourceMonthlyOrderCounts,
}) {
  const totalKnownOrders = knownBasketOrders.length;
  if (!sourceKnownBasketOrders.length || !totalKnownOrders) return [];
  const productOrderFrequency = new Map();
  const productMonthOrderFrequency = new Map();

  knownBasketOrders.forEach((order) => {
    const month = monthKey(order.orderDate);
    getDistinctProductIds(order).forEach((id) => {
      incrementMap(productOrderFrequency, id, 1);
      if (month) incrementMap(productMonthOrderFrequency, `${id}::${month}`, 1);
    });
  });

  const statsByRelatedProduct = new Map();
  sourceKnownBasketOrders.forEach((order) => {
    const relatedIds = Array.from(getDistinctProductIds(order)).filter((id) => id !== productId);
    relatedIds.forEach((relatedProductId) => {
      const stats = getRelationshipStats(statsByRelatedProduct, productId, relatedProductId, {
        relationshipType: "same_order",
        direction: "together",
        window: "same_order",
      });
      const relatedLines = getProductLines(order, relatedProductId);
      rememberRelatedProductIdentity(stats, relatedLines);
      stats.orderIds.add(order.id);
      stats.orderCount += 1;
      if (order.customerKey) {
        stats.customerKeys.add(order.customerKey);
        incrementMap(stats.customerOrderCounts, order.customerKey, 1);
      }
      stats.unitCount += relatedLines.reduce((total, line) => total + Number(line.quantity || 0), 0);
      stats.revenue += relatedLines.reduce((total, line) => total + Number(line.amount || 0), 0);
      stats.firstSeenAt = minIso(stats.firstSeenAt, order.orderDate);
      stats.lastSeenAt = maxIso(stats.lastSeenAt, order.orderDate);
      const month = monthKey(order.orderDate);
      if (month) {
        const monthStats = getMonthlyStats(stats.monthly, month);
        monthStats.order_count += 1;
        monthStats.customer_count = addMonthlyCustomer(monthStats, order.customerKey);
        monthStats.unit_count += relatedLines.reduce((total, line) => total + Number(line.quantity || 0), 0);
        monthStats.revenue += relatedLines.reduce((total, line) => total + Number(line.amount || 0), 0);
      }
    });
  });

  return Array.from(statsByRelatedProduct.values()).map((stats) => {
    const relatedProduct = productIndex.byId.get(stats.relatedProductId);
    const attachRate = safeDivide(stats.orderCount, sourceKnownBasketOrders.length);
    const relatedProductBaseRate = safeDivide(productOrderFrequency.get(stats.relatedProductId) || 0, totalKnownOrders);
    const lift = relatedProductBaseRate > 0 ? attachRate / relatedProductBaseRate : null;
    const impact = calculateSameOrderImpact({
      sourceProductId: productId,
      relatedProductId: stats.relatedProductId,
      sourceOrders: sourceKnownBasketOrders,
      impactEvents,
    });
    const monthly = finalizeRelationshipMonthlyRows({
      stats,
      sourceMonthlyOrderCounts,
      productMonthOrderFrequency,
      knownBasketOrders,
      denominatorKind: "orders",
    });
    const trend = classifyRelationshipTrend(monthly);
    const confidence = calculateRelationshipConfidence({
      relationshipType: stats.relationshipType,
      sampleSize: stats.orderCount,
      customerCount: stats.customerKeys.size,
      customerOrderCounts: stats.customerOrderCounts,
      monthCount: monthly.filter((row) => row.order_count > 0).length,
      lift,
      relatedProduct,
      customerIdentityAvailable: stats.customerKeys.size > 0,
      basketKnown: true,
    });
    const strength = calculateRelationshipStrength({
      relationshipRate: attachRate,
      lift,
      sampleSize: stats.orderCount,
      customerCount: stats.customerKeys.size,
      confidence: confidence.score,
      trend,
      monthCount: monthly.filter((row) => row.order_count > 0).length,
    });

    return {
      source_product_id: productId,
      related_product_id: stats.relatedProductId,
      related_product_handle: relatedProduct?.handle || stats.relatedProductHandle || "",
      related_product_title: relatedProduct?.title || stats.relatedProductTitle || "Unknown product",
      related_product_image_url: relatedProduct?.imageUrl || stats.relatedProductImageUrl || "",
      related_product_status: relatedProduct?.status || "",
      relationship_type: stats.relationshipType,
      relationship_direction: stats.direction,
      time_window: stats.window,
      co_order_count: stats.orderCount,
      co_customer_count: stats.customerKeys.size,
      co_unit_count: roundRate(stats.unitCount),
      co_revenue: roundMoney(stats.revenue),
      attach_rate: roundRate(attachRate),
      related_product_base_rate: roundRate(relatedProductBaseRate),
      lift: lift === null ? null : roundRate(lift),
      relationship_rate: roundRate(attachRate),
      relationship_strength_score: strength.score,
      relationship_strength: strength.level,
      confidence: confidence.score,
      confidence_label: confidence.label,
      sample_size: stats.orderCount,
      first_seen_at: stats.firstSeenAt,
      last_seen_at: stats.lastSeenAt,
      trend,
      monthly,
      return_rate_when_bought_together: impact.returnRateWhenBoughtTogether,
      refund_rate_when_bought_together: impact.refundRateWhenBoughtTogether,
      refund_amount_when_bought_together: impact.refundAmountWhenBoughtTogether,
      return_rate_when_not_bought_together: impact.returnRateWhenNotBoughtTogether,
      refund_rate_when_not_bought_together: impact.refundRateWhenNotBoughtTogether,
      delta_return_rate: impact.deltaReturnRate,
      delta_refund_rate: impact.deltaRefundRate,
      warnings: confidence.warnings,
    };
  });
}

function buildSequenceRelationships({
  productId,
  productIndex,
  orderState,
  customerOrders,
  sourceCustomers,
  allCustomers,
  impactEvents,
  sourceMonthlyOrderCounts,
}) {
  if (!customerOrders.length || !sourceCustomers.size) return { previous: [], next: [] };
  const ordersByCustomer = new Map();
  const productCustomerFrequency = new Map();

  customerOrders.forEach((order) => {
    addToMapArray(ordersByCustomer, order.customerKey, order);
    getDistinctProductIds(order).forEach((id) => addSetValue(productCustomerFrequency, id, order.customerKey));
  });
  ordersByCustomer.forEach((orders) => orders.sort(compareOrdersByDate));

  const previousStats = new Map();
  const nextStats = new Map();
  const sourceOrderRows = Array.from(orderState.productOrderIds.get(productId) || [])
    .map((orderId) => orderState.orders.get(orderId))
    .filter((order) => order?.customerKey && parseDate(order.orderDate));

  sourceOrderRows.forEach((sourceOrder) => {
    const customerOrderList = ordersByCustomer.get(sourceOrder.customerKey) || [];
    const sourceDate = parseDate(sourceOrder.orderDate);
    if (!sourceDate) return;
    customerOrderList.forEach((candidateOrder) => {
      if (candidateOrder.id === sourceOrder.id) return;
      const candidateDate = parseDate(candidateOrder.orderDate);
      if (!candidateDate) return;
      const diffDays = (candidateDate.getTime() - sourceDate.getTime()) / (24 * 60 * 60 * 1000);
      if (diffDays === 0) return;
      const direction = diffDays < 0 ? "before" : "after";
      const absDays = Math.abs(diffDays);
      const window = getSequenceRelationshipWindow(absDays);
      if (!window) return;
      getDistinctProductIds(candidateOrder).forEach((relatedProductId) => {
        if (!relatedProductId || relatedProductId === productId) return;
        const targetMap = direction === "before" ? previousStats : nextStats;
        const stats = getRelationshipStats(targetMap, productId, relatedProductId, {
          relationshipType: direction === "before" ? "previous_purchase" : "next_purchase",
          direction,
          window: `${window}d_${direction}`,
        });
        const relatedLines = getProductLines(candidateOrder, relatedProductId);
        rememberRelatedProductIdentity(stats, relatedLines);
        stats.customerKeys.add(sourceOrder.customerKey);
        stats.orderIds.add(sourceOrder.id);
        stats.orderCount += 1;
        incrementMap(stats.customerOrderCounts, sourceOrder.customerKey, 1);
        stats.days.push(absDays);
        stats.unitCount += relatedLines.reduce((total, line) => total + Number(line.quantity || 0), 0);
        stats.revenue += relatedLines.reduce((total, line) => total + Number(line.amount || 0), 0);
        stats.firstSeenAt = minIso(stats.firstSeenAt, sourceOrder.orderDate);
        stats.lastSeenAt = maxIso(stats.lastSeenAt, sourceOrder.orderDate);
        const month = monthKey(sourceOrder.orderDate);
        if (month) {
          const monthStats = getMonthlyStats(stats.monthly, month);
          monthStats.order_count += 1;
          monthStats.customer_count = addMonthlyCustomer(monthStats, sourceOrder.customerKey);
          monthStats.unit_count += relatedLines.reduce((total, line) => total + Number(line.quantity || 0), 0);
          monthStats.revenue += relatedLines.reduce((total, line) => total + Number(line.amount || 0), 0);
        }
      });
    });
  });

  const finalize = (stats) => Array.from(stats.values()).map((item) => {
    const relatedProduct = productIndex.byId.get(item.relatedProductId);
    const relationshipRate = safeDivide(item.customerKeys.size, sourceCustomers.size);
    const relatedProductBaseRate = safeDivide(productCustomerFrequency.get(item.relatedProductId)?.size || 0, allCustomers.size);
    const lift = relatedProductBaseRate > 0 ? relationshipRate / relatedProductBaseRate : null;
    const monthly = finalizeRelationshipMonthlyRows({
      stats: item,
      sourceMonthlyOrderCounts,
      productMonthOrderFrequency: new Map(),
      knownBasketOrders: [],
      denominatorKind: "customers",
    });
    const trend = classifyRelationshipTrend(monthly);
    const confidence = calculateRelationshipConfidence({
      relationshipType: item.relationshipType,
      sampleSize: item.customerKeys.size,
      customerCount: item.customerKeys.size,
      customerOrderCounts: item.customerOrderCounts,
      monthCount: monthly.filter((row) => row.order_count > 0).length,
      lift,
      relatedProduct,
      customerIdentityAvailable: true,
      basketKnown: true,
    });
    const strength = calculateRelationshipStrength({
      relationshipRate,
      lift,
      sampleSize: item.customerKeys.size,
      customerCount: item.customerKeys.size,
      confidence: confidence.score,
      trend,
      monthCount: monthly.filter((row) => row.order_count > 0).length,
    });
    const medianDays = median(item.days);
    const avgDays = average(item.days);
    const isAfter = item.direction === "after";

    return {
      source_product_id: productId,
      related_product_id: item.relatedProductId,
      related_product_handle: relatedProduct?.handle || item.relatedProductHandle || "",
      related_product_title: relatedProduct?.title || item.relatedProductTitle || "Unknown product",
      related_product_image_url: relatedProduct?.imageUrl || item.relatedProductImageUrl || "",
      related_product_status: relatedProduct?.status || "",
      relationship_type: item.relationshipType,
      relationship_direction: item.direction,
      time_window: item.window,
      customer_count: item.customerKeys.size,
      order_count: item.orderCount,
      relationship_rate: roundRate(relationshipRate),
      related_product_base_rate: roundRate(relatedProductBaseRate),
      lift: lift === null ? null : roundRate(lift),
      [isAfter ? "lift_after" : "lift_before"]: lift === null ? null : roundRate(lift),
      [isAfter ? "median_days_after" : "median_days_before"]: roundRate(medianDays),
      [isAfter ? "avg_days_after" : "avg_days_before"]: roundRate(avgDays),
      follow_on_revenue: isAfter ? roundMoney(item.revenue) : 0,
      unit_count: roundRate(item.unitCount),
      revenue: roundMoney(item.revenue),
      relationship_strength_score: strength.score,
      relationship_strength: strength.level,
      confidence: confidence.score,
      confidence_label: confidence.label,
      sample_size: item.customerKeys.size,
      first_seen_at: item.firstSeenAt,
      last_seen_at: item.lastSeenAt,
      trend,
      monthly,
      return_refund_impact_available: false,
      warnings: [
        ...confidence.warnings,
        "sequence_return_refund_impact_not_causal",
      ].filter((value, index, list) => list.indexOf(value) === index),
    };
  });

  return {
    previous: finalize(previousStats),
    next: finalize(nextStats),
  };
}

function getRelationshipStats(map, sourceProductId, relatedProductId, { relationshipType, direction, window }) {
  const key = `${sourceProductId}::${relatedProductId}::${relationshipType}::${direction}::${window}`;
  if (!map.has(key)) {
    map.set(key, {
      sourceProductId,
      relatedProductId,
      relatedProductTitle: "",
      relatedProductHandle: "",
      relatedProductImageUrl: "",
      relationshipType,
      direction,
      window,
      orderIds: new Set(),
      customerKeys: new Set(),
      customerOrderCounts: new Map(),
      days: [],
      orderCount: 0,
      unitCount: 0,
      revenue: 0,
      firstSeenAt: null,
      lastSeenAt: null,
      monthly: new Map(),
    });
  }
  return map.get(key);
}

function rememberRelatedProductIdentity(stats, relatedLines = []) {
  if (!stats) return;
  const line = getArray(relatedLines).find((item) => item?.productId === stats.relatedProductId || item?.title || item?.handle);
  if (!line) return;
  if (!stats.relatedProductTitle && line.title) stats.relatedProductTitle = String(line.title);
  if (!stats.relatedProductHandle && line.handle) stats.relatedProductHandle = String(line.handle);
  if (!stats.relatedProductImageUrl && line.imageUrl) stats.relatedProductImageUrl = String(line.imageUrl);
}

function calculateSameOrderImpact({ sourceProductId, relatedProductId, sourceOrders, impactEvents = [] }) {
  const eventsByOrderId = new Map();
  impactEvents.forEach((event) => {
    if (!event.orderId) return;
    addToMapArray(eventsByOrderId, event.orderId, event);
  });
  const together = createImpactCohort();
  const notTogether = createImpactCohort();

  sourceOrders.forEach((order) => {
    const cohort = getDistinctProductIds(order).has(relatedProductId) ? together : notTogether;
    const sourceLines = getProductLines(order, sourceProductId);
    const sourceLineIds = new Set(sourceLines.map((line) => line.lineItemId).filter(Boolean));
    cohort.soldUnits += sourceLines.reduce((total, line) => total + Number(line.quantity || 0), 0);
    getArray(eventsByOrderId.get(order.id)).forEach((event) => {
      if (!eventMatchesSourceLine(event, sourceProductId, sourceLineIds)) return;
      if (event.type === "return") cohort.returnedUnits += Number(event.quantity || 0);
      if (event.type === "refund") {
        cohort.refundedUnits += Number(event.quantity || 0);
        cohort.refundAmount += Number(event.amount || 0);
      }
    });
  });

  return {
    returnRateWhenBoughtTogether: roundRate(safeDivide(together.returnedUnits, together.soldUnits)),
    refundRateWhenBoughtTogether: roundRate(safeDivide(together.refundedUnits, together.soldUnits)),
    refundAmountWhenBoughtTogether: roundMoney(together.refundAmount),
    returnRateWhenNotBoughtTogether: roundRate(safeDivide(notTogether.returnedUnits, notTogether.soldUnits)),
    refundRateWhenNotBoughtTogether: roundRate(safeDivide(notTogether.refundedUnits, notTogether.soldUnits)),
    deltaReturnRate: roundRate(safeDivide(together.returnedUnits, together.soldUnits) - safeDivide(notTogether.returnedUnits, notTogether.soldUnits)),
    deltaRefundRate: roundRate(safeDivide(together.refundedUnits, together.soldUnits) - safeDivide(notTogether.refundedUnits, notTogether.soldUnits)),
  };
}

function createImpactCohort() {
  return {
    soldUnits: 0,
    returnedUnits: 0,
    refundedUnits: 0,
    refundAmount: 0,
  };
}

function eventMatchesSourceLine(event, sourceProductId, sourceLineIds) {
  if (event.lineItemId && sourceLineIds.has(event.lineItemId)) return true;
  if (event.productId === sourceProductId) return true;
  return false;
}

function finalizeRelationshipMonthlyRows({
  stats,
  sourceMonthlyOrderCounts,
  productMonthOrderFrequency,
  knownBasketOrders,
  denominatorKind,
}) {
  const months = Array.from(new Set([
    ...Array.from(stats.monthly.keys()),
    ...Array.from(sourceMonthlyOrderCounts.keys()),
  ])).sort().slice(-DEFAULT_TREND_MONTH_LIMIT);

  return months.map((month) => {
    const monthly = stats.monthly.get(month) || createMonthlyStats(month);
    const sourceOrders = sourceMonthlyOrderCounts.get(month) || 0;
    const relationshipRate = safeDivide(monthly.order_count, sourceOrders);
    let baseRate = 0;
    if (denominatorKind === "orders") {
      const knownOrdersInMonth = knownBasketOrders.filter((order) => monthKey(order.orderDate) === month).length;
      baseRate = safeDivide(productMonthOrderFrequency.get(`${stats.relatedProductId}::${month}`) || 0, knownOrdersInMonth);
    }
    const lift = baseRate > 0 ? relationshipRate / baseRate : null;

    return {
      month,
      source_product_orders: sourceOrders,
      related_order_count: monthly.order_count,
      order_count: monthly.order_count,
      customer_count: monthly.customer_count || 0,
      unit_count: roundRate(monthly.unit_count),
      revenue: roundMoney(monthly.revenue),
      relationship_rate: roundRate(relationshipRate),
      lift: lift === null ? null : roundRate(lift),
      confidence: confidenceLabelScore(calculateMonthlyConfidence(monthly.order_count, sourceOrders)),
    };
  });
}

function buildSourceMonthlyOrderCounts(productId, orderState) {
  const counts = new Map();
  Array.from(orderState.productOrderIds.get(productId) || []).forEach((orderId) => {
    const order = orderState.orders.get(orderId);
    const month = monthKey(order?.orderDate);
    if (month) incrementMap(counts, month, 1);
  });
  return counts;
}

function buildRelationshipTrendRecord(item) {
  if (!item?.monthly?.length) return null;
  return {
    related_product_id: item.related_product_id,
    related_product_title: item.related_product_title,
    relationship_type: item.relationship_type,
    relationship_direction: item.relationship_direction,
    time_window: item.time_window,
    monthly: item.monthly,
    trend: item.trend,
    confidence: item.confidence,
  };
}

function classifyRelationshipTrend(monthlyRows = []) {
  const rows = getArray(monthlyRows).filter((row) => Number(row.source_product_orders || 0) > 0);
  if (rows.length < 2) return "insufficient_data";
  const rates = rows.map((row) => Number(row.relationship_rate || 0));
  const first = rates[0];
  const last = rates[rates.length - 1];
  const nonZeroCount = rates.filter((rate) => rate > 0).length;
  if (nonZeroCount <= 1 && last > 0) return "emerging";
  if (first > 0 && last === 0) return "fading";
  if (last >= first + 0.15 || (first > 0 && last / first >= 1.35)) return "increasing";
  if (first >= last + 0.15 || (first > 0 && last / first <= 0.65)) return "decreasing";
  return "stable";
}

function calculateRelationshipStrength({ relationshipRate = 0, lift = null, sampleSize = 0, customerCount = 0, confidence = 0, trend = "insufficient_data", monthCount = 0 }) {
  if (sampleSize < 2 || confidence < 25) return { score: 0, level: "insufficient_data" };
  const rateScore = Math.min(32, Math.max(0, Number(relationshipRate || 0)) * 64);
  const liftScore = lift === null ? 0 : Math.min(24, Math.max(0, Number(lift || 0) - 1) * 12);
  const sampleScore = Math.min(16, Math.sqrt(sampleSize) * 5);
  const customerScore = Math.min(10, Math.sqrt(customerCount || sampleSize) * 3);
  const consistencyScore = Math.min(8, monthCount * 2);
  const trendScore = trend === "emerging" || trend === "increasing" ? 5 : trend === "stable" ? 3 : 0;
  const confidenceScore = Math.min(10, confidence / 10);
  const score = roundScore(rateScore + liftScore + sampleScore + customerScore + consistencyScore + trendScore + confidenceScore);

  return {
    score,
    level: strengthLevel(score, sampleSize),
  };
}

function strengthLevel(score, sampleSize) {
  if (sampleSize < 2 || score < 20) return "insufficient_data";
  if (score >= 75) return "very_strong";
  if (score >= 60) return "strong";
  if (score >= 40) return "moderate";
  return "weak";
}

function calculateRelationshipConfidence({
  relationshipType,
  sampleSize = 0,
  customerCount = 0,
  customerOrderCounts = new Map(),
  monthCount = 0,
  lift = null,
  relatedProduct = null,
  customerIdentityAvailable = false,
  basketKnown = false,
}) {
  const warnings = [];
  const orderVolumeScore = Math.min(30, sampleSize * 6);
  const basketScore = basketKnown ? 18 : 0;
  const customerIdentityScore = relationshipType === "same_order"
    ? (customerIdentityAvailable ? 10 : 4)
    : (customerIdentityAvailable ? 20 : 0);
  const productMappingScore = relatedProduct ? 14 : 5;
  const trendScore = Math.min(10, monthCount * 3);
  const liftScore = lift !== null && lift >= 1.2 ? 8 : lift !== null && lift >= 1 ? 4 : 0;
  let penalty = 0;
  const maxCustomerShare = maxMapValue(customerOrderCounts) / Math.max(sampleSize, 1);

  if (sampleSize < 3) warnings.push(LOW_VOLUME_WARNING);
  if (!customerIdentityAvailable && relationshipType !== "same_order") warnings.push(MISSING_CUSTOMER_WARNING);
  if (maxCustomerShare >= 0.8 && sampleSize >= 3) {
    warnings.push(SINGLE_CUSTOMER_WARNING);
    penalty += 20;
  }
  if (!relatedProduct) {
    warnings.push(UNKNOWN_PRODUCT_WARNING);
    penalty += 8;
  }

  const score = clampPercent(orderVolumeScore + basketScore + customerIdentityScore + productMappingScore + trendScore + liftScore - penalty);
  return {
    score,
    label: confidenceLabel(score),
    warnings: warnings.filter((value, index, list) => list.indexOf(value) === index),
  };
}

function calculateSummaryConfidence({ sourceOrders = 0, knownBasketOrders = 0, sourceCustomers = 0, customerSequenceAvailable = false, relationships = [], warnings = new Set() } = {}) {
  const orderVolumeScore = Math.min(25, sourceOrders * 5);
  const basketCompletenessScore = sourceOrders ? Math.min(25, (knownBasketOrders / sourceOrders) * 25) : 0;
  const customerIdentityScore = customerSequenceAvailable ? 20 : 4;
  const relationshipScore = Math.min(15, relationships.length * 3);
  const relationshipConfidenceScore = Math.min(15, average(relationships.map((item) => Number(item.confidence || 0))) * 0.15);
  const reasons = [];

  if (!customerSequenceAvailable) reasons.push(MISSING_CUSTOMER_WARNING);
  if (sourceOrders < 3) reasons.push(LOW_VOLUME_WARNING);
  if (knownBasketOrders < sourceOrders) reasons.push("basket_context_incomplete_warning");
  warnings.forEach((warning) => reasons.push(warning));

  const score = clampPercent(orderVolumeScore + basketCompletenessScore + customerIdentityScore + relationshipScore + relationshipConfidenceScore);
  return {
    score,
    label: confidenceLabel(score),
    components: {
      order_volume_score: roundScore(orderVolumeScore),
      basket_completeness_score: roundScore(basketCompletenessScore),
      customer_identity_score: roundScore(customerIdentityScore),
      product_mapping_score: relationships.length ? 12 : 0,
      return_refund_join_score: relationships.some((item) => Math.abs(Number(item.delta_return_rate || 0)) > 0 || Math.abs(Number(item.delta_refund_rate || 0)) > 0) ? 8 : 0,
      trend_sample_score: roundScore(relationshipScore),
    },
    reasons: reasons.filter((value, index, list) => list.indexOf(value) === index),
  };
}

function buildRelationshipImpactSummary(sameOrderRelationships = []) {
  const risky = sameOrderRelationships.filter((item) => Number(item.delta_return_rate || 0) > 0 || Number(item.delta_refund_rate || 0) > 0);
  return {
    available: sameOrderRelationships.some((item) => (
      item.return_rate_when_bought_together !== null
      || item.refund_rate_when_bought_together !== null
    )),
    same_order: {
      relationship_count: sameOrderRelationships.length,
      risk_relationship_count: risky.length,
      max_delta_return_rate: roundRate(Math.max(0, ...sameOrderRelationships.map((item) => Number(item.delta_return_rate || 0)))),
      max_delta_refund_rate: roundRate(Math.max(0, ...sameOrderRelationships.map((item) => Number(item.delta_refund_rate || 0)))),
    },
    sequence: {
      available: false,
      reason_unavailable: "sequence_return_refund_impact_not_causal",
    },
    risk_modifier_recommendation: risky.length ? "future_scoring_candidate" : "relationship_context_only",
    diagnosis_confidence_effect: risky.length ? "mixed" : "none",
    warnings: risky.length ? [] : ["no_relationship_return_refund_delta"],
  };
}

function topRelationshipItems(items = [], limit = DEFAULT_TOP_RELATIONSHIP_LIMIT) {
  return dedupeTopRelationshipItems(getArray(items))
    .slice()
    .sort(compareTopRelationshipItems)
    .slice(0, limit);
}

function getSequenceRelationshipWindow(absDays) {
  const numericDays = Number(absDays);
  if (!Number.isFinite(numericDays) || numericDays <= 0) return null;
  return PRODUCT_RELATIONSHIP_WINDOWS_DAYS.find((window) => numericDays <= window) || null;
}

function dedupeTopRelationshipItems(items = []) {
  const records = new Map();
  items.forEach((item, index) => {
    const key = getTopRelationshipDedupeKey(item, index);
    const existing = records.get(key);
    if (!existing || isBetterTopRelationshipRepresentative(item, existing.item)) {
      records.set(key, { item, index: existing?.index ?? index });
    }
  });
  return Array.from(records.values())
    .sort((left, right) => left.index - right.index)
    .map((record) => record.item);
}

function getTopRelationshipDedupeKey(item = {}, index = 0) {
  const sourceId = item.source_product_id || item.sourceProductId || "";
  const relatedId = item.related_product_id || item.relatedProductId || item.related_product_handle || item.relatedProductHandle || item.related_product_title || item.relatedProductTitle || "";
  const type = item.relationship_type || item.relationshipType || "";
  const direction = item.relationship_direction || item.relationshipDirection || "";
  if (!relatedId) return `row:${index}`;
  return [sourceId, relatedId, type, direction].join("::");
}

function isBetterTopRelationshipRepresentative(candidate = {}, existing = {}) {
  if (isSequenceRelationshipItem(candidate) && isSequenceRelationshipItem(existing)) {
    const candidateWindowRank = getRelationshipWindowRank(candidate);
    const existingWindowRank = getRelationshipWindowRank(existing);
    if (candidateWindowRank !== existingWindowRank) return candidateWindowRank < existingWindowRank;
  }
  return compareTopRelationshipItems(candidate, existing) < 0;
}

function compareTopRelationshipItems(first = {}, second = {}) {
  return (
    Number(second.relationship_strength_score || 0) - Number(first.relationship_strength_score || 0)
    || Number(second.lift || 0) - Number(first.lift || 0)
    || Number(second.relationship_rate || second.attach_rate || 0) - Number(first.relationship_rate || first.attach_rate || 0)
    || Number(second.co_order_count || second.order_count || 0) - Number(first.co_order_count || first.order_count || 0)
  );
}

function isSequenceRelationshipItem(item = {}) {
  const type = String(item.relationship_type || item.relationshipType || "").toLowerCase();
  const direction = String(item.relationship_direction || item.relationshipDirection || "").toLowerCase();
  return type.includes("previous") || type.includes("next") || direction === "before" || direction === "after";
}

function getRelationshipWindowRank(item = {}) {
  const days = getRelationshipWindowDays(item);
  if (days !== null && days <= 7) return 0;
  if (days !== null && days <= 30) return 1;
  if (days !== null) return 2;
  return 3;
}

function getRelationshipWindowDays(item = {}) {
  const windowText = String(item.time_window || item.timeWindow || "").trim();
  const match = windowText.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days)?/i);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isFinite(days) ? days : null;
}

function createEmptyProductRelationshipSummary(productId, { windowDays = null } = {}) {
  return {
    schema_version: PRODUCT_RELATIONSHIP_SCHEMA_VERSION,
    relationship_model_version: PRODUCT_RELATIONSHIP_MODEL_VERSION,
    source_product_id: productId || null,
    calculated_at: new Date().toISOString(),
    window_days: Number(windowDays || 0),
    data_basis: {
      same_order_available: false,
      customer_sequence_available: false,
      customer_identity_basis: "none",
      order_count: 0,
      customer_count: 0,
      known_customer_order_count: 0,
      unknown_customer_order_count: 0,
      known_basket_order_count: 0,
      unknown_basket_order_count: 0,
    },
    same_order_relationships: [],
    previous_purchase_relationships: [],
    next_purchase_relationships: [],
    relationship_trends: [],
    relationship_impact: {
      available: false,
      same_order: {
        relationship_count: 0,
        risk_relationship_count: 0,
        max_delta_return_rate: 0,
        max_delta_refund_rate: 0,
      },
      sequence: {
        available: false,
        reason_unavailable: "customer_identity_unavailable",
      },
      risk_modifier_recommendation: "none",
      diagnosis_confidence_effect: "unknown",
      warnings: [],
    },
    top_bought_together: [],
    top_bought_before: [],
    top_bought_after: [],
    strongest_relationships: [],
    emerging_relationships: [],
    relationships_with_return_risk_impact: [],
    relationships_with_cross_sell_opportunity: [],
    confidence: {
      score: 0,
      label: "Unavailable",
      components: {
        order_volume_score: 0,
        basket_completeness_score: 0,
        customer_identity_score: 0,
        product_mapping_score: 0,
        return_refund_join_score: 0,
        trend_sample_score: 0,
      },
      reasons: [],
    },
    warnings: [],
  };
}

function getDistinctProductIds(order) {
  return new Set(Array.from(order?.lines?.values?.() || []).map((line) => line.productId).filter(Boolean));
}

function getProductLines(order, productId) {
  return Array.from(order?.lines?.values?.() || []).filter((line) => line.productId === productId);
}

function compareOrdersByDate(left, right) {
  return (parseDate(left.orderDate)?.getTime() || 0) - (parseDate(right.orderDate)?.getTime() || 0);
}

function getMonthlyStats(map, month) {
  if (!map.has(month)) map.set(month, createMonthlyStats(month));
  return map.get(month);
}

function createMonthlyStats(month) {
  return {
    month,
    order_count: 0,
    customer_count: 0,
    unit_count: 0,
    revenue: 0,
    customerKeys: new Set(),
  };
}

function addMonthlyCustomer(monthStats, customerKey) {
  if (customerKey) monthStats.customerKeys.add(customerKey);
  return monthStats.customerKeys.size;
}

function calculateMonthlyConfidence(orderCount, sourceOrders) {
  return clampPercent(Math.min(60, orderCount * 15) + Math.min(40, safeDivide(orderCount, sourceOrders) * 40));
}

function confidenceLabelScore(score) {
  return confidenceLabel(score);
}

function confidenceLabel(score) {
  const numeric = Number(score || 0);
  if (numeric >= 80) return "High";
  if (numeric >= 55) return "Medium";
  if (numeric > 0) return "Low";
  return "Unavailable";
}

function normalizeCustomerKey(value) {
  const text = String(value || "").trim();
  if (!text || text.includes("@")) return "";
  return text;
}

function normalizeEventType(type) {
  const normalized = String(type || "sale").toLowerCase();
  if (["sale", "order", "order_line_item", ""].includes(normalized)) return "sale";
  if (["return", "return_line_item"].includes(normalized)) return "return";
  if (["refund", "refund_line_item"].includes(normalized)) return "refund";
  return normalized;
}

function getArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function stringOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDivide(numerator, denominator) {
  const safeNumerator = Number(numerator || 0);
  const safeDenominator = Number(denominator || 0);
  if (!safeDenominator) return 0;
  return safeNumerator / safeDenominator;
}

function median(values = []) {
  const numbers = getArray(values).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return 0;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2) return numbers[middle];
  return (numbers[middle - 1] + numbers[middle]) / 2;
}

function average(values = []) {
  const numbers = getArray(values).map(Number).filter(Number.isFinite);
  if (!numbers.length) return 0;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function roundRate(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, roundScore(value)));
}

function addSetValue(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function incrementMap(map, key, increment = 1) {
  map.set(key, Number(map.get(key) || 0) + increment);
}

function addToMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function maxMapValue(map = new Map()) {
  return Math.max(0, ...Array.from(map.values()).map(Number));
}

function toIso(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKey(value) {
  const date = parseDate(value);
  if (!date) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function minIso(current, next) {
  if (!next) return current;
  if (!current) return toIso(next);
  return parseDate(next).getTime() < parseDate(current).getTime() ? toIso(next) : current;
}

function maxIso(current, next) {
  if (!next) return current;
  if (!current) return toIso(next);
  return parseDate(next).getTime() > parseDate(current).getTime() ? toIso(next) : current;
}
