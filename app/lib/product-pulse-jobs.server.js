import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getQuickScanWindowDays,
  runShopifyQuickScan,
} from "./product-pulse-quick-scan.server";
import { buildAnalyticsViewData, buildDashboardViewData } from "./product-pulse-data";
import { runDetailedProductDiagnosis } from "./product-pulse-diagnosis.server";
import {
  getJobLogsForShop,
  recordJobLog,
  serializeError,
} from "./product-pulse-job-logs.server";
import {
  PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
  getProductPulseSettings,
  getRiskFilterValueForScore,
  getRiskLabelForScore,
  getRiskToneForScore,
  getStatusFilterValueForScore,
  getStatusLabelForScore,
} from "./product-pulse-settings.server";

const FAST_PRODUCT_SCAN_KIND = "fast-product-scan";
const PRODUCT_DIAGNOSIS_KIND = "product-diagnosis";
const STALE_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const activeWorkers = global.productPulseJobWorkers || new Set();
const activeDiagnosisQueueWorkers = global.productPulseDiagnosisQueueWorkers || new Set();

if (!global.productPulseJobWorkers) {
  global.productPulseJobWorkers = activeWorkers;
}

if (!global.productPulseDiagnosisQueueWorkers) {
  global.productPulseDiagnosisQueueWorkers = activeDiagnosisQueueWorkers;
}

export async function startFastProductScan(input, adminArg, scopesArg) {
  const { shop, admin, scopes } = normalizeStartArgs(input, adminArg, scopesArg);
  await failStaleFastProductScans(shop);

  const activeJob = await getActiveFastProductScan(shop);
  if (activeJob) {
    ensureFastProductScanWorker(activeJob, { admin, scopes });
    await recordJobLog({
      shop,
      jobId: activeJob.id,
      event: "quick_scan.already_running",
      message: "Fast product scan request reused the active background job.",
      data: { status: activeJob.status, source: activeJob.source },
    });
    return {
      status: "success",
      suppressBanner: true,
      message: "Fast product scan is already running.",
      job: formatJob(activeJob),
    };
  }

  const windowDays = getQuickScanWindowDays(scopes);
  const job = await prisma.catalogSignalJob.create({
    data: {
      shop,
      kind: FAST_PRODUCT_SCAN_KIND,
      source: `Queued Shopify QuickScan - ${windowDays}-day order window`,
      status: "Queued",
      progress: 0,
    },
  });

  ensureFastProductScanWorker(job, { admin, scopes });
  await recordJobLog({
    shop,
    jobId: job.id,
    event: "quick_scan.queued",
    message: "QuickScan queued as a persistent background job.",
    data: {
      windowDays,
      scopeMode: "default_orders_window",
    },
  });

  return {
    status: "success",
    suppressBanner: true,
    message: "QuickScan started. ProductPulse is checking native Shopify product, order, refund and return signals.",
    job: formatJob(job),
  };
}

export async function getProductsQueueForShop(shop, admin, filters = {}, options = {}) {
  await failStaleFastProductScans(shop);
  const [snapshots, activeJob, activeDiagnosisJobs, settings] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
    }),
    getActiveFastProductScan(shop),
    getActiveProductDiagnosisJobs(shop),
    options.settings ? Promise.resolve(options.settings) : getProductPulseSettings(shop),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);
  const [latestDiagnosisByProductGid, resolvedActionsByProductGid] = await Promise.all([
    getLatestCompletedDiagnosisMap(shop, snapshots),
    getResolvedProductActionsMap(shop, snapshots),
  ]);
  const filterOptions = getProductTableFilterOptions(snapshots, resolvedActionsByProductGid, settings);
  const filteredSnapshots = sortProductSnapshots(
    filterProductSnapshots(snapshots, filters, resolvedActionsByProductGid, settings),
    filters,
    resolvedActionsByProductGid,
  );
  const rowsPerPage = normalizeRowsPerPage(filters.rows);
  const totalPages = Math.max(1, Math.ceil(filteredSnapshots.length / rowsPerPage));
  const page = Math.min(normalizePositiveInteger(filters.page, 1), totalPages);
  const pageSnapshots = filteredSnapshots.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const rows = pageSnapshots.map((snapshot) => formatProductRow(
    snapshot,
    latestDiagnosisByProductGid.get(snapshot.productGid),
    resolvedActionsByProductGid.get(snapshot.productGid),
    settings,
  ));
  const rowsWithImages = await attachProductImages(rows, admin);
  const rowsWithJobs = attachActiveProductDiagnosisJobs(rowsWithImages, activeDiagnosisJobs);

  return {
    rows: rowsWithJobs,
    total: filteredSnapshots.length,
    totalAll: snapshots.length,
    page,
    rowsPerPage,
    totalPages,
    filterOptions,
    settings,
    activeScanJob: activeJob ? formatJob(activeJob) : null,
    activeDiagnosisJobs: activeDiagnosisJobs.map(formatJob),
  };
}

export async function getDashboardDataForShop(shop, admin) {
  await failStaleFastProductScans(shop);
  const [snapshots, latestLedgerEntry, activeJob, activeDiagnosisJobs, settings] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.creditLedgerEntry.findFirst({
      where: { shop },
      orderBy: { createdAt: "desc" },
    }),
    getActiveFastProductScan(shop),
    getActiveProductDiagnosisJobs(shop),
    getProductPulseSettings(shop),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);

  const latestDiagnosisByProductGid = await getLatestCompletedDiagnosisMap(shop, snapshots);
  const dashboardProductsWithoutImages = snapshots.map((snapshot) => formatSnapshotForDiagnosis(
    snapshot,
    [],
    latestDiagnosisByProductGid.get(snapshot.productGid),
    settings,
  ));
  const dashboardProducts = await attachProductImages(dashboardProductsWithoutImages, admin);
  const dashboardProductsWithJobs = attachActiveProductDiagnosisJobs(dashboardProducts, activeDiagnosisJobs);

  return buildDashboardViewData(dashboardProductsWithJobs, {
    billing: latestLedgerEntry ? { creditsAvailable: latestLedgerEntry.balanceAfter } : null,
  });
}

export async function getAnalyticsDataForShop(shop) {
  await failStaleFastProductScans(shop);
  const [snapshots, activeJob, activeDiagnosisJobs, sources, actions, settings] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
    }),
    getActiveFastProductScan(shop),
    getActiveProductDiagnosisJobs(shop),
    prisma.productPulseSource.findMany({
      where: { shop, sourceKey: { not: PRODUCT_PULSE_SETTINGS_SOURCE_KEY } },
      orderBy: [{ category: "asc" }, { sourceKey: "asc" }],
    }),
    prisma.productAction.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    getProductPulseSettings(shop),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);

  const latestDiagnosisByProductGid = await getLatestCompletedDiagnosisMap(shop, snapshots);
  const analyticsProducts = snapshots.map((snapshot) => formatSnapshotForDiagnosis(
    snapshot,
    actions.filter((action) => action.productGid === snapshot.productGid).map(formatStoredProductAction),
    latestDiagnosisByProductGid.get(snapshot.productGid),
    settings,
  ));

  return buildAnalyticsViewData(analyticsProducts, {
    sources,
    actions,
  });
}

async function getLatestCompletedDiagnosisMap(shop, snapshots = []) {
  const productGids = [...new Set(snapshots.map((snapshot) => snapshot.productGid).filter(Boolean))];
  if (!productGids.length) return new Map();

  const diagnoses = await prisma.productDiagnosis.findMany({
    where: {
      shop,
      productGid: { in: productGids },
      status: "Completed",
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
  });

  const latestByProductGid = new Map();
  diagnoses.forEach((diagnosis) => {
    if (!latestByProductGid.has(diagnosis.productGid)) {
      latestByProductGid.set(diagnosis.productGid, diagnosis);
    }
  });
  return latestByProductGid;
}

async function getResolvedProductActionsMap(shop, snapshots = []) {
  const productGids = [...new Set(snapshots.map((snapshot) => snapshot.productGid).filter(Boolean))];
  if (!productGids.length) return new Map();

  const actions = await prisma.productAction.findMany({
    where: {
      shop,
      productGid: { in: productGids },
      actionType: "mark-resolved",
      status: "applied",
    },
    orderBy: [{ appliedAt: "desc" }, { createdAt: "desc" }],
  });

  const latestByProductGid = new Map();
  actions.forEach((action) => {
    if (!latestByProductGid.has(action.productGid)) latestByProductGid.set(action.productGid, action);
  });
  return latestByProductGid;
}

export async function runSelectedProductDiagnosesForShop(shop, productIds = [], options = {}) {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  if (!uniqueProductIds.length) {
    return { status: "validation_error", message: "Select at least one product to analyze." };
  }
  const settings = options.settings || await getProductPulseSettings(shop);
  const maxQueued = Number(settings.diagnosis?.maxQueuedPerSubmission || 25);
  if (uniqueProductIds.length > maxQueued) {
    return {
      status: "validation_error",
      message: `You can queue up to ${maxQueued} product diagnosis job${maxQueued === 1 ? "" : "s"} at once. Update this limit in Settings if needed.`,
    };
  }

  const jobs = [];
  for (const productId of uniqueProductIds) {
    const job = await createProductDiagnosisJob(shop, productId, options);
    if (job) jobs.push(job);
  }

  if (!jobs.length) {
    return { status: "validation_error", message: "Selected products were not found in ProductPulse or Shopify." };
  }

  ensureProductDiagnosisQueueWorker(shop);

  return {
    status: "success",
    suppressBanner: true,
    message: `${jobs.length} product diagnosis job${jobs.length === 1 ? "" : "s"} queued. They will run one at a time.`,
    queuedCount: jobs.length,
    jobs: jobs.map(formatJob),
  };
}

export async function getRecentJobsForShop(shop) {
  await failStaleFastProductScans(shop);
  const jobs = await prisma.catalogSignalJob.findMany({
    where: { shop },
    orderBy: [{ updatedAt: "desc" }],
    take: 12,
  });
  jobs.filter((job) => isActiveStatus(job.status)).forEach((job) => {
    if (job.kind === FAST_PRODUCT_SCAN_KIND) ensureFastProductScanWorker(job);
  });
  if (jobs.some((job) => job.kind === PRODUCT_DIAGNOSIS_KIND && isActiveStatus(job.status))) {
    ensureProductDiagnosisQueueWorker(shop);
  }
  return jobs.map(formatJob);
}

export async function getJobMonitorForShop(shop) {
  await failStaleFastProductScans(shop);
  const [jobs, logs] = await Promise.all([
    prisma.catalogSignalJob.findMany({
      where: { shop },
      orderBy: [{ updatedAt: "desc" }],
      take: 12,
    }),
    getJobLogsForShop(shop, 100),
  ]);

  jobs.filter((job) => isActiveStatus(job.status)).forEach((job) => {
    if (job.kind === FAST_PRODUCT_SCAN_KIND) ensureFastProductScanWorker(job);
  });
  if (jobs.some((job) => job.kind === PRODUCT_DIAGNOSIS_KIND && isActiveStatus(job.status))) {
    ensureProductDiagnosisQueueWorker(shop);
  }

  return {
    activeJobs: jobs.filter((job) => isActiveStatus(job.status)).map(formatJob),
    recentJobs: jobs.map(formatJob),
    logs: logs.map(formatJobLog),
    updatedAt: new Date().toISOString(),
  };
}

export async function getProductSnapshotForShop(shop, productId, admin) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

  const [actions, latestDiagnosis, activeDiagnosisJobs, settings] = await Promise.all([
    prisma.productAction.findMany({
      where: { shop, productGid: snapshot.productGid },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    }),
    prisma.productDiagnosis.findFirst({
      where: { shop, productGid: snapshot.productGid, status: "Completed" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    }),
    getActiveProductDiagnosisJobs(shop),
    getProductPulseSettings(shop),
  ]);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);
  const activeJob = findActiveProductDiagnosisJobForSnapshot(snapshot, activeDiagnosisJobs);
  const product = {
    ...formatSnapshotForDiagnosis(snapshot, actions, latestDiagnosis, settings),
    ...(activeJob ? { diagnosisJob: formatJob(activeJob) } : {}),
  };
  return attachProductImageToDiagnosis(withShopifyAdminUrl(product, shop), admin);
}

