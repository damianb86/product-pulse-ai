/* eslint-env node */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "../../app/db.server";
import {
  analyzeCsvReviewUpload,
  getNormalizedCsvReviewsForShop,
  parseCsvText,
  processCsvReviewUpload,
  validateCsvReviewColumnMapping,
} from "../../app/lib/product-pulse-csv.server";

describe("ProductPulse CSV review import", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "product-pulse-csv-"));
    process.env.PRODUCT_PULSE_CSV_STORAGE_DIR = tempDir;
    process.env.OPENAI_API_KEY = "openai-test-key";
    process.env.OPENAI_PRO_MODEL = "gpt-5.4-mini";
    process.env.OPENAI_PREMIUM_MODEL = "gpt-5.4";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.PRODUCT_PULSE_CSV_STORAGE_DIR;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_PRO_MODEL;
    delete process.env.OPENAI_PREMIUM_MODEL;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("parses quoted CSV rows with multiline review text", () => {
    const parsed = parseCsvText("Handle,Rating,Review Body\nlinen-shirt,5,\"Great fit,\nsoft fabric\"\n");
    expect(parsed.headers).toEqual(["Handle", "Rating", "Review Body"]);
    expect(parsed.rows[0].values["Review Body"]).toBe("Great fit,\nsoft fabric");
  });

  it("rejects mappings without a product relation", () => {
    const validation = validateCsvReviewColumnMapping({
      rating: "Rating",
      review_body: "Review Body",
      confidence: 0.9,
    }, ["Rating", "Review Body"]);

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain("product handle o Shopify product ID");
  });

  it("uses OpenAI mini with headers only, then saves one normalized CSV per shop", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe("gpt-5.4-mini");
      expect(body.input).toContain("Product Handle");
      expect(body.input).toContain("Review Body");
      expect(body.input).not.toContain("Great product");

      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          product_handle: "Product Handle",
          shopify_product_id: null,
          rating: "Stars",
          review_body: "Review Body",
          review_title: "Title",
          review_date: "Created At",
          reviewer_name: "Reviewer",
          review_status: "Status",
          source_product_id: "Internal Product ID",
          confidence: 0.94,
          notes: "Headers clearly identify review fields.",
        }),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const csv = [
      "Product Handle,Internal Product ID,Stars,Title,Review Body,Created At,Reviewer,Status",
      "linen-shirt,abc-1,5,Great,Great product,2026-05-01,Ana,published",
      "trail-vest,abc-2,4,Good,\"Comfortable, light vest\",2026-05-02,Leo,published",
      ",abc-3,5,Missing product,No product relation,2026-05-03,Sam,published",
    ].join("\n");

    const result = await processCsvReviewUpload({
      shop: "Test-Shop.myshopify.com",
      file: new File([csv], "-review-export%2Fzuam-dev-all-published-reviews-in-judgeme-format-2026-05-14-1778771736.csv", { type: "text/csv" }),
    });

    expect(result.fileName).toBe("zuam-dev-all-published-reviews-in-judgeme-format-2026-05-14-1778771736.csv");
    expect(result.displayFileName).toBe("CSV import");
    expect(result.normalizedRowCount).toBe(2);
    expect(result.rejectedRows).toHaveLength(1);
    expect(result.storageKey).toBe("test-shop.myshopify.com");
    expect(result.normalizedFileName).toMatch(/^csv-review-import-\d{8}-\d{6}-[a-f0-9]{12}\.normalized\.csv$/);
    expect(path.basename(result.normalizedFilePath)).toBe(result.normalizedFileName);
    expect(result.normalizedFileName).not.toBe("reviews.csv");
    expect(result.normalizedFileName).not.toBe("reviews.normalized.csv");

    const normalized = await readFile(result.normalizedFilePath, "utf8");
    expect(normalized).toContain("product_handle,shopify_product_id,rating");
    expect(normalized).toContain("linen-shirt,,5,Great,Great product");
    expect(normalized).toContain("\"Comfortable, light vest\"");
  });

  it("falls back to a Shopify product ID column when sampled handles do not exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        product_handle: "Handle",
        shopify_product_id: null,
        rating: "Stars",
        review_body: "Review Body",
        review_title: "Title",
        review_date: "Created At",
        reviewer_name: "Reviewer",
        review_status: "Status",
        source_product_id: "External Product ID",
        confidence: 0.94,
        notes: "Headers identify review fields.",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const admin = {
      graphql: vi.fn(async (query, options) => {
        if (String(query).includes("ProductPulseCsvProductByHandle")) {
          return new Response(JSON.stringify({ data: { products: { nodes: [] } } }), { status: 200 });
        }
        if (options?.variables?.id === "gid://shopify/Product/10002") {
          return new Response(JSON.stringify({
            data: { product: { id: "gid://shopify/Product/10002", handle: "valid-desk", title: "Valid Desk" } },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { product: null } }), { status: 200 });
      }),
    };

    const csv = [
      "Handle,External Product ID,Stars,Title,Review Body,Created At,Reviewer,Status",
      "not-a-real-handle,10001,5,Great,First review,2026-05-01,Ana,published",
      "still-not-real,10002,4,Good,Second review,2026-05-02,Leo,published",
    ].join("\n");

    const result = await analyzeCsvReviewUpload({
      shop: "Test-Shop.myshopify.com",
      admin,
      file: new File([csv], "reviews.csv", { type: "text/csv" }),
    });

    expect(result.mapping.product_handle).toBeNull();
    expect(result.mapping.shopify_product_id).toBe("External Product ID");
    expect(result.productRelation).toMatchObject({
      status: "confirmed",
      field: "shopify_product_id",
      header: "External Product ID",
      sampleValue: "gid://shopify/Product/10002",
    });
    expect(result.previewRows[0]).toMatchObject({
      shopifyProductId: "10001",
      rating: "5",
      reviewBody: "First review",
    });
  });

  it("does not load normalized CSV rows when the CSV source is disabled", async () => {
    vi.spyOn(prisma.productPulseSource, "findUnique").mockResolvedValue({
      connected: true,
      active: false,
      config: { normalizedFilePath: path.join(tempDir, "disabled.normalized.csv") },
    });

    await expect(getNormalizedCsvReviewsForShop("Test-Shop.myshopify.com")).resolves.toEqual([]);
  });

  it("keeps normalized CSV review ids stable when source rows move", async () => {
    const filePath = path.join(tempDir, "stable.normalized.csv");
    vi.spyOn(prisma.productPulseSource, "findUnique").mockResolvedValue({
      connected: true,
      active: true,
      config: { normalizedFilePath: filePath },
    });
    const header = "source_row,product_handle,shopify_product_id,rating,review_title,review_body,review_date,reviewer_name,review_status,source_product_id";

    await writeFile(filePath, [
      header,
      "2,gen-voltnest,,2,MIN line,The fill mark disappears,2026-05-29,Ana,published,voltnest-v2",
      "3,other-product,,5,Other,Other review,2026-05-29,Leo,published,other-v1",
    ].join("\n"), "utf8");
    const first = await getNormalizedCsvReviewsForShop("Test-Shop.myshopify.com");

    await writeFile(filePath, [
      header,
      "2,other-product,,5,Other,Other review,2026-05-29,Leo,published,other-v1",
      "3,gen-voltnest,,2,MIN line,The fill mark disappears,2026-05-29,Ana,published,voltnest-v2",
    ].join("\n"), "utf8");
    const second = await getNormalizedCsvReviewsForShop("Test-Shop.myshopify.com");

    const firstReview = first.find((row) => row.productHandle === "gen-voltnest");
    const secondReview = second.find((row) => row.productHandle === "gen-voltnest");
    expect(firstReview.sourceRow).toBe(2);
    expect(secondReview.sourceRow).toBe(3);
    expect(secondReview.id).toBe(firstReview.id);
  });
});
