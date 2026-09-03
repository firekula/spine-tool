import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { externalRuntimeDependencies } from "../../scripts/offline-runtime-audit.mjs";
import { atlasFor, collectPageErrors, importFixture, skeletonJson } from "./fixtures";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
let server: Server;
let origin: string;

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

test.beforeAll(async () => {
  execFileSync(npmCommand, ["run", "package:offline"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
  const offlineZip = await JSZip.loadAsync(await readFile(resolve(repositoryRoot, "spine-preview-export-offline.zip")));
  const filenames = Object.keys(offlineZip.files).filter((name) => !offlineZip.files[name]?.dir).sort();

  expect(filenames).toContain("index.html");
  expect(filenames).toContain("licenses/SPINE-RUNTIMES-LICENSE.txt");
  expect(filenames).toContain("离线使用说明.txt");
  for (const version of ["3_8", "4_0", "4_1", "4_2"]) {
    expect(filenames.some((name) => new RegExp(`^assets/runtime-${version}-[A-Za-z0-9_-]+\\.js$`).test(name))).toBe(true);
  }
  const offlineHtml = await offlineZip.file("index.html")!.async("string");
  for (const directive of [
    "connect-src 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ]) {
    expect(offlineHtml).toContain(directive);
  }

  const runtimeText = await Promise.all(filenames
    .filter((name) => /\.(?:html|js|css)$/.test(name))
    .map(async (name) => ({ name, text: await offlineZip.file(name)!.async("string") })));
  const remoteDependencies = runtimeText
    .flatMap(({ name, text }) => externalRuntimeDependencies(name, text));
  expect(remoteDependencies).toEqual([]);

  server = createServer(async (request, response) => {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const filename = requested === "/" ? "index.html" : decodeURIComponent(requested).replace(/^\/+/, "");
    if (filename.includes("..")) {
      response.writeHead(400).end();
      return;
    }
    const entry = offlineZip.file(filename);
    if (!entry) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": contentType(filename) });
    response.end(await entry.async("nodebuffer"));
  });
  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("离线包测试服务器未获取端口");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolveServer, rejectServer) => server.close((error) => error ? rejectServer(error) : resolveServer()));
});

test("离线包在阻断一切外部请求时仍可导入并导出 ZIP", async ({ page }) => {
  const errors = collectPageErrors(page);
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === origin) {
      await route.continue();
      return;
    }
    externalRequests.push(requestUrl.href);
    await route.abort();
  });

  await page.goto(origin);
  await importFixture(page, { skeleton: skeletonJson("4.2.0"), atlas: atlasFor() });
  await expect(page.getByRole("status").first()).toContainText("Spine 4.2 · 预览已就绪");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  await downloadPromise;

  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
