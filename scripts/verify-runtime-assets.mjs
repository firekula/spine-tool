import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalizedRoot = repositoryRoot.split(sep).join("/");
const supportedVersions = ["3.5", "3.6", "3.7", "3.8", "4.0", "4.1", "4.2", "4.3"];
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

async function validateOptionalArchive(source) {
  if (!await pathExists(source.archivePath)) return;
  assert.ok(source.archiveSha256, `${source.archivePath} 存在但未固定 SHA-256`);
  const contents = await readFile(resolve(repositoryRoot, source.archivePath));
  assert.equal(sha256Contents(contents), source.archiveSha256, `${source.archivePath} SHA-256 不匹配`);
  if (source.kind === "npm") {
    const integrity = `sha512-${createHash("sha512").update(contents).digest("base64")}`;
    assert.equal(integrity, source.integrity, `${source.archivePath} SRI 不匹配`);
  }
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
  await validateOptionalArchive(source);

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
    assert.equal(provenance.license.sha256, source.licenseSha256, `${version} SOURCE.json 许可证 SHA-256 不匹配`);

    const javascript = await readFile(resolve(repositoryRoot, source.vendorDirectory, "spine-webgl.js"), "utf8");
    const declarations = await readFile(resolve(repositoryRoot, source.vendorDirectory, "spine-webgl.d.ts"), "utf8");
    assert.ok(javascript.endsWith(javascriptBoundary), `${version} JavaScript 缺少固定 ESM 边界`);
    assert.ok(declarations.endsWith(declarationBoundary), `${version} declaration 缺少固定 ESM 边界`);
    assert.equal(
      sha256Contents(javascript.slice(0, -javascriptBoundary.length)),
      source.buildArtifacts["spine-webgl.js"].upstreamSha256,
      `${version} 官方 JavaScript 构建产物 SHA-256 不匹配`,
    );
    assert.equal(
      sha256Contents(declarations.slice(0, -declarationBoundary.length)),
      source.buildArtifacts["spine-webgl.d.ts"].upstreamSha256,
      `${version} 官方 declaration 构建产物 SHA-256 不匹配`,
    );
    for (const [artifact, digests] of Object.entries(source.buildArtifacts)) {
      assert.equal(await sha256(`${source.vendorDirectory}/${artifact}`), digests.sha256, `${version} ${artifact} SHA-256 不匹配`);
    }
    assert.equal(await sha256(`${source.vendorDirectory}/LICENSE`), source.licenseSha256, `${version} 许可证 SHA-256 不匹配`);
    assert.ok(documentation.includes(source.archiveSha256), `文档缺少 ${version} 来源归档 SHA-256`);
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
