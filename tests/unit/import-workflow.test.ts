import { describe, expect, it, vi } from "vitest";
import type { ImportBundle } from "@/lib/files/import-files";
import {
  createRuntimeSession,
  prepareImport,
} from "@/lib/files/import-workflow";
import type { SpineRuntimeBridge, SpineRuntimeModule } from "@/lib/spine/bridge-types";

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
    textureFiles: new Map(textureNames.map((name) => [name, new File([name], name, { type: "image/png" })])),
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

describe("import workflow resources", () => {
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
        return { raw: "4.2.0", majorMinor: "4.2", source: "json-field", supported: true };
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
});
