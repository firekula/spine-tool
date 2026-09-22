import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { AtlasDocument } from "@/lib/atlas/types";
import type { ScaleInference } from "@/lib/spine/scale-inference";

const mocks = vi.hoisted(() => ({ restoreRegion: vi.fn() }));
vi.mock("@/lib/atlas/restore-region", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/atlas/restore-region")>(),
  restoreRegion: mocks.restoreRegion,
}));
import { exportAllRegions } from "@/lib/export/export-zip";
import * as zipCompressor from "@/lib/export/zip-compressor";

const atlas: AtlasDocument = {
  pages: [{ name: "page.png", width: 64, height: 64, custom: {} }],
  regions: [
    {
      name: "body/head", pageName: "page.png", index: 0,
      x: 0, y: 0, packedWidth: 10, packedHeight: 12,
      originalWidth: 20, originalHeight: 24, offsetLeft: 2, offsetBottom: 3,
      rotation: 0, custom: {},
    },
    {
      name: "body/head", pageName: "page.png", index: 1,
      x: 10, y: 0, packedWidth: 10, packedHeight: 12,
      originalWidth: 20, originalHeight: 24, offsetLeft: 0, offsetBottom: 0,
      rotation: 0, custom: {},
    },
    {
      name: "broken", pageName: "page.png", index: 2,
      x: 20, y: 0, packedWidth: 10, packedHeight: 12,
      originalWidth: 20, originalHeight: 24, offsetLeft: 0, offsetBottom: 0,
      rotation: 0, custom: {},
    },
    {
      name: "missing-page", pageName: "missing.png", index: 3,
      x: 0, y: 0, packedWidth: 10, packedHeight: 12,
      originalWidth: 20, originalHeight: 24, offsetLeft: 0, offsetBottom: 0,
      rotation: 0, custom: {},
    },
  ],
};

const inferredScale: ScaleInference = {
  restoreMultiplier: 2,
  exportPercent: 50,
  confidence: "low",
  sampleCount: 1,
  evidence: [],
  warnings: ["请确认倍率"],
};

