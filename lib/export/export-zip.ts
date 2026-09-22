import { normalizeAtlasPageMap, normalizeAtlasPageName } from "@/lib/atlas/page-name";
import { unionPageSize } from "@/lib/atlas/page-padding";
import {
  assertTextureReadBudget,
  restoreRegion,
  type TexturePixelCache,
} from "@/lib/atlas/restore-region";
import { planRegionRestore, type PixelSize } from "@/lib/atlas/restore-math";
import type { AtlasDocument, AtlasPage, AtlasRegion } from "@/lib/atlas/types";
import { MAX_ATLAS_REGION_COUNT } from "@/lib/atlas/limits";
import type { ScaleEvidence, ScaleInference } from "@/lib/spine/scale-inference";
import { createZipPathAllocator } from "@/lib/export/safe-path";
import type { AppIssue } from "@/lib/issues/types";
import type { TextureAlphaMode } from "@/lib/spine/bridge-types";
import type { SupportedSpineVersion } from "@/lib/spine/runtime-registry";
import { compressZipEntries, type ZipCompressionEntry } from "@/lib/export/zip-compressor";

export interface ExportAllInput {
  atlas: AtlasDocument;
  textures: Map<string, ImageBitmap>;
  inferredScale: ScaleInference;
  /** A user multiplier applied after the automatically inferred restore multiplier. */
  globalMultiplier: number;
  /** Region keys are `${region.name}#${region.index}`; a plain Region name is accepted as a fallback. */
  regionOverrides: Map<string, number>;
  /** Detected source-data line, used only to enforce legacy Alpha confirmation. */
  sourceVersion: SupportedSpineVersion | "3.x" | null;
  /** Explicit user confirmation for Spine 3.5--3.8 texture storage. */
  legacyAlphaMode?: TextureAlphaMode | null;
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
  alpha: {
    source: "atlas-page-pma" | "user-confirmed-legacy" | "atlas-default-straight";
    inputMode: TextureAlphaMode;
    conversion: "pma-to-straight" | "none";
  };
  originalSize: { width: number; height: number };
  transparentPadding: { left: number; bottom: number; right: number; top: number };
  /**
   * Transparent columns and rows the Atlas page box adds beyond the decoded PNG
   * and this Region's packed rectangle reaches into. Absent when the PNG covers
   * the whole packed rectangle.
   */
  sourcePadding?: { right: number; bottom: number };
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

export type ExportProgressPhase = "restoring" | "compressing";

export const MAX_EXPORT_RGBA_BYTES = 256 * 1024 * 1024;
export const MAX_EXPORT_RAW_TEXTURE_RGBA_BYTES = 128 * 1024 * 1024;
export const MAX_EXPORT_ENCODED_ENTRY_BYTES = 256 * 1024 * 1024;
export const MAX_EXPORT_REPORT_TEXT_CODE_UNITS = 16 * 1024 * 1024;
export const MAX_EXPORT_INFERENCE_ITEMS = 4_096;

class ExportBatchBudgetError extends Error {}

function reserveEncodedEntryBytes(current: number, bytes: number, label: string): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new ExportBatchBudgetError(`${label} 的编码字节数无效。`);
  }
  const next = current + bytes;
  if (!Number.isSafeInteger(next) || next > MAX_EXPORT_ENCODED_ENTRY_BYTES) {
    throw new ExportBatchBudgetError(
      `整批 PNG 与报告 entry 在 ZIP 压缩前超过 ${MAX_EXPORT_ENCODED_ENTRY_BYTES / 1024 / 1024} MiB 内存预算，请分批导出。`,
    );
  }
  return next;
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

interface EvidenceIndex {
  byKey: Map<string, ScaleEvidence[]>;
  legacyByName: Map<string, ScaleEvidence[]>;
}

function appendEvidence(index: Map<string, ScaleEvidence[]>, key: string, evidence: ScaleEvidence): void {
  const current = index.get(key);
  if (current) current.push(evidence);
  else index.set(key, [evidence]);
}

function createEvidenceIndex(inferredScale: ScaleInference): EvidenceIndex {
  const byKey = new Map<string, ScaleEvidence[]>();
  const legacyByName = new Map<string, ScaleEvidence[]>();
  for (const evidence of inferredScale.evidence) {
    if (evidence.regionKey) appendEvidence(byKey, evidence.regionKey, evidence);
    else appendEvidence(legacyByName, evidence.regionName, evidence);
  }
  return { byKey, legacyByName };
}

