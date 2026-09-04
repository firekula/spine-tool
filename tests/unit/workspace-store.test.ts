import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceState,
  workspaceReducer,
} from "@/lib/state/workspace-store";
import type { AppIssue } from "@/lib/issues/types";

describe("workspaceReducer", () => {
  it("重新导入会清除旧预览状态但保留播放速度", () => {
    const issue: AppIssue = { code: "PREVIEW_LOAD_FAILED", severity: "warning" };
    const before = {
      ...createInitialWorkspaceState(),
      speed: 1.5,
      selectedAnimation: "walk",
      hiddenSlots: new Set(["weapon"]),
      warnings: [issue],
    };

    const after = workspaceReducer(before, { type: "IMPORT_STARTED" });

    expect(after.speed).toBe(1.5);
    expect(after.selectedAnimation).toBeNull();
    expect(after.phase).toBe("loading");
    expect(after.hiddenSlots).toEqual(new Set());
    expect(after.warnings).toEqual([]);
  });

  it("可继续警告不会阻断已经就绪的工作区", () => {
    const before = { ...createInitialWorkspaceState(), phase: "ready" as const };
    const issue: AppIssue = { code: "UNUSED_TEXTURES", severity: "warning" };

    const after = workspaceReducer(before, { type: "REPORT_ISSUE", issue });

    expect(after.phase).toBe("ready");
    expect(after.warnings).toEqual([issue]);
  });

  it("记录素材原始版本、实际 Runtime、选择来源和兼容性并在重导入时清空", () => {
    const identified = workspaceReducer(createInitialWorkspaceState(), {
      type: "IMPORT_VERSION_IDENTIFIED",
      rawVersion: "3.8.75",
      runtimeVersion: "3.8",
      selectionSource: "automatic",
      compatibility: "spine-3.8.75",
    });

    expect(identified).toMatchObject({
      rawVersion: "3.8.75",
      runtimeVersion: "3.8",
      selectionSource: "automatic",
      compatibility: "spine-3.8.75",
    });
    expect(workspaceReducer(identified, { type: "IMPORT_STARTED" })).toMatchObject({
      rawVersion: null,
      runtimeVersion: null,
      selectionSource: null,
      compatibility: null,
    });
  });
});
