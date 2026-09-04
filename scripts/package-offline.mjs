import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
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

function assertCanonicalArchivePath(path, { allowNonAscii = false } = {}) {
  assert.equal(path.normalize("NFC"), path, `离线归档路径必须使用规范化 Unicode：${JSON.stringify(path)}`);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(path), `离线归档路径不得包含控制字符：${JSON.stringify(path)}`);
  if (!allowNonAscii) {
    assert.match(path, /^[\x20-\x7e]+$/, `离线归档路径只允许可打印 ASCII：${JSON.stringify(path)}`);
  }
  assert.ok(!path.includes("\\"), `离线归档路径不得包含反斜杠：${JSON.stringify(path)}`);
  assert.ok(!posix.isAbsolute(path), `离线归档路径不得为绝对路径：${JSON.stringify(path)}`);
  assert.equal(posix.normalize(path), path, `离线归档路径必须为规范相对路径：${JSON.stringify(path)}`);
  const segments = path.split("/");
  assert.ok(
    path.length > 0 && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    `离线归档路径包含非法 segment：${JSON.stringify(path)}`,
  );
  for (const segment of segments) {
    assert.ok(!/[ .]$/.test(segment), `离线归档路径 segment 不得以点或空格结尾：${JSON.stringify(path)}`);
    assert.ok(!/[<>:"|?*]/.test(segment), `离线归档路径包含 Windows 保留字符：${JSON.stringify(path)}`);
    const deviceName = segment.split(".", 1)[0].replace(/[ .]+$/g, "");
    assert.ok(
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(deviceName),
      `离线归档路径包含 Windows 设备名：${JSON.stringify(path)}`,
    );
  }
}

function assertContainedByRoot(rootPath, targetPath, label) {
  const relativePath = relative(rootPath, targetPath);
  assert.ok(
    relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)),
    `离线构建 ${label} 的 realpath 越出构建根：${targetPath}`,
  );
}

function assertSameIdentity(actual, expected, message) {
  assert.equal(actual.dev, expected.dev, message);
  assert.equal(actual.ino, expected.ino, message);
}

async function verifyDirectoryIdentity(directory, rootPath) {
  let listed;
  let resolvedPath;
  try {
    listed = await lstat(directory.path, { bigint: true });
    resolvedPath = await realpath(directory.path);
  } catch (error) {
    throw new Error(`离线构建目录在枚举与读取之间发生替换或移除：${directory.path}: ${error.code ?? error.message}`);
  }
  assert.ok(
    listed.isDirectory() && !listed.isSymbolicLink(),
    `离线构建目录祖先必须是普通目录，拒绝符号链接、junction 或非目录：${directory.path}`,
  );
  assertSameIdentity(listed, directory.identity, `离线构建目录在枚举与读取之间发生替换：${directory.path}`);
  assert.equal(resolvedPath, directory.realPath, `离线构建目录 realpath 在枚举与读取之间发生替换：${directory.path}`);
  assertContainedByRoot(rootPath, resolvedPath, "目录");
  const opened = await directory.handle.stat({ bigint: true });
  assert.ok(opened.isDirectory(), `离线构建已打开的目录 handle 不再指向目录：${directory.path}`);
  assertSameIdentity(opened, directory.identity, `离线构建目录 handle identity 发生变化：${directory.path}`);
}

async function verifyDirectoryAncestors(directories, rootPath) {
  // Node does not expose openat-style child traversal. Keep every traversed
  // directory handle open and re-check path identity/realpath around each
  // descendant snapshot so an ancestor swap fails closed at a checkpoint.
  for (const directory of directories) await verifyDirectoryIdentity(directory, rootPath);
}

