import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { atlasFor, collectPageErrors, importFixture, makePng, skeletonJson } from "./fixtures";

function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function decodePng(page: Page, bytes: Buffer): Promise<{
  width: number;
  height: number;
  rgba: number[];
}> {
  return page.evaluate(async (values) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(values)], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("测试无法创建 2D Canvas");
    context.drawImage(bitmap, 0, 0);
    const rgba = [...context.getImageData(0, 0, bitmap.width, bitmap.height).data];
    const decoded = { width: bitmap.width, height: bitmap.height, rgba };
    bitmap.close();
    return decoded;
  }, [...bytes]);
}

function pageWithRegion(options: {
  pageName: string;
  pageSize?: string;
  regionName: string;
  bounds: string;
  offsets: string;
}): string {
  return [
    options.pageName,
    ...(options.pageSize === undefined ? [] : [`size: ${options.pageSize}`]),
    "format: RGBA8888",
    "filter: Nearest,Nearest",
    "repeat: none",
    "pma: false",
    options.regionName,
    `bounds: ${options.bounds}`,
    `offsets: ${options.offsets}`,
    "rotate: 0",
    "index: 0",
  ].join("\n");
}

test("多页 Atlas 省略 size 或写 0,0 时用 PNG 实际尺寸完成 Atlas-only ZIP", async ({ page }) => {
  const errors = collectPageErrors(page);
  const atlas = [
    pageWithRegion({
      pageName: "no-size.png",
      regionName: "red-full-page",
      bounds: "0,0,2,3",
      offsets: "0,0,2,3",
    }),
    pageWithRegion({
      pageName: "zero-size.png",
      pageSize: "0,0",
      regionName: "blue-full-page",
      bounds: "0,0,3,2",
      offsets: "0,0,3,2",
    }),
  ].join("\n\n");

  await page.goto("/");
  await importFixture(page, {
    atlas,
    skeleton: skeletonJson("4.3.0"),
    pngNames: ["no-size.png", "zero-size.png"],
    pngBuffers: {
      "no-size.png": makePng(2, 3, [231, 17, 42, 255]),
      "zero-size.png": makePng(3, 2, [19, 71, 223, 255]),
    },
  });

  await expect(page.getByText("Atlas 已就绪，预览尚未可用")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件路径");
  const zip = await JSZip.loadAsync(await readFile(path));

  const redBytes = Buffer.from(await zip.file("red-full-page.png")!.async("uint8array"));
  const blueBytes = Buffer.from(await zip.file("blue-full-page.png")!.async("uint8array"));
  expect(pngSize(redBytes)).toEqual({ width: 2, height: 3 });
  expect(pngSize(blueBytes)).toEqual({ width: 3, height: 2 });
  expect(await decodePng(page, redBytes)).toEqual({
    width: 2,
    height: 3,
    rgba: Array(6).fill([231, 17, 42, 255]).flat(),
  });
  expect(await decodePng(page, blueBytes)).toEqual({
    width: 3,
    height: 2,
    rgba: Array(6).fill([19, 71, 223, 255]).flat(),
  });

  const report = JSON.parse(await zip.file("export-report.json")!.async("string"));
  expect(report.summary).toEqual({ successful: 2, skipped: 0, failed: 0, total: 2 });
  expect(report.regions).toEqual([
    expect.objectContaining({
      regionName: "red-full-page",
      sourceTexturePage: "no-size.png",
      status: "success",
      outputSize: { width: 2, height: 3 },
    }),
    expect.objectContaining({
      regionName: "blue-full-page",
      sourceTexturePage: "zero-size.png",
      status: "success",
      outputSize: { width: 3, height: 2 },
    }),
  ]);
  expect(errors).toEqual([]);
});

test("PNG 比 Atlas 声明尺寸小时按声明尺寸补齐右侧和底部透明像素后导出", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importFixture(page, {
    atlas: pageWithRegion({
      pageName: "trimmed.png",
      pageSize: "6,6",
      regionName: "padded",
      bounds: "1,1,5,5",
      offsets: "0,0,6,6",
    }),
    skeleton: JSON.stringify({
      skeleton: { hash: "padding-e2e", spine: "4.3.0", width: 6, height: 6 },
      bones: [{ name: "root" }],
      slots: [{ name: "body", bone: "root", attachment: "padded" }],
      skins: [{
        name: "default",
        attachments: { body: { padded: { type: "region", path: "padded", width: 6, height: 6 } } },
      }],
      animations: { idle: {} },
    }),
    pngNames: ["trimmed.png"],
    pngBuffers: { "trimmed.png": makePng(4, 4, [200, 20, 30, 255]) },
  });

  const center = page.getByRole("region", { name: "问题中心" });
  await expect(center).toContainText("PNG 小于 Atlas 声明尺寸");
  await expect(center).toContainText("纹理页「trimmed.png」实际 4×4，Atlas 声明 6×6");
  await expect(center).toContainText("已按声明尺寸在右侧 2 px、底部 2 px 补齐透明像素，涉及 1 个 Region（padded）");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件路径");
  const zip = await JSZip.loadAsync(await readFile(path));
  const paddedBytes = Buffer.from(await zip.file("padded.png")!.async("uint8array"));

  expect(pngSize(paddedBytes)).toEqual({ width: 6, height: 6 });
  const decoded = await decodePng(page, paddedBytes);
  const pixelAt = (x: number, y: number): number[] => decoded.rgba.slice((y * 6 + x) * 4, (y * 6 + x) * 4 + 4);
  // Row 0 and column 5 are the Region's own top/right trim margin; the 4x4 PNG
  // covers source (1,1)-(3,3) of the packer's 6x6 box, so columns 4-5 and rows
  // 4-5 of the crop come out transparent.
  expect(pixelAt(0, 1)).toEqual([200, 20, 30, 255]);
  expect(pixelAt(2, 3)).toEqual([200, 20, 30, 255]);
  expect(pixelAt(3, 1)).toEqual([0, 0, 0, 0]);
  expect(pixelAt(0, 4)).toEqual([0, 0, 0, 0]);
  expect(pixelAt(0, 0)).toEqual([0, 0, 0, 0]);
  expect(pixelAt(5, 5)).toEqual([0, 0, 0, 0]);

  const report = JSON.parse(await zip.file("export-report.json")!.async("string"));
  expect(report.summary).toEqual({ successful: 1, skipped: 0, failed: 0, total: 1 });
  expect(report.regions[0]).toMatchObject({
    regionName: "padded",
    status: "success",
    outputSize: { width: 6, height: 6 },
    sourcePadding: { right: 2, bottom: 2 },
  });
  expect(errors).toEqual([]);
});

