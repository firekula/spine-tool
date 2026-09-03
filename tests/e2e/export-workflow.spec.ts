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
