import db from "../db.server";
import { sendProductPulseEmail } from "../email.server";

export const APP_LIFECYCLE_SOURCE_KEY = "__productpulse_app_lifecycle";

export async function sendAppInstalledNotification({ session, admin, now = new Date(), env = process.env } = {}) {
  const shop = String(session?.shop || "").trim();
  if (!shop) return { status: "skipped", reason: "missing_shop" };

  try {
    const current = await getLifecycleRecord(shop);
    const currentConfig = getRecordConfig(current);
    if (currentConfig.status === "installed" && currentConfig.installNotificationSentAt) {
      await upsertLifecycleConfig(shop, {
        ...currentConfig,
        lastAuthenticatedAt: now.toISOString(),
      });
      return { status: "skipped", reason: "already_installed" };
    }

    const shopDetails = await fetchInstallShopDetails(admin).catch((error) => ({
      fetchError: error instanceof Error ? error.message : String(error),
    }));
    const eventType = currentConfig.uninstalledAt ? "reinstalled" : "installed";
    const nextConfig = {
      ...currentConfig,
      status: "installed",
      installedAt: currentConfig.installedAt || now.toISOString(),
      reinstalledAt: eventType === "reinstalled" ? now.toISOString() : currentConfig.reinstalledAt || null,
      lastAuthenticatedAt: now.toISOString(),
      installCount: Number(currentConfig.installCount || 0) + 1,
      uninstalledAt: null,
      shop: normalizeShopDetails(shopDetails),
      session: normalizeInstallSession(session),
    };

    const emailResult = await sendLifecycleEmail({
      env,
      type: "app_install",
      subject: `${eventType === "reinstalled" ? "App reinstalled" : "New app install"}: ${shop}`,
      shop,
      title: eventType === "reinstalled" ? "ProductPulse AI reinstalled" : "ProductPulse AI installed",
      rows: buildInstallRows({ shop, session, shopDetails, eventType, now }),
    });

    await upsertLifecycleConfig(shop, {
      ...nextConfig,
      installNotificationSentAt: emailResult.sent ? now.toISOString() : currentConfig.installNotificationSentAt || null,
      installNotificationError: emailResult.sent ? null : emailResult.error || emailResult.reason || "email_not_sent",
    });

    return emailResult.sent
      ? { status: "sent", eventType, shop }
      : { status: "email_error", eventType, shop, error: emailResult.error || emailResult.reason };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[app-lifecycle.install]", message);
    return { status: "error", eventType: "installed", shop, error: message };
  }
}

export async function sendAppUninstalledNotification({ shop, payload = {}, session = null, topic = "app/uninstalled", webhookId = "", now = new Date(), env = process.env } = {}) {
  const normalizedShop = String(shop || payload?.myshopify_domain || payload?.domain || session?.shop || "").trim();
  if (!normalizedShop) return { status: "skipped", reason: "missing_shop" };

  try {
    const current = await getLifecycleRecord(normalizedShop);
    const currentConfig = getRecordConfig(current);
    if (currentConfig.status === "uninstalled" && currentConfig.uninstallNotificationSentAt) {
      return { status: "skipped", reason: "already_uninstalled" };
    }

    const emailResult = await sendLifecycleEmail({
      env,
      type: "app_uninstall",
      subject: `App uninstalled: ${normalizedShop}`,
      shop: normalizedShop,
      title: "ProductPulse AI uninstalled",
      rows: buildUninstallRows({ shop: normalizedShop, payload, session, topic, webhookId, now }),
    });

    await upsertLifecycleConfig(normalizedShop, {
      ...currentConfig,
      status: "uninstalled",
      uninstalledAt: now.toISOString(),
      uninstallNotificationSentAt: emailResult.sent ? now.toISOString() : currentConfig.uninstallNotificationSentAt || null,
      uninstallNotificationError: emailResult.sent ? null : emailResult.error || emailResult.reason || "email_not_sent",
      uninstallWebhookId: webhookId || currentConfig.uninstallWebhookId || null,
      uninstallPayload: summarizeUninstallPayload(payload),
      session: normalizeUninstallSession(session),
    });

    return emailResult.sent
      ? { status: "sent", eventType: "uninstalled", shop: normalizedShop }
      : { status: "email_error", eventType: "uninstalled", shop: normalizedShop, error: emailResult.error || emailResult.reason };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[app-lifecycle.uninstall]", message);
    return { status: "error", eventType: "uninstalled", shop: normalizedShop, error: message };
  }
}

