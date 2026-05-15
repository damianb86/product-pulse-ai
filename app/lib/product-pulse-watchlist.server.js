import prisma from "../db.server";
import { getProductScoreHistoryForShop } from "./product-pulse-history.server";
import { getRiskLabelForScore, getRiskToneForScore } from "./product-pulse-settings.server";

export const WATCHLIST_MAX_PRODUCTS = 5;

export async function getWatchlistForShop(shop) {
  const items = await prisma.productWatchlistItem.findMany({
    where: { shop },
    orderBy: [{ addedAt: "asc" }],
  });
  const productGids = items.map((item) => item.productGid).filter(Boolean);
  const snapshots = productGids.length
    ? await prisma.productRiskSnapshot.findMany({
      where: { shop, productGid: { in: productGids } },
    })
    : [];
  const snapshotByProductGid = new Map(snapshots.map((snapshot) => [snapshot.productGid, snapshot]));
  const rows = items.map((item) => formatWatchlistRow(item, snapshotByProductGid.get(item.productGid)));
  const watchedCount = rows.length;
  const firstWatchedProductGid = rows[0]?.productGid || "";
  const [activities, trendHistory, activityStats] = await Promise.all([
    getWatchActivityRowsForShop(shop, { take: 5 }),
    firstWatchedProductGid ? getProductScoreHistoryForShop(shop, firstWatchedProductGid, { take: 40 }) : [],
    getWatchActivityStatsForShop(shop),
  ]);

  return {
    maxProducts: WATCHLIST_MAX_PRODUCTS,
    watchedCount,
    slotsAvailable: Math.max(0, WATCHLIST_MAX_PRODUCTS - watchedCount),
    rows,
    activities,
    trend: buildWatchlistTrend(rows[0], trendHistory),
    mock: getWatchlistOverviewSections({ rows, activities, activityStats }),
  };
}

export async function addWatchedProductForShop(shop, product = {}) {
  const productGid = String(product.productGid || product.id || "").trim();
  if (!productGid) {
    return { status: "validation_error", message: "Select a Shopify product to add to the watchlist." };
  }

  const existing = await prisma.productWatchlistItem.findUnique({
    where: { shop_productGid: { shop, productGid } },
  });
  if (existing) {
    return {
      status: "success",
      message: `${existing.productTitle} is already on the watchlist.`,
      action: { id: "add-watched-product" },
      suppressBanner: true,
    };
  }

  const watchedCount = await prisma.productWatchlistItem.count({ where: { shop } });
  if (watchedCount >= WATCHLIST_MAX_PRODUCTS) {
    return {
      status: "validation_error",
      message: `Watchlist is full. Remove a watched product before adding another one.`,
    };
  }

  const item = await prisma.productWatchlistItem.create({
    data: {
      shop,
      productGid,
      productTitle: String(product.title || "Shopify product").trim() || "Shopify product",
      handle: optionalString(product.handle),
      sku: optionalString(product.sku),
      status: "Watching",
      imageUrl: optionalString(product.imageUrl),
      imageAlt: optionalString(product.imageAlt),
    },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "product_added",
    title: "Product added to watchlist",
    detail: item.productTitle,
    productGid: item.productGid,
    productTitle: item.productTitle,
    watchlistItemId: item.id,
    metadata: { handle: item.handle, sku: item.sku },
  });

  return {
    status: "success",
    message: `${item.productTitle} added to the watchlist.`,
    action: { id: "add-watched-product", productGid: item.productGid },
    watchedCount: watchedCount + 1,
  };
}

export async function pauseWatchedProductForShop(shop, productGid) {
  const item = await findWatchedProduct(shop, productGid);
  if (!item) return { status: "validation_error", message: "Watched product was not found." };
  if (item.status === "Paused") {
    return { status: "success", message: `${item.productTitle} is already paused.`, suppressBanner: true };
  }

  const updated = await prisma.productWatchlistItem.update({
    where: { shop_productGid: { shop, productGid: item.productGid } },
    data: { status: "Paused" },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "product_paused",
    title: "Product paused",
    detail: updated.productTitle,
    productGid: updated.productGid,
    productTitle: updated.productTitle,
    watchlistItemId: updated.id,
  });

  return { status: "success", message: `${updated.productTitle} paused on the watchlist.`, action: { id: "pause-watched-product" }, suppressBanner: true };
}

