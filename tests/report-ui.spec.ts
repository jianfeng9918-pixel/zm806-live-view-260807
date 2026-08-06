import { expect, test } from "@playwright/test";

test.describe("806 battle report V1.1", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "14周年 806储值战报" })).toBeVisible();
  });

  test("keeps filters compact and the bottom directory read-only", async ({ page }) => {
    await page.getByRole("combobox", { name: "1 先选择总部或区域" }).selectOption({ label: "闽东二区" });
    await page.getByRole("combobox", { name: "2 再选择区域总览或门店" }).selectOption({ label: "宁德福安赛岐凯旋店" });

    const scopeHeight = await page.locator(".scope-panel").evaluate((element) => element.getBoundingClientRect().height);
    expect(scopeHeight).toBeLessThanOrEqual(132);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(393);
    await expect(page.locator("div.store-row").first()).toBeVisible();
    await expect(page.locator("button.store-row")).toHaveCount(0);
  });

  test("shows exact champion identity, total-progress copy, and reliable bonus fallback", async ({ page }) => {
    await page.getByRole("combobox", { name: "1 先选择总部或区域" }).selectOption({ label: "闽南二区" });
    await page.getByRole("combobox", { name: "2 再选择区域总览或门店" }).selectOption({ label: "泉州鲤城超越工业园店" });

    await expect(page.locator(".store-hero")).toHaveClass(/champion-hero/);
    await expect(page.locator(".champion-emblem")).toHaveText("冠军");
    await expect(page.locator(".champion-badge")).toContainText("全国今日冠军");
    await expect(page.locator(".motivation-card")).toContainText("今日比总进度领先");
    await expect(page.locator(".bonus-goal-card")).toContainText("已获得奖金");
    await expect(page.locator(".bonus-goal-card")).toContainText("总奖金按实际储值档位实时累计");

    await page.getByRole("tab", { name: /累计/ }).click();
    await expect(page.getByRole("tab", { name: /累计/ })).toHaveAttribute("aria-selected", "true");
  });
});
