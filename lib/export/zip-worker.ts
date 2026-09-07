/// <reference lib="webworker" />

import JSZip from "jszip";
import type { ZipCompressionEntry } from "@/lib/export/zip-compressor";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const entryOptions = {
  createFolders: false,
  date: new Date("1980-01-01T00:00:00.000Z"),
  unixPermissions: 0o100644,
} as const;

workerScope.onmessage = async (event: MessageEvent<{ type: string; entries: ZipCompressionEntry[] }>) => {
  if (event.data.type !== "compress") return;
  try {
    const zip = new JSZip();
    for (const entry of event.data.entries) zip.file(entry.path, entry.bytes, entryOptions);
    let started = false;
    const bytes = await zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      platform: "UNIX",
    }, () => {
      if (started) return;
      started = true;
      workerScope.postMessage({ type: "started" });
    });
    workerScope.postMessage({ type: "success", bytes }, [bytes]);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "ZIP Worker 压缩失败。",
    });
  }
};