async function openVerifiedDirectory(path, rootPath, ancestors) {
  await verifyDirectoryAncestors(ancestors, rootPath);
  const listed = await lstat(path, { bigint: true });
  assert.ok(
    listed.isDirectory() && !listed.isSymbolicLink(),
    `离线构建目录祖先必须是普通目录，拒绝符号链接、junction 或非目录：${path}`,
  );
  const resolvedPath = await realpath(path);
  assertContainedByRoot(rootPath, resolvedPath, "目录");

  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    throw new Error(`离线构建无法安全打开目录（拒绝符号链接或 junction）：${path}: ${error.code ?? error.message}`);
  }

  try {
    const opened = await handle.stat({ bigint: true });
    assert.ok(opened.isDirectory(), `离线构建目录祖先必须是普通目录：${path}`);
    assertSameIdentity(opened, listed, `离线构建目录在打开前发生替换：${path}`);
    return { path, realPath: resolvedPath, identity: opened, handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function snapshotRegularFile(path, rootPath, ancestors) {
  await verifyDirectoryAncestors(ancestors, rootPath);
  const listed = await lstat(path, { bigint: true });
  assert.ok(listed.isFile(), `离线构建只允许普通文件，拒绝符号链接或特殊文件：${path}`);
  const resolvedPath = await realpath(path);
  assertContainedByRoot(rootPath, resolvedPath, "文件");

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
    assertSameIdentity(opened, listed, `离线构建文件在枚举与读取之间发生替换：${path}`);
    await verifyDirectoryAncestors(ancestors, rootPath);
    const contents = await handle.readFile();
    const afterRead = await lstat(path, { bigint: true });
    assert.ok(afterRead.isFile(), `离线构建文件读取后不再是普通文件：${path}`);
    assertSameIdentity(afterRead, opened, `离线构建文件在读取期间发生替换：${path}`);
    const afterRealPath = await realpath(path);
    assert.equal(afterRealPath, resolvedPath, `离线构建文件 realpath 在读取期间发生替换：${path}`);
    assertContainedByRoot(rootPath, afterRealPath, "文件");
    await verifyDirectoryAncestors(ancestors, rootPath);
    return contents;
  } finally {
    await handle.close();
  }
}

async function snapshotFilesRecursively(rootDirectory, afterDirectoryRead) {
  const rootPath = await realpath(rootDirectory);
  const listedRoot = await lstat(rootDirectory, { bigint: true });
  assert.ok(
    listedRoot.isDirectory() && !listedRoot.isSymbolicLink(),
    `离线构建根必须是普通目录，拒绝符号链接或 junction：${rootDirectory}`,
  );

  const visit = async (directoryPath, ancestors) => {
    const directory = await openVerifiedDirectory(directoryPath, rootPath, ancestors);
    const lineage = [...ancestors, directory];
    try {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      await afterDirectoryRead?.(directoryPath);
      await verifyDirectoryIdentity(directory, rootPath);

      const files = [];
      for (const entry of entries) {
        const path = resolve(directoryPath, entry.name);
        if (entry.isDirectory()) files.push(...await visit(path, lineage));
        else files.push({ path, contents: await snapshotRegularFile(path, rootPath, lineage) });
      }
      await verifyDirectoryIdentity(directory, rootPath);
      return files;
    } finally {
      await directory.handle.close();
    }
  };

  return visit(rootDirectory, []);
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
  return path.split("/").some((segment) => /(^|[^a-z0-9])runtime(?=[^a-z0-9]|$)/i.test(segment));
}

function windowsArchivePathKey(path) {
  return path
    .split("/")
    .map((segment) => segment.replace(/[ .]+$/g, "").toLowerCase())
    .join("/");
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

  const outputFiles = await snapshotFilesRecursively(outputDirectory, options.afterDirectoryRead);
  const archiveFiles = outputFiles.map(({ path, contents }) => {
    const relativePath = toArchivePath(relative(outputDirectory, path));
    const archivePath = relativePath === offlineEntry ? "index.html" : relativePath;
    assertCanonicalArchivePath(archivePath);
    return {
      path,
      archivePath,
      contents,
    };
  }).sort((left, right) => left.archivePath < right.archivePath ? -1 : left.archivePath > right.archivePath ? 1 : 0);

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
    contents: await snapshotRegularFile(path, await realpath(repositoryRoot), []),
  })));

  const generatedArchivePaths = ["离线使用说明.txt", ...launcherFiles.map(({ archivePath }) => archivePath)];
  for (const archivePath of generatedArchivePaths) assertCanonicalArchivePath(archivePath, { allowNonAscii: true });
  const allArchivePaths = [...archiveFiles.map(({ archivePath }) => archivePath), ...generatedArchivePaths];
  const windowsPathKeys = new Map();
  for (const archivePath of allArchivePaths) {
    const key = windowsArchivePathKey(archivePath);
    assert.ok(
      !windowsPathKeys.has(key),
      `离线归档路径在 Windows 语义下发生碰撞：${windowsPathKeys.get(key)} / ${archivePath}`,
    );
    windowsPathKeys.set(key, archivePath);
  }

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
    if (!/\.(?:html|js|css)$/i.test(file.archivePath)) continue;
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
