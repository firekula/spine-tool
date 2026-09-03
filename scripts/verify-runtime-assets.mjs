import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalizedRoot = repositoryRoot.split(sep).join("/");
const isProjectPath = (moduleId, projectPath) => moduleId.startsWith(`${normalizedRoot}${projectPath}`);

const runtimes = {
  "3.8": {
    entry: "/lib/spine/runtime-3_8.ts",
    source: "/vendor/spine-runtime-3.8/spine-webgl.js",
  },
  "4.0": {
    alias: "@esotericsoftware/spine-webgl-4.0",
    entry: "/lib/spine/runtime-4_0.ts",
    version: "4.0.31",
    tarballSha256: "fdfe7fc72b870a4da238f349634dd043390b5035dbce6782e7e4288adc6648a1",
  },
  "4.1": {
    alias: "@esotericsoftware/spine-webgl-4.1",
    entry: "/lib/spine/runtime-4_1.ts",
    version: "4.1.56",
    tarballSha256: "fc9c0c579e7d91fcba007fabdc7ecced6fad70fca84bd6e3374a3a4f6ac23e4d",
  },
  "4.2": {
    alias: "@esotericsoftware/spine-webgl-4.2",
    entry: "/lib/spine/runtime-4_2.ts",
    version: "4.2.120",
    tarballSha256: "d1cfacd523602524ed497c8b794cd394a52cc8118cf6a680b4542585e1f36666",
  },
};

async function json(path) {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
}

async function sha256(path) {
  const contents = await readFile(resolve(repositoryRoot, path));
  return createHash("sha256").update(contents).digest("hex");
}

