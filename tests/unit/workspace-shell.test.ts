import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceShell } from "@/components/workspace-shell";

describe("WorkspaceShell", () => {
  it("显示 Spine Runtime 许可提醒", () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceShell));

    expect(markup).toContain("Spine Runtime 使用受 Esoteric Software 许可条款约束");
  });

  it("提供可访问的实际本地文件导入入口", () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceShell));

    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept=".atlas,.json,.skel,.png,image/png"');
    expect(markup).toContain("拖放 Atlas、JSON/SKEL 和 PNG，或选择文件。");
    expect(markup).toContain('for="spine-import-files"');
  });
});
