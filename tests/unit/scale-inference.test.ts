import { describe, expect, it } from "vitest";
import { inferExportScale } from "@/lib/spine/scale-inference";

describe("inferExportScale", () => {
  it.each([
    { scale: 0.5, restoreMultiplier: 2, exportPercent: 50 },
    { scale: 1, restoreMultiplier: 1, exportPercent: 100 },
    { scale: 2, restoreMultiplier: 0.5, exportPercent: 200 },
  ])("Atlas-only page scale $scale 是直接高置信证据", ({ scale, restoreMultiplier, exportPercent }) => {
    const result = inferExportScale([], [{ pageName: "page.png", scale }]);

    expect(result).toMatchObject({
      restoreMultiplier,
      exportPercent,
      confidence: "high",
      sampleCount: 1,
      requiresConfirmation: false,
      pageEvidence: [{ pageName: "page.png", atlasScale: scale, restoreMultiplier }],
    });
  });

  it("直接 page scale 优先于尺寸附件推断", () => {
    const result = inferExportScale([{
      regionName: "attachment",
      atlasWidth: 100,
      atlasHeight: 100,
      attachmentWidth: 100,
      attachmentHeight: 100,
    }], [{ pageName: "page.png", scale: 0.5 }]);

    expect(result).toMatchObject({ restoreMultiplier: 2, confidence: "high" });
  });

  it("多页 scale 冲突时不静默选择高置信倍率", () => {
    const result = inferExportScale([], [
      { pageName: "half.png", scale: 0.5 },
      { pageName: "full.png", scale: 1 },
    ]);

    expect(result).toMatchObject({
      restoreMultiplier: 1,
      exportPercent: 100,
      confidence: "low",
      requiresConfirmation: true,
      sampleCount: 2,
    });
    expect(result.warnings.join("\n")).toContain("half.png");
    expect(result.warnings.join("\n")).toContain("full.png");
    expect(result.warnings.join("\n")).toContain("冲突");
  });

  it("按稳定 Region 身份去重多皮肤附件，避免虚增置信度", () => {
    const result = inferExportScale([
      {
        regionKey: "body#-1",
        regionName: "body",
        atlasWidth: 50,
        atlasHeight: 50,
        attachmentWidth: 100,
        attachmentHeight: 100,
      },
      {
        regionKey: "body#-1",
        regionName: "body",
        atlasWidth: 50,
        atlasHeight: 50,
        attachmentWidth: 100,
        attachmentHeight: 100,
      },
    ]);

    expect(result).toMatchObject({ restoreMultiplier: 2, confidence: "medium", sampleCount: 1 });
    expect(result.evidence).toHaveLength(1);
    expect(result.warnings).toContain("已按稳定 Region 身份去重 1 个重复附件样本。");
  });

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

  it("不会把两个互相冲突的样本均值误判为高置信度候选", () => {
    const result = inferExportScale([
      { regionName: "one", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 100, attachmentHeight: 100 },
      { regionName: "three", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 300, attachmentHeight: 300 },
    ]);

    expect(result).toMatchObject({
      restoreMultiplier: 2,
      confidence: "low",
      sampleCount: 0,
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({ regionName: "one", included: false }),
      expect.objectContaining({ regionName: "three", included: false }),
    ]);
  });

  it("只用最终候选附近的样本支持置信度，不让对称离群组合冒充支持", () => {
    const result = inferExportScale([
      { regionName: "low", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 100, attachmentHeight: 100 },
      { regionName: "near-a", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 200, attachmentHeight: 200 },
      { regionName: "near-b", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 202, attachmentHeight: 202 },
      { regionName: "high", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 300, attachmentHeight: 300 },
    ]);

    expect(result).toMatchObject({ restoreMultiplier: 2, confidence: "high", sampleCount: 2 });
    expect(result.evidence).toEqual([
      expect.objectContaining({ regionName: "low", included: false }),
      expect.objectContaining({ regionName: "near-a", included: true }),
      expect.objectContaining({ regionName: "near-b", included: true }),
      expect.objectContaining({ regionName: "high", included: false }),
    ]);
  });

  it("两个样本虽在候选 6% 内但离散超过 3% 时只给中置信度", () => {
    const result = inferExportScale([
      { regionName: "below", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 190, attachmentHeight: 190 },
      { regionName: "above", atlasWidth: 100, atlasHeight: 100, attachmentWidth: 210, attachmentHeight: 210 },
    ]);

    expect(result).toMatchObject({ restoreMultiplier: 2, confidence: "medium", sampleCount: 2 });
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