function sha256Contents(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

const packageJson = await json("package.json");
const packageLock = await json("package-lock.json");
const documentation = await readFile(resolve(repositoryRoot, "docs/runtime-versions.md"), "utf8");
const provenance = await json("vendor/spine-runtime-3.8/SOURCE.json");

assert.equal(provenance.commit, "8b4844bd4b193ba9e54487ed397a777993cbad56");
assert.equal(provenance.sourceArchiveSha256, "a31be4f37fb5ffa9b88822c38889efa406fb2201046592b8fdcb6d22925db9a4");
const javascriptBoundary = "\n\n// ESM boundary added by this project; the runtime above is the official build.\nexport { spine };\n";
const declarationBoundary = "\ndeclare const spineRuntime: typeof spine;\nexport { spineRuntime as spine };\n";
const vendoredJavascript = await readFile(
  resolve(repositoryRoot, "vendor/spine-runtime-3.8/spine-webgl.js"),
  "utf8",
);
const vendoredDeclarations = await readFile(
  resolve(repositoryRoot, "vendor/spine-runtime-3.8/spine-webgl.d.ts"),
  "utf8",
);
assert.ok(vendoredJavascript.endsWith(javascriptBoundary));
assert.ok(vendoredDeclarations.endsWith(declarationBoundary));
assert.equal(
  sha256Contents(vendoredJavascript.slice(0, -javascriptBoundary.length)),
  "46fa3cc7d59ccbd81f69f2e04313092243133d3e32e6bca953d63aefdcbdafa3",
);
assert.equal(
  sha256Contents(vendoredDeclarations.slice(0, -declarationBoundary.length)),
  "da9d140cf744dbb339043c26e3c1b629dc3e3e3b8ba6a20cd29c4d2935ac9047",
);
assert.equal(
  await sha256("vendor/spine-runtime-3.8/spine-webgl.js"),
  provenance.build.javascriptSha256,
);
assert.equal(
  await sha256("vendor/spine-runtime-3.8/spine-webgl.d.ts"),
  provenance.build.declarationsSha256,
);
assert.equal(
  await sha256("vendor/spine-runtime-3.8/spine-webgl.js.map"),
  provenance.build.sourceMapSha256,
);
assert.equal(await sha256("vendor/spine-runtime-3.8/LICENSE"), provenance.license.sha256);
assert.equal(
  await sha256("public/licenses/SPINE-RUNTIMES-LICENSE.txt"),
  "435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e",
);
assert.equal(
  await readFile(resolve(repositoryRoot, "public/licenses/SPINE-RUNTIMES-LICENSE.txt"), "utf8"),
  await readFile(resolve(repositoryRoot, "node_modules/@esotericsoftware/spine-webgl-4.2/LICENSE"), "utf8"),
);

const coreDirectories = new Set();
for (const [editorVersion, runtime] of Object.entries(runtimes)) {
  if (editorVersion === "3.8") {
    assert.ok(documentation.includes(runtime.source.slice(1)));
    assert.ok(documentation.includes(provenance.sourceArchiveSha256));
    continue;
  }

  const dependencyValue = `npm:@esotericsoftware/spine-webgl@${runtime.version}`;
  assert.equal(packageJson.dependencies[runtime.alias], dependencyValue);
  const packagePath = `node_modules/@esotericsoftware/${runtime.alias.split("/").at(-1)}`;
  const installedPackage = await json(`${packagePath}/package.json`);
  const lockedPackage = packageLock.packages[packagePath];
  assert.equal(installedPackage.version, runtime.version);
  assert.equal(lockedPackage.version, runtime.version);
  assert.equal(lockedPackage.dependencies["@esotericsoftware/spine-core"], runtime.version);
  assert.ok(lockedPackage.integrity.startsWith("sha512-"));
  assert.ok(documentation.includes(runtime.tarballSha256));
  assert.equal(
    await sha256(`${packagePath}/LICENSE`),
    runtime.version === "4.2.120"
      ? "435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e"
      : "6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39",
  );

  const nestedCore = `${packagePath}/node_modules/@esotericsoftware/spine-core`;
  const rootCore = "node_modules/@esotericsoftware/spine-core";
  let corePath = nestedCore;
  try {
    await readFile(resolve(repositoryRoot, nestedCore, "package.json"));
  } catch {
    corePath = rootCore;
  }
  const corePackage = await json(`${corePath}/package.json`);
  assert.equal(corePackage.version, runtime.version);
  runtime.packagePath = `/${packagePath}/`;
  runtime.corePath = `/${corePath}/`;
  coreDirectories.add(corePath);
}
assert.equal(coreDirectories.size, 3, "4.x runtimes must resolve to three physical core packages");

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

for (const [editorVersion, runtime] of Object.entries(runtimes)) {
  const chunk = chunks.find((candidate) => (
    candidate.facadeModuleId?.split(sep).join("/").endsWith(runtime.entry)
  ));
  assert.ok(chunk, `missing dynamic runtime chunk for ${editorVersion}`);
  const modules = Object.keys(chunk.modules).map((id) => id.split(sep).join("/"));
  const expectedSource = editorVersion === "3.8" ? runtime.source : runtime.packagePath;
  assert.ok(modules.some((id) => id.includes(expectedSource)), `${editorVersion} chunk misses ${expectedSource}`);

  if (editorVersion !== "3.8") {
    assert.ok(modules.some((id) => isProjectPath(id, runtime.corePath)), `${editorVersion} chunk misses own core`);
  }

  for (const [otherVersion, otherRuntime] of Object.entries(runtimes)) {
    if (otherVersion === editorVersion) continue;
    const forbidden = otherVersion === "3.8" ? otherRuntime.source : otherRuntime.packagePath;
    assert.ok(!modules.some((id) => id.includes(forbidden)), `${editorVersion} chunk imports ${otherVersion}`);
    if (otherVersion !== "3.8") {
      assert.ok(
        !modules.some((id) => isProjectPath(id, otherRuntime.corePath)),
        `${editorVersion} chunk imports ${otherVersion} core`,
      );
    }
  }

  const relativeChunk = chunk.fileName.replace(normalizedRoot, "");
  console.log(`${editorVersion}: ${relativeChunk} (${modules.length} modules)`);
}

console.log("Verified 4 isolated Spine runtimes");