export async function resumeWatchedProductForShop(shop, productGid) {
  const item = await findWatchedProduct(shop, productGid);
  if (!item) return { status: "validation_error", message: "Watched product was not found." };
  if (item.status !== "Paused") {
    return { status: "success", message: `${item.productTitle} is already being watched.`, suppressBanner: true };
  }

  const updated = await prisma.productWatchlistItem.update({
    where: { shop_productGid: { shop, productGid: item.productGid } },
    data: { status: "Watching" },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "product_resumed",
    title: "Product resumed",
    detail: updated.productTitle,
    productGid: updated.productGid,
    productTitle: updated.productTitle,
    watchlistItemId: updated.id,
  });

  return { status: "success", message: `${updated.productTitle} resumed on the watchlist.`, action: { id: "resume-watched-product" }, suppressBanner: true };
}

export async function removeWatchedProductForShop(shop, productGid) {
  const item = await findWatchedProduct(shop, productGid);
  if (!item) return { status: "validation_error", message: "Watched product was not found." };

  await prisma.productWatchlistItem.delete({
    where: { shop_productGid: { shop, productGid: item.productGid } },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "product_removed",
    title: "Product removed from watchlist",
    detail: item.productTitle,
    productGid: item.productGid,
    productTitle: item.productTitle,
    watchlistItemId: item.id,
  });

  return { status: "success", message: `${item.productTitle} removed from the watchlist.`, action: { id: "remove-watched-product" }, suppressBanner: true };
}

export async function getWatchlistActivityForShop(shop, { take = 100 } = {}) {
  const [watchlist, activities] = await Promise.all([
    getWatchlistForShop(shop),
    getWatchActivityRowsForShop(shop, { take }),
  ]);
  return {
    ...watchlist,
    activities,
    groupedActivities: groupActivitiesByDay(activities),
  };
}

export async function recordWatchActivityForShop(shop, activity = {}) {
  if (!shop || !activity.eventType || !activity.title) return null;
  return prisma.productWatchActivity.create({
    data: {
      shop,
      productGid: optionalString(activity.productGid),
      productTitle: optionalString(activity.productTitle),
      watchlistItemId: optionalString(activity.watchlistItemId),
      eventType: activity.eventType,
      title: activity.title,
      detail: optionalString(activity.detail),
      metadata: activity.metadata || undefined,
      createdAt: activity.createdAt || new Date(),
    },
  });
}

export async function recordWatchlistScanActivities(shop, snapshots = [], { source = "quickscan" } = {}) {
  const productGids = Array.from(new Set(snapshots.map((snapshot) => snapshot?.productGid).filter(Boolean)));
  if (!shop || !productGids.length) return { count: 0 };
  const watchedItems = await prisma.productWatchlistItem.findMany({
    where: { shop, productGid: { in: productGids }, status: { not: "Paused" } },
  });
  const itemByProductGid = new Map(watchedItems.map((item) => [item.productGid, item]));
  const rows = snapshots
    .filter((snapshot) => itemByProductGid.has(snapshot.productGid))
    .map((snapshot) => {
      const item = itemByProductGid.get(snapshot.productGid);
      const riskScore = Number(snapshot.riskScore || 0);
      const riskLabel = getRiskLabelForScore(riskScore);
      return {
        shop,
        productGid: snapshot.productGid,
        productTitle: snapshot.productTitle || item.productTitle,
        watchlistItemId: item.id,
        eventType: source === "full-diagnosis" ? "diagnosis_completed" : "watch_scan_completed",
        title: source === "full-diagnosis" ? "Product diagnosis completed" : "Watch scan updated product risk",
        detail: `${riskLabel} risk (${riskScore}/100) · ${snapshot.primaryIssue || "No primary issue"}`,
        metadata: {
          source,
          riskScore,
          riskLabel,
          confidence: snapshot.confidence,
          impactScore: snapshot.impactScore,
          primaryIssue: snapshot.primaryIssue,
        },
      };
    });
  if (!rows.length) return { count: 0 };
  return prisma.productWatchActivity.createMany({ data: rows });
}

