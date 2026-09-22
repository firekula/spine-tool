import { expect, test } from "@playwright/test";

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const MAGENTA = [255, 0, 255, 255];
const CYAN = [0, 255, 255, 255];
const BLUE = [0, 0, 255, 255];
const YELLOW = [255, 255, 0, 255];
const PURPLE = [128, 0, 128, 255];
const BLACK = [0, 0, 0, 255];
const TRANSPARENT = [0, 0, 0, 0];

for (const paddingCase of [
  {
    // Rows 0 and 1 of this crop end inside the PNG, row 2 and columns 3-4 fall
    // outside it. Without an image bounds check the offset of column 3 of row 0
    // wraps into row 1 and would report MAGENTA/CYAN instead of nothing.
    title: "PNG 右侧和底部缺少的像素按透明补齐，不回绕到相邻行像素",
    textureWidth: 3,
    textureHeight: 2,
    texturePixels: [RED, GREEN, BLUE, MAGENTA, CYAN, YELLOW],
    region: { x: 2, y: 0, packedWidth: 3, packedHeight: 3, rotation: 0 },
    sourceSize: { width: 5, height: 4 },
    expectedWidth: 3,
    expectedHeight: 3,
    expectedPixels: [
      BLUE, TRANSPARENT, TRANSPARENT,
      YELLOW, TRANSPARENT, TRANSPARENT,
      TRANSPARENT, TRANSPARENT, TRANSPARENT,
    ],
  },
  {
    // 90° packing maps original x = 0 onto the PNG row below its last one, so
    // the first output column has to come out fully transparent.
    title: "旋转 Region 落在 PNG 底部之外的像素同样按透明补齐",
    textureWidth: 3,
    textureHeight: 3,
    texturePixels: [RED, GREEN, BLUE, MAGENTA, CYAN, YELLOW, PURPLE, BLACK, [255, 255, 255, 255]],
    region: { x: 1, y: 1, packedWidth: 2, packedHeight: 3, rotation: 90 },
    sourceSize: { width: 4, height: 4 },
    expectedWidth: 3,
    expectedHeight: 2,
    expectedPixels: [
      TRANSPARENT, BLACK, CYAN,
      TRANSPARENT, [255, 255, 255, 255], YELLOW,
    ],
  },
] as const) {
  test(paddingCase.title, async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (fixture) => {
      const modulePath = "/lib/atlas/restore-region.ts";
      const { restoreRegion } = await import(modulePath);
      const texture = document.createElement("canvas");
      texture.width = fixture.textureWidth;
      texture.height = fixture.textureHeight;
      const textureContext = texture.getContext("2d");
      if (!textureContext) throw new Error("缺少测试 Canvas 2D context");
      textureContext.putImageData(
        new ImageData(new Uint8ClampedArray(fixture.texturePixels.flat()), fixture.textureWidth, fixture.textureHeight),
        0,
        0,
      );
      const sourcePng = await new Promise<Blob>((resolve, reject) => {
        texture.toBlob((blob) => blob ? resolve(blob) : reject(new Error("测试 PNG 编码失败")), "image/png");
      });
      const texturePage = await createImageBitmap(sourcePng);
      const rotation: number = fixture.region.rotation;
      const swappedAxes = rotation === 90 || rotation === 270;
      const unrotatedWidth = swappedAxes ? fixture.region.packedHeight : fixture.region.packedWidth;
      const unrotatedHeight = swappedAxes ? fixture.region.packedWidth : fixture.region.packedHeight;

      const restored = await restoreRegion({
        region: {
          name: "padded",
          pageName: "padded.png",
          index: -1,
          ...fixture.region,
          originalWidth: unrotatedWidth,
          originalHeight: unrotatedHeight,
          offsetLeft: 0,
          offsetBottom: 0,
          custom: {},
        },
        texturePage,
        restoreMultiplier: 1,
        sourceSize: fixture.sourceSize,
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

      return {
        width: output.width,
        height: output.height,
        pixels: [...outputContext.getImageData(0, 0, output.width, output.height).data],
      };
    }, paddingCase);

    expect(result.width).toBe(paddingCase.expectedWidth);
    expect(result.height).toBe(paddingCase.expectedHeight);
    expect(result.pixels).toEqual(paddingCase.expectedPixels.flat());
  });
}

const cases = [
  {
    rotation: 90,
    packedWidth: 3,
    packedHeight: 2,
    // Official Atlas rotate:true means the original was packed 90° CCW.
    packedPixels: [GREEN, CYAN, YELLOW, RED, MAGENTA, BLUE],
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
    packedPixels: [BLUE, MAGENTA, RED, YELLOW, CYAN, GREEN],
  },
] as const;

