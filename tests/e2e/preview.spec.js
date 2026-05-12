import { expect, test } from "@playwright/test";

test("opens ProductPulse preview and navigates core screens", async ({ page }) => {
  await page.goto("/preview");

  await expect(page.getByRole("heading", { name: "ProductPulse AI" }).first()).toBeVisible();
  await expect(page.getByText("Catalog Signal Scan included").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect sources", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources & Billing", exact: true })).toBeVisible();
});

test("supports narrow viewport without hiding primary content", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/preview");

  await expect(page.getByText("Find the products creating returns").first()).toBeVisible();
  await expect(page.getByText("Core Linen Trouser").first()).toBeVisible();
});
