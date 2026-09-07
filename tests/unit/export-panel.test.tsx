import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportAllResult } from "@/lib/export/export-zip";
import type { ExportResources } from "@/lib/files/import-workflow";

const mocks = vi.hoisted(() => ({ exportAllRegions: vi.fn() }));
vi.mock("@/lib/export/export-zip", () => ({ exportAllRegions: mocks.exportAllRegions }));
import { ExportPanel } from "@/components/export-panel";
import type { AtlasDocument } from "@/lib/atlas/types";
import type { ScaleInference } from "@/lib/spine/scale-inference";

const atlas: AtlasDocument = {
  pages: [{ name: "page.png", width: 64, height: 64, custom: {} }],
  regions: ["body/head", "effects/a-very-long-region-name"].map((name, index) => ({
    name, pageName: "page.png", index,
    x: 0, y: 0, packedWidth: 16, packedHeight: 16,
    originalWidth: 16, originalHeight: 16, offsetLeft: 0, offsetBottom: 0,
    rotation: 0, custom: {},
  })),
};

const inferredScale: ScaleInference = {
  restoreMultiplier: 2,
  exportPercent: 50,
  confidence: "high",
  sampleCount: 2,
  evidence: [],
  warnings: [],
};

function renderPanel() {
  return render(<ExportPanel resources={resources(atlas)} inferredScale={inferredScale} sourceVersion="4.2" />);
}

function resources(document: AtlasDocument): ExportResources {
  const textures = new Map([["page.png", {} as ImageBitmap]]);
  return {
    atlas: document,
    textures,
    acquire: () => ({ atlas: document, textures, release: vi.fn() }),
    release: vi.fn(),
  };
}