for (const packedCase of cases) {
  for (const sourceAlphaMode of ["straight", "premultiplied"] as const) {
  test(`${packedCase.rotation}° ${sourceAlphaMode} Region 在真实 Canvas 中反旋转并按 bottom offset 补透明边距`, async ({ page }) => {
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
        sourceAlphaMode: fixture.sourceAlphaMode,
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
        row0: [pixelAt(1, 2), pixelAt(2, 2)],
        row1: [pixelAt(1, 3), pixelAt(2, 3)],
        row2: [pixelAt(1, 4), pixelAt(2, 4)],
        above: pixelAt(1, 1),
        below: pixelAt(1, 5),
        left: pixelAt(0, 2),
        right: pixelAt(3, 2),
      };
    }, { ...packedCase, sourceAlphaMode });

    expect(result).toEqual({
      width: 4,
      height: 6,
      type: "image/png",
      row0: [RED, GREEN],
      row1: [MAGENTA, CYAN],
      row2: [BLUE, YELLOW],
      above: TRANSPARENT,
      below: TRANSPARENT,
      left: TRANSPARENT,
      right: TRANSPARENT,
    });
  });
  }
}

test("PMA 像素在裁切后、缩放前转换成 straight alpha，透明像素 RGB 固定为零", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/lib/atlas/restore-region.ts";
    const { restoreRegion } = await import(modulePath);
    const source = document.createElement("canvas");
    source.width = 3;
    source.height = 1;
    const sourceContext = source.getContext("2d");
    if (!sourceContext) throw new Error("缺少测试 Canvas 2D context");
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray([
      64, 32, 16, 128,
      64, 32, 16, 128,
      200, 150, 100, 0,
    ]), 3, 1), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      source.toBlob((value) => value ? resolve(value) : reject(new Error("测试 PNG 编码失败")), "image/png");
    });
    const texturePage = await createImageBitmap(blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    const restored = await restoreRegion({
      region: {
        name: "pma", pageName: "pma.png", index: -1, x: 0, y: 0,
        packedWidth: 3, packedHeight: 1, originalWidth: 3, originalHeight: 1,
        offsetLeft: 0, offsetBottom: 0, rotation: 0, custom: {},
      },
      texturePage,
      restoreMultiplier: 2,
      sourceAlphaMode: "premultiplied",
    });
    texturePage.close();
    const bitmap = await createImageBitmap(restored.blob);
    const output = document.createElement("canvas");
    output.width = bitmap.width;
    output.height = bitmap.height;
    const context = output.getContext("2d");
    if (!context) throw new Error("缺少输出 Canvas 2D context");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      size: [output.width, output.height],
      semitransparent: Array.from(context.getImageData(2, 0, 1, 1).data),
      transparent: Array.from(context.getImageData(5, 0, 1, 1).data),
    };
  });

  expect(result.size).toEqual([6, 2]);
  // Alpha-aware CPU bilinear scaling clamps the one-row edge and runs only
  // after unpremultiplication, so neither alpha nor RGB gains Canvas rounding.
  expect(result.semitransparent).toEqual([128, 64, 32, 128]);
  expect(result.transparent).toEqual([0, 0, 0, 0]);
});

for (const lowAlphaCase of [
  {
    sourceAlphaMode: "premultiplied",
    expected: [255, 0, 0, 1, 128, 51, 26, 10, 0, 0, 0, 0],
  },
  {
    sourceAlphaMode: "straight",
    expected: [1, 0, 0, 1, 5, 2, 1, 10, 200, 150, 100, 0],
  },
] as const) {
test(`${lowAlphaCase.sourceAlphaMode} 极低 Alpha 从 PNG 原始通道处理，不先经 Canvas 丢失 RGB`, async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async (sourceAlphaMode) => {
    const modulePath = "/lib/atlas/restore-region.ts";
    const { restoreRegion } = await import(modulePath);
    // Exact RGBA8 PNG scanline: [1,0,0,1], [5,2,1,10], [200,150,100,0].
    // The first two pixels deliberately expose Canvas premultiplication loss.
    const bytes = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAb4BS0AAAAFUlEQVR4nGNgZGBgZGVi5DoxLYUBAAY6AdfZLZcAAAAAAElFTkSuQmCC"),
      (character) => character.charCodeAt(0),
    );
    const texturePage = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
      { premultiplyAlpha: "none", colorSpaceConversion: "none" },
    );
    const restored = await restoreRegion({
      region: {
        name: "low-alpha-pma", pageName: "pma.png", index: -1, x: 0, y: 0,
        packedWidth: 3, packedHeight: 1, originalWidth: 3, originalHeight: 1,
        offsetLeft: 0, offsetBottom: 0, rotation: 0, custom: {},
      },
      texturePage,
      restoreMultiplier: 1,
      sourceAlphaMode,
    });
    texturePage.close();

    const outputBitmap = await createImageBitmap(restored.blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    const output = document.createElement("canvas");
    output.width = outputBitmap.width;
    output.height = outputBitmap.height;
    const gl = output.getContext("webgl2");
    if (!gl) throw new Error("缺少测试 WebGL2 context");
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, outputBitmap);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const pixels = new Uint8Array(3 * 4);
    gl.readPixels(0, 0, 3, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    outputBitmap.close();
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return Array.from(pixels);
  }, lowAlphaCase.sourceAlphaMode);

  expect(result).toEqual(lowAlphaCase.expected);
});
}

