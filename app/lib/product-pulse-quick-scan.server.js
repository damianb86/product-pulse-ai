import prisma from "../db.server";
import { recordJobLog } from "./product-pulse-job-logs.server";

export const QUICK_SCAN_DEFAULT_WINDOW_DAYS = 60;
export const QUICK_SCAN_MINIMUM_DURATION_MS = 15_000;

const BULK_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;
const BULK_OPERATION_POLL_INTERVAL_MS = process.env.NODE_ENV === "test" ? 10 : 2_000;
const PAGINATED_PRODUCTS_PAGE_SIZE = 20;
const PAGINATED_PRODUCT_COLLECTIONS_PAGE_SIZE = 5;
const PAGINATED_PRODUCT_VARIANTS_PAGE_SIZE = 20;
const PAGINATED_ORDERS_PAGE_SIZE = 8;
const PAGINATED_ORDER_LINE_ITEMS_PAGE_SIZE = 25;
const PAGINATED_REFUND_LINE_ITEMS_PAGE_SIZE = 20;
const PAGINATED_RETURNS_PAGE_SIZE = 3;
const PAGINATED_RETURN_LINE_ITEMS_PAGE_SIZE = 15;

export function getQuickScanWindowDays() {
  return QUICK_SCAN_DEFAULT_WINDOW_DAYS;
}

export async function runShopifyQuickScan({ shop, admin, jobId, scopes }) {
  if (!admin?.graphql) {
    throw new Error("A Shopify Admin API context is required to run QuickScan.");
  }

  const startedAt = Date.now();
  const windowDays = getQuickScanWindowDays(scopes);
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.started",
    message: "QuickScan started using Shopify-native signals only.",
    data: { windowDays },
  });

  await updateQuickScanJob(jobId, {
    status: "Running",
    progress: 12,
    source: "Reading Shopify catalog",
  });

  const extraction = await extractQuickScanData({ admin, windowDays, shop, jobId });
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.extracted",
    message: "Shopify extraction completed.",
    data: {
      extractionMode: extraction.meta.extractionMode,
      windowDays,
      products: extraction.products.length,
      events: extraction.events.length,
      salesEvents: extraction.events.filter((event) => event.type === "sale").length,
      refundEvents: extraction.events.filter((event) => event.type === "refund").length,
      returnEvents: extraction.events.filter((event) => event.type === "return").length,
      bulkError: extraction.meta.bulkError,
      orderAccessDenied: extraction.meta.orderAccessDenied,
    },
  });

  await updateQuickScanJob(jobId, {
    progress: 72,
    source: "Calculating deterministic product risk",
  });

  const candidates = buildQuickScanCandidates({
    products: extraction.products,
    events: extraction.events,
    windowDays,
    extractionMode: extraction.meta.extractionMode,
  });
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.scored",
    message: "Deterministic risk scoring completed.",
    data: {
      candidateCount: candidates.length,
      topCandidates: candidates.slice(0, 5).map((candidate) => ({
        productGid: candidate.productGid,
        handle: candidate.handle,
        title: candidate.productTitle,
        riskScore: candidate.riskScore,
        primaryIssue: candidate.primaryIssue,
        returnRate: candidate.metrics.returnRate,
        refundRate: candidate.metrics.refundRate,
        refundAmount: candidate.metrics.refundAmount,
        topReturnReasons: candidate.metrics.topReturnReasons,
      })),
    },
  });

  await persistQuickScanCandidates(shop, candidates);
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.persisted",
    message: "QuickScan persisted only products above the risk threshold.",
    data: {
      persistedCandidates: candidates.length,
      persistenceRule: "risk_score >= 50 OR return anomaly/refund impact/repeated reasons threshold",
    },
  });
  await waitForMinimumDuration(startedAt, QUICK_SCAN_MINIMUM_DURATION_MS);

  await updateQuickScanJob(jobId, {
    status: "Completed",
    progress: 100,
    source: extraction.meta.orderAccessDenied
      ? "QuickScan completed with catalog only - Shopify order access unavailable"
      : `QuickScan completed - ${candidates.length} product${candidates.length === 1 ? "" : "s"} needing attention`,
    finishedAt: new Date(),
  });
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.completed",
    message: "QuickScan completed.",
    data: {
      durationMs: Date.now() - startedAt,
      candidateCount: candidates.length,
      orderAccessDenied: extraction.meta.orderAccessDenied,
    },
  });

  return { candidates, extraction };
}

export function buildQuickScanCandidates({ products = [], events = [], windowDays = QUICK_SCAN_DEFAULT_WINDOW_DAYS, extractionMode = "bulk" }) {
  const productIndex = new Map();
  const variantIndex = new Map();

  products.forEach((product) => {
    if (!product?.id) return;
    const normalized = normalizeProduct(product);
    productIndex.set(normalized.id, normalized);
    normalized.variants.forEach((variant) => {
      if (variant.id) variantIndex.set(variant.id, normalized.id);
    });
  });

  const aggregates = new Map();

  events.forEach((event) => {
    const productId = event.productId || variantIndex.get(event.variantId);
    if (!productId) return;
    const product = productIndex.get(productId) || normalizeProduct({
      id: productId,
      handle: event.handle,
      title: event.title,
      variants: [],
    });
    productIndex.set(productId, product);

    const aggregate = getProductAggregate(aggregates, product);
    applyEventToAggregate(aggregate, event);
  });

  productIndex.forEach((product, productId) => {
    if (!aggregates.has(productId)) {
      getProductAggregate(aggregates, product);
    }
  });

  const aggregateList = Array.from(aggregates.values());
  const storeTotals = getStoreTotals(aggregateList);

  return aggregateList
    .map((aggregate) => scoreProductAggregate(aggregate, storeTotals, { windowDays, extractionMode }))
    .filter((candidate) => isPersistableCandidate(candidate, storeTotals))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 50);
}

