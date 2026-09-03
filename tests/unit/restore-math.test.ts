import { describe, expect, it } from "vitest";
import { planRegionRestore } from "@/lib/atlas/restore-math";
import type { AtlasRegion } from "@/lib/atlas/types";

function region(overrides: Partial<AtlasRegion> = {}): AtlasRegion {
  return {
    name: "hero",
    pageName: "page.png",
    index: -1,
    x: 4,
    y: 5,
    packedWidth: 20,
    packedHeight: 10,
    originalWidth: 30,
    originalHeight: 40,
    offsetLeft: 3,
    offsetBottom: 4,
    rotation: 0,
    custom: {},
    ...overrides,
  };
}

describe("planRegionRestore", () => {
  it("把 90 度打包 Region 放回带透明边距的原始画布", () => {
    expect(planRegionRestore(region({ rotation: 90, packedWidth: 10, packedHeight: 20 }), 2)).toMatchObject({
      crop: { x: 4, y: 5, width: 10, height: 20 },
      unrotated: { width: 20, height: 10 },
      output: { width: 60, height: 80 },
      destination: { x: 6, y: 52, width: 40, height: 20 },
    });
  });

  it.each([
    { rotation: 0, unrotated: { width: 20, height: 10 } },
    { rotation: 180, unrotated: { width: 20, height: 10 } },
    { rotation: 270, unrotated: { width: 10, height: 20 } },
  ])("为 $rotation 度打包计算反旋转尺寸", ({ rotation, unrotated }) => {
    expect(planRegionRestore(region({ rotation }), 1).unrotated).toEqual(unrotated);
  });

  it("把 Atlas 底部 offset 换算为 Canvas 顶部坐标", () => {
    const plan = planRegionRestore(region({ offsetLeft: 2, offsetBottom: 7 }), 1.5);

    expect(plan.destination).toEqual({ x: 3, y: 34.5, width: 30, height: 15 });
  });

  it("拒绝超出纹理页边界的裁切矩形", () => {
    expect(() => planRegionRestore(region({ x: 45, packedWidth: 10 }), 1, { width: 50, height: 50 }))
      .toThrow("Region「hero」的裁切范围超出纹理页 page.png（50×50）");
    expect(() => planRegionRestore(region({ y: 45, packedHeight: 10 }), 1, { width: 50, height: 50 }))
      .toThrow("Region「hero」的裁切范围超出纹理页 page.png（50×50）");
  });

  it("拒绝有效像素超出声明的原始透明画布", () => {
    expect(() => planRegionRestore(region({ offsetLeft: 15 }), 1))
      .toThrow("Region「hero」的有效像素范围超出原始画布");
  });

  it("拒绝非直角旋转和无效恢复倍率", () => {
    expect(() => planRegionRestore(region({ rotation: 45 }), 1)).toThrow("Region「hero」使用不支持的 45° 旋转");
    expect(() => planRegionRestore(region(), 0)).toThrow("Region「hero」的恢复倍率必须是大于 0 的有限数值");
  });
});
