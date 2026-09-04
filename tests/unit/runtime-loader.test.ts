import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeBridge, type RuntimeAdapter } from "@/lib/spine/runtime-factory";
import { loadRuntimeModule } from "@/lib/spine/runtime-loader";
import { inferExportScale } from "@/lib/spine/scale-inference";
import type { RuntimeLoadInput } from "@/lib/spine/bridge-types";

const EXPECTED_SOURCES = {
  "3.5": {
    kind: "git-vendor",
    version: "3.5",
    revision: "afdbbc2044fb56c762d4e2eb54b63b1bb9276a48",
  },
  "3.6": {
    kind: "git-vendor",
    version: "3.6",
    revision: "654c20e5b0e523040b6366bbd1042510d2645134",
  },
  "3.7": {
    kind: "git-vendor",
    version: "3.7",
    revision: "9639bcc81722d7178fd9d1cdc1a3d55a4c91f989",
  },
  "3.8": {
    kind: "git-vendor",
    version: "3.8",
    revision: "8b4844bd4b193ba9e54487ed397a777993cbad56",
  },
  "4.0": { kind: "npm", version: "4.0.31", revision: "4.0.31" },
  "4.1": { kind: "npm", version: "4.1.56", revision: "4.1.56" },
  "4.2": { kind: "npm", version: "4.2.120", revision: "4.2.120" },
} as const;

const repositoryRoot = resolve(import.meta.dirname, "../..");

function verifierFixtureWithPatch(patch: string): { directory: string; manifest: string } {
  const directory = mkdtempSync(join(tmpdir(), "spine-runtime-patch-fixture-"));
  const vendorDirectory = join(directory, "vendor");
  cpSync(resolve(repositoryRoot, "vendor/spine-runtime-3.8"), vendorDirectory, { recursive: true });

  const patchPath = join(directory, "candidate.patch");
  writeFileSync(patchPath, patch);
  const patchRecord = {
    path: patchPath,
    sha256: createHash("sha256").update(patch).digest("hex"),
  };

  const provenancePath = join(vendorDirectory, "SOURCE.json");
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  provenance.patch = patchRecord;
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  const sourceManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "scripts/runtime-sources.json"), "utf8"));
  sourceManifest.runtimes["3.8"].patch = patchRecord;
  sourceManifest.runtimes["3.8"].vendorDirectory = vendorDirectory;
  const manifest = join(directory, "runtime-sources.json");
  writeFileSync(manifest, JSON.stringify(sourceManifest));
  return { directory, manifest };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loadRuntimeModule", () => {
  it.each(["3.5", "3.6", "3.7", "3.8", "4.0", "4.1", "4.2"] as const)(
    "为 %s 加载可实例化的对应官方 Runtime",
    async (version) => {
      const module = await loadRuntimeModule(version);

      expect(module.version).toBe(version);
      expect(module.source).toMatchObject(EXPECTED_SOURCES[version]);
      expect(module.capabilities).toEqual({
        skeletonJson: true,
        skeletonBinary: version !== "3.5" && version !== "3.6" && version !== "3.7",
      });
      expect(module.createBridge).toEqual(expect.any(Function));

      const skeletonData = new module.runtimeConstructors.SkeletonData();
      const skeleton = new module.runtimeConstructors.Skeleton(skeletonData);
      expect(skeleton.data).toBe(skeletonData);
      if (version === "4.1") {
        expect((skeleton as { update?: unknown }).update).toBeUndefined();
        expect((skeleton as { time?: unknown }).time).toBeUndefined();
      } else {
        const timedSkeleton = skeleton as unknown as { time: number; update(delta: number): void };
        timedSkeleton.update(0.25);
        expect(timedSkeleton.time).toBe(0.25);
      }
    },
  );

  it("为七个版本保留互不共享的 Skeleton 与 SkeletonData core 身份", async () => {
    const modules = await Promise.all(
      (["3.5", "3.6", "3.7", "3.8", "4.0", "4.1", "4.2"] as const).map(loadRuntimeModule),
    );

    expect(new Set(modules.map((module) => module.runtimeConstructors.Skeleton)).size).toBe(7);
    expect(new Set(modules.map((module) => module.runtimeConstructors.SkeletonData)).size).toBe(7);
  });

  it.each(["4.3"] as const)("为尚未安装的 %s Runtime 返回明确错误", async (version) => {
    await expect(loadRuntimeModule(version)).rejects.toThrow(`Spine ${version} 对应 Runtime 尚未安装`);
  });
});

