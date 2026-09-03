import {
  Download,
  FileUp,
  PanelLeftOpen,
  PanelRightOpen,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AnimationPanel } from "@/components/animation-panel";
import { ImportDropzone } from "@/components/import-dropzone";
import { PlaybackBar } from "@/components/playback-bar";
import { PreviewCanvas } from "@/components/preview-canvas";
import { SkinPanel } from "@/components/skin-panel";
import { SlotPanel } from "@/components/slot-panel";
import type { ImportBundle } from "@/lib/files/import-files";
import type { AppIssue } from "@/lib/issues/types";
import type {
  PlaybackSnapshot,
  RuntimeLoadInput,
  SkeletonMetadata,
  SpineRuntimeBridge,
} from "@/lib/spine/bridge-types";
import { loadRuntimeModule } from "@/lib/spine/runtime-loader";
import { detectSpineVersion } from "@/lib/spine/version";
import {
  createInitialWorkspaceState,
  workspaceReducer,
} from "@/lib/state/workspace-store";

type ControlTab = "animation" | "skin" | "slot";

interface PreviewSession {
  bridge: SpineRuntimeBridge;
  input: Omit<RuntimeLoadInput, "canvas">;
}

export interface WorkspaceShellProps {
  /** A preloaded bridge injection used by hosts and component tests. */
  bridge?: SpineRuntimeBridge;
  metadata?: SkeletonMetadata;
}

function issueFrom(error: unknown, code = "PREVIEW_LOAD_FAILED"): AppIssue {
  return {
    code,
    severity: "error",
    details: [error instanceof Error ? error.message : "无法加载 Spine 预览。"],
  };
}

async function runtimeInput(bundle: ImportBundle): Promise<Omit<RuntimeLoadInput, "canvas">> {
  const skeleton = bundle.skeletonKind === "json"
    ? { kind: "json" as const, text: await bundle.skeletonFile.text() }
    : { kind: "skel" as const, bytes: new Uint8Array(await bundle.skeletonFile.arrayBuffer()) };
  return {
    atlasText: bundle.atlasText,
    skeleton,
    textureObjectUrls: new Map(
      Array.from(bundle.textureFiles, ([name, file]) => [name, URL.createObjectURL(file)]),
    ),
  };
}

