import { describe, expect, it, vi } from "vitest";
import { classifyImport, extractAtlasPageNames } from "@/lib/files/import-files";

function file(name: string, contents: string, type = "text/plain"): File {
  return new File([contents], name, { type });
}

function png(name: string): File {
  return file(name, "png", "image/png");
}

function withDeclaredSize(source: File, size: number): File {
  Object.defineProperty(source, "size", { configurable: true, value: size });
  return source;
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

  it("用同一规则移除多个开头 ./ 段并建立规范化纹理键", async () => {
    const files = [
      file("hero.atlas", ".\\./textures\\page-a.png\nsize: 16,16"),
      file("hero.json", "{}"),
      png("textures/page-a.png"),
    ];

    const bundle = await classifyImport(files);

    expect([...bundle.textureFiles.keys()]).toEqual(["textures/page-a.png"]);
    expect(bundle.textureFiles.get("textures/page-a.png")).toBe(files[2]);
  });

  it("拒绝规范化后指向同一身份的 Atlas 页面声明", async () => {
    await expect(classifyImport([
      file("hero.atlas", "page.png\nsize: 16,16\n\n./page.png\nsize: 16,16"),
      file("hero.json", "{}"),
      png("page.png"),
    ])).rejects.toMatchObject({
      code: "AMBIGUOUS_TEXTURE_PAGE",
      details: ["page.png"],
    });
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

  it.each([
    ["Atlas", "hero.atlas", 8 * 1024 * 1024 + 1],
    ["骨骼", "hero.json", 128 * 1024 * 1024 + 1],
    ["PNG", "page.png", 128 * 1024 * 1024 + 1],
  ])("在读取任何全文前拒绝超过字节预算的%s文件", async (_label, oversizedName, declaredSize) => {
    const atlasFile = file("hero.atlas", "page.png\nsize: 1,1");
    const skeletonFile = file("hero.json", "{}");
    const textureFile = png("page.png");
    const oversized = oversizedName.endsWith(".atlas")
      ? atlasFile
      : oversizedName.endsWith(".png")
        ? textureFile
        : skeletonFile;
    withDeclaredSize(oversized, declaredSize);
    const atlasText = vi.spyOn(atlasFile, "text");

    await expect(classifyImport([atlasFile, skeletonFile, textureFile])).rejects.toMatchObject({
      code: "INPUT_FILE_SIZE_EXCEEDED",
    });
    expect(atlasText).not.toHaveBeenCalled();
  });

  it("在读取 Atlas 前拒绝选择超过 64 张 PNG，即使其中只有一张被引用", async () => {
    const atlasFile = file("hero.atlas", "page-0.png\nsize: 1,1");
    const atlasText = vi.spyOn(atlasFile, "text");

    await expect(classifyImport([
      atlasFile,
      file("hero.json", "{}"),
      ...Array.from({ length: 65 }, (_, index) => png(`page-${index}.png`)),
    ])).rejects.toMatchObject({ code: "TEXTURE_MEMORY_BUDGET_EXCEEDED" });
    expect(atlasText).not.toHaveBeenCalled();
  });

  it("在第 65 个 page-only Atlas 页面立即停止，不进入纹理全扫匹配", async () => {
    const atlasText = Array.from({ length: 65 }, (_, index) => (
      `page-${index}.png\nfilter: Linear,Linear`
    )).join("\n\n");

    expect(() => extractAtlasPageNames(atlasText)).toThrow(expect.objectContaining({
      code: "TEXTURE_MEMORY_BUDGET_EXCEEDED",
    }));
  });

  it("在读取 Atlas 前拒绝 PNG 文件声明大小累计超过 256 MiB", async () => {
    const atlasFile = file("hero.atlas", "page-a.png\nsize: 1,1\n\npage-b.png\nsize: 1,1");
    const atlasText = vi.spyOn(atlasFile, "text");
    const first = withDeclaredSize(png("page-a.png"), 128 * 1024 * 1024);
    const second = withDeclaredSize(png("page-b.png"), 128 * 1024 * 1024);
    const third = withDeclaredSize(png("unused.png"), 1);

    await expect(classifyImport([atlasFile, file("hero.json", "{}"), first, second, third]))
      .rejects.toMatchObject({ code: "INPUT_FILE_SIZE_EXCEEDED" });
    expect(atlasText).not.toHaveBeenCalled();
  });
});