export async function getProductDetailForShop(shop, productId, admin) {
  const snapshotProduct = await getProductSnapshotForShop(shop, productId, admin);
  if (snapshotProduct) return snapshotProduct;
  return getLiveShopifyProductDetail(productId, admin, shop);
}

export async function rerunProductDiagnosisForShop(shop, productId) {
  return queueProductDiagnosisForShop(shop, productId);
}

export async function queueProductDiagnosisForShop(shop, productId) {
  const job = await createProductDiagnosisJob(shop, productId);
  if (!job) return null;
  ensureProductDiagnosisQueueWorker(shop);

  return {
    status: "success",
    suppressBanner: true,
    message: `AI Product Diagnosis queued for ${job.payload?.productTitle || "selected product"}.`,
    job: formatJob(job),
  };
}

export async function searchShopifyProductsForDiagnosis(shop, admin, rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2) {
    return { status: "validation_error", query, message: "Type at least 2 characters to search Shopify products.", products: [] };
  }
  if (!admin?.graphql) {
    return { status: "validation_error", query, message: "Shopify Admin API is not available for product search.", products: [] };
  }

  try {
    const data = await shopifyGraphql(admin, `#graphql
      query ProductPulseSearchShopifyProducts($query: String!, $first: Int!) {
        products(first: $first, query: $query, sortKey: TITLE) {
          nodes {
            id
            title
            handle
            status
            vendor
            productType
            featuredMedia {
              preview {
                image {
                  url
                  altText
                }
              }
            }
            media(first: 1) {
              nodes {
                preview {
                  image {
                    url
                    altText
                  }
                }
                ... on MediaImage {
                  image {
                    url
                    altText
                  }
                }
              }
            }
            variants(first: 1) {
              nodes {
                sku
              }
            }
            collections(first: 3) {
              nodes {
                title
                handle
              }
            }
          }
        }
      }`,
      {
        query: buildShopifyProductSearchQuery(query),
        first: 12,
      },
    );
    const products = Array.isArray(data?.products?.nodes) ? data.products.nodes.filter(Boolean) : [];
    const existingSnapshots = products.length
      ? await prisma.productRiskSnapshot.findMany({
        where: { shop, productGid: { in: products.map((product) => product.id).filter(Boolean) } },
        select: { productGid: true },
      })
      : [];
    const existingProductGids = new Set(existingSnapshots.map((snapshot) => snapshot.productGid));

    return {
      status: "success",
      query,
      products: products.map((product) => formatShopifyProductSearchResult(product, existingProductGids)),
      message: products.length ? `${products.length} Shopify product${products.length === 1 ? "" : "s"} found.` : "No Shopify products matched that search.",
    };
  } catch (error) {
    return {
      status: "validation_error",
      query,
      message: `Unable to search Shopify products: ${error.message}`,
      products: [],
    };
  }
}

