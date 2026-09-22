import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "@/components/workspace-shell";
import type { ExportAllResult } from "@/lib/export/export-zip";
import type { ImportBundle } from "@/lib/files/import-files";
import type { PreparedImport } from "@/lib/files/import-workflow";

const mocks = vi.hoisted(() => ({
  classifyImport: vi.fn(),
  createRuntimeSession: vi.fn(),
  exportAllRegions: vi.fn(),
  prepareImport: vi.fn(),
}));

vi.mock("@/lib/files/import-files", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/files/import-files")>(),
  classifyImport: mocks.classifyImport,
}));
vi.mock("@/lib/files/import-workflow", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/files/import-workflow")>(),
  createRuntimeSession: mocks.createRuntimeSession,
  prepareImport: mocks.prepareImport,
}));
vi.mock("@/lib/export/export-zip", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/export/export-zip")>(),
  exportAllRegions: mocks.exportAllRegions,
}));

function atlasText(regionCount: number): string {
  return [
    "page.png",
    "size: 1,1",
    ...Array.from({ length: regionCount }, (_, index) => [
      `region-${index}`,
      "bounds: 0,0,1,1",
      "offsets: 0,0,1,1",
    ]).flat(),
  ].join("\n");
}

function pngHeader(width = 1, height = 1): Uint8Array {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(header.buffer).setUint32(8, 13);
  header.set([73, 72, 68, 82], 12);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  return header;
}

function pngFile(name: string): File {
  const bytes = pngHeader();
  const file = new File([bytes], name, { type: "image/png" });
  Object.defineProperty(file, "slice", {
    value: (start = 0, end = bytes.byteLength) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer,
    }),
  });
  return file;
}

function bundle(name: string, regionCount: number): ImportBundle {
  const atlas = atlasText(regionCount);
  return {
    atlasFile: new File([atlas], `${name}.atlas`),
    atlasText: atlas,
    skeletonFile: new File([JSON.stringify({ skeleton: { spine: "4.3.0" } })], `${name}.json`),
    skeletonKind: "json",
    textureFiles: new Map([["page.png", pngFile("page.png")]]),
    unusedTextures: [],
  };
}

async function preparedWithRealLease(
  source: ImportBundle,
  bitmap: ImageBitmap,
): Promise<PreparedImport> {
  const actual = await vi.importActual<typeof import("@/lib/files/import-workflow")>("@/lib/files/import-workflow");
  return actual.prepareImport(source, {
    detectVersion: async () => ({ raw: "4.3.0", majorMinor: "4.3", source: "json-field", supported: true, compatibility: "stable" }),
    decodeTexture: async () => bitmap,
  });
}

describe("workspace export/import race", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:stale-zip"),
      revokeObjectURL: vi.fn(),
    });
    mocks.createRuntimeSession.mockRejectedValue(new Error("synthetic preview unavailable"));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("旧 200 Region 导出后立即导入新项目，不下载残缺旧 ZIP 或污染新状态", async () => {
    const oldBundle = bundle("old", 200);
    const newBundle = bundle("new", 1);
    const oldClose = vi.fn();
    const newClose = vi.fn();
    const oldPrepared = await preparedWithRealLease(oldBundle, {
      width: 1, height: 1, close: oldClose,
    } as unknown as ImageBitmap);
    const newPrepared = await preparedWithRealLease(newBundle, {
      width: 1, height: 1, close: newClose,
    } as unknown as ImageBitmap);
    mocks.classifyImport.mockResolvedValueOnce(oldBundle).mockResolvedValueOnce(newBundle);
    mocks.prepareImport.mockResolvedValueOnce(oldPrepared).mockResolvedValueOnce(newPrepared);
    let resolveOldExport!: (result: ExportAllResult) => void;
    let staleProgress!: (done: number, total: number) => void;
    let oldSignal!: AbortSignal;
    mocks.exportAllRegions.mockImplementationOnce((_input, onProgress, options) => {
      staleProgress = onProgress;
      oldSignal = options.signal;
      onProgress(1, 200);
      return new Promise<ExportAllResult>((resolve) => { resolveOldExport = resolve; });
    });
    render(<WorkspaceShell />);
    const fileInput = document.querySelector('input[type="file"]')!;

    fireEvent.change(fileInput, { target: { files: [new File(["old"], "old.atlas")] } });
    await screen.findByRole("heading", { name: "Region（200）" });
    await userEvent.setup().click(screen.getByRole("button", { name: /导出全部 ZIP/ }));
    await waitFor(() => expect(mocks.exportAllRegions).toHaveBeenCalledTimes(1));

    fireEvent.change(fileInput, { target: { files: [new File(["new"], "new.atlas")] } });
    await screen.findByRole("heading", { name: "Region（1）" });
    expect(oldSignal.aborted).toBe(true);
    expect(oldClose).not.toHaveBeenCalled();

    staleProgress(200, 200);
    resolveOldExport({
      blob: new Blob(["partial old zip"]),
      report: {
        version: 1,
        inferredScale: { restoreMultiplier: 1, exportPercent: 100, confidence: "low", sampleCount: 0, evidence: [], warnings: [] },
        summary: { successful: 1, skipped: 0, failed: 199, total: 200 },
        regions: [],
      },
      issues: [{ code: "REGION_OUT_OF_BOUNDS", severity: "warning", subject: "Region「old」", details: ["旧导出错误"] }],
    });

    await waitFor(() => expect(oldClose).toHaveBeenCalledTimes(1));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(screen.queryByText(/已处理 200 \/ 200/)).toBeNull();
    expect(screen.queryByText("旧导出错误")).toBeNull();
    expect(screen.queryByText(/失败 199 项/)).toBeNull();
  });

  it("单 Region 失败会在问题中心展示中文对象、原因和行动，并准确汇总结果", async () => {
    const source = bundle("warning", 1);
    const prepared = await preparedWithRealLease(source, {
      width: 1, height: 1, close: vi.fn(),
    } as unknown as ImageBitmap);
    mocks.classifyImport.mockResolvedValueOnce(source);
    mocks.prepareImport.mockResolvedValueOnce(prepared);
    mocks.exportAllRegions.mockResolvedValueOnce({
      blob: new Blob(["zip"]),
      report: {
        version: 1,
        inferredScale: { restoreMultiplier: 1, exportPercent: 100, confidence: "low", sampleCount: 0, evidence: [], warnings: [] },
        summary: { successful: 0, skipped: 0, failed: 1, total: 1 },
        regions: [],
      },
      issues: [{
        code: "REGION_OUT_OF_BOUNDS",
        severity: "warning",
        subject: "Region「region-0」",
        details: ["Region「region-0」的裁切范围超出纹理页 page.png（1×1）"],
      }],
    });
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["warning"], "warning.atlas")] },
    });
    await screen.findByRole("heading", { name: "Region（1）" });
    await userEvent.setup().click(screen.getByRole("button", { name: /导出全部 ZIP/ }));

    const center = await screen.findByRole("region", { name: "问题中心" });
    await waitFor(() => expect(center.textContent).toContain("Region 超出纹理范围"));
    expect(center.textContent).toContain("对象Region「region-0」");
    expect(center.textContent).toContain("裁切矩形既超出 PNG 纹理页，也超出 Atlas 为该页声明的尺寸");
    expect(center.textContent).toContain("请检查 Atlas 与 PNG 是否来自同一次导出");
    expect(screen.getByText(/导出完成：成功 0 项，跳过 0 项，失败 1 项/)).toBeTruthy();
  });
});