async function extractQuickScanData({ admin, windowDays, shop, jobId }) {
  try {
    const catalogLines = await runBulkQuery(admin, PRODUCT_CATALOG_BULK_QUERY, "catalog", { shop, jobId });
    let orderLines = [];
    let orderAccessDenied = false;

    try {
      orderLines = await runBulkQuery(admin, buildOrdersBulkQuery(windowDays), "orders", { shop, jobId });
    } catch (orderError) {
      if (!isShopifyOrderAccessDeniedError(orderError, "orders")) throw orderError;
      orderAccessDenied = true;
      await recordOrderAccessUnavailableLog({ shop, jobId, mode: "bulk" });
    }

    const bulkData = normalizeBulkQuickScanData(catalogLines, orderLines);
    const refundEvents = orderAccessDenied ? [] : await extractSupplementalRefundEvents({ admin, windowDays, shop, jobId });

    return {
      ...bulkData,
      events: [...bulkData.events, ...refundEvents],
      meta: {
        extractionMode: orderAccessDenied ? "catalog-only" : "bulk",
        windowDays,
        orderAccessDenied,
      },
    };
  } catch (bulkError) {
    if (isShopifyOrderAccessDeniedError(bulkError, "orders")) {
      await recordOrderAccessUnavailableLog({ shop, jobId, mode: "bulk-recovery" });
      const products = await extractProductsWithPaginatedQueries({ admin });
      return {
        products: products.map(normalizeProduct),
        events: [],
        meta: {
          extractionMode: "catalog-only",
          windowDays,
          orderAccessDenied: true,
        },
      };
    }

    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "quick_scan.bulk_fallback",
      message: "Bulk operation extraction failed; falling back to paginated GraphQL queries.",
      data: { error: bulkError instanceof Error ? bulkError.message : String(bulkError) },
    });
    const fallback = await extractQuickScanDataWithPaginatedQueries({ admin, windowDays, shop, jobId });
    return {
      ...fallback,
      meta: {
        extractionMode: "paginated-fallback",
        windowDays,
        bulkError: getErrorMessage(bulkError),
      },
    };
  }
}

async function recordOrderAccessUnavailableLog({ shop, jobId, mode }) {
  await recordJobLog({
    shop,
    jobId,
    level: "warn",
    event: "quick_scan.orders_unavailable",
    message: "Shopify denied access to orders. QuickScan will complete with product catalog data only until Order object access is approved.",
    data: {
      code: "SHOPIFY_ORDER_ACCESS_DENIED",
      mode,
      recovery: "catalog-only",
    },
  });
}