export async function recordProductDetailActionForShop(shop, productId, actionId, payloadOverride = {}, admin = null) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

  const metrics = snapshot.metrics || {};
  const latestDiagnosis = await prisma.productDiagnosis.findFirst({
    where: { shop, productGid: snapshot.productGid, status: "Completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
  });
  const diagnosisRecommendations = Array.isArray(latestDiagnosis?.recommendations) ? latestDiagnosis.recommendations : [];
  let action = actionId === "mark-resolved"
    ? getResolvedAction(snapshot)
    : actionId === "ignore-issue"
      ? getIgnoredIssueAction(snapshot, payloadOverride)
    : diagnosisRecommendations.find((item) => item.id === actionId)
      || getSnapshotRecommendedActions(snapshot, metrics).find((item) => item.id === actionId);

  if (!action && payloadOverride.draftText) {
    action = {
      id: actionId || "custom-draft",
      label: payloadOverride.label || "Custom product action draft",
      type: "ProductPulse draft",
      effort: "Low",
      status: "Draft",
      payload: { draftText: payloadOverride.draftText },
    };
  }

  if (!action) {
    return { status: "validation_error", message: "Recommended action was not found." };
  }

  const payload = {
    ...(action.payload || {}),
    ...(payloadOverride.draftText ? { draftText: payloadOverride.draftText } : {}),
    ...(payloadOverride.actionVariant ? { actionVariant: payloadOverride.actionVariant } : {}),
  };
  const shouldApplyToShopify = payloadOverride.applyMode === "apply";
  const applyResult = shouldApplyToShopify
    ? await applyProductRecommendationAction({ admin, snapshot, action, payload })
    : null;
  if (applyResult?.status === "validation_error") return applyResult;

  const status = action.id === "ignore-issue" ? "ignored" : action.id === "mark-resolved" || action.applyImmediately || applyResult ? "applied" : "draft";
  if (action.id === "ignore-issue") {
    const existingIgnoredActions = await prisma.productAction.findMany({
      where: { shop, productGid: snapshot.productGid, actionType: "ignore-issue", status: "ignored" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const issueKey = String(payload.issueKey || "").trim();
    if (issueKey && existingIgnoredActions.some((record) => {
      const existingPayload = record.payload || {};
      return String(existingPayload.issueKey || normalizeIgnoredIssueKey(existingPayload.issueCode || existingPayload.issue || record.label || "")) === issueKey;
    })) {
      return {
        status: "success",
        message: `${payload.issue || "Issue"} is already ignored for ${snapshot.productTitle}.`,
        action,
        suppressBanner: true,
      };
    }
  }

  await prisma.productAction.create({
    data: {
      shop,
      diagnosisId: latestDiagnosis?.id || null,
      productGid: snapshot.productGid,
      actionType: action.id,
      label: action.label,
      status,
      payload: applyResult ? { ...payload, appliedChange: applyResult.change } : payload,
      appliedAt: status === "applied" || status === "ignored" ? new Date() : null,
    },
  });

  return {
    status: "success",
    message: applyResult?.message || (status === "ignored"
      ? `${payload.issue || "Issue"} ignored. Related recommendations are hidden for this product.`
      : status === "applied"
      ? `${action.label} was applied for ${snapshot.productTitle}.`
      : `${action.label} was saved as a draft for ${snapshot.productTitle}.`),
    action,
  };
}

async function applyProductRecommendationAction({ admin, snapshot, action, payload }) {
  if (!admin?.graphql) {
    return { status: "validation_error", message: "Shopify Admin access is required to apply this action." };
  }

  const normalizedType = String(action.type || "").toLowerCase();
  const normalizedId = String(action.id || "").toLowerCase();

  if (isFaqRecommendationAction(action, payload)) {
    return applyFaqRecommendationAction({ admin, snapshot, action, payload });
  }

  if (payload.tag || normalizedType.includes("tag")) {
    const tag = String(payload.tag || "").trim();
    if (!tag) return { status: "validation_error", message: "This action does not include a product tag to apply." };
    const result = await addProductTag(admin, snapshot.productGid, tag);
    if (result.status === "validation_error") return result;
    return {
      message: `Product tag "${tag}" was added to ${snapshot.productTitle}.`,
      change: {
        target: "Product tags",
        operation: "add",
        value: tag,
      },
    };
  }

  if (payload.draftText && (normalizedType.includes("pdp") || normalizedType.includes("faq") || normalizedId.includes("description") || normalizedId.includes("fit"))) {
    const operation = getDescriptionOperationForAction(action);
    const currentProduct = await getProductDescriptionForUpdate(admin, snapshot.productGid);
    if (currentProduct.status === "validation_error") return currentProduct;
    const descriptionHtml = buildUpdatedProductDescriptionHtml({
      currentHtml: currentProduct.descriptionHtml || "",
      draftText: payload.draftText,
      operation,
      action,
    });
    const result = await updateProductDescription(admin, snapshot.productGid, descriptionHtml);
    if (result.status === "validation_error") return result;
    return {
      message: `${getDescriptionOperationLabel(operation)} for ${snapshot.productTitle}.`,
      change: {
        target: "Product description",
        operation,
        value: payload.draftText,
      },
    };
  }

  return { status: "validation_error", message: "This recommended action is not connected to an automatic Shopify product change yet." };
}

async function getProductDescriptionForUpdate(admin, productGid) {
  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseProductDescription($id: ID!) {
        product(id: $id) {
          id
          descriptionHtml
          tags
        }
      }`,
      { variables: { id: productGid } },
    );
    const json = await response.json();
    const userErrors = json.errors || [];
    if (userErrors.length) return { status: "validation_error", message: userErrors.map((error) => error.message).join(" ") };
    if (!json.data?.product) return { status: "validation_error", message: "Shopify product was not found." };
    return json.data.product;
  } catch (error) {
    return { status: "validation_error", message: `Unable to read product description: ${error.message}` };
  }
}

async function updateProductDescription(admin, productGid, descriptionHtml) {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseUpdateProductDescription($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { product: { id: productGid, descriptionHtml } } },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.productUpdate?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `Unable to update product description: ${error.message}` };
  }
}

async function addProductTag(admin, productGid, tag) {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseAddProductTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: productGid, tags: [tag] } },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.tagsAdd?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `Unable to add product tag: ${error.message}` };
  }
}

async function applyFaqRecommendationAction({ admin, snapshot, action, payload }) {
  const variant = getFaqApplyVariant(payload);
  const faqItems = normalizeFaqItemsForApply(payload.faqItems, payload.draftText);
  if (!faqItems.length) {
    return { status: "validation_error", message: "This FAQ action does not include questions and answers to apply." };
  }

  if (variant === "metafield-json") {
    const metafield = payload.metafield || {};
    const namespace = metafield.namespace || "productpulse";
    const key = metafield.key || "faq_items";
    const type = metafield.type || "json";
    const result = await setProductFaqMetafield(admin, snapshot.productGid, {
      namespace,
      key,
      type,
      faqItems,
      sourceActionId: action.id,
    });
    if (result.status === "validation_error") return result;
    return {
      message: `Product FAQ metafield ${namespace}.${key} was saved for ${snapshot.productTitle}.`,
      change: {
        target: "Product metafield",
        operation: "set",
        value: faqItems,
        namespace,
        key,
      },
    };
  }

  const currentProduct = await getProductDescriptionForUpdate(admin, snapshot.productGid);
  if (currentProduct.status === "validation_error") return currentProduct;
  const faqHtml = buildProductPulseFaqHtml({ faqItems, variant, action });
  const descriptionHtml = [currentProduct.descriptionHtml || "", faqHtml].filter(Boolean).join("\n");
  const result = await updateProductDescription(admin, snapshot.productGid, descriptionHtml);
  if (result.status === "validation_error") return result;

  return {
    message: `${getFaqApplyVariantLabel(variant)} for ${snapshot.productTitle}.`,
    change: {
      target: "Product description",
      operation: variant,
      value: faqItems,
      descriptionHtml,
    },
  };
}

function isFaqRecommendationAction(action, payload = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  return normalized.includes("faq") || Array.isArray(payload.faqItems);
}

function getFaqApplyVariant(payload = {}) {
  const variant = String(payload.actionVariant || payload.defaultApplyMode || "").trim();
  if (["description-section", "description-collapsible", "description-modal", "metafield-json"].includes(variant)) return variant;
  return "description-collapsible";
}

function getFaqApplyVariantLabel(variant) {
  if (variant === "description-section") return "Product FAQ section was appended";
  if (variant === "description-modal") return "Product FAQ modal block was appended";
  return "Product FAQ was appended";
}

function normalizeFaqItemsForApply(faqItems = [], draftText = "") {
  const parsed = parseFaqText(draftText);
  if (parsed.length) return parsed.slice(0, 6);

  const structured = (Array.isArray(faqItems) ? faqItems : [])
    .map((item) => ({
      question: normalizeFaqQuestion(item?.question),
      answer: normalizeFaqAnswer(item?.answer),
    }))
    .filter((item) => item.question && item.answer);
  return structured.slice(0, 6);
}

function parseFaqText(draftText = "") {
  const lines = String(draftText || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/[?？]$/.test(line)) continue;
    const answer = lines[index + 1] || "";
    if (answer && !/[?？]$/.test(answer)) parsed.push({ question: normalizeFaqQuestion(line), answer: normalizeFaqAnswer(answer) });
  }
  return parsed;
}

function normalizeFaqQuestion(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return /[?？]$/.test(text) ? text : `${text}?`;
}

function normalizeFaqAnswer(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildProductPulseFaqHtml({ faqItems, variant, action }) {
  const actionId = escapeHtml(action.id || "product-faq");
  const itemsHtml = faqItems.map((item) => (
    `<dt>${escapeHtml(item.question)}</dt>\n<dd>${escapeHtml(item.answer)}</dd>`
  )).join("\n");

  if (variant === "description-section") {
    return `<section data-productpulse-action="${actionId}" class="productpulse-faq productpulse-faq-section">\n<h3>Frequently asked questions</h3>\n<dl>\n${itemsHtml}\n</dl>\n</section>`;
  }

  if (variant === "description-modal") {
    return `<section data-productpulse-action="${actionId}" class="productpulse-faq productpulse-faq-modal">\n<details>\n<summary>Open frequently asked questions</summary>\n<div role="dialog" aria-label="Frequently asked questions">\n<h3>Frequently asked questions</h3>\n<dl>\n${itemsHtml}\n</dl>\n</div>\n</details>\n</section>`;
  }

  return `<section data-productpulse-action="${actionId}" class="productpulse-faq productpulse-faq-collapsible">\n<details>\n<summary>Frequently asked questions</summary>\n<dl>\n${itemsHtml}\n</dl>\n</details>\n</section>`;
}

async function setProductFaqMetafield(admin, productGid, { namespace, key, type, faqItems, sourceActionId }) {
  try {
    const value = JSON.stringify({
      source: "ProductPulse AI",
      sourceActionId,
      updatedAt: new Date().toISOString(),
      items: faqItems,
    });
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseSetProductFaqMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            type
            value
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
      {
        variables: {
          metafields: [{
            ownerId: productGid,
            namespace,
            key,
            type,
            value,
          }],
        },
      },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.metafieldsSet?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `Unable to set product FAQ metafield: ${error.message}` };
  }
}

function getDescriptionOperationForAction(action) {
  const payload = action.payload || {};
  if (["replace", "prepend", "append"].includes(payload.operation)) return payload.operation;
  if (["prepend", "append"].includes(payload.placement)) return payload.placement;
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (normalized.includes("rewrite-product-description") || normalized.includes("rewrite")) return "replace";
  if (normalized.includes("faq")) return "append";
  return "prepend";
}

function getDescriptionOperationLabel(operation) {
  if (operation === "replace") return "Product description was updated";
  if (operation === "append") return "Product description was appended";
  return "Product description was updated";
}

function buildUpdatedProductDescriptionHtml({ currentHtml, draftText, operation, action }) {
  if (operation === "replace") return buildProductPulseDescriptionReplacement(draftText, action);
  const suggestionHtml = buildProductPulseDescriptionBlock(draftText, action);
  if (operation === "append") return [currentHtml, suggestionHtml].filter(Boolean).join("\n");
  return [suggestionHtml, currentHtml].filter(Boolean).join("\n");
}

function buildProductPulseDescriptionBlock(text, action) {
  const heading = String(action.id || "").includes("faq") ? "Product FAQ" : "Product note";
  return `<section data-productpulse-action="${escapeHtml(action.id || "product-action")}">\n<h3>${heading}</h3>\n${buildHtmlParagraphs(text)}\n</section>`;
}

function buildProductPulseDescriptionReplacement(text, action) {
  return `<div data-productpulse-action="${escapeHtml(action.id || "product-action")}">\n${buildHtmlParagraphs(text)}\n</div>`;
}

function buildHtmlParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function findProductRiskSnapshot(shop, productId) {
  return prisma.productRiskSnapshot.findFirst({
    where: {
      shop,
      OR: [
        { handle: productId },
        { productGid: productId },
      ],
    },
  });
}

async function createProductDiagnosisJob(shop, productId, options = {}) {
  let snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot && options.admin) {
    snapshot = await createManualProductRiskSnapshot(shop, options.admin, productId);
  }
  if (!snapshot) return null;
  const activeJob = await getActiveProductDiagnosisJobForSnapshot(shop, snapshot);
  if (activeJob) return activeJob;

  const job = await prisma.catalogSignalJob.create({
    data: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      source: `Queued AI Product Diagnosis - ${snapshot.productTitle}`,
      status: "Queued",
      progress: 0,
      payload: {
        productId,
        productGid: snapshot.productGid,
        handle: snapshot.handle,
        productTitle: snapshot.productTitle,
        riskScore: snapshot.riskScore,
        queuedAt: new Date().toISOString(),
      },
    },
  });

  await recordJobLog({
    shop,
    jobId: job.id,
    event: "product_diagnosis.queued",
    message: "Product diagnosis queued as a persistent background job.",
    data: {
      productGid: snapshot.productGid,
      handle: snapshot.handle,
      title: snapshot.productTitle,
      riskScore: snapshot.riskScore,
    },
  });

  return job;
}

async function getActiveFastProductScan(shop) {
  return prisma.catalogSignalJob.findFirst({
    where: {
      shop,
      kind: FAST_PRODUCT_SCAN_KIND,
      status: { in: ["Queued", "Running"] },
    },
    orderBy: { startedAt: "desc" },
  });
}

async function getActiveProductDiagnosisJobs(shop) {
  return prisma.catalogSignalJob.findMany({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: { in: ["Queued", "Running"] },
    },
    orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
  });
}

async function getActiveProductDiagnosisJobForSnapshot(shop, snapshot) {
  const jobs = await getActiveProductDiagnosisJobs(shop);
  return findActiveProductDiagnosisJobForSnapshot(snapshot, jobs);
}

function findActiveProductDiagnosisJobForSnapshot(snapshot, jobs = []) {
  const keys = new Set([
    snapshot?.productGid,
    snapshot?.handle,
  ].filter(Boolean).map(String));
  if (!keys.size) return null;

  return jobs.find((job) => getProductDiagnosisJobKeys(job).some((key) => keys.has(key))) || null;
}

async function failStaleFastProductScans(shop) {
  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);
  await prisma.catalogSignalJob.updateMany({
    where: {
      shop,
      kind: FAST_PRODUCT_SCAN_KIND,
      status: { in: ["Queued", "Running"] },
      startedAt: { lte: cutoff },
    },
    data: {
      status: "Failed",
      errorMessage: "QuickScan worker timed out before completing.",
      source: "QuickScan failed",
      finishedAt: new Date(),
    },
  });
}

function ensureFastProductScanWorker(job, options = {}) {
  if (!job?.id || activeWorkers.has(job.id) || !isActiveStatus(job.status)) return;

  activeWorkers.add(job.id);
  setTimeout(async () => {
    try {
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        event: "quick_scan.worker_started",
        message: "QuickScan worker started or rehydrated from an active persisted job.",
        data: { status: job.status, source: job.source },
      });
      const admin = options.admin || await getOfflineAdmin(job.shop);
      const scopes = options.scopes || options.session?.scope || admin.productPulseScopes || "";
      await runShopifyQuickScan({
        shop: job.shop,
        admin,
        jobId: job.id,
        scopes,
      });
    } catch (error) {
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        level: "error",
        event: "quick_scan.worker_failed",
        message: "QuickScan worker failed.",
        data: { error: serializeError(error) },
      });
      await markJobFailed(job.id, error);
    } finally {
      activeWorkers.delete(job.id);
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        event: "quick_scan.worker_stopped",
        message: "QuickScan worker stopped.",
      });
    }
  }, 0);
}

function ensureProductDiagnosisQueueWorker(shop) {
  if (!shop || activeDiagnosisQueueWorkers.has(shop)) return;

  activeDiagnosisQueueWorkers.add(shop);
  setTimeout(async () => {
    try {
      await requeueRecoveredProductDiagnosisJobs(shop);

      for (;;) {
        const job = await claimNextProductDiagnosisJob(shop);
        if (!job) break;

        try {
          await runProductDiagnosisJob(job);
        } catch (error) {
          await recordJobLog({
            shop,
            jobId: job.id,
            level: "error",
            event: "product_diagnosis.worker_failed",
            message: "Product diagnosis worker failed.",
            data: { error: serializeError(error), payload: job.payload },
          });
          await markJobFailed(job.id, error, "AI Product Diagnosis failed");
        }
      }
    } finally {
      activeDiagnosisQueueWorkers.delete(shop);
    }
  }, 0);
}

async function requeueRecoveredProductDiagnosisJobs(shop) {
  const recovered = await prisma.catalogSignalJob.updateMany({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: "Running",
    },
    data: {
      status: "Queued",
      progress: 0,
      source: "Requeued AI Product Diagnosis after worker recovery",
    },
  });

  if (recovered.count > 0) {
    const jobs = await prisma.catalogSignalJob.findMany({
      where: { shop, kind: PRODUCT_DIAGNOSIS_KIND, status: "Queued" },
      orderBy: [{ updatedAt: "desc" }],
      take: recovered.count,
    });

    await Promise.all(jobs.map((job) => recordJobLog({
      shop,
      jobId: job.id,
      event: "product_diagnosis.requeued",
      message: "Recovered running product diagnosis job and returned it to the queue.",
      data: { payload: job.payload },
    })));
  }
}

async function claimNextProductDiagnosisJob(shop) {
  const nextJob = await prisma.catalogSignalJob.findFirst({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: "Queued",
    },
    orderBy: [{ startedAt: "asc" }],
  });

  if (!nextJob) return null;

  const claimed = await prisma.catalogSignalJob.updateMany({
    where: {
      id: nextJob.id,
      status: "Queued",
    },
    data: {
      status: "Running",
      progress: 5,
      source: `Running AI Product Diagnosis - ${nextJob.payload?.productTitle || "selected product"}`,
      startedAt: new Date(),
    },
  });

  if (claimed.count !== 1) return null;
  return prisma.catalogSignalJob.findUnique({ where: { id: nextJob.id } });
}

async function runProductDiagnosisJob(job) {
  const startedAt = Date.now();
  const productId = job.payload?.productGid || job.payload?.handle || job.payload?.productId;
  const snapshot = await findProductRiskSnapshot(job.shop, productId);
  if (!snapshot) throw new Error("Product snapshot was not found for queued diagnosis job.");

  const metrics = snapshot.metrics || {};

  await recordJobLog({
    shop: job.shop,
    jobId: job.id,
    event: "product_diagnosis.started",
    message: "Product diagnosis job started from the persisted queue.",
    data: {
      productGid: snapshot.productGid,
      handle: snapshot.handle,
      title: snapshot.productTitle,
      riskScore: snapshot.riskScore,
      confidence: snapshot.confidence,
      primaryIssue: snapshot.primaryIssue,
      sourceCoverage: snapshot.sourceCoverage,
      metrics: {
        signalCount: metrics.signalCount,
        returnRate: metrics.returnRate,
        refundRate: metrics.refundRate,
        topReturnReasons: metrics.topReturnReasons,
      },
    },
  });

  await updateProductDiagnosisJob(job.id, {
    progress: 18,
    source: `Preparing AI Product Diagnosis - ${snapshot.productTitle}`,
  });

  await updateProductDiagnosisJob(job.id, {
    progress: 42,
    source: `Analyzing Shopify and Judge.me evidence - ${snapshot.productTitle}`,
  });

  const admin = await getOfflineAdmin(job.shop);
  const diagnosis = await runDetailedProductDiagnosis({
    shop: job.shop,
    jobId: job.id,
    admin,
    snapshot,
  });

  await updateProductDiagnosisJob(job.id, {
    progress: 92,
    source: `Finalizing AI Product Diagnosis - ${snapshot.productTitle}`,
  });

  await updateProductDiagnosisJob(job.id, {
    status: "Completed",
    progress: 100,
    source: `AI Product Diagnosis completed - ${snapshot.productTitle}`,
    finishedAt: new Date(),
  });

  await recordJobLog({
    shop: job.shop,
    jobId: job.id,
    event: "product_diagnosis.completed",
    message: "Product diagnosis completed.",
    data: {
      durationMs: Date.now() - startedAt,
      diagnosisId: diagnosis?.diagnosisId,
      riskScore: diagnosis?.riskScore,
      confidence: diagnosis?.confidence,
      estimatedImpact: diagnosis?.estimatedImpact,
      provider: diagnosis?.provider,
      model: diagnosis?.model,
      modelsUsed: diagnosis?.modelsUsed,
    },
  });
}

async function getOfflineAdmin(shop) {
  const { admin, session } = await unauthenticated.admin(shop);
  return Object.assign(admin, { productPulseScopes: session.scope });
}

async function updateProductDiagnosisJob(jobId, data) {
  await prisma.catalogSignalJob.updateMany({
    where: {
      id: jobId,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: { in: ["Queued", "Running"] },
    },
    data,
  });
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

async function markJobFailed(jobId, error, source = "QuickScan failed") {
  await prisma.catalogSignalJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["Queued", "Running"] },
    },
    data: {
      status: "Failed",
      progress: 100,
      source,
      errorMessage: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
    },
  });
}

function normalizeStartArgs(input, adminArg, scopesArg) {
  if (typeof input === "string") {
    return { shop: input, admin: adminArg, scopes: scopesArg || adminArg?.productPulseScopes || "" };
  }

  return {
    shop: input.shop,
    admin: input.admin,
    scopes: input.scopes || input.session?.scope || input.admin?.productPulseScopes || "",
  };
}

function isActiveStatus(status) {
  return status === "Queued" || status === "Running";
}

function formatProductRow(snapshot, latestDiagnosis = null, resolvedAction = null, settings = undefined) {
  const metrics = snapshot.metrics || {};
  const sources = Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : [];
  const analysisState = getProductAnalysisState(snapshot, latestDiagnosis);
  const resolvedAt = resolvedAction?.appliedAt || resolvedAction?.createdAt || null;
  const riskLabel = getRiskLabel(snapshot.riskScore, settings);
  const riskTone = getRiskTone(snapshot.riskScore, settings);
  return {
    productGid: snapshot.productGid,
    handle: snapshot.handle,
    title: snapshot.productTitle,
    variant: getProductArtVariant(snapshot.handle),
    selected: false,
    risk: riskLabel,
    riskTone,
    riskScore: snapshot.riskScore,
    status: getStatusLabel(snapshot.riskScore, Boolean(resolvedAt), settings),
    statusTone: resolvedAt ? "success" : riskTone,
    resolvedAt: toIso(resolvedAt),
    resolvedLabel: resolvedAt ? `Resolved ${formatJobDate(resolvedAt)}` : "",
    analysisDepth: analysisState.depth,
    analysisLabel: analysisState.label,
    analysisDetail: analysisState.detail,
    analysisTone: analysisState.tone,
    analysisIcon: analysisState.icon,
    analysisCompletedAt: analysisState.completedAt,
    signals: metrics.signalCount || 0,
    signalTone: riskLabel === "High" ? "red" : riskLabel === "Medium" ? "orange" : "green",
    signalBars: getSignalBars(metrics),
    signalDetails: getSignalDetails(snapshot, metrics),
    issue: snapshot.primaryIssue,
    sources: sources.map(getSourceToken),
    sourceOverflow: Math.max(0, sources.length - 3),
    lastAnalysis: formatJobDate(snapshot.updatedAt),
    lastAnalysisAt: toIso(snapshot.updatedAt),
    credits: 1,
    href: `/app/products/${snapshot.handle}`,
  };
}

function getProductAnalysisState(snapshot, latestDiagnosis = null) {
  const metrics = snapshot.metrics || {};
  const completedAt = latestDiagnosis?.completedAt || metrics.lastDetailedDiagnosisAt || null;
  const hasFullDiagnosis = Boolean(latestDiagnosis || metrics.latestDiagnosisId || completedAt);
  if (hasFullDiagnosis) {
    return {
      depth: "full",
      label: "Full diagnosis",
      tone: "success",
      icon: "wand",
      completedAt: toIso(completedAt),
      detail: completedAt
        ? `Deep AI diagnosis completed ${formatJobDate(completedAt)}.`
        : "Deep AI diagnosis completed.",
    };
  }

  return {
    depth: "quickscan",
    label: "QuickScan only",
    tone: "info",
    icon: "search",
    completedAt: null,
    detail: "Preliminary Shopify scan only. Run product diagnosis for recommended actions.",
  };
}

function attachActiveProductDiagnosisJobs(rows, jobs) {
  if (!jobs.length) return rows;
  const jobByProductKey = new Map();

  jobs.forEach((job) => {
    getProductDiagnosisJobKeys(job).forEach((key) => {
      const current = jobByProductKey.get(key);
      if (!current || isPreferredProductDiagnosisJob(job, current)) {
        jobByProductKey.set(key, job);
      }
    });
  });

  return rows.map((row) => {
    const job = jobByProductKey.get(row.productGid) || jobByProductKey.get(row.handle);
    return job ? { ...row, diagnosisJob: formatJob(job) } : row;
  });
}

function getProductDiagnosisJobKeys(job) {
  return [
    job.payload?.productGid,
    job.payload?.handle,
    job.payload?.productId,
  ].filter(Boolean).map(String);
}

function isPreferredProductDiagnosisJob(candidate, current) {
  if (candidate.status === "Running" && current.status !== "Running") return true;
  if (candidate.status !== "Running" && current.status === "Running") return false;
  return new Date(candidate.updatedAt).getTime() > new Date(current.updatedAt).getTime();
}

function filterProductSnapshots(snapshots, filters = {}, resolvedActionsByProductGid = new Map(), settings = undefined) {
  const query = String(filters.query || "").trim().toLowerCase();

  return snapshots.filter((snapshot) => {
    const metrics = snapshot.metrics || {};
    const sources = Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : [];
    const collections = Array.isArray(metrics.collections) ? metrics.collections : [];
    const tags = Array.isArray(metrics.tags) ? metrics.tags : [];
    const isResolved = resolvedActionsByProductGid.has(snapshot.productGid);
    const searchable = [
      snapshot.productTitle,
      snapshot.handle,
      snapshot.primaryIssue,
      isResolved ? "resolved" : "",
      metrics.vendor,
      metrics.productType,
      ...collections,
      ...tags,
      ...sources,
    ].filter(Boolean).join(" ").toLowerCase();

    if (query && !searchable.includes(query)) return false;
    if (filters.risk && filters.risk !== "all" && getRiskFilterValue(snapshot.riskScore, settings) !== filters.risk) return false;
    if (filters.status && filters.status !== "all" && getStatusFilterValue(snapshot.riskScore, isResolved, settings) !== filters.status) return false;
    if (filters.issue && filters.issue !== "all" && slugifyFilterValue(snapshot.primaryIssue) !== filters.issue) return false;
    if (filters.source && filters.source !== "all" && !sources.some((source) => slugifyFilterValue(source) === filters.source)) return false;

    if (filters.vendor && filters.vendor !== "all") {
      const values = [metrics.vendor, metrics.productType, ...collections].filter(Boolean).map(slugifyFilterValue);
      if (!values.includes(filters.vendor)) return false;
    }

    return true;
  });
}

function sortProductSnapshots(snapshots, filters = {}, resolvedActionsByProductGid = new Map()) {
  const sort = filters.sort === "lastAnalysis" ? "lastAnalysis" : "riskScore";
  const direction = filters.direction === "asc" ? 1 : -1;

  return [...snapshots].sort((first, second) => {
    const firstResolved = resolvedActionsByProductGid.has(first.productGid);
    const secondResolved = resolvedActionsByProductGid.has(second.productGid);
    if (firstResolved !== secondResolved) return firstResolved ? 1 : -1;

    const firstValue = sort === "lastAnalysis" ? new Date(first.updatedAt).getTime() : Number(first.riskScore || 0);
    const secondValue = sort === "lastAnalysis" ? new Date(second.updatedAt).getTime() : Number(second.riskScore || 0);

    if (firstValue === secondValue) return String(first.productTitle).localeCompare(String(second.productTitle));
    return (firstValue - secondValue) * direction;
  });
}

function getProductTableFilterOptions(snapshots, resolvedActionsByProductGid = new Map(), settings = undefined) {
  const issues = new Map();
  const sources = new Map();
  const vendors = new Map();
  const statuses = new Map();

  snapshots.forEach((snapshot) => {
    const metrics = snapshot.metrics || {};
    const isResolved = resolvedActionsByProductGid.has(snapshot.productGid);
    addFilterOption(issues, snapshot.primaryIssue);
    addFilterOption(statuses, getStatusLabel(snapshot.riskScore, isResolved, settings), getStatusFilterValue(snapshot.riskScore, isResolved, settings));
    (Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : []).forEach((source) => addFilterOption(sources, source));
    addFilterOption(vendors, metrics.vendor);
    addFilterOption(vendors, metrics.productType);
    (Array.isArray(metrics.collections) ? metrics.collections : []).forEach((collection) => addFilterOption(vendors, collection));
  });

  return {
    risks: [
      { value: "all", label: "Risk" },
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ],
    statuses: [{ value: "all", label: "Status" }, ...Array.from(statuses.values()).sort(compareFilterOptions)],
    issues: [{ value: "all", label: "Issue type" }, ...Array.from(issues.values()).sort(compareFilterOptions)],
    sources: [{ value: "all", label: "Source" }, ...Array.from(sources.values()).sort(compareFilterOptions)],
    vendors: [{ value: "all", label: "Vendor or Collection" }, ...Array.from(vendors.values()).sort(compareFilterOptions)],
  };
}

function addFilterOption(map, label, value) {
  if (!label) return;
  const key = value || slugifyFilterValue(label);
  if (!key || map.has(key)) return;
  map.set(key, { value: key, label: String(label) });
}

function compareFilterOptions(first, second) {
  return first.label.localeCompare(second.label);
}

function slugifyFilterValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getRiskFilterValue(score, settings = undefined) {
  return getRiskFilterValueForScore(score, settings);
}

function getStatusFilterValue(score, resolved = false, settings = undefined) {
  return getStatusFilterValueForScore(score, resolved, settings);
}

function getStatusLabel(score, resolved = false, settings = undefined) {
  return getStatusLabelForScore(score, resolved, settings);
}

function normalizeRowsPerPage(value) {
  return Number(value) === 50 ? 50 : 25;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function attachProductImages(rows, admin) {
  if (!admin?.graphql || rows.length === 0) return rows;
  const ids = rows.map((row) => row.productGid).filter(Boolean);
  if (!ids.length) return rows;

  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseProductImages($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            featuredMedia {
              preview {
                image {
                  url
                  altText
                }
              }
            }
            media(first: 1) {
              nodes {
                preview {
                  image {
                    url
                    altText
                  }
                }
                ... on MediaImage {
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { ids } },
    );
    const json = await response.json();
    if (json.errors?.length) return rows;

    const imageByProduct = new Map((json.data?.nodes || []).filter(Boolean).map((product) => {
      const mediaNode = product.media?.nodes?.[0] || {};
      const image = product.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};
      return [product.id, {
        imageUrl: image.url || null,
        imageAlt: image.altText || null,
      }];
    }));

    return rows.map((row) => ({
      ...row,
      ...(imageByProduct.get(row.productGid) || {}),
    }));
  } catch {
    return rows;
  }
}

async function attachProductImageToDiagnosis(product, admin) {
  if (!product || !admin?.graphql) return product;
  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseProductDetailPreview($id: ID!) {
        product(id: $id) {
          id
          description
          descriptionHtml
          tags
          featuredMedia {
            preview {
              image {
                url
                altText
              }
            }
          }
          media(first: 1) {
            nodes {
              preview {
                image {
                  url
                  altText
                }
              }
              ... on MediaImage {
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }`,
      { variables: { id: product.id } },
    );
    const json = await response.json();
    const shopifyProduct = json.data?.product;
    if (json.errors?.length || !shopifyProduct) return product;
    const mediaNode = shopifyProduct.media?.nodes?.[0] || {};
    const image = shopifyProduct.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};

    return {
      ...product,
      imageUrl: image.url || null,
      imageAlt: image.altText || null,
      currentDescriptionHtml: shopifyProduct.descriptionHtml || "",
      currentDescriptionText: stripHtml(shopifyProduct.descriptionHtml || shopifyProduct.description || ""),
      currentTags: Array.isArray(shopifyProduct.tags) ? shopifyProduct.tags : [],
    };
  } catch {
    const [rowWithImage] = await attachProductImages([{ productGid: product.id }], admin);
    return {
      ...product,
      imageUrl: rowWithImage?.imageUrl || null,
      imageAlt: rowWithImage?.imageAlt || null,
    };
  }
}

