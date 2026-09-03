import { spine } from "../../vendor/spine-runtime-3.8/spine-webgl.js";
import type { RuntimeConstructorIdentity, RuntimeSourceInfo } from "./bridge-types";
import { createRuntimeBridge, type RuntimeAdapter } from "./runtime-factory";

export const version = "3.8" as const;

export const source = {
  kind: "git-vendor",
  packageName: "EsotericSoftware/spine-runtimes:spine-ts",
  version: "3.8",
  revision: "8b4844bd4b193ba9e54487ed397a777993cbad56",
  url: "https://github.com/EsotericSoftware/spine-runtimes/tree/8b4844bd4b193ba9e54487ed397a777993cbad56/spine-ts",
  sha256: "a31be4f37fb5ffa9b88822c38889efa406fb2201046592b8fdcb6d22925db9a4",
} as const satisfies RuntimeSourceInfo;

export const runtimeConstructors = {
  Skeleton: spine.Skeleton,
  SkeletonData: spine.SkeletonData,
} as unknown as RuntimeConstructorIdentity;

const adapter = {
  atlasMode: "constructor-loader",
  constructors: {
    TextureAtlas: spine.TextureAtlas,
    AtlasAttachmentLoader: spine.AtlasAttachmentLoader,
    SkeletonJson: spine.SkeletonJson,
    SkeletonBinary: spine.SkeletonBinary,
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
  updateSkeleton: (skeleton: { update(delta: number): void }, delta: number) => skeleton.update(delta),
  updateWorldTransform: (skeleton: { updateWorldTransform(): void }) => skeleton.updateWorldTransform(),
} as unknown as RuntimeAdapter;

export function createBridge() {
  return createRuntimeBridge(version, adapter);
}
