import { describe, expect, it } from "vitest";
import { detectSpineVersion } from "@/lib/spine/version";

function file(name: string, contents: string): File {
  return new File([contents], name, { type: "application/octet-stream" });
}

function binaryFile(name: string, bytes: Uint8Array): File {
  return new File([bytes], name, { type: "application/octet-stream" });
}

function encodeString(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  const byteCount = bytes.length + 1;
  const encoded: number[] = [];
  let remaining = byteCount;

  while (remaining >= 0x80) {
    encoded.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  encoded.push(remaining);
  return [...encoded, ...bytes];
}

function skelHeader(version: string): Uint8Array {
  return new Uint8Array([
    ...encodeString("test-hash"),
    ...encodeString(version),
  ]);
}

describe("detectSpineVersion", () => {
  it("读取 JSON skeleton.spine", async () => {
    await expect(detectSpineVersion(file("hero.json", '{"skeleton":{"spine":"4.1.24"}}')))
      .resolves.toMatchObject({ raw: "4.1.24", majorMinor: "4.1", source: "json-field", supported: true });
  });

  it("读取 SKEL 的版本字符串", async () => {
    await expect(detectSpineVersion(binaryFile("hero.skel", skelHeader("3.8.99"))))
      .resolves.toMatchObject({ raw: "3.8.99", majorMinor: "3.8", source: "skel-header", supported: true });
  });

  it.each(["3.8.99", "4.0.1", "4.1.24", "4.2.120"])("仅将 %s 标记为受支持的版本", async (version) => {
    await expect(detectSpineVersion(binaryFile("hero.skel", skelHeader(version))))
      .resolves.toMatchObject({ majorMinor: version.slice(0, 3), supported: true });
  });

  it.each(["3.7.94", "4.3.1"])("将范围外 JSON 版本 %s 保留为未支持", async (version) => {
    await expect(detectSpineVersion(file("hero.json", JSON.stringify({ skeleton: { spine: version } }))))
      .resolves.toMatchObject({ raw: version, majorMinor: null, source: "json-field", supported: false });
  });

  it("在 JSON 缺少 skeleton.spine 时返回未知结构化结果", async () => {
    await expect(detectSpineVersion(file("hero.json", '{"skeleton":{}}')))
      .resolves.toEqual({ raw: null, majorMinor: null, source: "unknown", supported: false });
  });

  it("为被截断的 SKEL 头返回未知结构化结果", async () => {
    await expect(detectSpineVersion(binaryFile("hero.skel", new Uint8Array(encodeString("hash")))))
      .resolves.toEqual({ raw: null, majorMinor: null, source: "unknown", supported: false });
  });

  it("在超长 varint 后以受控 ASCII 扫描恢复版本", async () => {
    const malformedHeader = new Uint8Array([
      0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
      ...new TextEncoder().encode(" damaged 4.2.120 "),
    ]);

    await expect(detectSpineVersion(binaryFile("hero.skel", malformedHeader)))
      .resolves.toMatchObject({ raw: "4.2.120", majorMinor: "4.2", source: "ascii-fallback", supported: true });
  });

  it("不会扫描 SKEL 前 256 bytes 之后的版本文本", async () => {
    const bytes = new Uint8Array(300);
    bytes.set(new TextEncoder().encode("4.1.24"), 270);

    await expect(detectSpineVersion(binaryFile("hero.skel", bytes)))
      .resolves.toEqual({ raw: null, majorMinor: null, source: "unknown", supported: false });
  });
});
