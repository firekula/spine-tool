import { parseAtlas } from "@/lib/atlas/parse-atlas";
import { unionPageSize } from "@/lib/atlas/page-padding";
import { findRegionReferenceProblems, type RegionReferenceProblem } from "@/lib/atlas/region-references";
import type { AtlasDocument } from "@/lib/atlas/types";
import type { ImportBundle } from "@/lib/files/import-files";
import { assertImportFileByteBudget, MAX_TEXTURE_PAGE_COUNT } from "@/lib/files/import-limits";
import type { AppIssue } from "@/lib/issues/types";
import type {
  RuntimeLoadInput,
  SpineRuntimeBridge,
  SpineRuntimeModule,
  TextureAlphaMode,
} from "@/lib/spine/bridge-types";
import { loadRuntimeModule } from "@/lib/spine/runtime-loader";
import { runtimeDescriptor } from "@/lib/spine/runtime-registry";
import {
  detectSpineVersion,
  type DetectedSpineVersion,
  type SupportedSpineVersion,
} from "@/lib/spine/version";

export interface ExportResourceLease {
  atlas: AtlasDocument;
  textures: Map<string, ImageBitmap>;
  release(): void;
}

export interface ExportResources extends ExportResourceLease {
  acquire(): ExportResourceLease;
}

export interface PreparedImport {
  bundle: ImportBundle;
  detected: DetectedSpineVersion;
  exportResources: ExportResources;
}

export interface RuntimeSession {
  bridge: SpineRuntimeBridge;
  input: Omit<RuntimeLoadInput, "canvas">;
  release(): void;
}

export class ImportWorkflowError extends Error implements AppIssue {
  readonly severity = "error" as const;

  constructor(
    public readonly code: string,
    public readonly subject: string | undefined,
    public readonly details: string[],
  ) {
    super(details[0] ?? code);
    this.name = "ImportWorkflowError";
  }
}

interface PrepareImportDependencies {
  parseAtlas?: typeof parseAtlas;
  detectVersion?: typeof detectSpineVersion;
  decodeTexture?: (file: File) => Promise<ImageBitmap>;
  signal?: AbortSignal;
}

interface RuntimeSessionDependencies {
  alphaMode?: TextureAlphaMode;
  loadModule?: (version: SupportedSpineVersion) => Promise<SpineRuntimeModule>;
  createObjectUrl?: (file: File) => string;
  revokeObjectUrl?: (url: string) => void;
}

export const MAX_TEXTURE_PAGE_PIXELS = 16_777_216;
export const MAX_TEXTURE_TOTAL_PIXELS = 33_554_432;

interface TextureDimensions {
  width: number;
  height: number;
}

function abortError(): Error {
  const error = new Error("导入已取消");
  error.name = "AbortError";
  return error;
}

// AbortSignal.prototype.throwIfAborted is unavailable in older Chromium engines,
// so callers rely on this helper instead of the native method.
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function textureBudgetError(subject: string, message: string): ImportWorkflowError {
  return new ImportWorkflowError("TEXTURE_MEMORY_BUDGET_EXCEEDED", subject, [message]);
}

function reserveTexturePixels(
  name: string,
  dimensions: TextureDimensions,
  currentTotal: bigint,
): bigint {
  const { width, height } = dimensions;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw textureBudgetError(name, `纹理页「${name}」的像素尺寸无效（${width}×${height}）。`);
  }
  const pixels = BigInt(width) * BigInt(height);
  if (pixels > BigInt(MAX_TEXTURE_PAGE_PIXELS)) {
    throw textureBudgetError(
      name,
      `纹理页「${name}」超过单页 ${MAX_TEXTURE_PAGE_PIXELS} 像素安全预算（${width}×${height}）。`,
    );
  }
  const nextTotal = currentTotal + pixels;
  if (nextTotal > BigInt(MAX_TEXTURE_TOTAL_PIXELS)) {
    throw textureBudgetError(
      name,
      `全部纹理页超过累计 ${MAX_TEXTURE_TOTAL_PIXELS} 像素安全预算，请减少页面数量或尺寸。`,
    );
  }
  return nextTotal;
}

async function readPngHeaderDimensions(file: File): Promise<TextureDimensions | null> {
  if (file.size < 24) return null;
  const bytes = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8) !== 13
    || bytes[12] !== 73
    || bytes[13] !== 72
    || bytes[14] !== 68
    || bytes[15] !== 82
  ) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function assertRuntimeCapability(
  bundle: ImportBundle,
  version: SupportedSpineVersion,
  detectedSourceVersion: SupportedSpineVersion = version,
): void {
  const unsupportedVersion = [detectedSourceVersion, version]
    .find((candidate) => !runtimeDescriptor(candidate).capabilities.skel);
  if (bundle.skeletonKind === "skel" && unsupportedVersion) {
    throw new ImportWorkflowError(
      "RUNTIME_CAPABILITY_UNSUPPORTED",
      bundle.skeletonFile.name,
      [
        `Spine ${unsupportedVersion} 官方 Web Runtime 不支持 SKEL（二进制）骨骼。`,
        "请改用同版本 JSON 导出；工具不会交给其他版本 Runtime 读取。",
      ],
    );
  }
}

