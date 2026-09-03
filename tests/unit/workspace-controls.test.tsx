import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewCanvas } from "@/components/preview-canvas";
import { WorkspaceShell } from "@/components/workspace-shell";
import type {
  PlaybackSnapshot,
  SkeletonMetadata,
  SpineRuntimeBridge,
} from "@/lib/spine/bridge-types";

const metadata: SkeletonMetadata = {
  animations: [
    { name: "idle", duration: 2 },
    { name: "walk", duration: 4 },
    { name: "attack", duration: 1.25 },
  ],
  skins: ["default", "armor", "winter"],
  slots: ["eyes", "weapon", "cape"],
  regionAttachments: [
    { skin: "default", slot: "eyes", name: "eyes", width: 80, height: 24 },
    { skin: "default", slot: "cape", name: "cape", width: 240, height: 360 },
  ],
};

function fakeBridge(snapshot: Partial<PlaybackSnapshot> = {}): SpineRuntimeBridge {
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
    getBounds: vi.fn(() => ({ x: -50, y: -100, width: 200, height: 400 })),
    setView: vi.fn(),
    resize: vi.fn(),
    frame: vi.fn(() => ({
      animation: "idle",
      duration: 2,
      playing: true,
      time: 0.5,
      ...snapshot,
    })),
    dispose: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("workspace controls", () => {
  it("窄屏抽屉打开后移动焦点，关闭后归还给触发按钮", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const user = userEvent.setup();
    render(<WorkspaceShell bridge={fakeBridge()} metadata={metadata} />);

    const trigger = screen.getByRole("button", { name: "控制面板" });
    await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭控制面板" }));

    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
    vi.unstubAllGlobals();
  });

  it("隐藏插槽在切换动画后仍然生效", async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();
    render(<WorkspaceShell bridge={bridge} metadata={metadata} />);

    await user.click(screen.getByRole("tab", { name: "插槽" }));
    await user.click(screen.getByRole("checkbox", { name: "weapon" }));
    await user.click(screen.getByRole("tab", { name: "动画" }));
    await user.click(screen.getByRole("button", { name: "walk" }));

    expect(bridge.play).toHaveBeenLastCalledWith("walk", true);
    expect(bridge.setHiddenSlots).toHaveBeenLastCalledWith(new Set(["weapon"]));
  });

  it("搜索动画并通过 store action 选择结果", async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();
    render(<WorkspaceShell bridge={bridge} metadata={metadata} />);

    await user.type(screen.getByRole("searchbox", { name: "搜索动画" }), "att");
    expect(screen.queryByRole("button", { name: "walk" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "attack" }));
    expect(bridge.play).toHaveBeenLastCalledWith("attack", true);
  });

  it("支持单一和组合皮肤", async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();
    render(<WorkspaceShell bridge={bridge} metadata={metadata} />);

    await user.click(screen.getByRole("tab", { name: "皮肤" }));
    await user.click(screen.getByRole("radio", { name: "armor" }));
    expect(bridge.setSkins).toHaveBeenLastCalledWith(["armor"]);

    await user.click(screen.getByRole("radio", { name: "组合皮肤" }));
    await user.click(screen.getByRole("checkbox", { name: "winter" }));
    expect(bridge.setSkins).toHaveBeenLastCalledWith(["armor", "winter"]);
  });

  it("支持插槽批量隐藏、显示和恢复默认", async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();
    render(<WorkspaceShell bridge={bridge} metadata={metadata} />);
    await user.click(screen.getByRole("tab", { name: "插槽" }));

    await user.click(screen.getByRole("button", { name: "全不选" }));
    expect(bridge.setHiddenSlots).toHaveBeenLastCalledWith(new Set(metadata.slots));
    await user.click(screen.getByRole("button", { name: "全选" }));
    expect(bridge.setHiddenSlots).toHaveBeenLastCalledWith(new Set());
    await user.click(screen.getByRole("checkbox", { name: "cape" }));
    await user.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(bridge.setHiddenSlots).toHaveBeenLastCalledWith(new Set());
  });

  it("同步播放、循环、速度和 seek，切换循环不重建或解除暂停", async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge({ duration: 4, time: 1 });
    render(<WorkspaceShell bridge={bridge} metadata={metadata} />);

    await user.click(screen.getByRole("button", { name: "暂停" }));
    expect(bridge.pause).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByRole("slider", { name: "动画进度" }), {
      target: { value: "1.5" },
    });
    expect(bridge.seek).toHaveBeenLastCalledWith(1.5);

    vi.mocked(bridge.play).mockClear();
    await user.click(screen.getByRole("checkbox", { name: "循环播放" }));
    expect(bridge.setLoop).toHaveBeenLastCalledWith(false);
    expect(bridge.play).not.toHaveBeenCalled();
    expect(bridge.pause).toHaveBeenLastCalledWith(true);
    expect(bridge.seek).toHaveBeenLastCalledWith(1.5);

    await user.click(screen.getByRole("button", { name: "播放" }));
    expect(bridge.pause).toHaveBeenLastCalledWith(false);
    await user.selectOptions(screen.getByRole("combobox", { name: "速度" }), "1.25");
    expect(bridge.setSpeed).toHaveBeenLastCalledWith(1.25);
  });

  it("帧渲染失败时降级为 Atlas 仍可导出的警告", () => {
    const bridge = fakeBridge();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.mocked(bridge.frame).mockImplementation(() => { throw new Error("WebGL context 已丢失"); });
    render(<WorkspaceShell bridge={bridge} metadata={metadata} />);

    act(() => callbacks.shift()?.(100));

    expect(screen.getAllByRole("status")[0]?.textContent).toContain("预览不可用 · Atlas 仍可导出");
    expect(screen.getByRole("region", { name: "问题中心" }).textContent).toContain("浏览器无法启动 WebGL");
    expect(callbacks).toHaveLength(0);
  });
});

