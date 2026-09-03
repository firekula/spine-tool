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

  it("逐段清理 Windows 禁用字符、尾随点空格与设备名", () => {
    const allocator = createZipPathAllocator();

    expect(allocator.allocate("CON")).toBe("_CON.png");
    expect(allocator.allocate("aux.txt")).toBe("_aux.txt.png");
    expect(allocator.allocate("bad?.name")).toBe("bad_.name.png");
    expect(allocator.allocate("folder. /trailing... ")).toBe("folder/trailing.png");
    expect(allocator.allocate("LPT9/device|name")).toBe("_LPT9/device_name.png");
  });

  it("用规范化且不区分大小写的键避开 Windows 路径碰撞", () => {
    const allocator = createZipPathAllocator();

    expect(allocator.allocate("Head")).toBe("Head.png");
    expect(allocator.allocate("head")).toBe("head-2.png");
    expect(allocator.allocate("HEAD-2")).toBe("HEAD-2-2.png");
    expect(allocator.allocate("café")).toBe("café.png");
    expect(allocator.allocate("cafe\u0301")).toBe("cafe\u0301-2.png");
  });

  it("限制单段与完整 ZIP 路径长度并为后缀保留空间", () => {
    const allocator = createZipPathAllocator();
    const longSegment = "很长的目录".repeat(80);

    const first = allocator.allocate(`${longSegment}/${longSegment}`);
    const second = allocator.allocate(`${longSegment}/${longSegment}`);

    expect(first.length).toBeLessThanOrEqual(240);
    expect(second.length).toBeLessThanOrEqual(240);
    expect(first.split("/").every((segment) => segment.length <= 100)).toBe(true);
    expect(second).toMatch(/-2\.png$/);
  });

  it("完整路径截断后仍避开 Windows 设备保留名", () => {
    const allocator = createZipPathAllocator();
    const path = allocator.allocate(
      `${"a".repeat(100)}/${"b".repeat(34)}/CONSOLE/${"f".repeat(96)}`,
    );

    expect(path.length).toBeLessThanOrEqual(240);
    expect(path.split("/")).not.toContain("CON");
  });
});