function evidenceForRegion(index: EvidenceIndex, region: AtlasRegion): ScaleEvidence[] {
  return index.byKey.get(regionKey(region)) ?? index.legacyByName.get(region.name) ?? [];
}

function reserveReportText(current: number, value: string | undefined): number {
  if (value === undefined) return current;
  const next = current + value.length;
  if (!Number.isSafeInteger(next) || next > MAX_EXPORT_REPORT_TEXT_CODE_UNITS) {
    throw new ExportBatchBudgetError(
      `导出报告文本超过 ${MAX_EXPORT_REPORT_TEXT_CODE_UNITS / 1024 / 1024} MiB 代码单元安全预算，请拆分 Atlas 后重试。`,
    );
  }
  return next;
}

function assertReportInputBudget(input: ExportAllInput): void {
  const { evidence, warnings, pageEvidence = [] } = input.inferredScale;
  if (
    evidence.length > MAX_EXPORT_INFERENCE_ITEMS
    || warnings.length > MAX_EXPORT_INFERENCE_ITEMS
    || pageEvidence.length > 64
  ) {
    throw new ExportBatchBudgetError("导出报告的倍率证据或警告项目超过安全预算，请拆分 Atlas 后重试。");
  }
  let textUnits = 0;
  for (const region of input.atlas.regions) {
    textUnits = reserveReportText(textUnits, region.name);
    textUnits = reserveReportText(textUnits, region.pageName);
  }
  for (const item of evidence) {
    textUnits = reserveReportText(textUnits, item.regionKey);
    textUnits = reserveReportText(textUnits, item.regionName);
    if ((item.warnings?.length ?? 0) > MAX_EXPORT_INFERENCE_ITEMS) {
      throw new ExportBatchBudgetError("导出报告的单项倍率警告超过安全预算。");
    }
    for (const warning of item.warnings ?? []) textUnits = reserveReportText(textUnits, warning);
  }
  for (const warning of warnings) textUnits = reserveReportText(textUnits, warning);
  for (const item of pageEvidence) textUnits = reserveReportText(textUnits, item.pageName);
}

function sanitizedScaleInference(input: ScaleInference): ScaleInference {
  return {
    restoreMultiplier: input.restoreMultiplier,
    exportPercent: input.exportPercent,
    confidence: input.confidence,
    sampleCount: input.sampleCount,
    evidence: input.evidence.map((item) => ({
      ...(item.regionKey ? { regionKey: item.regionKey } : {}),
      regionName: item.regionName,
      widthMultiplier: item.widthMultiplier,
      heightMultiplier: item.heightMultiplier,
      multiplier: item.multiplier,
      aspectRatioError: item.aspectRatioError,
      weight: item.weight,
      included: item.included,
      ...(item.warnings ? { warnings: [...item.warnings] } : {}),
    })),
    pageEvidence: (input.pageEvidence ?? []).map((item) => ({ ...item })),
    requiresConfirmation: Boolean(input.requiresConfirmation),
    warnings: [...input.warnings],
  };
}

type ExportAlpha = ExportRegionReport["alpha"];

function findPage(input: ExportAllInput, pageName: string): AtlasPage | undefined {
  return input.atlas.pages.find((candidate) => normalizeAtlasPageName(candidate.name) === pageName);
}

/**
 * Pixel box the export reads a Region from: the decoded PNG widened to the page
 * size the Atlas declares, so a PNG trimmed at the right/bottom still restores
 * complete Regions with transparent padding instead of failing.
 */
function sourcePageSize(texture: ImageBitmap, page: AtlasPage | undefined): PixelSize {
  return unionPageSize(
    { width: texture.width, height: texture.height },
    page ? { width: page.width, height: page.height } : null,
  );
}

function sourcePaddingFor(region: AtlasRegion, page: AtlasPage | undefined): { right: number; bottom: number } | null {
  const { imageWidth, imageHeight } = page ?? {};
  if (typeof imageWidth !== "number" || typeof imageHeight !== "number") return null;
  const right = Math.max(0, region.x + region.packedWidth - imageWidth);
  const bottom = Math.max(0, region.y + region.packedHeight - imageHeight);
  return right > 0 || bottom > 0 ? { right, bottom } : null;
}

