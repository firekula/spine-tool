import * as runtime from "@esotericsoftware/spine-webgl-4.0";
import type { RuntimeConstructorIdentity, RuntimeSourceInfo } from "./bridge-types";
import { createRuntimeBridge, type RuntimeAdapter } from "./runtime-factory";

export const version = "4.0" as const;

export const source = {
  kind: "npm",
  packageName: "@esotericsoftware/spine-webgl",
  version: "4.0.31",
  revision: "4.0.31",
  url: "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.0.31.tgz",
  sha256: "fdfe7fc72b870a4da238f349634dd043390b5035dbce6782e7e4288adc6648a1",
} as const satisfies RuntimeSourceInfo;

export const runtimeConstructors = {
  Skeleton: runtime.Skeleton,
  SkeletonData: runtime.SkeletonData,
} as unknown as RuntimeConstructorIdentity;

const adapter = {
  atlasMode: "page-setter",
  constructors: runtime,
  isRegionAttachment: (attachment: unknown): attachment is { width: number; height: number } => (
    attachment instanceof runtime.RegionAttachment
  ),
  updateSkeleton: (skeleton: runtime.Skeleton, delta: number) => skeleton.update(delta),
  updateWorldTransform: (skeleton: runtime.Skeleton) => skeleton.updateWorldTransform(),
} as unknown as RuntimeAdapter;

export function createBridge() {
  return createRuntimeBridge(version, adapter);
}