function describeAttachment(problem: RegionReferenceProblem): string {
  return `槽位「${problem.slotName}」的附件「${problem.attachmentName}」`;
}

function regionReferenceError(problems: readonly RegionReferenceProblem[]): ImportWorkflowError {
  const first = problems[0]!;
  const remaining = problems.length > 1
    ? `本次导入还有 ${problems.length - 1} 处类似的 Region 引用问题。`
    : "";
  if (first.kind === "outer-whitespace") {
    return new ImportWorkflowError(
      "REGION_REFERENCE_WHITESPACE_MISMATCH",
      `Region「${first.atlasRegionName}」`,
      [
        `${describeAttachment(first)}在 JSON 中引用 Region「${first.referencedName}」，名称包含首尾空格；Atlas 中的 Region 名是「${first.atlasRegionName}」。`,
        "Spine Runtime 解析 Atlas 时会裁剪 Region 名的首尾空格，但读取 JSON 附件 path 时不会裁剪，因此两者无法精确匹配。",
        "请删除 JSON 中该附件 path 的首尾空格（或删除 path 字段，让它回退为附件名），或在 Spine 中重命名 Region 后重新导出 Atlas 与 JSON。",
        `这与所选 Runtime 版本无关，切换版本无法解决。${remaining}`,
      ],
    );
  }
  return new ImportWorkflowError(
    "REGION_REFERENCE_MISSING",
    `Region「${first.referencedName}」`,
    [
      `${describeAttachment(first)}引用了 Region「${first.referencedName}」，但当前 Atlas 中没有这个 Region。`,
      `请确认 Atlas 与 JSON 来自同一次导出；若 Region 已被重命名，请重新导出两个文件。${remaining}`,
    ],
  );
}

/**
 * Rejects JSON skeletons whose region lookups cannot succeed, so the user sees
 * the actual cause instead of the runtime's generic "Region not found" error.
 * Malformed JSON is left to the selected Runtime, which reports it in context.
 */
function assertRegionReferences(atlasText: string, skeletonText: string): void {
  let skeletonJson: unknown;
  try {
    skeletonJson = JSON.parse(skeletonText);
  } catch {
    return;
  }
  const problems = findRegionReferenceProblems(parseAtlas(atlasText), skeletonJson);
  if (problems.length > 0) throw regionReferenceError(problems);
}

/**
 * Records the decoded PNG size on every Atlas page and widens each page box to
 * the size the Atlas declares for it.
 *
 * A PNG whose right or bottom transparent pixels were trimmed away after export
 * is still described by the Atlas' own `xy`/`size` values, so the page box is the
 * union of both. Reading that box and treating only the decoded PNG's pixels as
 * data restores complete Regions, while a crop outside the union still means the
 * Atlas and the PNG do not belong together and stays a hard error.
 */
function applyDecodedPageDimensions(
  atlas: AtlasDocument,
  textures: ReadonlyMap<string, ImageBitmap>,
): void {
  const pages = new Map(atlas.pages.map((page) => [page.name, page]));
  for (const page of atlas.pages) {
    const texture = textures.get(page.name);
    if (!texture) continue;
    const image = { width: texture.width, height: texture.height };
    const box = unionPageSize(image, page);
    page.imageWidth = image.width;
    page.imageHeight = image.height;
    page.width = box.width;
    page.height = box.height;
  }
  for (const region of atlas.regions) {
    const page = pages.get(region.pageName);
    if (!page) continue;
    if (
      region.x < 0
      || region.y < 0
      || region.x + region.packedWidth > page.width
      || region.y + region.packedHeight > page.height
    ) {
      throw new ImportWorkflowError(
        "REGION_OUT_OF_BOUNDS",
        `Region「${region.name}」`,
        [`Region「${region.name}」的裁切范围超出纹理页 ${page.name}（${page.width}×${page.height}）。`],
      );
    }
  }
}

/** A filename hint only; legacy Atlas files still require the user to confirm. */
export function suggestLegacyAlphaMode(bundle: ImportBundle): TextureAlphaMode {
  const names = [bundle.atlasFile.name, ...bundle.textureFiles.keys()];
  return names.some((name) => /(?:^|[._-])pma(?:[._-]|$)/i.test(name))
    ? "premultiplied"
    : "straight";
}

function releasableExportResources(
  atlas: AtlasDocument,
  textures: Map<string, ImageBitmap>,
): ExportResources {
  let ownerReleased = false;
  let activeLeases = 0;
  let closed = false;
  const closeIfUnused = (): void => {
    if (closed || !ownerReleased || activeLeases !== 0) return;
    closed = true;
    for (const texture of textures.values()) texture.close();
  };
  const resources: ExportResources = {
    atlas,
    textures,
    acquire() {
      if (ownerReleased) throw new Error("导出资源已释放");
      activeLeases += 1;
      let leaseReleased = false;
      return {
        atlas,
        textures,
        release() {
          if (leaseReleased) return;
          leaseReleased = true;
          activeLeases -= 1;
          closeIfUnused();
        },
      };
    },
    release() {
      if (ownerReleased) return;
      ownerReleased = true;
      closeIfUnused();
    },
  };
  return resources;
}

