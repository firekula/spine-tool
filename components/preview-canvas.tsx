import { Maximize2, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  PlaybackSnapshot,
  RuntimeLoadInput,
  SkeletonMetadata,
  SpineRuntimeBridge,
} from "@/lib/spine/bridge-types";

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface PreviewCanvasProps {
  bridge: SpineRuntimeBridge;
  metadata: SkeletonMetadata | null;
  loadInput?: Omit<RuntimeLoadInput, "canvas">;
  onLoaded?: (metadata: SkeletonMetadata) => void;
  onLoadError?: (error: unknown) => void;
  onSnapshot: (snapshot: PlaybackSnapshot) => void;
}

const DEFAULT_VIEW: ViewTransform = { x: 0, y: 0, scale: 1 };

function metadataBounds(metadata: SkeletonMetadata | null): { width: number; height: number } {
  if (!metadata || metadata.regionAttachments.length === 0) return { width: 1, height: 1 };
  return metadata.regionAttachments.reduce(
    (bounds, attachment) => ({
      width: Math.max(bounds.width, attachment.width),
      height: Math.max(bounds.height, attachment.height),
    }),
    { width: 1, height: 1 },
  );
}

export function PreviewCanvas({
  bridge,
  metadata,
  loadInput,
  onLoaded,
  onLoadError,
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
  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
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
    const renderFrame = (timestamp: number) => {
      const deltaSeconds = previousTimestamp === null
        ? 0
        : Math.min(Math.max(0, timestamp - previousTimestamp) / 1000, 0.1);
      previousTimestamp = timestamp;
      onSnapshot(bridge.frame(deltaSeconds));
      frameId = requestAnimationFrame(renderFrame);
    };
    frameId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(frameId);
      const token = { bridge, cancelled: false };
      pendingDisposeRef.current = token;
      queueMicrotask(() => {
        if (!token.cancelled) token.bridge.dispose();
        if (pendingDisposeRef.current === token) pendingDisposeRef.current = null;
      });
    };
  }, [bridge, onSnapshot]);

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

  const fitView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = metadataBounds(metadata);
    const scale = Math.min(
      viewport.clientWidth / bounds.width,
      viewport.clientHeight / bounds.height,
    ) * 0.85;
    const safeScale = Math.min(8, Math.max(0.1, scale));
    setView({
      x: (viewport.clientWidth - bounds.width * safeScale) / 2,
      y: (viewport.clientHeight - bounds.height * safeScale) / 2,
      scale: safeScale,
    });
  }, [metadata]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setView((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    setView((current) => {
      const factor = Math.exp(-event.deltaY * 0.0015);
      const scale = Math.min(8, Math.max(0.1, current.scale * factor));
      const ratio = scale / current.scale;
      return {
        scale,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      };
    });
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
      </div>
      <div
        ref={viewportRef}
        className="preview-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          aria-label="Spine 动画画布"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
    </div>
  );
}
