import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAtlas } from "@/lib/atlas/parse-atlas";
import { planRegionRestore } from "@/lib/atlas/restore-math";
import { detectSpineVersion } from "@/lib/spine/version";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/official-spine");
const sources = JSON.parse(readFileSync(resolve(fixtureRoot, "SOURCES.json"), "utf8")) as {
  fixtures: Record<string, { editorVersion: string; files: Record<string, string> }>;
};

describe("官方 Spine fixtures", () => {
  it.each(Object.entries(sources.fixtures))("%s 文件与固定官方 revision 的 SHA-256 一致", (version, fixture) => {
    for (const [name, expected] of Object.entries(fixture.files)) {
      const bytes = readFileSync(resolve(fixtureRoot, version, name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(expected);
    }
  });

  it.each(Object.entries(sources.fixtures))("%s JSON 与 SKEL 均检测为对应版本", async (version, fixture) => {
    for (const name of ["spineboy-ess.json", "spineboy-ess.skel"]) {
      const bytes = readFileSync(resolve(fixtureRoot, version, name));
      const file = new File([bytes], name, { type: "application/octet-stream" });
      await expect(detectSpineVersion(file), name).resolves.toMatchObject({
        raw: fixture.editorVersion,
        majorMinor: version,
        supported: true,
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