async function runBulkQuery(admin, bulkQuery, label, context) {
  await recordJobLog({
    ...context,
    event: "quick_scan.bulk_started",
    message: `Started Shopify bulk operation for ${label}.`,
  });
  const operation = await createBulkOperation(admin, bulkQuery);
  const completed = await pollBulkOperation(admin, operation.id, label);
  const url = completed.url || completed.partialDataUrl;
  if (!url) {
    await recordJobLog({
      ...context,
      level: "warn",
      event: "quick_scan.bulk_no_url",
      message: `Shopify bulk operation for ${label} completed without a downloadable URL.`,
      data: {
        operationId: operation.id,
        status: completed.status,
        objectCount: completed.objectCount,
        rootObjectCount: completed.rootObjectCount,
      },
    });
    return [];
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to download ${label} bulk results (${response.status}).`);
  }

  const lines = parseJsonl(await response.text());
  await recordJobLog({
    ...context,
    event: "quick_scan.bulk_completed",
    message: `Completed Shopify bulk operation for ${label}.`,
    data: {
      operationId: operation.id,
      status: completed.status,
      objectCount: completed.objectCount,
      rootObjectCount: completed.rootObjectCount,
      lineCount: lines.length,
    },
  });
  return lines;
}

async function createBulkOperation(admin, bulkQuery) {
  try {
    return await createBulkOperationModern(admin, bulkQuery);
  } catch (error) {
    if (!/groupObjects|Unknown argument|not defined|not used/i.test(getErrorMessage(error))) {
      throw error;
    }
    return createBulkOperationLegacy(admin, bulkQuery);
  }
}

async function createBulkOperationModern(admin, bulkQuery) {
  const data = await shopifyGraphql(
    admin,
    `#graphql
    mutation ProductPulseBulkQuickScan($query: String!, $groupObjects: Boolean!) {
      bulkOperationRunQuery(query: $query, groupObjects: $groupObjects) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { query: bulkQuery, groupObjects: false },
  );

  return getBulkOperationFromMutation(data);
}

async function createBulkOperationLegacy(admin, bulkQuery) {
  const data = await shopifyGraphql(
    admin,
    `#graphql
    mutation ProductPulseBulkQuickScan($query: String!) {
      bulkOperationRunQuery(query: $query) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { query: bulkQuery },
  );

  return getBulkOperationFromMutation(data);
}

function getBulkOperationFromMutation(data) {
  const payload = data?.bulkOperationRunQuery;
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
  if (!payload?.bulkOperation?.id) {
    throw new Error("Shopify did not create a bulk operation.");
  }
  return payload.bulkOperation;
}

async function pollBulkOperation(admin, operationId, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < BULK_OPERATION_TIMEOUT_MS) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseCurrentBulkOperation {
        currentBulkOperation {
          id
          status
          errorCode
          objectCount
          rootObjectCount
          url
          partialDataUrl
          createdAt
          completedAt
        }
      }`,
    );
    const operation = data?.currentBulkOperation;

    if (operation?.id === operationId && operation.status === "COMPLETED") return operation;
    if (operation?.id === operationId && ["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`${label} bulk operation ${operation.status.toLowerCase()}${operation.errorCode ? `: ${operation.errorCode}` : ""}.`);
    }

    await sleep(BULK_OPERATION_POLL_INTERVAL_MS);
  }

  throw new Error(`${label} bulk operation timed out.`);
}

async function extractSupplementalRefundEvents({ admin, windowDays, shop, jobId }) {
  try {
    const events = await extractRefundEventsWithPaginatedQueries({ admin, windowDays });
    await recordJobLog({
      shop,
      jobId,
      event: "quick_scan.refunds_extracted",
      message: "Supplemental refund line items extracted with low-cost paginated queries.",
      data: { refundEvents: events.length },
    });
    return events;
  } catch (error) {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "quick_scan.refunds_skipped",
      message: "Supplemental refund extraction failed; QuickScan will continue with sales and returns.",
      data: { error: getErrorMessage(error) },
    });
    return [];
  }
}

async function extractQuickScanDataWithPaginatedQueries({ admin, windowDays, shop, jobId }) {
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.paginated_started",
    message: "Started low-cost paginated Shopify extraction.",
    data: {
      productsPageSize: PAGINATED_PRODUCTS_PAGE_SIZE,
      ordersPageSize: PAGINATED_ORDERS_PAGE_SIZE,
    },
  });

  const products = await extractProductsWithPaginatedQueries({ admin });
  const salesEvents = await extractOptionalPaginatedEvents({
    shop,
    jobId,
    label: "sales",
    extractor: () => extractOrderLineItemEventsWithPaginatedQueries({ admin, windowDays }),
  });
  const refundEvents = await extractOptionalPaginatedEvents({
    shop,
    jobId,
    label: "refunds",
    extractor: () => extractRefundEventsWithPaginatedQueries({ admin, windowDays }),
  });
  const returnEvents = await extractOptionalPaginatedEvents({
    shop,
    jobId,
    label: "returns",
    extractor: () => extractReturnEventsWithPaginatedQueries({ admin, windowDays }),
  });

  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.paginated_completed",
    message: "Low-cost paginated Shopify extraction completed.",
    data: {
      products: products.length,
      salesEvents: salesEvents.length,
      refundEvents: refundEvents.length,
      returnEvents: returnEvents.length,
    },
  });

  return {
    products: products.map(normalizeProduct),
    events: [...salesEvents, ...refundEvents, ...returnEvents].filter(Boolean),
  };
}

async function extractOptionalPaginatedEvents({ shop, jobId, label, extractor }) {
  try {
    return await extractor();
  } catch (error) {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: `quick_scan.${label}_skipped`,
      message: `Paginated ${label} extraction failed; QuickScan will continue without that signal group.`,
      data: { error: getErrorMessage(error) },
    });
    return [];
  }
}

