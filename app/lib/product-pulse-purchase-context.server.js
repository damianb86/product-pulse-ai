import prisma from "../db.server";

export const PURCHASE_CONTEXT_BUCKETS = Object.freeze({
  soloProductOrder: "solo_product_order",
  multiProductOrder: "multi_product_order",
  singleUnitPurchase: "single_unit_purchase",
  multiUnitPurchase: "multi_unit_purchase",
  bulkPurchase: "bulk_purchase",
  multiVariantSameProductOrder: "multi_variant_same_product_order",
  bundledOrAssociatedPurchase: "bundled_or_associated_purchase",
});

export const PRODUCT_PURCHASE_CONTEXT_SCHEMA_VERSION = 1;
export const DEFAULT_BULK_PURCHASE_THRESHOLD = 4;
const DEFAULT_TOP_CO_PURCHASED_LIMIT = 5;

export function buildProductPurchaseContextSummary({
  shop = null,
  productId,
  products = [],
  events = [],
  sales = [],
  assumeCompleteOrderEvents = false,
  bulkPurchaseThreshold = null,
  topCoPurchasedLimit = DEFAULT_TOP_CO_PURCHASED_LIMIT,
} = {}) {
  const summaries = buildProductPurchaseContextSummaries({
    shop,
    products,
    events,
    sales,
    assumeCompleteOrderEvents,
    bulkPurchaseThreshold,
    topCoPurchasedLimit,
  });
  return summaries.get(productId) || createEmptyPurchaseContextSummary(productId);
}

export function buildProductPurchaseContextSummaries({
  shop = null,
  products = [],
  events = [],
  sales = [],
  assumeCompleteOrderEvents = true,
  bulkPurchaseThreshold = null,
  topCoPurchasedLimit = DEFAULT_TOP_CO_PURCHASED_LIMIT,
} = {}) {
  const productIndex = buildProductIndex(products);
  const saleEvents = normalizePurchaseContextSourceEvents({
    shop,
    events,
    sales,
    productIndex,
  });
  const orderState = buildPurchaseContextOrderState({
    saleEvents,
    productIndex,
    assumeCompleteOrderEvents,
  });
  const productIds = new Set([
    ...productIndex.byId.keys(),
    ...saleEvents.map((event) => event.productId).filter(Boolean),
    ...Array.from(orderState.productOrderIds.keys()),
  ]);
  const summaries = new Map();

  productIds.forEach((productId) => {
    summaries.set(productId, finalizeProductPurchaseContextSummary({
      productId,
      productIndex,
      orderState,
      bulkPurchaseThreshold,
      topCoPurchasedLimit,
    }));
  });

  return summaries;
}

export async function getProductPurchaseContextSummaryForShop(shop, productId, db = prisma) {
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
  return snapshot?.metrics?.productPurchaseContextSummary || null;
}

function buildProductIndex(products = []) {
  const byId = new Map();
  const productIdByVariantId = new Map();

  getArray(products).forEach((product) => {
    const id = stringOrNull(product?.id || product?.productId || product?.productGid);
    if (!id) return;
    byId.set(id, {
      id,
      title: stringOrNull(product.title || product.productTitle) || "Untitled product",
      handle: stringOrNull(product.handle) || "",
      variants: getArray(product.variants),
    });
    getArray(product.variants).forEach((variant) => {
      const variantId = stringOrNull(variant?.id || variant?.variantId || variant?.variantGid);
      if (variantId) productIdByVariantId.set(variantId, id);
    });
  });

  return { byId, productIdByVariantId };
}

function normalizePurchaseContextSourceEvents({ shop, events = [], sales = [], productIndex }) {
  return [
    ...getArray(events),
    ...getArray(sales).map((event) => ({ ...event, type: "sale" })),
  ]
    .map((event, index) => normalizePurchaseContextSaleEvent(event, index, productIndex))
    .filter((event) => event.type === "sale")
    .filter((event) => !shop || !event.shop || event.shop === shop);
}

