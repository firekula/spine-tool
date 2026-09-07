import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdtemp, open, opendir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import JSZip from "jszip";
import {
  externalRuntimeDependencies,
  matchesTrustedOfflineRuntimeArtifact,
  trustedOfflineAssetDescriptors,
  trustedOfflineRuntimeDescriptors,
  trustedOfflineRuntimeHelperDescriptors,
} from "./offline-runtime-audit.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const offlineEntry = "offline/index.html";
const requiredLicenseDescriptors = Object.freeze([
  Object.freeze({
    path: "licenses/SPINE-RUNTIMES-LICENSE-v2.5.txt",
    sha256: "d2af98ecac7e4bb6e4c4491fc734db7762b94626b18bcc87c7eac6febd86e1b5",
    versions: "3.5–3.6",
  }),
  Object.freeze({
    path: "licenses/SPINE-RUNTIMES-LICENSE-2019.txt",
    sha256: "6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39",
    versions: "3.7–4.1",
  }),
  Object.freeze({
    path: "licenses/SPINE-RUNTIMES-LICENSE-2025.txt",
    sha256: "435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e",
    versions: "4.2–4.3",
  }),
]);
const trustedLauncherDescriptors = Object.freeze([
  Object.freeze({ path: "Start-Offline.ps1", sha256: "8aca0fc2e72038af9ee1fd9c7e16c696e2b6c4790735cc1c5d87d3ebc6c55c33" }),
  Object.freeze({ path: "启动离线工具.cmd", sha256: "a3410032a6b2cf6593a294a085e23625430946becc6a0abbd2db66647baac180" }),
]);
const execFileAsync = promisify(execFile);
const MAX_SNAPSHOT_FILES = 128;
const MAX_SNAPSHOT_DIRECTORIES = 64;
const MAX_SNAPSHOT_DEPTH = 16;
const MAX_SNAPSHOT_ENTRIES = MAX_SNAPSHOT_FILES + MAX_SNAPSHOT_DIRECTORIES;
const MAX_SNAPSHOT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_TOTAL_BYTES = 32 * 1024 * 1024;
const zipEntryOptions = {
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  createFolders: false,
  date: new Date("1980-01-01T00:00:00.000Z"),
  unixPermissions: 0o100644,
};

