import { spine } from "../../vendor/spine-runtime-3.6/spine-webgl.js";
import type { RuntimeConstructorIdentity, RuntimeSourceInfo } from "./bridge-types";
import { createRuntimeBridge, type RuntimeAdapter } from "./runtime-factory";

export const version = "3.6" as const;

export const source = {
  kind: "git-vendor",
  packageName: "EsotericSoftware/spine-runtimes:spine-ts",
  version: "3.6",
  revision: "654c20e5b0e523040b6366bbd1042510d2645134",
  url: "https://github.com/EsotericSoftware/spine-runtimes/tree/654c20e5b0e523040b6366bbd1042510d2645134/spine-ts",
  sha256: "cb9da14b05076037bdfc136840f3a1ab5a50da6390da0a3e5e2dbe8a0b7348e9",
} as const satisfies RuntimeSourceInfo;

export const capabilities = {
  skeletonJson: true,
  skeletonBinary: false,
} as const;

export const runtimeConstructors = {
  Skeleton: spine.Skeleton,
  SkeletonData: spine.SkeletonData,
} as unknown as RuntimeConstructorIdentity;

interface LegacySkin {
  attachments: Array<Record<string, unknown> | undefined>;
  addAttachment(slotIndex: number, name: string, attachment: unknown): void;
}

function enumerateAttachments(skin: LegacySkin) {
  return skin.attachments.flatMap((slot, slotIndex) => (
    Object.entries(slot ?? {}).map(([name, attachment]) => ({ slotIndex, name, attachment }))
  ));
}

const adapter = {
  capabilities,
  atlasMode: "constructor-loader",
  constructors: {
    TextureAtlas: spine.TextureAtlas,
    AtlasAttachmentLoader: spine.AtlasAttachmentLoader,
    SkeletonJson: spine.SkeletonJson,
    Skeleton: spine.Skeleton,
    SkeletonData: spine.SkeletonData,
    AnimationStateData: spine.AnimationStateData,
    AnimationState: spine.AnimationState,
    Skin: spine.Skin,
    RegionAttachment: spine.RegionAttachment,
    GLTexture: spine.webgl.GLTexture,
    SceneRenderer: spine.webgl.SceneRenderer,
  },
  isRegionAttachment: (attachment: unknown): attachment is { width: number; height: number } => (
    attachment instanceof spine.RegionAttachment
  ),
  enumerateAttachments: (skin: LegacySkin) => enumerateAttachments(skin),
  addSkin: (target: LegacySkin, sourceSkin: LegacySkin) => {
    for (const { slotIndex, name, attachment } of enumerateAttachments(sourceSkin)) {
      target.addAttachment(slotIndex, name, attachment);
    }
  },
  updateSkeleton: (skeleton: { update(delta: number): void }, delta: number) => skeleton.update(delta),
  updateWorldTransform: (skeleton: { updateWorldTransform(): void }) => skeleton.updateWorldTransform(),
} as unknown as RuntimeAdapter;

export function createBridge() {
  return createRuntimeBridge(version, adapter);
}