async function getLiveShopifyProductDetail(productId, admin, shop) {
  if (!admin?.graphql || !productId) return null;

  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseLiveProductDetail($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            title
            handle
            description
            descriptionHtml
            vendor
            productType
            status
            tags
            options {
              name
              values
            }
            featuredMedia {
              preview {
                image {
                  url
                  altText
                }
              }
            }
            media(first: 1) {
              nodes {
                preview {
                  image {
                    url
                    altText
                  }
                }
                ... on MediaImage {
                  image {
                    url
                    altText
                  }
                }
              }
            }
            variants(first: 50) {
              nodes {
                id
                sku
                title
              }
            }
            collections(first: 10) {
              nodes {
                title
              }
            }
          }
        }
      }`,
      { variables: { query: `handle:${escapeShopifyQueryValue(productId)}` } },
    );
    const json = await response.json();
    if (json.errors?.length) return null;
    const product = json.data?.products?.nodes?.[0];
    return product ? withShopifyAdminUrl(formatLiveShopifyProductForDiagnosis(product), shop) : null;
  } catch {
    return null;
  }
}

async function createManualProductRiskSnapshot(shop, admin, productId) {
  const product = await fetchShopifyProductForManualSnapshot(admin, productId);
  if (!product?.id) return null;
  const snapshotPayload = buildManualProductRiskSnapshotPayload(shop, product);

  return prisma.productRiskSnapshot.upsert({
    where: {
      shop_productGid: {
        shop,
        productGid: snapshotPayload.productGid,
      },
    },
    create: snapshotPayload,
    update: {
      productTitle: snapshotPayload.productTitle,
      handle: snapshotPayload.handle,
      sourceCoverage: snapshotPayload.sourceCoverage,
      metrics: snapshotPayload.metrics,
      calculatedAt: new Date(),
    },
  });
}

async function fetchShopifyProductForManualSnapshot(admin, productId) {
  if (!admin?.graphql || !productId) return null;
  const productGid = normalizeShopifyProductGid(productId);

  if (productGid) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseManualProductSnapshot($id: ID!) {
        product(id: $id) {
          ...ProductPulseManualProductFields
        }
      }

      fragment ProductPulseManualProductFields on Product {
        id
        title
        handle
        description
        descriptionHtml
        vendor
        productType
        status
        tags
        options {
          name
          values
        }
        variants(first: 100) {
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
        collections(first: 20) {
          nodes {
            title
            handle
          }
        }
        featuredMedia {
          preview {
            image {
              url
              altText
            }
          }
        }
        media(first: 1) {
          nodes {
            preview {
              image {
                url
                altText
              }
            }
            ... on MediaImage {
              image {
                url
                altText
              }
            }
          }
        }
      }`,
      { id: productGid },
    );
    if (data?.product?.id) return data.product;
  }

  const fallbackQuery = productId === String(productId).trim() && !String(productId).includes(" ")
    ? `handle:${escapeShopifyQueryValue(productId)}`
    : String(productId || "").trim();
  const data = await shopifyGraphql(
    admin,
    `#graphql
    query ProductPulseManualProductSearch($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          title
          handle
          description
          descriptionHtml
          vendor
          productType
          status
          tags
          options {
            name
            values
          }
          variants(first: 100) {
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
          collections(first: 20) {
            nodes {
              title
              handle
            }
          }
          featuredMedia {
            preview {
              image {
                url
                altText
              }
            }
          }
          media(first: 1) {
            nodes {
              preview {
                image {
                  url
                  altText
                }
              }
              ... on MediaImage {
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }
    }`,
    { query: fallbackQuery },
  );

  return data?.products?.nodes?.[0] || null;
}