async function extractProductsWithPaginatedQueries({ admin }) {
  const products = [];
  let productsCursor;
  let hasNextProductsPage = true;

  while (hasNextProductsPage) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseProductsPage(
        $after: String,
        $productsFirst: Int!,
        $collectionsFirst: Int!,
        $variantsFirst: Int!
      ) {
        products(first: $productsFirst, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            handle
            title
            vendor
            productType
            tags
            status
            options {
              name
              values
            }
            collections(first: $collectionsFirst) {
              nodes {
                id
                handle
                title
              }
            }
            variants(first: $variantsFirst) {
              nodes {
                id
                title
                sku
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }`,
      {
        after: productsCursor || null,
        productsFirst: PAGINATED_PRODUCTS_PAGE_SIZE,
        collectionsFirst: PAGINATED_PRODUCT_COLLECTIONS_PAGE_SIZE,
        variantsFirst: PAGINATED_PRODUCT_VARIANTS_PAGE_SIZE,
      },
    );
    products.push(...(data?.products?.nodes || []));
    hasNextProductsPage = Boolean(data?.products?.pageInfo?.hasNextPage);
    productsCursor = data?.products?.pageInfo?.endCursor;
  }

  return products;
}

async function extractOrderLineItemEventsWithPaginatedQueries({ admin, windowDays }) {
  const events = [];
  let ordersCursor;
  let hasNextOrdersPage = true;
  const orderQuery = `created_at:>=${getSinceDate(windowDays)}`;

  while (hasNextOrdersPage) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseSalesPage($after: String, $query: String!, $ordersFirst: Int!, $lineItemsFirst: Int!) {
        orders(first: $ordersFirst, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            lineItems(first: $lineItemsFirst) {
              nodes {
                id
                quantity
                title
                sku
                product {
                  id
                  handle
                  title
                }
                variant {
                  id
                  title
                  sku
                  selectedOptions {
                    name
                    value
                  }
                }
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }`,
      {
        after: ordersCursor || null,
        query: orderQuery,
        ordersFirst: PAGINATED_ORDERS_PAGE_SIZE,
        lineItemsFirst: PAGINATED_ORDER_LINE_ITEMS_PAGE_SIZE,
      },
    );

    (data?.orders?.nodes || []).forEach((order) => {
      const orderContext = { id: order.id, createdAt: order.createdAt };
      getNodes(order.lineItems).forEach((lineItem) => {
        events.push(normalizeOrderLineItemEvent(lineItem, orderContext));
      });
    });
    hasNextOrdersPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
    ordersCursor = data?.orders?.pageInfo?.endCursor;
  }

  return events.filter(Boolean);
}

async function extractRefundEventsWithPaginatedQueries({ admin, windowDays }) {
  const events = [];
  let ordersCursor;
  let hasNextOrdersPage = true;
  const orderQuery = `created_at:>=${getSinceDate(windowDays)}`;

  while (hasNextOrdersPage) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseRefundsPage($after: String, $query: String!, $ordersFirst: Int!, $refundLineItemsFirst: Int!) {
        orders(first: $ordersFirst, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            refunds {
              id
              createdAt
              refundLineItems(first: $refundLineItemsFirst) {
                nodes {
                  id
                  quantity
                  restockType
                  subtotalSet {
                    shopMoney {
                      amount
                    }
                  }
                  lineItem {
                    id
                    quantity
                    title
                    sku
                    product {
                      id
                      handle
                      title
                    }
                    variant {
                      id
                      title
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
          }
        }
      }`,
      {
        after: ordersCursor || null,
        query: orderQuery,
        ordersFirst: PAGINATED_ORDERS_PAGE_SIZE,
        refundLineItemsFirst: PAGINATED_REFUND_LINE_ITEMS_PAGE_SIZE,
      },
    );

    (data?.orders?.nodes || []).forEach((order) => {
      (order.refunds || []).forEach((refund) => {
        getNodes(refund.refundLineItems).forEach((refundLineItem) => {
          events.push(normalizeRefundLineItemEvent(refundLineItem, { id: refund.id, createdAt: refund.createdAt || order.createdAt, orderId: order.id }));
        });
      });
    });
    hasNextOrdersPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
    ordersCursor = data?.orders?.pageInfo?.endCursor;
  }

  return events.filter(Boolean);
}

async function extractReturnEventsWithPaginatedQueries({ admin, windowDays }) {
  const events = [];
  let ordersCursor;
  let hasNextOrdersPage = true;
  const orderQuery = `created_at:>=${getSinceDate(windowDays)}`;

  while (hasNextOrdersPage) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseReturnsPage(
        $after: String,
        $query: String!,
        $ordersFirst: Int!,
        $returnsFirst: Int!,
        $returnLineItemsFirst: Int!
      ) {
        orders(first: $ordersFirst, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            returns(first: $returnsFirst) {
              nodes {
                id
                createdAt
                status
                returnLineItems(first: $returnLineItemsFirst) {
                  nodes {
                    ... on ReturnLineItem {
                      id
                      quantity
                      processedQuantity
                      refundedQuantity
                      customerNote
                      returnReason
                      returnReasonNote
                      fulfillmentLineItem {
                        lineItem {
                          id
                          title
                          sku
                          product {
                            id
                            handle
                            title
                          }
                          variant {
                            id
                            title
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
                }
              }
            }
          }
        }
      }`,
      {
        after: ordersCursor || null,
        query: orderQuery,
        ordersFirst: PAGINATED_ORDERS_PAGE_SIZE,
        returnsFirst: PAGINATED_RETURNS_PAGE_SIZE,
        returnLineItemsFirst: PAGINATED_RETURN_LINE_ITEMS_PAGE_SIZE,
      },
    );

    (data?.orders?.nodes || []).forEach((order) => {
      getNodes(order.returns).forEach((itemReturn) => {
        getNodes(itemReturn.returnLineItems).forEach((returnLineItem) => {
          events.push(normalizeReturnLineItemEvent(returnLineItem, { id: itemReturn.id, createdAt: itemReturn.createdAt || order.createdAt, orderId: order.id }));
        });
      });
    });
    hasNextOrdersPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
    ordersCursor = data?.orders?.pageInfo?.endCursor;
  }

  return events.filter(Boolean);
}

function normalizeBulkQuickScanData(catalogLines, orderLines) {
  const products = normalizeBulkProducts(catalogLines);
  const events = normalizeBulkOrderEvents(orderLines);
  return { products, events };
}

function normalizeBulkProducts(lines) {
  const products = new Map();

  lines.forEach((line) => {
    if (!line?.id) return;

    if (line.__typename === "Product" || isProductLike(line)) {
      products.set(line.id, normalizeProduct({
        id: line.id,
        handle: line.handle,
        title: line.title,
        vendor: line.vendor,
        productType: line.productType,
        tags: line.tags,
        status: line.status,
        options: line.options,
        variants: [],
        collections: [],
      }));
      return;
    }

    const parentId = line.__parentId;
    const product = products.get(parentId);
    if (!product) return;

    if (line.__typename === "ProductVariant" || "selectedOptions" in line || "sku" in line) {
      product.variants.push(normalizeVariant(line));
    } else if (line.__typename === "Collection" || "handle" in line) {
      product.collections.push({ id: line.id, handle: line.handle || "", title: line.title || "" });
    }
  });

  return Array.from(products.values());
}

function normalizeBulkOrderEvents(lines) {
  const orders = new Map();
  const refunds = new Map();
  const returns = new Map();
  const events = [];

  lines.forEach((line) => {
    if (!line?.id) return;

    if (line.__typename === "Order" || ("createdAt" in line && !line.__parentId)) {
      orders.set(line.id, { id: line.id, createdAt: line.createdAt });
      (line.refunds || []).forEach((refund) => {
        getNodes(refund.refundLineItems).forEach((refundLineItem) => {
          events.push(normalizeRefundLineItemEvent(refundLineItem, { id: refund.id, createdAt: refund.createdAt, orderId: line.id }));
        });
      });
      return;
    }

    if (line.__typename === "Refund") {
      const order = orders.get(line.__parentId);
      refunds.set(line.id, { id: line.id, createdAt: line.createdAt || order?.createdAt, orderId: line.__parentId });
      return;
    }

    if (line.__typename === "Return") {
      const order = orders.get(line.__parentId);
      returns.set(line.id, { id: line.id, createdAt: line.createdAt || order?.createdAt, orderId: line.__parentId });
      return;
    }

    if (line.__typename === "LineItem" || ("quantity" in line && line.__parentId && orders.has(line.__parentId))) {
      const order = orders.get(line.__parentId);
      events.push(normalizeOrderLineItemEvent(line, order));
      return;
    }

    if (line.__typename === "RefundLineItem" || ("restockType" in line && refunds.has(line.__parentId))) {
      const refund = refunds.get(line.__parentId);
      events.push(normalizeRefundLineItemEvent(line, refund));
      return;
    }

    if (line.__typename === "ReturnLineItem" || ("returnReason" in line && returns.has(line.__parentId))) {
      const itemReturn = returns.get(line.__parentId);
      events.push(normalizeReturnLineItemEvent(line, itemReturn));
    }
  });

  return events.filter(Boolean);
}

function normalizeOrderLineItemEvent(lineItem, order) {
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};

  return {
    type: "sale",
    occurredAt: order?.createdAt,
    productId: product.id,
    variantId: variant.id,
    handle: product.handle,
    title: product.title || lineItem.title,
    quantity: toNumber(lineItem.quantity),
    amount: moneyAmount(lineItem.originalTotalSet),
    variantTitle: variant.title,
    variantSku: variant.sku || lineItem.sku,
    variantOptions: variant.selectedOptions || [],
  };
}

function normalizeRefundLineItemEvent(refundLineItem, refund) {
  const lineItem = refundLineItem.lineItem || {};
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};

  return {
    type: "refund",
    occurredAt: refundLineItem.createdAt || refund?.createdAt,
    productId: product.id,
    variantId: variant.id,
    handle: product.handle,
    title: product.title || lineItem.title,
    quantity: toNumber(refundLineItem.quantity),
    amount: moneyAmount(refundLineItem.subtotalSet),
    reason: refundLineItem.restockType || "Refund",
    variantTitle: variant.title,
    variantSku: variant.sku || lineItem.sku,
    variantOptions: variant.selectedOptions || [],
  };
}

function normalizeReturnLineItemEvent(returnLineItem, itemReturn) {
  const lineItem = returnLineItem.fulfillmentLineItem?.lineItem || {};
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};
  return {
    type: "return",
    occurredAt: returnLineItem.createdAt || itemReturn?.createdAt,
    productId: product.id,
    variantId: variant.id,
    handle: product.handle,
    title: product.title || lineItem.title,
    quantity: toNumber(returnLineItem.quantity || returnLineItem.processedQuantity || returnLineItem.refundedQuantity),
    amount: moneyAmount(returnLineItem.withCodeDiscountedTotalPriceSet),
    reason: returnLineItem.returnReason || "Return",
    reasonHandle: returnLineItem.returnReason,
    note: [returnLineItem.returnReasonNote, returnLineItem.customerNote].filter(Boolean).join(" "),
    variantTitle: variant.title,
    variantSku: variant.sku || lineItem.sku,
    variantOptions: variant.selectedOptions || [],
  };
}

