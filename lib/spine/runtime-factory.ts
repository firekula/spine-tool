import type { SupportedSpineVersion } from "./version";
import {
  normalizeAtlasPageMap,
  normalizeAtlasPageName,
} from "../atlas/page-name";
import type {
  PlaybackSnapshot,
  RegionAttachmentMetadata,
  RuntimeLoadInput,
  RuntimeView,
  SkeletonBounds,
  SkeletonMetadata,
  SpineRuntimeBridge,
} from "./bridge-types";

type RuntimeConstructor<T = any> = new (...args: any[]) => T;

interface RuntimeAtlasPage {
  name: string;
  minFilter?: number;
  pma?: boolean;
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

interface RuntimeVector2 {
  x: number;
  y: number;
  set(x: number, y: number): RuntimeVector2;
}

function createRuntimeVector2(): RuntimeVector2 {
  return {
    x: 0,
    y: 0,
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
  };
}

interface RuntimeSkeleton {
  data: RuntimeSkeletonData;
  slots: RuntimeSlot[];
  setSkin(skin: RuntimeSkin | null): void;
  setSlotsToSetupPose(): void;
  getBounds(
    offset: RuntimeVector2,
    size: RuntimeVector2,
    temp?: number[],
  ): void;
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
    position?: { x: number; y: number; z?: number };
    zoom?: number;
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
  isRegionAttachment(attachment: unknown): attachment is {
    width: number;
    height: number;
    path?: string;
    region?: { name?: string } | null;
  };
  updateSkeleton(skeleton: RuntimeSkeleton, delta: number): void;
  updateWorldTransform(skeleton: RuntimeSkeleton): void;
}

class LoadCancellation {
  private cancelled = false;
  private listeners = new Set<() => void>();

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  onCancel(listener: () => void): () => void {
    if (this.cancelled) {
      listener();
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function loadCancelledError(): Error {
  const error = new Error("Runtime load 已取消");
  error.name = "AbortError";
  return error;
}

function loadImage(objectUrl: string, cancellation: LoadCancellation): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    let removeCancellationListener: () => void = () => {};
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      removeCancellationListener();
      action();
    };
    image.onload = () => finish(() => resolve(image));
    image.onerror = () => finish(() => reject(new Error(`无法加载纹理对象 URL: ${objectUrl}`)));
    removeCancellationListener = cancellation.onCancel(() => (
      finish(() => reject(loadCancelledError()))
    ));
    if (settled) return;
    image.src = objectUrl;
  });
}

function textureForPage<T>(textures: ReadonlyMap<string, T>, pageName: string): T {
  const normalized = normalizeAtlasPageMap(textures);
  const texture = normalized.get(normalizeAtlasPageName(pageName));
  if (texture !== undefined) return texture;

  throw new Error(`Atlas 纹理页未提供对象 URL: ${pageName}`);
}

interface AtlasPageConfig {
  name: string;
  useMipMaps: boolean;
  premultipliedAlpha?: boolean;
}

/** Reads only page-level rendering fields, leaving the full Atlas parse to the selected Runtime. */
function atlasPageConfigs(atlasText: string): AtlasPageConfig[] {
  const configs: AtlasPageConfig[] = [];
  let current: AtlasPageConfig | null = null;
  let afterBlank = true;

  for (const rawLine of atlasText.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      afterBlank = true;
      current = null;
      continue;
    }

    const attribute = line.match(/^([^:]+):\s*(.*?)\s*$/);
    if (attribute) {
      if (!current) continue; // Atlas header or region field.
      const key = attribute[1]!.trim().toLowerCase();
      const value = attribute[2]!.trim();
      if (key === "filter") {
        const minFilter = value.split(",", 1)[0]?.trim() ?? "";
        current.useMipMaps = /^mipmap/i.test(minFilter);
      } else if (key === "pma") {
        current.premultipliedAlpha = /^true$/i.test(value);
      }
      afterBlank = false;
      continue;
    }

    if (afterBlank) {
      current = { name: normalizeAtlasPageName(line), useMipMaps: false };
      if (configs.some(({ name }) => name === current?.name)) {
        throw new Error(`Atlas 纹理页名称规范化后冲突：「${line}」对应重复身份「${current.name}」。`);
      }
      configs.push(current);
    } else {
      current = null; // First region name ends the page property block.
    }
    afterBlank = false;
  }

  return configs;
}

