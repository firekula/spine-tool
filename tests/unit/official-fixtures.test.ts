import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAtlas } from "@/lib/atlas/parse-atlas";
import { planRegionRestore } from "@/lib/atlas/restore-math";
import { detectSpineVersion } from "@/lib/spine/version";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/official-spine");
const sources = JSON.parse(readFileSync(resolve(fixtureRoot, "SOURCES.json"), "utf8")) as {
  fixtures: Record<string, {
    revision: string;
    editorVersion: string;
    alphaMode?: "premultiplied" | "straight";
    skeletons?: { json?: string; skel?: string };
    files: Record<string, string | { source: string; sha256: string }>;
  }>;
};

describe("官方 Spine fixtures", () => {
  it.each(Object.entries(sources.fixtures))("%s 文件与固定官方 revision 的 SHA-256 一致", (version, fixture) => {
    for (const [name, expected] of Object.entries(fixture.files)) {
      const bytes = readFileSync(resolve(fixtureRoot, version, name));
      const sha256 = typeof expected === "string" ? expected : expected.sha256;
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(sha256);
    }
  });

  it.each(Object.entries(sources.fixtures))("%s 声明的 skeleton 均检测为对应版本", async (version, fixture) => {
    const skeletons = fixture.skeletons ?? {
      json: "spineboy-ess.json",
      skel: "spineboy-ess.skel",
    };
    for (const name of Object.values(skeletons)) {
      if (!name) continue;
      const bytes = readFileSync(resolve(fixtureRoot, version, name));
      const file = new File([bytes], name, { type: "application/octet-stream" });
      await expect(detectSpineVersion(file), name).resolves.toMatchObject({
        raw: fixture.editorVersion,
        majorMinor: version,
        supported: true,
      });
    }
  });

  it("3.5 JSON、Atlas、PNG 逐文件固定到同一官方 commit 与 SHA-256", () => {
    const fixture = sources.fixtures["3.5"]!;
    expect(fixture.alphaMode).toBe("premultiplied");
    expect(Object.keys(fixture.files).sort()).toEqual([
      "spineboy-pma.atlas",
      "spineboy-pma.png",
      "spineboy.json",
    ]);
    for (const record of Object.values(fixture.files)) {
      expect(record).toEqual({
        source: expect.stringContaining(`/${fixture.revision}/examples/spineboy/export/`),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    }
  });

  it("4.2 Atlas 的每个 Region 都能生成合法恢复计划", () => {
    const atlas = parseAtlas(readFileSync(resolve(fixtureRoot, "4.2/spineboy-pma.atlas"), "utf8"));
    const pages = new Map(atlas.pages.map((page) => [page.name, page]));
    const failures: string[] = [];
    for (const region of atlas.regions) {
      try {
        planRegionRestore(region, 1, pages.get(region.pageName));
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    expect(failures).toEqual([]);
  });
});
