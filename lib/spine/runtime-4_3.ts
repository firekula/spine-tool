import * as runtime from "@esotericsoftware/spine-webgl-4.3";
import type { RuntimeConstructorIdentity, RuntimeSourceInfo } from "./bridge-types";
import { createRuntimeBridge, type RuntimeAdapter } from "./runtime-factory";

export const version = "4.3" as const;

export const source = {
  kind: "npm",
  packageName: "@esotericsoftware/spine-webgl",
  version: "4.3.9",
  revision: "4.3.9",
  url: "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.3.9.tgz",
  sha256: "fd8f6a38f9ab394e84801967209c304738c7ac84f1db9a7d8b0428203114b390",
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
  enumerateAttachments: (skin: runtime.Skin) => skin.getAttachments().map((entry) => ({
    slotIndex: entry.slotIndex,
    name: entry.placeholder,
    attachment: entry.attachment,
  })),
  addSkin: (target: runtime.Skin, sourceSkin: runtime.Skin) => target.addSkin(sourceSkin),
  createTexture: (
    context: WebGLRenderingContext,
    image: HTMLImageElement,
    premultipliedAlpha: boolean,
    useMipMaps: boolean,
  ) => new runtime.GLTexture(context, image, premultipliedAlpha, useMipMaps),
  drawSkeleton: (renderer: runtime.SceneRenderer, skeleton: runtime.Skeleton) => (
    renderer.drawSkeleton(skeleton)
  ),
  usesPerPagePremultipliedAlpha: true,
  setSlotsToSetupPose: (skeleton: runtime.Skeleton) => skeleton.setupPoseSlots(),
  getSlotAttachment: (slot: runtime.Slot) => slot.appliedPose.attachment,
  setSlotAttachment: (slot: runtime.Slot, attachment: unknown) => {
    slot.appliedPose.attachment = attachment as runtime.Attachment | null;
  },
  updateSkeleton: (skeleton: runtime.Skeleton, delta: number) => skeleton.update(delta),
  updateWorldTransform: (skeleton: runtime.Skeleton) => skeleton.updateWorldTransform(runtime.Physics.update),
} as unknown as RuntimeAdapter;

export function createBridge() {
  return createRuntimeBridge(version, adapter);
}
