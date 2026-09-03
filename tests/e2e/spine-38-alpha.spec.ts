import { expect, test, type Page } from "@playwright/test";
import {
  atlasFor38,
  collectPageErrors,
  importFixture,
  makePng,
  skeletonJson38,
} from "./fixtures";

async function centerPixel(page: Page): Promise<number[]> {
  const canvas = page.getByLabel("Spine 动画画布");
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => {
    const target = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Spine 动画画布"]');
    if (!target || target.width === 0 || target.height === 0) return false;
    const gl = target.getContext("webgl");
    if (!gl) return false;
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(gl.drawingBufferWidth / 2),
      Math.floor(gl.drawingBufferHeight / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    if (pixel[3] > 0) {
      (window as unknown as { __spineCenterPixel: number[] }).__spineCenterPixel = Array.from(pixel);
      return true;
    }
    return false;
  });
  return page.evaluate(() => (
    (window as unknown as { __spineCenterPixel: number[] }).__spineCenterPixel
  ));
}

for (const fixture of [
  {
    label: "PMA",
    modeName: "预乘 Alpha（PMA）",
    filename: "edge-pma.png",
    rgba: [128, 0, 0, 128] as const,
  },
  {
    label: "straight",
    modeName: "直通 Alpha（Straight）",
    filename: "edge-straight.png",
    rgba: [255, 0, 0, 128] as const,
  },
]) {
  test(`Spine 3.8 ${fixture.label} 模式正确渲染半透明边缘像素`, async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/");
    await importFixture(page, {
      atlas: atlasFor38(fixture.filename),
      skeleton: skeletonJson38(),
      pngNames: [fixture.filename],
      pngBuffers: { [fixture.filename]: makePng(1, 1, fixture.rgba) },
    });

    const radio = page.getByRole("radio", { name: fixture.modeName });
    if (fixture.label === "PMA") {
      await expect(radio).toBeChecked();
      await expect(page.getByText(/文件名仅用于建议默认值/)).toBeVisible();
    } else {
      await radio.check();
    }
    await page.getByRole("button", { name: "确认 Alpha 模式并加载预览" }).click();
    await expect(page.getByRole("status").first()).toContainText("Spine 3.8 · 预览已就绪");

    const pixel = await centerPixel(page);
    expect(pixel[0]).toBeGreaterThanOrEqual(118);
    expect(pixel[0]).toBeLessThanOrEqual(138);
    expect(pixel[1]).toBeLessThanOrEqual(2);
    expect(pixel[2]).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });
}