async function findWatchedProduct(shop, productGid) {
  const normalizedProductGid = String(productGid || "").trim();
  if (!shop || !normalizedProductGid) return null;
  return prisma.productWatchlistItem.findUnique({
    where: { shop_productGid: { shop, productGid: normalizedProductGid } },
  });
}

function formatWatchlistRow(item, snapshot) {
  const riskScore = snapshot ? Number(snapshot.riskScore || 0) : null;
  const metrics = snapshot?.metrics || {};
  const riskTone = snapshot ? getRiskToneForScore(riskScore) : "subdued";
  const riskLabel = snapshot ? getRiskLabelForScore(riskScore) : "Pending";
  const status = item.status || "Watching";
  const hasSnapshot = Boolean(snapshot);
  const updatedAt = snapshot?.updatedAt || item.updatedAt || item.addedAt;

  return {
    id: item.id,
    productGid: item.productGid,
    title: item.productTitle,
    handle: item.handle || "",
    sku: item.sku || metrics.sku || "",
    status,
    statusTone: status === "Paused" ? "subdued" : "success",
    imageUrl: item.imageUrl || null,
    imageAlt: item.imageAlt || item.productTitle,
    href: item.handle ? `/app/products/${item.handle}` : `/app/products/${encodeURIComponent(item.productGid)}`,
    riskScore,
    riskLabel,
    riskTone,
    latestChange: hasSnapshot ? "Watch signal captured" : "Awaiting first scan",
    latestChangeDetail: hasSnapshot ? snapshot.primaryIssue || "Product quality signal detected" : "This product will be scanned on the next watch run.",
    latestChangeTone: hasSnapshot ? (riskTone === "critical" ? "red" : riskTone === "warning" ? "orange" : "green") : "slate",
    lastIssue: hasSnapshot ? `Updated ${formatWatchDate(updatedAt)}` : "Not scanned yet",
    lastIssueDetail: hasSnapshot ? formatWatchTimestamp(updatedAt) : "Waiting for automatic watch cadence",
    addedAt: formatWatchDate(item.addedAt),
  };
}

function getWatchlistOverviewSections({ rows = [], activities = [], activityStats = {} } = {}) {
  const latestScanActivity = activityStats.latestScan || activities.find((activity) => ["watch_scan_completed", "diagnosis_completed"].includes(activity.eventType));
  const newIssuesThisWeek = Number(activityStats.newIssuesThisWeek || 0);
  const activeRows = rows.filter((row) => row.status !== "Paused");

  return {
    scanCadence: "Every 3 days",
    scanCadenceDetail: "Automatic rescans",
    lastRun: latestScanActivity?.time || "Not run yet",
    lastRunDetail: activeRows.length ? `${activeRows.length} active product${activeRows.length === 1 ? "" : "s"} watched` : "No active watches",
    nextRun: "In 2d 18h",
    nextRunDetail: "May 21, 9:00 AM",
    newIssues: `${newIssuesThisWeek} this week`,
    newIssuesDetail: newIssuesThisWeek ? "From stored watch activity" : "No new watched issues",
    alertStatus: "Email alerts on",
    alertStatusDetail: "2 recipients",
  };
}

async function getWatchActivityRowsForShop(shop, { take = 5 } = {}) {
  const activities = await prisma.productWatchActivity.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take,
  });
  return activities.map(formatWatchActivity);
}

