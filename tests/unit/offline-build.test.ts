import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { externalRuntimeDependencies } from "../../scripts/offline-runtime-audit.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

describe("离线构建", () => {
  it("生成八个经精确审计且可从 file:// 打开的 Runtime chunk", () => {
    execFileSync(npmCommand, ["run", "build:offline"], {
      cwd: repositoryRoot,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "pipe",
    });

    const html = readFileSync(
      resolve(repositoryRoot, "dist-offline/offline/index.html"),
      "utf8",
    );

    expect(html).toMatch(/(?:src|href)="\.\.\/assets\//);
    expect(html).not.toContain('href="/assets/');
    expect(html).not.toContain('src="/assets/');

    const assetsDirectory = resolve(repositoryRoot, "dist-offline/assets");
    const runtimePaths = readdirSync(assetsDirectory)
      .filter((name) => /^runtime-[34]_[0-9]-[A-Za-z0-9_-]+\.js$/.test(name))
      .sort()
      .map((name) => `assets/${name}`);
    expect(runtimePaths.map((path) => /^assets\/runtime-([34]_[0-9])-/.exec(path)?.[1])).toEqual([
      "3_5", "3_6", "3_7", "3_8", "4_0", "4_1", "4_2", "4_3",
    ]);
    for (const path of runtimePaths) {
      const contents = readFileSync(resolve(repositoryRoot, "dist-offline", path), "utf8");
      expect(
        externalRuntimeDependencies(path, contents),
        path,
      ).toEqual([]);
      expect(
        externalRuntimeDependencies(path.replace("assets/runtime-", "assets/runtime-copy-"), contents),
        `${path} 只能由完整构建路径批准`,
      ).not.toEqual([]);
    }

    const runtime43 = runtimePaths.find((path) => path.includes("runtime-4_3-"));
    expect(runtime43).toBeDefined();
    const runtime43Contents = readFileSync(resolve(repositoryRoot, "dist-offline", runtime43!), "utf8");
    const executableSourceUrl = "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.3.9.tgz";
    expect(externalRuntimeDependencies(runtime43!, `${runtime43Contents}\nfetch("${executableSourceUrl}");`))
      .toEqual(expect.arrayContaining([expect.stringContaining("fetch 使用外部 URL")]));
  });
});