describe("Runtime 资产验证", () => {
  it("默认严格重建 3.8 Runtime 且不依赖 npm cache", () => {
    const emptyCache = mkdtempSync(join(tmpdir(), "empty-npm-cache-"));
    try {
      const output = execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs")],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            NPM_CONFIG_CACHE: emptyCache,
            npm_config_cache: emptyCache,
            NPM_CONFIG_OFFLINE: "true",
            npm_config_offline: "true",
          },
          stdio: "pipe",
        },
      );

      expect(output).toContain("3.8: 已从固定归档与 patch 重建 Runtime");
    } finally {
      rmSync(emptyCache, { recursive: true, force: true });
    }
  });

  it("legacy vendor 拒绝与固定来源不符的 commit", () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "spine-runtime-source-"));
    const fixtureArchive = join(fixtureDirectory, "source.tar");
    writeFileSync(fixtureArchive, "not an official archive");
    try {
      expect(() => execFileSync(
        process.execPath,
        [
          resolve(repositoryRoot, "scripts/vendor-legacy-runtime.mjs"),
          "--version", "3.8",
          "--commit", "0000000000000000000000000000000000000000",
          "--archive", fixtureArchive,
        ],
        { cwd: repositoryRoot, encoding: "utf8", stdio: "pipe" },
      )).toThrow(/commit 与固定官方来源不符/);
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("legacy vendor 拒绝 SHA-256 不匹配的来源归档", () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "spine-runtime-source-"));
    const fixtureArchive = join(fixtureDirectory, "source.tar");
    writeFileSync(fixtureArchive, "not an official archive");
    try {
      expect(() => execFileSync(
        process.execPath,
        [
          resolve(repositoryRoot, "scripts/vendor-legacy-runtime.mjs"),
          "--version", "3.8",
          "--commit", "8b4844bd4b193ba9e54487ed397a777993cbad56",
          "--archive", fixtureArchive,
        ],
        { cwd: repositoryRoot, encoding: "utf8", stdio: "pipe" },
      )).toThrow(/来源归档 SHA-256 不匹配/);
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("验证版本、真实动态 chunk 来源、core 隔离、SHA-256 和许可", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs")],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(output).toContain("3.8: 已从固定归档与 patch 重建 Runtime");
    expect(output).toContain("已验证 8 条 Spine Runtime 固定来源");
    expect(output).toContain("已验证 7 个隔离 Spine Runtime chunk");
  });

  it("快速验证明确标记未进行严格重建", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs"), "--fast"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(output).toContain("快速验证完成：未重建 3.8 Runtime；不得用于 CI 或发布门禁");
    expect(output).not.toContain("3.8: 已从固定归档与 patch 重建 Runtime");
  });

  it("默认严格验证在固定 3.8 archive 缺失时失败", () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "spine-runtime-missing-archive-"));
    const fixtureManifest = join(fixtureDirectory, "runtime-sources.json");
    try {
      const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "scripts/runtime-sources.json"), "utf8"));
      manifest.runtimes["3.8"].archivePath = join(fixtureDirectory, "missing-source.tar.gz");
      writeFileSync(fixtureManifest, JSON.stringify(manifest));

      expect(() => execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs")],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, SPINE_RUNTIME_SOURCE_MANIFEST: fixtureManifest },
          stdio: "pipe",
        },
      )).toThrow(/严格重建所需的 3\.8 来源归档不存在/);
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("拒绝 3.8 兼容 patch 的 SHA-256 不匹配", () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "spine-runtime-patch-source-"));
    const fixtureManifest = join(fixtureDirectory, "runtime-sources.json");
    try {
      const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "scripts/runtime-sources.json"), "utf8"));
      manifest.runtimes["3.8"].patch.sha256 = "0".repeat(64);
      writeFileSync(fixtureManifest, JSON.stringify(manifest));

      expect(() => execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs"), "--fast"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, SPINE_RUNTIME_SOURCE_MANIFEST: fixtureManifest },
          stdio: "pipe",
        },
      )).toThrow(/patch SHA-256 不匹配/);
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    "spine-webgl.js",
    "spine-webgl.d.ts",
    "spine-webgl.js.map",
  ] as const)("拒绝 3.8 patch 未分别固定 %s 的上游与补丁构建 SHA-256", (artifact) => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "spine-runtime-patch-build-source-"));
    const fixtureManifest = join(fixtureDirectory, "runtime-sources.json");
    try {
      const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "scripts/runtime-sources.json"), "utf8"));
      delete manifest.runtimes["3.8"].buildArtifacts[artifact].patchedSha256;
      writeFileSync(fixtureManifest, JSON.stringify(manifest));

      expect(() => execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs"), "--fast"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, SPINE_RUNTIME_SOURCE_MANIFEST: fixtureManifest },
          stdio: "pipe",
        },
      )).toThrow(/上游与补丁构建 SHA-256/);
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("拒绝 patch 的 ---/+++ 文件头与 diff --git 声明路径不一致", () => {
    const original = readFileSync(resolve(repositoryRoot, "vendor/spine-runtime-3.8/patches/allow-3.8.75.patch"), "utf8");
    const malicious = original.replace(
      "--- a/spine-ts/core/src/SkeletonBinary.ts",
      "--- a/spine-ts/core/src/UnrelatedBinary.ts",
    );
    const fixture = verifierFixtureWithPatch(malicious);
    try {
      expect(() => execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs"), "--fast"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, SPINE_RUNTIME_SOURCE_MANIFEST: fixture.manifest },
          stdio: "pipe",
        },
      )).toThrow(/patch 文件头路径必须与 diff --git 声明一致/);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("拒绝以 +++ 开头伪装成文件头的 patch 新增代码", () => {
    const original = readFileSync(resolve(repositoryRoot, "vendor/spine-runtime-3.8/patches/allow-3.8.75.patch"), "utf8");
    const malicious = original
      .replace("@@ -81,8 +81,6 @@ module spine {", "@@ -81,8 +81,7 @@ module spine {")
      .replace(
        '-\t\t\t\t\tthrow new Error("Unsupported skeleton data, please export with a newer version of Spine.");',
        '-\t\t\t\t\tthrow new Error("Unsupported skeleton data, please export with a newer version of Spine.");\n+++compatBypass;',
      );
    const fixture = verifierFixtureWithPatch(malicious);
    try {
      expect(() => execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs"), "--fast"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, SPINE_RUNTIME_SOURCE_MANIFEST: fixture.manifest },
          stdio: "pipe",
        },
      )).toThrow(/patch 不允许新增代码/);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["非官方 resolved URL", "resolved", "https://example.invalid/spine-webgl-4.0.31.tgz"],
    ["不精确的 SRI", "integrity", "sha512-not-the-official-tarball"],
  ] as const)("拒绝 lockfile 中%s", (_label, field, invalidValue) => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "spine-runtime-lock-"));
    const fixtureLockfile = join(fixtureDirectory, "package-lock.json");
    try {
      const lockfile = JSON.parse(readFileSync(resolve(repositoryRoot, "package-lock.json"), "utf8"));
      const packagePath = "node_modules/@esotericsoftware/spine-webgl-4.0";
      lockfile.packages[packagePath][field] = invalidValue;
      writeFileSync(fixtureLockfile, JSON.stringify(lockfile));

      expect(() => execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs"), "--fast"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, SPINE_RUNTIME_LOCKFILE: fixtureLockfile },
          stdio: "pipe",
        },
      )).toThrow();
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    ["非官方 resolved URL", "resolved", "https://example.invalid/spine-core-4.3.9.tgz"],
    ["不精确的 SRI", "integrity", "sha512-tampered-core"],
  ] as const)("拒绝 lockfile 中 core 的%s", (_label, field, invalidValue) => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "spine-runtime-core-lock-"));
    const fixtureLockfile = join(fixtureDirectory, "package-lock.json");
    try {
      const lockfile = JSON.parse(readFileSync(resolve(repositoryRoot, "package-lock.json"), "utf8"));
      const corePath = "node_modules/@esotericsoftware/spine-webgl-4.3/node_modules/@esotericsoftware/spine-core";
      lockfile.packages[corePath][field] = invalidValue;
      writeFileSync(fixtureLockfile, JSON.stringify(lockfile));

      expect(() => execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs"), "--fast"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, SPINE_RUNTIME_LOCKFILE: fixtureLockfile },
          stdio: "pipe",
        },
      )).toThrow();
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    ["关键构建产物", (manifest: any) => {
      manifest.runtimes["4.3"].core.buildArtifacts["dist/index.js"] = "0".repeat(64);
    }],
    ["许可证", (manifest: any) => {
      manifest.runtimes["4.3"].core.licenseSha256 = "0".repeat(64);
    }],
    ["完整 dist tree", (manifest: any) => {
      manifest.runtimes["4.3"].core.distTreeSha256 = "0".repeat(64);
    }],
  ] as const)("拒绝 core 的%s SHA-256 不匹配", (_label, tamper) => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "spine-runtime-core-source-"));
    const fixtureManifest = join(fixtureDirectory, "runtime-sources.json");
    try {
      const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "scripts/runtime-sources.json"), "utf8"));
      tamper(manifest);
      writeFileSync(fixtureManifest, JSON.stringify(manifest));

      expect(() => execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs"), "--fast"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, SPINE_RUNTIME_SOURCE_MANIFEST: fixtureManifest },
          stdio: "pipe",
        },
      )).toThrow();
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