/** Parses and decodes export resources independently from the preview Runtime. */
export async function prepareImport(
  bundle: ImportBundle,
  dependencies: PrepareImportDependencies = {},
): Promise<PreparedImport> {
  const { signal } = dependencies;
  throwIfAborted(signal);
  assertImportFileByteBudget(bundle.atlasFile, bundle.skeletonFile, bundle.textureFiles.values());
  const parse = dependencies.parseAtlas ?? parseAtlas;
  const detect = dependencies.detectVersion ?? detectSpineVersion;
  const decode = dependencies.decodeTexture ?? ((file: File) => createImageBitmap(file, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  }));
  const atlas = parse(bundle.atlasText);
  const detected = await detect(bundle.skeletonFile);
  throwIfAborted(signal);
  const textures = new Map<string, ImageBitmap>();

  if (bundle.textureFiles.size > MAX_TEXTURE_PAGE_COUNT) {
    throw textureBudgetError(
      bundle.atlasFile.name,
      `纹理页数量超过 ${MAX_TEXTURE_PAGE_COUNT} 页安全预算（实际 ${bundle.textureFiles.size} 页）。`,
    );
  }
  const headerDimensions = new Map<string, TextureDimensions>();
  let headerPixels = 0n;
  for (const [name, file] of bundle.textureFiles) {
    throwIfAborted(signal);
    const dimensions = await readPngHeaderDimensions(file);
    throwIfAborted(signal);
    if (!dimensions) {
      throw new ImportWorkflowError(
        "IMAGE_DECODE_FAILED",
        name,
        [`纹理页「${name}」不是有效的 PNG，或缺少完整 PNG 签名与 IHDR。`],
      );
    }
    headerPixels = reserveTexturePixels(name, dimensions, headerPixels);
    headerDimensions.set(name, dimensions);
  }

  try {
    let decodedPixels = 0n;
    for (const [name, file] of bundle.textureFiles) {
      try {
        throwIfAborted(signal);
        const texture = await decode(file);
        textures.set(name, texture);
        throwIfAborted(signal);
        decodedPixels = reserveTexturePixels(name, texture, decodedPixels);
        const header = headerDimensions.get(name);
        if (header && (header.width !== texture.width || header.height !== texture.height)) {
          throw textureBudgetError(
            name,
            `纹理页「${name}」的 PNG IHDR 尺寸与解码尺寸不一致（${header.width}×${header.height} / ${texture.width}×${texture.height}）。`,
          );
        }
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof ImportWorkflowError) throw error;
        throw new ImportWorkflowError(
          "IMAGE_DECODE_FAILED",
          name,
          [error instanceof Error ? error.message : "浏览器无法解码该 PNG。"],
        );
      }
    }
    applyDecodedPageDimensions(atlas, textures);
    throwIfAborted(signal);
  } catch (error) {
    for (const texture of textures.values()) texture.close();
    throw error;
  }

  return {
    bundle,
    detected,
    exportResources: releasableExportResources(atlas, textures),
  };
}

/** Creates a version-matched bridge and its short-lived texture object URLs. */
export async function createRuntimeSession(
  bundle: ImportBundle,
  version: SupportedSpineVersion,
  dependencies: RuntimeSessionDependencies = {},
): Promise<RuntimeSession> {
  assertRuntimeCapability(bundle, version);
  assertImportFileByteBudget(bundle.atlasFile, bundle.skeletonFile, bundle.textureFiles.values());
  const loadModule = dependencies.loadModule ?? loadRuntimeModule;
  const alphaMode = runtimeDescriptor(version).requiresExplicitAlphaMode
    ? dependencies.alphaMode
    : undefined;
  const createObjectUrl = dependencies.createObjectUrl ?? ((file: File) => URL.createObjectURL(file));
  const revokeObjectUrl = dependencies.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const skeleton = bundle.skeletonKind === "json"
    ? { kind: "json" as const, text: await bundle.skeletonFile.text() }
    : { kind: "skel" as const, bytes: new Uint8Array(await bundle.skeletonFile.arrayBuffer()) };
  if (skeleton.kind === "json") assertRegionReferences(bundle.atlasText, skeleton.text);
  const module = await loadModule(version);
  const bridge = module.createBridge();
  const objectUrls = new Map<string, string>();
  let released = false;

  const release = (): void => {
    if (released) return;
    released = true;
    for (const url of new Set(objectUrls.values())) revokeObjectUrl(url);
    bridge.dispose();
  };

  try {
    for (const [name, file] of bundle.textureFiles) {
      objectUrls.set(name, createObjectUrl(file));
    }
    return {
      bridge,
      input: {
        atlasText: bundle.atlasText,
        skeleton,
        textureObjectUrls: objectUrls,
        alphaMode,
      },
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
