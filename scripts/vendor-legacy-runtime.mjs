import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
      fail("参数无效；用法：vendor-legacy-runtime.mjs --version X.Y --commit SHA --archive PATH");
    }
    values.set(flag, value);
  }
  const allowed = new Set(["--version", "--commit", "--archive"]);
  if (values.size !== allowed.size || [...values.keys()].some((flag) => !allowed.has(flag))) {
    fail("参数无效；用法：vendor-legacy-runtime.mjs --version X.Y --commit SHA --archive PATH");
  }
  return {
    version: values.get("--version"),
    commit: values.get("--commit"),
    archive: resolve(values.get("--archive")),
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

async function buildRuntime(source, archivePath) {
  const archiveContents = await readFile(archivePath);
  assert.equal(
    digest(archiveContents),
    source.archiveSha256,
    "来源归档 SHA-256 不匹配",
  );

  const workDirectory = await mkdtemp(resolve(tmpdir(), "spine-legacy-runtime-"));
  try {
    await run("tar", ["-xf", archivePath, "-C", workDirectory], { cwd: repositoryRoot });
    const sourceDirectory = resolve(workDirectory, source.build.sourceDirectory);
    await run(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install", "--no-save", "--ignore-scripts", "--package-lock=false",
        `@types/offscreencanvas@${source.build.offscreencanvasTypes}`,
      ],
      { cwd: sourceDirectory },
    );
    await run(
      process.platform === "win32" ? "npx.cmd" : "npx",
      [
        "--yes", "--package", `typescript@${source.build.typescript}`,
        "tsc", "-p", source.build.tsconfig,
      ],
      { cwd: sourceDirectory },
    );

    const buildDirectory = resolve(sourceDirectory, source.build.outputDirectory);
    const upstreamJavascript = await readFile(resolve(buildDirectory, "spine-webgl.js"), "utf8");
    const upstreamDeclarations = await readFile(resolve(buildDirectory, "spine-webgl.d.ts"), "utf8");
    const sourceMap = await readFile(resolve(buildDirectory, "spine-webgl.js.map"));
    const javascript = `${upstreamJavascript}${javascriptBoundary}`;
    const declarations = `${upstreamDeclarations}${declarationBoundary}`;

    assert.equal(
      digest(upstreamJavascript),
      source.buildArtifacts["spine-webgl.js"].upstreamSha256,
      "官方 JavaScript 构建产物 SHA-256 不匹配",
    );
    assert.equal(
      digest(upstreamDeclarations),
      source.buildArtifacts["spine-webgl.d.ts"].upstreamSha256,
      "官方 declaration 构建产物 SHA-256 不匹配",
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
      digest(sourceMap),
      source.buildArtifacts["spine-webgl.js.map"].sha256,
      "source map 构建产物 SHA-256 不匹配",
    );

    const licensePath = resolve(sourceDirectory, "LICENSE");
    assert.equal(digest(await readFile(licensePath)), source.licenseSha256, "许可证 SHA-256 不匹配");

    const vendorDirectory = resolve(repositoryRoot, source.vendorDirectory);
    await mkdir(vendorDirectory, { recursive: true });
    await writeFile(resolve(vendorDirectory, "spine-webgl.js"), javascript);
    await writeFile(resolve(vendorDirectory, "spine-webgl.d.ts"), declarations);
    await writeFile(resolve(vendorDirectory, "spine-webgl.js.map"), sourceMap);
    await copyFile(licensePath, resolve(vendorDirectory, "LICENSE"));
    await writeFile(resolve(vendorDirectory, "SOURCE.json"), `${JSON.stringify({
      repository: "https://github.com/EsotericSoftware/spine-runtimes.git",
      branch: source.branch,
      commit: source.commit,
      sourcePath: source.build.sourceDirectory,
      sourceArchiveSha256: source.archiveSha256,
      build: {
        typescript: source.build.typescript,
        offscreencanvasTypes: source.build.offscreencanvasTypes,
        command: `npx --yes --package typescript@${source.build.typescript} tsc -p ${source.build.tsconfig}`,
        javascriptSha256BeforeEsmBoundary: source.buildArtifacts["spine-webgl.js"].upstreamSha256,
        declarationsSha256BeforeEsmBoundary: source.buildArtifacts["spine-webgl.d.ts"].upstreamSha256,
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
  await buildRuntime(source, options.archive);
  console.log(`Spine ${options.version} vendor 资产已从固定官方归档生成`);
} catch (error) {
  console.error(`Runtime vendor 生成失败：${error?.message || String(error)}`);
  process.exitCode = 1;
}