function normalizePurchaseContextSaleEvent(event = {}, index, productIndex) {
  const type = normalizeEventType(event.type);
  const variantId = stringOrNull(event.variantId || event.variantGid || event.variant_id);
  const productId = stringOrNull(event.productId || event.productGid || event.product_id)
    || productIndex.productIdByVariantId.get(variantId)
    || null;
  const lineItemId = stringOrNull(event.lineItemId || event.orderLineItemId || event.line_item_id || event.id);
  const orderId = stringOrNull(event.orderId || event.orderGid || event.order_id);
  const quantityValue = firstDefined(event.quantity, event.currentQuantity, event.lineItemQuantity);
  const quantity = Math.max(0, number(quantityValue));
  const amount = Math.max(0, number(firstDefined(event.amount, event.revenue, event.lineRevenue, event.subtotal)));
  const title = stringOrNull(event.title || event.productTitle) || productIndex.byId.get(productId)?.title || "";
  const handle = stringOrNull(event.handle || event.productHandle) || productIndex.byId.get(productId)?.handle || "";
  const basketLineItems = normalizeBasketLineItems(
    event.basketLineItems || event.orderLineItems || event.lineItems,
    productIndex,
  );

  return {
    ...event,
    type,
    id: stringOrNull(event.id) || `${type || "event"}:${index}`,
    shop: stringOrNull(event.shop),
    orderId,
    lineItemId,
    productId,
    variantId,
    title,
    handle,
    quantity,
    hasQuantity: quantityValue !== undefined && quantityValue !== null && Number.isFinite(Number(quantityValue)),
    amount,
    orderDate: toIso(event.orderDate || event.createdAt || event.occurredAt || event.processedAt || event.orderProcessedAt || event.orderCreatedAt),
    basketLineItems,
  };
}

function normalizeBasketLineItems(lineItems, productIndex) {
  return getArray(lineItems)
    .map((lineItem, index) => normalizeBasketLineItem(lineItem, index, productIndex))
    .filter(Boolean);
}

function normalizeBasketLineItem(lineItem = {}, index, productIndex) {
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};
  const variantProduct = variant.product || {};
  const variantId = stringOrNull(lineItem.variantId || lineItem.variantGid || variant.id);
  const productId = stringOrNull(lineItem.productId || lineItem.productGid || product.id || variantProduct.id)
    || productIndex.productIdByVariantId.get(variantId)
    || null;
  const quantityValue = firstDefined(lineItem.quantity, lineItem.currentQuantity, lineItem.lineItemQuantity);
  const quantity = Math.max(0, number(quantityValue));
  const amount = Math.max(0, number(firstDefined(
    lineItem.amount,
    lineItem.revenue,
    lineItem.lineRevenue,
    lineItem.subtotal,
    lineItem.originalTotalSet?.shopMoney?.amount,
  )));

  return {
    id: stringOrNull(lineItem.id) || null,
    lineItemId: stringOrNull(lineItem.lineItemId || lineItem.orderLineItemId || lineItem.id) || null,
    productId,
    variantId,
    title: stringOrNull(lineItem.title || lineItem.productTitle || product.title || variantProduct.title)
      || productIndex.byId.get(productId)?.title
      || `Product ${index + 1}`,
    handle: stringOrNull(lineItem.handle || lineItem.productHandle || product.handle || variantProduct.handle)
      || productIndex.byId.get(productId)?.handle
      || "",
    quantity,
    hasQuantity: quantityValue !== undefined && quantityValue !== null && Number.isFinite(Number(quantityValue)),
    amount,
  };
}

function normalizeEventType(type) {
  const normalized = String(type || "sale").toLowerCase();
  if (["sale", "order", "order_line_item", ""].includes(normalized)) return "sale";
  return normalized;
}

function buildPurchaseContextOrderState({ saleEvents, productIndex, assumeCompleteOrderEvents }) {
  const orders = new Map();
  const productOrderIds = new Map();
  const productKnownOrderIds = new Map();
  const productLineCounts = new Map();
  const productVariantKnownLineCounts = new Map();

  saleEvents.forEach((event, index) => {
    if (!event.productId) return;
    const orderId = event.orderId || `unknown-order:${event.productId}:${index}`;
    const order = getOrderContext(orders, orderId);
    if (!order.orderDate && event.orderDate) order.orderDate = event.orderDate;
    order.sourceEventCount += 1;

    if (event.basketLineItems.length) {
      order.hasExplicitBasket = true;
      event.basketLineItems.forEach((lineItem, lineIndex) => {
        addLineToOrder(order, {
          ...lineItem,
          orderId,
          source: "explicit_basket",
        }, `${event.id || index}:basket:${lineIndex}`);
      });
    } else {
      addLineToOrder(order, {
        lineItemId: event.lineItemId,
        productId: event.productId,
        variantId: event.variantId,
        title: event.title,
        handle: event.handle,
        quantity: event.quantity,
        hasQuantity: event.hasQuantity,
        amount: event.amount,
        orderId,
        source: "sale_event",
      }, `${event.id || index}:sale`);
    }
  });

  orders.forEach((order) => {
    order.basketKnown = Boolean(order.hasExplicitBasket || assumeCompleteOrderEvents);
    order.lines.forEach((line) => {
      if (!line.productId) {
        order.incompleteLineCount += 1;
        return;
      }
      addSetValue(productOrderIds, line.productId, order.id);
      incrementMap(productLineCounts, line.productId, 1);
      if (line.variantId) incrementMap(productVariantKnownLineCounts, line.productId, 1);
      if (order.basketKnown && !order.incompleteLineCount) addSetValue(productKnownOrderIds, line.productId, order.id);
    });
  });

  return {
    orders,
    productOrderIds,
    productKnownOrderIds,
    productLineCounts,
    productVariantKnownLineCounts,
    productIndex,
    assumeCompleteOrderEvents,
  };
}