function normalizeProduct(product) {
  return {
    id: product.id,
    handle: product.handle || getHandleFromTitle(product.title),
    title: product.title || "Untitled product",
    vendor: product.vendor || "",
    productType: product.productType || "",
    tags: Array.isArray(product.tags) ? product.tags : [],
    status: product.status || "",
    options: Array.isArray(product.options) ? product.options : [],
    variants: getNodes(product.variants).map(normalizeVariant),
    collections: getNodes(product.collections).map((collection) => ({
      id: collection.id,
      handle: collection.handle || "",
      title: collection.title || "",
    })),
  };
}

function normalizeVariant(variant) {
  return {
    id: variant.id,
    title: variant.title || "",
    sku: variant.sku || "",
    selectedOptions: Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [],
  };
}

function getProductAggregate(aggregates, product) {
  if (!aggregates.has(product.id)) {
    aggregates.set(product.id, {
      product,
      soldUnits: 0,
      salesAmount: 0,
      refundUnits: 0,
      refundAmount: 0,
      returnUnits: 0,
      recentSignalUnits: 0,
      totalSignalUnits: 0,
      returnReasons: new Map(),
      notes: [],
      affectedVariants: new Map(),
      lastSignalAt: null,
      signalEvents: [],
    });
  }

  return aggregates.get(product.id);
}

