import { describe, expect, it } from "vitest";
import { runtimeDescriptor } from "@/lib/spine/runtime-registry";

describe("runtimeDescriptor", () => {
  it.each([
    ["3.5", true], ["3.6", true], ["3.7", true], ["3.8", true],
    ["4.0", false], ["4.1", false], ["4.2", false], ["4.3", false],
  ] as const)("为 Spine %s 返回 Runtime 注册元数据", (majorMinor, requiresExplicitAlphaMode) => {
    expect(runtimeDescriptor(majorMinor)).toEqual({ majorMinor, requiresExplicitAlphaMode });
  });
});
