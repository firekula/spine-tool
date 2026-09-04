import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { build } from "vite";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalizedRoot = repositoryRoot.split(sep).join("/");
const supportedVersions = ["3.5", "3.6", "3.7", "3.8", "4.0", "4.1", "4.2", "4.3"];
const verifierArguments = process.argv.slice(2);
assert.ok(
  verifierArguments.length === 0 || (verifierArguments.length === 1 && verifierArguments[0] === "--fast"),
  "参数无效；用法：verify-runtime-assets.mjs [--fast]",
);
const fastVerification = verifierArguments[0] === "--fast";
const javascriptBoundary = "\n\n// ESM boundary added by this project; the runtime above is the official build.\nexport { spine };\n";
const declarationBoundary = "\ndeclare const spineRuntime: typeof spine;\nexport { spineRuntime as spine };\n";

const isProjectPath = (moduleId, projectPath) => moduleId.startsWith(`${normalizedRoot}${projectPath}`);

async function json(path) {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
}

async function pathExists(path) {
  try {
    await stat(resolve(repositoryRoot, path));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function sha256Contents(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function sha256(path) {
  return sha256Contents(await readFile(resolve(repositoryRoot, path)));
}

function parseUnifiedPatch(patch) {
  assert.equal(patch.includes("\r"), false, "3.8 patch 必须使用 LF 换行");
  const lines = patch.endsWith("\n")
    ? patch.slice(0, -1).split("\n")
    : patch.split("\n");
  const files = [];
  let current = null;
  let hunk = null;

  const finishHunk = () => {
    if (!hunk) return;
    assert.equal(hunk.oldSeen, hunk.oldCount, `3.8 patch hunk 旧文件行数不匹配：${current?.oldPath ?? "unknown"}`);
    assert.equal(hunk.newSeen, hunk.newCount, `3.8 patch hunk 新文件行数不匹配：${current?.newPath ?? "unknown"}`);
    current.hunks += 1;
    hunk = null;
  };

  const finishFile = () => {
    if (!current) return;
    finishHunk();
    assert.equal(current.oldHeader, current.oldPath, "3.8 patch 文件头路径必须与 diff --git 声明一致");
    assert.equal(current.newHeader, current.newPath, "3.8 patch 文件头路径必须与 diff --git 声明一致");
    assert.ok(current.hunks > 0, `3.8 patch 文件缺少 unified diff hunk：${current.oldPath}`);
    files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (hunk && hunk.oldSeen === hunk.oldCount && hunk.newSeen === hunk.newCount) finishHunk();

    if (line.startsWith("diff --git ")) {
      if (hunk) finishHunk();
      finishFile();
      const declaration = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
      assert.ok(declaration, "3.8 patch diff --git 声明格式无效");
      current = {
        oldPath: declaration[1],
        newPath: declaration[2],
        oldHeader: null,
        newHeader: null,
        additions: [],
        deletions: [],
        hunks: 0,
      };
      continue;
    }

    assert.ok(current, "3.8 patch 在 diff --git 声明前包含内容");
    if (hunk) {
      const marker = line[0];
      assert.ok(marker === " " || marker === "+" || marker === "-", `3.8 patch hunk 行缺少 unified diff 标记：${line}`);
      if (marker === " ") {
        hunk.oldSeen += 1;
        hunk.newSeen += 1;
      } else if (marker === "-") {
        hunk.oldSeen += 1;
        current.deletions.push(line.slice(1));
      } else {
        hunk.newSeen += 1;
        current.additions.push(line.slice(1));
      }
      assert.ok(hunk.oldSeen <= hunk.oldCount, `3.8 patch hunk 旧文件行数超出声明：${current.oldPath}`);
      assert.ok(hunk.newSeen <= hunk.newCount, `3.8 patch hunk 新文件行数超出声明：${current.newPath}`);
      continue;
    }

    if (line.startsWith("--- ")) {
      assert.equal(current.oldHeader, null, `3.8 patch 重复 --- 文件头：${current.oldPath}`);
      const header = line.match(/^--- a\/(\S+)$/);
      assert.ok(header, "3.8 patch --- 文件头格式无效");
      current.oldHeader = header[1];
      continue;
    }
    if (line.startsWith("+++ ")) {
      assert.equal(current.newHeader, null, `3.8 patch 重复 +++ 文件头：${current.newPath}`);
      const header = line.match(/^\+\+\+ b\/(\S+)$/);
      assert.ok(header, "3.8 patch +++ 文件头格式无效");
      current.newHeader = header[1];
      continue;
    }
    if (line.startsWith("@@ ")) {
      assert.ok(current.oldHeader && current.newHeader, `3.8 patch hunk 前缺少 ---/+++ 文件头：${current.oldPath}`);
      const declaration = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/);
      assert.ok(declaration, `3.8 patch hunk 声明格式无效：${line}`);
      hunk = {
        oldCount: Number(declaration[2] ?? 1),
        newCount: Number(declaration[4] ?? 1),
        oldSeen: 0,
        newSeen: 0,
      };
      continue;
    }
    if (/^(?:old mode|new mode|deleted file mode|new file mode|similarity index|dissimilarity index|rename (?:from|to)|copy (?:from|to)|Binary files |GIT binary patch)/.test(line)) {
      assert.fail(`3.8 patch 不允许 mode/rename/copy/binary 变化：${line}`);
    }
    assert.fail(`3.8 patch 包含不允许的文件级 metadata：${line}`);
  }

  finishFile();
  return files;
}

async function verifyLegacyPatch(version, source, provenance) {
  if (version === "3.8") assert.ok(source.patch, "3.8 Runtime 必须声明受控兼容 patch");
  if (!source.patch) {
    assert.equal(provenance.patch, undefined, `${version} SOURCE.json 声明了未固定的 patch`);
    return;
  }

  assert.match(source.patch.sha256, /^[0-9a-f]{64}$/, `${version} patch SHA-256 未固定`);
  assert.equal(await sha256(source.patch.path), source.patch.sha256, `${version} Runtime patch SHA-256 不匹配`);
  assert.deepEqual(provenance.patch, source.patch, `${version} SOURCE.json patch 记录不匹配`);

  for (const [artifact, hashes] of Object.entries(source.buildArtifacts)) {
    assert.match(hashes.upstreamSha256 ?? "", /^[0-9a-f]{64}$/, `${version} ${artifact} 必须分别固定上游与补丁构建 SHA-256`);
    assert.match(hashes.patchedSha256 ?? "", /^[0-9a-f]{64}$/, `${version} ${artifact} 必须分别固定上游与补丁构建 SHA-256`);
  }
  assert.deepEqual(
    provenance.build.upstreamArtifacts,
    Object.fromEntries(Object.entries(source.buildArtifacts).map(([artifact, hashes]) => [artifact, hashes.upstreamSha256])),
    `${version} SOURCE.json 上游构建 hash 记录不匹配`,
  );
  assert.deepEqual(
    provenance.build.patchedArtifacts,
    Object.fromEntries(Object.entries(source.buildArtifacts).map(([artifact, hashes]) => [artifact, hashes.patchedSha256])),
    `${version} SOURCE.json 补丁构建 hash 记录不匹配`,
  );

  if (version === "3.8") {
    const patch = await readFile(resolve(repositoryRoot, source.patch.path), "utf8");
    const files = parseUnifiedPatch(patch);
    assert.deepEqual(
      files.map(({ oldPath, newPath }) => [oldPath, newPath]),
      [
        ["spine-ts/core/src/SkeletonBinary.ts", "spine-ts/core/src/SkeletonBinary.ts"],
        ["spine-ts/core/src/SkeletonJson.ts", "spine-ts/core/src/SkeletonJson.ts"],
      ],
      "3.8 patch 只能修改官方 JSON 与 Binary reader",
    );
    assert.deepEqual(files.map(({ additions }) => additions), [[], []], "3.8 patch 不允许新增代码");
    assert.deepEqual(files.map(({ deletions }) => deletions), [
      [
        "\t\t\tif (\"3.8.75\" == skeletonData.version)",
        "\t\t\t\t\tthrow new Error(\"Unsupported skeleton data, please export with a newer version of Spine.\");",
      ],
      [
        "\t\t\t\tif (\"3.8.75\" == skeletonData.version)",
        "\t\t\t\t\tthrow new Error(\"Unsupported skeleton data, please export with a newer version of Spine.\");",
      ],
    ], "3.8 patch 只能删除两个 reader 中精确的 3.8.75 主动拒绝");
  }
}

async function verifyStrictRebuild(version, source) {
  if (fastVerification || version !== "3.8") return;
  assert.equal(source.kind, "git-vendor", `${version} 不是可从 git archive 重建的 legacy Runtime`);
  const archivePath = resolve(repositoryRoot, source.archivePath);
  if (!await pathExists(archivePath)) {
    assert.fail(`严格重建所需的 ${version} 来源归档不存在：${source.archivePath}`);
  }

  const outputDirectory = await mkdtemp(resolve(tmpdir(), `spine-${version.replace(".", "-")}-rebuild-`));
  try {
    await execFileAsync(process.execPath, [
      resolve(repositoryRoot, "scripts/vendor-legacy-runtime.mjs"),
      "--version", version,
      "--commit", source.commit,
      "--archive", archivePath,
      "--output", outputDirectory,
    ], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    for (const artifact of ["spine-webgl.js", "spine-webgl.d.ts", "spine-webgl.js.map", "LICENSE", "SOURCE.json"]) {
      assert.equal(
        sha256Contents(await readFile(resolve(outputDirectory, artifact))),
        await sha256(`${source.vendorDirectory}/${artifact}`),
        `${version} 重建的 ${artifact} 与提交产物不一致`,
      );
    }
    console.log(`${version}: 已从固定归档与 patch 重建 Runtime`);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

async function sha256Tree(path) {
  const root = resolve(repositoryRoot, path);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  await walk(root);
  const treeHash = createHash("sha256");
  for (const file of files.sort()) {
    const relativePath = relative(root, file).split(sep).join("/");
    treeHash.update(relativePath);
    treeHash.update("\0");
    treeHash.update(sha256Contents(await readFile(file)));
    treeHash.update("\n");
  }
  return treeHash.digest("hex");
}

async function validateArchive(version, source) {
  if (!await pathExists(source.archivePath)) {
    if (!fastVerification && version === "3.8") {
      assert.fail(`严格重建所需的 ${version} 来源归档不存在：${source.archivePath}`);
    }
    return;
  }
  assert.ok(source.archiveSha256, `${source.archivePath} 存在但未固定 SHA-256`);
  const archiveFileContents = await readFile(resolve(repositoryRoot, source.archivePath));
  if (source.archiveCompression === "gzip") {
    assert.match(source.archiveFileSha256 ?? "", /^[0-9a-f]{64}$/, `${source.archivePath} 压缩归档 SHA-256 未固定`);
    assert.equal(sha256Contents(archiveFileContents), source.archiveFileSha256, `${source.archivePath} 压缩归档 SHA-256 不匹配`);
  }
  const contents = source.archiveCompression === "gzip"
    ? gunzipSync(archiveFileContents)
    : archiveFileContents;
  assert.equal(sha256Contents(contents), source.archiveSha256, `${source.archivePath} SHA-256 不匹配`);
  if (source.kind === "npm") {
    const integrity = `sha512-${createHash("sha512").update(archiveFileContents).digest("base64")}`;
    assert.equal(integrity, source.integrity, `${source.archivePath} SRI 不匹配`);
  }
}

async function verifyBuildTool(record, label) {
  assert.ok(record, `${label} package 未固定`);
  assert.match(record.url, /^https:\/\/registry\.npmjs\.org\//, `${label} package 不是官方 npm 来源`);
  assert.match(record.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, `${label} package SRI 未固定`);
  const dependency = `npm:${record.package}@${record.version}`;
  assert.equal(packageJson.devDependencies[record.alias], dependency, `${label} package.json alias 不匹配`);
  assert.equal(packageLock.packages[""].devDependencies[record.alias], dependency, `${label} lockfile 根 alias 不匹配`);
  const packagePath = `node_modules/${record.alias}`;
  const installedPackage = await json(`${packagePath}/package.json`);
  const lockedPackage = packageLock.packages[packagePath];
  assert.ok(lockedPackage, `${label} lockfile 缺少 alias package`);
  assert.equal(installedPackage.name, record.package, `${label} 已安装 package 名称不匹配`);
  assert.equal(installedPackage.version, record.version, `${label} 已安装 package 版本不匹配`);
  assert.equal(lockedPackage.name, record.package, `${label} lockfile package 名称不匹配`);
  assert.equal(lockedPackage.version, record.version, `${label} lockfile package 版本不匹配`);
  assert.equal(lockedPackage.resolved, record.url, `${label} lockfile resolved 不匹配`);
  assert.equal(lockedPackage.integrity, record.integrity, `${label} lockfile integrity 不匹配`);
}

const packageJson = await json("package.json");
const packageLockPath = process.env.SPINE_RUNTIME_LOCKFILE
  ? resolve(process.env.SPINE_RUNTIME_LOCKFILE)
  : resolve(repositoryRoot, "package-lock.json");
const packageLock = JSON.parse(await readFile(packageLockPath, "utf8"));
const sourceManifest = await json(
  process.env.SPINE_RUNTIME_SOURCE_MANIFEST ?? "scripts/runtime-sources.json",
);
const documentation = await readFile(resolve(repositoryRoot, "docs/runtime-versions.md"), "utf8");

assert.equal(sourceManifest.schemaVersion, 1, "Runtime 来源清单 schemaVersion 不受支持");
assert.deepEqual(Object.keys(sourceManifest.runtimes), supportedVersions, "Runtime 来源清单必须精确覆盖八个版本");

const runtimeDetails = new Map();
const coreDirectories = new Set();
const npmCorePaths = new Map();

for (const version of supportedVersions) {
  const source = sourceManifest.runtimes[version];
  assert.match(source.url, /^https:\/\/(github\.com\/EsotericSoftware\/spine-runtimes|registry\.npmjs\.org\/@esotericsoftware\/spine-webgl)/, `${version} 不是官方来源 URL`);
  await validateArchive(version, source);

  if (source.kind === "git-vendor") {
    assert.match(source.commit, /^[0-9a-f]{40}$/, `${version} commit 格式无效`);
    assert.ok(source.url.includes(source.commit), `${version} 官方 URL 未固定到 commit`);
    assert.ok(documentation.includes(source.commit), `文档缺少 ${version} commit`);

    const sourceRecordPath = `${source.vendorDirectory}/SOURCE.json`;
    if (!await pathExists(sourceRecordPath)) {
      assert.match(source.archiveSha256, /^[0-9a-f]{64}$/, `${version} 来源归档 SHA-256 未固定`);
      assert.equal(source.buildArtifacts, null, `${version} 尚未集成却声明构建产物已验证`);
      assert.match(source.licenseSha256, /^[0-9a-f]{64}$/, `${version} 官方许可证 SHA-256 未固定`);
      assert.equal(await pathExists(source.entry), false, `${version} 有 Runtime entry 但没有 SOURCE.json`);
      assert.ok(documentation.includes(source.archiveSha256), `文档缺少 ${version} 来源归档 SHA-256`);
      assert.ok(documentation.includes(source.licenseSha256), `文档缺少 ${version} 官方许可证 SHA-256`);
      console.log(`${version}: 官方 git 来源已固定（Runtime 待集成）`);
      continue;
    }

    assert.ok(source.archiveSha256, `${version} vendor 缺少来源归档 SHA-256`);
    assert.ok(source.buildArtifacts, `${version} vendor 缺少构建产物 SHA-256`);
    assert.ok(source.licenseSha256, `${version} vendor 缺少许可证 SHA-256`);
    const provenance = await json(sourceRecordPath);
    assert.equal(provenance.commit, source.commit, `${version} SOURCE.json commit 不匹配`);
    assert.equal(provenance.sourceArchiveSha256, source.archiveSha256, `${version} 来源归档 SHA-256 不匹配`);
    if (source.archiveCompression) {
      assert.equal(provenance.sourceArchiveCompression, source.archiveCompression, `${version} SOURCE.json 压缩格式不匹配`);
      assert.equal(provenance.sourceArchiveFileSha256, source.archiveFileSha256, `${version} SOURCE.json 压缩归档 SHA-256 不匹配`);
      assert.ok(documentation.includes(source.archiveFileSha256), `文档缺少 ${version} 压缩归档 SHA-256`);
    }
    assert.equal(provenance.license.sha256, source.licenseSha256, `${version} SOURCE.json 许可证 SHA-256 不匹配`);
    if (source.build.typescriptPackage) {
      assert.equal(source.build.typescriptPackage.version, source.build.typescript, `${version} TypeScript package 版本与构建声明不匹配`);
      assert.deepEqual(provenance.build.typescriptPackage, source.build.typescriptPackage, `${version} SOURCE.json TypeScript package 记录不匹配`);
      await verifyBuildTool(source.build.typescriptPackage, `${version} TypeScript`);
    }
    if (source.build.offscreencanvasTypesPackage) {
      assert.equal(source.build.offscreencanvasTypesPackage.version, source.build.offscreencanvasTypes, `${version} OffscreenCanvas types package 版本与构建声明不匹配`);
      assert.deepEqual(provenance.build.offscreencanvasTypesPackage, source.build.offscreencanvasTypesPackage, `${version} SOURCE.json OffscreenCanvas types package 记录不匹配`);
      await verifyBuildTool(source.build.offscreencanvasTypesPackage, `${version} OffscreenCanvas types`);
    }
    await verifyLegacyPatch(version, source, provenance);

    const javascript = await readFile(resolve(repositoryRoot, source.vendorDirectory, "spine-webgl.js"), "utf8");
    const declarations = await readFile(resolve(repositoryRoot, source.vendorDirectory, "spine-webgl.d.ts"), "utf8");
    assert.ok(javascript.endsWith(javascriptBoundary), `${version} JavaScript 缺少固定 ESM 边界`);
    assert.ok(declarations.endsWith(declarationBoundary), `${version} declaration 缺少固定 ESM 边界`);
    assert.equal(
      sha256Contents(javascript.slice(0, -javascriptBoundary.length)),
      source.patch
        ? source.buildArtifacts["spine-webgl.js"].patchedSha256
        : source.buildArtifacts["spine-webgl.js"].upstreamSha256,
      `${version} JavaScript namespace 构建产物 SHA-256 不匹配`,
    );
    assert.equal(
      sha256Contents(declarations.slice(0, -declarationBoundary.length)),
      source.patch
        ? source.buildArtifacts["spine-webgl.d.ts"].patchedSha256
        : source.buildArtifacts["spine-webgl.d.ts"].upstreamSha256,
      `${version} declaration namespace 构建产物 SHA-256 不匹配`,
    );
    for (const [artifact, digests] of Object.entries(source.buildArtifacts)) {
      assert.equal(await sha256(`${source.vendorDirectory}/${artifact}`), digests.sha256, `${version} ${artifact} SHA-256 不匹配`);
    }
    assert.equal(await sha256(`${source.vendorDirectory}/LICENSE`), source.licenseSha256, `${version} 许可证 SHA-256 不匹配`);
    assert.ok(documentation.includes(source.archiveSha256), `文档缺少 ${version} 来源归档 SHA-256`);
    await verifyStrictRebuild(version, source);
    runtimeDetails.set(version, {
      ...source,
      moduleSource: `/${source.vendorDirectory}/spine-webgl.js`,
    });
    console.log(`${version}: 官方 git vendor 来源与构建产物已验证`);
    continue;
  }

  assert.equal(source.kind, "npm", `${version} Runtime 来源 kind 无效`);
  assert.equal(source.core.package, "@esotericsoftware/spine-core", `${version} core package 名称无效`);
  assert.equal(source.core.version, source.version, `${version} core 来源版本与 webgl 不匹配`);
  assert.match(
    source.core.url,
    /^https:\/\/registry\.npmjs\.org\/@esotericsoftware\/spine-core\/-\/spine-core-[^/]+\.tgz$/,
    `${version} core 不是官方来源 URL`,
  );
  const dependencyValue = `npm:${source.package}@${source.version}`;
  assert.equal(packageJson.dependencies[source.alias], dependencyValue, `${version} package.json alias 不匹配`);
  assert.equal(packageLock.packages[""].dependencies[source.alias], dependencyValue, `${version} lockfile 根 alias 不匹配`);
  const packagePath = `node_modules/${source.alias}`;
  const installedPackage = await json(`${packagePath}/package.json`);
  const lockedPackage = packageLock.packages[packagePath];
  assert.ok(lockedPackage, `${version} lockfile 缺少 alias package`);
  assert.equal(installedPackage.version, source.version, `${version} 已安装 package 版本不匹配`);
  assert.equal(lockedPackage.version, source.version, `${version} lockfile package 版本不匹配`);
  assert.equal(installedPackage.dependencies[source.core.package], source.core.version, `${version} 已安装 core 依赖版本不匹配`);
  assert.equal(lockedPackage.dependencies[source.core.package], source.core.version, `${version} lockfile core 依赖版本不匹配`);
  assert.equal(lockedPackage.resolved, source.url, `${version} lockfile resolved 不是固定官方 URL`);
  assert.equal(lockedPackage.integrity, source.integrity, `${version} lockfile integrity 不匹配`);

  const nestedCore = `${packagePath}/node_modules/${source.core.package}`;
  const rootCore = `node_modules/${source.core.package}`;
  const corePath = await pathExists(`${nestedCore}/package.json`) ? nestedCore : rootCore;
  const corePackage = await json(`${corePath}/package.json`);
  const lockedCore = packageLock.packages[corePath];
  assert.ok(lockedCore, `${version} lockfile 缺少独立 core package`);
  assert.equal(corePackage.name, source.core.package, `${version} 已安装 core package 名称不匹配`);
  assert.equal(corePackage.version, source.core.version, `${version} 已安装 core 版本不匹配`);
  assert.equal(lockedCore.version, source.core.version, `${version} lockfile core 版本不匹配`);
  assert.equal(lockedCore.resolved, source.core.url, `${version} lockfile core resolved 不是固定官方 URL`);
  assert.equal(lockedCore.integrity, source.core.integrity, `${version} lockfile core integrity 不匹配`);
  for (const [artifact, expectedSha256] of Object.entries(source.core.buildArtifacts)) {
    assert.equal(await sha256(`${corePath}/${artifact}`), expectedSha256, `${version} core ${artifact} SHA-256 不匹配`);
  }
  assert.equal(await sha256Tree(`${corePath}/dist`), source.core.distTreeSha256, `${version} core 完整 dist tree SHA-256 不匹配`);
  assert.equal(await sha256(`${corePath}/LICENSE`), source.core.licenseSha256, `${version} core 许可证 SHA-256 不匹配`);
  coreDirectories.add(corePath);
  npmCorePaths.set(version, `/${corePath}/`);

  for (const [artifact, expectedSha256] of Object.entries(source.buildArtifacts)) {
    assert.equal(await sha256(`${packagePath}/${artifact}`), expectedSha256, `${version} ${artifact} SHA-256 不匹配`);
  }
  assert.equal(await sha256(`${packagePath}/LICENSE`), source.licenseSha256, `${version} 许可证 SHA-256 不匹配`);
  assert.ok(documentation.includes(source.archiveSha256), `文档缺少 ${version} tarball SHA-256`);
  assert.ok(documentation.includes(source.integrity), `文档缺少 ${version} 完整 SRI`);

  if (await pathExists(source.entry)) {
    runtimeDetails.set(version, {
      ...source,
      moduleSource: `/${packagePath}/`,
      corePath: `/${corePath}/`,
    });
    console.log(`${version}: 官方 npm 来源、安装产物与 core 已验证`);
  } else {
    console.log(`${version}: 官方 npm 来源与安装产物已验证（Runtime 待集成）`);
  }
}

assert.equal(coreDirectories.size, 4, "4.x Runtime 必须解析到四个独立 core package");
assert.equal(
  await sha256("public/licenses/SPINE-RUNTIMES-LICENSE.txt"),
  sourceManifest.runtimes["4.2"].licenseSha256,
  "公开许可证副本 SHA-256 不匹配",
);

const buildResult = await build({
  configFile: false,
  root: repositoryRoot,
  logLevel: "error",
  build: {
    write: false,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: resolve(repositoryRoot, "lib/spine/runtime-loader.ts"),
      preserveEntrySignatures: "strict",
    },
  },
});
const outputs = Array.isArray(buildResult) ? buildResult : [buildResult];
const chunks = outputs.flatMap((output) => output.output).filter((item) => item.type === "chunk");

for (const [version, runtime] of runtimeDetails) {
  const chunk = chunks.find((candidate) => candidate.facadeModuleId?.split(sep).join("/").endsWith(`/${runtime.entry}`));
  assert.ok(chunk, `缺少 Spine ${version} 动态 Runtime chunk`);
  const modules = Object.keys(chunk.modules).map((id) => id.split(sep).join("/"));
  assert.ok(modules.some((id) => id.includes(runtime.moduleSource)), `${version} chunk 缺少自身 Runtime 来源`);
  if (runtime.kind === "npm") {
    assert.ok(modules.some((id) => isProjectPath(id, runtime.corePath)), `${version} chunk 缺少自身 core`);
  }

  for (const [otherVersion, otherSource] of Object.entries(sourceManifest.runtimes)) {
    if (otherVersion === version) continue;
    const otherModuleSource = otherSource.kind === "npm"
      ? `/node_modules/${otherSource.alias}/`
      : `/${otherSource.vendorDirectory}/spine-webgl.js`;
    assert.ok(!modules.some((id) => id.includes(otherModuleSource)), `${version} chunk 导入了 ${otherVersion} Runtime`);
    if (otherSource.kind === "npm") {
      const otherCorePath = npmCorePaths.get(otherVersion);
      if (otherCorePath) {
        assert.ok(!modules.some((id) => isProjectPath(id, otherCorePath)), `${version} chunk 导入了 ${otherVersion} core`);
      }
    }
  }

  console.log(`${version}: ${chunk.fileName}（${modules.length} modules，隔离 chunk）`);
}

console.log(`已验证 ${supportedVersions.length} 条 Spine Runtime 固定来源`);
console.log(`已验证 ${runtimeDetails.size} 个隔离 Spine Runtime chunk`);
if (fastVerification) {
  console.log("快速验证完成：未重建 3.8 Runtime；不得用于 CI 或发布门禁");
}
