import { describe, expect, it, vi } from "vitest";
import type { ImportBundle } from "@/lib/files/import-files";
import {
  createRuntimeSession,
  prepareImport,
} from "@/lib/files/import-workflow";
import type { SpineRuntimeBridge, SpineRuntimeModule } from "@/lib/spine/bridge-types";

function pngHeader(width = 1, height = 1): Uint8Array {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(header.buffer).setUint32(8, 13);
  header.set([73, 72, 68, 82], 12);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  return header;
}

function bundle(textureNames = ["page.png"]): ImportBundle {
  const atlasText = [
    "page.png",
    "size: 1,1",
    "",
    "region",
    "bounds: 0,0,1,1",
    "offsets: 0,0,1,1",
  ].join("\n");
  return {
    atlasFile: new File([atlasText], "hero.atlas"),
    atlasText,
    skeletonFile: new File([JSON.stringify({ skeleton: { spine: "4.2.0" } })], "hero.json"),
    skeletonKind: "json",
    textureFiles: new Map(textureNames.map((name) => [name, new File([pngHeader()], name, { type: "image/png" })])),
    unusedTextures: [],
  };
}

function bridge(): SpineRuntimeBridge {
  return {
    version: "4.2",
    load: vi.fn(),
    play: vi.fn(),
    setLoop: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setSpeed: vi.fn(),
    setSkins: vi.fn(),
    setHiddenSlots: vi.fn(),
    getBounds: vi.fn(),
    setView: vi.fn(),
    resize: vi.fn(),
    frame: vi.fn(),
    dispose: vi.fn(),
  };
}

function regionBundle(atlasRegionName: string, attachment: Record<string, unknown>): ImportBundle {
  const atlasText = [
    "page.png",
    "size: 1,1",
    "",
    atlasRegionName,
    "bounds: 0,0,1,1",
    "offsets: 0,0,1,1",
  ].join("\n");
  const skeleton = {
    skeleton: { spine: "3.8.99" },
    skins: [{ name: "default", attachments: { yanjing: { yanjing: attachment } } }],
  };
  return {
    atlasFile: new File([atlasText], "厨师.atlas"),
    atlasText,
    skeletonFile: new File([JSON.stringify(skeleton)], "厨师.json"),
    skeletonKind: "json",
    textureFiles: new Map([["page.png", new File([pngHeader()], "page.png", { type: "image/png" })]]),
    unusedTextures: [],
  };
}

