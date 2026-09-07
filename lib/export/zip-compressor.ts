import JSZip from "jszip";

export interface ZipCompressionEntry {
  path: string;
  bytes: ArrayBuffer;
}

export interface ZipCompressionWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface ZipCompressionOptions {
  signal?: AbortSignal;
  workerFactory?: () => ZipCompressionWorker | null;
  /** Test/telemetry hook fired only after the Worker has begun compression. */
  onWorkerStarted?: () => void;
  /** Test/telemetry hook fired from real inline DEFLATE progress. */
  onInlineProgress?: (percent: number) => void;
}

const entryOptions = {
  createFolders: false,
  date: new Date("1980-01-01T00:00:00.000Z"),
  unixPermissions: 0o100644,
} as const;

function abortError(): Error {
  const error = new Error("导出已取消");
  error.name = "AbortError";
  return error;
}

function defaultWorkerFactory(): ZipCompressionWorker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./zip-worker.ts", import.meta.url), { type: "module" });
}

async function compressInline(entries: ZipCompressionEntry[], options: ZipCompressionOptions): Promise<Blob> {
  if (options.signal?.aborted) throw abortError();
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.path, entry.bytes, entryOptions);
  const bytes = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  }, ({ percent }) => {
    if (options.signal?.aborted) throw abortError();
    options.onInlineProgress?.(percent);
    if (options.signal?.aborted) throw abortError();
  });
  if (options.signal?.aborted) throw abortError();
  return new Blob([bytes], { type: "application/zip" });
}

/** Compresses in a disposable Worker in browsers so AbortSignal can stop DEFLATE itself. */
export function compressZipEntries(
  entries: ZipCompressionEntry[],
  options: ZipCompressionOptions = {},
): Promise<Blob> {
  if (options.signal?.aborted) return Promise.reject(abortError());
  let worker: ZipCompressionWorker | null;
  try {
    worker = options.workerFactory ? options.workerFactory() : defaultWorkerFactory();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error("ZIP Worker 创建失败。"));
  }
  if (!worker) return compressInline(entries, options);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: { blob?: Blob; error?: Error }) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      if (result.error) reject(result.error);
      else resolve(result.blob!);
    };
    const onAbort = () => finish({ error: abortError() });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onerror = (event) => finish({
      error: new Error(event.message || "ZIP Worker 压缩失败。"),
    });
    worker.onmessage = (event) => {
      if (settled) return;
      const message = event.data as { type?: string; bytes?: ArrayBuffer; error?: string };
      if (message.type === "started") {
        try {
          options.onWorkerStarted?.();
        } catch (error) {
          finish({ error: error instanceof Error ? error : new Error("ZIP Worker started hook 失败。") });
        }
        return;
      }
      if (message.type === "success" && message.bytes instanceof ArrayBuffer) {
        finish({ blob: new Blob([message.bytes], { type: "application/zip" }) });
        return;
      }
      finish({ error: new Error(message.error || "ZIP Worker 返回了无效结果。") });
    };

    const transferable = entries.map(({ bytes }) => bytes);
    try {
      worker.postMessage({ type: "compress", entries }, transferable);
    } catch (error) {
      finish({ error: error instanceof Error ? error : new Error("ZIP Worker 消息发送失败。") });
    }
  });
}