interface HarnessOptions {
  applyRestoresAttachment?: boolean;
  atlasMode?: "constructor-loader" | "page-setter";
  attachmentKey?: string;
  attachmentPath?: string;
  attachmentRegionName?: string;
  onTextureCreated?: () => void;
  pages?: Array<{ name: string }>;
  bounds?: { x: number; y: number; width: number; height: number };
  legacySkinApi?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const disposed = { atlas: 0, renderer: 0, state: 0, texture: 0 };
  const drawnAttachments: unknown[] = [];
  const drawPremultipliedAlpha: boolean[] = [];
  const skeletonDeltas: number[] = [];
  const textureMipMaps: boolean[] = [];
  const visibleAttachment = {
    width: 64,
    height: 32,
    path: options.attachmentPath ?? "body-region",
    region: options.attachmentRegionName ? { name: options.attachmentRegionName } : undefined,
  };
  const camera = {
    position: { x: 0, y: 0, z: 0 },
    zoom: 1,
    viewportWidth: 0,
    viewportHeight: 0,
  };
  let loadedSkeleton: Skeleton | null = null;
  let currentEntry: { animation: { name: string; duration: number }; trackTime: number; loop: boolean } | null = null;

  class TextureAtlas {
    pages = (options.pages ?? []).map(({ name }) => ({
      name,
      texture: null as { dispose?(): void } | null,
      setTexture(texture: { dispose?(): void }) {
        this.texture = texture;
      },
    }));
    regions: unknown[] = [];

