import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { spine } from "../../vendor/spine-runtime-3.8/spine-webgl.js";

const fixtureDirectory = resolve(import.meta.dirname, "../fixtures/spine-3.8.75-minimal");

function readJson(source: string) {
  return new spine.SkeletonJson({} as never).readSkeletonData(source);
}

function readBinary(source: Uint8Array) {
  return new spine.SkeletonBinary({} as never).readSkeletonData(source);
}

describe("Spine 3.8.75 controlled compatibility", () => {
  it("3.8.75 JSON 不修改输入即可读出最小骨骼", () => {
    const original = readFileSync(resolve(fixtureDirectory, "minimal.json"), "utf8");

    const data = readJson(original);

    expect(data.version).toBe("3.8.75");
    expect(data.bones.map(({ name }) => name)).toEqual(["root"]);
    expect(JSON.parse(original).skeleton.spine).toBe("3.8.75");
  });

  it("3.8.75 SKEL 不修改版本头即可读出最小骨骼", () => {
    const original = readFileSync(resolve(fixtureDirectory, "minimal.skel"));

    const data = readBinary(new Uint8Array(original));

    expect(data.version).toBe("3.8.75");
    expect(data.bones.map(({ name }) => name)).toEqual(["root"]);
    expect(original.includes(Buffer.from("3.8.75"))).toBe(true);
  });

  it("保留普通 Spine 3.8 JSON 的既有读取行为", () => {
    const data = readJson(JSON.stringify({
      skeleton: { spine: "3.8.99" },
      bones: [{ name: "root" }],
    }));

    expect(data.version).toBe("3.8.99");
    expect(data.bones).toHaveLength(1);
  });
});
