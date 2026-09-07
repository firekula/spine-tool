export interface AttachmentSizeSample {
  /** Stable Atlas Region identity, normally `${name}#${index}`. */
  regionKey?: string;
  regionName: string;
  atlasWidth: number;
  atlasHeight: number;
  attachmentWidth: number;
  attachmentHeight: number;
}

export interface ScaleEvidence {
  regionKey?: string;
  regionName: string;
  widthMultiplier: number;
  heightMultiplier: number;
  multiplier: number;
  aspectRatioError: number;
  weight: number;
  included: boolean;
  /** Warnings attributable to this exact stable Region evidence. */
  warnings?: string[];
}

export interface AtlasPageScaleSample {
  pageName: string;
  scale: number;
}

export interface AtlasPageScaleEvidence {
  pageName: string;
  atlasScale: number;
  restoreMultiplier: number;
}

export interface ScaleInference {
  restoreMultiplier: number;
  exportPercent: number;
  confidence: "high" | "medium" | "low";
  sampleCount: number;
  evidence: ScaleEvidence[];
  pageEvidence?: AtlasPageScaleEvidence[];
  requiresConfirmation?: boolean;
  warnings: string[];
}

const ASPECT_RATIO_ERROR_LIMIT = 0.03;
const CANDIDATE_ERROR_LIMIT = 0.06;
const DISTORTED_SAMPLE_WEIGHT = 0.25;
const MAD_MODIFIED_Z_LIMIT = 3.5;
const MAD_NORMALIZATION = 0.6745;
const COMMON_MULTIPLIERS = [4, 2, 4 / 3, 1, 2 / 3, 1 / 2] as const;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nearestCommonMultiplier(value: number): number | undefined {
  let nearest: number | undefined;
  let nearestError = Number.POSITIVE_INFINITY;

  for (const candidate of COMMON_MULTIPLIERS) {
    const relativeError = Math.abs(value - candidate) / candidate;
    if (relativeError < nearestError) {
      nearest = candidate;
      nearestError = relativeError;
    }
  }

  return nearestError <= CANDIDATE_ERROR_LIMIT + Number.EPSILON ? nearest : undefined;
}

function keepByMad(value: number, center: number, mad: number): boolean {
  const deviation = Math.abs(value - center);
  if (mad === 0) return deviation <= Number.EPSILON * Math.max(1, Math.abs(center));
  return (MAD_NORMALIZATION * deviation) / mad <= MAD_MODIFIED_Z_LIMIT;
}

