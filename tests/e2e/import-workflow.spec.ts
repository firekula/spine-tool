import { expect, test } from "@playwright/test";
import {
  atlasFor,
  collectPageErrors,
  importFixture,
  multiPageAtlas,
  skeletonJson,
} from "./fixtures";

test("单页资源完成真实 Runtime 导入并进入预览", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importFixture(page);

  await expect(page.getByRole("status").first()).toContainText("Spine 4.2 · 预览已就绪");
  await expect(page.locator("header.topbar").getByRole("group", { name: "Spine 版本信息" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Spine 预览交互区域" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Region（1）" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("多页 Atlas 匹配全部纹理并列出全部 Region", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importFixture(page, {
    atlas: multiPageAtlas(),
    skeleton: skeletonJson("4.3.0"),
    pngNames: ["page-a.png", "page-b.png"],
  });

  await expect(page.getByRole("heading", { name: "Region（2）" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Spine 版本信息" })).toContainText("Runtime 4.3（自动）");
  expect(errors).toEqual([]);
});

test("缺少 Atlas 声明的纹理页时显示中文对象、原因和下一步", async ({ page }) => {
  await page.goto("/");
  await importFixture(page, {
    atlas: multiPageAtlas(),
    skeleton: skeletonJson(),
    pngNames: ["page-a.png"],
  });

  const center = page.getByRole("region", { name: "问题中心" });
  await expect(center).toContainText("缺少纹理页");
  await expect(center).toContainText("所选文件");
  await expect(center).toContainText("Atlas 声明的 PNG");
  await expect(center).toContainText("page-b.png");
  await expect(center).toContainText("补齐上述 PNG");
});

test("超出范围版本只在需要时显示手动 Runtime，并可加载所选版本", async ({ page }) => {
  await page.goto("/");
  await importFixture(page, {
    atlas: atlasFor(),
    skeleton: skeletonJson("4.4.0"),
  });

  const picker = page.getByRole("combobox", { name: "Runtime 版本" });
  await expect(picker).toBeVisible();
  await expect(page.getByRole("region", { name: "问题中心" })).toContainText("Spine 版本不在支持范围");
  await expect(picker.locator("option")).toHaveText([
    "Spine 3.5", "Spine 3.6", "Spine 3.7", "Spine 3.8",
    "Spine 4.0", "Spine 4.1", "Spine 4.2", "Spine 4.3",
  ]);
  await picker.selectOption("4.3");
  await page.getByRole("button", { name: "使用所选 Runtime 加载预览" }).click();
  await expect(page.getByRole("group", { name: "Spine 版本信息" })).toContainText("素材版本 4.4.0");
  await expect(page.getByRole("group", { name: "Spine 版本信息" })).toContainText("Runtime 4.3（手动）");
  await expect(picker).toBeHidden();
});
