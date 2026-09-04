import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { collectPageErrors } from "./fixtures";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/official-spine");
const versions = ["3.5", "3.6", "3.7", "3.8", "4.0", "4.1", "4.2"] as const;

function fixtureFiles(version: typeof versions[number], kind: "json" | "skel"): string[] {
  const directory = resolve(fixtureRoot, version);
  return [
    resolve(directory, "spineboy-pma.atlas"),
    resolve(directory, version === "3.5" ? "spineboy.json" : `spineboy-ess.${kind}`),
    resolve(directory, "spineboy-pma.png"),
  ];
}

async function importOfficialFixture(
  page: Parameters<typeof collectPageErrors>[0],
  version: typeof versions[number],
  kind: "json" | "skel",
): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(fixtureFiles(version, kind));
  if (version === "3.5" || version === "3.6" || version === "3.7" || version === "3.8") {
    await expect(page.getByRole("radio", { name: "预乘 Alpha（PMA）" })).toBeChecked();
    await page.getByRole("button", { name: "确认 Alpha 模式并加载预览" }).click();
  }
}

for (const version of versions) {
  const kinds = version === "3.5" || version === "3.6" || version === "3.7"
    ? ["json"] as const
    : ["json", "skel"] as const;
  for (const kind of kinds) {
    test(`官方 Spine ${version} ${kind.toUpperCase()} 由对应 bridge 加载`, async ({ page }) => {
      const errors = collectPageErrors(page);
      if (version === "3.5" || version === "3.6" || version === "3.7") {
        await page.addInitScript(() => {
          const original = WebGLRenderingContext.prototype.blendFunc;
          (window as unknown as { __spineBlendCalls: number[][] }).__spineBlendCalls = [];
          WebGLRenderingContext.prototype.blendFunc = function (source, destination) {
            (window as unknown as { __spineBlendCalls: number[][] }).__spineBlendCalls.push([source, destination]);
            return original.call(this, source, destination);
          };
        });
      }
      await page.goto("/");
      await importOfficialFixture(page, version, kind);

      await expect(page.getByRole("status").first()).toContainText(`Spine ${version} · 预览已就绪`);
      await expect(page.getByRole("region", { name: "Spine 预览交互区域" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Runtime 版本" })).toBeHidden();
      if (version === "3.5" || version === "3.6" || version === "3.7") {
        await page.getByRole("button", { name: "适配画面" }).click();
        await expect(page.getByRole("region", { name: "动画列表" }).getByRole("button", { name: "idle" })).toBeVisible();
        await page.getByRole("tab", { name: "皮肤" }).click();
        await expect(page.getByRole("region", { name: "皮肤列表" }).getByRole("radio", { name: "default" })).toBeVisible();
        await page.getByRole("tab", { name: "插槽" }).click();
        const expectedSlot = version === "3.5" ? "rear_upper_arm" : "rear-upper-arm";
        await expect(page.getByRole("region", { name: "插槽列表" }).getByRole("checkbox", { name: expectedSlot })).toBeVisible();
        await expect(page.getByText("有效样本").locator("xpath=following-sibling::dd")).not.toHaveText("0");
        await expect.poll(() => page.getByLabel("Spine 动画画布").evaluate(async (canvas) => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const target = canvas as HTMLCanvasElement;
          const gl = target.getContext("webgl");
          if (!gl || target.width === 0 || target.height === 0) return false;
          const pixels = new Uint8Array(target.width * target.height * 4);
          gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixels.some((value, index) => index % 4 === 3 && value > 0);
        })).toBe(true);
        const premultipliedBlendWasUsed = await page.evaluate(() => {
          const gl = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Spine 动画画布"]')?.getContext("webgl");
          const calls = (window as unknown as { __spineBlendCalls: number[][] }).__spineBlendCalls;
          return Boolean(gl && calls.some(([source, destination]) => (
            source === gl.ONE && destination === gl.ONE_MINUS_SRC_ALPHA
          )));
        });
        expect(premultipliedBlendWasUsed).toBe(true);
      }
      expect(errors).toEqual([]);
    });
  }
}

for (const version of ["3.5", "3.6", "3.7"] as const) {
  test(`Spine ${version} SKEL 明确报告 JSON-only 能力限制且不跨版本读取`, async ({ page }) => {
    const directory = resolve(fixtureRoot, version);
    const encodeString = (value: string): Buffer => {
      const content = Buffer.from(value);
      return Buffer.concat([Buffer.from([content.length + 1]), content]);
    };
    const editorVersion = {
      "3.5": "3.5.03-beta",
      "3.6": "3.6.32",
      "3.7": "3.7.90",
    }[version];
    const skel = Buffer.concat([encodeString("fixture-hash"), encodeString(editorVersion)]);

    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles([
      { name: "spineboy.skel", mimeType: "application/octet-stream", buffer: skel },
      { name: "spineboy-pma.atlas", mimeType: "text/plain", buffer: await readFile(resolve(directory, "spineboy-pma.atlas")) },
      { name: "spineboy-pma.png", mimeType: "image/png", buffer: await readFile(resolve(directory, "spineboy-pma.png")) },
    ]);

    await expect(page.getByRole("radio", { name: "预乘 Alpha（PMA）" })).toBeChecked();
    await page.getByRole("button", { name: "确认 Alpha 模式并加载预览" }).click();

    await expect(page.getByRole("status").first()).toContainText("预览不可用 · Atlas 仍可导出");
    const issue = page.getByRole("region", { name: "问题中心" });
    await expect(issue).toContainText("当前 Runtime 不支持 SKEL");
    await expect(issue).toContainText(`Spine ${version} 官方 Runtime 不支持 SKEL`);
    await expect(issue).toContainText("不会交给其他版本 Runtime");
    await expect(issue).toContainText("RUNTIME_CAPABILITY_UNSUPPORTED");
  });
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