const offlineInstructions = `Spine 动画预览与 Atlas 子图导出工具（离线版）

本离线包已包含页面、八个 Spine Runtime 及其三份原始许可文件；启动后不需要联网。

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

async function verifyPathAncestorGuard(directory) {
  let listed;
  let resolvedPath;
  try {
    listed = await lstat(directory.path, { bigint: true });
    resolvedPath = await realpath(directory.path);
  } catch (error) {
    throw new Error(`离线构建根路径祖先发生替换或移除：${directory.path}: ${error.code ?? error.message}`);
  }
  assert.ok(
    listed.isDirectory() && !listed.isSymbolicLink(),
    `离线构建根路径祖先必须是普通目录，拒绝符号链接或 junction：${directory.path}`,
  );
  assertSameIdentity(listed, directory.identity, `离线构建根路径祖先发生 identity 替换：${directory.path}`);
  assert.equal(resolvedPath, directory.realPath, `离线构建根路径祖先 realpath 发生替换：${directory.path}`);
  const opened = await directory.handle.stat({ bigint: true });
  assert.ok(opened.isDirectory(), `离线构建根路径祖先 handle 不再指向目录：${directory.path}`);
  assertSameIdentity(opened, directory.identity, `离线构建根路径祖先 handle identity 发生变化：${directory.path}`);
}

async function verifyPathAncestorGuards(directories) {
  for (const directory of directories) await verifyPathAncestorGuard(directory);
}

async function openPathAncestorGuards(targetPath) {
  const paths = [];
  let current = dirname(resolve(targetPath));
  while (true) {
    paths.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  paths.reverse();

  const directories = [];
  try {
    for (const path of paths) {
      await verifyPathAncestorGuards(directories);
      const listed = await lstat(path, { bigint: true });
      assert.ok(
        listed.isDirectory() && !listed.isSymbolicLink(),
        `离线构建根路径祖先必须是普通目录，拒绝符号链接或 junction：${path}`,
      );
      const resolvedPath = await realpath(path);
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      );
      try {
        const opened = await handle.stat({ bigint: true });
        assert.ok(opened.isDirectory(), `离线构建根路径祖先必须是普通目录：${path}`);
        assertSameIdentity(opened, listed, `离线构建根路径祖先在打开前发生替换：${path}`);
        directories.push({ path, realPath: resolvedPath, identity: opened, handle });
      } catch (error) {
        await handle.close();
        throw error;
      }
    }
    return directories;
  } catch (error) {
    await Promise.allSettled(directories.map(({ handle }) => handle.close()));
    throw error;
  }
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

function reserveSnapshotBudget(path, size, budget) {
  assert.ok(
    size <= BigInt(MAX_SNAPSHOT_FILE_BYTES),
    `离线构建单文件大小预算为 8 MiB，已拒绝：${path} (${size} bytes)`,
  );
  assert.ok(
    budget.fileCount + 1 <= MAX_SNAPSHOT_FILES,
    `离线构建文件数预算为 ${MAX_SNAPSHOT_FILES}，已拒绝：${path}`,
  );
  assert.ok(
    budget.totalBytes + size <= BigInt(MAX_SNAPSHOT_TOTAL_BYTES),
    `离线构建累计总大小预算为 32 MiB，已拒绝：${path}`,
  );
  budget.fileCount += 1;
  budget.totalBytes += size;
}

async function readFixedSizeFile(handle, size, path) {
  const expectedBytes = Number(size);
  const contents = Buffer.allocUnsafe(expectedBytes);
  let offset = 0;
  while (offset < expectedBytes) {
    const { bytesRead } = await handle.read(contents, offset, expectedBytes - offset, offset);
    assert.ok(bytesRead > 0, `离线构建文件在读取期间缩短：${path}`);
    offset += bytesRead;
  }
  const overflow = Buffer.allocUnsafe(1);
  const { bytesRead: overflowBytes } = await handle.read(overflow, 0, 1, expectedBytes);
  assert.equal(overflowBytes, 0, `离线构建文件在读取期间增长：${path}`);
  return contents;
}

async function snapshotRegularFile(path, rootPath, ancestors, budget) {
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
    assert.equal(opened.size, listed.size, `离线构建文件在枚举与读取之间改变大小：${path}`);
    reserveSnapshotBudget(path, opened.size, budget);
    await verifyDirectoryAncestors(ancestors, rootPath);
    const contents = await readFixedSizeFile(handle, opened.size, path);
    const afterRead = await lstat(path, { bigint: true });
    assert.ok(afterRead.isFile(), `离线构建文件读取后不再是普通文件：${path}`);
    assertSameIdentity(afterRead, opened, `离线构建文件在读取期间发生替换：${path}`);
    assert.equal(afterRead.size, opened.size, `离线构建文件在读取期间改变大小：${path}`);
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
  const budget = { directoryCount: 0, entryCount: 0, fileCount: 0, totalBytes: 0n };
  const pathAncestorGuards = await openPathAncestorGuards(rootDirectory);
  try {
    await verifyPathAncestorGuards(pathAncestorGuards);
    const rootPath = await realpath(rootDirectory);
    const listedRoot = await lstat(rootDirectory, { bigint: true });
    assert.ok(
      listedRoot.isDirectory() && !listedRoot.isSymbolicLink(),
      `离线构建根必须是普通目录，拒绝符号链接或 junction：${rootDirectory}`,
    );

    const visit = async (directoryPath, ancestors, depth) => {
      assert.ok(
        depth <= MAX_SNAPSHOT_DEPTH,
        `离线构建目录深度预算为 ${MAX_SNAPSHOT_DEPTH}，已拒绝：${directoryPath}`,
      );
      budget.directoryCount += 1;
      assert.ok(
        budget.directoryCount <= MAX_SNAPSHOT_DIRECTORIES,
        `离线构建目录数预算为 ${MAX_SNAPSHOT_DIRECTORIES}，已拒绝：${directoryPath}`,
      );
      await verifyPathAncestorGuards(pathAncestorGuards);
      const directory = await openVerifiedDirectory(directoryPath, rootPath, ancestors);
      const lineage = [...ancestors, directory];
      try {
        const entries = [];
        const iterator = await opendir(directoryPath, { bufferSize: 32 });
        try {
          for await (const entry of iterator) {
            budget.entryCount += 1;
            assert.ok(
              budget.entryCount <= MAX_SNAPSHOT_ENTRIES,
              `离线构建目录项数量预算为 ${MAX_SNAPSHOT_ENTRIES}，已拒绝：${directoryPath}`,
            );
            entries.push(entry);
          }
        } finally {
          await iterator.close().catch((error) => {
            if (error?.code !== "ERR_DIR_CLOSED") throw error;
          });
        }
        entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        await afterDirectoryRead?.(directoryPath);
        await verifyPathAncestorGuards(pathAncestorGuards);
        await verifyDirectoryIdentity(directory, rootPath);

        const files = [];
        for (const entry of entries) {
          await verifyPathAncestorGuards(pathAncestorGuards);
          const path = resolve(directoryPath, entry.name);
          if (entry.isDirectory()) files.push(...await visit(path, lineage, depth + 1));
          else files.push({ path, contents: await snapshotRegularFile(path, rootPath, lineage, budget) });
        }
        await verifyPathAncestorGuards(pathAncestorGuards);
        await verifyDirectoryIdentity(directory, rootPath);
        return files;
      } finally {
        await directory.handle.close();
      }
    };

    const files = await visit(rootDirectory, [], 0);
    await verifyPathAncestorGuards(pathAncestorGuards);
    return files;
  } finally {
    await Promise.allSettled(pathAncestorGuards.map(({ handle }) => handle.close()));
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
  return path.split("/").some((segment) => /(^|[^a-z0-9])runtime(?=[^a-z0-9]|$)/i.test(segment));
}

function windowsArchivePathKey(path) {
  return path
    .split("/")
    .map((segment) => segment.replace(/[ .]+$/g, "").toLowerCase())
    .join("/");
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function assertExactDescriptorSet(actualFiles, descriptors, label) {
  const actualPaths = actualFiles.map(({ archivePath }) => archivePath).sort();
  const expectedPaths = descriptors.map(({ path }) => path).sort();
  assert.deepEqual(actualPaths, expectedPaths, `${label}文件集合必须与已审查 manifest 完全一致`);
  const filesByPath = new Map(actualFiles.map((file) => [file.archivePath, file]));
  for (const descriptor of descriptors) {
    const file = filesByPath.get(descriptor.path);
    assert.ok(file, `${label}缺少 ${descriptor.path}`);
    assert.equal(sha256(file.contents), descriptor.sha256, `${label} SHA-256 不匹配：${descriptor.path}`);
  }
}

function isContainedPath(rootPath, targetPath) {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === ""
    || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

async function createGuardedTemporaryDirectory(parent, prefix, label, ancestorGuards, ownsAncestorGuards = false) {
  await verifyPathAncestorGuards(ancestorGuards);
  const path = await mkdtemp(resolve(parent, prefix));
  let handle;
  try {
    const listed = await lstat(path, { bigint: true });
    assert.ok(
      listed.isDirectory() && !listed.isSymbolicLink(),
      `${label}必须是普通目录：${path}`,
    );
    const resolvedPath = await realpath(path);
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    assert.ok(opened.isDirectory(), `${label} handle 必须指向目录：${path}`);
    assertSameIdentity(opened, listed, `${label}在创建与打开之间发生 identity 替换：${path}`);
    await verifyPathAncestorGuards(ancestorGuards);
    return {
      path,
      realPath: resolvedPath,
      identity: opened,
      handle,
      label,
      ancestorGuards,
      ownsAncestorGuards,
      closed: false,
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    // Creation has no adversarial callback before this point. A non-recursive
    // rmdir is still used so an unexpected non-empty replacement is preserved.
    await rmdir(path).catch(() => {});
    if (ownsAncestorGuards) {
      await Promise.allSettled(ancestorGuards.map(({ handle: ancestorHandle }) => ancestorHandle.close()));
    }
    throw error;
  }
}

async function verifyGuardedTemporaryDirectory(directory) {
  await verifyPathAncestorGuards(directory.ancestorGuards);
  let listed;
  let resolvedPath;
  try {
    listed = await lstat(directory.path, { bigint: true });
    resolvedPath = await realpath(directory.path);
  } catch (error) {
    throw new Error(`${directory.label}发生替换或移除：${directory.path}: ${error.code ?? error.message}`);
  }
  assert.ok(
    listed.isDirectory() && !listed.isSymbolicLink(),
    `${directory.label}必须保持为普通目录：${directory.path}`,
  );
  assertSameIdentity(listed, directory.identity, `${directory.label}发生 identity 替换：${directory.path}`);
  assert.equal(resolvedPath, directory.realPath, `${directory.label} realpath 发生替换：${directory.path}`);
  const opened = await directory.handle.stat({ bigint: true });
  assert.ok(opened.isDirectory(), `${directory.label} handle 不再指向目录：${directory.path}`);
  assertSameIdentity(opened, directory.identity, `${directory.label} handle identity 发生变化：${directory.path}`);
  await verifyPathAncestorGuards(directory.ancestorGuards);
}

function fileGuard(handle, identity, label) {
  return { handle, identity, label, closed: false };
}

async function closeFileGuard(guard) {
  if (!guard || guard.closed) return;
  guard.closed = true;
  await guard.handle.close();
}

async function closeDirectoryGuard(directory) {
  if (!directory || directory.closed) return;
  directory.closed = true;
  await directory.handle.close();
}

async function verifyGuardedFilePath(path, guard, expectedSize, expectedMode) {
  const listed = await lstat(path, { bigint: true });
  assert.ok(
    listed.isFile() && !listed.isSymbolicLink(),
    `${guard.label}路径必须保持为普通文件：${path}`,
  );
  const opened = guard.closed ? guard.identity : await guard.handle.stat({ bigint: true });
  assert.ok(opened.isFile(), `${guard.label} handle 必须指向普通文件：${path}`);
  assertSameIdentity(listed, guard.identity, `${guard.label}路径发生 identity 替换：${path}`);
  assertSameIdentity(opened, guard.identity, `${guard.label} handle identity 发生变化：${path}`);
  if (expectedSize !== undefined) {
    assert.equal(listed.size, BigInt(expectedSize), `${guard.label}大小发生变化：${path}`);
    assert.equal(opened.size, BigInt(expectedSize), `${guard.label} handle 大小发生变化：${path}`);
  }
  if (expectedMode !== undefined && process.platform !== "win32") {
    assert.equal(Number(listed.mode & 0o777n), expectedMode, `${guard.label}权限发生变化：${path}`);
    assert.equal(Number(opened.mode & 0o777n), expectedMode, `${guard.label} handle 权限发生变化：${path}`);
  }
  return listed;
}

async function verifyGuardedFileContents(path, guard, expectedContents, expectedMode) {
  assert.ok(!guard.closed, `${guard.label}内容复核要求保持已打开 handle：${path}`);
  await verifyGuardedFilePath(path, guard, expectedContents.byteLength, expectedMode);
  const reread = await readFixedSizeFile(guard.handle, BigInt(expectedContents.byteLength), path);
  assert.ok(reread.equals(expectedContents), `${guard.label}内容或 SHA-256 在提交窗口发生变化：${path}`);
  await verifyGuardedFilePath(path, guard, expectedContents.byteLength, expectedMode);
}

async function unlinkGuardedLeaf(path, guard, { allowMissing = false } = {}) {
  let listed;
  try {
    listed = await lstat(path, { bigint: true });
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return;
    throw error;
  }
  assert.ok(
    listed.isFile() && !listed.isSymbolicLink(),
    `${guard.label}清理只允许已确认的普通文件 leaf：${path}`,
  );
  assertSameIdentity(listed, guard.identity, `${guard.label}清理前发生 identity 替换：${path}`);
  await closeFileGuard(guard);
  const beforeUnlink = await lstat(path, { bigint: true });
  assert.ok(beforeUnlink.isFile() && !beforeUnlink.isSymbolicLink(), `${guard.label}清理目标不再是普通文件：${path}`);
  assertSameIdentity(beforeUnlink, guard.identity, `${guard.label}关闭 handle 后发生 identity 替换：${path}`);
  await unlink(path);
}

async function cleanupGuardedTemporaryDirectory(directory, leaf) {
  let failure;
  try {
    await verifyGuardedTemporaryDirectory(directory);
    if (leaf) {
      await unlinkGuardedLeaf(leaf.path, leaf.guard, { allowMissing: leaf.allowMissing });
    }
    await verifyGuardedTemporaryDirectory(directory);
    await closeDirectoryGuard(directory);
    const listed = await lstat(directory.path, { bigint: true });
    assert.ok(listed.isDirectory() && !listed.isSymbolicLink(), `${directory.label}清理目标不再是普通目录`);
    assertSameIdentity(listed, directory.identity, `${directory.label}清理前发生 identity 替换：${directory.path}`);
    await rmdir(directory.path);
  } catch (error) {
    failure = error;
  } finally {
    if (leaf) await closeFileGuard(leaf.guard).catch(() => {});
    await closeDirectoryGuard(directory).catch(() => {});
    if (directory.ownsAncestorGuards) {
      await Promise.allSettled(directory.ancestorGuards.map(({ handle }) => handle.close()));
    }
  }
  if (failure) throw failure;
}

function combinedCleanupError(error, cleanupErrors) {
  if (cleanupErrors.length === 0) return error;
  const messages = [error, ...cleanupErrors].map((item) => item instanceof Error ? item.message : String(item));
  return new AggregateError([error, ...cleanupErrors], messages.join("；"));
}

async function isolateExistingArchive(outputArchive, outputDirectory, afterArchiveTargetOpened) {
  const outputGuards = await openPathAncestorGuards(outputArchive);
  let quarantine;
  let targetFile;
  try {
    await verifyPathAncestorGuards(outputGuards);
    let listed;
    try {
      listed = await lstat(outputArchive, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") return { outputGuards, quarantine: undefined };
      throw error;
    }
    assert.ok(
      listed.isFile() && !listed.isSymbolicLink(),
      `离线 ZIP 旧目标必须是普通文件，拒绝符号链接、目录或特殊文件：${outputArchive}`,
    );
    const targetHandle = await open(
      outputArchive,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const opened = await targetHandle.stat({ bigint: true });
    assert.ok(opened.isFile(), `离线 ZIP 旧目标必须是普通文件：${outputArchive}`);
    assertSameIdentity(opened, listed, `离线 ZIP 旧目标在隔离前发生替换：${outputArchive}`);
    targetFile = fileGuard(targetHandle, opened, "离线 ZIP 旧目标");

    // Keep quarantine outside the snapshotted build tree when an archive path
    // is placed inside it by a caller.
    const outputRoot = resolve(outputDirectory);
    const archiveParent = dirname(outputArchive);
    const quarantineParent = isContainedPath(outputRoot, archiveParent)
      ? dirname(outputRoot)
      : archiveParent;
    const quarantineGuards = await openPathAncestorGuards(resolve(quarantineParent, "archive-placeholder"));
    const directory = await createGuardedTemporaryDirectory(
      quarantineParent,
      ".spine-offline-previous-",
      "离线 ZIP 旧目标隔离目录",
      quarantineGuards,
      true,
    );
    const quarantinedArchive = resolve(directory.path, "previous.zip");
    quarantine = { directory, archivePath: quarantinedArchive, file: targetFile };
    await afterArchiveTargetOpened?.();
    await verifyGuardedTemporaryDirectory(directory);
    await verifyPathAncestorGuards(outputGuards);
    await rename(outputArchive, quarantinedArchive);
    await verifyGuardedTemporaryDirectory(directory);
    await verifyPathAncestorGuards(outputGuards);
    await verifyGuardedFilePath(quarantinedArchive, targetFile, Number(opened.size));
    return { outputGuards, quarantine };
  } catch (error) {
    const cleanupErrors = [];
    if (quarantine) {
      await cleanupGuardedTemporaryDirectory(quarantine.directory, {
        path: quarantine.archivePath,
        guard: quarantine.file,
        allowMissing: true,
      }).catch((cleanupError) => cleanupErrors.push(cleanupError));
    } else if (targetFile) {
      await closeFileGuard(targetFile).catch((cleanupError) => cleanupErrors.push(cleanupError));
    }
    await Promise.allSettled(outputGuards.map(({ handle }) => handle.close()));
    throw combinedCleanupError(error, cleanupErrors);
  }
}

async function verifyArchiveTarget(target) {
  await verifyPathAncestorGuards(target.outputGuards);
  if (!target.quarantine) return;
  await verifyGuardedTemporaryDirectory(target.quarantine.directory);
  await verifyGuardedFilePath(
    target.quarantine.archivePath,
    target.quarantine.file,
    Number(target.quarantine.file.identity.size),
  );
}

async function releaseArchiveTarget(target) {
  let failure;
  try {
    if (target.quarantine) {
      await cleanupGuardedTemporaryDirectory(target.quarantine.directory, {
        path: target.quarantine.archivePath,
        guard: target.quarantine.file,
      });
    }
  } catch (error) {
    failure = error;
  } finally {
    await Promise.allSettled(target.outputGuards.map(({ handle }) => handle.close()));
  }
  if (failure) throw failure;
}

async function writeArchiveAtomically(outputArchive, contents, beforeArchiveCommit, pathAncestorGuards) {
  let temporaryDirectory;
  let temporaryFile;
  let published = false;
  let cleanupAttempted = false;
  try {
    await verifyPathAncestorGuards(pathAncestorGuards);
    temporaryDirectory = await createGuardedTemporaryDirectory(
      dirname(outputArchive),
      ".spine-offline-archive-",
      "离线临时 ZIP 目录",
      pathAncestorGuards,
    );
    const temporaryArchive = resolve(temporaryDirectory.path, "archive.zip");
    const temporaryHandle = await open(
      temporaryArchive,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    temporaryFile = fileGuard(temporaryHandle, await temporaryHandle.stat({ bigint: true }), "离线临时 ZIP");
    await temporaryHandle.writeFile(contents);
    await temporaryHandle.chmod(0o644);
    await temporaryHandle.sync();
    temporaryFile.identity = await temporaryHandle.stat({ bigint: true });

    await beforeArchiveCommit?.();
    await verifyPathAncestorGuards(pathAncestorGuards);
    await verifyGuardedTemporaryDirectory(temporaryDirectory);
    await verifyGuardedFileContents(temporaryArchive, temporaryFile, contents, 0o644);
    try {
      // Same-filesystem hard-link publication is atomic and never replaces an
      // existing path: EEXIST wins even in the commit window.
      await link(temporaryArchive, outputArchive);
      published = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`离线 ZIP 目标被并发创建，已拒绝覆盖：${outputArchive}`, { cause: error });
      }
      throw error;
    }
    await verifyPathAncestorGuards(pathAncestorGuards);
    await verifyGuardedTemporaryDirectory(temporaryDirectory);
    const committed = await lstat(outputArchive, { bigint: true });
    assert.ok(committed.isFile() && !committed.isSymbolicLink(), `离线 ZIP 原子提交结果不是普通文件：${outputArchive}`);
    assertSameIdentity(committed, temporaryFile.identity, `离线 ZIP 原子提交 identity 不匹配：${outputArchive}`);
    assert.equal(committed.size, BigInt(contents.byteLength), `离线 ZIP 原子提交后大小不匹配：${outputArchive}`);
    if (process.platform !== "win32") {
      assert.equal(Number(committed.mode & 0o777n), 0o644, `离线 ZIP 原子提交权限不是 0644：${outputArchive}`);
    }
    await verifyGuardedFileContents(temporaryArchive, temporaryFile, contents, 0o644);
    cleanupAttempted = true;
    await cleanupGuardedTemporaryDirectory(temporaryDirectory, {
      path: temporaryArchive,
      guard: temporaryFile,
    });
  } catch (error) {
    const cleanupErrors = [];
    if (published && temporaryFile) {
      await unlinkGuardedLeaf(outputArchive, temporaryFile)
        .catch((cleanupError) => cleanupErrors.push(cleanupError));
    }
    if (temporaryDirectory && !cleanupAttempted) {
      await cleanupGuardedTemporaryDirectory(temporaryDirectory, temporaryFile ? {
        path: resolve(temporaryDirectory.path, "archive.zip"),
        guard: temporaryFile,
        allowMissing: true,
      } : undefined).catch((cleanupError) => cleanupErrors.push(cleanupError));
    } else if (temporaryFile) {
      await closeFileGuard(temporaryFile).catch((cleanupError) => cleanupErrors.push(cleanupError));
    }
    throw combinedCleanupError(error, cleanupErrors);
  }
}

export async function packageOffline(options = {}) {
  const outputDirectory = resolve(
    options.outputDirectory ?? process.env.SPINE_OFFLINE_DIST_DIR ?? resolve(repositoryRoot, "dist-offline"),
  );
  const outputArchive = resolve(
    options.outputArchive ?? process.env.SPINE_OFFLINE_ARCHIVE ?? resolve(repositoryRoot, "spine-preview-export-offline.zip"),
  );
  const skipBuild = options.skipBuild ?? process.env.SPINE_OFFLINE_SKIP_BUILD === "1";
  const launcherDirectory = resolve(
    options.launcherDirectory ?? process.env.SPINE_OFFLINE_LAUNCHER_DIR ?? resolve(repositoryRoot, "offline"),
  );

  const archiveTarget = await isolateExistingArchive(
    outputArchive,
    outputDirectory,
    options.afterArchiveTargetOpened,
  );
  try {
  await buildOffline(skipBuild);
  await verifyArchiveTarget(archiveTarget);

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
  const launcherSnapshots = await snapshotFilesRecursively(
    launcherDirectory,
    options.afterLauncherDirectoryRead,
  );
  const launcherFiles = launcherSnapshots
    .map(({ path, contents }) => ({
      archivePath: toArchivePath(relative(launcherDirectory, path)),
      contents,
    }))
    .filter(({ archivePath }) => /\.(?:cmd|bat|ps1)$/i.test(archivePath))
    .sort((left, right) => left.archivePath < right.archivePath ? -1 : left.archivePath > right.archivePath ? 1 : 0);
  assertExactDescriptorSet(launcherFiles, trustedLauncherDescriptors, "离线 launcher 启动脚本");

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
  await verifyArchiveTarget(archiveTarget);

  assert.ok(archivePaths.has("index.html"), "离线构建缺少 offline/index.html");
  for (const descriptor of requiredLicenseDescriptors) {
    const file = archiveFilesByPath.get(descriptor.path);
    assert.ok(file, `离线构建缺少许可文件 ${descriptor.path}（Spine ${descriptor.versions}）`);
    assert.equal(
      sha256(file.contents),
      descriptor.sha256,
      `离线构建许可文件 SHA-256 不匹配：${descriptor.path}`,
    );
  }
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

  // The committed full allowlist is the primary fail-closed gate. It runs
  // before heuristics so every unreviewed mutation is rejected uniformly.
  assertExactDescriptorSet(archiveFiles, trustedOfflineAssetDescriptors, "离线完整资产 manifest");

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

  const archiveContents = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
  await verifyArchiveTarget(archiveTarget);
  await writeArchiveAtomically(
    outputArchive,
    archiveContents,
    options.beforeArchiveCommit,
    archiveTarget.outputGuards,
  );
  console.log(`Created ${relative(repositoryRoot, outputArchive)} with ${archiveFiles.length + 3} files`);
  } finally {
    await releaseArchiveTarget(archiveTarget);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageOffline();
}
