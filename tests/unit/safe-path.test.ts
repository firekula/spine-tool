import { describe, expect, it } from "vitest";
import { createZipPathAllocator } from "@/lib/export/safe-path";

describe("createZipPathAllocator", () => {
  it("移除路径穿越并确定性处理重名", () => {
    const allocator = createZipPathAllocator();

    expect(allocator.allocate("../body/head")).toBe("body/head.png");
    expect(allocator.allocate("body/head")).toBe("body/head-2.png");
  });

  it("移除空段、盘符、NUL 与控制字符，并保留安全目录", () => {
    const allocator = createZipPathAllocator();

    expect(allocator.allocate("C:\\body/./\u0000head\n")).toBe("body/head.png");
    expect(allocator.allocate("D:body/head")).toBe("body/head-2.png");
    expect(allocator.allocate("../../")).toBe("region.png");
  });

  it("全局避开自动后缀和真实名称的碰撞", () => {
    const allocator = createZipPathAllocator();

    expect(allocator.allocate("head")).toBe("head.png");
    expect(allocator.allocate("head")).toBe("head-2.png");
    expect(allocator.allocate("head-2")).toBe("head-2-2.png");
  });

  it("清除 C1 控制字符", () => {
    const allocator = createZipPathAllocator();

    expect(allocator.allocate("body/\u0080head\u009f")).toBe("body/head.png");
  });
});
