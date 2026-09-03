import { Maximize2, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  PlaybackSnapshot,
  RuntimeLoadInput,
  RuntimeView,
  SkeletonMetadata,
  SpineRuntimeBridge,
} from "@/lib/spine/bridge-types";

export interface PreviewCanvasProps {
  bridge: SpineRuntimeBridge;
  metadata: SkeletonMetadata | null;
  loadInput?: Omit<RuntimeLoadInput, "canvas">;
  onLoaded?: (metadata: SkeletonMetadata) => void;
  onLoadError?: (error: unknown) => void;
  onFrameError?: (error: unknown) => void;
  onSnapshot: (snapshot: PlaybackSnapshot) => void;
}

const DEFAULT_VIEW: RuntimeView = { centerX: 0, centerY: 0, zoom: 1 };
const ZOOM_FACTOR = 1.2;
const KEYBOARD_PAN_PIXELS = 40;

export function PreviewCanvas({
  bridge,
  metadata: _metadata,
  loadInput,
  onLoaded,
  onLoadError,
  onFrameError,
  onSnapshot,
}: PreviewCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const loadPromiseRef = useRef<{
    bridge: SpineRuntimeBridge;
    input: Omit<RuntimeLoadInput, "canvas">;
    promise: Promise<SkeletonMetadata>;
  } | null>(null);
  const pendingDisposeRef = useRef<{
    bridge: SpineRuntimeBridge;
    cancelled: boolean;
  } | null>(null);
  const [view, setView] = useState<RuntimeView>(DEFAULT_VIEW);
  const [background, setBackground] = useState<"grid" | "light" | "dark">("grid");

  useEffect(() => {
    if (!loadInput || !canvasRef.current) return;
    let active = true;
    const cached = loadPromiseRef.current;
    const promise = cached?.bridge === bridge && cached.input === loadInput
      ? cached.promise
      : bridge.load({ ...loadInput, canvas: canvasRef.current });
    loadPromiseRef.current = { bridge, input: loadInput, promise };
    void promise.then(
      (loadedMetadata) => {
        if (active) {
          const viewport = viewportRef.current;
          if (viewport) {
            bridge.resize(viewport.clientWidth, viewport.clientHeight, window.devicePixelRatio || 1);
          }
          onLoaded?.(loadedMetadata);
        }
      },
      (error: unknown) => {
        if (active) onLoadError?.(error);
      },
    );
    return () => {
      active = false;
    };
  }, [bridge, loadInput, onLoaded, onLoadError]);

  useEffect(() => {
    const pendingDispose = pendingDisposeRef.current;
    if (pendingDispose?.bridge === bridge) pendingDispose.cancelled = true;
    let frameId = 0;
    let previousTimestamp: number | null = null;
    let stopped = false;
    const renderFrame = (timestamp: number) => {
      if (stopped) return;
      const deltaSeconds = previousTimestamp === null
        ? 0
        : Math.min(Math.max(0, timestamp - previousTimestamp) / 1000, 0.1);
      previousTimestamp = timestamp;
      try {
        onSnapshot(bridge.frame(deltaSeconds));
      } catch (error) {
        stopped = true;
        onFrameError?.(error);
        return;
      }
      frameId = requestAnimationFrame(renderFrame);
    };
    frameId = requestAnimationFrame(renderFrame);

    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      const token = { bridge, cancelled: false };
      pendingDisposeRef.current = token;
      queueMicrotask(() => {
        if (!token.cancelled) token.bridge.dispose();
        if (pendingDisposeRef.current === token) pendingDisposeRef.current = null;
      });
    };
  }, [bridge, onFrameError, onSnapshot]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => {
      bridge.resize(viewport.clientWidth, viewport.clientHeight, window.devicePixelRatio || 1);
    };
    resize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [bridge]);

  useEffect(() => {
    bridge.setView(view);
  }, [bridge, view]);

  const fitView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = bridge.getBounds();
    if (!bounds) return;
    const zoom = Math.min(
      viewport.clientWidth / bounds.width,
      viewport.clientHeight / bounds.height,
    ) * 0.85;
    const safeZoom = Math.min(20, Math.max(0.05, zoom));
    setView({
      centerX: bounds.x + bounds.width / 2,
      centerY: bounds.y + bounds.height / 2,
      zoom: safeZoom,
    });
  }, [bridge]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setView((current) => ({
      ...current,
      centerX: current.centerX - deltaX / current.zoom,
      centerY: current.centerY + deltaY / current.zoom,
    }));
  };

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    setView((current) => {
      if (event.deltaY === 0) return current;
      const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const zoom = Math.min(20, Math.max(0.05, current.zoom * factor));
      const screenX = pointerX - viewportWidth / 2;
      const screenY = pointerY - viewportHeight / 2;
      const worldX = current.centerX + screenX / current.zoom;
      const worldY = current.centerY - screenY / current.zoom;
      return {
        zoom,
        centerX: worldX - screenX / zoom,
        centerY: worldY + screenY / zoom,
      };
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === "Home") {
      event.preventDefault();
      fitView();
      return;
    }
    if (key === "0") {
      event.preventDefault();
      setView(DEFAULT_VIEW);
      return;
    }
    if (["+", "=", "-", "_"].includes(key)) {
      event.preventDefault();
      setView((current) => ({
        ...current,
        zoom: Math.min(
          20,
          Math.max(0.05, current.zoom * (["+", "="].includes(key) ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)),
        ),
      }));
      return;
    }
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    }[key];
    if (!direction) return;
    event.preventDefault();
    setView((current) => ({
      ...current,
      centerX: current.centerX + direction[0]! * KEYBOARD_PAN_PIXELS / current.zoom,
      centerY: current.centerY + direction[1]! * KEYBOARD_PAN_PIXELS / current.zoom,
    }));
  };

  return (
    <div className={`preview-stage preview-background-${background}`}>
      <div className="preview-tools" aria-label="预览视图控制">
        <button type="button" className="icon-button" onClick={fitView} aria-label="适配画面">
          <Maximize2 size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setView(DEFAULT_VIEW)}
          aria-label="重置视角"
        >
          <RotateCcw size={17} aria-hidden="true" />
        </button>
        <label>
          背景
          <select
            aria-label="预览背景"
            value={background}
            onChange={(event) => setBackground(event.currentTarget.value as typeof background)}
          >
            <option value="grid">透明网格</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <output className="view-readout" aria-label="当前视图" aria-live="off">
          {Math.round(view.zoom * 100)}% · x {Math.round(view.centerX)} · y {Math.round(view.centerY)}
        </output>
      </div>
      <div
        ref={viewportRef}
        className="preview-viewport"
        role="region"
        aria-label="Spine 预览交互区域"
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - Home 0"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onKeyDown={handleKeyDown}
      >
        <canvas ref={canvasRef} aria-label="Spine 动画画布" />
      </div>
    </div>
  );
}
