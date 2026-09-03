import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AtlasParseError, parseAtlas } from "@/lib/atlas/parse-atlas";

const oldAtlas = readFileSync(new URL("../fixtures/atlas-old.atlas", import.meta.url), "utf8");
const newAtlas = readFileSync(new URL("../fixtures/atlas-new.atlas", import.meta.url), "utf8");

describe("parseAtlas", () => {
  it.each([
    [oldAtlas, { x: 4, y: 8, packedWidth: 12, packedHeight: 20, originalWidth: 32, originalHeight: 40, offsetLeft: 3, offsetBottom: 5, rotation: 90 }],
    [newAtlas, { x: 4, y: 8, packedWidth: 12, packedHeight: 20, originalWidth: 32, originalHeight: 40, offsetLeft: 3, offsetBottom: 5, rotation: 90 }],
  ])("把 Atlas 字段标准化", (source, expected) => {
    expect(parseAtlas(source).regions[0]).toMatchObject(expected);
  });

  it("支持多页、保留未知字段，并将顶格 Region 属性视为 Region 属性", () => {
    const document = parseAtlas([
      "page-a.png",
      "size: 64, 64",
      "filter: Linear, Linear",
      "",
      "first",
      "rotate: false",
      "xy: 1, 2",
      "size: 3, 4",
      "orig: 3, 4",
      "offset: 0, 0",
      "custom-key: custom-value",
      "",
      "page-b.png",
      "size: 64, 64",
      "",
      "second",
      "rotate: 270",
      "bounds: 5, 6, 7, 8",
      "offsets: 1, 2, 9, 10",
    ].join("\n"));

    expect(document.pages.map((page) => page.name)).toEqual(["page-a.png", "page-b.png"]);
    expect(document.regions).toHaveLength(2);
    expect(document.regions[0]).toMatchObject({
      name: "first", pageName: "page-a.png", rotation: 0, custom: { "custom-key": "custom-value" },
    });
    expect(document.regions[1]).toMatchObject({
      name: "second", pageName: "page-b.png", x: 5, y: 6, packedWidth: 7, packedHeight: 8,
      originalWidth: 9, originalHeight: 10, offsetLeft: 1, offsetBottom: 2, rotation: 270,
    });
  });

  it.each([
    ["缺少页面", "xy: 0, 0", "MISSING_PAGE", "第 1 行"],
    ["负尺寸", "page.png\nsize: 64, 64\n\nbad\nrotate: false\nxy: 0, 0\nsize: -1, 2\norig: 1, 2\noffset: 0, 0", "INVALID_SIZE", "bad"],
    ["重复页面", "page.png\nsize: 64, 64\n\npage.png\nsize: 64, 64", "DUPLICATE_PAGE", "page.png"],
    ["不完整 Region", "page.png\nsize: 64, 64\n\nincomplete\nrotate: false\nxy: 0, 0", "INCOMPLETE_REGION", "incomplete"],
  ])("为%s提供带位置与建议的中文错误", (_caseName, source, code, subject) => {
    try {
      parseAtlas(source);
      throw new Error("Expected parseAtlas to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AtlasParseError);
      expect(error).toMatchObject({ code });
      expect((error as Error).message).toContain(subject);
      expect((error as Error).message).toContain("建议");
    }
  });
});