export function inferExportScale(
  samples: readonly AttachmentSizeSample[],
  pageScales: readonly AtlasPageScaleSample[] = [],
): ScaleInference {
  const warnings: string[] = [];
  const samplesByRegion = new Map<string, AttachmentSizeSample>();
  let duplicateCount = 0;
  for (const sample of samples) {
    const identity = sample.regionKey ?? sample.regionName;
    if (samplesByRegion.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    samplesByRegion.set(identity, sample);
  }
  if (duplicateCount > 0) {
    warnings.push(`已按稳定 Region 身份去重 ${duplicateCount} 个重复附件样本。`);
  }

  const evidence = [...samplesByRegion.values()].flatMap<ScaleEvidence>((sample) => {
    const dimensions = [
      sample.atlasWidth,
      sample.atlasHeight,
      sample.attachmentWidth,
      sample.attachmentHeight,
    ];
    if (!dimensions.every(isPositiveFinite)) return [];

    const widthMultiplier = sample.attachmentWidth / sample.atlasWidth;
    const heightMultiplier = sample.attachmentHeight / sample.atlasHeight;
    const aspectRatioError = Number((Math.abs(widthMultiplier - heightMultiplier)
      / Math.max(widthMultiplier, heightMultiplier)).toPrecision(12));
    const weight = aspectRatioError > ASPECT_RATIO_ERROR_LIMIT + Number.EPSILON
      ? DISTORTED_SAMPLE_WEIGHT
      : 1;

    const evidenceWarnings = weight < 1
      ? [`Region「${sample.regionName}」的附件宽高比例与 Atlas 相差超过 3%，该证据已降权。`]
      : [];
    warnings.push(...evidenceWarnings);

    return [{
      regionKey: sample.regionKey,
      regionName: sample.regionName,
      widthMultiplier,
      heightMultiplier,
      multiplier: Math.sqrt(widthMultiplier * heightMultiplier),
      aspectRatioError,
      weight,
      included: true,
      ...(evidenceWarnings.length > 0 ? { warnings: evidenceWarnings } : {}),
    }];
  });

  const pageEvidence = pageScales.flatMap<AtlasPageScaleEvidence>((sample) => (
    isPositiveFinite(sample.scale)
      ? [{
          pageName: sample.pageName,
          atlasScale: sample.scale,
          restoreMultiplier: 1 / sample.scale,
        }]
      : []
  ));
  if (pageEvidence.length > 0) {
    const firstMultiplier = pageEvidence[0]!.restoreMultiplier;
    const conflict = pageEvidence.some(({ restoreMultiplier }) => (
      Math.abs(restoreMultiplier - firstMultiplier) / firstMultiplier > Number.EPSILON * 16
    ));
    if (conflict) {
      const details = pageEvidence
        .map(({ pageName, atlasScale, restoreMultiplier }) => (
          `「${pageName}」scale ${atlasScale}（恢复 ${Number(restoreMultiplier.toPrecision(12))} 倍）`
        ))
        .join("、");
      warnings.push(`Atlas 多页 scale 冲突：${details}。请核对并确认手动恢复倍率后再导出。`);
      return {
        restoreMultiplier: 1,
        exportPercent: 100,
        confidence: "low",
        sampleCount: pageEvidence.length,
        evidence,
        pageEvidence,
        requiresConfirmation: true,
        warnings,
      };
    }

    return {
      restoreMultiplier: firstMultiplier,
      exportPercent: 100 / firstMultiplier,
      confidence: "high",
      sampleCount: pageEvidence.length,
      evidence,
      pageEvidence,
      requiresConfirmation: false,
      warnings,
    };
  }

  if (evidence.length === 0) {
    return {
      restoreMultiplier: 1,
      exportPercent: 100,
      confidence: "low",
      sampleCount: 0,
      evidence: [],
      pageEvidence: [],
      requiresConfirmation: false,
      warnings: ["没有可用于推算导出倍率的有效 Region 附件尺寸，已保持 1 倍。"],
    };
  }

  const center = median(evidence.map(({ multiplier }) => multiplier));
  const mad = median(evidence.map(({ multiplier }) => Math.abs(multiplier - center)));
  for (const item of evidence) item.included = keepByMad(item.multiplier, center, mad);

  const included = evidence.filter(({ included }) => included);
  const excludedCount = evidence.length - included.length;
  if (excludedCount > 0) warnings.push(`已用中位数和 MAD 排除 ${excludedCount} 个离群倍率样本。`);

  const totalWeight = included.reduce((sum, item) => sum + item.weight, 0);
  const robustMultiplier = included.reduce(
    (sum, item) => sum + item.multiplier * item.weight,
    0,
  ) / totalWeight;
  const commonMultiplier = nearestCommonMultiplier(robustMultiplier);
  const restoreMultiplier = commonMultiplier ?? robustMultiplier;

  for (const item of evidence) {
    const resultError = Math.abs(item.multiplier - restoreMultiplier) / restoreMultiplier;
    item.included = item.included && resultError <= CANDIDATE_ERROR_LIMIT + Number.EPSILON;
  }
  const supporting = evidence.filter(({ included }) => included);
  const supportingWeight = supporting.reduce((sum, item) => sum + item.weight, 0);
  const maximumSupportError = supporting.reduce(
    (maximum, item) => Math.max(maximum, Math.abs(item.multiplier - restoreMultiplier) / restoreMultiplier),
    0,
  );

  if (commonMultiplier === undefined) {
    warnings.push("推算倍率与常见导出比例的相对误差超过 6%，请在导出前人工确认。");
  }
  const unsupportedCount = included.length - supporting.length;
  if (unsupportedCount > 0) {
    warnings.push(`有 ${unsupportedCount} 个样本与最终恢复倍率相差超过 6%，未计入置信度。`);
  }

  const confidence = commonMultiplier !== undefined
    && supporting.length >= 2
    && supportingWeight >= 1.5
    && maximumSupportError <= ASPECT_RATIO_ERROR_LIMIT + Number.EPSILON
    ? "high"
    : (commonMultiplier !== undefined && supporting.length >= 1)
      || (commonMultiplier === undefined && supporting.length >= 2)
      ? "medium"
      : "low";

  return {
    restoreMultiplier,
    exportPercent: 100 / restoreMultiplier,
    confidence,
    sampleCount: supporting.length,
    evidence,
    pageEvidence: [],
    requiresConfirmation: false,
    warnings,
  };
}