test("多页 Atlas 任一 Region 越过 PNG 实际尺寸时在恢复和下载前受控拒绝", async ({ page }) => {
  const errors = collectPageErrors(page);
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await page.goto("/");
  await page.evaluate(() => {
    const originalCreateImageBitmap = globalThis.createImageBitmap.bind(globalThis);
    let calls = 0;
    Object.defineProperty(globalThis, "__testCreateImageBitmapCalls", {
      configurable: true,
      get: () => calls,
    });
    globalThis.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      calls += 1;
      return originalCreateImageBitmap(...args);
    }) as typeof createImageBitmap;
  });
  await importFixture(page, {
    atlas: [
      pageWithRegion({
        pageName: "valid.png",
        regionName: "valid",
        bounds: "0,0,2,2",
        offsets: "0,0,2,2",
      }),
      pageWithRegion({
        pageName: "too-small.png",
        pageSize: "0,0",
        regionName: "out-of-bounds",
        bounds: "1,1,2,2",
        offsets: "0,0,2,2",
      }),
    ].join("\n\n"),
    skeleton: skeletonJson("4.3.0"),
    pngNames: ["valid.png", "too-small.png"],
    pngBuffers: {
      "valid.png": makePng(2, 2, [20, 200, 30, 255]),
      "too-small.png": makePng(2, 2, [200, 20, 30, 255]),
    },
  });

  const center = page.getByRole("region", { name: "问题中心" });
  await expect(center).toContainText("Region 超出纹理范围");
  await expect(center).toContainText("out-of-bounds");
  await expect(center).toContainText("too-small.png（2×2）");
  await expect(page.getByRole("button", { name: /导出全部 ZIP/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Region（/ })).toHaveCount(0);
  expect(await page.evaluate(
    () => (globalThis as unknown as Record<string, number>).__testCreateImageBitmapCalls,
  )).toBe(2);
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);
});

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

  await page.getByRole("button", { name: "重新导入" }).click();
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