beforeEach(() => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:zip"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  mocks.exportAllRegions.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ExportPanel", () => {
  it("素材版本未识别时阻断导出，避免静默猜测 Alpha 语义", () => {
    render(<ExportPanel
      resources={resources(atlas)}
      inferredScale={inferredScale}
      sourceVersion={null}
    />);

    expect(screen.getByText("请先在预览区选择素材对应的 Runtime 版本，再导出 Atlas 子图。")) .toBeTruthy();
    expect(screen.getByRole("button", { name: "导出全部 ZIP" })).toHaveProperty("disabled", true);
  });

  it("Spine 3.x 未确认 Alpha 前阻断导出，确认值会传给导出层", async () => {
    mocks.exportAllRegions.mockResolvedValueOnce({
      blob: new Blob(["zip"]),
      report: { version: 1, inferredScale, summary: { successful: 0, skipped: 0, failed: 0, total: 0 }, regions: [] },
      issues: [],
    } satisfies ExportAllResult);
    const view = render(<ExportPanel
      resources={resources(atlas)}
      inferredScale={inferredScale}
      sourceVersion="3.8"
      legacyAlphaMode={null}
    />);

    expect(screen.getByText("请先在预览区明确确认 Spine 3.x 纹理 Alpha 模式。")) .toBeTruthy();
    expect(screen.getByRole("button", { name: "导出全部 ZIP" })).toHaveProperty("disabled", true);

    view.rerender(<ExportPanel
      resources={resources(atlas)}
      inferredScale={inferredScale}
      sourceVersion="3.8"
      legacyAlphaMode="premultiplied"
    />);
    await userEvent.setup().click(screen.getByRole("button", { name: "导出全部 ZIP" }));
    expect(mocks.exportAllRegions).toHaveBeenCalledWith(
      expect.objectContaining({ sourceVersion: "3.8", legacyAlphaMode: "premultiplied" }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("可搜索很长的 Region 名称且保留完整 title", () => {
    renderPanel();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Region" }), { target: { value: "very-long" } });

    expect(screen.queryByText("body/head")).toBeNull();
    expect(screen.getByTitle("effects/a-very-long-region-name")).toBeTruthy();
  });

  it.each(["0", "-1", "NaN", "Infinity"])("阻断无效单项倍率 %s", (value) => {
    renderPanel();

    fireEvent.change(screen.getByRole("textbox", { name: "body/head 的单项倍率" }), { target: { value } });

    expect(screen.getByText("单项倍率必须是大于 0 的有限数值。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "导出全部 ZIP" })).toHaveProperty("disabled", true);
  });

  it("分别显示推算导出比例和含全局倍率的最终恢复倍率", () => {
    renderPanel();

    expect(screen.getByText("推算导出比例")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "全局倍率（乘在自动倍率之后）" }), { target: { value: "1.25" } });

    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("最终恢复倍率")).toBeTruthy();
    expect(screen.getByText("2 × 1.25 = 2.5 倍")).toBeTruthy();
  });

  it("page scale 冲突时要求用户确认手动倍率后才允许导出", async () => {
    const conflict: ScaleInference = {
      ...inferredScale,
      restoreMultiplier: 1,
      exportPercent: 100,
      confidence: "low",
      requiresConfirmation: true,
      pageEvidence: [
        { pageName: "half.png", atlasScale: 0.5, restoreMultiplier: 2 },
        { pageName: "full.png", atlasScale: 1, restoreMultiplier: 1 },
      ],
      warnings: ["Atlas 多页 scale 冲突，请手动确认恢复倍率。"],
    };
    mocks.exportAllRegions.mockResolvedValueOnce({
      blob: new Blob(["zip"]),
      report: {
        version: 1,
        inferredScale: conflict,
        summary: { successful: 0, skipped: 0, failed: 0, total: 0 },
        regions: [],
      },
      issues: [],
    } satisfies ExportAllResult);
    render(<ExportPanel resources={resources(atlas)} inferredScale={conflict} sourceVersion="4.2" />);

    const button = screen.getByRole("button", { name: "确认倍率后导出全部 ZIP" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "全局倍率（乘在自动倍率之后）" }), { target: { value: "2" } });
    const confirmation = screen.getByRole("checkbox", { name: "我已核对冲突页面并确认使用上述手动倍率" });
    await userEvent.setup().click(confirmation);
    expect(button).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByRole("textbox", { name: "全局倍率（乘在自动倍率之后）" }), { target: { value: "3" } });
    expect(confirmation).toHaveProperty("checked", false);
    expect(button).toHaveProperty("disabled", true);
    await userEvent.setup().click(confirmation);

    await userEvent.setup().click(button);
    expect(mocks.exportAllRegions).toHaveBeenCalledWith(
      expect.objectContaining({ globalMultiplier: 3 }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("切换到新 Atlas 时清除搜索和倍率编辑状态", async () => {
    const view = render(<ExportPanel resources={resources(atlas)} inferredScale={inferredScale} sourceVersion="4.2" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Region" }), { target: { value: "very-long" } });
    fireEvent.change(screen.getByRole("textbox", { name: "全局倍率（乘在自动倍率之后）" }), { target: { value: "3" } });

    view.rerender(<ExportPanel resources={resources({ ...atlas, regions: [...atlas.regions] })} inferredScale={inferredScale} sourceVersion="4.2" />);

    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索 Region" })).toHaveProperty("value", ""));
    expect(screen.getByRole("textbox", { name: "全局倍率（乘在自动倍率之后）" })).toHaveProperty("value", "1");
    expect(screen.getByText("body/head")).toBeTruthy();
  });

  it("按结构化结果上报 Region warning，并准确显示成功、跳过和失败数", async () => {
    const issue = {
      code: "REGION_OUT_OF_BOUNDS",
      severity: "warning" as const,
      subject: "Region「broken」",
      details: ["裁切范围超出纹理页"],
    };
    mocks.exportAllRegions.mockResolvedValueOnce({
      blob: new Blob(["zip"]),
      report: {
        version: 1,
        inferredScale,
        summary: { successful: 1, skipped: 1, failed: 1, total: 3 },
        regions: [],
      },
      issues: [issue],
    } satisfies ExportAllResult);
    const onIssue = vi.fn();
    render(<ExportPanel
      resources={resources(atlas)}
      inferredScale={inferredScale}
      sourceVersion="4.2"
      onIssue={onIssue}
    />);

    await userEvent.setup().click(screen.getByRole("button", { name: "导出全部 ZIP" }));

    await screen.findByText("导出完成：成功 1 项，跳过 1 项，失败 1 项。ZIP 已包含详细报告。");
    expect(onIssue).toHaveBeenCalledWith(issue);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("压缩阶段显示中文状态，取消会 abort 并及时释放纹理租约", async () => {
    const release = vi.fn();
    let rejectExport!: (error: Error) => void;
    let signal!: AbortSignal;
    const controlledResources: ExportResources = {
      atlas,
      textures: new Map([["page.png", {} as ImageBitmap]]),
      acquire: () => ({ atlas, textures: new Map([["page.png", {} as ImageBitmap]]), release }),
      release: vi.fn(),
    };
    mocks.exportAllRegions.mockImplementationOnce((_input, onProgress, options) => {
      signal = options.signal;
      onProgress(atlas.regions.length, atlas.regions.length, "compressing");
      return new Promise((_resolve, reject) => { rejectExport = reject; });
    });
    render(<ExportPanel resources={controlledResources} inferredScale={inferredScale} sourceVersion="4.2" />);

    await userEvent.setup().click(screen.getByRole("button", { name: "导出全部 ZIP" }));
    expect(screen.getByRole("status").textContent).toContain("正在压缩 ZIP");
    await userEvent.setup().click(screen.getByRole("button", { name: "取消导出" }));
    expect(signal.aborted).toBe(true);
    rejectExport(Object.assign(new Error("导出已取消"), { name: "AbortError" }));

    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(screen.getByText("导出已取消。")).toBeTruthy();
  });

  it("恢复阶段取消后保持导出锁，直到旧任务 finally 释放租约", async () => {
    const release = vi.fn();
    let rejectExport!: (error: Error) => void;
    const controlledResources: ExportResources = {
      atlas,
      textures: new Map([["page.png", {} as ImageBitmap]]),
      acquire: () => ({ atlas, textures: new Map([["page.png", {} as ImageBitmap]]), release }),
      release: vi.fn(),
    };
    mocks.exportAllRegions.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectExport = reject;
    }));
    render(<ExportPanel resources={controlledResources} inferredScale={inferredScale} sourceVersion="4.2" />);

    await userEvent.setup().click(screen.getByRole("button", { name: "导出全部 ZIP" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "取消导出" }));

    expect(screen.getByRole("button", { name: "正在导出 ZIP" })).toHaveProperty("disabled", true);
    expect(mocks.exportAllRegions).toHaveBeenCalledTimes(1);
    rejectExport(Object.assign(new Error("导出已取消"), { name: "AbortError" }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "导出全部 ZIP" })).toHaveProperty("disabled", false);
  });

  it.each([
    ["sourceVersion", { sourceVersion: "4.3" as const }],
    ["legacyAlphaMode", { legacyAlphaMode: "premultiplied" as const }],
    ["inferredScale", { inferredScale: { ...inferredScale, restoreMultiplier: 3 } }],
  ])("导出中 %s 改变会 abort 旧配置且绝不下载旧结果", async (_name, changed) => {
    const stableResources = resources(atlas);
    let resolveExport!: (result: ExportAllResult) => void;
    let signal!: AbortSignal;
    mocks.exportAllRegions.mockImplementationOnce((_input, _progress, options) => {
      signal = options.signal;
      return new Promise((resolve) => { resolveExport = resolve; });
    });
    const baseline = {
      resources: stableResources,
      inferredScale,
      sourceVersion: "3.8" as const,
      legacyAlphaMode: "straight" as const,
    };
    const view = render(<ExportPanel {...baseline} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "导出全部 ZIP" }));

    view.rerender(<ExportPanel {...baseline} {...changed} />);
    await waitFor(() => expect(signal.aborted).toBe(true));
    resolveExport({
      blob: new Blob(["stale zip"]),
      report: {
        version: 1,
        inferredScale,
        summary: { successful: 1, skipped: 0, failed: 0, total: 1 },
        regions: [],
      },
      issues: [],
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /导出全部 ZIP/ })).toHaveProperty("disabled", false));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("纹理租约获取同步失败时受控上报并恢复可重试状态", async () => {
    const onIssue = vi.fn();
    const brokenResources: ExportResources = {
      atlas,
      textures: new Map([["page.png", {} as ImageBitmap]]),
      acquire: () => { throw new Error("lease unavailable"); },
      release: vi.fn(),
    };
    render(<ExportPanel
      resources={brokenResources}
      inferredScale={inferredScale}
      sourceVersion="4.2"
      onIssue={onIssue}
    />);

    await userEvent.setup().click(screen.getByRole("button", { name: "导出全部 ZIP" }));

    expect(await screen.findByText("导出失败：lease unavailable")).toBeTruthy();
    expect(onIssue).toHaveBeenCalledWith(expect.objectContaining({
      code: "ZIP_FAILED",
      details: ["lease unavailable"],
    }));
    expect(screen.getByRole("button", { name: "导出全部 ZIP" })).toHaveProperty("disabled", false);
    expect(mocks.exportAllRegions).not.toHaveBeenCalled();
  });
});
