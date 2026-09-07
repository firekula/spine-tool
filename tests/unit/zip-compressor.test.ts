import { describe, expect, it, vi } from "vitest";
import { compressZipEntries, type ZipCompressionWorker } from "@/lib/export/zip-compressor";

class BlockingWorker implements ZipCompressionWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

describe("ZIP Worker 压缩", () => {
  it("postMessage 同步失败时也终止 Worker 并清理监听", async () => {
    const worker = new BlockingWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("structured clone failed");
    });
    const controller = new AbortController();

    await expect(compressZipEntries([
      { path: "a.txt", bytes: new TextEncoder().encode("a").buffer },
    ], { signal: controller.signal, workerFactory: () => worker })).rejects.toThrow("structured clone failed");

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("abort 会立即 terminate 正在压缩的 Worker 并拒绝 AbortError", async () => {
    const worker = new BlockingWorker();
    const controller = new AbortController();
    const pending = compressZipEntries([
      { path: "large.bin", bytes: new Uint8Array(1024 * 1024).buffer },
    ], { signal: controller.signal, workerFactory: () => worker });

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "导出已取消" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("Worker 成功后释放 Worker，并返回 ZIP Blob", async () => {
    const worker = new BlockingWorker();
    const pending = compressZipEntries([{ path: "a.txt", bytes: new TextEncoder().encode("a").buffer }], {
      workerFactory: () => worker,
    });
    const bytes = new Uint8Array([0x50, 0x4b]).buffer;
    worker.onmessage?.(new MessageEvent("message", { data: { type: "success", bytes } }));

    const blob = await pending;
    expect(blob.type).toBe("application/zip");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("Worker started hook 抛错时拒绝 Promise 并终止 Worker", async () => {
    const worker = new BlockingWorker();
    const pending = compressZipEntries([{ path: "a.txt", bytes: new Uint8Array([1]).buffer }], {
      workerFactory: () => worker,
      onWorkerStarted: () => { throw new Error("telemetry failed"); },
    });

    expect(() => worker.onmessage?.(new MessageEvent("message", { data: { type: "started" } }))).not.toThrow();
    await expect(pending).rejects.toThrow("telemetry failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("无 Worker fallback 会在真实 DEFLATE 进度回调中响应 abort", async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024);
    let state = 0x12345678;
    for (let index = 0; index < bytes.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      bytes[index] = state >>> 24;
    }
    const controller = new AbortController();
    const pending = compressZipEntries([{ path: "random.bin", bytes: bytes.buffer }], {
      signal: controller.signal,
      workerFactory: () => null,
      onInlineProgress: () => controller.abort(),
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "导出已取消" });
  });

  it("相同条目在 inline 路径产生完全相同的 ZIP bytes", async () => {
    const entries = [
      { path: "b.txt", bytes: new TextEncoder().encode("repeatable-b").buffer },
      { path: "a.txt", bytes: new TextEncoder().encode("repeatable-a").buffer },
    ];

    const first = new Uint8Array(await (await compressZipEntries(entries)).arrayBuffer());
    const second = new Uint8Array(await (await compressZipEntries(entries)).arrayBuffer());

    expect(second).toEqual(first);
  });
});