function buildManualProductRiskSnapshotPayload(shop, product) {
  const variants = getConnectionNodes(product.variants);
  const collections = getConnectionNodes(product.collections);
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const options = Array.isArray(product.options) ? product.options : [];
  const descriptionText = stripHtml(product.descriptionHtml || product.description || "");
  const descriptionWordCount = descriptionText ? descriptionText.split(/\s+/).filter(Boolean).length : 0;
  const optionNames = options.map((option) => option.name).filter(Boolean);
  const skuCount = variants.filter((variant) => variant.sku).length;
  const collectionTitles = collections.map((collection) => collection.title).filter(Boolean);
  const now = new Date();

  return {
    shop,
    productGid: product.id,
    productTitle: product.title || product.handle || "Shopify product",
    handle: product.handle || String(product.id || "").split("/").pop(),
    riskScore: 0,
    impactScore: 0,
    confidence: 0,
    primaryIssue: "Manual diagnosis requested",
    sourceCoverage: ["Shopify products"],
    metrics: {
      manualDiagnosisRequested: true,
      hasQuickScan: false,
      signalCount: 0,
      soldUnits: 0,
      returnUnits: 0,
      refundUnits: 0,
      refundAmount: 0,
      returnRate: 0,
      refundRate: 0,
      revenueAtRisk: 0,
      marginAtRisk: 0,
      estimatedImpact: 0,
      reviewCount: 0,
      negativeReviewCount: 0,
      negativeReviewRate: 0,
      windowDays: 0,
      vendor: product.vendor || "",
      productType: product.productType || "",
      productStatus: product.status || "",
      tags,
      collections: collectionTitles,
      collectionHandles: collections.map((collection) => collection.handle).filter(Boolean),
      variantCount: variants.length,
      skuCount,
      optionNames,
      hasDescription: descriptionWordCount > 0,
      descriptionWordCount,
      createdFromShopifySearchAt: now.toISOString(),
    },
    calculatedAt: now,
  };
}

function formatShopifyProductSearchResult(product, existingProductGids = new Set()) {
  const mediaNode = product.media?.nodes?.[0] || {};
  const image = product.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};
  const collections = getConnectionNodes(product.collections);
  const variants = getConnectionNodes(product.variants);
  const vendorAndType = [product.vendor, product.productType].filter(Boolean).join(" / ");
  const firstCollection = collections[0]?.title;

  return {
    id: product.id,
    title: product.title || product.handle || "Shopify product",
    handle: product.handle || "",
    status: product.status || "Unknown",
    vendor: product.vendor || "",
    productType: product.productType || "",
    sku: variants[0]?.sku || "",
    collection: firstCollection || "",
    detail: [vendorAndType, firstCollection].filter(Boolean).join(" - "),
    imageUrl: image.url || null,
    imageAlt: image.altText || null,
    variant: getProductArtVariant(product.handle),
    existingSnapshot: existingProductGids.has(product.id),
    href: product.handle ? `/app/products/${product.handle}` : `/app/products/${encodeURIComponent(product.id)}`,
  };
}

function buildShopifyProductSearchQuery(query) {
  const trimmed = String(query || "").trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(trimmed)) return `id:${trimmed.split("/").pop()}`;
  if (/^\d{5,}$/.test(trimmed)) return `id:${trimmed}`;
  return trimmed;
}

function normalizeShopifyProductGid(value) {
  const input = String(value || "").trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(input)) return input;
  if (/^\d{5,}$/.test(input)) return `gid://shopify/Product/${input}`;
  return null;
}

function getConnectionNodes(connection) {
  if (Array.isArray(connection)) return connection.filter(Boolean);
  if (Array.isArray(connection?.nodes)) return connection.nodes.filter(Boolean);
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge?.node).filter(Boolean);
  return [];
}

function withShopifyAdminUrl(product, shop) {
  if (!product) return product;
  return {
    ...product,
    shopifyAdminUrl: getShopifyProductAdminUrl(shop, product.id),
  };
}

function getShopifyProductAdminUrl(shop, productGid) {
  const numericId = String(productGid || "").split("/").pop();
  if (!shop || !numericId) return null;
  return `https://${shop}/admin/products/${numericId}`;
}

function formatLiveShopifyProductForDiagnosis(product) {
  const mediaNode = product.media?.nodes?.[0] || {};
  const image = product.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};
  const variants = product.variants?.nodes || [];
  const collections = (product.collections?.nodes || []).map((collection) => collection.title).filter(Boolean);
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const optionNames = (product.options || []).map((option) => option.name).filter(Boolean);
  const skuCount = variants.filter((variant) => variant.sku).length;

  return {
    id: product.id,
    slug: product.handle,
    title: product.title,
    handle: product.handle,
    currentDescriptionHtml: product.descriptionHtml || "",
    currentDescriptionText: stripHtml(product.descriptionHtml || product.description || ""),
    collection: collections[0] || product.productType || product.vendor || "Shopify catalog",
    status: product.status || "Unknown",
    riskScore: 0,
    impactScore: 0,
    confidence: 0,
    riskTone: "success",
    riskLabel: "Not scanned",
    creditCost: 1,
    sourceCoverage: ["Shopify products"],
    lastAnalysis: null,
    analysisDepth: "catalog",
    analysisLabel: "Not scanned",
    analysisDetail: "No QuickScan or product diagnosis has been stored yet.",
    analysisTone: "neutral",
    analysisIcon: "product",
    analysisCompletedAt: null,
    latestDiagnosisId: null,
    primaryIssue: null,
    hasRiskSnapshot: false,
    canDiagnose: false,
    canResolve: false,
    imageUrl: image.url || null,
    imageAlt: image.altText || null,
    metrics: {
      returnRate: 0,
      refundRate: 0,
      reviewRating: 0,
      issueCount: 0,
      revenueAtRisk: 0,
      marginAtRisk: 0,
      signalCount: 0,
      refundAmount: 0,
      returnUnits: 0,
      refundUnits: 0,
      soldUnits: 0,
      recentSignalUnits: 0,
      windowDays: 0,
      productType: product.productType || "",
      vendor: product.vendor || "",
      tags,
      collections,
      variantCount: variants.length,
      skuCount,
      optionNames,
    },
    evidence: [{
      source: "Shopify product",
      quote: `${product.status || "Unknown status"} product in Shopify`,
      weight: `${variants.length} variants, ${skuCount} SKUs, ${tags.length} tags`,
    }],
    issues: [],
    recommendedActions: [],
    actionHistory: [],
    resolvedAt: null,
  };
}

