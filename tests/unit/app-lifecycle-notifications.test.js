import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  productPulseSourceFindUnique: vi.fn(),
  productPulseSourceUpsert: vi.fn(),
  sendProductPulseEmail: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    productPulseSource: {
      findUnique: mocks.productPulseSourceFindUnique,
      upsert: mocks.productPulseSourceUpsert,
    },
  },
}));

vi.mock("../../app/email.server", () => ({
  sendProductPulseEmail: mocks.sendProductPulseEmail,
}));

const {
  APP_LIFECYCLE_SOURCE_KEY,
  sendAppInstalledNotification,
  sendAppUninstalledNotification,
} = await import("../../app/lib/app-lifecycle-notifications.server");

const now = new Date("2026-06-14T15:00:00.000Z");
const lifecycleEnv = {
  APP_LIFECYCLE_EMAIL: "owner@internal.example",
  CONTACT_EMAIL: "support@internal.example",
};

const installSession = {
  id: "offline_demo.myshopify.com",
  shop: "demo.myshopify.com",
  scope: "read_products,write_products",
  accessToken: "shpat_secret",
  userId: 123,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  accountOwner: true,
  collaborator: false,
  emailVerified: true,
};

describe("app lifecycle notifications", () => {
  beforeEach(() => {
    mocks.productPulseSourceFindUnique.mockReset().mockResolvedValue(null);
    mocks.productPulseSourceUpsert.mockReset().mockImplementation(({ create, update }) => Promise.resolve({
      id: "source-1",
      ...(create || {}),
      ...(update || {}),
    }));
    mocks.sendProductPulseEmail.mockReset().mockResolvedValue({});
  });

  it("emails and stores a new install notification without leaking access tokens", async () => {
    const result = await sendAppInstalledNotification({
      session: installSession,
      admin: createInstallAdminMock(),
      now,
      env: lifecycleEnv,
    });

    expect(result).toEqual({
      status: "sent",
      eventType: "installed",
      shop: "demo.myshopify.com",
    });
    expect(mocks.sendProductPulseEmail).toHaveBeenCalledWith(expect.objectContaining({
      type: "app_install",
      subject: "New app install: demo.myshopify.com",
      shop: "demo.myshopify.com",
      to: "owner@internal.example,support@internal.example",
      requiredRecipientEnv: "APP_LIFECYCLE_EMAIL and/or CONTACT_EMAIL",
      message: expect.stringContaining("Shop name: Demo Store"),
    }));
    const emailPayload = mocks.sendProductPulseEmail.mock.calls[0][0];
    expect(emailPayload.message).toContain("Granted scopes: read_products,write_products");
    expect(emailPayload.message).toContain("Installer user: Ada Lovelace");
    expect(JSON.stringify(emailPayload)).not.toContain("shpat_secret");

    expect(mocks.productPulseSourceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        shop_sourceKey: {
          shop: "demo.myshopify.com",
          sourceKey: APP_LIFECYCLE_SOURCE_KEY,
        },
      },
      create: expect.objectContaining({
        shop: "demo.myshopify.com",
        category: "app_lifecycle",
        active: true,
        health: "installed",
        config: expect.objectContaining({
          status: "installed",
          installedAt: now.toISOString(),
          installNotificationSentAt: now.toISOString(),
          installCount: 1,
          shop: expect.objectContaining({
            name: "Demo Store",
            planDisplayName: "Basic",
          }),
          session: expect.objectContaining({
            scope: "read_products,write_products",
            email: "ada@example.com",
          }),
        }),
      }),
    }));
    const upsertPayload = mocks.productPulseSourceUpsert.mock.calls[0][0];
    expect(JSON.stringify(upsertPayload.create.config)).not.toContain("shpat_secret");
  });

  it("skips a repeated active install notification but records the latest auth time", async () => {
    mocks.productPulseSourceFindUnique.mockResolvedValue({
      config: {
        status: "installed",
        installedAt: "2026-06-01T10:00:00.000Z",
        installNotificationSentAt: "2026-06-01T10:00:00.000Z",
        installCount: 1,
      },
    });

    const result = await sendAppInstalledNotification({
      session: installSession,
      admin: createInstallAdminMock(),
      now,
      env: lifecycleEnv,
    });

    expect(result).toEqual({ status: "skipped", reason: "already_installed" });
    expect(mocks.sendProductPulseEmail).not.toHaveBeenCalled();
    expect(mocks.productPulseSourceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        active: true,
        health: "installed",
        config: expect.objectContaining({
          status: "installed",
          installNotificationSentAt: "2026-06-01T10:00:00.000Z",
          lastAuthenticatedAt: now.toISOString(),
        }),
      }),
    }));
  });

  it("emails and stores an uninstall notification before sessions are removed", async () => {
    mocks.productPulseSourceFindUnique.mockResolvedValue({
      config: {
        status: "installed",
        installedAt: "2026-06-01T10:00:00.000Z",
        installNotificationSentAt: "2026-06-01T10:00:00.000Z",
      },
    });

    const result = await sendAppUninstalledNotification({
      shop: "demo.myshopify.com",
      payload: createUninstallPayload(),
      session: installSession,
      topic: "app/uninstalled",
      webhookId: "webhook-1",
      now,
      env: lifecycleEnv,
    });

    expect(result).toEqual({
      status: "sent",
      eventType: "uninstalled",
      shop: "demo.myshopify.com",
    });
    expect(mocks.sendProductPulseEmail).toHaveBeenCalledWith(expect.objectContaining({
      type: "app_uninstall",
      subject: "App uninstalled: demo.myshopify.com",
      shop: "demo.myshopify.com",
      to: "owner@internal.example,support@internal.example",
      message: expect.stringContaining("Shop owner: John Smith"),
    }));
    const emailPayload = mocks.sendProductPulseEmail.mock.calls[0][0];
    expect(emailPayload.message).toContain("Webhook id: webhook-1");
    expect(emailPayload.message).toContain("Plan: Shopify Plus");
    expect(JSON.stringify(emailPayload)).not.toContain("shpat_secret");

    expect(mocks.productPulseSourceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        active: false,
        health: "uninstalled",
        config: expect.objectContaining({
          status: "uninstalled",
          uninstalledAt: now.toISOString(),
          uninstallNotificationSentAt: now.toISOString(),
          uninstallWebhookId: "webhook-1",
          uninstallPayload: expect.objectContaining({
            name: "Super Toys",
            planDisplayName: "Shopify Plus",
            shopOwner: "John Smith",
          }),
          session: expect.objectContaining({
            id: "offline_demo.myshopify.com",
            email: "ada@example.com",
          }),
        }),
      }),
    }));
  });

  it("skips duplicate uninstall webhook retries after a notification was sent", async () => {
    mocks.productPulseSourceFindUnique.mockResolvedValue({
      config: {
        status: "uninstalled",
        uninstalledAt: "2026-06-10T10:00:00.000Z",
        uninstallNotificationSentAt: "2026-06-10T10:00:00.000Z",
      },
    });

    const result = await sendAppUninstalledNotification({
      shop: "demo.myshopify.com",
      payload: createUninstallPayload(),
      now,
      env: lifecycleEnv,
    });

    expect(result).toEqual({ status: "skipped", reason: "already_uninstalled" });
    expect(mocks.sendProductPulseEmail).not.toHaveBeenCalled();
    expect(mocks.productPulseSourceUpsert).not.toHaveBeenCalled();
  });
});

