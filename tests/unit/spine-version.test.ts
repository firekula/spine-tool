import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifySpineVersion, detectSpineVersion } from "@/lib/spine/version";

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

function numericHashSkelHeader(version: string): Uint8Array {
  return new Uint8Array([
    0x12, 0x34, 0x56, 0x78,
    0x9a, 0xbc, 0xde, 0xf0,
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

  it("保留 SKEL 预发布版本并标记兼容风险", async () => {
    await expect(detectSpineVersion(binaryFile("hero.skel", skelHeader("4.3.0-beta"))))
      .resolves.toMatchObject({
        raw: "4.3.0-beta",
        majorMinor: "4.3",
        source: "skel-header",
        supported: true,
        compatibility: "prerelease",
      });
  });

  it.each([
    ["3.5.51", "3.5"], ["3.6.53", "3.6"], ["3.7.94", "3.7"],
    ["3.8.75", "3.8"], ["3.8.99", "3.8"], ["4.0.64", "4.0"],
    ["4.1.24", "4.1"], ["4.2.120", "4.2"], ["4.3.9", "4.3"],
  ])("将 %s 路由到 %s", async (raw, majorMinor) => {
    await expect(detectSpineVersion(file("hero.json", JSON.stringify({ skeleton: { spine: raw } }))))
      .resolves.toMatchObject({ raw, majorMinor, source: "json-field", supported: true });
  });

  it("标记 3.8.75 特殊兼容与 Beta 风险", () => {
    expect(classifySpineVersion("3.8.75", "json-field").compatibility).toBe("spine-3.8.75");
    expect(classifySpineVersion("4.3.0-beta", "json-field").compatibility).toBe("prerelease");
  });

  it.each(["4.3.bad", "4.3.", "4.3.9foo", "4.3.9-"])("严格拒绝格式不完整的 JSON 版本：%s", async (raw) => {
    await expect(detectSpineVersion(file("hero.json", JSON.stringify({ skeleton: { spine: raw } }))))
      .resolves.toMatchObject({ raw, majorMinor: null, source: "json-field", supported: false, compatibility: null });
  });

  it.each(["4.3-beta.", "4.3.0-beta..2", "4.3-."])("JSON、SKEL header 与 ASCII fallback 共用严格预发布语法：%s", async (raw) => {
    await expect(detectSpineVersion(file("hero.json", JSON.stringify({ skeleton: { spine: raw } }))))
      .resolves.toMatchObject({ raw, majorMinor: null, source: "json-field", supported: false, compatibility: null });
    await expect(detectSpineVersion(binaryFile("header.skel", skelHeader(raw))))
      .resolves.toEqual({ raw, majorMinor: null, source: "skel-header", supported: false, compatibility: null });
    const fallback = new Uint8Array([
      0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
      ...new TextEncoder().encode(` damaged ${raw} `),
    ]);
    await expect(detectSpineVersion(binaryFile("fallback.skel", fallback)))
      .resolves.toEqual({ raw: null, majorMinor: null, source: "unknown", supported: false, compatibility: null });
  });

  it.each(["4.3.9!", "4.3.9 "])("结构化 SKEL header 不通过 fallback 截短非法版本：%s", async (raw) => {
    const expected = { raw, majorMinor: null, source: "skel-header", supported: false, compatibility: null };
    await expect(detectSpineVersion(binaryFile("legacy.skel", skelHeader(raw))))
      .resolves.toEqual(expected);
    await expect(detectSpineVersion(binaryFile("numeric.skel", numericHashSkelHeader(raw))))
      .resolves.toEqual(expected);
  });

  it.each(["!4.3.9", "/4.3.9", " 4.3.9"])("结构化 SKEL header 不通过 fallback 跳过非法前缀：%s", async (raw) => {
    const expected = { raw, majorMinor: null, source: "skel-header", supported: false, compatibility: null };
    await expect(detectSpineVersion(binaryFile("legacy.skel", skelHeader(raw))))
      .resolves.toEqual(expected);
    await expect(detectSpineVersion(binaryFile("numeric.skel", numericHashSkelHeader(raw))))
      .resolves.toEqual(expected);
  });

  it.each([
    ["legacy", (version: string) => new Uint8Array([
      14,
      65, 65, 65, 65, 65, 65, 65,
      0x80, 0x80, 0x80, 0x80, 0x80,
      65,
      ...encodeString(version),
    ])],
    ["numeric", (version: string) => new Uint8Array([
      0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0, 0,
      ...encodeString(version),
    ])],
  ])("%s 结构化版本字符串超出 256-byte 探测窗口时禁止 ASCII 子串降级", async (_kind, makeHeader) => {
    const declaredVersion = `4.3.9 ${"x".repeat(300)}`;

    await expect(detectSpineVersion(binaryFile("truncated-structured.skel", makeHeader(declaredVersion))))
      .resolves.toEqual({
        raw: null,
        majorMinor: null,
        source: "unknown",
        supported: false,
        compatibility: null,
      });
  });

  it("numeric-hash 4.x 版本优先于前八字节偶然构造的 legacy 版本", async () => {
    const bytes = new Uint8Array([
      2, 120, 4, 52, 46, 51, 0, 0,
      ...encodeString("4.2.120"),
    ]);

    await expect(detectSpineVersion(binaryFile("adversarial-numeric.skel", bytes)))
      .resolves.toMatchObject({ raw: "4.2.120", majorMinor: "4.2", source: "skel-header", supported: true });
  });

  it("legacy 3.x 与 byte-8 偶然构造的 4.x 候选冲突时 fail closed", async () => {
    const hash = new Uint8Array([
      ...new TextEncoder().encode("1234567"),
      ...encodeString("4.2.120"),
      ...new TextEncoder().encode("xyz"),
    ]);
    const bytes = new Uint8Array([
      ...encodeString(new TextDecoder().decode(hash)),
      ...encodeString("3.8.99"),
    ]);

    await expect(detectSpineVersion(binaryFile("ambiguous-legacy.skel", bytes)))
      .resolves.toEqual({
        raw: null,
        majorMinor: null,
        source: "skel-header",
        supported: false,
        compatibility: null,
        runtimeBlocked: true,
        legacyAlphaRequired: true,
        legacyCandidate: "3.8",
      });
  });

  it("从官方完整 SKEL 读取 byte 8 numeric-hash 分支中的 4.x 预发布版本", async () => {
    const bytes = readFileSync(resolve(
      import.meta.dirname,
      "../fixtures/official-spine/4.3/spineboy-ess.skel",
    ));
    expect(bytes.byteLength).toBe(20_440);
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("3bc8ee724526458d7b0b745bd7a3d851d61a8063e4fa4b09afa9ca4825568156");
    expect(bytes[8]).toBe(12);
    expect(bytes.subarray(9, 20).toString("utf8")).toBe("4.3.75-beta");

    await expect(detectSpineVersion(binaryFile("numeric-hash.skel", bytes))).resolves.toMatchObject({
      raw: "4.3.75-beta",
      majorMinor: "4.3",
      source: "skel-header",
      supported: true,
      compatibility: "prerelease",
    });
  });

  it("将范围外 JSON 版本保留为未支持", async () => {
    const version = "3.4.1";
    await expect(detectSpineVersion(file("hero.json", JSON.stringify({ skeleton: { spine: version } }))))
      .resolves.toMatchObject({ raw: version, majorMinor: null, source: "json-field", supported: false });
  });

  it("在 JSON 缺少 skeleton.spine 时返回未知结构化结果", async () => {
    await expect(detectSpineVersion(file("hero.json", '{"skeleton":{}}')))
      .resolves.toEqual({ raw: null, majorMinor: null, source: "unknown", supported: false, compatibility: null });
  });

  it("为被截断的 SKEL 头返回未知结构化结果", async () => {
    await expect(detectSpineVersion(binaryFile("hero.skel", new Uint8Array(encodeString("hash")))))
      .resolves.toEqual({ raw: null, majorMinor: null, source: "unknown", supported: false, compatibility: null });
  });

  it("任一结构化槽位声明的字符串超出探测窗口时 fail closed 而不做 ASCII 恢复", async () => {
    const malformedHeader = new Uint8Array([
      0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
      ...new TextEncoder().encode(" damaged 4.2.120 "),
    ]);

    await expect(detectSpineVersion(binaryFile("hero.skel", malformedHeader)))
      .resolves.toEqual({ raw: null, majorMinor: null, source: "unknown", supported: false, compatibility: null });
  });

  it("不会扫描 SKEL 前 256 bytes 之后的版本文本", async () => {
    const bytes = new Uint8Array(300);
    bytes.set(new TextEncoder().encode("4.1.24"), 270);

    await expect(detectSpineVersion(binaryFile("hero.skel", bytes)))
      .resolves.toEqual({ raw: null, majorMinor: null, source: "unknown", supported: false, compatibility: null });
  });
});
