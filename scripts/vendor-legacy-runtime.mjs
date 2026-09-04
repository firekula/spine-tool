import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const javascriptBoundary = "\n\n// ESM boundary added by this project; the runtime above is the official build.\nexport { spine };\n";
const declarationBoundary = "\ndeclare const spineRuntime: typeof spine;\nexport { spineRuntime as spine };\n";

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || values.has(flag)) {
      fail("参数无效；用法：vendor-legacy-runtime.mjs --version X.Y --commit SHA --archive PATH [--output PATH]");
    }
    values.set(flag, value);
  }
  const required = ["--version", "--commit", "--archive"];
  const allowed = new Set([...required, "--output"]);
  if (required.some((flag) => !values.has(flag)) || [...values.keys()].some((flag) => !allowed.has(flag))) {
    fail("参数无效；用法：vendor-legacy-runtime.mjs --version X.Y --commit SHA --archive PATH [--output PATH]");
  }
  return {
    version: values.get("--version"),
    commit: values.get("--commit"),
    archive: resolve(values.get("--archive")),
    output: values.has("--output") ? resolve(values.get("--output")) : null,
  };
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function readSources() {
  return JSON.parse(await readFile(resolve(repositoryRoot, "scripts/runtime-sources.json"), "utf8"));
}

async function run(command, args, options) {
  try {
    await execFileAsync(command, args, { ...options, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const detail = error?.stderr?.trim() || error?.message || String(error);
    fail(`官方 Runtime 构建失败：${detail}`);
  }
}

async function compileRuntime(source, sourceDirectory) {
  if (source.build.typescriptPackage) {
    const compilerDirectory = resolve(repositoryRoot, "node_modules", source.build.typescriptPackage.alias);
    const compilerPackage = JSON.parse(await readFile(resolve(compilerDirectory, "package.json"), "utf8"));
    assert.equal(compilerPackage.name, source.build.typescriptPackage.package, "固定 TypeScript package 名称不匹配");
    assert.equal(compilerPackage.version, source.build.typescriptPackage.version, "固定 TypeScript package 版本不匹配");
    await run(
      process.execPath,
      [resolve(compilerDirectory, "bin/tsc"), "-p", source.build.tsconfig],
      { cwd: sourceDirectory },
    );
    return;
  }
  await run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "--yes", "--package", `typescript@${source.build.typescript}`,
      "tsc", "-p", source.build.tsconfig,
    ],
    { cwd: sourceDirectory },
  );
}

async function readBuildArtifacts(buildDirectory) {
  return {
    javascript: await readFile(resolve(buildDirectory, "spine-webgl.js"), "utf8"),
    declarations: await readFile(resolve(buildDirectory, "spine-webgl.d.ts"), "utf8"),
    sourceMap: await readFile(resolve(buildDirectory, "spine-webgl.js.map")),
  };
}

