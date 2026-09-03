import { parseAtlas } from "@/lib/atlas/parse-atlas";
import type { AtlasDocument } from "@/lib/atlas/types";
import type { ImportBundle } from "@/lib/files/import-files";
import type { AppIssue } from "@/lib/issues/types";
import type {
  RuntimeLoadInput,
  SpineRuntimeBridge,
  SpineRuntimeModule,
} from "@/lib/spine/bridge-types";
import { loadRuntimeModule } from "@/lib/spine/runtime-loader";
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
}

interface RuntimeSessionDependencies {
  loadModule?: (version: SupportedSpineVersion) => Promise<SpineRuntimeModule>;
  createObjectUrl?: (file: File) => string;
  revokeObjectUrl?: (url: string) => void;
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
  const parse = dependencies.parseAtlas ?? parseAtlas;
  const detect = dependencies.detectVersion ?? detectSpineVersion;
  const decode = dependencies.decodeTexture ?? ((file: File) => createImageBitmap(file));
  const atlas = parse(bundle.atlasText);
  const detected = await detect(bundle.skeletonFile);
  const textures = new Map<string, ImageBitmap>();

  try {
    for (const [name, file] of bundle.textureFiles) {
      try {
        textures.set(name, await decode(file));
      } catch (error) {
        throw new ImportWorkflowError(
          "IMAGE_DECODE_FAILED",
          name,
          [error instanceof Error ? error.message : "浏览器无法解码该 PNG。"],
        );
      }
    }
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
  const loadModule = dependencies.loadModule ?? loadRuntimeModule;
  const createObjectUrl = dependencies.createObjectUrl ?? ((file: File) => URL.createObjectURL(file));
  const revokeObjectUrl = dependencies.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
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
    const skeleton = bundle.skeletonKind === "json"
      ? { kind: "json" as const, text: await bundle.skeletonFile.text() }
      : { kind: "skel" as const, bytes: new Uint8Array(await bundle.skeletonFile.arrayBuffer()) };
    for (const [name, file] of bundle.textureFiles) {
      objectUrls.set(name, createObjectUrl(file));
    }
    return {
      bridge,
      input: {
        atlasText: bundle.atlasText,
        skeleton,
        textureObjectUrls: objectUrls,
      },
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