function applyEventToAggregate(aggregate, event) {
  const quantity = Math.max(toNumber(event.quantity), 0);

  if (event.type === "sale") {
    aggregate.soldUnits += quantity;
    aggregate.salesAmount += toNumber(event.amount);
    return;
  }

  if (event.type === "refund") {
    aggregate.refundUnits += quantity;
    aggregate.refundAmount += toNumber(event.amount);
  }

  if (event.type === "return") {
    aggregate.returnUnits += quantity;
    addCount(aggregate.returnReasons, normalizeReason(event.reason || event.reasonHandle || "Return"), quantity || 1);
    if (event.note) aggregate.notes.push(event.note);
  }

  aggregate.totalSignalUnits += quantity || 1;
  aggregate.signalEvents.push({
    type: event.type,
    quantity: quantity || 1,
    occurredAt: event.occurredAt || null,
  });
  if (isRecentSignal(event.occurredAt)) aggregate.recentSignalUnits += quantity || 1;
  if (event.occurredAt && (!aggregate.lastSignalAt || new Date(event.occurredAt) > new Date(aggregate.lastSignalAt))) {
    aggregate.lastSignalAt = event.occurredAt;
  }
  const variantLabel = getVariantLabel(event);
  addCount(aggregate.affectedVariants, variantLabel, quantity || 1);
}

function getStoreTotals(aggregates) {
  const totals = aggregates.reduce((sum, aggregate) => ({
    soldUnits: sum.soldUnits + aggregate.soldUnits,
    refundUnits: sum.refundUnits + aggregate.refundUnits,
    returnUnits: sum.returnUnits + aggregate.returnUnits,
    refundAmount: sum.refundAmount + aggregate.refundAmount,
    productsWithSales: sum.productsWithSales + (aggregate.soldUnits > 0 ? 1 : 0),
  }), { soldUnits: 0, refundUnits: 0, returnUnits: 0, refundAmount: 0, productsWithSales: 0 });

  return {
    ...totals,
    avgReturnRate: safeRate(totals.returnUnits, totals.soldUnits),
    avgRefundRate: safeRate(totals.refundUnits, totals.soldUnits),
    avgRefundAmount: totals.refundAmount / Math.max(totals.productsWithSales, 1),
  };
}