function createInstallAdminMock() {
  return {
    graphql: vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          shop: {
            id: "gid://shopify/Shop/548380009",
            name: "Demo Store",
            email: "owner@example.com",
            contactEmail: "ops@example.com",
            myshopifyDomain: "demo.myshopify.com",
            url: "https://demo.example.com",
            currencyCode: "USD",
            ianaTimezone: "America/New_York",
            primaryDomain: {
              host: "demo.example.com",
              url: "https://demo.example.com",
            },
            plan: {
              displayName: "Basic",
              partnerDevelopment: false,
              shopifyPlus: false,
            },
            billingAddress: {
              city: "New York",
              province: "NY",
              country: "United States",
              countryCodeV2: "US",
            },
          },
        },
      }),
    }),
  };
}

function createUninstallPayload() {
  return {
    id: 548380009,
    name: "Super Toys",
    email: "super@supertoys.com",
    customer_email: "support@supertoys.com",
    shop_owner: "John Smith",
    domain: "supertoys.example",
    myshopify_domain: "demo.myshopify.com",
    plan_display_name: "Shopify Plus",
    plan_name: "enterprise",
    currency: "USD",
    timezone: "(GMT-05:00) Eastern Time (US & Canada)",
    country_name: "United States",
    province: "Tennessee",
    city: "Houston",
    has_storefront: true,
  };
}
