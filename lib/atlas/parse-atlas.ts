import type { AtlasDocument, AtlasPage, AtlasRegion } from "@/lib/atlas/types";

type Attribute = { originalKey: string; normalizedKey: string; value: string };

const PAGE_ONLY_KEYS = new Set(["format", "filter", "repeat", "pma", "scale"]);
const REGION_ONLY_KEYS = new Set(["rotate", "xy", "bounds", "orig", "offset", "offsets", "index", "split", "pad"]);

interface RegionDraft {
  name: string;
  line: number;
  pageName: string;
  index: number;
  x?: number;
  y?: number;
  packedWidth?: number;
  packedHeight?: number;
  originalWidth?: number;
  originalHeight?: number;
  offsetLeft?: number;
  offsetBottom?: number;
  rotation: number;
  custom: Record<string, string>;
}

/** A parse error that can be shown directly in the Chinese user interface. */
export class AtlasParseError extends Error {
  readonly pageName?: string;
  readonly regionName?: string;

  constructor(
    public readonly code: string,
    public readonly line: number,
    public readonly suggestion: string,
    context: { pageName?: string; regionName?: string } = {},
  ) {
    const subject = context.regionName
      ? `Region「${context.regionName}」`
      : context.pageName
        ? `纹理页「${context.pageName}」`
        : "Atlas";
    super(`第 ${line} 行，${subject}：${atlasErrorText(code)}。建议：${suggestion}`);
    this.name = "AtlasParseError";
    this.pageName = context.pageName;
    this.regionName = context.regionName;
  }
}

function atlasErrorText(code: string): string {
  switch (code) {
    case "MISSING_PAGE": return "缺少有效的纹理页声明";
    case "DUPLICATE_PAGE": return "纹理页名称重复";
    case "INCOMPLETE_REGION": return "Region 字段不完整";
    case "INVALID_SIZE": return "尺寸必须是大于 0 的数字";
    case "INVALID_VALUE": return "字段值格式无效";
    default: return "Atlas 格式无效";
  }
}

function attributeOf(line: string): Attribute | undefined {
  const match = line.match(/^\s*([^:]+):\s*(.*?)\s*$/);
  if (!match) return undefined;
  const originalKey = match[1]!.trim();
  return { originalKey, normalizedKey: originalKey.toLowerCase(), value: match[2]!.trim() };
}

type ErrorContext = { pageName?: string; regionName?: string };

function numbers(value: string, count: number, line: number, context: ErrorContext, field: string): number[] {
  const parts = value.split(",").map((part) => part.trim());
  const values = parts.map(Number);
  if (values.length !== count || parts.some((part) => part.length === 0) || values.some((number) => !Number.isFinite(number))) {
    throw new AtlasParseError("INVALID_VALUE", line, `将 ${field} 写为 ${count} 个以逗号分隔的数字。`, context);
  }
  return values;
}

function positive(value: number, line: number, context: ErrorContext): number {
  if (value <= 0) {
    throw new AtlasParseError("INVALID_SIZE", line, "将宽度和高度改为大于 0 的数字。", context);
  }
  return value;
}

function normalizeRotation(value: string, line: number, context: ErrorContext): number {
  if (/^true$/i.test(value)) return 90;
  if (/^false$/i.test(value)) return 0;
  const rotation = Number(value);
  if (!Number.isFinite(rotation)) {
    throw new AtlasParseError("INVALID_VALUE", line, "将 rotate 写为 true、false 或顺时针角度。", context);
  }
  return ((rotation % 360) + 360) % 360;
}

function classifyFollowingAttributeBlock(lines: string[], from: number): "page" | "region" {
  let hasPageOnlyKey = false;
  let hasRegionOnlyKey = false;

  for (let index = from + 1; index < lines.length; index += 1) {
    const next = lines[index] ?? "";
    if (!next.trim()) break;
    const attribute = attributeOf(next);
    if (!attribute) break;
    hasPageOnlyKey ||= PAGE_ONLY_KEYS.has(attribute.normalizedKey);
    hasRegionOnlyKey ||= REGION_ONLY_KEYS.has(attribute.normalizedKey);
  }

  // Region-only keys are decisive even when `size` is the first property.
  // A page-only key proves the opposite. With no distinguishing key, retain
  // Spine's normal page interpretation for a blank-separated header.
  if (hasRegionOnlyKey) return "region";
  if (hasPageOnlyKey) return "page";
  return "page";
}

/**
 * Parses Spine 3.8--4.2 text Atlas files into one stable Region shape.
 * Region attributes are recognized by parser state, so valid files whose
 * attributes are not indented remain distinct from subsequent texture pages.
 */
