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
    pause: vi.fn(),
    seek: vi.fn(),
    setSpeed: vi.fn(),
    setSkins: vi.fn(),
    setHiddenSlots: vi.fn(),
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

afterEach(() => cleanup());

describe("workspace controls", () => {
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

  it("同步播放、循环、速度和 seek", async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge({ duration: 4, time: 1 });
    render(<WorkspaceShell bridge={bridge} metadata={metadata} />);

    await user.click(screen.getByRole("button", { name: "暂停" }));
    expect(bridge.pause).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "播放" }));
    expect(bridge.pause).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("checkbox", { name: "循环播放" }));
    expect(bridge.play).toHaveBeenLastCalledWith("idle", false);
    await user.selectOptions(screen.getByRole("combobox", { name: "速度" }), "1.25");
    expect(bridge.setSpeed).toHaveBeenLastCalledWith(1.25);
    fireEvent.change(screen.getByRole("slider", { name: "动画进度" }), {
      target: { value: "1.5" },
    });
    expect(bridge.seek).toHaveBeenLastCalledWith(1.5);
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

  it("支持指针拖动、以指针为中心缩放和适配画面", async () => {
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
    Object.defineProperty(viewport, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 135, clientY: 120 });
    expect(canvas.getAttribute("style")).toContain("translate");
    fireEvent.wheel(viewport, { clientX: 320, clientY: 240, deltaY: -100 });
    expect(canvas.getAttribute("style")).toContain("scale");

    await userEvent.setup().click(screen.getByRole("button", { name: "适配画面" }));
    expect(canvas.getAttribute("style")).toContain("scale");
  });
});
