import { expect, test } from "@playwright/test";

test("opens ProductPulse preview and navigates core screens", async ({ page }) => {
  await page.goto("/preview");

  await expect(page.getByRole("heading", { name: "Dashboard" }).first()).toBeVisible();
  await expect(page.getByText("Products needing attention").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect your sources", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
});

test("supports narrow viewport without hiding primary content", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/preview");

  await expect(page.getByText("Product quality signals from reviews").first()).toBeVisible();
  await expect(page.getByText("Linen Shirt").first()).toBeVisible();
});
