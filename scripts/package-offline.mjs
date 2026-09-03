import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import JSZip from "jszip";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(process.env.SPINE_OFFLINE_DIST_DIR ?? resolve(repositoryRoot, "dist-offline"));
const offlineEntry = "offline/index.html";
const requiredLicense = "licenses/SPINE-RUNTIMES-LICENSE.txt";
const requiredRuntimeChunks = ["3_8", "4_0", "4_1", "4_2"];
const outputArchive = resolve(process.env.SPINE_OFFLINE_ARCHIVE ?? resolve(repositoryRoot, "spine-preview-export-offline.zip"));
const execFileAsync = promisify(execFile);
const zipEntryOptions = {
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  createFolders: false,
  date: new Date("1980-01-01T00:00:00.000Z"),
  unixPermissions: 0o100644,
};

const offlineInstructions = `Spine 动画预览与 Atlas 子图导出工具（离线版）

本离线包已包含页面、四个 Spine Runtime 和许可文件；启动后不需要联网。

Windows 64 位推荐启动方式：双击“启动离线工具.cmd”。它会调用 Windows 自带 PowerShell 建立本机 HTTP 服务，并自动打开浏览器。若浏览器没有自动打开，请访问脚本窗口显示的 http://127.0.0.1:8765/ 。关闭 PowerShell 窗口即可停止服务。

不要直接双击 index.html：部分浏览器会限制 file:// 页面加载 ES module。请使用上述本机服务；不需要安装 Node.js、Python 或任何第三方软件。

请使用启用硬件加速且支持 WebGL 的新版 Chrome、Edge 或 Firefox。所有导入和导出只在本机浏览器内存中完成。
`;

function toArchivePath(path) {
  return path.split(sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function externalRuntimeDependencies(path, contents) {
  const occurrences = [];
  const record = (pattern) => {
    for (const match of contents.matchAll(pattern)) occurrences.push(`${path}: ${match[0]}`);
  };
  if (path.endsWith(".html")) {
    record(/(?:src|href|srcset|action)\s*=\s*["'](?:https?:)?\/\//gi);
  } else if (path.endsWith(".css")) {
    record(/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//gi);
    record(/url\(\s*["']?(?:https?:)?\/\//gi);
  } else if (path.endsWith(".js")) {
    record(/\bimport\s*\(\s*["'](?:https?:)?\/\//gi);
    record(/\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](?:https?:)?\/\//gi);
    record(/\bimportScripts\s*\(\s*["'](?:https?:)?\/\//gi);
    record(/\b(?:fetch|(?:window|self|globalThis)\s*\.\s*fetch)\s*\(\s*["'](?:https?:)?\/\//gi);
    record(/\.\s*open\s*\(\s*["'][^"']*["']\s*,\s*["'](?:https?:)?\/\//gi);
    record(/\bnew\s+(?:Worker|SharedWorker)\s*\(\s*(?:new\s+URL\s*\(\s*)?["'](?:https?:)?\/\//gi);
    record(/\bnew\s+(?:WebSocket|EventSource)\s*\(\s*["'](?:(?:https?|wss?):)?\/\//gi);
    record(/\bnew\s+URL\s*\(\s*["'](?:https?:)?\/\//gi);
    record(/\b(?:navigator\s*\.\s*)?sendBeacon\s*\(\s*["'](?:https?:)?\/\//gi);
    record(/\.\s*(?:src|href)\s*=\s*["'](?:https?:)?\/\//gi);

    for (const match of contents.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+URL\s*\(\s*)?["'](?:https?:)?\/\//gi)) {
      const name = match[1];
      const reference = escapeRegExp(name);
      const externalBindingUse = new RegExp([
        `\\b(?:fetch|(?:window|self|globalThis)\\s*\\.\\s*fetch|importScripts|sendBeacon)\\s*\\(\\s*${reference}\\b`,
        `\\bimport\\s*\\(\\s*${reference}\\b`,
        `\\bnew\\s+(?:Worker|SharedWorker|WebSocket|EventSource)\\s*\\(\\s*${reference}\\b`,
        `\\.\\s*open\\s*\\(\\s*["'][^"']*["']\\s*,\\s*${reference}\\b`,
      ].join("|"), "i");
      if (externalBindingUse.test(contents)) occurrences.push(`${path}: 外部 URL 变量 ${name}`);
    }
  }
  return occurrences;
}

async function buildOffline() {
  if (process.env.SPINE_OFFLINE_SKIP_BUILD === "1") return;
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(npmCommand, ["run", "build:offline"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}

await buildOffline();

const outputFiles = await filesRecursively(outputDirectory);
const archiveFiles = outputFiles.map((path) => {
  const relativePath = toArchivePath(relative(outputDirectory, path));
  return {
    path,
    archivePath: relativePath === offlineEntry ? "index.html" : relativePath,
  };
}).sort((left, right) => left.archivePath < right.archivePath ? -1 : left.archivePath > right.archivePath ? 1 : 0);
const archivePaths = new Set(archiveFiles.map(({ archivePath }) => archivePath));

assert.ok(archivePaths.has("index.html"), "离线构建缺少 offline/index.html");
assert.ok(archivePaths.has(requiredLicense), `离线构建缺少许可文件 ${requiredLicense}`);
for (const version of requiredRuntimeChunks) {
  assert.ok(
    [...archivePaths].some((path) => new RegExp(`^assets/runtime-${version}-[A-Za-z0-9_-]+\\.js$`).test(path)),
    `离线构建缺少 Spine ${version.replace("_", ".")} Runtime chunk`,
  );
}

const remoteDependencies = [];
for (const file of archiveFiles) {
  if (!/\.(?:html|js|css)$/.test(file.archivePath)) continue;
  remoteDependencies.push(...externalRuntimeDependencies(file.archivePath, await readFile(file.path, "utf8")));
}
assert.deepEqual(remoteDependencies, [], `离线构建包含远程运行依赖：\n${remoteDependencies.join("\n")}`);

const zip = new JSZip();
for (const file of archiveFiles) {
  const contents = await readFile(file.path);
  zip.file(file.archivePath, contents, zipEntryOptions);
}
zip.file("离线使用说明.txt", offlineInstructions, zipEntryOptions);
zip.file("Start-Offline.ps1", await readFile(resolve(repositoryRoot, "offline/Start-Offline.ps1")), zipEntryOptions);
zip.file("启动离线工具.cmd", await readFile(resolve(repositoryRoot, "offline/启动离线工具.cmd")), zipEntryOptions);

await writeFile(outputArchive, await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  platform: "UNIX",
}));
console.log(`Created ${relative(repositoryRoot, outputArchive)} with ${archiveFiles.length + 3} files`);
