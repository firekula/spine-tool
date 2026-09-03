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
});
