import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { AtlasDocument } from "@/lib/atlas/types";
import type { ScaleInference } from "@/lib/spine/scale-inference";

const mocks = vi.hoisted(() => ({ restoreRegion: vi.fn() }));
vi.mock("@/lib/atlas/restore-region", () => ({ restoreRegion: mocks.restoreRegion }));
import { exportAllRegions } from "@/lib/export/export-zip";

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
  it("让每个 PNG 与唯一报告项对应，失败项不阻止其余 Region", async () => {
    mocks.restoreRegion
      .mockResolvedValueOnce({ blob: new Blob(["first"], { type: "image/png" }), width: 40, height: 48, plan: {} })
      .mockResolvedValueOnce({ blob: new Blob(["second"], { type: "image/png" }), width: 20, height: 24, plan: {} })
      .mockRejectedValueOnce(new Error("Region「broken」的裁切范围超出纹理页 page.png（64×64）"));
    const progress = vi.fn();

    const result = await exportAllRegions({
      atlas,
      textures: new Map([["page.png", {} as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1.25,
      regionOverrides: new Map([["body/head#1", 3]]),
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
    expect(progress.mock.calls).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
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
      textures: new Map([["page.png", {} as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
    }, vi.fn());
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const report = JSON.parse(await zip.file("export-report.json")!.async("text"));
    const pngPaths = Object.keys(zip.files).filter((path) => path.endsWith(".png")).sort();

    expect(pngPaths).toEqual(["head-2-2.png", "head-2.png", "head.png"]);
    expect(new Set(report.regions.map((entry: { zipPath: string }) => entry.zipPath)).size).toBe(3);
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
      textures: new Map([["page.png", {} as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1,
      regionOverrides: new Map(),
    }, progress, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.restoreRegion).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledTimes(1);
  });
});