describe("exportAllRegions", () => {
  it("核心导出层拒绝未确认的素材版本，不静默假定 straight alpha", async () => {
    await expect(exportAllRegions({
      atlas: { ...atlas, regions: atlas.regions.slice(0, 1) },
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: null,
    }, vi.fn())).rejects.toThrow(/素材版本.*明确选择/);

    expect(mocks.restoreRegion).not.toHaveBeenCalled();
  });

  it("在恢复任何 Region 前拒绝超过整批 RGBA 内存预算的导出", async () => {
    const oversizedBatch: AtlasDocument = {
      pages: atlas.pages,
      regions: Array.from({ length: 17 }, (_, index) => ({
        ...atlas.regions[0]!,
        name: `large-${index}`,
        index,
        packedWidth: 1,
        packedHeight: 1,
        originalWidth: 2_048,
        originalHeight: 2_048,
        offsetLeft: 0,
        offsetBottom: 0,
      })),
    };

    await expect(exportAllRegions({
      atlas: oversizedBatch,
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale: { ...inferredScale, restoreMultiplier: 1 },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn())).rejects.toThrow(/整批导出.*内存预算/);

    expect(mocks.restoreRegion).not.toHaveBeenCalled();
  });

  it("在恢复或压缩前拒绝超过 4096 个 Region 的导出批次", async () => {
    mocks.restoreRegion.mockReset();
    const compressor = vi.spyOn(zipCompressor, "compressZipEntries");
    const excessiveRegions: AtlasDocument = {
      pages: atlas.pages,
      regions: Array.from({ length: 4_097 }, (_, index) => ({
        ...atlas.regions[0]!,
        name: `tiny-${index}`,
        index,
        packedWidth: 1,
        packedHeight: 1,
        originalWidth: 1,
        originalHeight: 1,
        offsetLeft: 0,
        offsetBottom: 0,
      })),
    };

    await expect(exportAllRegions({
      atlas: excessiveRegions,
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale: { ...inferredScale, restoreMultiplier: 1 },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn())).rejects.toThrow(/Region.*4096|数量预算/);

    expect(mocks.restoreRegion).not.toHaveBeenCalled();
    expect(compressor).not.toHaveBeenCalled();
    compressor.mockRestore();
  });

  it("同名 Region 只关联 stable key 对应 evidence/warning，不做二次方复制", async () => {
    mocks.restoreRegion.mockReset();
    mocks.restoreRegion.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), width: 1, height: 1, plan: {},
    });
    const count = 64;
    const repeatedRegions = Array.from({ length: count }, (_, index) => ({
      ...atlas.regions[0]!,
      name: "same-name",
      index,
      packedWidth: 1,
      packedHeight: 1,
      originalWidth: 1,
      originalHeight: 1,
      offsetLeft: 0,
      offsetBottom: 0,
    }));
    const evidence = repeatedRegions.map((region) => ({
      regionKey: `${region.name}#${region.index}`,
      regionName: region.name,
      widthMultiplier: 1,
      heightMultiplier: 1,
      multiplier: 1,
      aspectRatioError: 0,
      weight: 1,
      included: true,
      warnings: [`warning-${region.index}`],
    }));

    const result = await exportAllRegions({
      atlas: { ...atlas, regions: repeatedRegions },
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale: {
        ...inferredScale,
        evidence,
        warnings: evidence.map((item) => item.warnings[0]!),
      },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn());

    for (let index = 0; index < count; index += 1) {
      expect(result.report.regions[index]!.inferenceEvidence.map((item) => item.regionKey))
        .toEqual([`same-name#${index}`]);
      expect(result.report.regions[index]!.warnings).toEqual([`warning-${index}`]);
    }
  });

  it("在恢复与 JSON.stringify 前拒绝报告文本元数据预算超限", async () => {
    mocks.restoreRegion.mockReset();
    const compressor = vi.spyOn(zipCompressor, "compressZipEntries");

    await expect(exportAllRegions({
      atlas: { ...atlas, regions: atlas.regions.slice(0, 1) },
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale: {
        ...inferredScale,
        warnings: ["x".repeat(16 * 1024 * 1024 + 1)],
      },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn())).rejects.toThrow(/报告.*16 MiB|报告.*文本.*预算/);

    expect(mocks.restoreRegion).not.toHaveBeenCalled();
    expect(compressor).not.toHaveBeenCalled();
    compressor.mockRestore();
  });

  it("累计 PNG entry 声明大小超限时在读取 ArrayBuffer 和压缩前拒绝", async () => {
    mocks.restoreRegion.mockReset();
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    mocks.restoreRegion.mockResolvedValue({
      blob: { size: 256 * 1024 * 1024 + 1, arrayBuffer } as unknown as Blob,
      width: 1,
      height: 1,
      plan: {},
    });
    const compressor = vi.spyOn(zipCompressor, "compressZipEntries");

    await expect(exportAllRegions({
      atlas: { ...atlas, regions: atlas.regions.slice(0, 1) },
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale: { ...inferredScale, restoreMultiplier: 1 },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn())).rejects.toThrow(/PNG|entry|256 MiB|压缩.*预算/);

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(compressor).not.toHaveBeenCalled();
    compressor.mockRestore();
  });

  it("在恢复任何 Region 前拒绝累计 PMA 页面原始像素超过通用 128 MiB 预算", async () => {
    mocks.restoreRegion.mockReset();
    const pages = Array.from({ length: 3 }, (_, index) => ({
      name: `pma-${index}.png`, width: 4_096, height: 4_096, pma: true, custom: {},
    }));
    const pmaAtlas: AtlasDocument = {
      pages,
      regions: pages.map((page, index) => ({
        ...atlas.regions[0]!,
        name: `pma-${index}`,
        pageName: page.name,
        index,
        packedWidth: 1,
        packedHeight: 1,
        originalWidth: 1,
        originalHeight: 1,
        offsetLeft: 0,
        offsetBottom: 0,
      })),
    };
    const textures = new Map(pages.map((page) => [
      page.name,
      { width: page.width, height: page.height } as ImageBitmap,
    ]));

    await expect(exportAllRegions({
      atlas: pmaAtlas,
      textures,
      inferredScale: { ...inferredScale, restoreMultiplier: 1 },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.3",
    }, vi.fn())).rejects.toThrow(/原始像素.*128 MiB|原始像素.*内存预算/);

    expect(mocks.restoreRegion).not.toHaveBeenCalled();
  });

  it("在恢复任何 Region 前也拒绝累计 Straight 页面原始像素超过 128 MiB", async () => {
    mocks.restoreRegion.mockReset();
    const pages = Array.from({ length: 3 }, (_, index) => ({
      name: `straight-${index}.png`, width: 4_096, height: 4_096, pma: false, custom: {},
    }));
    const straightAtlas: AtlasDocument = {
      pages,
      regions: pages.map((page, index) => ({
        ...atlas.regions[0]!,
        name: `straight-${index}`,
        pageName: page.name,
        index,
        packedWidth: 1,
        packedHeight: 1,
        originalWidth: 1,
        originalHeight: 1,
        offsetLeft: 0,
        offsetBottom: 0,
      })),
    };
    const textures = new Map(pages.map((page) => [
      page.name,
      { width: page.width, height: page.height } as ImageBitmap,
    ]));

    await expect(exportAllRegions({
      atlas: straightAtlas,
      textures,
      inferredScale: { ...inferredScale, restoreMultiplier: 1 },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.3",
    }, vi.fn())).rejects.toThrow(/原始像素.*128 MiB|原始像素.*内存预算/);

    expect(mocks.restoreRegion).not.toHaveBeenCalled();
  });

  it("一个导出批次复用同一 PMA 页面缓存，并在结束后立即清空", async () => {
    mocks.restoreRegion.mockReset();
    let cache: Map<ImageBitmap, unknown> | undefined;
    mocks.restoreRegion.mockImplementation(async (input: {
      texturePage: ImageBitmap;
      texturePixelCache?: Map<ImageBitmap, unknown>;
    }) => {
      expect(input.texturePixelCache).toBeInstanceOf(Map);
      if (!cache) cache = input.texturePixelCache;
      expect(input.texturePixelCache).toBe(cache);
      cache!.set(input.texturePage, { data: new Uint8ClampedArray(4), width: 1, height: 1 });
      return { blob: new Blob(["png"], { type: "image/png" }), width: 1, height: 1, plan: {} };
    });
    const texture = { width: 2, height: 2 } as ImageBitmap;

    await exportAllRegions({
      atlas: {
        pages: [{ name: "page.png", width: 2, height: 2, pma: true, custom: {} }],
        regions: atlas.regions.slice(0, 2).map((region) => ({
          ...region, packedWidth: 1, packedHeight: 1, originalWidth: 1, originalHeight: 1,
        })),
      },
      textures: new Map([["page.png", texture]]),
      inferredScale: { ...inferredScale, restoreMultiplier: 1 },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.3",
    }, vi.fn());

    expect(cache?.size).toBe(0);
  });

  it("4.x 多页按各自 Atlas pma 转换，并在报告记录 Alpha 来源", async () => {
    mocks.restoreRegion.mockReset();
    mocks.restoreRegion.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), width: 2, height: 2, plan: {},
    });
    const mixedAtlas: AtlasDocument = {
      pages: [
        { name: "pma.png", width: 2, height: 2, pma: true, custom: {} },
        { name: "straight.png", width: 2, height: 2, pma: false, custom: {} },
      ],
      regions: [
        { ...atlas.regions[0]!, name: "pma", pageName: "pma.png", packedWidth: 2, packedHeight: 2, originalWidth: 2, originalHeight: 2 },
        { ...atlas.regions[0]!, name: "straight", pageName: "straight.png", packedWidth: 2, packedHeight: 2, originalWidth: 2, originalHeight: 2 },
      ],
    };

    const result = await exportAllRegions({
      atlas: mixedAtlas,
      textures: new Map([
        ["pma.png", { width: 2, height: 2 } as ImageBitmap],
        ["straight.png", { width: 2, height: 2 } as ImageBitmap],
      ]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.3",
    }, vi.fn());

    expect(mocks.restoreRegion).toHaveBeenNthCalledWith(1, expect.objectContaining({ sourceAlphaMode: "premultiplied" }));
    expect(mocks.restoreRegion).toHaveBeenNthCalledWith(2, expect.objectContaining({ sourceAlphaMode: "straight" }));
    expect(result.report.regions.map(({ alpha }) => alpha)).toEqual([
      { source: "atlas-page-pma", inputMode: "premultiplied", conversion: "pma-to-straight" },
      { source: "atlas-page-pma", inputMode: "straight", conversion: "none" },
    ]);
  });

  it("3.x 必须使用用户确认的 Alpha 模式，并与 50% 恢复倍率一起报告", async () => {
    mocks.restoreRegion.mockReset();
    mocks.restoreRegion.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), width: 40, height: 48, plan: {},
    });
    const legacyAtlas = { ...atlas, regions: atlas.regions.slice(0, 1) };

    await expect(exportAllRegions({
      atlas: legacyAtlas,
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "3.8",
    }, vi.fn())).rejects.toThrow(/Alpha.*确认/);

    const result = await exportAllRegions({
      atlas: legacyAtlas,
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "3.8",
      legacyAlphaMode: "premultiplied",
    }, vi.fn());

    expect(mocks.restoreRegion).toHaveBeenLastCalledWith(expect.objectContaining({
      restoreMultiplier: 2,
      sourceAlphaMode: "premultiplied",
    }));
    expect(result.report.regions[0]).toMatchObject({
      finalMultiplier: 2,
      alpha: { source: "user-confirmed-legacy", inputMode: "premultiplied", conversion: "pma-to-straight" },
    });
  });

  it("让每个 PNG 与唯一报告项对应，失败项不阻止其余 Region", async () => {
    mocks.restoreRegion
      .mockResolvedValueOnce({ blob: new Blob(["first"], { type: "image/png" }), width: 40, height: 48, plan: {} })
      .mockResolvedValueOnce({ blob: new Blob(["second"], { type: "image/png" }), width: 20, height: 24, plan: {} })
      .mockRejectedValueOnce(new Error("Region「broken」的裁切范围超出纹理页 page.png（64×64）"));
    const progress = vi.fn();

    const result = await exportAllRegions({
      atlas,
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1.25,
      regionOverrides: new Map([["body/head#1", 3]]),
      sourceVersion: "4.2",
    }, progress);

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const pngPaths = Object.keys(zip.files).filter((path) => path.endsWith(".png")).sort();
    const report = JSON.parse(await zip.file("export-report.json")!.async("text"));

    expect(pngPaths).toEqual(["body/head-2.png", "body/head.png"]);
    expect(report.summary).toEqual({ successful: 2, skipped: 1, failed: 1, total: 4 });
    expect(report.regions).toHaveLength(4);
    expect(report.regions.filter((entry: { status: string }) => entry.status === "success").map((entry: { zipPath: string }) => entry.zipPath).sort()).toEqual(pngPaths);
    expect(report.regions.find((entry: { regionName: string }) => entry.regionName === "broken")).toMatchObject({ status: "failed", error: expect.stringContaining("裁切范围超出纹理页") });
    expect(report.regions.find((entry: { regionName: string }) => entry.regionName === "missing-page")).toMatchObject({ status: "skipped" });
    expect(report.regions[1]).toMatchObject({ finalMultiplier: 3, userOverrideMultiplier: 3 });
    expect(result.report).toEqual(report);
    expect(result.issues).toEqual([
      {
        code: "REGION_OUT_OF_BOUNDS",
        severity: "warning",
        subject: "Region「broken」",
        details: ["Region「broken」的裁切范围超出纹理页 page.png（64×64）"],
      },
      {
        code: "MISSING_TEXTURE_PAGE",
        severity: "warning",
        subject: "Region「missing-page」",
        details: ["缺少纹理页「missing.png」。"],
      },
    ]);
    expect(progress.mock.calls).toEqual([
      [1, 4, "restoring"], [2, 4, "restoring"], [3, 4, "restoring"], [4, 4, "restoring"],
      [4, 4, "compressing"],
    ]);
  });

  it("在自动后缀与真实 Region 名称碰撞时保持 PNG 与报告路径唯一", async () => {
    mocks.restoreRegion.mockReset();
    mocks.restoreRegion.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), width: 20, height: 24, plan: {},
    });
    const collisionAtlas: AtlasDocument = {
      pages: atlas.pages,
      regions: ["head", "head", "head-2"].map((name, index) => ({
        ...atlas.regions[0]!, name, index,
      })),
    };

    const result = await exportAllRegions({
      atlas: collisionAtlas,
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn());
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const report = JSON.parse(await zip.file("export-report.json")!.async("text"));
    const pngPaths = Object.keys(zip.files).filter((path) => path.endsWith(".png")).sort();

    expect(pngPaths).toEqual(["head-2-2.png", "head-2.png", "head.png"]);
    expect(new Set(report.regions.map((entry: { zipPath: string }) => entry.zipPath)).size).toBe(3);
  });

  it("导出查找纹理时使用规范化 Atlas 页面身份", async () => {
    mocks.restoreRegion.mockReset();
    mocks.restoreRegion.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), width: 20, height: 24, plan: {},
    });
    const normalizedAtlas: AtlasDocument = {
      pages: [{ ...atlas.pages[0]!, name: "page.png" }],
      regions: [{ ...atlas.regions[0]!, pageName: ".\\./page.png" }],
    };

    const result = await exportAllRegions({
      atlas: normalizedAtlas,
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn());

    expect(result.report.summary.successful).toBe(1);
    expect(result.report.regions[0]).toMatchObject({ sourceTexturePage: "page.png", status: "success" });
  });

  it("把补齐后的页面框交给恢复层，并在报告中记录该 Region 用到的透明补齐量", async () => {
    mocks.restoreRegion.mockReset();
    mocks.restoreRegion.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), width: 20, height: 24, plan: {},
    });
    const paddedAtlas: AtlasDocument = {
      pages: [{ name: "page.png", width: 66, height: 68, imageWidth: 64, imageHeight: 65, custom: {} }],
      regions: [
        { ...atlas.regions[0]!, name: "edge", index: 0, x: 56, y: 56, packedWidth: 10, packedHeight: 12 },
        { ...atlas.regions[0]!, name: "inside", index: 1, x: 0, y: 0, packedWidth: 10, packedHeight: 12 },
      ],
    };

    const result = await exportAllRegions({
      atlas: paddedAtlas,
      textures: new Map([["page.png", { width: 64, height: 65 } as ImageBitmap]]),
      inferredScale: { ...inferredScale, restoreMultiplier: 1 },
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn());

    expect(mocks.restoreRegion).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceSize: { width: 66, height: 68 },
    }));
    expect(mocks.restoreRegion).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceSize: { width: 66, height: 68 },
    }));
    expect(result.report.regions[0]).toMatchObject({
      regionName: "edge",
      status: "success",
      sourcePadding: { right: 2, bottom: 3 },
    });
    expect(result.report.regions[1]).toMatchObject({ regionName: "inside", status: "success" });
    expect(result.report.regions[1]).not.toHaveProperty("sourcePadding");
  });

  it("取消后不再恢复下一项，也不返回残缺 ZIP", async () => {
    mocks.restoreRegion.mockReset();
    mocks.restoreRegion.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), width: 20, height: 24, plan: {},
    });
    const controller = new AbortController();
    const progress = vi.fn((done: number) => {
      if (done === 1) controller.abort();
    });

    await expect(exportAllRegions({
      atlas: { ...atlas, regions: atlas.regions.slice(0, 2) },
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, progress, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.restoreRegion).toHaveBeenCalledTimes(1);
    expect(mocks.restoreRegion).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it("把调用方的同一个 AbortSignal 传到压缩层并传播压缩中取消", async () => {
    mocks.restoreRegion.mockReset();
    mocks.restoreRegion.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), width: 20, height: 24, plan: {},
    });
    const controller = new AbortController();
    let compressorSignal: AbortSignal | undefined;
    const compressor = vi.spyOn(zipCompressor, "compressZipEntries").mockImplementation(async (_entries, options = {}) => {
      compressorSignal = options.signal;
      if (!compressorSignal) throw new Error("missing AbortSignal");
      return await new Promise<Blob>((_resolve, reject) => {
        compressorSignal!.addEventListener("abort", () => {
          const error = new Error("导出已取消");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    });

    const pending = exportAllRegions({
      atlas: { ...atlas, regions: atlas.regions.slice(0, 1) },
      textures: new Map([["page.png", { width: 64, height: 64 } as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
      sourceVersion: "4.2",
    }, vi.fn(), { signal: controller.signal });
    await vi.waitFor(() => expect(compressor).toHaveBeenCalledTimes(1));
    expect(compressorSignal).toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    compressor.mockRestore();
  });
});