describe("PreviewCanvas", () => {
  let frameCallbacks: FrameRequestCallback[];
  let resizeCallback: ResizeObserverCallback | undefined;

  beforeEach(() => {
    frameCallbacks = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("devicePixelRatio", 2);
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("只有一个 RAF 循环，按 DPR resize，并在卸载时释放", async () => {
    const bridge = fakeBridge();
    const { container, unmount } = render(
      <PreviewCanvas bridge={bridge} metadata={metadata} onSnapshot={vi.fn()} />,
    );
    const viewport = container.querySelector(".preview-viewport") as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    });

    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(bridge.resize).toHaveBeenLastCalledWith(640, 480, 2);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => frameCallbacks.shift()?.(100));
    expect(bridge.frame).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(bridge.dispose).toHaveBeenCalledTimes(1);
  });

  it("不会把 StrictMode 的 effect 探测当作真实卸载", async () => {
    const bridge = fakeBridge();
    const { unmount } = render(
      <StrictMode>
        <PreviewCanvas bridge={bridge} metadata={metadata} onSnapshot={vi.fn()} />
      </StrictMode>,
    );
    await Promise.resolve();
    expect(bridge.dispose).not.toHaveBeenCalled();

    unmount();
    await Promise.resolve();
    expect(bridge.dispose).toHaveBeenCalledTimes(1);
  });

  it("渲染帧失败时停止 RAF 并将错误交给可恢复回调", () => {
    const frameError = new Error("WebGL context 已丢失");
    const bridge = fakeBridge();
    vi.mocked(bridge.frame).mockImplementation(() => { throw frameError; });
    const onFrameError = vi.fn();
    render(
      <PreviewCanvas
        bridge={bridge}
        metadata={metadata}
        onSnapshot={vi.fn()}
        onFrameError={onFrameError}
      />,
    );

    act(() => frameCallbacks.shift()?.(100));

    expect(onFrameError).toHaveBeenCalledWith(frameError);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frameCallbacks).toHaveLength(0);
  });

  it("指针拖动精确更新 Runtime 相机中心", () => {
    const bridge = fakeBridge();
    const { container } = render(
      <PreviewCanvas bridge={bridge} metadata={metadata} onSnapshot={vi.fn()} />,
    );
    const viewport = container.querySelector(".preview-viewport") as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 0, top: 0, width: 640, height: 480 }),
      },
    });
    Object.defineProperty(viewport, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 135, clientY: 120 });
    expect(bridge.setView).toHaveBeenLastCalledWith({ centerX: -35, centerY: 20, zoom: 1 });
  });

  it("滚轮围绕指针精确缩放并由 Runtime 相机渲染", () => {
    const bridge = fakeBridge();
    const { container } = render(
      <PreviewCanvas bridge={bridge} metadata={metadata} onSnapshot={vi.fn()} />,
    );
    const viewport = container.querySelector(".preview-viewport") as HTMLDivElement;
    const canvas = screen.getByLabelText("Spine 动画画布");
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 0, top: 0, width: 640, height: 480 }),
      },
    });

    fireEvent.wheel(viewport, { clientX: 480, clientY: 120, deltaY: -100 });
    const view = vi.mocked(bridge.setView).mock.calls.at(-1)?.[0];
    expect(view?.zoom).toBeCloseTo(1.2);
    expect(view?.centerX).toBeCloseTo(26.666667);
    expect(view?.centerY).toBeCloseTo(20);
    expect(canvas.getAttribute("style") ?? "").not.toContain("transform");
  });

  it("使用当前 skeleton 整体 bounds 精确适配", async () => {
    const bridge = fakeBridge();
    const { container } = render(
      <PreviewCanvas bridge={bridge} metadata={metadata} onSnapshot={vi.fn()} />,
    );
    const viewport = container.querySelector(".preview-viewport") as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    });

    await userEvent.setup().click(screen.getByRole("button", { name: "适配画面" }));
    expect(bridge.getBounds).toHaveBeenCalledTimes(1);
    expect(bridge.setView).toHaveBeenLastCalledWith({ centerX: 50, centerY: 100, zoom: 1.02 });
  });

  it("预览区域可聚焦且键盘提供平移、缩放、适配与重置", () => {
    const bridge = fakeBridge();
    const { container } = render(
      <PreviewCanvas bridge={bridge} metadata={metadata} onSnapshot={vi.fn()} />,
    );
    const viewport = screen.getByRole("region", { name: "Spine 预览交互区域" });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    });

    viewport.focus();
    expect(document.activeElement).toBe(viewport);
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(bridge.setView).toHaveBeenLastCalledWith({ centerX: 40, centerY: 0, zoom: 1 });
    fireEvent.keyDown(viewport, { key: "+" });
    expect(bridge.setView).toHaveBeenLastCalledWith({ centerX: 40, centerY: 0, zoom: 1.2 });
    fireEvent.keyDown(viewport, { key: "Home" });
    expect(bridge.setView).toHaveBeenLastCalledWith({ centerX: 50, centerY: 100, zoom: 1.02 });
    fireEvent.keyDown(viewport, { key: "0" });
    expect(bridge.setView).toHaveBeenLastCalledWith({ centerX: 0, centerY: 0, zoom: 1 });
    expect(container.querySelector("canvas")?.style.transform).toBe("");
  });
});
