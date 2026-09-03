import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { atlasFor, collectPageErrors, importFixture, skeletonJson } from "./fixtures";

function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("Runtime 不可用时仍导出并校验 ZIP 的 PNG、尺寸、路径和报告", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importFixture(page, {
    atlas: atlasFor("page.png", ["body/head", "effect"]),
    skeleton: skeletonJson("4.3.0"),
  });
  await expect(page.getByText("Atlas 已就绪，预览尚未可用")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件路径");
  const zip = await JSZip.loadAsync(await readFile(path));

  const names = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir).sort();
  expect(names).toEqual(["body/head.png", "effect.png", "export-report.json"]);
  const head = Buffer.from(await zip.file("body/head.png")!.async("uint8array"));
  const effect = Buffer.from(await zip.file("effect.png")!.async("uint8array"));
  expect(pngSize(head)).toEqual({ width: 1, height: 1 });
  expect(pngSize(effect)).toEqual({ width: 2, height: 3 });

  const report = JSON.parse(await zip.file("export-report.json")!.async("string"));
  expect(report.summary).toEqual({ successful: 2, skipped: 0, failed: 0, total: 2 });
  expect(report.regions.map((region: { zipPath: string }) => region.zipPath)).toEqual(["body/head.png", "effect.png"]);
  expect(report.regions.map((region: { outputSize: unknown }) => region.outputSize)).toEqual([
    { width: 1, height: 1 },
    { width: 2, height: 3 },
  ]);
  expect(errors).toEqual([]);
});

test("反斜杠与 ./ Atlas 页面名经真实浏览器导入后仍可导出 ZIP", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importFixture(page, {
    atlas: `${atlasFor(".\\page-a.png", ["windows"])}\n\n${atlasFor("./page-b.png", ["dot-prefix"])}`,
    skeleton: skeletonJson("4.3.0"),
    pngNames: ["page-a.png", "page-b.png"],
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件路径");
  const zip = await JSZip.loadAsync(await readFile(path));

  expect(Object.keys(zip.files).filter((name) => name.endsWith(".png")).sort())
    .toEqual(["dot-prefix.png", "windows.png"]);
  const report = JSON.parse(await zip.file("export-report.json")!.async("string"));
  expect(report.regions.map((region: { sourceTexturePage: string }) => region.sourceTexturePage))
    .toEqual(["page-a.png", "page-b.png"]);
  expect(errors).toEqual([]);
});

test("Atlas-only page scale 作为直接证据，多页冲突需确认手动倍率", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importFixture(page, {
    atlas: atlasFor().replace("pma: false", "pma: false\nscale: 0.5"),
    skeleton: skeletonJson("4.3.0"),
  });

  await expect(page.getByText("恢复倍率", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("2 倍");
  await expect(page.getByText("置信度", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("高");
  await expect(page.getByText(/page\.png.*scale 0\.5.*恢复 2 倍/)).toBeVisible();

  await importFixture(page, {
    atlas: [
      atlasFor("half.png", ["half"]).replace("pma: false", "pma: false\nscale: 0.5"),
      atlasFor("full.png", ["full"]).replace("pma: false", "pma: false\nscale: 1"),
    ].join("\n\n"),
    skeleton: skeletonJson("4.3.0"),
    pngNames: ["half.png", "full.png"],
  });

  await expect(page.getByText(/多页 scale 冲突/)).toBeVisible();
  const button = page.getByRole("button", { name: "确认倍率后导出全部 ZIP" });
  await expect(button).toBeDisabled();
  await page.getByRole("textbox", { name: "全局倍率（乘在自动倍率之后）" }).fill("2");
  await page.getByRole("checkbox", { name: "我已核对冲突页面并确认使用上述手动倍率" }).check();
  await expect(button).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件路径");
  const zip = await JSZip.loadAsync(await readFile(path));
  const report = JSON.parse(await zip.file("export-report.json")!.async("string"));
  expect(report.regions.map((region: { finalMultiplier: number }) => region.finalMultiplier)).toEqual([2, 2]);
  expect(pngSize(Buffer.from(await zip.file("half.png")!.async("uint8array"))))
    .toEqual({ width: 2, height: 2 });
  expect(pngSize(Buffer.from(await zip.file("full.png")!.async("uint8array"))))
    .toEqual({ width: 2, height: 2 });
  expect(errors).toEqual([]);
});

test("真实浏览器 ZIP 使用 Windows portable 路径且报告映射一致", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importFixture(page, {
    atlas: atlasFor("page.png", ["CON", "aux.txt", "bad?.name", "trailing.", "Head", "head"]),
    skeleton: skeletonJson("4.3.0"),
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件路径");
  const zip = await JSZip.loadAsync(await readFile(path));
  const pngPaths = Object.keys(zip.files).filter((name) => name.endsWith(".png")).sort();

  expect(pngPaths).toEqual([
    "Head.png",
    "_CON.png",
    "_aux.txt.png",
    "bad_.name.png",
    "head-2.png",
    "trailing.png",
  ]);
  const report = JSON.parse(await zip.file("export-report.json")!.async("string"));
  expect(report.regions.map((region: { zipPath: string }) => region.zipPath)).toEqual([
    "_CON.png",
    "_aux.txt.png",
    "bad_.name.png",
    "trailing.png",
    "Head.png",
    "head-2.png",
  ]);
  expect(errors).toEqual([]);
});
