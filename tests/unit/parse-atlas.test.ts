import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AtlasParseError, parseAtlas } from "@/lib/atlas/parse-atlas";

const oldAtlas = readFileSync(new URL("../fixtures/atlas-old.atlas", import.meta.url), "utf8");
const newAtlas = readFileSync(new URL("../fixtures/atlas-new.atlas", import.meta.url), "utf8");

describe("parseAtlas", () => {
  it("拒绝空 Atlas 并指出需要纹理页", () => {
    expect(() => parseAtlas("\n \n")).toThrowError(expect.objectContaining({
      code: "MISSING_PAGE",
      pageName: undefined,
      regionName: undefined,
    }));
  });

  it.each([
    "page.png\nsize: 64,\n",
    "page.png\nsize: ,64\n",
    "page.png\nsize: 64,64\n\nregion\nxy: ,0\nsize: 1,1\norig: 1,1\noffset: 0,0",
  ])("拒绝包含空数字分量的属性：%s", (source) => {
    expect(() => parseAtlas(source)).toThrowError(expect.objectContaining({ code: "INVALID_VALUE" }));
  });

  it("分别标记纹理页与 Region 错误对象", () => {
    try {
      parseAtlas("page.png\nsize: -1,64");
      throw new Error("Expected page error");
    } catch (error) {
      expect(error).toMatchObject({ pageName: "page.png", regionName: undefined });
    }

    try {
      parseAtlas("page.png\nsize: 64,64\n\nbad\nxy: 0,0");
      throw new Error("Expected region error");
    } catch (error) {
      expect(error).toMatchObject({ pageName: "page.png", regionName: "bad" });
    }
  });

  it.each([
    [oldAtlas, { x: 4, y: 8, packedWidth: 20, packedHeight: 12, originalWidth: 32, originalHeight: 40, offsetLeft: 3, offsetBottom: 5, rotation: 90 }],
    [newAtlas, { x: 4, y: 8, packedWidth: 20, packedHeight: 12, originalWidth: 32, originalHeight: 40, offsetLeft: 3, offsetBottom: 5, rotation: 90 }],
  ])("把 Atlas 字段标准化", (source, expected) => {
    expect(parseAtlas(source).regions[0]).toMatchObject(expected);
  });

  it("接受 Spine 4.2 省略 offsets 的未裁边 Region，并补齐零边距与原始尺寸", () => {
    const document = parseAtlas([
      "page.png",
      "\tsize: 64, 64",
      "\tfilter: Linear, Linear",
      "\tpma: true",
      "region",
      "\tbounds: 5, 6, 7, 8",
    ].join("\n"));

    expect(document.regions[0]).toMatchObject({
      name: "region",
      x: 5,
      y: 6,
      packedWidth: 7,
      packedHeight: 8,
      originalWidth: 7,
      originalHeight: 8,
      offsetLeft: 0,
      offsetBottom: 0,
    });
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
      name: "second", pageName: "page-b.png", x: 5, y: 6, packedWidth: 8, packedHeight: 7,
      originalWidth: 9, originalHeight: 10, offsetLeft: 1, offsetBottom: 2, rotation: 270,
    });
  });

  it("把页面身份规范化后写入 Page 与 Region，并拒绝规范化碰撞", () => {
    const document = parseAtlas([
      ".\\./textures\\page.png",
      "size: 16,16",
      "",
      "region",
      "xy: 0,0",
      "size: 1,1",
      "orig: 1,1",
      "offset: 0,0",
    ].join("\n"));

    expect(document.pages[0]?.name).toBe("textures/page.png");
    expect(document.regions[0]?.pageName).toBe("textures/page.png");

    expect(() => parseAtlas([
      "textures/page.png",
      "size: 16,16",
      "",
      "./textures\\page.png",
      "size: 16,16",
    ].join("\n"))).toThrowError(expect.objectContaining({
      code: "DUPLICATE_PAGE",
      pageName: "textures/page.png",
    }));
  });

  it.each([
    ["0.5", 0.5],
    ["1", 1],
    ["2", 2],
  ])("把 page scale %s 解析为正有限数值 %s", (sourceScale, expected) => {
    const document = parseAtlas(`page.png\nsize: 16,16\nscale: ${sourceScale}`);

    expect(document.pages[0]?.scale).toBe(expected);
    expect(document.pages[0]?.custom).not.toHaveProperty("scale");
  });

  it.each(["0", "-1", "NaN", "Infinity", ""])("拒绝无效 page scale：%s", (scale) => {
    expect(() => parseAtlas(`page.png\nsize: 16,16\nscale: ${scale}`))
      .toThrowError(expect.objectContaining({ code: expect.stringMatching(/INVALID_(?:SIZE|VALUE)/) }));
  });

  it("将以页面专属属性或自定义属性开头的后续属性块识别为新页", () => {
    const document = parseAtlas([
      "page-a.png",
      "size: 64, 64",
      "",
      "first",
      "rotate: false",
      "xy: 0, 0",
      "size: 1, 1",
      "orig: 1, 1",
      "offset: 0, 0",
      "",
      "page-b.png",
      "CustomPageFlag: enabled",
      "format: RGBA8888",
      "filter: Linear, Linear",
      "repeat: none",
      "pma: true",
      "size: 32, 32",
    ].join("\n"));

    expect(document.pages.map((page) => page.name)).toEqual(["page-a.png", "page-b.png"]);
    expect(document.pages[1]?.custom).toMatchObject({ CustomPageFlag: "enabled", format: "RGBA8888" });
    expect(document.regions).toHaveLength(1);
  });

  it("将空行后先写 size 的 Region 属性块保留为 Region", () => {
    const document = parseAtlas([
      "page.png",
      "size: 64, 64",
      "",
      "first",
      "rotate: false",
      "xy: 0, 0",
      "size: 1, 1",
      "orig: 1, 1",
      "offset: 0, 0",
      "",
      "second",
      "size: 3, 4",
      "rotate: false",
      "xy: 5, 6",
      "orig: 3, 4",
      "offset: 0, 0",
    ].join("\n"));

    expect(document.pages).toHaveLength(1);
    expect(document.regions[1]).toMatchObject({ name: "second", x: 5, y: 6, packedWidth: 3, packedHeight: 4 });
  });

  it("按原始大小写保留未知 Page 与 Region 属性", () => {
    const document = parseAtlas([
      "page.png",
      "PageFlag: one",
      "pageflag: two",
      "size: 64, 64",
      "",
      "region",
      "RoTaTe: false",
      "xy: 0, 0",
      "size: 1, 1",
      "orig: 1, 1",
      "offset: 0, 0",
      "Foo: one",
      "foo: two",
    ].join("\n"));

    expect(document.pages[0]?.custom).toEqual({ PageFlag: "one", pageflag: "two" });
    expect(document.regions[0]).toMatchObject({ rotation: 0, custom: { Foo: "one", foo: "two" } });
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