function scoreProductAggregate(aggregate, storeTotals, { windowDays, extractionMode }) {
  const returnRate = safeRate(aggregate.returnUnits, aggregate.soldUnits);
  const refundRate = safeRate(aggregate.refundUnits, aggregate.soldUnits);
  const returnRatePercent = roundPercent(returnRate);
  const refundRatePercent = roundPercent(refundRate);
  const topReasons = topEntries(aggregate.returnReasons, 4);
  const affectedVariants = topEntries(aggregate.affectedVariants, 4);
  const returnAnomaly = anomalyScore(returnRate, storeTotals.avgReturnRate, 30);
  const refundAnomaly = anomalyScore(refundRate, storeTotals.avgRefundRate, 22);
  const refundImpact = clamp((aggregate.refundAmount / Math.max(storeTotals.avgRefundAmount, 1)) * 10, 0, 18);
  const repeatedReasons = clamp(topReasons.reduce((sum, reason) => sum + reason.count, 0) * 3 + topReasons.length * 2, 0, 16);
  const variantConcentration = getVariantConcentrationScore(aggregate, affectedVariants);
  const recentSpike = getRecentSpikeScore(aggregate);
  const volumeWeight = clamp(Math.log10(Math.max(aggregate.soldUnits, 1)) * 6, 0, 10);
  const riskScore = Math.round(clamp(
    returnAnomaly + refundAnomaly + refundImpact + repeatedReasons + variantConcentration + recentSpike + volumeWeight,
    0,
    100,
  ));

  const primaryIssue = getPrimaryIssue({
    topReasons,
    notes: aggregate.notes,
    refundRate,
    returnRate,
  });
  const signalCount = aggregate.returnUnits + aggregate.refundUnits + topReasons.reduce((sum, reason) => sum + reason.count, 0);
  const signalTrend = buildSignalTrend(aggregate.signalEvents, windowDays);
  const riskTrend = buildRiskTrend(signalTrend, riskScore);

  return {
    productGid: aggregate.product.id,
    productTitle: aggregate.product.title,
    handle: aggregate.product.handle,
    riskScore,
    impactScore: Math.round(clamp(refundImpact * 3 + aggregate.refundAmount / 500 + signalCount, 0, 100)),
    confidence: Math.round(clamp(55 + signalCount * 4 + affectedVariants.length * 3, 45, 92)),
    primaryIssue,
    sourceCoverage: getSourceCoverage(aggregate),
    metrics: {
      windowDays,
      extractionMode,
      soldUnits: aggregate.soldUnits,
      salesAmount: roundMoney(aggregate.salesAmount),
      avgUnitRevenue: roundMoney(aggregate.soldUnits > 0 ? aggregate.salesAmount / aggregate.soldUnits : 0),
      returnUnits: aggregate.returnUnits,
      refundUnits: aggregate.refundUnits,
      returnRate: returnRatePercent,
      refundRate: refundRatePercent,
      storeAvgReturnRate: roundPercent(storeTotals.avgReturnRate),
      storeAvgRefundRate: roundPercent(storeTotals.avgRefundRate),
      refundAmount: roundMoney(aggregate.refundAmount),
      revenueAtRisk: roundMoney(Math.max(aggregate.refundAmount, aggregate.salesAmount * Math.max(returnRate, refundRate))),
      marginAtRisk: roundMoney(Math.max(aggregate.refundAmount * 0.38, aggregate.salesAmount * Math.max(returnRate, refundRate) * 0.28)),
      signalCount,
      topReturnReasons: topReasons.map((reason) => reason.label),
      affectedVariants: affectedVariants.map((variant) => variant.label),
      recentSignalUnits: aggregate.recentSignalUnits,
      lastSignalAt: aggregate.lastSignalAt,
      signalTrend,
      riskTrend,
      productType: aggregate.product.productType,
      vendor: aggregate.product.vendor,
      tags: aggregate.product.tags,
      collections: aggregate.product.collections.map((collection) => collection.title).filter(Boolean),
    },
  };
}

async function persistQuickScanCandidates(shop, candidates) {
  const productGids = candidates.map((candidate) => candidate.productGid);

  await prisma.$transaction(async (tx) => {
    if (productGids.length) {
      await tx.productRiskSnapshot.deleteMany({
        where: {
          shop,
          productGid: { notIn: productGids },
        },
      });
    } else {
      await tx.productRiskSnapshot.deleteMany({ where: { shop } });
    }

    await Promise.all(candidates.map((candidate) => tx.productRiskSnapshot.upsert({
      where: {
        shop_productGid: {
          shop,
          productGid: candidate.productGid,
        },
      },
      create: {
        shop,
        productGid: candidate.productGid,
        productTitle: candidate.productTitle,
        handle: candidate.handle,
        riskScore: candidate.riskScore,
        impactScore: candidate.impactScore,
        confidence: candidate.confidence,
        primaryIssue: candidate.primaryIssue,
        sourceCoverage: candidate.sourceCoverage,
        metrics: candidate.metrics,
      },
      update: {
        productTitle: candidate.productTitle,
        handle: candidate.handle,
        riskScore: candidate.riskScore,
        impactScore: candidate.impactScore,
        confidence: candidate.confidence,
        primaryIssue: candidate.primaryIssue,
        sourceCoverage: candidate.sourceCoverage,
        metrics: candidate.metrics,
        calculatedAt: new Date(),
      },
    })));
  });
}

async function updateQuickScanJob(jobId, data) {
  await prisma.catalogSignalJob.update({
    where: { id: jobId },
    data,
  });
}

async function shopifyGraphql(admin, query, variables) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  return json.data;
}

function isPersistableCandidate(candidate, storeTotals) {
  return (
    candidate.riskScore >= 50 ||
    candidate.metrics.returnRate >= Math.max(storeTotals.avgReturnRate * 100 * 2, 8) ||
    candidate.metrics.refundAmount >= Math.max(storeTotals.avgRefundAmount, 250) ||
    candidate.metrics.topReturnReasons.length >= 2
  );
}

function getSourceCoverage(aggregate) {
  const sources = ["Shopify products"];
  if (aggregate.soldUnits > 0) sources.push("Shopify orders");
  if (aggregate.refundUnits > 0) sources.push("Shopify refunds");
  if (aggregate.returnUnits > 0) sources.push("Shopify returns");
  return sources;
}

function getPrimaryIssue({ topReasons, notes, refundRate, returnRate }) {
  const text = `${topReasons.map((reason) => reason.label).join(" ")} ${notes.join(" ")}`.toLowerCase();
  if (/too small|too large|size|fit|waist|inseam|tight|loose/.test(text)) return "Fit & sizing";
  if (/defect|damaged|broken|quality|faulty|zipper|tear|crack/.test(text)) return "Product defect or durability";
  if (/color|not as described|description|photo|image|style/.test(text)) return "Expectation mismatch";
  if (returnRate > refundRate && returnRate > 0) return "Return rate anomaly";
  if (refundRate > 0) return "Refund impact";
  return "Product quality signal";
}