    constructor(_atlasText?: string, textureLoader?: (pageName: string) => { dispose?(): void }) {
      if (textureLoader) {
        for (const page of this.pages) page.texture = textureLoader(page.name);
      }
    }

    dispose() {
      disposed.atlas += 1;
      for (const page of this.pages) page.texture?.dispose?.();
    }
  }

  class AtlasAttachmentLoader {}

  class SkeletonJson {
    readSkeletonData() {
      return skeletonData;
    }
  }

  class SkeletonBinary extends SkeletonJson {}

  class RegionAttachment {}

  class Skin {
    readonly attachments: Array<Record<string, unknown> | undefined>;

    constructor(public readonly name: string) {
      this.attachments = name === "default"
        ? [{ [options.attachmentKey ?? "body-region"]: visibleAttachment }]
        : [{ alternate: { width: 16, height: 8, path: "alternate-region" } }];
      if (options.legacySkinApi) {
        Object.defineProperties(this, {
          addSkin: { configurable: true, value: undefined },
          getAttachments: { configurable: true, value: undefined },
        });
      }
    }

    addSkin(skin: Skin) {
      events.push(`skin.add:${skin.name}`);
    }

    getAttachments() {
      return this.name === "default"
        ? [{ slotIndex: 0, name: options.attachmentKey ?? "body-region", attachment: visibleAttachment }]
        : [];
    }

    addAttachment(slotIndex: number, name: string, attachment: unknown) {
      const slot = this.attachments[slotIndex] ?? {};
      slot[name] = attachment;
      this.attachments[slotIndex] = slot;
      events.push(`skin.addAttachment:${slotIndex}:${name}`);
    }
  }

  const defaultSkin = new Skin("default");
  const alternateSkin = new Skin("alternate");
  const skeletonData = {
    animations: [{ name: "idle", duration: 2 }],
    skins: [defaultSkin, alternateSkin],
    slots: [{ name: "body" }],
    findSkin(name: string) {
      return this.skins.find((skin) => skin.name === name) ?? null;
    },
  };

  class SkeletonData {}

  class Skeleton {
    readonly slots: Array<{
      data: { name: string };
      attachment: unknown;
      setAttachment(attachment: unknown): void;
    }> = [{
      data: { name: "body" },
      attachment: visibleAttachment,
      setAttachment: (attachment: unknown) => {
        if (attachment === null) events.push("slot.hide");
        this.slots[0]!.attachment = attachment;
      },
    }];
    skin: Skin | null = defaultSkin;
    time = 0;

    constructor(public readonly data: typeof skeletonData) {
      loadedSkeleton = this;
    }

    update(delta: number) {
      this.time += delta;
      skeletonDeltas.push(delta);
      events.push("skeleton.update");
    }

    setSkin(skin: Skin | null) {
      this.skin = skin;
      events.push(`skeleton.skin:${skin?.name ?? "none"}`);
    }

    setSlotsToSetupPose() {}

    getBounds(
      offset: { x: number; y: number; set(x: number, y: number): void },
      size: { x: number; y: number; set(x: number, y: number): void },
    ) {
      const bounds = options.bounds ?? { x: -25, y: -10, width: 150, height: 90 };
      offset.set(bounds.x, bounds.y);
      size.set(bounds.width, bounds.height);
    }

  }

  class AnimationStateData {
    constructor(public readonly data: typeof skeletonData) {}
  }

  class AnimationState {
    timeScale = 1;
    private entry: { animation: { name: string; duration: number }; trackTime: number; loop: boolean } | null = null;

    update(delta: number) {
      if (this.entry) this.entry.trackTime += delta * this.timeScale;
      events.push("state.update");
    }

    apply(skeleton: Skeleton) {
      events.push("state.apply");
      if (options.applyRestoresAttachment) skeleton.slots[0]!.attachment = visibleAttachment;
    }

    setAnimation(_trackIndex: number, name: string, loop: boolean) {
      this.entry = { animation: { name, duration: 2 }, trackTime: 0, loop };
      currentEntry = this.entry;
      return this.entry;
    }

    clearTracks() {
      disposed.state += 1;
      this.entry = null;
    }
  }

  class GLTexture {
    constructor(_context: unknown, _image: unknown, useMipMaps = false) {
      textureMipMaps.push(useMipMaps);
      options.onTextureCreated?.();
    }

    dispose() {
      disposed.texture += 1;
    }
  }

  class SceneRenderer {
    readonly camera = {
      position: camera.position,
      get zoom() { return camera.zoom; },
      set zoom(value: number) { camera.zoom = value; },
      setViewport: (width: number, height: number) => {
        camera.viewportWidth = width;
        camera.viewportHeight = height;
        events.push(`camera.viewport:${width}x${height}`);
      },
      update: () => events.push("camera.update"),
    };

    constructor(private readonly canvas: HTMLCanvasElement, ..._args: unknown[]) {}

    begin() {
      events.push("renderer.begin");
    }

    drawSkeleton(skeleton: Skeleton, premultipliedAlpha = false) {
      events.push("renderer.draw");
      drawnAttachments.push(skeleton.slots[0]!.attachment);
      drawPremultipliedAlpha.push(premultipliedAlpha);
    }

