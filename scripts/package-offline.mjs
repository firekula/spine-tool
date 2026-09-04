import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, writeFile } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import JSZip from "jszip";
import {
  externalRuntimeDependencies,
  matchesTrustedOfflineRuntimeArtifact,
  trustedOfflineRuntimeDescriptors,
  trustedOfflineRuntimeHelperDescriptors,
} from "./offline-runtime-audit.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const offlineEntry = "offline/index.html";
const requiredLicense = "licenses/SPINE-RUNTIMES-LICENSE.txt";
const execFileAsync = promisify(execFile);
const zipEntryOptions = {
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  createFolders: false,
  date: new Date("1980-01-01T00:00:00.000Z"),
  unixPermissions: 0o100644,
};

const offlineInstructions = `Spine 动画预览与 Atlas 子图导出工具（离线版）

本离线包已包含页面、八个 Spine Runtime 和许可文件；启动后不需要联网。

Windows 64 位推荐启动方式：双击“启动离线工具.cmd”。它会调用 Windows 自带 PowerShell 建立本机 HTTP 服务，并自动打开浏览器。若浏览器没有自动打开，请访问脚本窗口显示的 http://127.0.0.1:8765/ 。关闭 PowerShell 窗口即可停止服务。

不要直接双击 index.html：部分浏览器会限制 file:// 页面加载 ES module。请使用上述本机服务；不需要安装 Node.js、Python 或任何第三方软件。

请使用启用硬件加速且支持 WebGL 的新版 Chrome、Edge 或 Firefox。所有导入和导出只在本机浏览器内存中完成。
`;

function toArchivePath(path) {
  return path.split(sep).join("/");
}

function assertCanonicalArchivePath(path) {
  assert.equal(path.normalize("NFC"), path, `离线归档路径必须使用规范化 Unicode：${JSON.stringify(path)}`);
  assert.match(path, /^[\x20-\x7e]+$/, `离线归档路径只允许可打印 ASCII：${JSON.stringify(path)}`);
  assert.ok(!path.includes("\\"), `离线归档路径不得包含反斜杠：${JSON.stringify(path)}`);
  assert.ok(!posix.isAbsolute(path), `离线归档路径不得为绝对路径：${JSON.stringify(path)}`);
  assert.equal(posix.normalize(path), path, `离线归档路径必须为规范相对路径：${JSON.stringify(path)}`);
  assert.ok(
    path.length > 0 && path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    `离线归档路径包含非法 segment：${JSON.stringify(path)}`,
  );
}

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  }));
  return paths.flat();
}

