import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExportPanel } from "@/components/export-panel";
import type { AtlasDocument } from "@/lib/atlas/types";
import type { ScaleInference } from "@/lib/spine/scale-inference";

const atlas: AtlasDocument = {
  pages: [{ name: "page.png", width: 64, height: 64, custom: {} }],
  regions: [{
    name: "body/head", pageName: "page.png", index: 0,
    x: 0, y: 0, packedWidth: 16, packedHeight: 16,
    originalWidth: 16, originalHeight: 16, offsetLeft: 0, offsetBottom: 0,
    rotation: 0, custom: {},
  }],
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
  return render(<ExportPanel atlas={atlas} textures={new Map([["page.png", {} as ImageBitmap]])} inferredScale={inferredScale} />);
}

afterEach(() => cleanup());

describe("ExportPanel", () => {
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
});