function pageConfig(configs: AtlasPageConfig[], pageName: string): AtlasPageConfig | undefined {
  const normalizedName = normalizeAtlasPageName(pageName);
  return configs.find(({ name }) => normalizeAtlasPageName(name) === normalizedName);
}

function pageUsesMipMaps(page: RuntimeAtlasPage, config: AtlasPageConfig | undefined): boolean {
  // WebGL mipmap minification filters occupy this contiguous enum range.
  if (typeof page.minFilter === "number") return page.minFilter >= 9984 && page.minFilter <= 9987;
  return config?.useMipMaps ?? false;
}

function atlasPremultipliedAlpha(
  atlas: RuntimeAtlas,
  configs: AtlasPageConfig[],
  explicit?: boolean,
): boolean {
  if (explicit !== undefined) return explicit;
  const values = atlas.pages.map((page) => (
    typeof page.pma === "boolean"
      ? page.pma
      : pageConfig(configs, page.name)?.premultipliedAlpha ?? false
  ));
  if (new Set(values).size > 1) {
    throw new Error("Atlas 包含混合 PMA（预乘 Alpha）纹理页，当前 Spine renderer 只能为整具 skeleton 使用一种混合模式");
  }
  return values[0] ?? false;
}

interface CreatedAtlas {
  atlas: RuntimeAtlas;
  premultipliedAlpha: boolean;
}

