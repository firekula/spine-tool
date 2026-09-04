import * as runtime from "@esotericsoftware/spine-webgl-4.1";
import type { RuntimeConstructorIdentity, RuntimeSourceInfo } from "./bridge-types";
import { createRuntimeBridge, type RuntimeAdapter } from "./runtime-factory";

export const version = "4.1" as const;

export const source = {
  kind: "npm",
  packageName: "@esotericsoftware/spine-webgl",
  version: "4.1.56",
  revision: "4.1.56",
  url: "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.1.56.tgz",
  sha256: "fc9c0c579e7d91fcba007fabdc7ecced6fad70fca84bd6e3374a3a4f6ac23e4d",
} as const satisfies RuntimeSourceInfo;

export const runtimeConstructors = {
  Skeleton: runtime.Skeleton,
  SkeletonData: runtime.SkeletonData,
} as unknown as RuntimeConstructorIdentity;

export const capabilities = {
  skeletonJson: true,
  skeletonBinary: true,
} as const;

const adapter = {
  capabilities,
  atlasMode: "page-setter",
  constructors: runtime,
  isRegionAttachment: (attachment: unknown): attachment is { width: number; height: number } => (
    attachment instanceof runtime.RegionAttachment
  ),
  enumerateAttachments: (skin: runtime.Skin) => skin.getAttachments(),
  addSkin: (target: runtime.Skin, sourceSkin: runtime.Skin) => target.addSkin(sourceSkin),
  // 4.1.56's Skeleton has no clock/update method; attachment timing is driven by AnimationState.
  updateSkeleton: () => undefined,
  updateWorldTransform: (skeleton: runtime.Skeleton) => skeleton.updateWorldTransform(),
} as unknown as RuntimeAdapter;

export function createBridge() {
  return createRuntimeBridge(version, adapter);
}