export function parseAtlas(text: string): AtlasDocument {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const document: AtlasDocument = { pages: [], regions: [] };
  const pageNames = new Set<string>();
  let page: AtlasPage | undefined;
  let pageLine = 0;
  let pageHasSize = false;
  let region: RegionDraft | undefined;
  let afterBlank = true;

  const finishRegion = (): void => {
    if (!region) return;
    const missing = [
      region.x === undefined || region.y === undefined ? "xy/bounds" : undefined,
      region.packedWidth === undefined || region.packedHeight === undefined ? "size/bounds" : undefined,
      region.originalWidth === undefined || region.originalHeight === undefined ? "orig/offsets" : undefined,
      region.offsetLeft === undefined || region.offsetBottom === undefined ? "offset/offsets" : undefined,
    ].filter((field): field is string => field !== undefined);
    if (missing.length > 0) {
      throw new AtlasParseError(
        "INCOMPLETE_REGION",
        region.line,
        `补齐 ${missing.join("、")} 字段后重试。`,
        { pageName: region.pageName, regionName: region.name },
      );
    }
    document.regions.push({
      name: region.name,
      pageName: region.pageName,
      index: region.index,
      x: region.x!,
      y: region.y!,
      packedWidth: region.packedWidth!,
      packedHeight: region.packedHeight!,
      originalWidth: region.originalWidth!,
      originalHeight: region.originalHeight!,
      offsetLeft: region.offsetLeft!,
      offsetBottom: region.offsetBottom!,
      rotation: region.rotation,
      custom: region.custom,
    });
    region = undefined;
  };

  const finishPage = (): void => {
    if (page && !pageHasSize) {
      throw new AtlasParseError("MISSING_PAGE", pageLine, "在纹理页名称后添加 size: 宽, 高。", { pageName: page.name });
    }
  };

  const beginPage = (name: string, line: number): void => {
    if (pageNames.has(name)) {
      throw new AtlasParseError("DUPLICATE_PAGE", line, "为每个纹理页使用唯一的文件名。", { pageName: name });
    }
    pageNames.add(name);
    page = { name, width: 0, height: 0, custom: {} };
    pageLine = line;
    pageHasSize = false;
    document.pages.push(page);
  };

  const beginRegion = (name: string, line: number): void => {
    if (!page) {
      throw new AtlasParseError("MISSING_PAGE", line, "先声明纹理页名称及其 size 字段。", { regionName: name });
    }
    region = {
      name,
      line,
      pageName: page.name,
      index: -1,
      rotation: 0,
      custom: {},
    };
  };

  const setPageAttribute = (attribute: Attribute, line: number): void => {
    if (!page) {
      throw new AtlasParseError("MISSING_PAGE", line, "先声明纹理页名称及其 size 字段。");
    }
    if (attribute.normalizedKey === "size") {
      const context = { pageName: page.name };
      const [width, height] = numbers(attribute.value, 2, line, context, "size");
      page.width = positive(width!, line, context);
      page.height = positive(height!, line, context);
      pageHasSize = true;
      return;
    }
    page.custom[attribute.originalKey] = attribute.value;
  };

  const setRegionAttribute = (attribute: Attribute, line: number): void => {
    if (!region) return;
    const context = { pageName: region.pageName, regionName: region.name };
    switch (attribute.normalizedKey) {
      case "rotate":
        region.rotation = normalizeRotation(attribute.value, line, context);
        return;
      case "xy": {
        const [x, y] = numbers(attribute.value, 2, line, context, "xy");
        region.x = x;
        region.y = y;
        return;
      }
      case "size": {
        const [width, height] = numbers(attribute.value, 2, line, context, "size");
        region.packedWidth = positive(width!, line, context);
        region.packedHeight = positive(height!, line, context);
        return;
      }
      case "bounds": {
        const [x, y, width, height] = numbers(attribute.value, 4, line, context, "bounds");
        region.x = x;
        region.y = y;
        region.packedWidth = positive(width!, line, context);
        region.packedHeight = positive(height!, line, context);
        return;
      }
      case "orig": {
        const [width, height] = numbers(attribute.value, 2, line, context, "orig");
        region.originalWidth = positive(width!, line, context);
        region.originalHeight = positive(height!, line, context);
        return;
      }
      case "offset": {
        const [left, bottom] = numbers(attribute.value, 2, line, context, "offset");
        region.offsetLeft = left;
        region.offsetBottom = bottom;
        return;
      }
      case "offsets": {
        const [left, bottom, width, height] = numbers(attribute.value, 4, line, context, "offsets");
        region.offsetLeft = left;
        region.offsetBottom = bottom;
        region.originalWidth = positive(width!, line, context);
        region.originalHeight = positive(height!, line, context);
        return;
      }
      case "index": {
        const [index] = numbers(attribute.value, 1, line, context, "index");
        if (!Number.isInteger(index)) {
          throw new AtlasParseError("INVALID_VALUE", line, "将 index 写为整数。", context);
        }
        region.index = index!;
        return;
      }
      default:
        region.custom[attribute.originalKey] = attribute.value;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = index + 1;
    if (!rawLine.trim()) {
      afterBlank = true;
      continue;
    }

    const attribute = attributeOf(rawLine);
    if (attribute) {
      if (!page) {
        throw new AtlasParseError("MISSING_PAGE", line, "先声明纹理页名称及其 size 字段。");
      }
      if (region) setRegionAttribute(attribute, line);
      else setPageAttribute(attribute, line);
      afterBlank = false;
      continue;
    }

    const name = rawLine.trim();
    if (!page) {
      beginPage(name, line);
    } else if (afterBlank && classifyFollowingAttributeBlock(lines, index) === "page") {
      finishRegion();
      finishPage();
      beginPage(name, line);
    } else {
      finishRegion();
      beginRegion(name, line);
    }
    afterBlank = false;
  }

  finishRegion();
  finishPage();
  if (document.pages.length === 0) {
    throw new AtlasParseError("MISSING_PAGE", 1, "添加纹理页名称及 size: 宽, 高。");
  }
  return document;
}
