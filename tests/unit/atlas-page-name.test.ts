import { describe, expect, it } from "vitest";
import { normalizeAtlasPageMap, normalizeAtlasPageName } from "@/lib/atlas/page-name";

describe("normalizeAtlasPageName", () => {
  it("统一反斜杠并移除所有开头的 ./ 段", () => {
    expect(normalizeAtlasPageName("././textures\\hero.png")).toBe("textures/hero.png");
    expect(normalizeAtlasPageName(".\\.\\textures\\hero.png")).toBe("textures/hero.png");
  });

  it("建立统一查找键并拒绝规范化后的别名碰撞", () => {
    expect(() => normalizeAtlasPageMap([
      ["./textures/page.png", 1],
      ["textures\\page.png", 2],
    ])).toThrow(/规范化后冲突/);
  });
});