async function getWatchActivityStatsForShop(shop) {
  const weekAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  const [latestScan, recentRiskActivities] = await Promise.all([
    prisma.productWatchActivity.findFirst({
      where: { shop, eventType: { in: ["watch_scan_completed", "diagnosis_completed"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.productWatchActivity.findMany({
      where: {
        shop,
        eventType: { in: ["watch_scan_completed", "diagnosis_completed"] },
        createdAt: { gte: weekAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  return {
    latestScan: latestScan ? formatWatchActivity(latestScan) : null,
    newIssuesThisWeek: recentRiskActivities.filter((activity) => Number(activity.metadata?.riskScore || 0) >= 55).length,
  };
}

function formatWatchActivity(activity) {
  const metadata = activity.metadata || {};
  return {
    id: activity.id,
    eventType: activity.eventType,
    productGid: activity.productGid || "",
    productTitle: activity.productTitle || "",
    title: activity.title,
    detail: activity.detail || activity.productTitle || "",
    time: formatWatchDate(activity.createdAt),
    timestamp: formatWatchTimestamp(activity.createdAt),
    createdAt: activity.createdAt?.toISOString?.() || activity.createdAt,
    icon: getActivityIcon(activity.eventType),
    tone: getActivityTone(activity.eventType, metadata),
    riskScore: metadata.riskScore ?? null,
    riskLabel: metadata.riskLabel || "",
    metadata,
  };
}

function buildWatchlistTrend(product, history = []) {
  if (!product) {
    return {
      productTitle: "No watched product",
      riskLabel: "No data",
      riskScore: null,
      points: [],
      values: [],
      calloutTitle: "Add a product to start watch trend tracking",
      calloutDetail: "Product risk history is stored every time ProductPulse updates a watched product.",
    };
  }

  const values = history
    .map((row) => ({
      riskScore: Number(row.riskScore || 0),
      recordedAt: row.recordedAt?.toISOString?.() || row.recordedAt,
      source: row.source,
      primaryIssue: row.primaryIssue || "",
    }))
    .filter((row) => Number.isFinite(row.riskScore));
  if (!values.length && Number.isFinite(Number(product.riskScore))) {
    values.push({
      riskScore: Number(product.riskScore),
      recordedAt: new Date().toISOString(),
      source: "current-snapshot",
      primaryIssue: product.latestChangeDetail || "",
    });
  }

  const latest = values[values.length - 1] || null;
  const previous = values.length > 1 ? values[values.length - 2] : null;
  const score = latest ? latest.riskScore : product.riskScore;
  const direction = latest && previous ? latest.riskScore - previous.riskScore : 0;
  const directionWord = direction > 0 ? "increased" : direction < 0 ? "decreased" : "stayed stable";

  return {
    productGid: product.productGid,
    productTitle: product.title,
    href: product.href,
    riskScore: score,
    riskLabel: Number.isFinite(Number(score)) ? getRiskLabelForScore(score) : "Pending",
    values,
    points: normalizeTrendPoints(values.map((row) => row.riskScore)),
    calloutTitle: previous
      ? `Latest risk ${directionWord} from ${previous.riskScore} to ${latest.riskScore}`
      : "Waiting for another scan to show movement",
    calloutDetail: latest?.primaryIssue || product.latestChangeDetail || "Product risk history will appear as rescans run.",
  };
}

function normalizeTrendPoints(values = []) {
  if (!values.length) return [];
  if (values.length === 1) return [{ x: 0, y: 100 - values[0] }];
  return values.map((value, index) => ({
    x: (index / (values.length - 1)) * 100,
    y: 100 - Math.max(0, Math.min(100, Number(value || 0))),
  }));
}

function groupActivitiesByDay(activities = []) {
  return activities.reduce((groups, activity) => {
    const day = formatActivityDay(activity.createdAt);
    const existing = groups.find((group) => group.day === day);
    if (existing) existing.items.push(activity);
    else groups.push({ day, items: [activity] });
    return groups;
  }, []);
}

function formatActivityDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent activity";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function getActivityIcon(eventType) {
  if (eventType === "product_added") return "plus";
  if (eventType === "product_removed") return "x";
  if (eventType === "product_paused") return "pause";
  if (eventType === "product_resumed") return "play";
  if (eventType === "diagnosis_completed") return "wand";
  if (eventType === "watch_scan_completed") return "refresh";
  if (eventType === "settings_changed") return "settings";
  if (eventType === "alert_sent") return "email";
  return "info";
}

function getActivityTone(eventType, metadata = {}) {
  if (eventType === "product_removed") return "slate";
  if (eventType === "product_paused") return "purple";
  if (eventType === "product_resumed") return "green";
  if (eventType === "product_added") return "blue";
  if (eventType === "diagnosis_completed") return "purple";
  if (eventType === "watch_scan_completed") {
    const riskScore = Number(metadata.riskScore || 0);
    if (riskScore >= 75) return "red";
    if (riskScore >= 55) return "orange";
    return "green";
  }
  return "blue";
}

function optionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function formatWatchDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatWatchTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