function alphaForPage(input: ExportAllInput, page: AtlasPage | undefined): ExportAlpha {
  const legacy = input.sourceVersion?.startsWith("3.") ?? false;
  if (legacy) {
    if (!input.legacyAlphaMode) {
      throw new Error("Spine 3.x 纹理 Alpha 模式必须由用户明确确认后才能导出。");
    }
    return {
      source: "user-confirmed-legacy",
      inputMode: input.legacyAlphaMode,
      conversion: input.legacyAlphaMode === "premultiplied" ? "pma-to-straight" : "none",
    };
  }
  if (page?.pma !== undefined) {
    return {
      source: "atlas-page-pma",
      inputMode: page.pma ? "premultiplied" : "straight",
      conversion: page.pma ? "pma-to-straight" : "none",
    };
  }
  return { source: "atlas-default-straight", inputMode: "straight", conversion: "none" };
}

function baseReport(
  region: AtlasRegion,
  input: ExportAllInput,
  override: number | null,
  evidenceIndex: EvidenceIndex,
): ExportRegionReport {
  const pageName = normalizeAtlasPageName(region.pageName);
  const page = findPage(input, pageName);
  const alpha = alphaForPage(input, page);
  const sourcePadding = sourcePaddingFor(region, page);
  const unrotatedWidth = region.rotation === 90 || region.rotation === 270
    ? region.packedHeight
    : region.packedWidth;
  const unrotatedHeight = region.rotation === 90 || region.rotation === 270
    ? region.packedWidth
    : region.packedHeight;
  const regionEvidence = evidenceForRegion(evidenceIndex, region);
  return {
    regionKey: regionKey(region),
    regionName: region.name,
    sourceTexturePage: pageName,
    atlas: {
      crop: { x: region.x, y: region.y, width: region.packedWidth, height: region.packedHeight },
      rotation: region.rotation,
    },
    alpha,
    originalSize: { width: region.originalWidth, height: region.originalHeight },
    transparentPadding: {
      left: region.offsetLeft,
      bottom: region.offsetBottom,
      right: region.originalWidth - region.offsetLeft - unrotatedWidth,
      top: region.originalHeight - region.offsetBottom - unrotatedHeight,
    },
    ...(sourcePadding ? { sourcePadding } : {}),
    automaticMultiplier: input.inferredScale.restoreMultiplier,
    globalMultiplier: input.globalMultiplier,
    userOverrideMultiplier: override,
    finalMultiplier: null,
    inferenceEvidence: regionEvidence,
    confidence: input.inferredScale.confidence,
    warnings: regionEvidence.flatMap((evidence) => evidence.warnings ?? []),
    status: "failed",
    zipPath: null,
    outputSize: null,
    error: null,
  };
}

