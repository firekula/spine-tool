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
      .mockRejectedValueOnce(new Error("裁切范围无效"));
    const progress = vi.fn();

    const blob = await exportAllRegions({
      atlas,
      textures: new Map([["page.png", {} as ImageBitmap]]),
      inferredScale,
      globalMultiplier: 1.25,
      regionOverrides: new Map([["body/head#1", 3]]),
    }, progress);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const pngPaths = Object.keys(zip.files).filter((path) => path.endsWith(".png")).sort();
    const report = JSON.parse(await zip.file("export-report.json")!.async("text"));

    expect(pngPaths).toEqual(["body/head-2.png", "body/head.png"]);
    expect(report.summary).toEqual({ successful: 2, skipped: 1, failed: 1, total: 4 });
    expect(report.regions).toHaveLength(4);
    expect(report.regions.filter((entry: { status: string }) => entry.status === "success").map((entry: { zipPath: string }) => entry.zipPath).sort()).toEqual(pngPaths);
    expect(report.regions.find((entry: { regionName: string }) => entry.regionName === "broken")).toMatchObject({ status: "failed", error: "裁切范围无效" });
    expect(report.regions.find((entry: { regionName: string }) => entry.regionName === "missing-page")).toMatchObject({ status: "skipped" });
    expect(report.regions[1]).toMatchObject({ finalMultiplier: 3, userOverrideMultiplier: 3 });
    expect(progress.mock.calls).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });
});
