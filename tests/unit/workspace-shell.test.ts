import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceShell } from "@/components/workspace-shell";

describe("WorkspaceShell", () => {
  it("显示 Spine Runtime 许可提醒", () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceShell));

    expect(markup).toContain("Spine Runtime 使用受 Esoteric Software 许可条款约束");
  });
});