async function sendLifecycleEmail({ env, type, subject, shop, title, rows }) {
  const recipients = getLifecycleEmailRecipients(env);
  const message = rows.map((row) => `${row.label}: ${row.value || "not provided"}`).join("\n");
  try {
    await sendProductPulseEmail({
      type,
      subject,
      message,
      html: buildLifecycleEmailHtml(title, rows),
      shop,
      to: recipients,
      requiredRecipientEnv: "APP_LIFECYCLE_EMAIL and/or CONTACT_EMAIL",
    });
    return { sent: true };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(`[app-lifecycle.${type}]`, messageText);
    return { sent: false, error: messageText };
  }
}

function getLifecycleEmailRecipients(env = process.env) {
  return [
    env.APP_LIFECYCLE_EMAIL,
    env.CONTACT_EMAIL,
  ].filter(Boolean).join(",");
}

async function getLifecycleRecord(shop) {
  if (!db.productPulseSource?.findUnique) return null;
  return db.productPulseSource.findUnique({
    where: {
      shop_sourceKey: {
        shop,
        sourceKey: APP_LIFECYCLE_SOURCE_KEY,
      },
    },
  });
}

async function upsertLifecycleConfig(shop, config) {
  if (!db.productPulseSource?.upsert) return null;
  return db.productPulseSource.upsert({
    where: {
      shop_sourceKey: {
        shop,
        sourceKey: APP_LIFECYCLE_SOURCE_KEY,
      },
    },
    create: {
      shop,
      sourceKey: APP_LIFECYCLE_SOURCE_KEY,
      category: "app_lifecycle",
      name: "ProductPulse App Lifecycle",
      connected: true,
      active: true,
      available: true,
      health: String(config.status || "installed"),
      coverageWeight: 0,
      config,
    },
    update: {
      connected: true,
      active: config.status !== "uninstalled",
      available: true,
      health: String(config.status || "installed"),
      config,
    },
  });
}

async function fetchInstallShopDetails(admin) {
  if (!admin?.graphql) return {};
  const response = await admin.graphql(`#graphql
    query ProductPulseLifecycleShopDetails {
      shop {
        id
        name
        email
        contactEmail
        myshopifyDomain
        url
        currencyCode
        ianaTimezone
        primaryDomain {
          host
          url
        }
        plan {
          displayName
          partnerDevelopment
          shopifyPlus
        }
        billingAddress {
          city
          province
          country
          countryCodeV2
        }
      }
    }`);
  const json = await response.json();
  const errors = json.errors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  return json.data?.shop || {};
}

function buildInstallRows({ shop, session, shopDetails = {}, eventType, now }) {
  const normalizedShop = normalizeShopDetails(shopDetails);
  const normalizedSession = normalizeInstallSession(session);
  return compactRows([
    ["Event", eventType === "reinstalled" ? "Reinstall" : "Install"],
    ["Received at", now.toISOString()],
    ["Shop domain", shop],
    ["Shop name", normalizedShop.name],
    ["Shop email", normalizedShop.email],
    ["Contact email", normalizedShop.contactEmail],
    ["MyShopify domain", normalizedShop.myshopifyDomain],
    ["Primary domain", normalizedShop.primaryDomainUrl || normalizedShop.primaryDomainHost],
    ["Store URL", normalizedShop.url],
    ["Plan", normalizedShop.planDisplayName],
    ["Shopify Plus", booleanLabel(normalizedShop.shopifyPlus)],
    ["Partner development", booleanLabel(normalizedShop.partnerDevelopment)],
    ["Currency", normalizedShop.currencyCode],
    ["Timezone", normalizedShop.ianaTimezone],
    ["Location", [normalizedShop.city, normalizedShop.province, normalizedShop.country || normalizedShop.countryCode].filter(Boolean).join(", ")],
    ["Granted scopes", normalizedSession.scope],
    ["Installer user", normalizedSession.userName],
    ["Installer email", normalizedSession.email],
    ["Account owner", booleanLabel(normalizedSession.accountOwner)],
    ["Collaborator", booleanLabel(normalizedSession.collaborator)],
    ["Session id", normalizedSession.id],
  ]);
}

function buildUninstallRows({ shop, payload = {}, session = null, topic, webhookId, now }) {
  const summary = summarizeUninstallPayload(payload);
  const normalizedSession = normalizeUninstallSession(session);
  return compactRows([
    ["Event", "Uninstall"],
    ["Received at", now.toISOString()],
    ["Topic", topic],
    ["Webhook id", webhookId],
    ["Shop domain", shop],
    ["Shop id", summary.id],
    ["Shop name", summary.name],
    ["Shop email", summary.email],
    ["Customer email", summary.customerEmail],
    ["Shop owner", summary.shopOwner],
    ["MyShopify domain", summary.myshopifyDomain],
    ["Domain", summary.domain],
    ["Plan", summary.planDisplayName || summary.planName],
    ["Currency", summary.currency],
    ["Timezone", summary.timezone || summary.ianaTimezone],
    ["Country", summary.countryName || summary.countryCode || summary.country],
    ["Province", summary.province || summary.provinceCode],
    ["City", summary.city],
    ["Has storefront", booleanLabel(summary.hasStorefront)],
    ["Session email", normalizedSession.email],
    ["Session user", normalizedSession.userName],
    ["Session id", normalizedSession.id],
  ]);
}

