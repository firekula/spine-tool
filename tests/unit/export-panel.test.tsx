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
  return render(<ExportPanel resources={resources(atlas)} inferredScale={inferredScale} />);
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
    render(<ExportPanel resources={resources(atlas)} inferredScale={conflict} />);

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
    const view = render(<ExportPanel resources={resources(atlas)} inferredScale={inferredScale} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Region" }), { target: { value: "very-long" } });
    fireEvent.change(screen.getByRole("textbox", { name: "全局倍率（乘在自动倍率之后）" }), { target: { value: "3" } });

    view.rerender(<ExportPanel resources={resources({ ...atlas, regions: [...atlas.regions] })} inferredScale={inferredScale} />);

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
      onIssue={onIssue}
    />);

    await userEvent.setup().click(screen.getByRole("button", { name: "导出全部 ZIP" }));

    await screen.findByText("导出完成：成功 1 项，跳过 1 项，失败 1 项。ZIP 已包含详细报告。");
    expect(onIssue).toHaveBeenCalledWith(issue);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});
