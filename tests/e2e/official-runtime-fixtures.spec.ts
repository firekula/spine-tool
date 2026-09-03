import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { collectPageErrors } from "./fixtures";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/official-spine");
const versions = ["3.8", "4.0", "4.1", "4.2"] as const;

function fixtureFiles(version: typeof versions[number], kind: "json" | "skel"): string[] {
  const directory = resolve(fixtureRoot, version);
  return [
    resolve(directory, "spineboy-pma.atlas"),
    resolve(directory, `spineboy-ess.${kind}`),
    resolve(directory, "spineboy-pma.png"),
  ];
}

async function importOfficialFixture(
  page: Parameters<typeof collectPageErrors>[0],
  version: typeof versions[number],
  kind: "json" | "skel",
): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(fixtureFiles(version, kind));
}

for (const version of versions) {
  for (const kind of ["json", "skel"] as const) {
    test(`官方 Spine ${version} ${kind.toUpperCase()} 由对应 bridge 加载`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.goto("/");
      await importOfficialFixture(page, version, kind);

      await expect(page.getByRole("status").first()).toContainText(`Spine ${version} · 预览已就绪`);
      await expect(page.getByRole("region", { name: "Spine 预览交互区域" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Runtime 版本" })).toBeHidden();
      expect(errors).toEqual([]);
    });
  }
}

test("官方 4.2 JSON 完成 metadata 到倍率推算再到 ZIP 的完整链", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await importOfficialFixture(page, "4.2", "json");
  await expect(page.getByRole("status").first()).toContainText("Spine 4.2 · 预览已就绪");
  await expect(page.getByText("有效样本").locator("xpath=following-sibling::dd")).not.toHaveText("0");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件路径");
  const zip = await JSZip.loadAsync(await readFile(path));
  const report = JSON.parse(await zip.file("export-report.json")!.async("string"));
  const pngFiles = Object.keys(zip.files).filter((name) => name.endsWith(".png"));

  expect(report.summary.successful).toBeGreaterThan(0);
  expect(report.summary.failed).toBe(0);
  expect(pngFiles).toHaveLength(report.summary.successful);
  await expect(page.getByRole("status").filter({ hasText: "导出完成" })).toContainText(`成功 ${report.summary.successful} 项`);
  expect(errors).toEqual([]);
});