async function snapshotRegularFile(path) {
  const listed = await lstat(path, { bigint: true });
  assert.ok(listed.isFile(), `离线构建只允许普通文件，拒绝符号链接或特殊文件：${path}`);

  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    throw new Error(`离线构建无法安全打开普通文件（拒绝符号链接）：${path}: ${error.code ?? error.message}`);
  }

  try {
    const opened = await handle.stat({ bigint: true });
    assert.ok(opened.isFile(), `离线构建只允许普通文件，拒绝符号链接或特殊文件：${path}`);
    assert.equal(opened.dev, listed.dev, `离线构建文件在枚举与读取之间发生替换：${path}`);
    assert.equal(opened.ino, listed.ino, `离线构建文件在枚举与读取之间发生替换：${path}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function buildOffline(skipBuild) {
  if (skipBuild) return;
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(npmCommand, ["run", "build:offline"], {
    cwd: repositoryRoot,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "inherit",
  });
}

function isRuntimeArtifactCandidate(path) {
  return path.split("/").some((segment) => {
    const lower = segment.toLowerCase();
    return lower.includes("runtime-") || lower.includes("runtime_");
  });
}

export async function packageOffline(options = {}) {
  const outputDirectory = resolve(
    options.outputDirectory ?? process.env.SPINE_OFFLINE_DIST_DIR ?? resolve(repositoryRoot, "dist-offline"),
  );
  const outputArchive = resolve(
    options.outputArchive ?? process.env.SPINE_OFFLINE_ARCHIVE ?? resolve(repositoryRoot, "spine-preview-export-offline.zip"),
  );
  const skipBuild = options.skipBuild ?? process.env.SPINE_OFFLINE_SKIP_BUILD === "1";

  await buildOffline(skipBuild);

  const outputFiles = await filesRecursively(outputDirectory);
  const archiveFiles = (await Promise.all(outputFiles.map(async (path) => {
    const relativePath = toArchivePath(relative(outputDirectory, path));
    const archivePath = relativePath === offlineEntry ? "index.html" : relativePath;
    assertCanonicalArchivePath(archivePath);
    return {
      path,
      archivePath,
      contents: await snapshotRegularFile(path),
    };
  }))).sort((left, right) => left.archivePath < right.archivePath ? -1 : left.archivePath > right.archivePath ? 1 : 0);

  assert.equal(
    new Set(archiveFiles.map(({ archivePath }) => archivePath)).size,
    archiveFiles.length,
    "离线构建包含重复归档路径",
  );
  const archivePaths = new Set(archiveFiles.map(({ archivePath }) => archivePath));
  const archiveFilesByPath = new Map(archiveFiles.map((file) => [file.archivePath, file]));
  const launcherFiles = await Promise.all([
    ["Start-Offline.ps1", resolve(repositoryRoot, "offline/Start-Offline.ps1")],
    ["启动离线工具.cmd", resolve(repositoryRoot, "offline/启动离线工具.cmd")],
  ].map(async ([archivePath, path]) => ({
    archivePath,
    contents: await snapshotRegularFile(path),
  })));

  await options.afterSnapshot?.();

  assert.ok(archivePaths.has("index.html"), "离线构建缺少 offline/index.html");
  assert.ok(archivePaths.has(requiredLicense), `离线构建缺少许可文件 ${requiredLicense}`);
  assert.equal(trustedOfflineRuntimeDescriptors.length, 8, "离线 trusted index 必须精确包含八个 Runtime descriptor");
  assert.equal(trustedOfflineRuntimeHelperDescriptors.length, 1, "离线 trusted index 必须精确包含一个 Runtime helper descriptor");
  const runtimeArtifactPaths = [...archivePaths]
    .filter(isRuntimeArtifactCandidate)
    .sort();
  const runtimeArtifactDescriptors = [
    ...trustedOfflineRuntimeDescriptors,
    ...trustedOfflineRuntimeHelperDescriptors,
  ];
  const expectedRuntimeArtifactPaths = runtimeArtifactDescriptors.map(({ path }) => path).sort();
  assert.deepEqual(
    runtimeArtifactPaths,
    expectedRuntimeArtifactPaths,
    "离线构建 Runtime 文件集合必须精确等于八个可信 entry 与精确 helper",
  );

  for (const descriptor of runtimeArtifactDescriptors) {
    const file = archiveFilesByPath.get(descriptor.path);
    const label = "version" in descriptor
      ? `Spine ${descriptor.version.replace("_", ".")} Runtime`
      : "Runtime shared helper";
    assert.ok(file, `离线构建缺少 ${label}：${descriptor.path}`);
    assert.ok(
      matchesTrustedOfflineRuntimeArtifact(descriptor.path, file.contents),
      `离线构建 ${label} 未命中 descriptor 的完整 path+SHA-256：${descriptor.path}`,
    );
  }

  const remoteDependencies = [];
  for (const file of archiveFiles) {
    if (!/\.(?:html|js|css)$/.test(file.archivePath)) continue;
    remoteDependencies.push(...externalRuntimeDependencies(file.archivePath, file.contents.toString("utf8")));
  }
  assert.deepEqual(remoteDependencies, [], `离线构建包含远程运行依赖：\n${remoteDependencies.join("\n")}`);

  const zip = new JSZip();
  for (const file of archiveFiles) zip.file(file.archivePath, file.contents, zipEntryOptions);
  zip.file("离线使用说明.txt", offlineInstructions, zipEntryOptions);
  for (const file of launcherFiles) zip.file(file.archivePath, file.contents, zipEntryOptions);

  await writeFile(outputArchive, await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  }));
  console.log(`Created ${relative(repositoryRoot, outputArchive)} with ${archiveFiles.length + 3} files`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageOffline();
}
