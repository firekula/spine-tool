import { describe, expect, it } from "vitest";
import { inferExportScale } from "@/lib/spine/scale-inference";

describe("inferExportScale", () => {
  it("把一组接近 2 倍的附件证据归一为 50% 导出的恢复倍率", () => {
    const result = inferExportScale([
      {
        regionName: "head",
        atlasWidth: 50,
        atlasHeight: 60,
        attachmentWidth: 100,
        attachmentHeight: 120,
      },
      {
        regionName: "body",
        atlasWidth: 81,
        atlasHeight: 100,
        attachmentWidth: 160,
        attachmentHeight: 200,
      },
    ]);

    expect(result).toMatchObject({
      restoreMultiplier: 2,
      exportPercent: 50,
      confidence: "high",
      sampleCount: 2,
    });
  });

  it("忽略非有限、零或负数尺寸，而不是让无效比值参与推算", () => {
    const result = inferExportScale([
      { regionName: "zero", atlasWidth: 0, atlasHeight: 10, attachmentWidth: 20, attachmentHeight: 20 },
      { regionName: "negative", atlasWidth: 10, atlasHeight: 10, attachmentWidth: -20, attachmentHeight: 20 },
      { regionName: "nan", atlasWidth: 10, atlasHeight: 10, attachmentWidth: Number.NaN, attachmentHeight: 20 },
    ]);

    expect(result).toMatchObject({
      restoreMultiplier: 1,
      exportPercent: 100,
      confidence: "low",
      sampleCount: 0,
      evidence: [],
    });
    expect(result.warnings).toEqual(["没有可用于推算导出倍率的有效 Region 附件尺寸，已保持 1 倍。"]);
  });

  it("只把宽高恢复倍率相差超过 3% 的样本降权", () => {
    const result = inferExportScale([
      { regionName: "at-limit", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 200, attachmentHeight: 194 },
      { regionName: "distorted", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 200, attachmentHeight: 193.98 },
    ]);

    expect(result.evidence.find(({ regionName }) => regionName === "at-limit"))
      .toMatchObject({ aspectRatioError: 0.03, weight: 1 });
    expect(result.evidence.find(({ regionName }) => regionName === "distorted"))
      .toMatchObject({ aspectRatioError: 0.0301, weight: 0.25 });
    expect(result.warnings).toContain("Region「distorted」的附件宽高比例与 Atlas 相差超过 3%，该证据已降权。");
    expect(result.warnings.join("\n")).not.toContain("Region「at-limit」");
  });

  it("用中位数和 MAD 排除远离一致证据的离群值", () => {
    const result = inferExportScale([
      { regionName: "a", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 200, attachmentHeight: 200 },
      { regionName: "b", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 202, attachmentHeight: 202 },
      { regionName: "outlier", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 800, attachmentHeight: 800 },
    ]);

    expect(result.restoreMultiplier).toBe(2);
    expect(result.sampleCount).toBe(2);
    expect(result.evidence.find(({ regionName }) => regionName === "outlier")).toMatchObject({ included: false });
    expect(result.warnings).toContain("已用中位数和 MAD 排除 1 个离群倍率样本。");
  });

  it("只在相对误差不超过 6% 时吸附到常见恢复倍率", () => {
    const boundaryMultiplier = (4 / 3) * 0.94;
    const outsideMultiplier = (4 / 3) * 0.9399;
    const snapped = inferExportScale([
      {
        regionName: "near-75",
        atlasWidth: 100,
        atlasHeight: 100,
        attachmentWidth: boundaryMultiplier * 100,
        attachmentHeight: boundaryMultiplier * 100,
      },
    ]);
    const unsnapped = inferExportScale([
      {
        regionName: "custom",
        atlasWidth: 100,
        atlasHeight: 100,
        attachmentWidth: outsideMultiplier * 100,
        attachmentHeight: outsideMultiplier * 100,
      },
    ]);

    expect(snapped.restoreMultiplier).toBe(4 / 3);
    expect(snapped.exportPercent).toBe(75);
    expect(unsnapped.restoreMultiplier).toBeCloseTo(outsideMultiplier);
    expect(unsnapped.exportPercent).toBeCloseTo(100 / outsideMultiplier);
  });

  it.each([
    { near: 3.9, expected: 4 },
    { near: 1.95, expected: 2 },
    { near: 1.3, expected: 4 / 3 },
    { near: 0.98, expected: 1 },
    { near: 0.65, expected: 2 / 3 },
    { near: 0.49, expected: 1 / 2 },
  ])("把 $near 吸附到常见恢复倍率 $expected", ({ near, expected }) => {
    const result = inferExportScale([
      {
        regionName: "candidate",
        atlasWidth: 100,
        atlasHeight: 100,
        attachmentWidth: near * 100,
        attachmentHeight: near * 100,
      },
    ]);

    expect(result.restoreMultiplier).toBe(expected);
  });

  it("只有一个一致样本时不会给出高置信度", () => {
    const result = inferExportScale([
      { regionName: "only", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 200, attachmentHeight: 200 },
    ]);

    expect(result).toMatchObject({ restoreMultiplier: 2, confidence: "medium", sampleCount: 1 });
  });
});
