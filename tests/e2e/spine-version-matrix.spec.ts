import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import {
  atlasFor,
  atlasFor38,
  collectPageErrors,
  importFixture,
  makePng,
  skeletonJson,
  skeletonJson38,
} from "./fixtures";

const VERSION_MATRIX = [
  { runtime: "3.5", raw: "3.5.51", legacy: true },
  { runtime: "3.6", raw: "3.6.53", legacy: true },
  { runtime: "3.7", raw: "3.7.94", legacy: true },
  { runtime: "3.8", raw: "3.8.99", legacy: true },
  { runtime: "4.0", raw: "4.0.64", legacy: false },
  { runtime: "4.1", raw: "4.1.24", legacy: false },
  { runtime: "4.2", raw: "4.2.120", legacy: false },
  { runtime: "4.3", raw: "4.3.9", legacy: false },
] as const;

for (const entry of VERSION_MATRIX) {
  test(`Spine ${entry.runtime} 自动导入显示素材版本与实际 Runtime`, async ({ page }) => {
    await page.goto("/");
    await importFixture(page, {
      atlas: entry.legacy ? atlasFor38() : atlasFor(),
      skeleton: entry.legacy ? skeletonJson38(entry.raw) : skeletonJson(entry.raw),
    });

    const info = page.getByRole("group", { name: "Spine 版本信息" });
    await expect(info).toContainText(`素材版本 ${entry.raw}`);
    await expect(info).toContainText(`Runtime ${entry.runtime}（自动）`);
    if (entry.legacy) {
      await expect(page.getByRole("heading", { name: "Spine 3.x 纹理 Alpha 模式" })).toBeVisible();
    }
  });
}

function skelHeader(version: string): Buffer {
  return Buffer.concat([
    Buffer.from([1, Buffer.byteLength(version) + 1]),
    Buffer.from(version),
  ]);
}

test("Spine 3.5 SKEL 能力错误后仍生成并读取 Atlas-only ZIP", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "hero.atlas", mimeType: "text/plain", buffer: Buffer.from(atlasFor38()) },
    { name: "hero.skel", mimeType: "application/octet-stream", buffer: skelHeader("3.5.51") },
    { name: "page.png", mimeType: "image/png", buffer: makePng() },
  ]);

  const center = page.getByRole("region", { name: "问题中心" });
  await expect(center).toContainText("当前 Runtime 不支持 SKEL");
  await expect(center).toContainText("同一 Spine 版本重新导出 JSON");
  await expect(page.getByRole("heading", { name: "Spine 3.x 纹理 Alpha 模式" })).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Runtime 版本" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Region（1）" })).toBeVisible();
  await expect(page.getByRole("button", { name: /导出全部 ZIP/ })).toBeDisabled();
  await page.getByRole("button", { name: "确认 Alpha 模式用于 Atlas 导出" }).click();
  await expect(page.getByRole("button", { name: /导出全部 ZIP/ })).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件路径");
  const zip = await JSZip.loadAsync(await readFile(path));

  expect(Object.keys(zip.files).filter((name) => !zip.files[name]?.dir).sort())
    .toEqual(["export-report.json", "square.png"]);
  const report = JSON.parse(await zip.file("export-report.json")!.async("string"));
  expect(report.summary).toEqual({ successful: 1, skipped: 0, failed: 0, total: 1 });
  expect(errors).toEqual([]);
});
