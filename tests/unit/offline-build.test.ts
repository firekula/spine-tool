import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

describe("离线构建", () => {
  it("生成可从 file:// 打开的相对资源 URL", () => {
    execFileSync(npmCommand, ["run", "build:offline"], {
      cwd: repositoryRoot,
      stdio: "pipe",
    });

    const html = readFileSync(
      resolve(repositoryRoot, "dist-offline/offline/index.html"),
      "utf8",
    );

    expect(html).toMatch(/(?:src|href)="\.\.\/assets\//);
    expect(html).not.toContain('href="/assets/');
    expect(html).not.toContain('src="/assets/');
  });
});
