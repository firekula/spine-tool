import type { AppIssue } from "@/lib/issues/types";
import { normalizeAtlasPageName } from "@/lib/atlas/page-name";

export interface ImportBundle {
  atlasFile: File;
  atlasText: string;
  skeletonFile: File;
  skeletonKind: "json" | "skel";
  textureFiles: Map<string, File>;
  unusedTextures: string[];
}

export class ImportValidationError extends Error implements AppIssue {
  readonly severity = "error" as const;

  constructor(
    public readonly code: string,
    public readonly details?: string[],
    message = code,
  ) {
    super(message);
    this.name = "ImportValidationError";
  }
}

interface NamedFile {
  file: File;
  name: string;
}

function basename(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1] ?? name;
}

function extension(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * Gets page names without attempting to parse regions or Atlas attributes.
 * A page header is a top-level, non-empty line followed by the required
 * top-level `size:` page attribute. Region attributes are indented.
 */
export function extractAtlasPageNames(atlasText: string): string[] {
  const lines = atlasText.replace(/\r\n?/g, "\n").split("\n");
  const pages: string[] = [];
  const pageOnlyKeys = new Set(["format", "filter", "repeat", "pma", "scale"]);
  const regionOnlyKeys = new Set(["rotate", "xy", "bounds", "orig", "offset", "offsets", "index", "split", "pad"]);
  let hasPage = false;
  let afterBlank = true;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const candidate = line.trim();
    if (!candidate) {
      afterBlank = true;
      continue;
    }
    if (/^\s*[^:]+\s*:/.test(line)) {
      afterBlank = false;
      continue;
    }

    let pageHeader = !hasPage;
    if (hasPage && afterBlank) {
      let hasPageOnlyKey = false;
      let hasRegionOnlyKey = false;
      for (let next = index + 1; next < lines.length && lines[next]?.trim(); next += 1) {
        const match = lines[next]?.match(/^\s*([^:]+)\s*:/);
        if (!match) break;
        const key = match[1]!.trim().toLowerCase();
        hasPageOnlyKey ||= pageOnlyKeys.has(key);
        hasRegionOnlyKey ||= regionOnlyKeys.has(key);
      }
      pageHeader = hasPageOnlyKey || !hasRegionOnlyKey;
    }

    if (pageHeader) {
      pages.push(normalizeAtlasPageName(candidate));
      hasPage = true;
    }
    afterBlank = false;
  }

  return pages;
}

function requireSingleFile(files: File[], kind: string, codePrefix: string): File {
  if (files.length === 0) throw new ImportValidationError(`MISSING_${codePrefix}`);
  if (files.length > 1) {
    throw new ImportValidationError(`MULTIPLE_${codePrefix}`, files.map((file) => file.name));
  }
  return files[0]!;
}

function resolveTexture(pageName: string, textures: NamedFile[]): NamedFile {
  const exactMatches = textures.filter((texture) => texture.name === pageName);
  if (exactMatches.length === 1) return exactMatches[0]!;
  if (exactMatches.length > 1) {
    throw new ImportValidationError("AMBIGUOUS_TEXTURE_PAGE", [pageName]);
  }

  const basenameMatches = textures.filter((texture) => basename(texture.name) === basename(pageName));
  if (basenameMatches.length === 1) return basenameMatches[0]!;
  if (basenameMatches.length > 1) {
    throw new ImportValidationError("AMBIGUOUS_TEXTURE_PAGE", [pageName]);
  }

  throw new ImportValidationError("MISSING_TEXTURE_PAGES", [pageName]);
}

export async function classifyImport(files: File[]): Promise<ImportBundle> {
  const namedFiles = files.map((file) => ({ file, name: normalizeAtlasPageName(file.name) }));
  const atlasFile = requireSingleFile(
    namedFiles.filter(({ name }) => extension(name) === "atlas").map(({ file }) => file),
    "Atlas",
    "ATLAS",
  );
  const skeletonFile = requireSingleFile(
    namedFiles.filter(({ name }) => ["json", "skel"].includes(extension(name))).map(({ file }) => file),
    "Spine skeleton",
    "SKELETON",
  );
  const skeletonKind = extension(skeletonFile.name) as ImportBundle["skeletonKind"];
  const atlasText = await atlasFile.text();
  const textures = namedFiles.filter(({ name }) => extension(name) === "png");
  if (textures.length === 0) {
    const message = "未检测到 PNG 纹理文件。请至少选择一张 PNG 纹理。";
    throw new ImportValidationError("MISSING_TEXTURE_FILES", [message], message);
  }
  const textureFiles = new Map<string, File>();
  const usedTextures = new Set<File>();
  const missingPages: string[] = [];

  const pageNames = extractAtlasPageNames(atlasText);
  const seenPageNames = new Set<string>();
  for (const pageName of pageNames) {
    if (seenPageNames.has(pageName)) {
      throw new ImportValidationError("AMBIGUOUS_TEXTURE_PAGE", [pageName]);
    }
    seenPageNames.add(pageName);
    try {
      const texture = resolveTexture(pageName, textures);
      textureFiles.set(pageName, texture.file);
      usedTextures.add(texture.file);
    } catch (error) {
      if (error instanceof ImportValidationError && error.code === "MISSING_TEXTURE_PAGES") {
        missingPages.push(pageName);
        continue;
      }
      throw error;
    }
  }

  if (missingPages.length > 0) {
    throw new ImportValidationError("MISSING_TEXTURE_PAGES", missingPages);
  }

  return {
    atlasFile,
    atlasText,
    skeletonFile,
    skeletonKind,
    textureFiles,
    unusedTextures: textures
      .filter(({ file }) => !usedTextures.has(file))
      .map(({ name }) => name),
  };
}
