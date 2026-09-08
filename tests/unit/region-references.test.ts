import { describe, expect, it } from "vitest";
import { findRegionReferenceProblems } from "@/lib/atlas/region-references";
import type { AtlasDocument } from "@/lib/atlas/types";

function atlasWithRegions(...names: string[]): AtlasDocument {
  return {
    pages: [{ name: "page.png", width: 1, height: 1, custom: {} }],
    regions: names.map((name) => ({
      name,
      pageName: "page.png",
      index: -1,
      x: 0,
      y: 0,
      packedWidth: 1,
      packedHeight: 1,
      originalWidth: 1,
      originalHeight: 1,
      offsetLeft: 0,
      offsetBottom: 0,
      rotation: 0,
      custom: {},
    })),
  };
}

function skeletonWithAttachments(attachments: Record<string, Record<string, unknown>>): unknown {
  return { skeleton: { spine: "3.8.99" }, skins: [{ name: "default", attachments }] };
}

describe("findRegionReferenceProblems", () => {
  it("按 Atlas 解析结果裁剪后的 Region 名匹配附件 path", () => {
    const problems = findRegionReferenceProblems(
      atlasWithRegions("yanjing", "tou"),
      skeletonWithAttachments({ yanjing: { yanjing: { path: "yanjing ", x: 1 } } }),
    );

    expect(problems).toEqual([{
      kind: "outer-whitespace",
      slotName: "yanjing",
      attachmentName: "yanjing",
      referencedName: "yanjing ",
      atlasRegionName: "yanjing",
    }]);
  });

  it.each([
    ["末尾空格", "yanjing "],
    ["首部空格", " yanjing"],
    ["首尾空格", " yanjing "],
    ["制表符", "yanjing\t"],
  ])("识别 %s 造成的只差空白的引用", (_label, path) => {
    const problems = findRegionReferenceProblems(
      atlasWithRegions("yanjing"),
      skeletonWithAttachments({ yanjing: { yanjing: { path } } }),
    );

    expect(problems).toMatchObject([{ kind: "outer-whitespace", atlasRegionName: "yanjing" }]);
  });

  it("没有 path 时回退到附件名", () => {
    const problems = findRegionReferenceProblems(
      atlasWithRegions("tou"),
      skeletonWithAttachments({ tou: { "tou ": { width: 1, height: 1 } } }),
    );

    expect(problems).toMatchObject([{
      kind: "outer-whitespace",
      attachmentName: "tou ",
      referencedName: "tou ",
      atlasRegionName: "tou",
    }]);
  });

  it("Region 完全不存在时报告 missing 而不是空白差异", () => {
    const problems = findRegionReferenceProblems(
      atlasWithRegions("tou"),
      skeletonWithAttachments({ guo: { guo: { path: "missing" } } }),
    );

    expect(problems).toEqual([{
      kind: "missing",
      slotName: "guo",
      attachmentName: "guo",
      referencedName: "missing",
      atlasRegionName: undefined,
    }]);
  });

  it("精确匹配时不报告问题", () => {
    const problems = findRegionReferenceProblems(
      atlasWithRegions("yanjing", "tou", "tou2"),
      skeletonWithAttachments({
        yanjing: { yanjing: { path: "yanjing" } },
        tou: { tou2: { type: "region" } },
        shenti: { shenti: { type: "mesh", path: "tou" } },
      }),
    );

    expect(problems).toEqual([]);
  });

  it("跳过不需要 Atlas Region 的附件类型", () => {
    const problems = findRegionReferenceProblems(
      atlasWithRegions("tou"),
      skeletonWithAttachments({
        linked: { part: { type: "linkedmesh", path: "tou " } },
        bounds: { box: { type: "boundingbox", path: "tou " } },
        path: { road: { type: "path", path: "tou " } },
        clip: { mask: { type: "clipping", path: "tou " } },
        point: { p: { type: "point", path: "tou " } },
      }),
    );

    expect(problems).toEqual([]);
  });

  it("容忍缺少 skins 或 attachments 的骨架", () => {
    expect(findRegionReferenceProblems(atlasWithRegions("tou"), {})).toEqual([]);
    expect(findRegionReferenceProblems(atlasWithRegions("tou"), null)).toEqual([]);
    expect(findRegionReferenceProblems(atlasWithRegions("tou"), { skins: [{}] })).toEqual([]);
  });
});