function normalizeShopDetails(shop = {}) {
  const primaryDomain = shop.primaryDomain || {};
  const plan = shop.plan || {};
  const billingAddress = shop.billingAddress || {};
  return {
    id: optionalString(shop.id),
    name: optionalString(shop.name),
    email: optionalString(shop.email),
    contactEmail: optionalString(shop.contactEmail),
    myshopifyDomain: optionalString(shop.myshopifyDomain),
    url: optionalString(shop.url),
    currencyCode: optionalString(shop.currencyCode),
    ianaTimezone: optionalString(shop.ianaTimezone),
    primaryDomainHost: optionalString(primaryDomain.host),
    primaryDomainUrl: optionalString(primaryDomain.url),
    planDisplayName: optionalString(plan.displayName),
    partnerDevelopment: optionalBoolean(plan.partnerDevelopment),
    shopifyPlus: optionalBoolean(plan.shopifyPlus),
    city: optionalString(billingAddress.city),
    province: optionalString(billingAddress.province),
    country: optionalString(billingAddress.country),
    countryCode: optionalString(billingAddress.countryCodeV2),
    fetchError: optionalString(shop.fetchError),
  };
}

function summarizeUninstallPayload(payload = {}) {
  return {
    id: optionalString(payload.id),
    name: optionalString(payload.name),
    email: optionalString(payload.email),
    customerEmail: optionalString(payload.customer_email),
    domain: optionalString(payload.domain),
    myshopifyDomain: optionalString(payload.myshopify_domain),
    shopOwner: optionalString(payload.shop_owner),
    planDisplayName: optionalString(payload.plan_display_name),
    planName: optionalString(payload.plan_name),
    country: optionalString(payload.country),
    countryCode: optionalString(payload.country_code),
    countryName: optionalString(payload.country_name),
    province: optionalString(payload.province),
    provinceCode: optionalString(payload.province_code),
    city: optionalString(payload.city),
    currency: optionalString(payload.currency),
    timezone: optionalString(payload.timezone),
    ianaTimezone: optionalString(payload.iana_timezone),
    hasStorefront: optionalBoolean(payload.has_storefront),
  };
}

function normalizeInstallSession(session = {}) {
  return {
    id: optionalString(session.id),
    shop: optionalString(session.shop),
    scope: optionalString(session.scope),
    userId: optionalString(session.userId),
    userName: [session.firstName, session.lastName].map(optionalString).filter(Boolean).join(" "),
    email: optionalString(session.email),
    accountOwner: optionalBoolean(session.accountOwner),
    collaborator: optionalBoolean(session.collaborator),
    emailVerified: optionalBoolean(session.emailVerified),
  };
}

function normalizeUninstallSession(session = {}) {
  return normalizeInstallSession(session || {});
}

function buildLifecycleEmailHtml(title, rows) {
  const tableRows = rows.map((row) => [
    "<tr>",
    `<th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;">${escapeHtml(row.label)}</th>`,
    `<td align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:12px;">${escapeHtml(row.value || "not provided")}</td>`,
    "</tr>",
  ].join(""));
  return [
    "<!doctype html>",
    "<html>",
    "<body style=\"margin:0;padding:20px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;\">",
    "<div style=\"max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;\">",
    `<div style="padding:18px 20px;background:#020617;color:#ffffff;"><h1 style="margin:0;font-size:18px;line-height:1.3;">${escapeHtml(title)}</h1></div>`,
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"width:100%;border-collapse:collapse;\">",
    tableRows,
    "</table>",
    "</div>",
    "</body>",
    "</html>",
  ].join("");
}

function compactRows(rows) {
  return rows
    .map(([label, value]) => ({ label, value: normalizeRowValue(value) }))
    .filter((row) => row.value);
}

function normalizeRowValue(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return booleanLabel(value);
  return String(value).trim();
}

function booleanLabel(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
}

function optionalString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function getRecordConfig(record) {
  return record?.config && typeof record.config === "object" ? record.config : {};
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const __appLifecycleNotificationsTestHooks = {
  buildInstallRows,
  buildUninstallRows,
  normalizeShopDetails,
  summarizeUninstallPayload,
};
