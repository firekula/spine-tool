#!/usr/bin/env node
// 手动构建 Docker 镜像，可选导出可直接上传服务器的 .tar.gz 归档。
//
//   node scripts/build-docker-image.mjs                    # 按 package.json 版本构建
//   node scripts/build-docker-image.mjs --save             # 构建并导出 docker-image/spine-tool-<版本>.tar.gz
//   node scripts/build-docker-image.mjs --platform linux/arm64 --save
//   node scripts/build-docker-image.mjs --tag spine-tool:0.2.0 --no-cache
//
// 对应的 npm 脚本：npm run docker:build / npm run docker:package

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const HELP = `构建 Spine 工具 Docker 镜像。

用法：node scripts/build-docker-image.mjs [选项]

选项：
  --tag <名称:标签>     镜像标签，默认 spine-tool:<package.json 版本>
  --platform <平台>     目标平台，例如 linux/amd64、linux/arm64；默认使用本机平台
  --save                构建后导出 gzip 压缩的镜像归档，并打印 SHA-256
  --output <目录>       归档输出目录，默认 docker-image（相对项目根目录）
  --no-cache            忽略构建缓存
  --with-provenance     保留 BuildKit provenance/SBOM 证明（默认关闭以得到单清单归档）
  -h, --help            显示本帮助
`;

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    tag: undefined,
    platform: undefined,
    save: false,
    output: "docker-image",
    noCache: false,
    provenance: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--tag") options.tag = argv[++index];
    else if (argument === "--platform") options.platform = argv[++index];
    else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--save") options.save = true;
    else if (argument === "--no-cache") options.noCache = true;
    else if (argument === "--with-provenance") options.provenance = true;
    else if (argument === "-h" || argument === "--help") {
      console.log(HELP);
      process.exit(0);
    } else {
      fail(`未知参数 ${argument}；使用 --help 查看用法。`);
    }
  }
  for (const key of ["tag", "platform", "output"]) {
    if (options[key] !== undefined && !options[key]) fail(`--${key} 需要非空值。`);
  }
  return options;
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(" ")} 退出码 ${code}`));
    });
  });
}

function succeeded(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolvePromise(false));
    child.on("close", (code) => resolvePromise(code === 0));
  });
}

function capture(command, args) {
  return new Promise((resolvePromise) => {
    let output = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", () => resolvePromise(""));
    child.on("close", () => resolvePromise(output.trim()));
  });
}

const options = parseArguments(process.argv.slice(2));

if (!(await succeeded("docker", ["--version"]))) {
  fail("找不到可用的 docker 命令，请先安装并启动 Docker。");
}

const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const tag = options.tag ?? `spine-tool:${packageJson.version}`;

// buildx 能关闭 provenance/SBOM 从而得到可被 docker save 单清单导出的镜像；
// 只有旧版 Docker 才退回 docker build。
const useBuildx = await succeeded("docker", ["buildx", "version"]);
const buildArgs = useBuildx ? ["buildx", "build", "--load"] : ["build"];
buildArgs.push("-t", tag);
if (useBuildx && !options.provenance) buildArgs.push("--provenance=false", "--sbom=false");
if (options.platform) buildArgs.push("--platform", options.platform);
if (options.noCache) buildArgs.push("--no-cache");
buildArgs.push(".");

console.log(`构建镜像 ${tag}${options.platform ? `（${options.platform}）` : ""}…`);
try {
  await run("docker", buildArgs);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const imageInfo = await capture("docker", ["image", "inspect", tag, "--format", "{{.Os}}/{{.Architecture}} {{.Size}}"]);
console.log(`镜像就绪：${tag}${imageInfo ? ` ${imageInfo}` : ""}`);

if (!options.save) {
  console.log("提示：加 --save 可导出可上传服务器的 .tar.gz 归档。");
  process.exit(0);
}

const outputDirectory = resolve(projectRoot, options.output);
await mkdir(outputDirectory, { recursive: true });
const archiveBase = tag.replace(/[^A-Za-z0-9._-]+/g, "-");
const tarPath = join(outputDirectory, `${archiveBase}.tar`);
const archivePath = `${tarPath}.gz`;

console.log(`导出归档 ${archivePath}…`);
try {
  await run("docker", ["save", "-o", tarPath, tag]);
  await pipeline(
    createReadStream(tarPath),
    createGzip({ level: 9 }),
    createWriteStream(archivePath),
  );
} catch (error) {
  await rm(tarPath, { force: true });
  fail(error instanceof Error ? error.message : String(error));
}
await rm(tarPath, { force: true });

const { size } = await stat(archivePath);
const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
console.log("");
console.log(`归档：${archivePath}`);
console.log(`大小：${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`SHA-256：${digest}`);
console.log("部署：docker load -i <归档>，再 docker compose up -d");