    end() {
      events.push("renderer.end");
    }

    resize() {
      this.canvas.width = 1;
      this.canvas.height = 1;
    }

    dispose() {
      disposed.renderer += 1;
    }
  }

  const runtime = {
    capabilities: { skeletonJson: true, skeletonBinary: true },
    atlasMode: options.atlasMode ?? "page-setter",
    constructors: {
      TextureAtlas,
      AtlasAttachmentLoader,
      SkeletonJson,
      SkeletonBinary,
      Skeleton,
      SkeletonData,
      AnimationStateData,
      AnimationState,
      Skin,
      RegionAttachment,
      GLTexture,
      SceneRenderer,
    },
    isRegionAttachment: (attachment: unknown): attachment is { width: number; height: number } => (
      attachment === visibleAttachment
    ),
    enumerateAttachments: (skin: Skin) => skin.attachments.flatMap((slot, slotIndex) => (
      Object.entries(slot ?? {}).map(([name, attachment]) => ({ slotIndex, name, attachment }))
    )),
    addSkin: (target: Skin, source: Skin) => {
      for (const [slotIndex, slot] of source.attachments.entries()) {
        for (const [name, attachment] of Object.entries(slot ?? {})) {
          target.addAttachment(slotIndex, name, attachment);
        }
      }
    },
    updateSkeleton: (skeleton: unknown, delta: number) => (skeleton as Skeleton).update(delta),
    updateWorldTransform: () => events.push("skeleton.world"),
  } as unknown as RuntimeAdapter;

  const canvas = {
    width: 0,
    height: 0,
    style: { width: "", height: "" },
    getContext: () => ({}),
  } as unknown as HTMLCanvasElement;

  const input: RuntimeLoadInput = {
    atlasText: "",
    skeleton: { kind: "json", text: "{}" },
    textureObjectUrls: new Map(),
    canvas,
  };

  return {
    canvas,
    camera,
    currentEntry: () => currentEntry,
    disposed,
    drawPremultipliedAlpha,
    drawnAttachments,
    events,
    input,
    loadedSkeleton: () => loadedSkeleton,
    runtime,
    skeletonDeltas,
    textureMipMaps,
    visibleAttachment,
  };
}

function installImmediateImages(): void {
  class ImmediateImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", ImmediateImage);
}

function installDeferredImages(): Map<string, { succeed(): void; fail(): void }> {
  const requests = new Map<string, { succeed(): void; fail(): void }>();
  class DeferredImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(value: string) {
      requests.set(value, {
        succeed: () => this.onload?.(),
        fail: () => this.onerror?.(),
      });
    }
  }
  vi.stubGlobal("Image", DeferredImage);
  return requests;
}

