import { describe, expect, it } from "vitest";
import { classifyImport, extractAtlasPageNames } from "@/lib/files/import-files";

function file(name: string, contents: string, type = "text/plain"): File {
  return new File([contents], name, { type });
}

function png(name: string): File {
  return file(name, "png", "image/png");
}

describe("classifyImport", () => {
  it("识别 Spine 4.x 使用缩进 size 属性的纹理页", async () => {
    const bundle = await classifyImport([
      file("hero.atlas", "page.png\n\tsize: 64, 64\n\tfilter: Linear, Linear\nregion\n\tbounds: 0, 0, 1, 1"),
      file("hero.json", '{"skeleton":{"spine":"4.2.0"}}', "application/json"),
      png("page.png"),
    ]);

    expect([...bundle.textureFiles.keys()]).toEqual(["page.png"]);
    expect(bundle.unusedTextures).toEqual([]);
  });

  it("只提取页面头，而不将 Region 视作纹理页", () => {
    const atlas = [
      "page.png",
      "size: 16,16",
      "filter: Linear,Linear",
      "",
      "head",
      "  rotate: false",
      "  xy: 0, 0",
      "  size: 16, 16",
    ].join("\n");

    expect(extractAtlasPageNames(atlas)).toEqual(["page.png"]);
  });

  it("报告 Atlas 声明但未选择的纹理页", async () => {
    const files = [
      file("hero.atlas", "page-a.png\nsize: 16,16\n\npage-b.png\nsize: 16,16"),
      file("hero.json", "{}"),
      png("page-a.png"),
    ];

    await expect(classifyImport(files)).rejects.toMatchObject({
      code: "MISSING_TEXTURE_PAGES",
      details: ["page-b.png"],
    });
  });

  it("没有 PNG 纹理时拒绝导入，即使 Atlas 未声明页面", async () => {
    await expect(classifyImport([
      file("hero.atlas", ""),
      file("hero.json", "{}"),
    ])).rejects.toMatchObject({
      code: "MISSING_TEXTURE_FILES",
      details: ["未检测到 PNG 纹理文件。请至少选择一张 PNG 纹理。"],
    });
  });

  it("匹配 Atlas 声明的全部页面，并报告未使用的 PNG", async () => {
    const files = [
      file("hero.atlas", "pages/page-a.png\nsize: 16,16\n\npage-b.png\nsize: 16,16"),
      file("hero.skel", "binary"),
      png("pages/page-a.png"),
      png("page-b.png"),
      png("unused.png"),
    ];

    const bundle = await classifyImport(files);

    expect(bundle.skeletonKind).toBe("skel");
    expect(bundle.textureFiles.get("pages/page-a.png")).toBe(files[2]);
    expect(bundle.textureFiles.get("page-b.png")).toBe(files[3]);
    expect(bundle.unusedTextures).toEqual(["unused.png"]);
  });

  it("在完整页面路径不匹配时按唯一 basename 匹配", async () => {
    const files = [
      file("hero.atlas", "textures/page-a.png\nsize: 16,16"),
      file("hero.json", "{}"),
      png("page-a.png"),
    ];

    const bundle = await classifyImport(files);

    expect(bundle.skeletonKind).toBe("json");
    expect(bundle.textureFiles.get("textures/page-a.png")).toBe(files[2]);
  });

  it("规范化反斜杠后按完整 Atlas 页面路径匹配", async () => {
    const files = [
      file("hero.atlas", "textures\\page-a.png\nsize: 16,16"),
      file("hero.json", "{}"),
      png("textures/page-a.png"),
    ];

    const bundle = await classifyImport(files);

    expect(bundle.textureFiles.get("textures/page-a.png")).toBe(files[2]);
  });

  it("拒绝 basename 匹配歧义而不猜测纹理", async () => {
    const files = [
      file("hero.atlas", "textures/page-a.png\nsize: 16,16"),
      file("hero.json", "{}"),
      png("one/page-a.png"),
      png("two/page-a.png"),
    ];

    await expect(classifyImport(files)).rejects.toMatchObject({
      code: "AMBIGUOUS_TEXTURE_PAGE",
      details: ["textures/page-a.png"],
    });
  });

  it("要求恰好一份 Atlas 和一份 JSON 或 SKEL", async () => {
    await expect(classifyImport([file("hero.atlas", "page.png\nsize: 16,16"), png("page.png")]))
      .rejects.toMatchObject({ code: "MISSING_SKELETON" });
    await expect(classifyImport([file("hero.json", "{}"), png("page.png")]))
      .rejects.toMatchObject({ code: "MISSING_ATLAS" });
  });
});
