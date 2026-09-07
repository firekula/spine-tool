import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportBundle } from "@/lib/files/import-files";
import type { PreparedImport } from "@/lib/files/import-workflow";
import type { SpineRuntimeBridge } from "@/lib/spine/bridge-types";

const mocks = vi.hoisted(() => ({
  classifyImport: vi.fn(),
  prepareImport: vi.fn(),
  createRuntimeSession: vi.fn(),
  exportPanelProps: vi.fn(),
}));

vi.mock("@/lib/files/import-files", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/files/import-files")>(),
  classifyImport: mocks.classifyImport,
}));

vi.mock("@/lib/files/import-workflow", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/files/import-workflow")>(),
  prepareImport: mocks.prepareImport,
  createRuntimeSession: mocks.createRuntimeSession,
}));

vi.mock("@/components/export-panel", () => ({
  ExportPanel: (props: unknown) => {
    mocks.exportPanelProps(props);
    return <div data-testid="captured-export-panel" />;
  },
}));

import { WorkspaceShell } from "@/components/workspace-shell";

function bundle(): ImportBundle {
  return {
    atlasFile: new File(["atlas"], "hero.atlas"),
    atlasText: "atlas",
    skeletonFile: new File(["{}"], "hero.json"),
    skeletonKind: "json",
    textureFiles: new Map([["page.png", new File(["png"], "page.png")]]),
    unusedTextures: [],
  };
}

function latestExportProps(): Record<string, unknown> {
  return mocks.exportPanelProps.mock.calls.at(-1)![0] as Record<string, unknown>;
}

describe("WorkspaceShell export Alpha source", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("以素材版本决定导出 Alpha，并在选择变化后要求重新确认", async () => {
    const imported = bundle();
    const retryBridge = {
      version: "4.3",
      load: vi.fn(async () => ({ animations: [], skins: [], slots: [], regionAttachments: [] })),
      play: vi.fn(), setLoop: vi.fn(), pause: vi.fn(), seek: vi.fn(), setSpeed: vi.fn(),
      setSkins: vi.fn(), setHiddenSlots: vi.fn(), getBounds: vi.fn(() => null), setView: vi.fn(),
      resize: vi.fn(), frame: vi.fn(() => ({ animation: null, duration: 0, playing: false, time: 0 })),
      dispose: vi.fn(),
    } satisfies SpineRuntimeBridge;
    mocks.classifyImport.mockResolvedValue(imported);
    mocks.prepareImport.mockResolvedValue({
      bundle: imported,
      detected: {
        raw: "3.8.75", majorMinor: "3.8", source: "json-field",
        supported: true, compatibility: "spine-3.8.75",
      },
      exportResources: {
        atlas: { pages: [{ name: "page.png", width: 1, height: 1, custom: {} }], regions: [] },
        textures: new Map([["page.png", {} as ImageBitmap]]),
        acquire: vi.fn(),
        release: vi.fn(),
      },
    } satisfies PreparedImport);
    mocks.createRuntimeSession
      .mockRejectedValueOnce(new Error("3.8 parse failure"))
      .mockResolvedValueOnce({
        bridge: retryBridge,
        input: {
          atlasText: "atlas",
          skeleton: { kind: "json", text: "{}" },
          textureObjectUrls: new Map(),
        },
        release: vi.fn(),
      });
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });
    await screen.findByRole("heading", { name: "Spine 3.x 纹理 Alpha 模式" });
    await userEvent.setup().click(screen.getByRole("button", { name: "确认 Alpha 模式并加载预览" }));
    await screen.findByText("预览不可用 · Atlas 仍可导出");
    expect(latestExportProps()).toMatchObject({ sourceVersion: "3.8", legacyAlphaMode: "straight" });

    await userEvent.setup().click(screen.getByRole("radio", { name: "预乘 Alpha（PMA）" }));
    await waitFor(() => expect(latestExportProps()).toMatchObject({
      sourceVersion: "3.8",
      legacyAlphaMode: null,
    }));

    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Runtime 版本" }), "4.3");
    expect(screen.getByRole("radio", { name: "预乘 Alpha（PMA）" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "使用所选 Runtime 加载预览" }));
    await waitFor(() => expect(mocks.createRuntimeSession).toHaveBeenNthCalledWith(2, imported, "4.3"));
    expect(latestExportProps()).toMatchObject({ sourceVersion: "3.8", legacyAlphaMode: "premultiplied" });
  });

  it("未知素材首次手选 3.x 时把同一次提交作为导出 Alpha 确认", async () => {
    const imported = bundle();
    mocks.classifyImport.mockResolvedValue(imported);
    mocks.prepareImport.mockResolvedValue({
      bundle: imported,
      detected: { raw: null, majorMinor: null, source: "unknown", supported: false, compatibility: null },
      exportResources: {
        atlas: { pages: [{ name: "page.png", width: 1, height: 1, custom: {} }], regions: [] },
        textures: new Map([["page.png", {} as ImageBitmap]]),
        acquire: vi.fn(),
        release: vi.fn(),
      },
    } satisfies PreparedImport);
    mocks.createRuntimeSession.mockRejectedValue(new Error("manual parse failure"));
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });
    const picker = await screen.findByRole("combobox", { name: "Runtime 版本" });
    await userEvent.setup().selectOptions(picker, "3.8");
    expect(screen.getByRole("radio", { name: "直通 Alpha（Straight）" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "使用所选 Runtime 加载预览" }));
    await screen.findByText("预览不可用 · Atlas 仍可导出");

    expect(latestExportProps()).toMatchObject({ sourceVersion: "3.8", legacyAlphaMode: "straight" });
  });
});