export function WorkspaceShell({ bridge: suppliedBridge, metadata: suppliedMetadata }: WorkspaceShellProps = {}) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, createInitialWorkspaceState);
  const [status, setStatus] = useState(suppliedMetadata ? "预览已就绪" : "等待导入");
  const [tab, setTab] = useState<ControlTab>("animation");
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(false);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [loadedMetadata, setLoadedMetadata] = useState<SkeletonMetadata | null>(null);
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const activeBridge = suppliedBridge ?? session?.bridge ?? null;
  const activeMetadata = suppliedMetadata ?? loadedMetadata;
  const ready = Boolean(activeBridge && activeMetadata && state.phase === "ready");

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1099px)");
    const update = () => setNarrowViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    leftPanelRef.current?.toggleAttribute("inert", narrowViewport && !leftDrawerOpen);
    rightPanelRef.current?.toggleAttribute("inert", narrowViewport && !rightDrawerOpen);
  }, [leftDrawerOpen, narrowViewport, rightDrawerOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setLeftDrawerOpen(false);
      setRightDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    if (!activeMetadata) return;
    const firstAnimation = activeMetadata.animations[0] ?? null;
    dispatch({
      type: "INITIALIZE_CONTROLS",
      animation: firstAnimation?.name ?? null,
      duration: firstAnimation?.duration ?? 0,
      skin: activeMetadata.skins[0] ?? null,
    });
  }, [activeMetadata]);

  useEffect(() => {
    if (!activeBridge) return;
    activeBridge.setSpeed(state.speed);
  }, [activeBridge, state.speed]);

  useEffect(() => {
    if (!activeBridge || !state.selectedAnimation) return;
    activeBridge.play(state.selectedAnimation, state.loop);
    activeBridge.setHiddenSlots(state.hiddenSlots);
  }, [activeBridge, state.selectedAnimation]);

  useEffect(() => {
    if (!activeBridge) return;
    activeBridge.setLoop(state.loop);
  }, [activeBridge, state.loop]);

  useEffect(() => {
    if (!activeBridge) return;
    activeBridge.pause(state.paused);
  }, [activeBridge, state.paused]);

  useEffect(() => {
    if (!activeBridge) return;
    activeBridge.setSkins(state.selectedSkins);
  }, [activeBridge, state.selectedSkins]);

  useEffect(() => {
    if (!activeBridge) return;
    activeBridge.setHiddenSlots(state.hiddenSlots);
  }, [activeBridge, state.hiddenSlots]);

  useEffect(() => {
    if (!activeBridge || !state.seekRequest) return;
    activeBridge.seek(state.seekRequest.time);
  }, [activeBridge, state.seekRequest]);

  const handleSnapshot = useCallback((snapshot: PlaybackSnapshot) => {
    dispatch({ type: "SYNC_PLAYBACK", snapshot });
  }, []);

  const handleLoaded = useCallback((nextMetadata: SkeletonMetadata) => {
    setLoadedMetadata(nextMetadata);
    setStatus("预览已就绪");
    dispatch({ type: "IMPORT_SUCCEEDED" });
  }, []);

  const handlePreviewError = useCallback((error: unknown) => {
    const issue = issueFrom(error);
    setStatus(`预览失败：${issue.details?.[0] ?? issue.code}`);
    dispatch({ type: "IMPORT_FAILED", issue });
  }, []);

  const resetImport = () => {
    if (suppliedBridge) return;
    dispatch({ type: "IMPORT_STARTED" });
    setSession(null);
    setLoadedMetadata(null);
    setStatus("请选择新的文件");
  };

  const handleImport = async (bundle: ImportBundle) => {
    dispatch({ type: "IMPORT_STARTED" });
    setSession(null);
    setLoadedMetadata(null);
    setStatus("正在识别 Runtime…");
    try {
      const detected = await detectSpineVersion(bundle.skeletonFile);
      if (!detected.majorMinor) {
        throw new Error(detected.raw
          ? `不支持 Spine ${detected.raw}`
          : "无法识别 Spine 版本");
      }
      const module = await loadRuntimeModule(detected.majorMinor);
      const input = await runtimeInput(bundle);
      setSession({ bridge: module.createBridge(), input });
      setStatus(`正在加载 Spine ${detected.majorMinor}…`);
    } catch (error) {
      handlePreviewError(error);
    }
  };

  const handleImportError = (issue: AppIssue) => {
    setStatus(`导入失败：${issue.details?.[0] ?? issue.code}`);
    dispatch({ type: "IMPORT_FAILED", issue });
  };

  const metadataForControls: SkeletonMetadata = activeMetadata ?? {
    animations: [], skins: [], slots: [], regionAttachments: [],
  };

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Spine 本地工具</p>
          <h1>动画预览与 Atlas 子图导出</h1>
          <p className="runtime-license">Spine Runtime 使用受 Esoteric Software 许可条款约束。</p>
        </div>
        <div className="toolbar-actions">
          {!activeBridge ? (
            <label className="button button-primary" htmlFor="spine-import-files">
              <FileUp size={18} aria-hidden="true" /> 导入文件
            </label>
          ) : (
            <button type="button" className="button button-primary" onClick={resetImport} disabled={Boolean(suppliedBridge)}>
              <FileUp size={18} aria-hidden="true" /> 导入文件
            </button>
          )}
          <button type="button" className="button" onClick={resetImport} disabled={!activeBridge || Boolean(suppliedBridge)}>
            <RotateCcw size={18} aria-hidden="true" /> 重新导入
          </button>
          <button type="button" className="button drawer-toggle" aria-expanded={leftDrawerOpen} aria-controls="workspace-controls" onClick={() => setLeftDrawerOpen((open) => !open)}>
            <PanelLeftOpen size={18} aria-hidden="true" /> 控制面板
          </button>
          <button type="button" className="button drawer-toggle" aria-expanded={rightDrawerOpen} aria-controls="workspace-export" onClick={() => setRightDrawerOpen((open) => !open)}>
            <PanelRightOpen size={18} aria-hidden="true" /> 导出面板
          </button>
          <span className="status" role="status">{status}</span>
        </div>
      </header>

      <aside
        ref={leftPanelRef}
        id="workspace-controls"
        className={`sidebar control-panel${leftDrawerOpen ? " drawer-open" : ""}`}
        aria-label="动画控制"
        aria-hidden={narrowViewport && !leftDrawerOpen}
      >
        <div className="panel-heading">
          <h2>控制</h2>
          <Settings2 size={18} aria-hidden="true" />
          <button type="button" className="icon-button drawer-close" aria-label="关闭控制面板" onClick={() => setLeftDrawerOpen(false)}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="tabs" role="tablist" aria-label="控制类别">
          <button type="button" role="tab" aria-selected={tab === "animation"} onClick={() => setTab("animation")}>动画</button>
          <button type="button" role="tab" aria-selected={tab === "skin"} onClick={() => setTab("skin")}>皮肤</button>
          <button type="button" role="tab" aria-selected={tab === "slot"} onClick={() => setTab("slot")}>插槽</button>
        </div>
        {!activeMetadata && <p className="empty-copy">导入 Spine 文件后即可查看可用控制项。</p>}
        {tab === "animation" && (
          <AnimationPanel animations={metadataForControls.animations} selectedAnimation={state.selectedAnimation} disabled={!ready} onSelect={(animation) => dispatch({ type: "SELECT_ANIMATION", animation: animation.name, duration: animation.duration })} />
        )}
        {tab === "skin" && (
          <SkinPanel
            skins={metadataForControls.skins}
            mode={state.skinMode}
            selectedSkins={state.selectedSkins}
            disabled={!ready}
            onModeChange={(mode) => {
              dispatch({ type: "SET_SKIN_MODE", mode });
              if (mode === "single" && state.selectedSkins.length > 1) dispatch({ type: "SET_SKINS", skins: state.selectedSkins.slice(0, 1) });
            }}
            onSelectionChange={(skins) => dispatch({ type: "SET_SKINS", skins })}
          />
        )}
        {tab === "slot" && (
          <SlotPanel slots={metadataForControls.slots} hiddenSlots={state.hiddenSlots} disabled={!ready} onToggle={(slot) => dispatch({ type: "TOGGLE_SLOT", slot })} onHiddenSlotsChange={(slots) => dispatch({ type: "SET_HIDDEN_SLOTS", slots })} />
        )}
      </aside>

      <section className="preview-panel" aria-label="动画预览">
        {activeBridge ? (
          <PreviewCanvas bridge={activeBridge} metadata={activeMetadata} loadInput={suppliedBridge ? undefined : session?.input} onLoaded={handleLoaded} onLoadError={handlePreviewError} onSnapshot={handleSnapshot} />
        ) : (
          <div className="preview-empty">
            <FileUp size={42} aria-hidden="true" />
            <h2>尚未导入 Spine 文件</h2>
            <p>选择 Atlas、JSON 或 SKEL 以及对应 PNG 纹理页，所有文件仅在本地处理。</p>
            <ImportDropzone inputId="spine-import-files" onImport={handleImport} onError={handleImportError} />
          </div>
        )}
      </section>

      <aside
        ref={rightPanelRef}
        id="workspace-export"
        className={`sidebar export-panel${rightDrawerOpen ? " drawer-open" : ""}`}
        aria-label="Atlas 导出"
        aria-hidden={narrowViewport && !rightDrawerOpen}
      >
        <div className="panel-heading">
          <h2>Atlas 导出</h2>
          <Download size={18} aria-hidden="true" />
          <button type="button" className="icon-button drawer-close" aria-label="关闭导出面板" onClick={() => setRightDrawerOpen(false)}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <p className="empty-copy">导入后将在这里列出 Region 和恢复倍率。</p>
        <button type="button" className="button" disabled><Download size={18} aria-hidden="true" /> 导出全部 ZIP</button>
      </aside>

      <PlaybackBar
        disabled={!ready || !state.selectedAnimation}
        paused={state.paused}
        loop={state.loop}
        speed={state.speed}
        snapshot={state.playback}
        onPausedChange={(paused) => dispatch({ type: "SET_PAUSED", paused })}
        onLoopChange={(loop) => dispatch({ type: "SET_LOOP", loop })}
        onSpeedChange={(speed) => dispatch({ type: "SET_SPEED", speed })}
        onSeek={(time) => dispatch({ type: "SEEK", time })}
      />
    </main>
  );
}