test("270° 反旋转与极低 Alpha PMA 反预乘在同一路径保持逐行方向和原始 RGB", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/lib/atlas/restore-region.ts";
    const { restoreRegion } = await import(modulePath);
    const bytes = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAb4BS0AAAAFUlEQVR4nGNgZGBgZGVi5DoxLYUBAAY6AdfZLZcAAAAAAElFTkSuQmCC"),
      (character) => character.charCodeAt(0),
    );
    const texturePage = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
      { premultiplyAlpha: "none", colorSpaceConversion: "none" },
    );
    const restored = await restoreRegion({
      region: {
        name: "rotated-low-alpha-pma", pageName: "pma.png", index: -1, x: 0, y: 0,
        packedWidth: 3, packedHeight: 1, originalWidth: 1, originalHeight: 3,
        offsetLeft: 0, offsetBottom: 0, rotation: 270, custom: {},
      },
      texturePage,
      restoreMultiplier: 1,
      sourceAlphaMode: "premultiplied",
    });
    texturePage.close();

    const outputBitmap = await createImageBitmap(restored.blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    const output = document.createElement("canvas");
    output.width = outputBitmap.width;
    output.height = outputBitmap.height;
    const gl = output.getContext("webgl2");
    if (!gl) throw new Error("缺少测试 WebGL2 context");
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, outputBitmap);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const pixels = new Uint8Array(3 * 4);
    gl.readPixels(0, 0, 1, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    outputBitmap.close();
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return {
      size: [output.width, output.height],
      // With DOM-source upload and no UNPACK_FLIP_Y, this direct framebuffer
      // read preserves the image's row order for this texture.
      top: Array.from(pixels.slice(0, 4)),
      middle: Array.from(pixels.slice(4, 8)),
      bottom: Array.from(pixels.slice(8, 12)),
    };
  });

  expect(result).toEqual({
    size: [1, 3],
    top: [0, 0, 0, 0],
    middle: [128, 51, 26, 10],
    bottom: [255, 0, 0, 1],
  });
});

