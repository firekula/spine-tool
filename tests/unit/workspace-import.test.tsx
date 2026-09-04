import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportValidationError, type ImportBundle } from "@/lib/files/import-files";
import type { PreparedImport, RuntimeSession } from "@/lib/files/import-workflow";
import type { SkeletonMetadata, SpineRuntimeBridge } from "@/lib/spine/bridge-types";
import type { SupportedSpineVersion } from "@/lib/spine/runtime-registry";

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

function fakeBridge(version: SupportedSpineVersion = "4.2"): SpineRuntimeBridge {
  return {
    version,
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
      detected: { raw: "4.2.0", majorMinor: "4.2", source: "json-field", supported: true, compatibility: "stable" },
      exportResources: {
        atlas: { pages: [{ name: "page.png", width: 1, height: 1, custom: {} }], regions: [] },
        textures: new Map([["page.png", {} as ImageBitmap]]),
        acquire: vi.fn(),
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
    const versionInfo = screen.getByRole("group", { name: "Spine 版本信息" });
    expect(versionInfo.textContent).toContain("素材版本 4.2.0");
    expect(versionInfo.textContent).toContain("Runtime 4.2（自动）");
    expect(screen.getByRole("button", { name: "idle" })).toHaveProperty("disabled", false);

    await userEvent.setup().click(screen.getByRole("button", { name: "重新导入" }));
    expect(sessionRelease).toHaveBeenCalledTimes(1);
    expect(exportRelease).toHaveBeenCalledTimes(1);
  });

  it("手动 Runtime 选择器按注册表顺序提供八条版本线并显示手动来源", async () => {
    const bundle = importBundle();
    mocks.classifyImport.mockResolvedValue(bundle);
    mocks.prepareImport.mockResolvedValue({
      bundle,
      detected: { raw: "4.4.0", majorMinor: null, source: "json-field", supported: false, compatibility: null },
      exportResources: {
        atlas: { pages: [], regions: [] },
        textures: new Map(),
        acquire: vi.fn(),
        release: vi.fn(),
      },
    } satisfies PreparedImport);
    mocks.createRuntimeSession.mockRejectedValue(new Error("synthetic manual runtime failure"));
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });

    const picker = await screen.findByRole("combobox", { name: "Runtime 版本" });
    expect(Array.from((picker as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      "3.5", "3.6", "3.7", "3.8", "4.0", "4.1", "4.2", "4.3",
    ]);
    await userEvent.setup().selectOptions(picker, "4.3");
    await userEvent.setup().click(screen.getByRole("button", { name: "使用所选 Runtime 加载预览" }));

    const versionInfo = screen.getByRole("group", { name: "Spine 版本信息" });
    expect(versionInfo.textContent).toContain("素材版本 4.4.0");
    expect(versionInfo.textContent).toContain("Runtime 4.3（手动）");
  });

  it("Spine 3.5 先取得 Alpha 确认再把 PMA 选择传入 Runtime session", async () => {
    const bundle = importBundle();
    bundle.atlasFile = new File(["atlas"], "spineboy-pma.atlas");
    bundle.textureFiles = new Map([["spineboy-pma.png", new File(["png"], "spineboy-pma.png")]]);
    const bridge = fakeBridge();
    mocks.classifyImport.mockResolvedValue(bundle);
    mocks.prepareImport.mockResolvedValue({
      bundle,
      detected: { raw: "3.5.03-beta", majorMinor: "3.5", source: "json-field", supported: true, compatibility: "prerelease" },
      exportResources: {
        atlas: { pages: [], regions: [] },
        textures: new Map(),
        acquire: vi.fn(),
        release: vi.fn(),
      },
    } satisfies PreparedImport);
    mocks.createRuntimeSession.mockResolvedValue({
      bridge,
      input: {
        atlasText: "atlas",
        skeleton: { kind: "json", text: "{}" },
        textureObjectUrls: new Map(),
        alphaMode: "premultiplied",
      },
      release: vi.fn(),
    } satisfies RuntimeSession);
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });

    await screen.findByRole("heading", { name: "Spine 3.x 纹理 Alpha 模式" });
    expect(mocks.createRuntimeSession).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "预乘 Alpha（PMA）" })).toHaveProperty("checked", true);
    await userEvent.setup().click(screen.getByRole("button", { name: "确认 Alpha 模式并加载预览" }));
    await waitFor(() => expect(mocks.createRuntimeSession).toHaveBeenCalledWith(
      bundle,
      "3.5",
      { alphaMode: "premultiplied" },
    ));
  });

  it("Spine 3.8.75 显示尽力兼容警告，仍进入 Alpha 确认并自动加载 3.8 Runtime", async () => {
    const bundle = importBundle();
    const bridge = fakeBridge();
    mocks.classifyImport.mockResolvedValue(bundle);
    mocks.prepareImport.mockResolvedValue({
      bundle,
      detected: {
        raw: "3.8.75",
        majorMinor: "3.8",
        source: "json-field",
        supported: true,
        compatibility: "spine-3.8.75",
      },
      exportResources: {
        atlas: { pages: [], regions: [] },
        textures: new Map(),
        acquire: vi.fn(),
        release: vi.fn(),
      },
    } satisfies PreparedImport);
    mocks.createRuntimeSession.mockResolvedValue({
      bridge,
      input: {
        atlasText: "atlas",
        skeleton: { kind: "json", text: "{}" },
        textureObjectUrls: new Map(),
        alphaMode: "straight",
      },
      release: vi.fn(),
    } satisfies RuntimeSession);
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });

    await screen.findByText("Spine 3.8.75 尽力兼容");
    const versionInfo = screen.getByRole("group", { name: "Spine 版本信息" });
    expect(versionInfo.textContent).toContain("素材版本 3.8.75");
    expect(versionInfo.textContent).toContain("Runtime 3.8（自动）");
    expect(screen.getByText("SPINE_3_8_75_COMPATIBILITY")).toBeTruthy();
    expect(screen.queryByText("SPINE_PRERELEASE_COMPATIBILITY")).toBeNull();
    expect(screen.getByRole("heading", { name: "Spine 3.x 纹理 Alpha 模式" })).toBeTruthy();
    expect(screen.queryByText("手动选择 Runtime")).toBeNull();
    expect(mocks.createRuntimeSession).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "确认 Alpha 模式并加载预览" }));
    await waitFor(() => expect(mocks.createRuntimeSession).toHaveBeenCalledWith(
      bundle,
      "3.8",
      { alphaMode: "straight" },
    ));
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());
    expect(screen.getByText("Spine 3.8.75 尽力兼容")).toBeTruthy();
  });

  it("Spine 4.3 Beta 显示非阻断兼容警告并继续自动加载 4.3 Runtime", async () => {
    const bundle = importBundle();
    const bridge = fakeBridge("4.3");
    mocks.classifyImport.mockResolvedValue(bundle);
    mocks.prepareImport.mockResolvedValue({
      bundle,
      detected: {
        raw: "4.3.75-beta",
        majorMinor: "4.3",
        source: "json-field",
        supported: true,
        compatibility: "prerelease",
      },
      exportResources: {
        atlas: { pages: [], regions: [] },
        textures: new Map(),
        acquire: vi.fn(),
        release: vi.fn(),
      },
    } satisfies PreparedImport);
    mocks.createRuntimeSession.mockResolvedValue({
      bridge,
      input: {
        atlasText: "atlas",
        skeleton: { kind: "json", text: "{}" },
        textureObjectUrls: new Map(),
      },
      release: vi.fn(),
    } satisfies RuntimeSession);
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });

    await screen.findByText("Spine 预发布版本兼容风险");
    expect(screen.getByText("SPINE_PRERELEASE_COMPATIBILITY")).toBeTruthy();
    expect(screen.getByText(/可尝试加载，但不保证兼容/)).toBeTruthy();
    expect(screen.queryByText("手动选择 Runtime")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Spine 3.x 纹理 Alpha 模式" })).toBeNull();
    await waitFor(() => expect(mocks.createRuntimeSession).toHaveBeenCalledWith(bundle, "4.3"));
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());
    expect(screen.getByText("Spine 4.3 · 预览已就绪")).toBeTruthy();
  });

  it("Spine 3.8.75 Runtime 失败后保留已准备的 Atlas 导出资源", async () => {
    const bundle = importBundle();
    const exportRelease = vi.fn();
    const retryBridge = fakeBridge("4.3");
    mocks.classifyImport.mockResolvedValue(bundle);
    mocks.prepareImport.mockResolvedValue({
      bundle,
      detected: {
        raw: "3.8.75",
        majorMinor: "3.8",
        source: "json-field",
        supported: true,
        compatibility: "spine-3.8.75",
      },
      exportResources: {
        atlas: {
          pages: [{ name: "page.png", width: 1, height: 1, custom: {} }],
          regions: [],
        },
        textures: new Map([["page.png", {} as ImageBitmap]]),
        acquire: vi.fn(),
        release: exportRelease,
      },
    } satisfies PreparedImport);
    mocks.createRuntimeSession
      .mockRejectedValueOnce(new Error("synthetic 3.8.75 parse failure"))
      .mockResolvedValueOnce({
        bridge: retryBridge,
        input: {
          atlasText: "atlas",
          skeleton: { kind: "json", text: "{}" },
          textureObjectUrls: new Map(),
        },
        release: vi.fn(),
      } satisfies RuntimeSession);
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });

    await screen.findByRole("heading", { name: "Spine 3.x 纹理 Alpha 模式" });
    await userEvent.setup().click(screen.getByRole("button", { name: "确认 Alpha 模式并加载预览" }));

    await screen.findByText("预览不可用 · Atlas 仍可导出");
    expect(screen.getByText("Spine 3.8.75 尽力兼容")).toBeTruthy();
    expect(screen.getByText("Atlas 已就绪，预览尚未可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: /导出全部 ZIP/ })).toHaveProperty("disabled", false);
    expect(exportRelease).not.toHaveBeenCalled();

    const picker = screen.getByRole("combobox", { name: "Runtime 版本" });
    expect(Array.from((picker as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      "3.5", "3.6", "3.7", "3.8", "4.0", "4.1", "4.2", "4.3",
    ]);
    const automaticInfo = screen.getByRole("group", { name: "Spine 版本信息" });
    expect(automaticInfo.textContent).toContain("素材版本 3.8.75");
    expect(automaticInfo.textContent).toContain("Runtime 3.8（自动）");

    await userEvent.setup().selectOptions(picker, "4.3");
    await userEvent.setup().click(screen.getByRole("button", { name: "使用所选 Runtime 加载预览" }));

    await waitFor(() => expect(mocks.createRuntimeSession).toHaveBeenNthCalledWith(2, bundle, "4.3"));
    expect(screen.getByRole("group", { name: "Spine 版本信息" }).textContent).toContain("Runtime 4.3（手动）");
    expect(screen.getByText("synthetic 3.8.75 parse failure")).toBeTruthy();
    await waitFor(() => expect(retryBridge.load).toHaveBeenCalledTimes(1));
    await screen.findByText("Spine 4.3 · 预览已就绪");
  });

  it("Spine 3.5 SKEL 能力失败后释放 Runtime session 并保留 Atlas 导出资源", async () => {
    const bundle = importBundle();
    bundle.skeletonFile = new File([new Uint8Array([1, 2, 3])], "hero.skel");
    bundle.skeletonKind = "skel";
    const sessionRelease = vi.fn();
    const bridge = fakeBridge("3.5");
    vi.mocked(bridge.load).mockRejectedValue(Object.assign(
      new Error("Spine 3.5 官方 Runtime 不支持 SKEL（二进制）骨骼"),
      {
        code: "RUNTIME_CAPABILITY_UNSUPPORTED",
        details: ["请改用同版本 JSON 导出。工具不会交给其他版本 Runtime 读取。"],
      },
    ));
    mocks.classifyImport.mockResolvedValue(bundle);
    mocks.prepareImport.mockResolvedValue({
      bundle,
      detected: { raw: "3.5.51", majorMinor: "3.5", source: "skel-header", supported: true, compatibility: "stable" },
      exportResources: {
        atlas: {
          pages: [{ name: "page.png", width: 1, height: 1, custom: {} }],
          regions: [{
            name: "square", pageName: "page.png", rotation: 0, x: 0, y: 0,
            packedWidth: 1, packedHeight: 1, originalWidth: 1, originalHeight: 1,
            offsetLeft: 0, offsetBottom: 0, index: -1, custom: {},
          }],
        },
        textures: new Map([["page.png", {} as ImageBitmap]]),
        acquire: vi.fn(),
        release: vi.fn(),
      },
    } satisfies PreparedImport);
    mocks.createRuntimeSession.mockResolvedValue({
      bridge,
      input: {
        atlasText: "atlas",
        skeleton: { kind: "skel", bytes: new Uint8Array([1, 2, 3]) },
        textureObjectUrls: new Map([["page.png", "blob:page"]]),
        alphaMode: "straight",
      },
      release: sessionRelease,
    } satisfies RuntimeSession);
    render(<WorkspaceShell />);

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["selection"], "selection.atlas")] },
    });
    await screen.findByRole("heading", { name: "Spine 3.x 纹理 Alpha 模式" });
    await userEvent.setup().click(screen.getByRole("button", { name: "确认 Alpha 模式并加载预览" }));

    await screen.findByText("当前 Runtime 不支持 SKEL");
    expect(sessionRelease).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: "Runtime 版本" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Region（1）" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /导出全部 ZIP/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("group", { name: "Spine 版本信息" }).textContent).toContain("Runtime 3.5（自动）");
  });

  it("Atlas 回退状态下再次选择无效文件也会释放上一批导入资源", async () => {
    const bundle = importBundle();
    const exportRelease = vi.fn();
    mocks.classifyImport.mockResolvedValueOnce(bundle);
    mocks.prepareImport.mockResolvedValueOnce({
      bundle,
      detected: { raw: "3.4.0", majorMinor: null, source: "json-field", supported: false, compatibility: null },
      exportResources: {
        atlas: { pages: [{ name: "page.png", width: 1, height: 1, custom: {} }], regions: [] },
        textures: new Map([['page.png', {} as ImageBitmap]]),
        acquire: vi.fn(),
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
      detected: { raw: "4.2.0", majorMinor: "4.2", source: "json-field", supported: true, compatibility: "stable" },
      exportResources: {
        atlas: { pages: [], regions: [] },
        textures: new Map(),
        acquire: vi.fn(),
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
      detected: { raw: "4.2.0", majorMinor: "4.2", source: "json-field", supported: true, compatibility: "stable" },
      exportResources: {
        atlas: { pages: [], regions: [] },
        textures: new Map(),
        acquire: vi.fn(),
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
