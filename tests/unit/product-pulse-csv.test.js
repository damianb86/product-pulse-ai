/* eslint-env node */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
      file: new File([csv], "reviews.csv", { type: "text/csv" }),
    });

    expect(result.normalizedRowCount).toBe(2);
    expect(result.rejectedRows).toHaveLength(1);
    expect(result.storageKey).toBe("test-shop.myshopify.com");
    expect(result.normalizedFilePath).toContain("reviews.normalized.csv");

    const normalized = await readFile(result.normalizedFilePath, "utf8");
    expect(normalized).toContain("product_handle,shopify_product_id,rating");
    expect(normalized).toContain("linen-shirt,,5,Great,Great product");
    expect(normalized).toContain("\"Comfortable, light vest\"");
  });
});