test("用确定性 alpha-aware 双线性缩放到恢复倍率对应的 PNG 尺寸", async ({ page }) => {
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

test("双线性缩放不为每个输出像素构造 samples 临时数组", async ({ page }) => {
  await page.goto("/");

  const nestedSampleArrays = await page.evaluate(async () => {
    const modulePath = "/lib/atlas/restore-region.ts";
    const { restoreRegion } = await import(modulePath);
    const source = document.createElement("canvas");
    source.width = 64;
    source.height = 64;
    const context = source.getContext("2d");
    if (!context) throw new Error("缺少测试 Canvas 2D context");
    context.fillStyle = "rgba(90, 120, 180, 0.5)";
    context.fillRect(0, 0, 64, 64);
    const blob = await new Promise<Blob>((resolve, reject) => source.toBlob(
      (value) => value ? resolve(value) : reject(new Error("测试 PNG 编码失败")),
      "image/png",
    ));
    const texturePage = await createImageBitmap(blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    const originalIterator = Array.prototype[Symbol.iterator];
    let count = 0;
    Array.prototype[Symbol.iterator] = function () {
      if (
        this.length === 4
        && Array.isArray(this[0])
        && Array.isArray(this[1])
        && Array.isArray(this[2])
        && Array.isArray(this[3])
        && this[0].length === 2
        && this[1].length === 2
        && this[2].length === 2
        && this[3].length === 2
      ) count += 1;
      return originalIterator.call(this);
    };
    try {
      await restoreRegion({
        region: {
          name: "allocation-check", pageName: "page.png", index: -1,
          x: 0, y: 0, packedWidth: 64, packedHeight: 64,
          originalWidth: 64, originalHeight: 64,
          offsetLeft: 0, offsetBottom: 0, rotation: 0, custom: {},
        },
        texturePage,
        restoreMultiplier: 2,
        sourceAlphaMode: "straight",
      });
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
      texturePage.close();
    }
    return count;
  });

  expect(nestedSampleArrays).toBe(0);
});

test("恢复与 PNG 流编码响应 AbortSignal 并及时停止", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/lib/atlas/restore-region.ts";
    const { restoreRegion } = await import(modulePath);
    const source = document.createElement("canvas");
    source.width = 256;
    source.height = 256;
    const context = source.getContext("2d");
    if (!context) throw new Error("缺少测试 Canvas 2D context");
    context.fillStyle = "rgba(40, 100, 220, 0.5)";
    context.fillRect(0, 0, 256, 256);
    const blob = await new Promise<Blob>((resolve, reject) => source.toBlob(
      (value) => value ? resolve(value) : reject(new Error("测试 PNG 编码失败")),
      "image/png",
    ));
    const texturePage = await createImageBitmap(blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    const controller = new AbortController();
    const started = performance.now();
    window.setTimeout(() => controller.abort(), 0);
    try {
      await restoreRegion({
        region: {
          name: "cancel-large", pageName: "page.png", index: -1,
          x: 0, y: 0, packedWidth: 256, packedHeight: 256,
          originalWidth: 256, originalHeight: 256,
          offsetLeft: 0, offsetBottom: 0, rotation: 0, custom: {},
        },
        texturePage,
        restoreMultiplier: 4,
        sourceAlphaMode: "straight",
        signal: controller.signal,
      });
      return { rejected: false, name: "", elapsed: performance.now() - started };
    } catch (error) {
      return {
        rejected: true,
        name: error instanceof Error ? error.name : "unknown",
        elapsed: performance.now() - started,
      };
    } finally {
      texturePage.close();
    }
  });

  expect(result).toMatchObject({ rejected: true, name: "AbortError" });
  expect(result.elapsed).toBeLessThan(2_000);
});

for (const fractionalCase of [
  {
    restoreMultiplier: 4 / 3,
    expectedWidth: 5,
    expectedHeight: 4,
    expectedPixels: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 255, 0, 0, 112, 128, 0, 128, 159, 0, 0, 255, 112, 0, 0, 0, 0,
      0, 0, 0, 0, 255, 0, 0, 112, 128, 0, 128, 159, 0, 0, 255, 112, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
  },
  {
    restoreMultiplier: 2 / 3,
    expectedWidth: 3,
    expectedHeight: 2,
    expectedPixels: [
      255, 0, 0, 11, 128, 0, 128, 64, 0, 0, 255, 11,
      255, 0, 0, 11, 128, 0, 128, 64, 0, 0, 255, 11,
    ],
  },
]) {
  test(`${fractionalCase.restoreMultiplier} 倍时把含透明边距的原始画布整体缩放`, async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (fixture) => {
      const modulePath = "/lib/atlas/restore-region.ts";
      const { restoreRegion } = await import(modulePath);
      const texture = document.createElement("canvas");
      texture.width = 2;
      texture.height = 1;
      const textureContext = texture.getContext("2d");
      if (!textureContext) throw new Error("缺少测试 Canvas 2D context");
      textureContext.putImageData(new ImageData(new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]), 2, 1), 0, 0);
      const sourcePng = await new Promise<Blob>((resolve, reject) => {
        texture.toBlob((blob) => blob ? resolve(blob) : reject(new Error("测试 PNG 编码失败")), "image/png");
      });
      const texturePage = await createImageBitmap(sourcePng);
      const restored = await restoreRegion({
        region: {
          name: "fractional",
          pageName: "fractional.png",
          index: -1,
          x: 0,
          y: 0,
          packedWidth: 2,
          packedHeight: 1,
          originalWidth: 4,
          originalHeight: 3,
          offsetLeft: 1,
          offsetBottom: 1,
          rotation: 0,
          custom: {},
        },
        texturePage,
        restoreMultiplier: fixture.restoreMultiplier,
      });
      texturePage.close();

      const actualBitmap = await createImageBitmap(restored.blob);
      const actual = document.createElement("canvas");
      actual.width = actualBitmap.width;
      actual.height = actualBitmap.height;
      const actualContext = actual.getContext("2d");
      if (!actualContext) throw new Error("缺少输出 Canvas 2D context");
      actualContext.drawImage(actualBitmap, 0, 0);
      actualBitmap.close();

      return {
        width: actual.width,
        height: actual.height,
        actualPixels: Array.from(actualContext.getImageData(0, 0, actual.width, actual.height).data),
      };
    }, fractionalCase);

    expect(result.width).toBe(fractionalCase.expectedWidth);
    expect(result.height).toBe(fractionalCase.expectedHeight);
    expect(result.actualPixels).toEqual(fractionalCase.expectedPixels);
  });
}
