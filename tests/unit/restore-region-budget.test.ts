import { describe, expect, it } from "vitest";
import { assertTextureReadBudget } from "@/lib/atlas/restore-region";

describe("raw texture read budget", () => {
  it("在分配 CPU/GPU 缓冲前拒绝小 Region 所属的超大纹理页", () => {
    expect(() => assertTextureReadBudget("tiny", { width: 8_192, height: 8_192 }))
      .toThrow(/纹理页原始像素.*浏览器安全预算/);
    expect(() => assertTextureReadBudget("normal", { width: 4_096, height: 4_096 }))
      .not.toThrow();
  });

  it("预算错误不再声称只覆盖 PMA，因为 Straight 也需要原始通道", () => {
    expect(() => assertTextureReadBudget("straight", { width: 8_192, height: 8_192 }))
      .toThrow(/纹理页原始像素.*浏览器安全预算/);
  });
});