/** Restores every Region independently and packages successes with an audit report. */
export async function exportAllRegions(
  input: ExportAllInput,
  onProgress: (done: number, total: number, phase?: ExportProgressPhase) => void,
  options: ExportAllOptions = {},
): Promise<ExportAllResult> {
  throwIfAborted(options.signal);
  if (!isPositiveFinite(input.globalMultiplier)) {
    throw new Error("全局倍率必须是大于 0 的有限数值。");
  }
  if (!input.sourceVersion) {
    throw new Error("素材版本必须由自动识别或用户明确选择后才能导出。");
  }
  if (input.sourceVersion?.startsWith("3.") && !input.legacyAlphaMode) {
    throw new Error("Spine 3.x 纹理 Alpha 模式必须由用户明确确认后才能导出。");
  }
  if (input.atlas.regions.length > MAX_ATLAS_REGION_COUNT) {
    throw new ExportBatchBudgetError(
      `整批导出的 Region 数量超过 ${MAX_ATLAS_REGION_COUNT} 项安全预算，请拆分 Atlas 后重试。`,
    );
  }
  assertReportInputBudget(input);

  const texturePixelCache: TexturePixelCache = new Map();
  try {
  const entries: ZipCompressionEntry[] = [];
  const allocator = createZipPathAllocator();
  const textures = normalizeAtlasPageMap(input.textures);
  const evidenceIndex = createEvidenceIndex(input.inferredScale);
  const reports: ExportRegionReport[] = [];
  const total = input.atlas.regions.length;
  let totalOutputBytes = 0;
  let totalRawTextureBytes = 0;
  let totalEncodedEntryBytes = 0;
  const countedRawTextures = new Set<ImageBitmap>();
  for (const rawRegion of input.atlas.regions) {
    throwIfAborted(options.signal);
    const region = { ...rawRegion, pageName: normalizeAtlasPageName(rawRegion.pageName) };
    const texture = textures.get(region.pageName);
    if (!texture) continue;
    const override = input.regionOverrides.get(regionKey(region))
      ?? input.regionOverrides.get(region.name)
      ?? null;
    const finalMultiplier = override ?? input.inferredScale.restoreMultiplier * input.globalMultiplier;
    if (!isPositiveFinite(finalMultiplier)) continue;
    let plan;
    try {
      plan = planRegionRestore(region, finalMultiplier, sourcePageSize(texture, findPage(input, region.pageName)));
    } catch {
      // Invalid and individually oversized Regions are reported per item by
      // restoreRegion; only otherwise-valid outputs contribute to batch cost.
      continue;
    }
    totalOutputBytes += plan.output.width * plan.output.height * 4;
    if (!countedRawTextures.has(texture)) {
      assertTextureReadBudget(region.name, texture);
      countedRawTextures.add(texture);
      totalRawTextureBytes += texture.width * texture.height * 4;
    }
    if (totalOutputBytes > MAX_EXPORT_RGBA_BYTES) {
      throw new Error(`整批导出超过 ${MAX_EXPORT_RGBA_BYTES / 1024 / 1024} MiB RGBA 内存预算，请分批导出。`);
    }
    if (totalRawTextureBytes > MAX_EXPORT_RAW_TEXTURE_RGBA_BYTES) {
      throw new Error(
        `整批导出的纹理页原始像素超过 ${MAX_EXPORT_RAW_TEXTURE_RGBA_BYTES / 1024 / 1024} MiB 内存预算，请分批导出。`,
      );
    }
  }

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
    const report = baseReport(region, input, override, evidenceIndex);
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
        const restored = await restoreRegion({
          region,
          texturePage: texture,
          restoreMultiplier: finalMultiplier,
          sourceSize: sourcePageSize(texture, findPage(input, region.pageName)),
          sourceAlphaMode: report.alpha.inputMode,
          texturePixelCache,
          signal: options.signal,
        });
        throwIfAborted(options.signal);
        totalEncodedEntryBytes = reserveEncodedEntryBytes(
          totalEncodedEntryBytes,
          restored.blob.size,
          `Region「${region.name}」PNG`,
        );
        // ArrayBuffer works in browsers and in the Node test runner; passing a
        // browser Blob directly is not supported by every JSZip build.
        const pngBytes = await restored.blob.arrayBuffer();
        throwIfAborted(options.signal);
        if (pngBytes.byteLength !== restored.blob.size) {
          throw new ExportBatchBudgetError(`Region「${region.name}」PNG 的声明大小与读取字节数不一致。`);
        }
        entries.push({ path: reservedZipPath, bytes: pngBytes });
        report.status = "success";
        report.finalMultiplier = finalMultiplier;
        report.zipPath = reservedZipPath;
        report.outputSize = { width: restored.width, height: restored.height };
      }
    } catch (error) {
      throwIfAborted(options.signal);
      if (error instanceof ExportBatchBudgetError) throw error;
      report.status = "failed";
      report.error = errorMessage(error);
    }

    reports.push(report);
    throwIfAborted(options.signal);
    onProgress(position + 1, total, "restoring");
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
  const report: ExportReport = {
    version: 1,
    inferredScale: sanitizedScaleInference(input.inferredScale),
    summary,
    regions: reports,
  };
  const issues = reports.flatMap((entry) => {
    const issue = issueForReport(entry);
    return issue ? [issue] : [];
  });
  const reportBytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
  totalEncodedEntryBytes = reserveEncodedEntryBytes(
    totalEncodedEntryBytes,
    reportBytes.byteLength,
    "export-report.json",
  );
  entries.push({
    path: "export-report.json",
    bytes: reportBytes.buffer,
  });
  throwIfAborted(options.signal);
  // Raw texture pages are needed only during restoration. Release them before the
  // potentially long Worker transfer/DEFLATE phase, with finally as a backstop.
  texturePixelCache.clear();
  onProgress(total, total, "compressing");
  const blob = await compressZipEntries(entries, { signal: options.signal });
  throwIfAborted(options.signal);
  return { blob, report, issues };
  } finally {
    texturePixelCache.clear();
  }
}