function formatSnapshotForDiagnosis(snapshot, actions = [], latestDiagnosis = null, settings = undefined) {
  const metrics = snapshot.metrics || {};
  const diagnosisReport = metrics.diagnosisReport || {};
  const diagnosisIssues = Array.isArray(latestDiagnosis?.issues) ? latestDiagnosis.issues : null;
  const diagnosisEvidence = Array.isArray(latestDiagnosis?.evidence) ? latestDiagnosis.evidence : null;
  const diagnosisRecommendations = Array.isArray(latestDiagnosis?.recommendations) ? latestDiagnosis.recommendations : null;
  const storedActions = actions.map(formatStoredProductAction);
  const resolvedAction = storedActions.find((action) => action.actionId === "mark-resolved" && action.status === "applied");
  const analysisState = getProductAnalysisState(snapshot, latestDiagnosis);
  const hasFullDiagnosis = analysisState.depth === "full";
  const riskScore = latestDiagnosis?.riskScore ?? snapshot.riskScore;
  const confidence = latestDiagnosis?.confidence ?? snapshot.confidence;
  const primaryIssue = latestDiagnosis?.likelyCause || snapshot.primaryIssue;

  return {
    id: snapshot.productGid,
    productGid: snapshot.productGid,
    slug: snapshot.handle,
    title: snapshot.productTitle,
    handle: snapshot.handle,
    collection: metrics.collections?.[0] || metrics.productType || "Shopify catalog",
    status: "Active",
    riskScore,
    impactScore: snapshot.impactScore,
    confidence,
    riskTone: getRiskTone(riskScore, settings),
    riskLabel: getRiskLabel(riskScore, settings),
    creditCost: 1,
    sourceCoverage: Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : ["Shopify products"],
    lastAnalysis: toIso(snapshot.updatedAt),
    analysisDepth: analysisState.depth,
    analysisLabel: analysisState.label,
    analysisDetail: analysisState.detail,
    analysisTone: analysisState.tone,
    analysisIcon: analysisState.icon,
    analysisCompletedAt: analysisState.completedAt,
    latestDiagnosisId: latestDiagnosis?.id || metrics.latestDiagnosisId || null,
    primaryIssue,
    mainFinding: diagnosisReport.mainFinding || null,
    hasRiskSnapshot: true,
    canDiagnose: true,
    canResolve: true,
    metrics: {
      returnRate: metrics.returnRate || 0,
      refundRate: metrics.refundRate || 0,
      reviewRating: metrics.reviewRating || metrics.avgRating || 0,
      avgRating: metrics.avgRating || metrics.reviewRating || 0,
      reviewCount: metrics.reviewCount || 0,
      negativeReviewCount: metrics.negativeReviewCount || 0,
      negativeReviewRate: metrics.negativeReviewRate || 0,
      recentNegativeReviewCount: metrics.recentNegativeReviewCount || 0,
      issueCount: metrics.signalCount || 0,
      revenueAtRisk: metrics.revenueAtRisk || metrics.estimatedImpact || metrics.refundAmount || 0,
      marginAtRisk: metrics.marginAtRisk || (metrics.revenueAtRisk ? metrics.revenueAtRisk * 0.45 : 0),
      estimatedImpact: metrics.estimatedImpact || metrics.revenueAtRisk || metrics.refundAmount || 0,
      signalCount: metrics.signalCount || 0,
      salesAmount: metrics.salesAmount || 0,
      avgUnitRevenue: metrics.avgUnitRevenue || 0,
      refundAmount: metrics.refundAmount || 0,
      returnUnits: metrics.returnUnits || 0,
      refundUnits: metrics.refundUnits || 0,
      recentSignalUnits: metrics.recentSignalUnits || 0,
      windowDays: metrics.windowDays || 60,
      soldUnits: metrics.soldUnits || 0,
      storeAvgReturnRate: metrics.storeAvgReturnRate || 0,
      storeAvgRefundRate: metrics.storeAvgRefundRate || 0,
      lastSignalAt: metrics.lastSignalAt || null,
      signalTrend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
      riskTrend: Array.isArray(metrics.riskTrend) ? metrics.riskTrend : [],
      productType: metrics.productType || "",
      vendor: metrics.vendor || "",
      tags: Array.isArray(metrics.tags) ? metrics.tags : [],
      collections: Array.isArray(metrics.collections) ? metrics.collections : [],
      topReturnReasons: Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [],
      affectedVariants: Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [],
      textInsights: metrics.textInsights || null,
      checkedSources: Array.isArray(diagnosisReport.checkedSources) ? diagnosisReport.checkedSources : [],
      aiModels: diagnosisReport.aiModels || null,
      orderAccessDenied: Boolean(metrics.orderAccessDenied),
    },
    evidence: diagnosisEvidence || getSnapshotEvidence(snapshot, metrics),
    issues: diagnosisIssues || getSnapshotIssues(snapshot, metrics, settings),
    recommendedActions: hasFullDiagnosis ? (diagnosisRecommendations || getSnapshotRecommendedActions(snapshot, metrics)) : [],
    actionHistory: storedActions,
    resolvedAt: resolvedAction?.appliedAt || null,
  };
}

function formatStoredProductAction(action) {
  return {
    id: action.id,
    actionId: action.actionType,
    label: action.label,
    status: action.status,
    payload: action.payload || {},
    createdAt: toIso(action.createdAt),
    appliedAt: toIso(action.appliedAt),
  };
}

function escapeShopifyQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getSnapshotEvidence(snapshot, metrics) {
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const windowDays = metrics.windowDays || 60;
  const evidence = [{
    source: "Shopify product",
    quote: `${metrics.productType || "Product"}${metrics.vendor ? ` by ${metrics.vendor}` : ""}`,
    weight: `${Array.isArray(metrics.collections) ? metrics.collections.length : 0} collections, ${Array.isArray(metrics.tags) ? metrics.tags.length : 0} tags`,
  }];

  if (Number(metrics.returnUnits || 0) > 0 || topReturnReasons.length) {
    evidence.push({
      source: "Returns",
      quote: topReturnReasons.length ? topReturnReasons.join(", ") : "0 repeated return reasons captured",
      weight: `${metrics.returnUnits || 0} return units in ${windowDays} days`,
    });
  }

  if (Number(metrics.refundUnits || 0) > 0 || Number(metrics.refundAmount || 0) > 0) {
    evidence.push({
      source: "Refunds",
      quote: `${formatMoney(metrics.refundAmount || 0)} refunded`,
      weight: `${metrics.refundUnits || 0} refunded units`,
    });
  }

  if (affectedVariants.length || Number(metrics.recentSignalUnits || 0) > 0) {
    evidence.push({
      source: "Variants",
      quote: affectedVariants.length ? affectedVariants.join(", ") : "No variant concentration detected",
      weight: `${metrics.recentSignalUnits || 0} recent signal units`,
    });
  }

  return evidence;
}

function getSnapshotIssues(snapshot, metrics, settings = undefined) {
  const rawSignalCount = Number(metrics.signalCount || 0);
  if (!snapshot.primaryIssue || rawSignalCount <= 0) return [];

  const signalCount = Math.max(rawSignalCount, 1);
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];

  return [
    {
      issue: snapshot.primaryIssue,
      severity: getRiskLabel(snapshot.riskScore, settings),
      confidence: snapshot.confidence,
      signals: signalCount,
      evidence: topReturnReasons,
      trend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
    },
    {
      issue: affectedVariants.length ? `Affected scope: ${affectedVariants.join(", ")}` : "Signal concentration needs review",
      severity: getRiskLabel(snapshot.riskScore, settings),
      confidence: Math.max(snapshot.confidence - 9, 35),
      signals: Math.max(Math.round(signalCount * 0.62), 1),
      evidence: affectedVariants,
      trend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
    },
  ];
}

function getSnapshotRecommendedActions(snapshot, metrics) {
  const issueCategory = getSnapshotIssueCategory(snapshot.primaryIssue);
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const reasonText = topReturnReasons.length ? topReturnReasons.join(", ") : snapshot.primaryIssue;
  const variantText = affectedVariants.length ? affectedVariants.join(", ") : "affected variants";
  const actions = [];

  if (Number(metrics.signalCount || 0) > 0 && snapshot.primaryIssue) {
    actions.push({
      id: "draft-pdp-copy",
      label: getPdpCopyActionLabel(issueCategory),
      type: "PDP copy",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: `ProductPulse detected ${reasonText}. Add shopper-facing guidance that clarifies ${issueCategory.toLowerCase()} expectations for ${snapshot.productTitle}.`,
      },
    });
  }

  if (topReturnReasons.length || Number(metrics.returnUnits || 0) > 0) {
    actions.push({
      id: "review-return-reasons",
      label: "Review return reasons",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { topReturnReasons, returnUnits: metrics.returnUnits || 0 },
    });
  }

  if (affectedVariants.length) {
    actions.push({
      id: "review-affected-variants",
      label: "Review affected variants",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { affectedVariants },
    });
  }

  if (metrics.refundPressure?.highPressure || Number(metrics.refundUnits || 0) >= 3) {
    actions.push({
      id: "review-refund-impact",
      label: "Review refund impact",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: {
        refundAmount: metrics.refundAmount,
        refundUnits: metrics.refundUnits || 0,
        refundRate: metrics.refundRate || 0,
        refundPressure: metrics.refundPressure || null,
      },
    });
  }

  if (Number(metrics.signalCount || 0) > 0 && snapshot.primaryIssue) {
    actions.push({
      id: "copy-support-note",
      label: "Share internal note with support team",
      type: "Internal note",
      effort: "Low",
      status: "Ready",
      payload: {
        note: `${snapshot.productTitle}: ${snapshot.primaryIssue}. Mention ${reasonText}; watch ${variantText}.`,
      },
    });
  }

  return actions;
}

function getResolvedAction(snapshot) {
  return {
    id: "mark-resolved",
    label: "Mark product as resolved",
    type: "Workflow",
    effort: "Low",
    status: "Ready",
    applyImmediately: true,
    payload: { productGid: snapshot.productGid, resolvedAt: new Date().toISOString() },
  };
}

function getIgnoredIssueAction(snapshot, payloadOverride = {}) {
  const issue = String(payloadOverride.issue || "Product issue").trim() || "Product issue";
  const issueCode = String(payloadOverride.issueCode || "").trim();
  const issueKey = String(payloadOverride.issueKey || normalizeIgnoredIssueKey(issueCode || issue)).trim();
  return {
    id: "ignore-issue",
    label: `Ignore issue: ${issue}`,
    type: "Workflow",
    effort: "Low",
    status: "Ignored",
    applyImmediately: true,
    payload: {
      productGid: snapshot.productGid,
      issue,
      issueCode,
      issueKey,
      suggestedAction: String(payloadOverride.suggestedAction || "").trim(),
      ignoredAt: new Date().toISOString(),
    },
  };
}

function normalizeIgnoredIssueKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function getSnapshotIssueCategory(issue) {
  const normalized = String(issue || "").toLowerCase();
  if (normalized.includes("fit") || normalized.includes("sizing") || normalized.includes("waist") || normalized.includes("small")) return "Fit & sizing";
  if (normalized.includes("zipper") || normalized.includes("defect") || normalized.includes("break")) return "Durability";
  if (normalized.includes("fear") || normalized.includes("scare") || normalized.includes("unsafe") || normalized.includes("danger") || normalized.includes("miedo") || normalized.includes("asusta")) return "Fear or safety concern";
  if (normalized.includes("compat")) return "Compatibility";
  return "Product quality";
}

