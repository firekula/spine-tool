import JSZip from "jszip";
import { restoreRegion } from "@/lib/atlas/restore-region";
import type { AtlasDocument, AtlasRegion } from "@/lib/atlas/types";
import type { ScaleEvidence, ScaleInference } from "@/lib/spine/scale-inference";
import { createZipPathAllocator } from "@/lib/export/safe-path";

export interface ExportAllInput {
  atlas: AtlasDocument;
  textures: Map<string, ImageBitmap>;
  inferredScale: ScaleInference;
  /** A user multiplier applied after the automatically inferred restore multiplier. */
  globalMultiplier: number;
  /** Region keys are `${region.name}#${region.index}`; a plain Region name is accepted as a fallback. */
  regionOverrides: Map<string, number>;
}

export type ExportRegionStatus = "success" | "skipped" | "failed";

export interface ExportRegionReport {
  regionKey: string;
  regionName: string;
  sourceTexturePage: string;
  atlas: {
    crop: { x: number; y: number; width: number; height: number };
    rotation: number;
  };
  originalSize: { width: number; height: number };
  transparentPadding: { left: number; bottom: number; right: number; top: number };
  automaticMultiplier: number;
  globalMultiplier: number;
  userOverrideMultiplier: number | null;
  finalMultiplier: number | null;
  inferenceEvidence: ScaleEvidence[];
  confidence: ScaleInference["confidence"];
  warnings: string[];
  status: ExportRegionStatus;
  zipPath: string | null;
  outputSize: { width: number; height: number } | null;
  error: string | null;
}

export interface ExportReport {
  version: 1;
  inferredScale: ScaleInference;
  summary: { successful: number; skipped: number; failed: number; total: number };
  regions: ExportRegionReport[];
}

function regionKey(region: AtlasRegion): string {
  return `${region.name}#${region.index}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "恢复 Region 时发生未知错误。";
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function evidenceForRegion(inferredScale: ScaleInference, name: string): ScaleEvidence[] {
  return inferredScale.evidence.filter((evidence) => evidence.regionName === name);
}

function baseReport(region: AtlasRegion, input: ExportAllInput, override: number | null): ExportRegionReport {
  const unrotatedWidth = region.rotation === 90 || region.rotation === 270
    ? region.packedHeight
    : region.packedWidth;
  const unrotatedHeight = region.rotation === 90 || region.rotation === 270
    ? region.packedWidth
    : region.packedHeight;
  return {
    regionKey: regionKey(region),
    regionName: region.name,
    sourceTexturePage: region.pageName,
    atlas: {
      crop: { x: region.x, y: region.y, width: region.packedWidth, height: region.packedHeight },
      rotation: region.rotation,
    },
    originalSize: { width: region.originalWidth, height: region.originalHeight },
    transparentPadding: {
      left: region.offsetLeft,
      bottom: region.offsetBottom,
      right: region.originalWidth - region.offsetLeft - unrotatedWidth,
      top: region.originalHeight - region.offsetBottom - unrotatedHeight,
    },
    automaticMultiplier: input.inferredScale.restoreMultiplier,
    globalMultiplier: input.globalMultiplier,
    userOverrideMultiplier: override,
    finalMultiplier: null,
    inferenceEvidence: evidenceForRegion(input.inferredScale, region.name),
    confidence: input.inferredScale.confidence,
    warnings: [...input.inferredScale.warnings],
    status: "failed",
    zipPath: null,
    outputSize: null,
    error: null,
  };
}

/** Restores every Region independently and packages successes with an audit report. */
export async function exportAllRegions(
  input: ExportAllInput,
  onProgress: (done: number, total: number) => void,
): Promise<Blob> {
  if (!isPositiveFinite(input.globalMultiplier)) {
    throw new Error("全局倍率必须是大于 0 的有限数值。");
  }

  const zip = new JSZip();
  const allocator = createZipPathAllocator();
  const reports: ExportRegionReport[] = [];
  const total = input.atlas.regions.length;

  for (let position = 0; position < total; position += 1) {
    const region = input.atlas.regions[position]!;
    const override = input.regionOverrides.get(regionKey(region))
      ?? input.regionOverrides.get(region.name)
      ?? null;
    const report = baseReport(region, input, override);
    const reservedZipPath = allocator.allocate(region.name);

    try {
      const texture = input.textures.get(region.pageName);
      if (!texture) {
        report.status = "skipped";
        report.error = `缺少纹理页「${region.pageName}」。`;
      } else {
        const finalMultiplier = override ?? input.inferredScale.restoreMultiplier * input.globalMultiplier;
        report.finalMultiplier = finalMultiplier;
        if (!isPositiveFinite(finalMultiplier)) {
          throw new Error("最终恢复倍率必须是大于 0 的有限数值。");
        }
        const restored = await restoreRegion({ region, texturePage: texture, restoreMultiplier: finalMultiplier });
        // ArrayBuffer works in browsers and in the Node test runner; passing a
        // browser Blob directly is not supported by every JSZip build.
        zip.file(reservedZipPath, await restored.blob.arrayBuffer());
        report.status = "success";
        report.finalMultiplier = finalMultiplier;
        report.zipPath = reservedZipPath;
        report.outputSize = { width: restored.width, height: restored.height };
      }
    } catch (error) {
      report.status = "failed";
      report.error = errorMessage(error);
    }

    reports.push(report);
    onProgress(position + 1, total);
  }

  const summary = reports.reduce(
    (counts, report) => {
      if (report.status === "success") counts.successful += 1;
      else if (report.status === "skipped") counts.skipped += 1;
      else counts.failed += 1;
      return counts;
    },
    { successful: 0, skipped: 0, failed: 0, total },
  );
  const report: ExportReport = { version: 1, inferredScale: input.inferredScale, summary, regions: reports };
  zip.file("export-report.json", JSON.stringify(report, null, 2));
  return zip.generateAsync({ type: "blob" });
}
