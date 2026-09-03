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
      { js: 'fetch("https:\\u002f\\u002fexample.invalid/escaped-fetch");' },
      { js: 'import("https:\\x2f\\u{2f}example.invalid/escaped-import.js");' },
      { js: 'new EventSource("//example.invalid/events");' },
      { js: 'new WebSocket("wss://example.invalid/socket");' },
      { css: "body { background-image: url(//cdn.example.invalid/background.png); }" },
      { css: "body { background-image: url(https:\\2f \\2f cdn.example.invalid/escaped-background.png); }" },
      { css: String.raw`body { background-image: url(https:\/\/cdn.example.invalid/escaped-character-background.png); }` },
      { html: '<script src="https://example.invalid/app.js"></script>' },
      { html: '<script src="https:&#47;&#47;example.invalid/escaped-app.js"></script>' },
      { html: '<script src="https:&sol;&sol;example.invalid/named-entity-app.js"></script>' },
      { html: "<script src=https://example.invalid/unquoted-app.js></script>" },
      { html: "<a href=//example.invalid/unquoted-link>外部链接</a>" },
      { html: "<script src=https:&#47;&#47;example.invalid/unquoted-entity.js></script>" },
      { html: '<script>fetch("https://example.invalid/inline-script");</script>' },
      { js: "fetch(`https:\\u002f\\u002fexample.invalid/template-fetch`);" },
      { js: "import(`https:\\x2f\\u{2f}example.invalid/template-import.js`);" },
      { js: "fetch(`https://${host}/dynamic-fetch`);" },
      { js: "import(`./${specifier}`);" },
    ];

    for (const [index, overrides] of maliciousBuilds.entries()) {
      const directory = makeOfflineBuild(overrides);
      try {
        packageFixture(directory, join(directory, "offline.zip"));
      } catch (error) {
        expect(error).toMatchObject({ message: expect.stringMatching(/远程运行依赖/) });
        continue;
      }
      throw new Error(`恶意 fixture ${index} 未被拒绝`);
    }
  });

  it("允许 blob、data、相对资源和中文文本", () => {
    const directory = makeOfflineBuild({
      html: '<!-- <img src=https://example.invalid/comment-only> --><p>离线中文说明</p><script type=application/json>{"help":"<img src=https://example.invalid/text-only>"}</script><img src=blob:local-image><img src=data:image/png;base64,AAAA><script src=../assets/index-a.js></script>',
      js: 'fetch("blob:local-data"); fetch("data:text/plain,本地"); import("./relative-module.js");',
      css: 'body { background-image: url(data:image/png;base64,AAAA); }',
    });
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-allowed-"));
    temporaryDirectories.push(archiveDirectory);

    expect(() => packageFixture(directory, join(archiveDirectory, "offline.zip"))).not.toThrow();
  });
});
