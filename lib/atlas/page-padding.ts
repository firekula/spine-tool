import { normalizeAtlasPageName } from "@/lib/atlas/page-name";
import type { AtlasDocument, AtlasPage } from "@/lib/atlas/types";

export interface PixelBox {
  width: number;
  height: number;
}

/** One decoded page whose PNG is smaller than the box the Atlas declares. */
export interface AtlasPagePadding {
  pageName: string;
  /** Size the Atlas declares; 0 on an axis the file omits or writes as 0. */
  declaredWidth: number;
  declaredHeight: number;
  /** Decoded PNG size. */
  imageWidth: number;
  imageHeight: number;
  /** Columns and rows read as transparent on the right and bottom. */
  padRight: number;
  padBottom: number;
  /** Regions whose packed rectangle reaches into the padded area. */
  regionNames: string[];
}

function positiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The pixel box an export reads a page from: the decoded PNG widened to the
 * size the Atlas declares for that page.
 *
 * Spine keeps `xy`/`size` in the box it packed, so a PNG whose right or bottom
 * transparent pixels were trimmed away by later tooling still describes valid
 * Regions. Reading the union and treating the missing pixels as transparent
 * restores the same images the official exporter produces, instead of rejecting
 * the whole Atlas.
 */
export function unionPageSize(decoded: PixelBox, declared?: PixelBox | null): PixelBox {
  return {
    width: positiveFinite(declared?.width) && declared.width > decoded.width
      ? declared.width
      : decoded.width,
    height: positiveFinite(declared?.height) && declared.height > decoded.height
      ? declared.height
      : decoded.height,
  };
}

function decodedImageSize(page: AtlasPage): PixelBox | null {
  const { imageWidth, imageHeight } = page;
  if (!positiveFinite(imageWidth) || !positiveFinite(imageHeight)) return null;
  return { width: imageWidth, height: imageHeight };
}

/**
 * Lists every page whose decoded PNG is smaller than the Atlas declares, with
 * the Regions that rely on the padded columns and rows.
 *
 * Pages that were never decoded carry no image size and are ignored, so this
 * only reports padding an export will actually apply.
 */
export function collectPagePaddings(atlas: AtlasDocument): AtlasPagePadding[] {
  const paddings: AtlasPagePadding[] = [];
  for (const page of atlas.pages) {
    const image = decodedImageSize(page);
    if (!image) continue;
    const box = unionPageSize(image, page);
    const padRight = box.width - image.width;
    const padBottom = box.height - image.height;
    if (padRight === 0 && padBottom === 0) continue;
    paddings.push({
      pageName: page.name,
      declaredWidth: page.width,
      declaredHeight: page.height,
      imageWidth: image.width,
      imageHeight: image.height,
      padRight,
      padBottom,
      regionNames: regionsTouchingPadding(atlas, page, image),
    });
  }
  return paddings;
}

function regionsTouchingPadding(atlas: AtlasDocument, page: AtlasPage, image: PixelBox): string[] {
  const pageName = normalizeAtlasPageName(page.name);
  return atlas.regions
    .filter((region) => normalizeAtlasPageName(region.pageName) === pageName
      && (region.x + region.packedWidth > image.width || region.y + region.packedHeight > image.height))
    .map((region) => region.name);
}

const REGION_NAME_LIMIT = 8;

/** One user-facing line describing a padded page, with the Regions it affects. */
export function describePagePadding(padding: AtlasPagePadding): string {
  const sides = [
    padding.padRight > 0 ? `右侧 ${padding.padRight} px` : undefined,
    padding.padBottom > 0 ? `底部 ${padding.padBottom} px` : undefined,
  ].filter((side): side is string => side !== undefined);
  const affected = padding.regionNames.length === 0
    ? "没有 Region 依赖补齐的像素"
    : `涉及 ${padding.regionNames.length} 个 Region（${padding.regionNames.slice(0, REGION_NAME_LIMIT).join("、")}${
      padding.regionNames.length > REGION_NAME_LIMIT ? " 等" : ""}）`;
  return `纹理页「${padding.pageName}」实际 ${padding.imageWidth}×${padding.imageHeight}，Atlas 声明 ${
    padding.declaredWidth}×${padding.declaredHeight}；已按声明尺寸在${sides.join("、")} 补齐透明像素，${affected}。`;
}