function getVariantConcentrationScore(aggregate, affectedVariants) {
  if (!aggregate.totalSignalUnits || !affectedVariants.length) return 0;
  const topVariantShare = affectedVariants[0].count / Math.max(aggregate.totalSignalUnits, 1);
  if (aggregate.totalSignalUnits < 3) return 0;
  return clamp(topVariantShare * 14, 0, 12);
}

function getRecentSpikeScore(aggregate) {
  if (!aggregate.totalSignalUnits) return 0;
  const recentShare = aggregate.recentSignalUnits / aggregate.totalSignalUnits;
  if (aggregate.totalSignalUnits < 3) return recentShare >= 0.75 ? 8 : 0;
  return clamp(recentShare * 12, 0, 12);
}

function buildSignalTrend(events, windowDays) {
  const buckets = Array.from({ length: 7 }, () => 0);
  const windowMs = Math.max(windowDays, 1) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  events.forEach((event) => {
    const timestamp = new Date(event.occurredAt).getTime();
    if (Number.isNaN(timestamp)) return;
    const elapsed = clamp(now - timestamp, 0, windowMs);
    const position = 1 - elapsed / windowMs;
    const bucketIndex = Math.min(6, Math.max(0, Math.floor(position * buckets.length)));
    buckets[bucketIndex] += Math.max(toNumber(event.quantity), 1);
  });

  return buckets.map((value) => Math.round(value * 10) / 10);
}

function buildRiskTrend(signalTrend, riskScore) {
  const total = signalTrend.reduce((sum, value) => sum + value, 0);
  if (!total) return signalTrend.map(() => 0);

  let cumulative = 0;
  return signalTrend.map((value) => {
    cumulative += value;
    return Math.round(clamp((cumulative / total) * riskScore, 0, 100));
  });
}

function anomalyScore(rate, average, maxScore) {
  if (rate <= 0) return 0;
  if (average <= 0) return clamp(rate * 100 * 1.8, 0, maxScore);
  return clamp((rate / average - 1) * (maxScore / 1.5), 0, maxScore);
}

function getVariantLabel(event) {
  if (event.variantOptions?.length) {
    return event.variantOptions.map((option) => option.value).filter(Boolean).join(" / ");
  }
  if (event.variantTitle && event.variantTitle !== "Default Title") return event.variantTitle;
  if (event.variantSku) return event.variantSku;
  return "Default variant";
}

function normalizeReason(reason) {
  return String(reason || "Return")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function topEntries(map, limit) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function addCount(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function moneyAmount(moneyBag) {
  return toNumber(moneyBag?.shopMoney?.amount);
}

function safeRate(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function roundPercent(value) {
  return Math.round(value * 1000) / 10;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, min), max);
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function isRecentSignal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= 14 * 24 * 60 * 60 * 1000;
}

function getSinceDate(windowDays) {
  const date = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function getNodes(connection) {
  if (Array.isArray(connection)) return connection;
  if (Array.isArray(connection?.nodes)) return connection.nodes;
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge.node).filter(Boolean);
  return [];
}

function isProductLike(line) {
  return "handle" in line && "title" in line && !line.__parentId;
}

function getHandleFromTitle(title) {
  return String(title || "untitled-product")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function isShopifyOrderAccessDeniedError(error, contextLabel = "") {
  const message = getErrorMessage(error);
  if (!/ACCESS_DENIED|not approved to access/i.test(message)) return false;
  return /orders?/i.test(contextLabel) || /Order object|orders?\b/i.test(message);
}

async function waitForMinimumDuration(startedAt, minimumDurationMs) {
  const remaining = minimumDurationMs - (Date.now() - startedAt);
  if (remaining > 0) await sleep(remaining);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const PRODUCT_CATALOG_BULK_QUERY = `{
  products {
    edges {
      node {
        __typename
        id
        handle
        title
        vendor
        productType
        tags
        status
        options {
          name
          values
        }
        collections {
          edges {
            node {
              __typename
              id
              handle
              title
            }
          }
        }
        variants {
          edges {
            node {
              __typename
              id
              title
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
  }
}`;

export function buildOrdersBulkQuery(windowDays) {
  return `{
    orders(query: "created_at:>=${getSinceDate(windowDays)}") {
      edges {
        node {
          __typename
          id
          createdAt
          lineItems {
            edges {
              node {
                __typename
                id
                quantity
                title
                sku
                product {
                  id
                  handle
                  title
                }
                variant {
                  id
                  title
                  sku
                  selectedOptions {
                    name
                    value
                  }
                }
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
          returns {
            edges {
              node {
                __typename
                id
                createdAt
                status
                returnLineItems {
                  edges {
                    node {
                      __typename
                      ... on ReturnLineItem {
                        id
                        quantity
                        processedQuantity
                        refundedQuantity
                        customerNote
                        returnReason
                        returnReasonNote
                        fulfillmentLineItem {
                          lineItem {
                            id
                            title
                            sku
                            product {
                              id
                              handle
                              title
                            }
                            variant {
                              id
                              title
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
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;
}
