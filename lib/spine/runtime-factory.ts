import type { SupportedSpineVersion } from "./version";
import type {
  PlaybackSnapshot,
  RegionAttachmentMetadata,
  RuntimeLoadInput,
  SkeletonMetadata,
  SpineRuntimeBridge,
} from "./bridge-types";

type RuntimeConstructor<T = any> = new (...args: any[]) => T;

interface RuntimeAtlasPage {
  name: string;
  texture?: { dispose?(): void } | null;
  setTexture?(texture: unknown): void;
}

interface RuntimeAtlas {
  pages: RuntimeAtlasPage[];
  dispose(): void;
}

interface RuntimeSkin {
  name: string;
  addSkin(skin: RuntimeSkin): void;
  getAttachments?(): Array<{ slotIndex: number; name: string; attachment: unknown }>;
}

interface RuntimeSkeletonData {
  animations: Array<{ name: string; duration: number }>;
  skins: RuntimeSkin[];
  slots: Array<{ name: string }>;
  defaultSkin?: RuntimeSkin | null;
  findSkin(name: string): RuntimeSkin | null | undefined;
}

interface RuntimeSlot {
  data: { name: string };
  attachment: unknown;
  setAttachment(attachment: unknown | null): void;
}

interface RuntimeSkeleton {
  data: RuntimeSkeletonData;
  slots: RuntimeSlot[];
  setSkin(skin: RuntimeSkin | null): void;
  setSlotsToSetupPose(): void;
}

interface RuntimeTrackEntry {
  animation?: { name: string; duration: number };
  trackTime: number;
  loop?: boolean;
}

interface RuntimeAnimationState {
  timeScale: number;
  update(delta: number): void;
  apply(skeleton: RuntimeSkeleton): boolean | void;
  setAnimation(trackIndex: number, name: string, loop: boolean): RuntimeTrackEntry;
  clearTracks(): void;
}

interface RuntimeRenderer {
  camera?: {
    viewportWidth?: number;
    viewportHeight?: number;
    setViewport?(width: number, height: number): void;
    update(): void;
  };
  context?: { gl?: WebGLRenderingContext };
  begin(): void;
  drawSkeleton(skeleton: RuntimeSkeleton, premultipliedAlpha?: boolean): void;
  end(): void;
  dispose(): void;
}

export interface RuntimeAdapter {
  atlasMode: "constructor-loader" | "page-setter";
  constructors: {
    TextureAtlas: RuntimeConstructor<RuntimeAtlas>;
    AtlasAttachmentLoader: RuntimeConstructor;
    SkeletonJson: RuntimeConstructor<{ readSkeletonData(input: string | unknown): RuntimeSkeletonData }>;
    SkeletonBinary: RuntimeConstructor<{ readSkeletonData(input: Uint8Array): RuntimeSkeletonData }>;
    Skeleton: RuntimeConstructor<RuntimeSkeleton>;
    SkeletonData: RuntimeConstructor;
    AnimationStateData: RuntimeConstructor;
    AnimationState: RuntimeConstructor<RuntimeAnimationState>;
    Skin: RuntimeConstructor<RuntimeSkin>;
    RegionAttachment: RuntimeConstructor;
    GLTexture: RuntimeConstructor<{ dispose?(): void }>;
    SceneRenderer: RuntimeConstructor<RuntimeRenderer>;
  };
  isRegionAttachment(attachment: unknown): attachment is { width: number; height: number };
  updateWorldTransform(skeleton: RuntimeSkeleton): void;
}

function loadImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`无法加载纹理对象 URL: ${objectUrl}`));
    image.src = objectUrl;
  });
}

