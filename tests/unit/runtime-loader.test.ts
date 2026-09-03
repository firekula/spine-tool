import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntimeBridge, type RuntimeAdapter } from "@/lib/spine/runtime-factory";
import { loadRuntimeModule } from "@/lib/spine/runtime-loader";
import type { RuntimeLoadInput } from "@/lib/spine/bridge-types";

const EXPECTED_SOURCES = {
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

describe("loadRuntimeModule", () => {
  it.each(["3.8", "4.0", "4.1", "4.2"] as const)(
    "为 %s 加载可实例化的对应官方 Runtime",
    async (version) => {
      const module = await loadRuntimeModule(version);

      expect(module.version).toBe(version);
      expect(module.source).toMatchObject(EXPECTED_SOURCES[version]);
      expect(module.createBridge).toEqual(expect.any(Function));

      const skeletonData = new module.runtimeConstructors.SkeletonData();
      const skeleton = new module.runtimeConstructors.Skeleton(skeletonData);
      expect(skeleton.data).toBe(skeletonData);
    },
  );

  it("为四个版本保留互不共享的 Skeleton core 身份", async () => {
    const modules = await Promise.all(
      (["3.8", "4.0", "4.1", "4.2"] as const).map(loadRuntimeModule),
    );

    expect(new Set(modules.map((module) => module.runtimeConstructors.Skeleton)).size).toBe(4);
  });
});

describe("Runtime 资产验证", () => {
  it("验证版本、真实动态 chunk 来源、core 隔离、SHA-256 和许可", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-runtime-assets.mjs")],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(output).toContain("Verified 4 isolated Spine runtimes");
  });
});

function createHarness() {
  const events: string[] = [];
  const disposed = { atlas: 0, renderer: 0, state: 0 };
  const visibleAttachment = { width: 64, height: 32 };

  class TextureAtlas {
    pages: Array<{ name: string }> = [];
    regions: unknown[] = [];

    dispose() {
      disposed.atlas += 1;
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
    constructor(public readonly name: string) {}

    addSkin(skin: Skin) {
      events.push(`skin.add:${skin.name}`);
    }

    getAttachments() {
      return this.name === "default"
        ? [{ slotIndex: 0, name: "body-region", attachment: visibleAttachment }]
        : [];
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

    constructor(public readonly data: typeof skeletonData) {}

    setSkin(skin: Skin | null) {
      this.skin = skin;
      events.push(`skeleton.skin:${skin?.name ?? "none"}`);
    }

    setSlotsToSetupPose() {}

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
      skeleton.slots[0]!.attachment = visibleAttachment;
    }

    setAnimation(_trackIndex: number, name: string, loop: boolean) {
      this.entry = { animation: { name, duration: 2 }, trackTime: 0, loop };
      return this.entry;
    }

    clearTracks() {
      disposed.state += 1;
      this.entry = null;
    }
  }

  class GLTexture {}

  class SceneRenderer {
    readonly camera = {
      setViewport: (width: number, height: number) => events.push(`camera.viewport:${width}x${height}`),
      update: () => events.push("camera.update"),
    };

    constructor(private readonly canvas: HTMLCanvasElement, ..._args: unknown[]) {}

    begin() {
      events.push("renderer.begin");
    }

    drawSkeleton() {
      events.push("renderer.draw");
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

  const runtime: RuntimeAdapter = {
    atlasMode: "page-setter",
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
    isRegionAttachment: (attachment): attachment is { width: number; height: number } => (
      attachment === visibleAttachment
    ),
    updateWorldTransform: () => events.push("skeleton.world"),
  };

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

  return { canvas, disposed, events, input, runtime, visibleAttachment };
}

describe("createRuntimeBridge", () => {
  it("在动画重新应用 attachment 后的每一帧清空隐藏插槽", async () => {
    const harness = createHarness();
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
      "state.apply",
      "slot.hide",
      "skeleton.world",
      "renderer.begin",
      "renderer.draw",
      "renderer.end",
    ]);

    harness.events.length = 0;
    bridge.frame(0.25);
    expect(harness.events.filter((event) => event === "state.apply")).toHaveLength(1);
    expect(harness.events.filter((event) => event === "slot.hide")).toHaveLength(1);
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
      "skin.add:default",
      "skin.add:alternate",
      "skeleton.skin:bridge-composite",
    ]);
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
    expect(harness.disposed).toEqual({ atlas: 1, renderer: 1, state: 1 });
  });
});