async function createAtlas(
  input: RuntimeLoadInput,
  context: WebGLRenderingContext,
  adapter: RuntimeAdapter,
  cancellation: LoadCancellation,
  explicitPremultipliedAlpha?: boolean,
): Promise<CreatedAtlas> {
  const configs = atlasPageConfigs(input.atlasText);
  const images = new Map<string, HTMLImageElement>();
  await Promise.all([...input.textureObjectUrls].map(async ([name, url]) => {
    images.set(name, await loadImage(url, cancellation));
  }));
  if (cancellation.isCancelled()) throw loadCancelledError();

  const { GLTexture, TextureAtlas } = adapter.constructors;
  if (adapter.atlasMode === "constructor-loader") {
    const createdTextures: Array<{ dispose?(): void }> = [];
    let atlas: RuntimeAtlas | null = null;
    try {
      atlas = new TextureAtlas(input.atlasText, (pageName: string) => {
        const texture = new GLTexture(
          context,
          textureForPage(images, pageName),
          pageConfig(configs, pageName)?.useMipMaps ?? false,
        );
        createdTextures.push(texture);
        return texture;
      });
      const premultipliedAlpha = atlasPremultipliedAlpha(atlas, configs, explicitPremultipliedAlpha);
      return { atlas, premultipliedAlpha };
    } catch (error) {
      if (atlas) atlas.dispose();
      else for (const texture of createdTextures) texture.dispose?.();
      throw error;
    }
  }

  const atlas = new TextureAtlas(input.atlasText);
  const createdTextures: Array<{ dispose?(): void }> = [];
  try {
    for (const page of atlas.pages) {
      const texture = new GLTexture(
        context,
        textureForPage(images, page.name),
        pageUsesMipMaps(page, pageConfig(configs, page.name)),
      );
      createdTextures.push(texture);
      if (page.setTexture) page.setTexture(texture);
      else page.texture = texture;
    }
    return {
      atlas,
      premultipliedAlpha: atlasPremultipliedAlpha(atlas, configs, explicitPremultipliedAlpha),
    };
  } catch (error) {
    // 4.0 TextureAtlas.dispose assumes every page already has a texture, so
    // dispose the successfully constructed subset ourselves on partial loads.
    for (const texture of createdTextures) texture.dispose?.();
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
      const atlasRegionName = entry.attachment.path?.trim()
        || entry.attachment.region?.name?.trim();
      if (!atlasRegionName) continue;
      result.push({
        skin: skin.name,
        slot: slot.name,
        name: atlasRegionName,
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
  private view: RuntimeView = { centerX: 0, centerY: 0, zoom: 1 };
  private disposed = false;
  private loadGeneration = 0;
  private pendingLoads = new Map<number, { cancel(): void }>();
  private premultipliedAlpha = false;

  constructor(version: SupportedSpineVersion, private readonly adapter: RuntimeAdapter) {
    this.version = version;
  }

  async load(input: RuntimeLoadInput): Promise<SkeletonMetadata> {
    if (this.disposed) throw new Error("Runtime bridge 已释放");
    if (this.atlas || this.renderer || this.state) throw new Error("Runtime bridge 已加载资源");
    if (this.version === "3.8" && input.alphaMode === undefined) {
      throw new Error("Spine 3.8 纹理的 Alpha 模式需要明确选择（预乘 PMA 或直通 Straight）。");
    }

    const generation = ++this.loadGeneration;
    for (const pending of this.pendingLoads.values()) pending.cancel();
    const cancellation = new LoadCancellation();
    let objectUrlsReleased = false;
    const releaseObjectUrls = (): void => {
      if (objectUrlsReleased) return;
      objectUrlsReleased = true;
      if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
      for (const url of new Set(input.textureObjectUrls.values())) URL.revokeObjectURL(url);
    };
    this.pendingLoads.set(generation, {
      cancel: () => {
        cancellation.cancel();
        releaseObjectUrls();
      },
    });

    let createdAtlas: CreatedAtlas | null = null;
    let renderer: RuntimeRenderer | null = null;
    let state: RuntimeAnimationState | null = null;
    try {
      const context = input.canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
      });
      if (!context) throw new Error("浏览器不支持 WebGL");

      createdAtlas = await createAtlas(
        input,
        context,
        this.adapter,
        cancellation,
        this.version === "3.8" ? input.alphaMode === "premultiplied" : undefined,
      );
      releaseObjectUrls();
      if (this.disposed || generation !== this.loadGeneration || cancellation.isCancelled()) {
        throw loadCancelledError();
      }

      const {
        AnimationState,
        AnimationStateData,
        AtlasAttachmentLoader,
        SceneRenderer,
        Skeleton,
        SkeletonBinary,
        SkeletonJson,
      } = this.adapter.constructors;
      const attachmentLoader = new AtlasAttachmentLoader(createdAtlas.atlas);
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

      const metadata = {
        animations: data.animations.map(({ name, duration }) => ({ name, duration })),
        skins: data.skins.map(({ name }) => name),
        slots: data.slots.map(({ name }) => name),
        regionAttachments: regionAttachmentMetadata(data, this.adapter),
      };
      if (this.disposed || generation !== this.loadGeneration || cancellation.isCancelled()) {
        throw loadCancelledError();
      }

      this.atlas = createdAtlas.atlas;
      this.canvas = input.canvas;
      this.renderer = renderer;
      this.skeleton = skeleton;
      this.state = state;
      this.premultipliedAlpha = createdAtlas.premultipliedAlpha;
      this.applyView();
      createdAtlas = null;
      renderer = null;
      state = null;

      return metadata;
    } catch (error) {
      const stale = this.disposed || generation !== this.loadGeneration || cancellation.isCancelled();
      cancellation.cancel();
      state?.clearTracks();
      renderer?.dispose();
      createdAtlas?.atlas.dispose();
      if (stale) throw loadCancelledError();
      throw error;
    } finally {
      releaseObjectUrls();
      this.pendingLoads.delete(generation);
    }
  }

  play(name: string, loop: boolean): void {
    if (!this.state) return;
    this.entry = this.state.setAnimation(0, name, loop);
    this.paused = false;
  }

  setLoop(loop: boolean): void {
    if (this.entry) this.entry.loop = loop;
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

  getBounds(): SkeletonBounds | null {
    if (!this.skeleton) return null;
    this.adapter.updateWorldTransform(this.skeleton);
    const offset = createRuntimeVector2();
    const size = createRuntimeVector2();
    this.skeleton.getBounds(offset, size);
    if (
      !Number.isFinite(offset.x)
      || !Number.isFinite(offset.y)
      || !Number.isFinite(size.x)
      || !Number.isFinite(size.y)
      || size.x <= 0
      || size.y <= 0
    ) {
      return null;
    }
    return { x: offset.x, y: offset.y, width: size.x, height: size.y };
  }

  setView(view: RuntimeView): void {
    this.view = {
      centerX: Number.isFinite(view.centerX) ? view.centerX : 0,
      centerY: Number.isFinite(view.centerY) ? view.centerY : 0,
      zoom: Number.isFinite(view.zoom) ? Math.min(100, Math.max(0.01, view.zoom)) : 1,
    };
    this.applyView();
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

    if (!this.paused) {
      const delta = Math.max(0, deltaSeconds);
      state.update(delta);
      this.adapter.updateSkeleton(skeleton, delta * this.speed);
    }
    state.apply(skeleton);

    // Mask attachments only for the renderer. Direct assignment preserves
    // attachment time, deform, and sequence state across this temporary hide.
    this.adapter.updateWorldTransform(skeleton);
    const hiddenAttachments: Array<[RuntimeSlot, unknown]> = [];
    for (const slot of skeleton.slots) {
      if (this.hiddenSlots.has(slot.data.name)) {
        hiddenAttachments.push([slot, slot.attachment]);
        slot.attachment = null;
      }
    }
    let rendererBegun = false;
    try {
      const gl = renderer.context?.gl;
      if (gl) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      renderer.begin();
      rendererBegun = true;
      renderer.drawSkeleton(skeleton, this.premultipliedAlpha);
    } finally {
      try {
        if (rendererBegun) renderer.end();
      } finally {
        for (const [slot, attachment] of hiddenAttachments) slot.attachment = attachment;
      }
    }
    return this.snapshot();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadGeneration += 1;
    for (const pending of this.pendingLoads.values()) pending.cancel();
    this.pendingLoads.clear();
    this.state?.clearTracks();
    this.renderer?.dispose();
    this.atlas?.dispose();
    this.atlas = null;
    this.canvas = null;
    this.renderer = null;
    this.skeleton = null;
    this.state = null;
    this.entry = null;
    this.premultipliedAlpha = false;
    this.hiddenSlots.clear();
  }

  private snapshot(): PlaybackSnapshot {
    const duration = this.entry?.animation?.duration ?? 0;
    const rawTime = this.entry?.trackTime ?? 0;
    const looping = Boolean(this.entry?.loop);
    const ended = Boolean(this.entry) && !looping && rawTime >= duration;
    const time = looping && duration > 0
      ? rawTime % duration
      : this.entry
        ? Math.min(rawTime, duration)
        : rawTime;
    return {
      animation: this.entry?.animation?.name ?? null,
      duration,
      playing: Boolean(this.entry) && !this.paused && !ended,
      time,
    };
  }

  private applyView(): void {
    const camera = this.renderer?.camera;
    if (!camera) return;
    if (camera.position) {
      camera.position.x = this.view.centerX;
      camera.position.y = this.view.centerY;
    }
    camera.zoom = 1 / this.view.zoom;
    camera.update();
  }
}

export function createRuntimeBridge(
  version: SupportedSpineVersion,
  adapter: RuntimeAdapter,
): SpineRuntimeBridge {
  return new RuntimeBridge(version, adapter);
}
