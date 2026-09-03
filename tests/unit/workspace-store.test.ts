import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceState,
  workspaceReducer,
} from "@/lib/state/workspace-store";

describe("workspaceReducer", () => {
  it("重新导入会清除旧预览状态但保留播放速度", () => {
    const before = {
      ...createInitialWorkspaceState(),
      speed: 1.5,
      selectedAnimation: "walk",
    };

    const after = workspaceReducer(before, { type: "IMPORT_STARTED" });

    expect(after.speed).toBe(1.5);
    expect(after.selectedAnimation).toBeNull();
    expect(after.phase).toBe("loading");
  });
});