async function buildRuntime(source, archivePath, outputDirectory) {
  const archiveFileContents = await readFile(archivePath);
  if (source.archiveCompression === "gzip") {
    assert.equal(
      digest(archiveFileContents),
      source.archiveFileSha256,
      "来源归档 SHA-256 不匹配（压缩文件）",
    );
  }
  const archiveContents = source.archiveCompression === "gzip"
    ? gunzipSync(archiveFileContents)
    : archiveFileContents;
  assert.equal(
    digest(archiveContents),
    source.archiveSha256,
    "来源归档 SHA-256 不匹配",
  );

  const workDirectory = await mkdtemp(resolve(tmpdir(), "spine-legacy-runtime-"));
  try {
    await run("tar", [source.archiveCompression === "gzip" ? "-xzf" : "-xf", archivePath, "-C", workDirectory], { cwd: repositoryRoot });
    const sourceDirectory = resolve(workDirectory, source.build.sourceDirectory);
    let patchPath = null;
    if (source.patch) {
      patchPath = resolve(repositoryRoot, source.patch.path);
      const patchContents = await readFile(patchPath);
      assert.equal(digest(patchContents), source.patch.sha256, "Runtime patch SHA-256 不匹配");
      // Git archives preserve the official CRLF sources while the reviewable
      // patch is stored with repository-standard LF line endings.
      await run("git", ["apply", "--check", "--ignore-space-change", patchPath], { cwd: workDirectory });
    }
    if (source.build.offscreencanvasTypesPackage) {
      const typesDirectory = resolve(repositoryRoot, "node_modules", source.build.offscreencanvasTypesPackage.alias);
      const typesPackage = JSON.parse(await readFile(resolve(typesDirectory, "package.json"), "utf8"));
      assert.equal(typesPackage.name, source.build.offscreencanvasTypesPackage.package, "固定 OffscreenCanvas types package 名称不匹配");
      assert.equal(typesPackage.version, source.build.offscreencanvasTypesPackage.version, "固定 OffscreenCanvas types package 版本不匹配");
      const destination = resolve(sourceDirectory, "node_modules/@types/offscreencanvas");
      await mkdir(dirname(destination), { recursive: true });
      await cp(typesDirectory, destination, { recursive: true });
    } else if (source.build.offscreencanvasTypes) {
      await run(
        process.platform === "win32" ? "npm.cmd" : "npm",
        [
          "install", "--no-save", "--ignore-scripts", "--package-lock=false",
          `@types/offscreencanvas@${source.build.offscreencanvasTypes}`,
        ],
        { cwd: sourceDirectory },
      );
    }
    const buildDirectory = resolve(sourceDirectory, source.build.outputDirectory);
    await compileRuntime(source, sourceDirectory);
    const upstream = await readBuildArtifacts(buildDirectory);

    if (patchPath) {
      assert.equal(digest(upstream.javascript), source.buildArtifacts["spine-webgl.js"].upstreamSha256, "上游 JavaScript 构建产物 SHA-256 不匹配");
      assert.equal(digest(upstream.declarations), source.buildArtifacts["spine-webgl.d.ts"].upstreamSha256, "上游 declaration 构建产物 SHA-256 不匹配");
      assert.equal(digest(upstream.sourceMap), source.buildArtifacts["spine-webgl.js.map"].upstreamSha256, "上游 source map 构建产物 SHA-256 不匹配");
      await run("git", ["apply", "--ignore-space-change", patchPath], { cwd: workDirectory });
      await compileRuntime(source, sourceDirectory);
    }

    const built = patchPath ? await readBuildArtifacts(buildDirectory) : upstream;
    const expectedJavascript = patchPath
      ? source.buildArtifacts["spine-webgl.js"].patchedSha256
      : source.buildArtifacts["spine-webgl.js"].upstreamSha256;
    const expectedDeclarations = patchPath
      ? source.buildArtifacts["spine-webgl.d.ts"].patchedSha256
      : source.buildArtifacts["spine-webgl.d.ts"].upstreamSha256;
    const expectedSourceMap = patchPath
      ? source.buildArtifacts["spine-webgl.js.map"].patchedSha256
      : source.buildArtifacts["spine-webgl.js.map"].sha256;
    const javascript = `${built.javascript}${javascriptBoundary}`;
    const declarations = `${built.declarations}${declarationBoundary}`;

    assert.equal(
      digest(built.javascript),
      expectedJavascript,
      "最终 JavaScript namespace 构建产物 SHA-256 不匹配",
    );
    assert.equal(
      digest(built.declarations),
      expectedDeclarations,
      "最终 declaration namespace 构建产物 SHA-256 不匹配",
    );
    assert.equal(
      digest(javascript),
      source.buildArtifacts["spine-webgl.js"].sha256,
      "ESM JavaScript 构建产物 SHA-256 不匹配",
    );
    assert.equal(
      digest(declarations),
      source.buildArtifacts["spine-webgl.d.ts"].sha256,
      "ESM declaration 构建产物 SHA-256 不匹配",
    );
    assert.equal(
      digest(built.sourceMap),
      expectedSourceMap,
      "source map 构建产物 SHA-256 不匹配",
    );

    const licensePath = resolve(sourceDirectory, "LICENSE");
    assert.equal(digest(await readFile(licensePath)), source.licenseSha256, "许可证 SHA-256 不匹配");

    const vendorDirectory = outputDirectory ?? resolve(repositoryRoot, source.vendorDirectory);
    await mkdir(vendorDirectory, { recursive: true });
    await writeFile(resolve(vendorDirectory, "spine-webgl.js"), javascript);
    await writeFile(resolve(vendorDirectory, "spine-webgl.d.ts"), declarations);
    await writeFile(resolve(vendorDirectory, "spine-webgl.js.map"), built.sourceMap);
    await copyFile(licensePath, resolve(vendorDirectory, "LICENSE"));
    await writeFile(resolve(vendorDirectory, "SOURCE.json"), `${JSON.stringify({
      repository: "https://github.com/EsotericSoftware/spine-runtimes.git",
      branch: source.branch,
      commit: source.commit,
      sourcePath: source.build.sourceDirectory,
      sourceArchiveSha256: source.archiveSha256,
      ...(source.archiveCompression ? {
        sourceArchiveCompression: source.archiveCompression,
        sourceArchiveFileSha256: source.archiveFileSha256,
      } : {}),
      ...(source.patch ? { patch: source.patch } : {}),
      build: {
        typescript: source.build.typescript,
        ...(source.build.typescriptPackage ? { typescriptPackage: source.build.typescriptPackage } : {}),
        offscreencanvasTypes: source.build.offscreencanvasTypes,
        ...(source.build.offscreencanvasTypesPackage ? { offscreencanvasTypesPackage: source.build.offscreencanvasTypesPackage } : {}),
        command: source.build.typescriptPackage
          ? `node node_modules/${source.build.typescriptPackage.alias}/bin/tsc -p ${source.build.tsconfig}`
          : `npx --yes --package typescript@${source.build.typescript} tsc -p ${source.build.tsconfig}`,
        ...(source.patch ? {
          upstreamArtifacts: Object.fromEntries(Object.entries(source.buildArtifacts).map(([artifact, hashes]) => [artifact, hashes.upstreamSha256])),
          patchedArtifacts: Object.fromEntries(Object.entries(source.buildArtifacts).map(([artifact, hashes]) => [artifact, hashes.patchedSha256])),
        } : {}),
        javascriptSha256BeforeEsmBoundary: expectedJavascript,
        declarationsSha256BeforeEsmBoundary: expectedDeclarations,
        javascriptSha256: source.buildArtifacts["spine-webgl.js"].sha256,
        declarationsSha256: source.buildArtifacts["spine-webgl.d.ts"].sha256,
        sourceMapSha256: source.buildArtifacts["spine-webgl.js.map"].sha256,
        esmBoundary: "The generated namespace build is unchanged before a trailing ESM export and matching declaration.",
      },
      license: { path: "LICENSE", sha256: source.licenseSha256 },
    }, null, 2)}\n`);
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  const source = (await readSources()).runtimes[options.version];
  if (!source || source.kind !== "git-vendor") fail(`Spine ${options.version} 不是已固定的 legacy Runtime`);
  if (options.commit !== source.commit) fail(`Spine ${options.version} commit 与固定官方来源不符`);
  if (!source.archiveSha256 || !source.build || !source.buildArtifacts || !source.licenseSha256) {
    fail(`Spine ${options.version} 来源元数据尚未完整固定，拒绝生成`);
  }
  await buildRuntime(source, options.archive, options.output);
  console.log(`Spine ${options.version} vendor 资产已从固定官方归档生成`);
} catch (error) {
  console.error(`Runtime vendor 生成失败：${error?.message || String(error)}`);
  process.exitCode = 1;
}
