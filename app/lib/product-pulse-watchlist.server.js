import prisma from "../db.server";
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

  return {
    maxProducts: WATCHLIST_MAX_PRODUCTS,
    watchedCount,
    slotsAvailable: Math.max(0, WATCHLIST_MAX_PRODUCTS - watchedCount),
    rows,
    mock: getWatchlistMockSections(),
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

  return {
    status: "success",
    message: `${item.productTitle} added to the watchlist.`,
    action: { id: "add-watched-product", productGid: item.productGid },
    watchedCount: watchedCount + 1,
  };
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

function getWatchlistMockSections() {
  return {
    scanCadence: "Every 3 days",
    scanCadenceDetail: "Automatic rescans",
    lastRun: "6h ago",
    lastRunDetail: "All active products scanned",
    nextRun: "In 2d 18h",
    nextRunDetail: "May 21, 9:00 AM",
    newIssues: "2 this week",
    newIssuesDetail: "2 vs last week",
    alertStatus: "Email alerts on",
    alertStatusDetail: "2 recipients",
  };
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
