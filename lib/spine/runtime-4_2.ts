import * as runtime from "@esotericsoftware/spine-webgl-4.2";
import type { RuntimeConstructorIdentity, RuntimeSourceInfo } from "./bridge-types";
import { createRuntimeBridge, type RuntimeAdapter } from "./runtime-factory";

export const version = "4.2" as const;

export const source = {
  kind: "npm",
  packageName: "@esotericsoftware/spine-webgl",
  version: "4.2.120",
  revision: "4.2.120",
  url: "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.2.120.tgz",
  sha256: "d1cfacd523602524ed497c8b794cd394a52cc8118cf6a680b4542585e1f36666",
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
  updateSkeleton: (skeleton: runtime.Skeleton, delta: number) => skeleton.update(delta),
  updateWorldTransform: (skeleton: runtime.Skeleton) => skeleton.updateWorldTransform(runtime.Physics.update),
} as unknown as RuntimeAdapter;

export function createBridge() {
  return createRuntimeBridge(version, adapter);
}
