import JSZip from "jszip";
import { normalizeAtlasPageMap, normalizeAtlasPageName } from "@/lib/atlas/page-name";
import { restoreRegion } from "@/lib/atlas/restore-region";
import type { AtlasDocument, AtlasRegion } from "@/lib/atlas/types";
import type { ScaleEvidence, ScaleInference } from "@/lib/spine/scale-inference";
import { createZipPathAllocator } from "@/lib/export/safe-path";
import type { AppIssue } from "@/lib/issues/types";

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

export interface ExportAllResult {
  blob: Blob;
  report: ExportReport;
  issues: AppIssue[];
}

export interface ExportAllOptions {
  signal?: AbortSignal;
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

function abortError(): Error {
  const error = new Error("导出已取消");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function issueForReport(report: ExportRegionReport): AppIssue | null {
  if (report.status === "success" || !report.error) return null;
  const code = report.status === "skipped"
    ? "MISSING_TEXTURE_PAGE"
    : /裁切范围超出纹理页/.test(report.error)
      ? "REGION_OUT_OF_BOUNDS"
      : "REGION_EXPORT_FAILED";
  return {
    code,
    severity: "warning",
    subject: `Region「${report.regionName}」`,
    details: [report.error],
  };
}

function evidenceForRegion(inferredScale: ScaleInference, name: string): ScaleEvidence[] {
  return inferredScale.evidence.filter((evidence) => evidence.regionName === name);
}

function baseReport(region: AtlasRegion, input: ExportAllInput, override: number | null): ExportRegionReport {
  const pageName = normalizeAtlasPageName(region.pageName);
  const unrotatedWidth = region.rotation === 90 || region.rotation === 270
    ? region.packedHeight
    : region.packedWidth;
  const unrotatedHeight = region.rotation === 90 || region.rotation === 270
    ? region.packedWidth
    : region.packedHeight;
  return {
    regionKey: regionKey(region),
    regionName: region.name,
    sourceTexturePage: pageName,
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
  options: ExportAllOptions = {},
): Promise<ExportAllResult> {
  throwIfAborted(options.signal);
  if (!isPositiveFinite(input.globalMultiplier)) {
    throw new Error("全局倍率必须是大于 0 的有限数值。");
  }

  const zip = new JSZip();
  const allocator = createZipPathAllocator();
  const textures = normalizeAtlasPageMap(input.textures);
  const reports: ExportRegionReport[] = [];
  const total = input.atlas.regions.length;

  for (let position = 0; position < total; position += 1) {
    throwIfAborted(options.signal);
    const rawRegion = input.atlas.regions[position]!;
    const region = {
      ...rawRegion,
      pageName: normalizeAtlasPageName(rawRegion.pageName),
    };
    const override = input.regionOverrides.get(regionKey(region))
      ?? input.regionOverrides.get(region.name)
      ?? null;
    const report = baseReport(region, input, override);
    const reservedZipPath = allocator.allocate(region.name);

    try {
      const texture = textures.get(region.pageName);
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
        throwIfAborted(options.signal);
        // ArrayBuffer works in browsers and in the Node test runner; passing a
        // browser Blob directly is not supported by every JSZip build.
        const pngBytes = await restored.blob.arrayBuffer();
        throwIfAborted(options.signal);
        zip.file(reservedZipPath, pngBytes);
        report.status = "success";
        report.finalMultiplier = finalMultiplier;
        report.zipPath = reservedZipPath;
        report.outputSize = { width: restored.width, height: restored.height };
      }
    } catch (error) {
      throwIfAborted(options.signal);
      report.status = "failed";
      report.error = errorMessage(error);
    }

    reports.push(report);
    throwIfAborted(options.signal);
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
  const issues = reports.flatMap((entry) => {
    const issue = issueForReport(entry);
    return issue ? [issue] : [];
  });
  zip.file("export-report.json", JSON.stringify(report, null, 2));
  throwIfAborted(options.signal);
  const blob = await zip.generateAsync({ type: "blob" });
  throwIfAborted(options.signal);
  return { blob, report, issues };
}
