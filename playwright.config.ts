import { defineConfig, devices } from "@playwright/test";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, stat, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createBrotliDecompress } from "node:zlib";

const runtimeTemp = join(dirname(fileURLToPath(import.meta.url)), "node_modules", ".cache", "chromium-runtime");
await mkdir(runtimeTemp, { recursive: true });
process.env.TMPDIR = runtimeTemp;
process.env.FONTCONFIG_PATH = join(runtimeTemp, "fonts");
const { default: chromium } = await import("@sparticuz/chromium");
// The application under test is a WebGL tool. Sparticuz otherwise adds
// --disable-webgl, which would only exercise the Atlas-only fallback path.
chromium.setGraphicsMode = true;

const require = createRequire(import.meta.url);
const chromiumEntry = require.resolve("@sparticuz/chromium");
const chromiumBin = join(dirname(dirname(chromiumEntry)), "bin");
const compressedExecutable = join(chromiumBin, "chromium.br");
const executablePath = join(runtimeTemp, "chromium");
const executable = await stat(executablePath).catch(() => undefined);
if (!executable?.size) {
  await pipeline(
    createReadStream(compressedExecutable),
    createBrotliDecompress(),
    createWriteStream(executablePath, { mode: 0o700 }),
  );
  await chmod(executablePath, 0o700);
}

const glesLibrary = join(runtimeTemp, "libGLESv2.so");
if (!(await stat(glesLibrary).catch(() => undefined))) {
  const swiftshaderArchive = join(runtimeTemp, "swiftshader.tar");
  await pipeline(
    createReadStream(join(chromiumBin, "swiftshader.tar.br")),
    createBrotliDecompress(),
    createWriteStream(swiftshaderArchive),
  );
  await promisify(execFile)("tar", [
    "--extract",
    "--file",
    swiftshaderArchive,
    "--directory",
    runtimeTemp,
    "--no-same-owner",
  ]);
  await unlink(swiftshaderArchive);
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./node_modules/.cache/playwright-results",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: {
      executablePath,
      args: chromium.args.filter((argument) => argument !== "--single-process"),
    },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