describe("createRuntimeBridge", () => {
  it("3.5 legacy Skin 由 adapter 枚举 RegionAttachment", async () => {
    const harness = createHarness({ legacySkinApi: true });
    const bridge = createRuntimeBridge("3.5", harness.runtime);

    const metadata = await bridge.load({ ...harness.input, alphaMode: "premultiplied" });

    expect(metadata.regionAttachments).toEqual([{
      skin: "default",
      slot: "body",
      name: "body-region",
      width: 64,
      height: 32,
    }]);
  });

  it("3.5 legacy Skin 组合由 adapter 逐附件复制", async () => {
    const harness = createHarness({ legacySkinApi: true });
    const bridge = createRuntimeBridge("3.5", harness.runtime);
    await bridge.load({ ...harness.input, alphaMode: "premultiplied" });

    expect(() => bridge.setSkins(["default", "alternate"])).not.toThrow();
    expect(harness.events).toContain("skin.addAttachment:0:body-region");
    expect(harness.events).toContain("skin.addAttachment:0:alternate");
    expect(harness.events).toContain("skeleton.skin:bridge-composite");
  });

  it.each(["3.5", "3.6", "3.7"] as const)("Spine %s JSON-only adapter 对 SKEL 返回结构化能力错误且不触碰 WebGL", async (version) => {
    const harness = createHarness();
    const getContext = vi.fn();
    const jsonOnlyRuntime = {
      ...harness.runtime,
      capabilities: { skeletonJson: true, skeletonBinary: false },
      constructors: {
        ...harness.runtime.constructors,
        SkeletonBinary: undefined,
      },
    } as unknown as RuntimeAdapter;
    const bridge = createRuntimeBridge(version, jsonOnlyRuntime);

    await expect(bridge.load({
      ...harness.input,
      canvas: { ...harness.canvas, getContext } as unknown as HTMLCanvasElement,
      skeleton: { kind: "skel", bytes: new Uint8Array([1, 2, 3]) },
    })).rejects.toMatchObject({
      name: "RuntimeCapabilityError",
      code: "RUNTIME_CAPABILITY_UNSUPPORTED",
      details: [expect.stringMatching(new RegExp(`Spine ${version.replace(".", "\\.")}.*不支持 SKEL.*不会.*其他版本 Runtime`))],
    });
    expect(getContext).not.toHaveBeenCalled();
  });

  it.each([
    { version: "3.8", attachmentPath: "atlas/path-38", attachmentRegionName: undefined },
    { version: "4.0", attachmentPath: "", attachmentRegionName: "atlas/path-40" },
    { version: "4.1", attachmentPath: "atlas/path-41", attachmentRegionName: "ignored-region" },
    { version: "4.2", attachmentPath: "atlas/path-42", attachmentRegionName: undefined },
  ] as const)("$version 元数据使用 RegionAttachment 的真实 Atlas 路径而不是 skin alias key", async ({
    version,
    attachmentPath,
    attachmentRegionName,
  }) => {
    const harness = createHarness({
      attachmentKey: "skin-alias",
      attachmentPath,
      attachmentRegionName,
    });
    const bridge = createRuntimeBridge(version, harness.runtime);

    const metadata = await bridge.load({
      ...harness.input,
      alphaMode: version === "3.8" ? "straight" : undefined,
    });

    const atlasName = attachmentPath || attachmentRegionName;
    expect(metadata.regionAttachments).toEqual([{
      skin: "default",
      slot: "body",
      name: atlasName,
      width: 64,
      height: 32,
    }]);
    const inference = inferExportScale(metadata.regionAttachments.flatMap((attachment) => (
      attachment.name === atlasName
        ? [{
            regionName: atlasName,
            atlasWidth: 32,
            atlasHeight: 16,
            attachmentWidth: attachment.width,
            attachmentHeight: attachment.height,
          }]
        : []
    )));
    expect(inference).toMatchObject({ restoreMultiplier: 2, sampleCount: 1 });
  });

  it("在动画重新应用 attachment 后的每一帧清空隐藏插槽", async () => {
    const harness = createHarness({ applyRestoresAttachment: true });
    const bridge = createRuntimeBridge("4.1", harness.runtime);
    const metadata = await bridge.load(harness.input);

    expect(metadata).toEqual({
      animations: [{ name: "idle", duration: 2 }],
      skins: ["default", "alternate"],
      slots: ["body"],
      regionAttachments: [{
        skin: "default",
        slot: "body",
        name: "body-region",
        width: 64,
        height: 32,
      }],
    });

    bridge.play("idle", true);
    bridge.setSpeed(2);
    bridge.setHiddenSlots(new Set(["body"]));
    harness.events.length = 0;

    expect(bridge.frame(0.25)).toEqual({
      animation: "idle",
      duration: 2,
      playing: true,
      time: 0.5,
    });
    expect(harness.events).toEqual([
      "state.update",
      "skeleton.update",
      "state.apply",
      "skeleton.world",
      "renderer.begin",
      "renderer.draw",
      "renderer.end",
    ]);
    expect(harness.drawnAttachments).toEqual([null]);
    expect(harness.loadedSkeleton()?.slots[0]?.attachment).toBe(harness.visibleAttachment);

    harness.events.length = 0;
    bridge.frame(0.25);
    expect(harness.events.filter((event) => event === "state.apply")).toHaveLength(1);
    expect(harness.drawnAttachments).toEqual([null, null]);
  });

  it("绘制隐藏静态插槽后恢复 attachment，取消隐藏不会永久丢图", async () => {
    const harness = createHarness({ applyRestoresAttachment: false });
    const bridge = createRuntimeBridge("4.1", harness.runtime);
    await bridge.load(harness.input);

    bridge.setHiddenSlots(new Set(["body"]));
    bridge.frame(0.25);
    expect(harness.drawnAttachments).toEqual([null]);
    expect(harness.loadedSkeleton()?.slots[0]?.attachment).toBe(harness.visibleAttachment);

    bridge.setHiddenSlots(new Set());
    bridge.frame(0.25);
    expect(harness.drawnAttachments).toEqual([null, harness.visibleAttachment]);
  });

  it("按播放速度推进 skeleton 时间，暂停时不推进", async () => {
    const harness = createHarness();
    const bridge = createRuntimeBridge("4.2", harness.runtime);
    await bridge.load(harness.input);
    bridge.play("idle", true);
    bridge.setSpeed(2);

    bridge.frame(0.25);
    expect(harness.skeletonDeltas).toEqual([0.5]);
    expect(harness.loadedSkeleton()?.time).toBe(0.5);

    bridge.pause(true);
    bridge.frame(10);
    expect(harness.skeletonDeltas).toEqual([0.5]);
    expect(harness.loadedSkeleton()?.time).toBe(0.5);
  });

  it("重复 load 只提交最新结果，并取消较晚完成的旧 load", async () => {
    const requests = installDeferredImages();
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    const harness = createHarness({ pages: [{ name: "page.png" }] });
    const bridge = createRuntimeBridge("4.1", harness.runtime);
    const firstCanvas = { ...harness.canvas, style: { width: "", height: "" } } as HTMLCanvasElement;
    const secondCanvas = { ...harness.canvas, style: { width: "", height: "" } } as HTMLCanvasElement;
    const first = bridge.load({
      ...harness.input,
      canvas: firstCanvas,
      atlasText: "page.png\nsize: 2,2\nfilter: Linear,Linear\nrepeat: none\n",
      textureObjectUrls: new Map([["page.png", "blob:first"]]),
    });
    const second = bridge.load({
      ...harness.input,
      canvas: secondCanvas,
      atlasText: "page.png\nsize: 2,2\nfilter: Linear,Linear\nrepeat: none\n",
      textureObjectUrls: new Map([["page.png", "blob:second"]]),
    });

    requests.get("blob:second")!.succeed();
    await second;
    requests.get("blob:first")!.succeed();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    bridge.resize(100, 50, 1);
    expect(secondCanvas.width).toBe(100);
    expect(firstCanvas.width).toBe(0);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:second");
  });

  it("dispose 会取消待完成 load，且完成回调不能重新挂载资源", async () => {
    const requests = installDeferredImages();
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    const harness = createHarness({ pages: [{ name: "page.png" }] });
    const bridge = createRuntimeBridge("4.0", harness.runtime);
    const loading = bridge.load({
      ...harness.input,
      atlasText: "page.png\nsize: 2,2\nfilter: Linear,Linear\nrepeat: none\n",
      textureObjectUrls: new Map([["page.png", "blob:disposed"]]),
    });

    bridge.dispose();
    bridge.dispose();
    requests.get("blob:disposed")!.succeed();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:disposed");
    expect(harness.disposed).toEqual({ atlas: 0, renderer: 0, state: 0, texture: 0 });
  });

  it("dispose 在 GPU 纹理创建后抢占 load 时，过期资源仍由该 load 清理", async () => {
    installImmediateImages();
    vi.spyOn(URL, "revokeObjectURL");
    let bridge: ReturnType<typeof createRuntimeBridge>;
    const harness = createHarness({
      pages: [{ name: "page.png" }],
      onTextureCreated: () => queueMicrotask(() => bridge.dispose()),
    });
    bridge = createRuntimeBridge("4.2", harness.runtime);

    await expect(bridge.load({
      ...harness.input,
      atlasText: "page.png\nsize: 2,2\nfilter: Linear,Linear\nrepeat: none\n",
      textureObjectUrls: new Map([["page.png", "blob:gpu-stale"]]),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.disposed).toEqual({ atlas: 1, renderer: 0, state: 0, texture: 1 });
  });

  it.each([
    { atlasMode: "constructor-loader", version: "3.8" },
    { atlasMode: "page-setter", version: "4.0" },
  ] as const)("$version 按 Atlas filter 创建 mipmap，非 PMA page 使用普通 Alpha blending", async ({ atlasMode, version }) => {
    installImmediateImages();
    vi.spyOn(URL, "revokeObjectURL");
    const harness = createHarness({ atlasMode, pages: [{ name: "page.png" }] });
    const bridge = createRuntimeBridge(version, harness.runtime);
    await bridge.load({
      ...harness.input,
      alphaMode: version === "3.8" ? "straight" : undefined,
      atlasText: "page.png\nsize: 2,2\nfilter: MipMapLinearLinear,Linear\nrepeat: none\n",
      textureObjectUrls: new Map([["page.png", "blob:mipmap"]]),
    });

    expect(harness.textureMipMaps).toEqual([true]);
    bridge.frame(0);
    expect(harness.drawPremultipliedAlpha).toEqual([false]);
  });

  it.each([
    { version: "3.5", alphaMode: "premultiplied", expected: true },
    { version: "3.5", alphaMode: "straight", expected: false },
    { version: "3.8", alphaMode: "premultiplied", expected: true },
    { version: "3.8", alphaMode: "straight", expected: false },
  ] as const)("$version 明确选择 $alphaMode 后传入对应 renderer 混合模式", async ({ version, alphaMode, expected }) => {
    installImmediateImages();
    vi.spyOn(URL, "revokeObjectURL");
    const harness = createHarness({ atlasMode: "constructor-loader", pages: [{ name: "page.png" }] });
    const bridge = createRuntimeBridge(version, harness.runtime);

    await bridge.load({
      ...harness.input,
      alphaMode,
      atlasText: "page.png\nsize: 2,2\nfilter: Linear,Linear\nrepeat: none\n",
      textureObjectUrls: new Map([["page.png", `blob:${alphaMode}`]]),
    });
    bridge.frame(0);

    expect(harness.drawPremultipliedAlpha).toEqual([expected]);
  });

  it.each(["3.5", "3.8"] as const)("%s 缺少明确 Alpha 选择时拒绝加载，而不是硬编码 straight", async (version) => {
    installImmediateImages();
    vi.spyOn(URL, "revokeObjectURL");
    const harness = createHarness({ atlasMode: "constructor-loader", pages: [{ name: "page.png" }] });
    const bridge = createRuntimeBridge(version, harness.runtime);

    await expect(bridge.load({
      ...harness.input,
      atlasText: "page.png\nsize: 2,2\nfilter: Linear,Linear\nrepeat: none\n",
      textureObjectUrls: new Map([["page.png", "blob:missing-alpha-mode"]]),
    })).rejects.toThrow(new RegExp(`${version.replace(".", "\\.")}.*Alpha.*明确选择`));
  });

  it("3.8 Runtime 用规范化页面身份查找纹理与页面配置", async () => {
    installImmediateImages();
    vi.spyOn(URL, "revokeObjectURL");
    const harness = createHarness({
      atlasMode: "constructor-loader",
      pages: [{ name: ".\\./textures\\page.png" }],
    });
    const bridge = createRuntimeBridge("3.8", harness.runtime);

    await bridge.load({
      ...harness.input,
      alphaMode: "straight",
      atlasText: ".\\./textures\\page.png\nsize: 2,2\nfilter: MipMapLinearLinear,Linear\nrepeat: none\n",
      textureObjectUrls: new Map([["textures/page.png", "blob:normalized-page"]]),
    });

    expect(harness.textureMipMaps).toEqual([true]);
  });

  it("把 Atlas page 的 PMA=true 传给 renderer", async () => {
    installImmediateImages();
    vi.spyOn(URL, "revokeObjectURL");
    const harness = createHarness({ pages: [{ name: "page.png" }] });
    const bridge = createRuntimeBridge("4.0", harness.runtime);
    await bridge.load({
      ...harness.input,
      alphaMode: "straight",
      atlasText: "page.png\nsize: 2,2\nfilter: Linear,Linear\nrepeat: none\npma: true\n",
      textureObjectUrls: new Map([["page.png", "blob:pma"]]),
    });

    bridge.frame(0);
    expect(harness.drawPremultipliedAlpha).toEqual([true]);
  });

  it("拒绝 renderer 无法全局表达的多页混合 PMA", async () => {
    installImmediateImages();
    vi.spyOn(URL, "revokeObjectURL");
    const harness = createHarness({ pages: [{ name: "a.png" }, { name: "b.png" }] });
    const bridge = createRuntimeBridge("4.2", harness.runtime);

    await expect(bridge.load({
      ...harness.input,
      atlasText: [
        "a.png", "size: 2,2", "filter: Linear,Linear", "repeat: none", "pma: true", "",
        "b.png", "size: 2,2", "filter: Linear,Linear", "repeat: none", "pma: false", "",
      ].join("\n"),
      textureObjectUrls: new Map([["a.png", "blob:a"], ["b.png", "blob:b"]]),
    })).rejects.toThrow(/PMA|预乘/);
  });

  it("支持暂停、seek 和组合皮肤", async () => {
    const harness = createHarness();
    const bridge = createRuntimeBridge("4.1", harness.runtime);
    await bridge.load(harness.input);
    bridge.play("idle", false);

    bridge.frame(0.25);
    bridge.pause(true);
    expect(bridge.frame(1)).toMatchObject({ playing: false, time: 0.25 });

    bridge.seek(1.25);
    expect(bridge.frame(0)).toMatchObject({ playing: false, time: 1.25 });

    harness.events.length = 0;
    bridge.setSkins(["default", "alternate"]);
    expect(harness.events).toEqual([
      "skin.addAttachment:0:body-region",
      "skin.addAttachment:0:alternate",
      "skeleton.skin:bridge-composite",
    ]);
  });

  it("非循环动画到达结尾后把时间钳制到 duration 并停止播放", async () => {
    const harness = createHarness();
    const bridge = createRuntimeBridge("4.2", harness.runtime);
    await bridge.load(harness.input);
    bridge.play("idle", false);

    expect(bridge.frame(2.75)).toMatchObject({ duration: 2, time: 2, playing: false });
    expect(bridge.frame(1)).toMatchObject({ duration: 2, time: 2, playing: false });
  });

  it("返回当前整体 bounds，原位切换 loop，并用 Runtime 相机设置 view", async () => {
    const harness = createHarness({ bounds: { x: -40, y: 25, width: 180, height: 320 } });
    const bridge = createRuntimeBridge("4.2", harness.runtime);
    await bridge.load(harness.input);

    expect(bridge.getBounds()).toEqual({ x: -40, y: 25, width: 180, height: 320 });

    bridge.play("idle", true);
    bridge.frame(0.5);
    bridge.pause(true);
    bridge.seek(1.25);
    bridge.setLoop(false);
    expect(harness.currentEntry()).toMatchObject({ trackTime: 1.25, loop: false });
    expect(bridge.frame(0)).toMatchObject({ playing: false, time: 1.25 });

    bridge.resize(320, 180, 2);
    bridge.setView({ centerX: 37, centerY: -12, zoom: 2 });
    expect(harness.camera.position).toMatchObject({ x: 37, y: -12 });
    expect(harness.camera.zoom).toBe(0.5);
    expect(harness.canvas.width).toBe(640);
    expect(harness.canvas.height).toBe(360);
  });

  it("resize 使用 DPR 设置 backing store，dispose 幂等释放资源", async () => {
    const harness = createHarness();
    const bridge = createRuntimeBridge("4.1", harness.runtime);
    await bridge.load(harness.input);

    bridge.resize(320, 180, 2);
    expect(harness.canvas.width).toBe(640);
    expect(harness.canvas.height).toBe(360);
    expect(harness.canvas.style.width).toBe("320px");
    expect(harness.canvas.style.height).toBe("180px");
    expect(harness.events.slice(-2)).toEqual([
      "camera.viewport:320x180",
      "camera.update",
    ]);

    bridge.dispose();
    bridge.dispose();
    expect(harness.disposed).toEqual({ atlas: 1, renderer: 1, state: 1, texture: 0 });
  });
});