function getPdpCopyActionLabel(issueCategory) {
  if (issueCategory === "Fit & sizing") return "Draft fit note for product description";
  if (issueCategory === "Durability") return "Draft durability expectation note";
  if (issueCategory === "Compatibility") return "Draft compatibility FAQ";
  return "Draft product quality note";
}

function formatJob(job) {
  const productTitle = getJobProductTitle(job);
  const productHandle = getJobProductHandle(job);
  const displayTitle = getJobDisplayTitle(job, productTitle);
  const displaySubtitle = getJobDisplaySubtitle(job, productTitle);
  const executionStartedAt = job.status === "Queued" ? null : job.startedAt;

  return {
    id: job.id,
    kind: job.kind,
    name: getJobDisplayName(job.kind),
    productTitle,
    productHandle,
    productHref: productHandle ? `/app/products/${productHandle}` : null,
    displayTitle,
    displaySubtitle,
    source: job.errorMessage || job.source,
    errorMessage: job.errorMessage || null,
    status: job.status,
    progress: job.progress,
    updatedAt: formatJobDate(job.updatedAt),
    updatedAtIso: toIso(job.updatedAt),
    startedAt: job.startedAt,
    startedAtIso: toIso(job.startedAt),
    executionStartedAt,
    executionStartedAtIso: toIso(executionStartedAt),
    finishedAt: job.finishedAt,
    finishedAtIso: toIso(job.finishedAt),
    elapsedMs: job.status === "Queued" ? 0 : getElapsedMs(job.startedAt, job.finishedAt),
  };
}

function getJobDisplayName(kind) {
  if (kind === FAST_PRODUCT_SCAN_KIND) return "Fast product scan";
  if (kind === PRODUCT_DIAGNOSIS_KIND) return "AI Product Diagnosis";
  return kind;
}

function getJobProductTitle(job) {
  return typeof job.payload?.productTitle === "string" && job.payload.productTitle.trim()
    ? job.payload.productTitle.trim()
    : null;
}

function getJobProductHandle(job) {
  return typeof job.payload?.handle === "string" && job.payload.handle.trim()
    ? job.payload.handle.trim()
    : null;
}

function getJobDisplayTitle(job, productTitle) {
  if (job.kind === PRODUCT_DIAGNOSIS_KIND && productTitle) return productTitle;
  return getJobDisplayName(job.kind);
}

function getJobDisplaySubtitle(job, productTitle) {
  if (job.kind !== PRODUCT_DIAGNOSIS_KIND || !productTitle) return job.errorMessage || job.source;
  if (job.status === "Queued") return "Queued AI product diagnostics";
  if (job.status === "Running") return "Running AI product diagnostics";
  if (job.status === "Completed") return "AI product diagnostics completed";
  if (job.status === "Failed") return "AI product diagnostics failed";
  return "AI product diagnostics";
}

function formatJobLog(log) {
  return {
    id: log.id,
    jobId: log.jobId,
    level: log.level,
    event: log.event,
    message: log.message,
    data: log.data,
    createdAt: formatJobDate(log.createdAt),
    createdAtIso: toIso(log.createdAt),
  };
}

function formatJobDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return seconds <= 5 ? "Just now" : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getElapsedMs(startedAt, finishedAt) {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

function getRiskLabel(score, settings = undefined) {
  return getRiskLabelForScore(score, settings);
}

function getRiskTone(score, settings = undefined) {
  return getRiskToneForScore(score, settings);
}

function getProductArtVariant(handle) {
  if (handle?.includes("vest") || handle?.includes("hoodie")) return "hoodie";
  if (handle?.includes("pour") || handle?.includes("bottle")) return "bottle";
  if (handle?.includes("tote")) return "tote";
  return "shirt";
}

function getSourceToken(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("product") || normalized.includes("catalog")) {
    return {
      key: "products",
      label: "Products",
      shortLabel: "PDP",
      detail: "Shopify product, variant, tag and collection data.",
    };
  }
  if (normalized.includes("order") || normalized.includes("sale")) {
    return {
      key: "orders",
      label: "Orders",
      shortLabel: "ORD",
      detail: "Shopify order line items and sold units.",
    };
  }
  if (normalized.includes("refund")) {
    return {
      key: "refunds",
      label: "Refunds",
      shortLabel: "REF",
      detail: "Shopify refunded units and refund amount.",
    };
  }
  if (normalized.includes("return")) {
    return {
      key: "returns",
      label: "Returns",
      shortLabel: "RET",
      detail: "Shopify return units, return notes and return reasons.",
    };
  }
  if (normalized.includes("review") || normalized.includes("judge") || normalized.includes("csv")) {
    return {
      key: "reviews",
      label: "Reviews",
      shortLabel: "REV",
      detail: "Customer review ratings, text and complaint themes.",
    };
  }
  if (normalized.includes("support") || normalized.includes("chat")) {
    return {
      key: "support",
      label: "Support",
      shortLabel: "SUP",
      detail: "Support conversations, buyer questions and agent notes.",
    };
  }
  return {
    key: "source",
    label: source || "Source",
    shortLabel: "SRC",
    detail: source || "Additional connected signal source.",
  };
}

function getSignalBars(metrics) {
  return getSignalLifecycleBars(metrics).map((bar) => bar.value);
}

function getSignalDetails(snapshot, metrics) {
  const signalCount = Number(metrics.signalCount || 0);
  const bars = getSignalLifecycleBars(metrics);
  const strongestBars = bars
    .filter((bar) => bar.value > 12)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);
  const strongestSummary = strongestBars.length
    ? ` Strongest lifecycle signal${strongestBars.length === 1 ? "" : "s"}: ${strongestBars.map((bar) => `${bar.label} ${bar.value}/100`).join(", ")}.`
    : "";

  return {
    summary: `${snapshot.primaryIssue || "Product quality"} product risk ${snapshot.riskScore}/100 from ${signalCount} signal${signalCount === 1 ? "" : "s"}. Bars run left to right from product setup to post-purchase pressure.${strongestSummary}`,
    bars,
  };
}

function getSignalLifecycleBars(metrics = {}) {
  const normalizedMetrics = metrics || {};
  return [
    {
      key: "product_setup",
      label: "Product setup",
      value: getProductSetupSignalValue(normalizedMetrics),
      detail: getProductSetupSignalDetail(normalizedMetrics),
    },
    {
      key: "pdp_content",
      label: "PDP content",
      value: getPdpContentSignalValue(normalizedMetrics),
      detail: getPdpContentSignalDetail(normalizedMetrics),
    },
    {
      key: "reviews",
      label: "Reviews",
      value: getReviewSignalValue(normalizedMetrics),
      detail: getReviewSignalDetail(normalizedMetrics),
    },
    {
      key: "repeated_reasons",
      label: "Repeated reasons",
      value: getRepeatedReasonSignalValue(normalizedMetrics),
      detail: getRepeatedReasonSignalDetail(normalizedMetrics),
    },
    {
      key: "refund_pressure",
      label: "Refund pressure",
      value: getRefundSignalValue(normalizedMetrics),
      detail: getRefundSignalDetail(normalizedMetrics),
    },
    {
      key: "return_pressure",
      label: "Return pressure",
      value: getReturnSignalValue(normalizedMetrics),
      detail: getReturnSignalDetail(normalizedMetrics),
    },
    {
      key: "recent_trend",
      label: "Recent trend",
      value: getRecentTrendSignalValue(normalizedMetrics),
      detail: getRecentTrendSignalDetail(normalizedMetrics),
    },
  ].map((bar) => ({
    ...bar,
    value: clampSignalBar(bar.value),
  }));
}

function getProductSetupSignalValue(metrics) {
  const checks = getProductSetupChecks(metrics);
  const knownChecks = checks.filter((check) => check.known);
  const missingChecks = knownChecks.filter((check) => !check.present);
  const completenessRisk = knownChecks.length
    ? (missingChecks.length / knownChecks.length) * 46
    : 0;
  const inactiveStatusRisk = hasText(metrics.productStatus) && String(metrics.productStatus).toLowerCase() !== "active" ? 18 : 0;
  return 4 + completenessRisk + inactiveStatusRisk;
}

function getProductSetupSignalDetail(metrics) {
  const checks = getProductSetupChecks(metrics).filter((check) => check.known);
  if (!checks.length) return "Catalog setup has not been captured for this product yet.";

  const present = checks.filter((check) => check.present);
  const missing = checks.filter((check) => !check.present);
  const missingText = missing.length
    ? ` Missing: ${missing.map((check) => check.label).join(", ")}.`
    : " No catalog setup gaps detected.";
  return `${present.length}/${checks.length} catalog checks present: ${present.map((check) => check.label).join(", ") || "none"}.${missingText}`;
}

function getProductSetupChecks(metrics) {
  const variantCount = Number(metrics.variantCount);
  const skuCount = Number(metrics.skuCount);
  return [
    {
      label: "type",
      known: Object.prototype.hasOwnProperty.call(metrics, "productType"),
      present: hasText(metrics.productType),
    },
    {
      label: "vendor",
      known: Object.prototype.hasOwnProperty.call(metrics, "vendor"),
      present: hasText(metrics.vendor),
    },
    {
      label: "tags",
      known: Object.prototype.hasOwnProperty.call(metrics, "tags"),
      present: getList(metrics.tags).length > 0,
    },
    {
      label: "collections",
      known: Object.prototype.hasOwnProperty.call(metrics, "collections"),
      present: getList(metrics.collections).length > 0,
    },
    {
      label: "variants",
      known: Number.isFinite(variantCount),
      present: variantCount > 0,
    },
    {
      label: "SKUs",
      known: Number.isFinite(skuCount),
      present: skuCount > 0,
    },
    {
      label: "options",
      known: Object.prototype.hasOwnProperty.call(metrics, "optionNames"),
      present: getList(metrics.optionNames).length > 0,
    },
  ];
}

function getPdpContentSignalValue(metrics) {
  const contentIssueCount = Number(metrics.contentIssueCount || 0);
  const contentQualityRisk = Number(metrics.contentQualityRisk || 0);
  const contentQualityScore = Number(metrics.contentQualityScore);
  const descriptionWordCount = Number(metrics.descriptionWordCount);
  const hasDescriptionKnown = Object.prototype.hasOwnProperty.call(metrics, "hasDescription");
  let value = contentQualityRisk * 3.1 + contentIssueCount * 12;

  if (Number.isFinite(contentQualityScore)) value += Math.max(0, 84 - contentQualityScore) * 0.65;
  if (hasDescriptionKnown && !metrics.hasDescription) value += 58;
  if (Number.isFinite(descriptionWordCount) && descriptionWordCount > 0 && descriptionWordCount < 25) value += 22;

  return value || 4;
}

function getPdpContentSignalDetail(metrics) {
  const contentIssueCount = Number(metrics.contentIssueCount || 0);
  const contentQualityRisk = Number(metrics.contentQualityRisk || 0);
  const contentQualityScore = Number(metrics.contentQualityScore);
  const descriptionWordCount = Number(metrics.descriptionWordCount);
  const contentIssues = getContentIssueLabels(metrics);
  const pieces = [];

  if (Number.isFinite(descriptionWordCount)) pieces.push(`${descriptionWordCount} description words`);
  if (Number.isFinite(contentQualityScore)) pieces.push(`content quality ${contentQualityScore}/100`);
  if (contentIssueCount) pieces.push(`${contentIssueCount} content issue${contentIssueCount === 1 ? "" : "s"}`);
  if (contentQualityRisk) pieces.push(`PDP content risk ${Math.round(contentQualityRisk)}/100`);
  if (contentIssues.length) pieces.push(`Issues: ${contentIssues.slice(0, 3).join(", ")}`);

  return pieces.length
    ? `${pieces.join(". ")}.`
    : "PDP copy and description quality require a full product diagnosis before this bar has detail.";
}