describe("import workflow resources", () => {
  it.each(["3.5", "3.6", "3.7"] as const)("Spine %s SKEL 在加载模块、bridge 和 object URL 前静态拒绝", async (version) => {
    const source = bundle();
    source.skeletonKind = "skel";
    source.skeletonFile = new File([new Uint8Array([1, 2, 3])], "hero.skel");
    const loadModule = vi.fn();
    const createObjectUrl = vi.fn();

    await expect(createRuntimeSession(source, version, {
      alphaMode: "straight",
      loadModule,
      createObjectUrl,
    })).rejects.toMatchObject({ code: "RUNTIME_CAPABILITY_UNSUPPORTED" });

    expect(loadModule).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it.each(["3.5", "3.6", "3.7", "3.8"] as const)("把 Spine %s 的明确 Alpha 选择写入 Runtime load input", async (version) => {
    const runtimeBridge = bridge();
    const session = await createRuntimeSession(bundle(), version, {
      alphaMode: "premultiplied",
      loadModule: async () => ({ createBridge: () => runtimeBridge } as SpineRuntimeModule),
      createObjectUrl: () => "blob:pma",
      revokeObjectUrl: vi.fn(),
    });

    expect(session.input.alphaMode).toBe("premultiplied");
    session.release();
  });

  it.each(["4.0", "4.1", "4.2", "4.3"] as const)("Spine %s 不接受显式 Alpha 选择覆盖 Atlas pma", async (version) => {
    const runtimeBridge = bridge();
    const session = await createRuntimeSession(bundle(), version, {
      alphaMode: "premultiplied",
      loadModule: async () => ({ createBridge: () => runtimeBridge } as SpineRuntimeModule),
      createObjectUrl: () => "blob:pma",
      revokeObjectUrl: vi.fn(),
    });

    expect(session.input.alphaMode).toBeUndefined();
    session.release();
  });

  it("按 Atlas 解析、版本检测、PNG 解码顺序准备可导出资源", async () => {
    const order: string[] = [];
    const bitmap = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    const result = await prepareImport(bundle(), {
      parseAtlas: (source) => {
        order.push("atlas");
        return { pages: [{ name: "page.png", width: 1, height: 1, custom: {} }], regions: [] };
      },
      detectVersion: async () => {
        order.push("version");
        return { raw: "4.2.0", majorMinor: "4.2", source: "json-field", supported: true, compatibility: "stable" };
      },
      decodeTexture: async () => {
        order.push("bitmap");
        return bitmap;
      },
    });

    expect(order).toEqual(["atlas", "version", "bitmap"]);
    expect(result.detected.majorMinor).toBe("4.2");
    expect(result.exportResources.textures.get("page.png")).toBe(bitmap);
    result.exportResources.release();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("PNG 解码后用真实尺寸解析省略或 0,0 的单页和多页 Atlas", async () => {
    const sizes = [{ width: 7, height: 8 }, { width: 9, height: 10 }];
    const source = bundle(["page.png", "page-2.png"]);
    source.textureFiles = new Map([
      ["page.png", new File([pngHeader(7, 8)], "page.png", { type: "image/png" })],
      ["page-2.png", new File([pngHeader(9, 10)], "page-2.png", { type: "image/png" })],
    ]);
    source.atlasText = [
      "page.png", "filter: Linear,Linear", "", "first", "bounds: 0,0,2,3", "offsets: 0,0,2,3", "",
      "page-2.png", "size: 0,0", "filter: Linear,Linear", "", "second", "bounds: 3,4,5,6", "offsets: 0,0,5,6",
    ].join("\n");
    let index = 0;

    const result = await prepareImport(source, {
      decodeTexture: async () => ({ ...sizes[index++]!, close: vi.fn() }) as unknown as ImageBitmap,
    });

    expect(result.exportResources.atlas.pages.map(({ width, height }) => ({ width, height })))
      .toEqual(sizes);
    result.exportResources.release();
  });

  it("在任何 PNG 解码前拒绝超过 64 个纹理页", async () => {
    const source = bundle(Array.from({ length: 65 }, (_, index) => `page-${index}.png`));
    const decodeTexture = vi.fn();

    await expect(prepareImport(source, { decodeTexture })).rejects.toMatchObject({
      code: "TEXTURE_MEMORY_BUDGET_EXCEEDED",
    });
    expect(decodeTexture).not.toHaveBeenCalled();
  });

  it("programmatic bundle 在 Atlas 解析和版本检测前也执行文件字节预算", async () => {
    const source = bundle();
    Object.defineProperty(source.skeletonFile, "size", {
      configurable: true,
      value: 128 * 1024 * 1024 + 1,
    });
    const parseAtlas = vi.fn();
    const detectVersion = vi.fn();

    await expect(prepareImport(source, { parseAtlas, detectVersion })).rejects.toMatchObject({
      code: "INPUT_FILE_SIZE_EXCEEDED",
    });
    expect(parseAtlas).not.toHaveBeenCalled();
    expect(detectVersion).not.toHaveBeenCalled();
  });

  it("按解码真实尺寸拒绝单页和累计纹理像素预算并关闭已解码页", async () => {
    for (const dimensions of [
      [{ width: 4_097, height: 4_097 }],
      Array.from({ length: 3 }, () => ({ width: 4_096, height: 4_096 })),
    ]) {
      const source = bundle(dimensions.map((_, index) => `page-${index}.png`));
      const decoded = dimensions.map(({ width, height }) => ({ width, height, close: vi.fn() })) as unknown as ImageBitmap[];
      let index = 0;

      await expect(prepareImport(source, {
        decodeTexture: async () => decoded[index++]!,
      })).rejects.toMatchObject({ code: "TEXTURE_MEMORY_BUDGET_EXCEEDED" });

      for (const bitmap of decoded.slice(0, index)) expect(bitmap.close).toHaveBeenCalledTimes(1);
    }
  });

  it("在调用解码器前按 PNG IHDR 拒绝压缩后很小的超大纹理", async () => {
    const source = bundle();
    const header = pngHeader(8_192, 8_192);
    source.textureFiles = new Map([["page.png", new File([header], "page.png", { type: "image/png" })]]);
    const decodeTexture = vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }) as unknown as ImageBitmap);

    await expect(prepareImport(source, { decodeTexture })).rejects.toMatchObject({
      code: "TEXTURE_MEMORY_BUDGET_EXCEEDED",
    });
    expect(decodeTexture).not.toHaveBeenCalled();
  });

  it("在调用浏览器解码器前拒绝仅改名为 .png 的非 PNG 图像", async () => {
    const source = bundle();
    const disguisedWebp = new Uint8Array(32);
    disguisedWebp.set(new TextEncoder().encode("RIFF"), 0);
    disguisedWebp.set(new TextEncoder().encode("WEBP"), 8);
    source.textureFiles = new Map([
      ["page.png", new File([disguisedWebp], "page.png", { type: "image/png" })],
    ]);
    const decodeTexture = vi.fn(async () => (
      { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap
    ));

    await expect(prepareImport(source, { decodeTexture })).rejects.toMatchObject({
      code: "IMAGE_DECODE_FAILED",
      subject: "page.png",
    });
    expect(decodeTexture).not.toHaveBeenCalled();
  });

  it.each([
    ["左侧", "bounds: -1,0,2,1"],
    ["上侧", "bounds: 0,-1,2,1"],
    ["右侧", "bounds: 3,0,2,1"],
    ["下侧", "bounds: 0,3,1,2"],
  ])("PNG 解码后按真实页面尺寸拒绝%s越界 Region", async (_side, bounds) => {
    const source = bundle();
    source.textureFiles = new Map([
      ["page.png", new File([pngHeader(4, 4)], "page.png", { type: "image/png" })],
    ]);
    source.atlasText = `page.png\nsize: 0,0\n\nregion\n${bounds}\noffsets: 0,0,2,1`;

    await expect(prepareImport(source, {
      decodeTexture: async () => ({ width: 4, height: 4, close: vi.fn() }) as unknown as ImageBitmap,
    })).rejects.toMatchObject({ code: "REGION_OUT_OF_BOUNDS" });
  });

  it("PNG 解码半途失败时关闭已经创建的 ImageBitmap", async () => {
    const first = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    let calls = 0;
    await expect(prepareImport(bundle(["page.png", "page-2.png"]), {
      decodeTexture: async () => {
        calls += 1;
        if (calls === 2) throw new Error("bad png");
        return first;
      },
    })).rejects.toThrow("bad png");

    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it("AbortSignal 在待解码页完成后立即停止后续页并关闭已解码 bitmap", async () => {
    const source = bundle(["page.png", "page-2.png"]);
    const controller = new AbortController();
    const first = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    const second = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    let resolveFirst!: (bitmap: ImageBitmap) => void;
    const decodeTexture = vi.fn()
      .mockImplementationOnce(() => new Promise<ImageBitmap>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(second);

    const pending = prepareImport(source, { signal: controller.signal, decodeTexture });
    await vi.waitFor(() => expect(decodeTexture).toHaveBeenCalledTimes(1));
    controller.abort();
    resolveFirst(first);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(decodeTexture).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });

  it("owner 释放后等待最后一个导出租约结束才关闭 ImageBitmap", async () => {
    const bitmap = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    const result = await prepareImport(bundle(), { decodeTexture: async () => bitmap });
    const firstLease = result.exportResources.acquire();
    const secondLease = result.exportResources.acquire();

    result.exportResources.release();
    result.exportResources.release();
    expect(bitmap.close).not.toHaveBeenCalled();

    firstLease.release();
    firstLease.release();
    expect(bitmap.close).not.toHaveBeenCalled();

    secondLease.release();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(() => result.exportResources.acquire()).toThrow(/已释放/);
  });

  it("先加载 Runtime 和创建 bridge，再创建 object URL，并可幂等释放", async () => {
    const order: string[] = [];
    const runtimeBridge = bridge();
    const runtimeModule = {
      createBridge: () => {
        order.push("bridge");
        return runtimeBridge;
      },
    } as SpineRuntimeModule;
    const revoke = vi.fn();
    const session = await createRuntimeSession(bundle(), "4.2", {
      loadModule: async () => {
        order.push("module");
        return runtimeModule;
      },
      createObjectUrl: () => {
        order.push("url");
        return "blob:page";
      },
      revokeObjectUrl: revoke,
    });

    expect(order).toEqual(["module", "bridge", "url"]);
    expect(session.input.textureObjectUrls.get("page.png")).toBe("blob:page");
    session.release();
    session.release();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(runtimeBridge.dispose).toHaveBeenCalledTimes(1);
  });

  it("Runtime session 在加载 module 或读取骨骼全文前防御性执行文件字节预算", async () => {
    const source = bundle();
    Object.defineProperty(source.skeletonFile, "size", {
      configurable: true,
      value: 128 * 1024 * 1024 + 1,
    });
    const loadModule = vi.fn();
    const skeletonText = vi.spyOn(source.skeletonFile, "text");

    await expect(createRuntimeSession(source, "4.2", { loadModule })).rejects.toMatchObject({
      code: "INPUT_FILE_SIZE_EXCEEDED",
    });
    expect(loadModule).not.toHaveBeenCalled();
    expect(skeletonText).not.toHaveBeenCalled();
  });

  it("object URL 创建半途失败时撤销已建 URL 并释放 bridge", async () => {
    const runtimeBridge = bridge();
    const revoke = vi.fn();
    let calls = 0;
    await expect(createRuntimeSession(bundle(["page.png", "page-2.png"]), "4.2", {
      loadModule: async () => ({ createBridge: () => runtimeBridge } as SpineRuntimeModule),
      createObjectUrl: () => {
        calls += 1;
        if (calls === 2) throw new Error("URL failed");
        return "blob:first";
      },
      revokeObjectUrl: revoke,
    })).rejects.toThrow("URL failed");

    expect(revoke).toHaveBeenCalledWith("blob:first");
    expect(runtimeBridge.dispose).toHaveBeenCalledTimes(1);
  });

  it("JSON path 与 Atlas Region 只差首尾空格时，在加载 Runtime 前给出精确诊断", async () => {
    const loadModule = vi.fn();
    const createObjectUrl = vi.fn();

    const error = await createRuntimeSession(regionBundle("yanjing", { path: "yanjing " }), "3.8", {
      alphaMode: "straight",
      loadModule,
      createObjectUrl,
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "REGION_REFERENCE_WHITESPACE_MISMATCH",
      subject: "Region「yanjing」",
    });
    const details = (error as { details?: string[] }).details ?? [];
    expect(details.join("\n")).toContain("「yanjing 」");
    expect(details.join("\n")).toContain("首尾空格");
    expect(loadModule).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("JSON 引用的 Region 完全不存在时报告缺失而不是空格差异", async () => {
    await expect(createRuntimeSession(regionBundle("yanjing", { path: "missing" }), "3.8", {
      alphaMode: "straight",
      loadModule: vi.fn(),
    })).rejects.toMatchObject({
      code: "REGION_REFERENCE_MISSING",
      subject: "Region「missing」",
    });
  });

  it("无法解析的 JSON 仍交给所选 Runtime 报告，而不是误报 Region 问题", async () => {
    const runtimeBridge = bridge();
    const source = regionBundle("yanjing", { path: "yanjing" });
    source.skeletonFile = new File(["not json"], "厨师.json");
    const loadModule = vi.fn(async () => ({ createBridge: () => runtimeBridge } as SpineRuntimeModule));

    const session = await createRuntimeSession(source, "3.8", {
      alphaMode: "straight",
      loadModule,
      createObjectUrl: () => "blob:page",
      revokeObjectUrl: vi.fn(),
    });

    expect(loadModule).toHaveBeenCalledTimes(1);
    session.release();
  });
});
