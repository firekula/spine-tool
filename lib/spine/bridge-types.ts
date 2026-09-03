import type { SupportedSpineVersion } from "./version";

export type RuntimeSkeletonInput =
  | { kind: "json"; text: string }
  | { kind: "skel"; bytes: Uint8Array };

export interface RuntimeLoadInput {
  atlasText: string;
  skeleton: RuntimeSkeletonInput;
  textureObjectUrls: ReadonlyMap<string, string>;
  canvas: HTMLCanvasElement;
}

export interface SkeletonAnimationMetadata {
  name: string;
  duration: number;
}

export interface RegionAttachmentMetadata {
  skin: string;
  slot: string;
  name: string;
  width: number;
  height: number;
}

export interface SkeletonMetadata {
  animations: SkeletonAnimationMetadata[];
  skins: string[];
  slots: string[];
  regionAttachments: RegionAttachmentMetadata[];
}

export interface PlaybackSnapshot {
  animation: string | null;
  duration: number;
  playing: boolean;
  time: number;
}

export interface SkeletonBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Runtime camera view. `zoom` is visual magnification: 2 draws twice as large. */
export interface RuntimeView {
  centerX: number;
  centerY: number;
  zoom: number;
}

export interface SpineRuntimeBridge {
  readonly version: SupportedSpineVersion;
  load(input: RuntimeLoadInput): Promise<SkeletonMetadata>;
  play(name: string, loop: boolean): void;
  setLoop(loop: boolean): void;
  pause(paused: boolean): void;
  seek(seconds: number): void;
  setSpeed(speed: number): void;
  setSkins(names: string[]): void;
  setHiddenSlots(names: ReadonlySet<string>): void;
  getBounds(): SkeletonBounds | null;
  setView(view: RuntimeView): void;
  resize(width: number, height: number, dpr: number): void;
  frame(deltaSeconds: number): PlaybackSnapshot;
  dispose(): void;
}

export interface RuntimeSourceInfo {
  kind: "git-vendor" | "npm";
  packageName: string;
  version: string;
  revision: string;
  url: string;
  sha256: string;
}

export interface RuntimeConstructorIdentity {
  Skeleton: new (data: unknown) => { data: unknown };
  SkeletonData: new () => unknown;
}

export interface SpineRuntimeModule {
  readonly version: SupportedSpineVersion;
  readonly source: RuntimeSourceInfo;
  readonly runtimeConstructors: RuntimeConstructorIdentity;
  createBridge(): SpineRuntimeBridge;
}
