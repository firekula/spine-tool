import { expect, test } from "@playwright/test";
import { importFixture } from "./fixtures";

declare global {
  interface Window {
    __zipWorkerStats?: {
      created: number;
      started: number;
      terminated: number;
      paddedBytes: number;
    };
  }
}

async function installZipWorkerTracking(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const stats = { created: 0, started: 0, terminated: 0, paddedBytes: 0 };
    window.__zipWorkerStats = stats;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, argumentsList) {
        const worker = Reflect.construct(target, argumentsList) as Worker;
        if (!String(argumentsList[0]).includes("zip-worker")) return worker;
        stats.created += 1;
        const nativePostMessage = worker.postMessage.bind(worker);
        Object.defineProperty(worker, "postMessage", {
          configurable: true,
          value: (message: unknown, transfer: Transferable[] = []) => {
            const request = message as { type?: string; entries?: Array<{ path: string; bytes: ArrayBuffer }> };
            if (request.type !== "compress" || !Array.isArray(request.entries)) {
              nativePostMessage(message, transfer);
              return;
            }
            const padding = Array.from({ length: 24 }, (_, entryIndex) => {
              const bytes = new Uint8Array(1024 * 1024);
              let state = 0x9e3779b9 ^ entryIndex;
              for (let index = 0; index < bytes.length; index += 1) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                bytes[index] = state >>> 24;
              }
              return { path: `__cancel-test-padding-${entryIndex}.bin`, bytes: bytes.buffer };
            });
            stats.paddedBytes += padding.reduce((total, entry) => total + entry.bytes.byteLength, 0);
            nativePostMessage(
              { ...request, entries: [...request.entries, ...padding] },
              [...transfer, ...padding.map((entry) => entry.bytes)],
            );
          },
        });
        worker.addEventListener("message", (event) => {
          if (event.data?.type === "started") stats.started += 1;
        });
        const nativeTerminate = worker.terminate.bind(worker);
        Object.defineProperty(worker, "terminate", {
          configurable: true,
          value: () => {
            stats.terminated += 1;
            nativeTerminate();
          },
        });
        return worker;
      },
    });
  });
}

test("真实 ZIP Worker 两次输出与 inline 路径逐字节一致", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/lib/export/zip-compressor.ts";
    const { compressZipEntries } = await import(modulePath);
    const makeEntries = () => [
      { path: "b/random.bin", bytes: Uint8Array.from({ length: 65_537 }, (_, index) => (index * 73 + 19) & 0xff).buffer },
      { path: "a/说明.txt", bytes: new TextEncoder().encode("Spine ZIP deterministic / 确定性").buffer },
    ];
    let workerStarts = 0;
    const workerFirst = new Uint8Array(await (await compressZipEntries(makeEntries(), {
      onWorkerStarted: () => { workerStarts += 1; },
    })).arrayBuffer());
    const workerSecond = new Uint8Array(await (await compressZipEntries(makeEntries(), {
      onWorkerStarted: () => { workerStarts += 1; },
    })).arrayBuffer());

    const ownWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: undefined });
    let inline: Uint8Array;
    try {
      inline = new Uint8Array(await (await compressZipEntries(makeEntries())).arrayBuffer());
    } finally {
      if (ownWorkerDescriptor) Object.defineProperty(globalThis, "Worker", ownWorkerDescriptor);
      else Reflect.deleteProperty(globalThis, "Worker");
    }

    const sameBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length
      && left.every((byte, index) => byte === right[index]);
    return {
      workerStarts,
      length: workerFirst.length,
      workerPairEqual: sameBytes(workerFirst, workerSecond),
      workerInlineEqual: sameBytes(workerFirst, inline),
    };
  });

  expect(result.workerStarts).toBe(2);
  expect(result.length).toBeGreaterThan(0);
  expect(result.workerPairEqual).toBe(true);
  expect(result.workerInlineEqual).toBe(true);
});

test("真实 ZIP Worker 在压缩中取消后及时停止", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/lib/export/zip-compressor.ts";
    const { compressZipEntries } = await import(modulePath);
    const entries = Array.from({ length: 12 }, (_, entryIndex) => {
      const bytes = new Uint8Array(1024 * 1024);
      let state = 0x12345678 ^ entryIndex;
      for (let index = 0; index < bytes.length; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        bytes[index] = state >>> 24;
      }
      return { path: `random-${entryIndex}.bin`, bytes: bytes.buffer };
    });
    const controller = new AbortController();
    const startedAt = performance.now();
    try {
      await compressZipEntries(entries, {
        signal: controller.signal,
        onWorkerStarted: () => controller.abort(),
      });
      return { rejected: false, name: "", elapsed: performance.now() - startedAt };
    } catch (error) {
      return {
        rejected: true,
        name: error instanceof Error ? error.name : "unknown",
        elapsed: performance.now() - startedAt,
      };
    }
  });

  expect(result).toMatchObject({ rejected: true, name: "AbortError" });
  expect(result.elapsed).toBeLessThan(2_000);
});

test("真实 UI 在 ZIP Worker 压缩中取消后不下载并恢复可导出状态", async ({ page }) => {
  await installZipWorkerTracking(page);
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.goto("/");
  await importFixture(page);

  await page.getByRole("button", { name: /导出全部 ZIP/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "正在压缩 ZIP" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__zipWorkerStats?.started ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__zipWorkerStats?.created ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__zipWorkerStats?.paddedBytes ?? 0)).toBe(24 * 1024 * 1024);

  const cancelledAt = Date.now();
  await page.getByRole("button", { name: "取消导出" }).click();
  await expect(page.getByText("导出已取消。")).toBeVisible();
  await expect(page.getByRole("button", { name: "导出全部 ZIP" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "取消导出" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__zipWorkerStats?.terminated ?? 0)).toBe(1);
  expect(Date.now() - cancelledAt).toBeLessThan(2_000);
  await page.waitForTimeout(300);
  expect(downloads).toEqual([]);
});