function getOrderContext(orders, orderId) {
  if (!orders.has(orderId)) {
    orders.set(orderId, {
      id: orderId,
      orderDate: null,
      lines: new Map(),
      hasExplicitBasket: false,
      basketKnown: false,
      sourceEventCount: 0,
      incompleteLineCount: 0,
    });
  }
  return orders.get(orderId);
}

function addLineToOrder(order, line, fallbackKey) {
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

function finalizeProductPurchaseContextSummary({
  productId,
  productIndex,
  orderState,
  bulkPurchaseThreshold,
  topCoPurchasedLimit,
}) {
  const summary = createEmptyPurchaseContextSummary(productId);
  const targetOrderIds = Array.from(orderState.productOrderIds.get(productId) || []);
  const targetOrders = targetOrderIds.map((orderId) => orderState.orders.get(orderId)).filter(Boolean);
  const orderRows = targetOrders.map((order) => buildProductOrderContextRow(productId, order));
  const quantityRows = orderRows.filter((row) => row.hasKnownQuantity);
  const knownBasketRows = orderRows.filter((row) => row.hasKnownBasket);
  const threshold = normalizeBulkThreshold(bulkPurchaseThreshold, quantityRows.map((row) => row.productQuantity));

  summary.total_orders_containing_product = targetOrders.length;
  summary.total_units_sold = quantityRows.reduce((total, row) => total + row.productQuantity, 0);
  summary.total_revenue_if_available = roundMoney(orderRows.reduce((total, row) => total + row.productRevenue, 0));
  summary.bulk_purchase_threshold = threshold;
  summary.unknown_or_incomplete_order_count = orderRows.filter((row) => row.isIncomplete).length;

  orderRows.forEach((row) => {
    applyOrderRowToSummary(summary, row, threshold);
  });

  summary.avg_product_quantity_per_order = roundRate(safeDivide(summary.total_units_sold, summary.total_orders_containing_product));
  summary.median_product_quantity_per_order = roundRate(median(quantityRows.map((row) => row.productQuantity)));
  summary.avg_distinct_products_per_order = roundRate(safeDivide(
    knownBasketRows.reduce((total, row) => total + row.distinctProductCount, 0),
    knownBasketRows.length,
  ));
  summary.avg_total_units_per_order = roundRate(safeDivide(
    knownBasketRows.reduce((total, row) => total + row.totalUnitsInOrder, 0),
    knownBasketRows.length,
  ));
  summary.quantity_distribution = buildQuantityDistribution(quantityRows, summary.total_orders_containing_product);
  summary.top_co_purchased_products = buildTopCoPurchasedProducts({
    productId,
    productIndex,
    targetRows: knownBasketRows,
    orderState,
    limit: topCoPurchasedLimit,
  });
  summary.monthly_context = buildMonthlyPurchaseContext(orderRows, threshold);
  summary.purchase_context_confidence = calculatePurchaseContextConfidence({
    totalOrders: summary.total_orders_containing_product,
    knownBasketOrders: knownBasketRows.length,
    knownQuantityOrders: quantityRows.length,
    productLineCount: orderState.productLineCounts.get(productId) || 0,
    variantKnownLineCount: orderState.productVariantKnownLineCounts.get(productId) || 0,
    unknownOrders: summary.unknown_or_incomplete_order_count,
  });
  summary.purchase_context_confidence_label = confidenceLabel(summary.purchase_context_confidence);
  finalizeRates(summary);
  return summary;
}

function buildProductOrderContextRow(productId, order) {
  const lines = Array.from(order.lines.values());
  const productLines = lines.filter((line) => line.productId === productId);
  const hasKnownQuantity = productLines.every((line) => line.hasQuantity);
  const productQuantity = productLines.reduce((total, line) => total + line.quantity, 0);
  const productRevenue = productLines.reduce((total, line) => total + line.amount, 0);
  const productVariantIds = new Set(productLines.map((line) => line.variantId).filter(Boolean));
  const distinctProductIds = new Set(lines.map((line) => line.productId).filter(Boolean));
  const hasKnownBasket = Boolean(order.basketKnown && !order.incompleteLineCount);
  const totalUnitsInOrder = lines.reduce((total, line) => total + (line.hasQuantity ? line.quantity : 0), 0);

  return {
    orderId: order.id,
    orderDate: order.orderDate,
    hasKnownBasket,
    hasKnownQuantity,
    isIncomplete: !hasKnownBasket || !hasKnownQuantity || productLines.some((line) => !line.productId),
    productQuantity,
    productRevenue,
    productVariantCount: productVariantIds.size,
    distinctProductCount: hasKnownBasket ? distinctProductIds.size : 0,
    distinctProductIds,
    totalUnitsInOrder,
  };
}

function applyOrderRowToSummary(summary, row, threshold) {
  if (row.hasKnownBasket) {
    if (row.distinctProductCount <= 1) {
      summary.solo_product_order_count += 1;
      addBucket(summary, PURCHASE_CONTEXT_BUCKETS.soloProductOrder, row.productQuantity, row.orderId);
    } else {
      summary.multi_product_order_count += 1;
      addBucket(summary, PURCHASE_CONTEXT_BUCKETS.multiProductOrder, row.productQuantity, row.orderId);
    }
  }

  if (row.hasKnownQuantity) {
    if (row.productQuantity === 1) {
      summary.single_unit_order_count += 1;
      addBucket(summary, PURCHASE_CONTEXT_BUCKETS.singleUnitPurchase, row.productQuantity, row.orderId);
    } else if (row.productQuantity > 1) {
      summary.multi_unit_order_count += 1;
      addBucket(summary, PURCHASE_CONTEXT_BUCKETS.multiUnitPurchase, row.productQuantity, row.orderId);
    }
    if (row.productQuantity >= threshold) {
      summary.bulk_order_count += 1;
      addBucket(summary, PURCHASE_CONTEXT_BUCKETS.bulkPurchase, row.productQuantity, row.orderId);
    }
  }

  if (row.productVariantCount > 1) {
    summary.multi_variant_order_count += 1;
    addBucket(summary, PURCHASE_CONTEXT_BUCKETS.multiVariantSameProductOrder, row.productQuantity, row.orderId);
  }
}

function buildQuantityDistribution(quantityRows, totalOrders) {
  const distribution = {
    one_unit_count: 0,
    two_unit_count: 0,
    three_unit_count: 0,
    four_plus_unit_count: 0,
    one_unit_rate: 0,
    two_unit_rate: 0,
    three_unit_rate: 0,
    four_plus_unit_rate: 0,
  };

  quantityRows.forEach((row) => {
    if (row.productQuantity <= 1) distribution.one_unit_count += 1;
    else if (row.productQuantity === 2) distribution.two_unit_count += 1;
    else if (row.productQuantity === 3) distribution.three_unit_count += 1;
    else distribution.four_plus_unit_count += 1;
  });

  distribution.one_unit_rate = roundRate(safeDivide(distribution.one_unit_count, totalOrders));
  distribution.two_unit_rate = roundRate(safeDivide(distribution.two_unit_count, totalOrders));
  distribution.three_unit_rate = roundRate(safeDivide(distribution.three_unit_count, totalOrders));
  distribution.four_plus_unit_rate = roundRate(safeDivide(distribution.four_plus_unit_count, totalOrders));
  return distribution;
}

function buildTopCoPurchasedProducts({ productId, productIndex, targetRows, orderState, limit }) {
  const knownTargetOrderCount = targetRows.length;
  if (!knownTargetOrderCount) return [];
  const coOrdersByProduct = new Map();
  const knownStoreOrders = Array.from(orderState.orders.values()).filter((order) => order.basketKnown && !order.incompleteLineCount);
  const productOrderFrequency = new Map();

  knownStoreOrders.forEach((order) => {
    const productIds = new Set(Array.from(order.lines.values()).map((line) => line.productId).filter(Boolean));
    productIds.forEach((id) => incrementMap(productOrderFrequency, id, 1));
  });

  targetRows.forEach((row) => {
    row.distinctProductIds.forEach((otherProductId) => {
      if (!otherProductId || otherProductId === productId) return;
      incrementMap(coOrdersByProduct, otherProductId, 1);
    });
  });

  return Array.from(coOrdersByProduct.entries())
    .map(([otherProductId, coOrderCount]) => {
      const product = productIndex.byId.get(otherProductId);
      const coOrderRate = safeDivide(coOrderCount, knownTargetOrderCount);
      const otherProductBaseRate = safeDivide(productOrderFrequency.get(otherProductId) || 0, knownStoreOrders.length);
      const affinityScore = otherProductBaseRate > 0 ? coOrderRate / otherProductBaseRate : 0;
      return {
        productId: otherProductId,
        title: product?.title || "Unknown product",
        handle: product?.handle || "",
        co_order_count: coOrderCount,
        co_order_rate: roundRate(coOrderRate),
        co_order_rate_basis: "known_basket_orders",
        affinity_score: roundRate(affinityScore),
      };
    })
    .sort((first, second) => (
      second.affinity_score - first.affinity_score
      || second.co_order_count - first.co_order_count
      || first.title.localeCompare(second.title)
    ))
    .slice(0, Math.max(1, Number(limit || DEFAULT_TOP_CO_PURCHASED_LIMIT)));
}

function buildMonthlyPurchaseContext(orderRows, threshold) {
  const buckets = new Map();
  orderRows.forEach((row) => {
    const monthKey = getMonthKey(row.orderDate);
    if (!monthKey) return;
    if (!buckets.has(monthKey)) buckets.set(monthKey, createMonthlyBucket(monthKey));
    const bucket = buckets.get(monthKey);
    bucket.orderIds.add(row.orderId);
    bucket.units_sold += row.hasKnownQuantity ? row.productQuantity : 0;
    if (row.hasKnownBasket && row.distinctProductCount <= 1) bucket.solo_product_orders += 1;
    if (row.hasKnownBasket && row.distinctProductCount > 1) bucket.multi_product_orders += 1;
    if (row.productVariantCount > 1) bucket.multi_variant_orders += 1;
    if (row.hasKnownQuantity && row.productQuantity >= threshold) bucket.bulk_orders += 1;
    if (row.hasKnownQuantity) bucket._quantityOrders.push(row.productQuantity);
  });

  return Array.from(buckets.values())
    .sort((first, second) => first.month.localeCompare(second.month))
    .map((bucket) => {
      const orders = bucket.orderIds.size;
      delete bucket.orderIds;
      const quantities = bucket._quantityOrders;
      delete bucket._quantityOrders;
      return {
        ...bucket,
        orders_containing_product: orders,
        avg_product_quantity_per_order: roundRate(safeDivide(
          quantities.reduce((total, quantity) => total + quantity, 0),
          quantities.length,
        )),
      };
    });
}

function createMonthlyBucket(month) {
  return {
    month,
    orderIds: new Set(),
    units_sold: 0,
    solo_product_orders: 0,
    multi_product_orders: 0,
    avg_product_quantity_per_order: 0,
    multi_variant_orders: 0,
    bulk_orders: 0,
    _quantityOrders: [],
  };
}

function calculatePurchaseContextConfidence({
  totalOrders,
  knownBasketOrders,
  knownQuantityOrders,
  productLineCount,
  variantKnownLineCount,
  unknownOrders,
}) {
  if (!totalOrders) return 0;
  const sampleScore = clamp(Math.log2(totalOrders + 1) / Math.log2(21), 0, 1);
  const basketScore = safeDivide(knownBasketOrders, totalOrders);
  const quantityScore = safeDivide(knownQuantityOrders, totalOrders);
  const variantScore = productLineCount ? safeDivide(variantKnownLineCount, productLineCount) : 0.65;
  const completenessPenalty = safeDivide(unknownOrders, totalOrders) * 18;
  return roundScore(clamp(
    ((sampleScore * 0.30) + (basketScore * 0.34) + (quantityScore * 0.24) + (variantScore * 0.12)) * 100 - completenessPenalty,
    0,
    100,
  ));
}

function finalizeRates(summary) {
  summary.solo_purchase_rate = roundRate(safeDivide(summary.solo_product_order_count, summary.total_orders_containing_product));
  summary.multi_product_basket_rate = roundRate(safeDivide(summary.multi_product_order_count, summary.total_orders_containing_product));
  summary.single_unit_purchase_rate = roundRate(safeDivide(summary.single_unit_order_count, summary.total_orders_containing_product));
  summary.multi_unit_purchase_rate = roundRate(safeDivide(summary.multi_unit_order_count, summary.total_orders_containing_product));
  summary.bulk_purchase_rate = roundRate(safeDivide(summary.bulk_order_count, summary.total_orders_containing_product));
  summary.multi_variant_order_rate = roundRate(safeDivide(summary.multi_variant_order_count, summary.total_orders_containing_product));
  summary.avg_product_qty_per_order = summary.avg_product_quantity_per_order;
  Object.values(summary.context_buckets).forEach((bucket) => {
    bucket.orders = bucket._orderIds.size;
    bucket.units = roundRate(bucket.units);
    delete bucket._orderIds;
  });
}

function normalizeBulkThreshold(explicitThreshold, quantities = []) {
  const explicit = Number(explicitThreshold);
  if (Number.isFinite(explicit) && explicit >= 2) return Math.floor(explicit);
  const clean = quantities.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (clean.length < 20) return DEFAULT_BULK_PURCHASE_THRESHOLD;
  const p90 = clean[Math.max(0, Math.ceil(clean.length * 0.9) - 1)] || DEFAULT_BULK_PURCHASE_THRESHOLD;
  return Math.max(DEFAULT_BULK_PURCHASE_THRESHOLD, Math.round(p90));
}

function addBucket(summary, bucket, units, orderId) {
  const target = summary.context_buckets[bucket];
  if (!target) return;
  target.units += Math.max(0, number(units));
  if (orderId) target._orderIds.add(orderId);
}

function createEmptyPurchaseContextSummary(productId = null) {
  return {
    schema_version: PRODUCT_PURCHASE_CONTEXT_SCHEMA_VERSION,
    product_id: productId || null,
    total_orders_containing_product: 0,
    total_units_sold: 0,
    total_revenue_if_available: 0,
    solo_product_order_count: 0,
    multi_product_order_count: 0,
    single_unit_order_count: 0,
    multi_unit_order_count: 0,
    bulk_order_count: 0,
    multi_variant_order_count: 0,
    avg_product_quantity_per_order: 0,
    median_product_quantity_per_order: 0,
    avg_distinct_products_per_order: 0,
    avg_total_units_per_order: 0,
    top_co_purchased_products: [],
    purchase_context_confidence: 0,
    purchase_context_confidence_label: "Unavailable",
    unknown_or_incomplete_order_count: 0,
    bulk_purchase_threshold: DEFAULT_BULK_PURCHASE_THRESHOLD,
    solo_purchase_rate: 0,
    multi_product_basket_rate: 0,
    single_unit_purchase_rate: 0,
    multi_unit_purchase_rate: 0,
    bulk_purchase_rate: 0,
    multi_variant_order_rate: 0,
    avg_product_qty_per_order: 0,
    quantity_distribution: buildQuantityDistribution([], 0),
    monthly_context: [],
    context_buckets: createContextBucketSummary(),
  };
}

function createContextBucketSummary() {
  return Object.values(PURCHASE_CONTEXT_BUCKETS).reduce((buckets, bucket) => {
    buckets[bucket] = { units: 0, orders: 0, _orderIds: new Set() };
    return buckets;
  }, {});
}

function addSetValue(map, key, value) {
  if (!key || !value) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function incrementMap(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function confidenceLabel(score) {
  const value = Number(score || 0);
  if (value >= 80) return "High";
  if (value >= 55) return "Medium";
  if (value > 0) return "Low";
  return "Unavailable";
}

function getMonthKey(value) {
  const date = parseValidDate(value);
  if (!date) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function median(values = []) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2) return clean[middle];
  return (clean[middle - 1] + clean[middle]) / 2;
}

function safeDivide(numerator, denominator) {
  const divisor = number(denominator);
  if (!divisor) return 0;
  return number(numerator) / divisor;
}

function roundRate(value) {
  return Math.round(number(value) * 10000) / 10000;
}

function roundMoney(value) {
  return Math.round(number(value) * 100) / 100;
}

function roundScore(value) {
  return Math.round(number(value) * 10) / 10;
}

function clamp(value, min, max) {
  const numberValue = Number(value);
  return Math.min(Math.max(Number.isFinite(numberValue) ? numberValue : 0, min), max);
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function getArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.nodes)) return value.nodes;
  if (Array.isArray(value?.edges)) return value.edges.map((edge) => edge.node).filter(Boolean);
  return [];
}

function parseValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = parseValidDate(value);
  return date ? date.toISOString() : null;
}
