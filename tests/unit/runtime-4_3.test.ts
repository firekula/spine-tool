import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAdapter } from "@/lib/spine/runtime-4_3";
import type { RuntimeAdapter } from "@/lib/spine/runtime-factory";

const adapter: Readonly<RuntimeAdapter> = runtimeAdapter;

class TestWebGLRenderingContext {
  readonly canvas = {};
  readonly TEXTURE_2D = 3553;
  readonly TEXTURE0 = 33984;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 37440;
  readonly RGBA = 6408;
  readonly UNSIGNED_BYTE = 5121;
  readonly TEXTURE_MAG_FILTER = 10240;
  readonly TEXTURE_MIN_FILTER = 10241;
  readonly TEXTURE_WRAP_S = 10242;
  readonly TEXTURE_WRAP_T = 10243;
  readonly LINEAR = 9729;
  readonly LINEAR_MIPMAP_LINEAR = 9987;
  readonly CLAMP_TO_EDGE = 33071;
  readonly pixelStoreCalls: Array<[number, number | boolean]> = [];
  mipmapsGenerated = 0;

  createTexture() { return {}; }
  activeTexture() {}
  bindTexture() {}
  texImage2D() {}
  texParameteri() {}
  deleteTexture() {}
  getParameter() { return 7; }
  pixelStorei(parameter: number, value: number | boolean) {
    this.pixelStoreCalls.push([parameter, value]);
  }
  generateMipmap() { this.mipmapsGenerated += 1; }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Spine 4.3 真实 adapter", () => {
  it("公开冻结只读 adapter，并把逐页 pma 与 mipmap 传给真实 GLTexture", () => {
    vi.stubGlobal("WebGLRenderingContext", TestWebGLRenderingContext);

    expect(Object.isFrozen(adapter)).toBe(true);
    expect(adapter.capabilities).toEqual({ skeletonJson: true, skeletonBinary: true });
    expect(adapter.usesPerPagePremultipliedAlpha).toBe(true);

    const pmaContext = new TestWebGLRenderingContext();
    const pmaTexture = adapter.createTexture!(
      pmaContext as unknown as WebGLRenderingContext,
      {} as HTMLImageElement,
      true,
      false,
    );
    expect(pmaContext.pixelStoreCalls).toEqual([
      [pmaContext.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false],
      [pmaContext.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 7],
    ]);
    expect(pmaContext.mipmapsGenerated).toBe(0);
    pmaTexture.dispose?.();

    const straightContext = new TestWebGLRenderingContext();
    const straightTexture = adapter.createTexture!(
      straightContext as unknown as WebGLRenderingContext,
      {} as HTMLImageElement,
      false,
      true,
    );
    expect(straightContext.pixelStoreCalls).toEqual([
      [straightContext.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true],
      [straightContext.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 7],
    ]);
    expect(straightContext.mipmapsGenerated).toBe(1);
    straightTexture.dispose?.();
  });

  it("真实 4.3 draw hook 不把旧全局 PMA 参数误传成 slotRangeStart", () => {
    const drawSkeleton = vi.fn();
    const skeleton = {};

    adapter.drawSkeleton!({ drawSkeleton } as never, skeleton as never, true);

    expect(drawSkeleton).toHaveBeenCalledOnce();
    expect(drawSkeleton).toHaveBeenCalledWith(skeleton);
  });
});
