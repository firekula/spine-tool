import { planRegionRestore, type PixelSize, type RegionRestorePlan } from "@/lib/atlas/restore-math";
import type { AtlasRegion } from "@/lib/atlas/types";
import type { TextureAlphaMode } from "@/lib/spine/bridge-types";

export interface RestoreRegionInput {
  region: AtlasRegion;
  texturePage: ImageBitmap;
  restoreMultiplier: number;
  /**
   * Pixel box the Region may read: the decoded PNG widened to the Atlas page
   * size. Pixels only the declared box covers are transparent, matching an
   * official export of a PNG whose right/bottom area was trimmed away. Defaults
   * to the decoded texture size.
   */
  sourceSize?: PixelSize;
  /** Pixel storage mode of the source Atlas page. PNG output is always straight alpha. */
  sourceAlphaMode?: TextureAlphaMode;
  /** Batch-scoped raw texture-page cache. The caller owns it and must clear it after the batch. */
  texturePixelCache?: TexturePixelCache;
  /** Cancels row rendering and the streaming PNG encoder between bounded work slices. */
  signal?: AbortSignal;
}

export interface RestoredRegion {
  blob: Blob;
  width: number;
  height: number;
  plan: RegionRestorePlan;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

export interface TexturePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type TexturePixelCache = Map<ImageBitmap, TexturePixels>;
export const MAX_RAW_TEXTURE_PIXELS = 16_777_216;

export function assertTextureReadBudget(regionName: string, size: PixelSize): void {
  const pixels = size.width * size.height;
  if (
    !Number.isSafeInteger(size.width)
    || !Number.isSafeInteger(size.height)
    || size.width <= 0
    || size.height <= 0
    || !Number.isSafeInteger(pixels)
    || pixels > MAX_RAW_TEXTURE_PIXELS
  ) {
    throw new Error(
      `Region「${regionName}」的纹理页原始像素超出浏览器安全预算（最大 ${MAX_RAW_TEXTURE_PIXELS} 像素）`,
    );
  }
}

function readTexturePixels(
  texturePage: ImageBitmap,
  regionName: string,
  cache?: TexturePixelCache,
  signal?: AbortSignal,
): TexturePixels {
  throwIfAborted(signal);
  assertTextureReadBudget(regionName, texturePage);
  const cached = cache?.get(texturePage);
  if (cached) return cached;
  const surface = canvas(1, 1);
  const gl = surface.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    stencil: false,
  }) ?? surface.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    stencil: false,
  });
  if (!gl) {
    throw new Error(`Region「${regionName}」无法创建无损像素读取所需的 WebGL context`);
  }
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) {
    if (texture) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Region「${regionName}」无法创建无损像素读取缓冲区`);
  }

  try {
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (texturePage.width > maxTextureSize || texturePage.height > maxTextureSize) {
      throw new Error(`Region「${regionName}」的纹理页超过浏览器无损读取上限 ${maxTextureSize}px`);
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texturePage);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Region「${regionName}」无法读取纹理页原始像素`);
    }

    const pixels = new Uint8Array(texturePage.width * texturePage.height * 4);
    gl.readPixels(
      0,
      0,
      texturePage.width,
      texturePage.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    throwIfAborted(signal);
    if (gl.getError() !== gl.NO_ERROR) {
      throw new Error(`Region「${regionName}」读取纹理页原始像素失败`);
    }
    const decoded = {
      width: texturePage.width,
      height: texturePage.height,
      data: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    };
    cache?.clear();
    cache?.set(texturePage, decoded);
    return decoded;
  } finally {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

function abortError(): Error {
  const error = new Error("Region 恢复已取消");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

async function yieldToBrowser(signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(signal);
}

function sourceOffsetForOriginalPixel(
  source: TexturePixels,
  plan: RegionRestorePlan,
  originalX: number,
  originalY: number,
): number {
  const x = originalX - plan.placement.x;
  const y = originalY - plan.placement.y;
  if (x < 0 || y < 0 || x >= plan.unrotated.width || y >= plan.unrotated.height) return -1;

  let packedX = x;
  let packedY = y;
  if (plan.rotation === 90) {
    packedX = y;
    packedY = plan.crop.height - 1 - x;
  } else if (plan.rotation === 180) {
    packedX = plan.crop.width - 1 - x;
    packedY = plan.crop.height - 1 - y;
  } else if (plan.rotation === 270) {
    packedX = plan.crop.width - 1 - y;
    packedY = x;
  }
  const pixelX = plan.crop.x + packedX;
  const pixelY = plan.crop.y + packedY;
  // Pixels the declared page box adds beyond the decoded PNG are transparent.
  // Returning -1 here keeps them out of both the direct and the resampled path,
  // instead of letting the offset wrap into the next stored row.
  if (pixelX < 0 || pixelY < 0 || pixelX >= source.width || pixelY >= source.height) return -1;
  return (pixelY * source.width + pixelX) * 4;
}

function straightChannel(value: number, alpha: number, mode: TextureAlphaMode): number {
  if (mode === "straight") return value;
  return alpha === 0 ? 0 : Math.min(255, Math.round(value * 255 / alpha));
}

function writeDirectPixel(
  row: Uint8Array,
  targetOffset: number,
  source: TexturePixels,
  sourceOffset: number,
  mode: TextureAlphaMode,
): void {
  if (sourceOffset < 0) return;
  const alpha = source.data[sourceOffset + 3]!;
  row[targetOffset] = straightChannel(source.data[sourceOffset]!, alpha, mode);
  row[targetOffset + 1] = straightChannel(source.data[sourceOffset + 1]!, alpha, mode);
  row[targetOffset + 2] = straightChannel(source.data[sourceOffset + 2]!, alpha, mode);
  row[targetOffset + 3] = alpha;
}

function accumulateSample(
  source: TexturePixels,
  sourceOffset: number,
  weight: number,
  mode: TextureAlphaMode,
  totals: Float64Array,
): void {
  if (sourceOffset < 0 || weight === 0) return;
  const alpha = source.data[sourceOffset + 3]!;
  totals[0] += alpha * weight;
  totals[1] += straightChannel(source.data[sourceOffset]!, alpha, mode) * alpha * weight;
  totals[2] += straightChannel(source.data[sourceOffset + 1]!, alpha, mode) * alpha * weight;
  totals[3] += straightChannel(source.data[sourceOffset + 2]!, alpha, mode) * alpha * weight;
}

function renderScanline(
  source: TexturePixels,
  plan: RegionRestorePlan,
  outputY: number,
  mode: TextureAlphaMode,
): Uint8Array {
  const row = new Uint8Array(plan.output.width * 4 + 1);
  const exactSize = plan.output.width === plan.original.width && plan.output.height === plan.original.height;
  if (exactSize) {
    for (let x = 0; x < plan.output.width; x += 1) {
      writeDirectPixel(
        row,
        1 + x * 4,
        source,
        sourceOffsetForOriginalPixel(source, plan, x, outputY),
        mode,
      );
    }
    return row;
  }

  const sourceY = (outputY + 0.5) * plan.original.height / plan.output.height - 0.5;
  const baseY = Math.floor(sourceY);
  const y0 = Math.max(0, Math.min(plan.original.height - 1, baseY));
  const y1 = Math.max(0, Math.min(plan.original.height - 1, baseY + 1));
  const fy = Math.max(0, Math.min(1, sourceY - baseY));
  const totals = new Float64Array(4);
  for (let x = 0; x < plan.output.width; x += 1) {
    const sourceX = (x + 0.5) * plan.original.width / plan.output.width - 0.5;
    const baseX = Math.floor(sourceX);
    const x0 = Math.max(0, Math.min(plan.original.width - 1, baseX));
    const x1 = Math.max(0, Math.min(plan.original.width - 1, baseX + 1));
    const fx = Math.max(0, Math.min(1, sourceX - baseX));
    totals.fill(0);
    accumulateSample(source, sourceOffsetForOriginalPixel(source, plan, x0, y0), (1 - fx) * (1 - fy), mode, totals);
    accumulateSample(source, sourceOffsetForOriginalPixel(source, plan, x1, y0), fx * (1 - fy), mode, totals);
    accumulateSample(source, sourceOffsetForOriginalPixel(source, plan, x0, y1), (1 - fx) * fy, mode, totals);
    accumulateSample(source, sourceOffsetForOriginalPixel(source, plan, x1, y1), fx * fy, mode, totals);
    const targetOffset = 1 + x * 4;
    row[targetOffset + 3] = Math.round(totals[0]!);
    if (totals[0]! > 0) {
      row[targetOffset] = Math.round(totals[1]! / totals[0]!);
      row[targetOffset + 1] = Math.round(totals[2]! / totals[0]!);
      row[targetOffset + 2] = Math.round(totals[3]! / totals[0]!);
    }
  }
  return row;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC_TABLE.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  CRC_TABLE[value] = crc >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let offset = 4; offset < 8 + data.byteLength; offset += 1) {
    crc = CRC_TABLE[(crc ^ chunk[offset]!) & 0xff]! ^ (crc >>> 8);
  }
  view.setUint32(8 + data.byteLength, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

async function encodeStraightPng(
  source: TexturePixels,
  plan: RegionRestorePlan,
  sourceAlphaMode: TextureAlphaMode,
  regionName: string,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  if (typeof CompressionStream === "undefined") {
    throw new Error(`Region「${regionName}」的无损 PNG 编码需要支持 CompressionStream 的新版浏览器`);
  }
  let outputY = 0;
  let pixelsSinceYield = 0;
  const scanlines = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (pixelsSinceYield >= 65_536) {
          pixelsSinceYield = 0;
          await yieldToBrowser(signal);
        }
        throwIfAborted(signal);
        if (outputY >= plan.output.height) {
          controller.close();
          return;
        }
        controller.enqueue(renderScanline(source, plan, outputY, sourceAlphaMode));
        outputY += 1;
        pixelsSinceYield += plan.output.width;
      } catch (error) {
        controller.error(error);
      }
    },
  });
  const reader = scanlines.pipeThrough(new CompressionStream("deflate")).getReader();
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, plan.output.width);
  view.setUint32(4, plan.output.height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts: BlobPart[] = [PNG_SIGNATURE, pngChunk("IHDR", header)];
  const onAbort = () => { void reader.cancel(abortError()); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      for (let offset = 0; offset < value.byteLength; offset += 1024 * 1024) {
        throwIfAborted(signal);
        parts.push(pngChunk("IDAT", value.subarray(offset, offset + 1024 * 1024)));
      }
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the original restore/cancellation error.
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  parts.push(pngChunk("IEND", new Uint8Array()));
  return new Blob(parts, { type: "image/png" });
}

export async function restoreRegion(input: RestoreRegionInput): Promise<RestoredRegion> {
  const {
    region,
    texturePage,
    restoreMultiplier,
    sourceSize,
    sourceAlphaMode = "straight",
    texturePixelCache,
    signal,
  } = input;
  throwIfAborted(signal);
  const plan = planRegionRestore(region, restoreMultiplier, sourceSize ?? {
    width: texturePage.width,
    height: texturePage.height,
  });
  const source = readTexturePixels(texturePage, region.name, texturePixelCache, signal);

  return {
    blob: await encodeStraightPng(source, plan, sourceAlphaMode, region.name, signal),
    width: plan.output.width,
    height: plan.output.height,
    plan,
  };
}
