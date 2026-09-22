import type { AtlasRegion } from "@/lib/atlas/types";

export interface PixelSize {
  width: number;
  height: number;
}

export interface PixelRect extends PixelSize {
  x: number;
  y: number;
}

export interface RegionRestorePlan {
  rotation: 0 | 90 | 180 | 270;
  restoreMultiplier: number;
  crop: PixelRect;
  unrotated: PixelSize;
  original: PixelSize;
  placement: PixelRect;
  output: PixelSize;
  destination: PixelRect;
}

export const MAX_RESTORE_DIMENSION = 16_384;
export const MAX_RESTORE_PIXELS = 33_554_432;

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function fail(region: AtlasRegion, message: string): never {
  throw new Error(`Region「${region.name}」${message}`);
}

function assertSafeRasterSize(region: AtlasRegion, label: string, size: PixelSize): void {
  const pixels = size.width * size.height;
  if (
    !Number.isSafeInteger(size.width)
    || !Number.isSafeInteger(size.height)
    || size.width <= 0
    || size.height <= 0
    || size.width > MAX_RESTORE_DIMENSION
    || size.height > MAX_RESTORE_DIMENSION
    || !Number.isSafeInteger(pixels)
    || pixels > MAX_RESTORE_PIXELS
  ) {
    fail(
      region,
      `的${label}超出浏览器安全预算（最大边长 ${MAX_RESTORE_DIMENSION}px，最大 ${MAX_RESTORE_PIXELS} 像素）`,
    );
  }
}

export function planRegionRestore(
  region: AtlasRegion,
  restoreMultiplier: number,
  /** Pixel box the region may read: the decoded PNG widened to the Atlas page size. */
  sourceSize?: PixelSize,
): RegionRestorePlan {
  if (!positiveFinite(restoreMultiplier)) fail(region, "的恢复倍率必须是大于 0 的有限数值");

  const rotation = region.rotation;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    fail(region, `使用不支持的 ${rotation}° 旋转`);
  }

  if (!nonNegativeFinite(region.x) || !nonNegativeFinite(region.y)
    || !positiveFinite(region.packedWidth) || !positiveFinite(region.packedHeight)) {
    fail(region, "的裁切坐标和尺寸无效");
  }
  if (!positiveFinite(region.originalWidth) || !positiveFinite(region.originalHeight)
    || !nonNegativeFinite(region.offsetLeft) || !nonNegativeFinite(region.offsetBottom)) {
    fail(region, "的原始画布尺寸或透明边距无效");
  }

  if (sourceSize) {
    if (!positiveFinite(sourceSize.width) || !positiveFinite(sourceSize.height)) {
      fail(region, "所属纹理页的尺寸无效");
    }
    // The box is the union of the decoded PNG and the declared page size, so a
    // Region that reaches into the transparent area a truncated PNG is missing
    // still plans normally. Only a crop outside both is a real mismatch.
    const outsideSource = region.x + region.packedWidth > sourceSize.width
      || region.y + region.packedHeight > sourceSize.height;
    if (outsideSource) {
      fail(
        region,
        `的裁切范围超出纹理页 ${region.pageName}（${sourceSize.width}×${sourceSize.height}）`,
      );
    }
  }

  const swapsAxes = rotation === 90 || rotation === 270;
  const unrotated = {
    width: swapsAxes ? region.packedHeight : region.packedWidth,
    height: swapsAxes ? region.packedWidth : region.packedHeight,
  };
  if (region.offsetLeft + unrotated.width > region.originalWidth
    || region.offsetBottom + unrotated.height > region.originalHeight) {
    fail(region, "的有效像素范围超出原始画布");
  }

  const original = {
    width: region.originalWidth,
    height: region.originalHeight,
  };
  assertSafeRasterSize(region, "裁切画布", { width: region.packedWidth, height: region.packedHeight });
  assertSafeRasterSize(region, "反旋转画布", unrotated);
  assertSafeRasterSize(region, "原始画布", original);
  const placement = {
    x: region.offsetLeft,
    y: region.originalHeight - region.offsetBottom - unrotated.height,
    width: unrotated.width,
    height: unrotated.height,
  };
  const output = {
    width: Math.max(1, Math.round(region.originalWidth * restoreMultiplier)),
    height: Math.max(1, Math.round(region.originalHeight * restoreMultiplier)),
  };
  assertSafeRasterSize(region, "输出画布", output);
  const outputScaleX = output.width / original.width;
  const outputScaleY = output.height / original.height;

  return {
    rotation,
    restoreMultiplier,
    crop: {
      x: region.x,
      y: region.y,
      width: region.packedWidth,
      height: region.packedHeight,
    },
    unrotated,
    original,
    placement,
    output,
    destination: {
      x: placement.x * outputScaleX,
      y: placement.y * outputScaleY,
      width: placement.width * outputScaleX,
      height: placement.height * outputScaleY,
    },
  };
}
