import { deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

/** A test-owned RGBA PNG, generated without external fixture assets. */
export function makePng(
  width = 1,
  height = 1,
  rgba: readonly [number, number, number, number] = [220, 56, 70, 255],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const offset = y * (1 + width * 4);
    rows[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = offset + 1 + x * 4;
      rows[pixel] = rgba[0];
      rows[pixel + 1] = rgba[1];
      rows[pixel + 2] = rgba[2];
      rows[pixel + 3] = rgba[3];
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function atlasFor(pageName = "page.png", regions = ["square"]): string {
  return [
    pageName,
    "size: 1,1",
    "format: RGBA8888",
    "filter: Nearest,Nearest",
    "repeat: none",
    "pma: false",
    ...regions.flatMap((name, index) => [
      name,
      "bounds: 0,0,1,1",
      index === 0 ? "offsets: 0,0,1,1" : "offsets: 0,0,2,3",
      "rotate: 0",
      `index: ${index}`,
    ]),
  ].join("\n");
}

export function multiPageAtlas(): string {
  return `${atlasFor("page-a.png", ["first"])}\n\n${atlasFor("page-b.png", ["second"])}`;
}

export function skeletonJson(version = "4.2.0"): string {
  return JSON.stringify({
    skeleton: { hash: "self-built-e2e", spine: version, width: 1, height: 1 },
    bones: [{ name: "root" }],
    slots: [{ name: "body", bone: "root", attachment: "square" }],
    skins: [
      { name: "default", attachments: { body: { square: { type: "region", path: "square", width: 1, height: 1 } } } },
      { name: "winter", attachments: { body: { square: { type: "region", path: "square", width: 1, height: 1 } } } },
    ],
    animations: {
      idle: { bones: { root: { rotate: [{ value: 0 }, { time: 1, value: 12 }] } } },
      wave: { bones: { root: { rotate: [{ value: 0 }, { time: 0.5, value: -12 }] } } },
    },
  });
}

export function atlasFor38(pageName = "page.png"): string {
  return [
    pageName,
    "size: 1,1",
    "format: RGBA8888",
    "filter: Nearest,Nearest",
    "repeat: none",
    "square",
    "rotate: false",
    "xy: 0,0",
    "size: 1,1",
    "orig: 1,1",
    "offset: 0,0",
    "index: -1",
  ].join("\n");
}

export function skeletonJson38(version = "3.8.55"): string {
  return JSON.stringify({
    skeleton: { hash: "self-built-alpha-e2e", spine: version, width: 100, height: 100 },
    bones: [{ name: "root" }],
    slots: [{ name: "body", bone: "root", attachment: "square" }],
    skins: [{
      name: "default",
      attachments: { body: { square: { width: 100, height: 100 } } },
    }],
    animations: { idle: {} },
  });
}

export async function importFixture(
  page: Page,
  options: {
    atlas?: string;
    skeleton?: string;
    pngNames?: string[];
    pngBuffers?: Readonly<Record<string, Buffer>>;
  } = {},
): Promise<void> {
  const atlas = options.atlas ?? atlasFor();
  const skeleton = options.skeleton ?? skeletonJson();
  const pngNames = options.pngNames ?? ["page.png"];
  await page.locator('input[type="file"]').setInputFiles([
    { name: "hero.atlas", mimeType: "text/plain", buffer: Buffer.from(atlas) },
    { name: "hero.json", mimeType: "application/json", buffer: Buffer.from(skeleton) },
    ...pngNames.map((name) => ({
      name,
      mimeType: "image/png",
      buffer: options.pngBuffers?.[name] ?? makePng(),
    })),
  ]);
}

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}