function getReviewSignalValue(metrics) {
  const reviewCount = getReviewCount(metrics);
  if (!reviewCount) return 4;

  const negativeReviewCount = Number(metrics.negativeReviewCount || metrics.csvLowRatingCount || 0);
  const negativeReviewRate = Number(metrics.negativeReviewRate || metrics.csvNegativeRatingRate || 0);
  const averageRating = Number(metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating || 0);
  const ratingPressure = averageRating > 0 ? Math.max(0, 4 - averageRating) * 14 : 0;
  const samplePressure = Math.min(18, Math.log2(reviewCount + 1) * 4);
  const criticalPressure = Number(metrics.csvCriticalRatingCount || 0) * 5;
  const csvRatingRisk = Number(metrics.csvRatingRisk || metrics.riskComponents?.csvRatingRisk || 0);

  return negativeReviewRate * 0.7
    + ratingPressure
    + samplePressure
    + criticalPressure
    + csvRatingRisk * 0.55
    + negativeReviewCount * 2;
}

function getReviewSignalDetail(metrics) {
  const reviewCount = getReviewCount(metrics);
  if (!reviewCount) return "No connected review rating signal has been matched to this product yet.";

  const negativeReviewCount = Number(metrics.negativeReviewCount || metrics.csvLowRatingCount || 0);
  const negativeReviewRate = Number(metrics.negativeReviewRate || metrics.csvNegativeRatingRate || 0);
  const averageRating = Number(metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating || 0);
  const sourceBreakdown = getReviewSourceBreakdown(metrics);
  const sourceText = sourceBreakdown.length ? ` Sources: ${sourceBreakdown.join(", ")}.` : "";

  return `${reviewCount} review rating${reviewCount === 1 ? "" : "s"}, ${negativeReviewCount} negative or low-rated (${formatPercent(negativeReviewRate)}), average rating ${averageRating ? averageRating.toFixed(1) : "n/a"}.${sourceText}`;
}

function getRepeatedReasonSignalValue(metrics) {
  const repeatedReasonUnits = getReasonSignalUnits(metrics.topReturnReasonDetails || metrics.topReturnReasons)
    + getReasonSignalUnits(metrics.topRefundReasonDetails || metrics.topRefundReasons);
  const repeatedLanguageUnits = getRepeatedLanguageUnits(metrics);
  const affectedVariantUnits = getList(metrics.affectedVariants).length;
  const repeatedReasonRisk = Number(metrics.riskComponents?.repeatedReasonRisk || 0);
  const variantRisk = Number(metrics.riskComponents?.variantConcentration || 0);

  return repeatedReasonRisk
    + variantRisk
    + repeatedReasonUnits * 8
    + repeatedLanguageUnits * 6
    + affectedVariantUnits * 5;
}

function getRepeatedReasonSignalDetail(metrics) {
  const reasons = [
    ...getReasonLabels(metrics.topReturnReasonDetails || metrics.topReturnReasons, "return"),
    ...getReasonLabels(metrics.topRefundReasonDetails || metrics.topRefundReasons, "refund"),
  ];
  const repeatedLanguage = getRepeatedLanguageLabels(metrics);
  const affectedVariants = getList(metrics.affectedVariants);
  const pieces = [];

  if (reasons.length) pieces.push(`Repeated reasons: ${reasons.slice(0, 4).join(", ")}`);
  if (repeatedLanguage.length) pieces.push(`Repeated language: ${repeatedLanguage.slice(0, 4).join(", ")}`);
  if (affectedVariants.length) pieces.push(`Affected variants: ${affectedVariants.slice(0, 4).join(", ")}`);

  return pieces.length
    ? `${pieces.join(". ")}.`
    : "No repeated reason, language cluster, or variant concentration has been captured yet.";
}

function getRefundSignalValue(metrics) {
  const refundRate = Number(metrics.refundRate || 0);
  const refundUnits = Number(metrics.refundUnits || 0);
  const refundAmount = Number(metrics.refundAmount || 0);
  const refundRisk = Number(metrics.riskComponents?.refundRisk || 0);
  const refundPressureRisk = Number(metrics.riskComponents?.refundPressureRisk || 0);
  const impactRisk = Number(metrics.riskComponents?.impactRisk || 0);
  const refundOperationalRisk = Number(metrics.refundInsights?.riskLift || 0);
  const refundReasonUnits = getReasonSignalUnits(metrics.topRefundReasonDetails || metrics.topRefundReasons);

  return Math.max(refundRisk, refundPressureRisk)
    + impactRisk * 0.75
    + refundOperationalRisk * 5
    + refundRate * 1.9
    + refundUnits * 4.5
    + Math.log10(refundAmount + 1) * 9
    + refundReasonUnits * 4;
}

function getRefundSignalDetail(metrics) {
  const refundRate = Number(metrics.refundRate || 0);
  const refundUnits = Number(metrics.refundUnits || 0);
  const refundAmount = Number(metrics.refundAmount || 0);
  const refundReasons = getReasonLabels(metrics.topRefundReasonDetails || metrics.topRefundReasons, "refund");
  const notes = getList(metrics.refundNotes);
  const pieces = [
    `${refundUnits} refunded unit${refundUnits === 1 ? "" : "s"}`,
    `${formatPercent(refundRate)} refund rate`,
    `${formatMoney(refundAmount)} refunded`,
  ];

  if (refundReasons.length) pieces.push(`Reasons: ${refundReasons.slice(0, 3).join(", ")}`);
  if (notes.length) pieces.push(`Notes captured: ${notes.length}`);

  return `${pieces.join(". ")}.`;
}

function getReturnSignalValue(metrics) {
  const returnRate = Number(metrics.returnRate || 0);
  const returnUnits = Number(metrics.returnUnits || 0);
  const returnRisk = Number(metrics.riskComponents?.returnRisk || 0);
  const repeatedReasonRisk = Number(metrics.riskComponents?.repeatedReasonRisk || 0);
  const returnReasonUnits = getReasonSignalUnits(metrics.topReturnReasonDetails || metrics.topReturnReasons);

  return returnRisk
    + repeatedReasonRisk * 0.45
    + returnRate * 2.15
    + returnUnits * 5
    + returnReasonUnits * 4;
}

function getReturnSignalDetail(metrics) {
  const returnRate = Number(metrics.returnRate || 0);
  const returnUnits = Number(metrics.returnUnits || 0);
  const reasons = getReasonLabels(metrics.topReturnReasonDetails || metrics.topReturnReasons, "return");
  const pieces = [
    `${returnUnits} return unit${returnUnits === 1 ? "" : "s"}`,
    `${formatPercent(returnRate)} return rate`,
  ];

  if (reasons.length) pieces.push(`Reasons: ${reasons.slice(0, 4).join(", ")}`);
  return `${pieces.join(". ")}.`;
}

function getRecentTrendSignalValue(metrics) {
  const recentSpike = Number(metrics.riskComponents?.recentSpike || 0);
  const recentSignalUnits = Number(metrics.recentSignalUnits || 0);
  const trendValues = getNumericList(metrics.signalTrend);
  if (!trendValues.length) return recentSpike + recentSignalUnits * 11;

  const maxTrend = Math.max(...trendValues, 1);
  const lastTrend = trendValues[trendValues.length - 1] || 0;
  const firstTrend = trendValues[0] || 0;
  const directionPressure = Math.max(0, lastTrend - firstTrend) * 0.45;
  return recentSpike + recentSignalUnits * 8 + (lastTrend / maxTrend) * 42 + directionPressure;
}

function getRecentTrendSignalDetail(metrics) {
  const recentSignalUnits = Number(metrics.recentSignalUnits || 0);
  const lastSignalAt = metrics.lastSignalAt ? formatJobDate(metrics.lastSignalAt) : "No recent signal date";
  const trendValues = getNumericList(metrics.signalTrend);
  const movement = getTrendMovementLabel(trendValues);
  return `${recentSignalUnits} recent signal unit${recentSignalUnits === 1 ? "" : "s"}. Last signal: ${lastSignalAt}. Trend movement: ${movement}.`;
}

function getTrendMovementLabel(values) {
  if (!values.length) return "not enough dated signal data yet";
  const first = values[0] || 0;
  const last = values[values.length - 1] || 0;
  const peak = Math.max(...values);
  const peakIndex = values.indexOf(peak);
  if (peak > Math.max(first, last) * 1.35 && peakIndex > 0 && peakIndex < values.length - 1) return "past spike";
  if (last > first * 1.2) return "rising";
  if (last < first * 0.8) return "falling";
  return "stable";
}

function getReviewCount(metrics) {
  return Number(metrics.reviewCount || 0)
    || Number(metrics.csvReviewRatingCount || 0)
    || Number(metrics.csvReviewCount || 0)
    || Number(metrics.judgeMeReviewCount || 0);
}

function getReviewSourceBreakdown(metrics) {
  const sources = [];
  const judgeMeCount = Number(metrics.judgeMeReviewCount || metrics.reviewSourceStats?.judgeMe?.reviewCount || 0);
  const csvCount = Number(metrics.csvReviewRatingCount || metrics.csvReviewCount || metrics.reviewSourceStats?.csv?.reviewCount || 0);
  if (judgeMeCount) sources.push(`Judge.me ${judgeMeCount}`);
  if (csvCount) sources.push(`CSV ${csvCount}`);
  return sources;
}

function getContentIssueLabels(metrics) {
  return getList(metrics.contentIssues).map((issue) => {
    if (typeof issue === "string") return issue;
    return issue.label || issue.title || issue.code || issue.issueCode || "";
  }).filter(Boolean);
}

function getReasonSignalUnits(value) {
  const list = getList(value);
  if (!list.length) return 0;
  return list.reduce((sum, item) => {
    if (typeof item === "string") return sum + 1;
    return sum + Math.max(1, Number(item.count || item.quantity || item.units || 1));
  }, 0);
}

function getReasonLabels(value, fallbackType) {
  return getList(value).map((item) => {
    if (typeof item === "string") return item;
    const label = item.label || item.reason || item.name || item.value || fallbackType;
    const count = Number(item.count || item.quantity || item.units || 0);
    return count > 1 ? `${label} (${count})` : label;
  }).filter(Boolean);
}

function getRepeatedLanguageUnits(metrics) {
  return getList(metrics.textInsights?.repeatedLanguage).reduce((sum, item) => {
    if (typeof item === "string") return sum + 1;
    return sum + Math.max(1, Number(item.count || 1));
  }, 0);
}

function getRepeatedLanguageLabels(metrics) {
  return getList(metrics.textInsights?.repeatedLanguage).map((item) => {
    if (typeof item === "string") return item;
    const label = item.term || item.label || item.phrase || item.value || "";
    const count = Number(item.count || 0);
    return label ? `${label}${count > 1 ? ` (${count})` : ""}` : "";
  }).filter(Boolean);
}

function getNumericList(value) {
  return getList(value).map(Number).filter((item) => Number.isFinite(item));
}

function getList(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function formatPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0%";
  return `${Math.round(number * 10) / 10}%`;
}

function clampSignalBar(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 4;
  return Math.round(Math.min(100, Math.max(4, number)));
}

export const __productPulseJobsTestHooks = {
  buildManualProductRiskSnapshotPayload,
  buildProductPulseFaqHtml,
  getSignalLifecycleBars,
  normalizeFaqItemsForApply,
  getFaqApplyVariant,
};

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}
