import { expect, test } from "@playwright/test";

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const MAGENTA = [255, 0, 255, 255];
const CYAN = [0, 255, 255, 255];
const BLUE = [0, 0, 255, 255];
const YELLOW = [255, 255, 0, 255];
const TRANSPARENT = [0, 0, 0, 0];

const cases = [
  {
    rotation: 90,
    packedWidth: 3,
    packedHeight: 2,
    packedPixels: [BLUE, MAGENTA, RED, YELLOW, CYAN, GREEN],
  },
  {
    rotation: 180,
    packedWidth: 2,
    packedHeight: 3,
    packedPixels: [YELLOW, BLUE, CYAN, MAGENTA, GREEN, RED],
  },
  {
    rotation: 270,
    packedWidth: 3,
    packedHeight: 2,
    packedPixels: [GREEN, CYAN, YELLOW, RED, MAGENTA, BLUE],
  },
] as const;

for (const packedCase of cases) {
  test(`${packedCase.rotation}° Region 在真实 Canvas 中反旋转并按 bottom offset 补透明边距`, async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (fixture) => {
      const modulePath = "/lib/atlas/restore-region.ts";
      const { restoreRegion } = await import(modulePath);
      const texture = document.createElement("canvas");
      texture.width = 6;
      texture.height = 6;
      const textureContext = texture.getContext("2d");
      if (!textureContext) throw new Error("缺少测试 Canvas 2D context");

      const pixels = new Uint8ClampedArray(
        fixture.packedPixels.flatMap((pixel: readonly number[]) => [...pixel]),
      );
      textureContext.putImageData(
        new ImageData(pixels, fixture.packedWidth, fixture.packedHeight),
        1,
        1,
      );
      const sourcePng = await new Promise<Blob>((resolve, reject) => {
        texture.toBlob((blob) => blob ? resolve(blob) : reject(new Error("测试 PNG 编码失败")), "image/png");
      });
      const texturePage = await createImageBitmap(sourcePng);

      const restored = await restoreRegion({
        region: {
          name: `fixture-${fixture.rotation}`,
          pageName: "fixture.png",
          index: -1,
          x: 1,
          y: 1,
          packedWidth: fixture.packedWidth,
          packedHeight: fixture.packedHeight,
          originalWidth: 4,
          originalHeight: 6,
          offsetLeft: 1,
          offsetBottom: 1,
          rotation: fixture.rotation,
          custom: {},
        },
        texturePage,
        restoreMultiplier: 1,
      });
      texturePage.close();

      const restoredBitmap = await createImageBitmap(restored.blob);
      const output = document.createElement("canvas");
      output.width = restoredBitmap.width;
      output.height = restoredBitmap.height;
      const outputContext = output.getContext("2d");
      if (!outputContext) throw new Error("缺少输出 Canvas 2D context");
      outputContext.drawImage(restoredBitmap, 0, 0);
      restoredBitmap.close();

      const pixelAt = (x: number, y: number): number[] =>
        Array.from(outputContext.getImageData(x, y, 1, 1).data);

      return {
        width: output.width,
        height: output.height,
        type: restored.blob.type,
        topLeft: pixelAt(1, 2),
        topRight: pixelAt(2, 2),
        bottomLeft: pixelAt(1, 4),
        bottomRight: pixelAt(2, 4),
        above: pixelAt(1, 1),
        below: pixelAt(1, 5),
        left: pixelAt(0, 2),
        right: pixelAt(3, 2),
      };
    }, packedCase);

    expect(result).toEqual({
      width: 4,
      height: 6,
      type: "image/png",
      topLeft: RED,
      topRight: GREEN,
      bottomLeft: BLUE,
      bottomRight: YELLOW,
      above: TRANSPARENT,
      below: TRANSPARENT,
      left: TRANSPARENT,
      right: TRANSPARENT,
    });
  });
}

test("用真实 Canvas 高质量缩放到恢复倍率对应的 PNG 尺寸", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/lib/atlas/restore-region.ts";
    const { restoreRegion } = await import(modulePath);
    const texture = document.createElement("canvas");
    texture.width = 2;
    texture.height = 3;
    const context = texture.getContext("2d");
    if (!context) throw new Error("缺少测试 Canvas 2D context");
    context.fillStyle = "rgb(255, 0, 0)";
    context.fillRect(0, 0, 2, 3);
    const sourcePng = await new Promise<Blob>((resolve, reject) => {
      texture.toBlob((blob) => blob ? resolve(blob) : reject(new Error("测试 PNG 编码失败")), "image/png");
    });
    const texturePage = await createImageBitmap(sourcePng);
    const restored = await restoreRegion({
      region: {
        name: "scaled",
        pageName: "scaled.png",
        index: -1,
        x: 0,
        y: 0,
        packedWidth: 2,
        packedHeight: 3,
        originalWidth: 2,
        originalHeight: 3,
        offsetLeft: 0,
        offsetBottom: 0,
        rotation: 0,
        custom: {},
      },
      texturePage,
      restoreMultiplier: 2,
    });
    texturePage.close();
    const bitmap = await createImageBitmap(restored.blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  });

  expect(result).toEqual({ width: 4, height: 6 });
});
