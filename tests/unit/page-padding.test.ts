import { describe, expect, it } from "vitest";
import {
  collectPagePaddings,
  describePagePadding,
  unionPageSize,
} from "@/lib/atlas/page-padding";
import type { AtlasDocument, AtlasPage, AtlasRegion } from "@/lib/atlas/types";

function page(overrides: Partial<AtlasPage> = {}): AtlasPage {
  return { name: "skeleton.png", width: 0, height: 0, custom: {}, ...overrides };
}

function region(overrides: Partial<AtlasRegion> = {}): AtlasRegion {
  return {
    name: "hero",
    pageName: "skeleton.png",
    index: -1,
    x: 0,
    y: 0,
    packedWidth: 2,
    packedHeight: 2,
    originalWidth: 2,
    originalHeight: 2,
    offsetLeft: 0,
    offsetBottom: 0,
    rotation: 0,
    custom: {},
    ...overrides,
  };
}

function document(pages: AtlasPage[], regions: AtlasRegion[] = []): AtlasDocument {
  return { pages, regions };
}

describe("unionPageSize", () => {
  it("在 Atlas 声明更大时采用声明尺寸，让 PNG 右侧和底部按透明补齐", () => {
    expect(unionPageSize({ width: 361, height: 538 }, { width: 365, height: 542 }))
      .toEqual({ width: 365, height: 542 });
  });

  it("按轴独立取较大值，并忽略 0 或缺失的声明", () => {
    expect(unionPageSize({ width: 10, height: 10 }, { width: 20, height: 5 }))
      .toEqual({ width: 20, height: 10 });
    expect(unionPageSize({ width: 10, height: 10 }, { width: 0, height: 0 }))
      .toEqual({ width: 10, height: 10 });
    expect(unionPageSize({ width: 10, height: 10 })).toEqual({ width: 10, height: 10 });
  });
});

describe("collectPagePaddings", () => {
  it("报告 PNG 小于声明尺寸的页，并列出依赖补齐像素的 Region", () => {
    const paddings = collectPagePaddings(document(
      [page({ width: 365, height: 542, imageWidth: 361, imageHeight: 538 })],
      [
        region({ name: "fits", x: 10, y: 10, packedWidth: 50, packedHeight: 50 }),
        region({ name: "right-overflow", x: 300, y: 10, packedWidth: 63, packedHeight: 40 }),
        region({ name: "bottom-overflow", x: 10, y: 500, packedWidth: 40, packedHeight: 40 }),
      ],
    ));

    expect(paddings).toEqual([{
      pageName: "skeleton.png",
      declaredWidth: 365,
      declaredHeight: 542,
      imageWidth: 361,
      imageHeight: 538,
      padRight: 4,
      padBottom: 4,
      regionNames: ["right-overflow", "bottom-overflow"],
    }]);
  });

  it("PNG 不小于声明尺寸或页面尚未解码时不报告补齐", () => {
    expect(collectPagePaddings(document([
      page({ width: 100, height: 100, imageWidth: 100, imageHeight: 100 }),
      page({ name: "bigger.png", width: 50, height: 50, imageWidth: 80, imageHeight: 90 }),
      page({ name: "undecoded.png", width: 400, height: 400 }),
    ]))).toEqual([]);
  });

  it("只统计属于该页的 Region", () => {
    const paddings = collectPagePaddings(document(
      [page({ width: 10, height: 10, imageWidth: 8, imageHeight: 8 })],
      [
        region({ name: "same-page", x: 4, y: 0, packedWidth: 6, packedHeight: 2 }),
        region({ name: "other-page", pageName: "other.png", x: 4, y: 0, packedWidth: 6, packedHeight: 2 }),
      ],
    ));

    expect(paddings[0]?.regionNames).toEqual(["same-page"]);
  });
});

describe("describePagePadding", () => {
  it("说明实际尺寸、声明尺寸、补齐方向和受影响的 Region", () => {
    const [padding] = collectPagePaddings(document(
      [page({ width: 365, height: 542, imageWidth: 361, imageHeight: 538 })],
      [
        region({ name: "1", x: 252, y: 374, packedWidth: 111, packedHeight: 166 }),
        region({ name: "3", x: 82, y: 379, packedWidth: 168, packedHeight: 161 }),
      ],
    ));

    expect(describePagePadding(padding!)).toBe(
      "纹理页「skeleton.png」实际 361×538，Atlas 声明 365×542；已按声明尺寸在右侧 4 px、底部 4 px 补齐透明像素，涉及 2 个 Region（1、3）。",
    );
  });

  it("省略补齐为 0 的方向，并压缩过长的 Region 列表", () => {
    const names = Array.from({ length: 10 }, (_, index) => `region-${index}`);
    const [padding] = collectPagePaddings(document(
      [page({ width: 12, height: 10, imageWidth: 10, imageHeight: 10 })],
      names.map((name, index) => region({ name, x: index, y: 0, packedWidth: index + 3, packedHeight: 2 })),
    ));

    const text = describePagePadding(padding!);
    expect(text).toContain("在右侧 2 px 补齐透明像素");
    expect(text).not.toContain("底部");
    expect(text).toContain("涉及 6 个 Region（region-4、region-5、region-6、region-7、region-8、region-9）");
  });

  it("没有 Region 依赖补齐像素时明确说明", () => {
    const paddings = collectPagePaddings(document(
      [page({ width: 20, height: 20, imageWidth: 10, imageHeight: 10 })],
      [region({ name: "inside", packedWidth: 4, packedHeight: 4 })],
    ));

    expect(describePagePadding(paddings[0]!)).toContain("没有 Region 依赖补齐的像素");
  });
});
