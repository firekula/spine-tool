import { expect, test } from "@playwright/test";
import { collectPageErrors, importFixture } from "./fixtures";

test("真实预览支持动画、组合皮肤、插槽、播放、缩放和平移", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importFixture(page);
  await expect(page.getByRole("status").first()).toContainText("预览已就绪");

  await page.getByRole("button", { name: "wave" }).click();
  await expect(page.getByRole("button", { name: "wave" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("tab", { name: "皮肤" }).click();
  await page.getByRole("radio", { name: "组合皮肤" }).click();
  await page.getByRole("checkbox", { name: "winter" }).click();
  await expect(page.getByRole("checkbox", { name: "winter" })).toBeChecked();

  await page.getByRole("tab", { name: "插槽" }).click();
  await page.getByRole("checkbox", { name: "body" }).click();
  await expect(page.getByRole("checkbox", { name: "body" })).not.toBeChecked();

  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByRole("button", { name: "播放" })).toBeVisible();
  await page.getByRole("combobox", { name: "速度" }).selectOption("1.25");
  await expect(page.getByRole("combobox", { name: "速度" })).toHaveValue("1.25");

  const viewport = page.getByRole("region", { name: "Spine 预览交互区域" });
  const initialView = await page.getByLabel("当前视图").textContent();
  await viewport.hover({ position: { x: 300, y: 240 } });
  await page.mouse.wheel(0, -100);
  await expect(page.getByLabel("当前视图")).not.toHaveText(initialView ?? "");
  const zoomedView = await page.getByLabel("当前视图").textContent();
  const box = await viewport.boundingBox();
  if (!box) throw new Error("预览区域没有布局尺寸");
  await page.mouse.move(box.x + 220, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 270, box.y + 245);
  await page.mouse.up();
  await expect(page.getByLabel("当前视图")).not.toHaveText(zoomedView ?? "");

  expect(errors).toEqual([]);
});

test("窄屏抽屉保持核心控制可达并正确归还焦点", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto("/");
  await importFixture(page);
  await expect(page.getByRole("status").first()).toContainText("预览已就绪");

  const controlTrigger = page.getByRole("button", { name: "控制面板" });
  await controlTrigger.click();
  await expect(page.getByRole("button", { name: "关闭控制面板" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "动画" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(controlTrigger).toBeFocused();

  await page.getByRole("button", { name: "导出面板" }).click();
  await expect(page.getByRole("button", { name: "关闭导出面板" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Region（1）" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "导出面板" })).toBeFocused();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