function textureForPage<T>(textures: ReadonlyMap<string, T>, pageName: string): T {
  const exact = textures.get(pageName);
  if (exact) return exact;

  const normalizedPage = pageName.replace(/\\/g, "/").replace(/^\.\//, "");
  const normalized = [...textures].find(([name]) => (
    name.replace(/\\/g, "/").replace(/^\.\//, "") === normalizedPage
  ));
  if (normalized) return normalized[1];

  throw new Error(`Atlas 纹理页未提供对象 URL: ${pageName}`);
}

async function createAtlas(
  input: RuntimeLoadInput,
  context: WebGLRenderingContext,
  adapter: RuntimeAdapter,
): Promise<RuntimeAtlas> {
  const images = new Map<string, HTMLImageElement>();
  await Promise.all([...input.textureObjectUrls].map(async ([name, url]) => {
    images.set(name, await loadImage(url));
  }));

  const { GLTexture, TextureAtlas } = adapter.constructors;
  if (adapter.atlasMode === "constructor-loader") {
    return new TextureAtlas(input.atlasText, (pageName: string) => (
      new GLTexture(context, textureForPage(images, pageName))
    ));
  }

  const atlas = new TextureAtlas(input.atlasText);
  try {
    for (const page of atlas.pages) {
      const texture = new GLTexture(context, textureForPage(images, page.name));
      if (page.setTexture) page.setTexture(texture);
      else page.texture = texture;
    }
    return atlas;
  } catch (error) {
    atlas.dispose();
    throw error;
  }
}

function regionAttachmentMetadata(
  data: RuntimeSkeletonData,
  adapter: RuntimeAdapter,
): RegionAttachmentMetadata[] {
  const result: RegionAttachmentMetadata[] = [];

  for (const skin of data.skins) {
    for (const entry of skin.getAttachments?.() ?? []) {
      if (!adapter.isRegionAttachment(entry.attachment)) continue;
      const slot = data.slots[entry.slotIndex];
      if (!slot) continue;
      result.push({
        skin: skin.name,
        slot: slot.name,
        name: entry.name,
        width: entry.attachment.width,
        height: entry.attachment.height,
      });
    }
  }

  return result;
}

class RuntimeBridge implements SpineRuntimeBridge {
  readonly version: SupportedSpineVersion;

  private atlas: RuntimeAtlas | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: RuntimeRenderer | null = null;
  private skeleton: RuntimeSkeleton | null = null;
  private state: RuntimeAnimationState | null = null;
  private entry: RuntimeTrackEntry | null = null;
  private hiddenSlots = new Set<string>();
  private paused = false;
  private speed = 1;
  private disposed = false;

  constructor(version: SupportedSpineVersion, private readonly adapter: RuntimeAdapter) {
    this.version = version;
  }

  async load(input: RuntimeLoadInput): Promise<SkeletonMetadata> {
    if (this.disposed) throw new Error("Runtime bridge 已释放");
    if (this.atlas || this.renderer || this.state) throw new Error("Runtime bridge 已加载资源");

    const context = input.canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!context) throw new Error("浏览器不支持 WebGL");

    const atlas = await createAtlas(input, context, this.adapter);
    let renderer: RuntimeRenderer | null = null;
    let state: RuntimeAnimationState | null = null;
    try {
      const {
        AnimationState,
        AnimationStateData,
        AtlasAttachmentLoader,
        SceneRenderer,
        Skeleton,
        SkeletonBinary,
        SkeletonJson,
      } = this.adapter.constructors;
      const attachmentLoader = new AtlasAttachmentLoader(atlas);
      const reader = input.skeleton.kind === "json"
        ? new SkeletonJson(attachmentLoader)
        : new SkeletonBinary(attachmentLoader);
      const data = reader.readSkeletonData(
        input.skeleton.kind === "json" ? input.skeleton.text : input.skeleton.bytes,
      );
      const skeleton = new Skeleton(data);
      state = new AnimationState(new AnimationStateData(data));
      state.timeScale = this.speed;
      renderer = new SceneRenderer(input.canvas, context, true);

      this.atlas = atlas;
      this.canvas = input.canvas;
      this.renderer = renderer;
      this.skeleton = skeleton;
      this.state = state;

      return {
        animations: data.animations.map(({ name, duration }) => ({ name, duration })),
        skins: data.skins.map(({ name }) => name),
        slots: data.slots.map(({ name }) => name),
        regionAttachments: regionAttachmentMetadata(data, this.adapter),
      };
    } catch (error) {
      state?.clearTracks();
      renderer?.dispose();
      atlas.dispose();
      throw error;
    }
  }

  play(name: string, loop: boolean): void {
    if (!this.state) return;
    this.entry = this.state.setAnimation(0, name, loop);
    this.paused = false;
  }

  pause(paused: boolean): void {
    this.paused = paused;
  }

  seek(seconds: number): void {
    if (!this.entry) return;
    this.entry.trackTime = Math.max(0, seconds);
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0, speed);
    if (this.state) this.state.timeScale = this.speed;
  }

  setSkins(names: string[]): void {
    if (!this.skeleton) return;
    const data = this.skeleton.data;
    const skins = names.map((name) => data.findSkin(name)).filter((skin): skin is RuntimeSkin => Boolean(skin));

    if (skins.length <= 1) {
      this.skeleton.setSkin(skins[0] ?? data.defaultSkin ?? null);
    } else {
      const composite = new this.adapter.constructors.Skin("bridge-composite");
      for (const skin of skins) composite.addSkin(skin);
      this.skeleton.setSkin(composite);
    }
    this.skeleton.setSlotsToSetupPose();
  }

  setHiddenSlots(names: ReadonlySet<string>): void {
    this.hiddenSlots = new Set(names);
  }

  resize(width: number, height: number, dpr: number): void {
    if (!this.canvas) return;
    const safeWidth = Math.max(0, width);
    const safeHeight = Math.max(0, height);
    const safeDpr = Math.max(1, dpr);
    this.canvas.width = Math.round(safeWidth * safeDpr);
    this.canvas.height = Math.round(safeHeight * safeDpr);
    this.canvas.style.width = `${safeWidth}px`;
    this.canvas.style.height = `${safeHeight}px`;
    const camera = this.renderer?.camera;
    if (camera) {
      if (camera.setViewport) camera.setViewport(safeWidth, safeHeight);
      else {
        camera.viewportWidth = safeWidth;
        camera.viewportHeight = safeHeight;
      }
      camera.update();
    }
    this.renderer?.context?.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  frame(deltaSeconds: number): PlaybackSnapshot {
    const { renderer, skeleton, state } = this;
    if (!renderer || !skeleton || !state) return this.snapshot();

    if (!this.paused) state.update(Math.max(0, deltaSeconds));
    state.apply(skeleton);

    // AnimationState may restore attachments on every apply. Hide only after
    // that restoration, so hidden slots remain hidden without losing state.
    for (const slot of skeleton.slots) {
      if (this.hiddenSlots.has(slot.data.name)) slot.setAttachment(null);
    }
    this.adapter.updateWorldTransform(skeleton);

    const gl = renderer.context?.gl;
    if (gl) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    renderer.begin();
    renderer.drawSkeleton(skeleton, true);
    renderer.end();
    return this.snapshot();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.state?.clearTracks();
    this.renderer?.dispose();
    this.atlas?.dispose();
    this.atlas = null;
    this.canvas = null;
    this.renderer = null;
    this.skeleton = null;
    this.state = null;
    this.entry = null;
    this.hiddenSlots.clear();
  }

  private snapshot(): PlaybackSnapshot {
    const duration = this.entry?.animation?.duration ?? 0;
    const rawTime = this.entry?.trackTime ?? 0;
    const time = this.entry?.loop && duration > 0 ? rawTime % duration : rawTime;
    return {
      animation: this.entry?.animation?.name ?? null,
      duration,
      playing: Boolean(this.entry) && !this.paused,
      time,
    };
  }
}

export function createRuntimeBridge(
  version: SupportedSpineVersion,
  adapter: RuntimeAdapter,
): SpineRuntimeBridge {
  return new RuntimeBridge(version, adapter);
}
