import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportValidationError, type ImportBundle } from "@/lib/files/import-files";
import type { PreparedImport, RuntimeSession } from "@/lib/files/import-workflow";
import type { SkeletonMetadata, SpineRuntimeBridge } from "@/lib/spine/bridge-types";

const mocks = vi.hoisted(() => ({
  classifyImport: vi.fn(),
  prepareImport: vi.fn(),
  createRuntimeSession: vi.fn(),
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

import { WorkspaceShell } from "@/components/workspace-shell";

const metadata: SkeletonMetadata = {
  animations: [{ name: "idle", duration: 1 }],
  skins: ["default"],
  slots: ["body"],
  regionAttachments: [],
};

function fakeBridge(): SpineRuntimeBridge {
  return {
    version: "4.2",
    load: vi.fn(async () => metadata),
    play: vi.fn(),
    setLoop: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setSpeed: vi.fn(),
    setSkins: vi.fn(),
    setHiddenSlots: vi.fn(),
    getBounds: vi.fn(() => null),
    setView: vi.fn(),
    resize: vi.fn(),
    frame: vi.fn(() => ({ animation: "idle", duration: 1, playing: true, time: 0 })),
    dispose: vi.fn(),
  };
}

function importBundle(): ImportBundle {
  return {
    atlasFile: new File(["atlas"], "hero.atlas"),
    atlasText: "atlas",
    skeletonFile: new File(["{}"], "hero.json"),
    skeletonKind: "json",
    textureFiles: new Map([["page.png", new File(["png"], "page.png")]]),
    unusedTextures: [],
  };
}

describe("WorkspaceShell import integration", () => {
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

  it("ImportDropzone 成功后串起准备、Runtime load、metadata/store，并在重新导入时释放资源", async () => {
    const bundle = importBundle();
    const exportRelease = vi.fn();
    const sessionRelease = vi.fn();
    const bridge = fakeBridge();
    const prepared = {
      bundle,
      detected: { raw: "4.2.0", majorMinor: "4.2", source: "json-field", supported: true },
      exportResources: {
        atlas: { pages: [{ name: "page.png", width: 1, height: 1, custom: {} }], regions: [] },
        textures: new Map([["page.png", {} as ImageBitmap]]),
        release: exportRelease,
      },
    } satisfies PreparedImport;
    const session = {
      bridge,
      input: {
        atlasText: "atlas",
        skeleton: { kind: "json", text: "{}" },
        textureObjectUrls: new Map([["page.png", "blob:page"]]),
      },
      release: sessionRelease,
    } satisfies RuntimeSession;
    mocks.classifyImport.mockResolvedValue(bundle);
    mocks.prepareImport.mockResolvedValue(prepared);
    mocks.createRuntimeSession.mockResolvedValue(session);
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });

    await waitFor(() => expect(mocks.prepareImport).toHaveBeenCalledWith(bundle));
    expect(mocks.createRuntimeSession).toHaveBeenCalledWith(bundle, "4.2");
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());
    await screen.findByText("Spine 4.2 · 预览已就绪");
    expect(screen.getByRole("button", { name: "idle" })).toHaveProperty("disabled", false);

    await userEvent.setup().click(screen.getByRole("button", { name: "重新导入" }));
    expect(sessionRelease).toHaveBeenCalledTimes(1);
    expect(exportRelease).toHaveBeenCalledTimes(1);
  });

  it("Atlas 回退状态下再次选择无效文件也会释放上一批导入资源", async () => {
    const bundle = importBundle();
    const exportRelease = vi.fn();
    mocks.classifyImport.mockResolvedValueOnce(bundle);
    mocks.prepareImport.mockResolvedValueOnce({
      bundle,
      detected: { raw: "4.3.0", majorMinor: null, source: "json-field", supported: false },
      exportResources: {
        atlas: { pages: [{ name: "page.png", width: 1, height: 1, custom: {} }], regions: [] },
        textures: new Map([['page.png', {} as ImageBitmap]]),
        release: exportRelease,
      },
    } satisfies PreparedImport);
    render(<WorkspaceShell />);
    const input = document.querySelector('input[type="file"]')!;

    fireEvent.change(input, { target: { files: [new File(["first"], "first.atlas")] } });
    await screen.findByText("手动选择 Runtime");

    mocks.classifyImport.mockRejectedValueOnce(new ImportValidationError("MISSING_ATLAS", []));
    fireEvent.change(input, { target: { files: [new File(["bad"], "bad.txt")] } });

    expect((await screen.findAllByText(/缺少 Atlas 文件/)).length).toBeGreaterThan(0);
    expect(exportRelease).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("手动选择 Runtime")).toBeNull();
  });

  it("组件卸载后释放迟到的准备结果，不保留 ImageBitmap", async () => {
    const bundle = importBundle();
    const exportRelease = vi.fn();
    let resolvePrepared!: (prepared: PreparedImport) => void;
    mocks.classifyImport.mockResolvedValueOnce(bundle);
    mocks.prepareImport.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePrepared = resolve;
    }));
    const view = render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });
    await waitFor(() => expect(mocks.prepareImport).toHaveBeenCalledTimes(1));
    view.unmount();
    resolvePrepared({
      bundle,
      detected: { raw: "4.2.0", majorMinor: "4.2", source: "json-field", supported: true },
      exportResources: {
        atlas: { pages: [], regions: [] },
        textures: new Map(),
        release: exportRelease,
      },
    });

    await waitFor(() => expect(exportRelease).toHaveBeenCalledTimes(1));
    expect(mocks.createRuntimeSession).not.toHaveBeenCalled();
  });

  it("组件卸载后释放迟到的 Runtime session、object URL 和 bridge", async () => {
    const bundle = importBundle();
    const exportRelease = vi.fn();
    const sessionRelease = vi.fn();
    const bridge = fakeBridge();
    let resolveSession!: (session: RuntimeSession) => void;
    mocks.classifyImport.mockResolvedValueOnce(bundle);
    mocks.prepareImport.mockResolvedValueOnce({
      bundle,
      detected: { raw: "4.2.0", majorMinor: "4.2", source: "json-field", supported: true },
      exportResources: {
        atlas: { pages: [], regions: [] },
        textures: new Map(),
        release: exportRelease,
      },
    });
    mocks.createRuntimeSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSession = resolve;
    }));
    const view = render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });
    await waitFor(() => expect(mocks.createRuntimeSession).toHaveBeenCalledTimes(1));
    view.unmount();
    resolveSession({
      bridge,
      input: {
        atlasText: "atlas",
        skeleton: { kind: "json", text: "{}" },
        textureObjectUrls: new Map([["page.png", "blob:page"]]),
      },
      release: sessionRelease,
    });

    await waitFor(() => expect(sessionRelease).toHaveBeenCalledTimes(1));
    expect(exportRelease).toHaveBeenCalledTimes(1);
  });
});
