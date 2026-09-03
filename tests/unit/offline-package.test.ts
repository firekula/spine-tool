import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const script = resolve(repositoryRoot, "scripts/package-offline.mjs");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeOfflineBuild(overrides: Partial<Record<"html" | "js" | "css", string>> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "spine-offline-package-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "offline"), { recursive: true });
  mkdirSync(join(directory, "assets"), { recursive: true });
  mkdirSync(join(directory, "licenses"), { recursive: true });
  writeFileSync(join(directory, "offline/index.html"), overrides.html ?? '<p>离线中文说明</p><script type="module" src="../assets/index-a.js"></script>');
  writeFileSync(join(directory, "assets/index-a.js"), overrides.js ?? 'export const offline = "本地相对资源";');
  writeFileSync(join(directory, "assets/index-a.css"), overrides.css ?? "body { color: black; }");
  for (const version of ["3_8", "4_0", "4_1", "4_2"]) {
    writeFileSync(join(directory, `assets/runtime-${version}-a.js`), "export {};\n");
  }
  writeFileSync(join(directory, "licenses/SPINE-RUNTIMES-LICENSE.txt"), "license\n");
  return directory;
}

function packageFixture(directory: string, archive: string) {
  return execFileSync(process.execPath, [script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      SPINE_OFFLINE_DIST_DIR: directory,
      SPINE_OFFLINE_ARCHIVE: archive,
      SPINE_OFFLINE_SKIP_BUILD: "1",
    },
    stdio: "pipe",
  });
}

describe("离线包脚本", () => {
  it("同一静态构建连续打包两次产生完全相同的 SHA-256", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-archive-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");

    packageFixture(directory, archive);
    const firstHash = createHash("sha256").update(readFileSync(archive)).digest("hex");
    packageFixture(directory, archive);
    const secondHash = createHash("sha256").update(readFileSync(archive)).digest("hex");

    expect(secondHash).toBe(firstHash);
  });

  it("拒绝所有受支持载体中的外部运行网络目标", () => {
    const maliciousBuilds = [
      { js: 'fetch("https://example.invalid/data");' },
      { js: 'const xhr = new XMLHttpRequest(); xhr.open("GET", "https://example.invalid/data");' },
      { js: 'new Worker("https://example.invalid/worker.js");' },
      { js: 'const workerUrl = "https://example.invalid/worker.js"; new Worker(workerUrl);' },
      { js: 'importScripts("https://example.invalid/worker.js");' },
      { js: 'import("https://example.invalid/module.js");' },
      { js: 'new EventSource("//example.invalid/events");' },
      { js: 'new WebSocket("wss://example.invalid/socket");' },
      { css: "body { background-image: url(//cdn.example.invalid/background.png); }" },
      { html: '<script src="https://example.invalid/app.js"></script>' },
    ];

    for (const overrides of maliciousBuilds) {
      const directory = makeOfflineBuild(overrides);
      expect(() => packageFixture(directory, join(directory, "offline.zip"))).toThrow(/远程运行依赖/);
    }
  });
});
