import {
  Download,
  FileUp,
  PanelLeftOpen,
  PanelRightOpen,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimationPanel } from "@/components/animation-panel";
import { ExportPanel } from "@/components/export-panel";
import { ImportDropzone } from "@/components/import-dropzone";
import { PlaybackBar } from "@/components/playback-bar";
import { PreviewCanvas } from "@/components/preview-canvas";
import { SkinPanel } from "@/components/skin-panel";
import { SlotPanel } from "@/components/slot-panel";
import { StatusCenter } from "@/components/status-center";
import type { ImportBundle } from "@/lib/files/import-files";
import {
  createRuntimeSession,
  prepareImport,
  suggestLegacyAlphaMode,
  type PreparedImport,
  type RuntimeSession,
} from "@/lib/files/import-workflow";
import type { AppIssue } from "@/lib/issues/types";
import type {
  PlaybackSnapshot,
  SkeletonMetadata,
  SpineRuntimeBridge,
  TextureAlphaMode,
} from "@/lib/spine/bridge-types";
import { inferExportScale, type ScaleInference } from "@/lib/spine/scale-inference";
import {
  runtimeDescriptor,
  type SupportedSpineVersion,
} from "@/lib/spine/runtime-registry";
import {
  createInitialWorkspaceState,
  workspaceReducer,
} from "@/lib/state/workspace-store";

type ControlTab = "animation" | "skin" | "slot";

interface AlphaModeFieldsProps {
  version: SupportedSpineVersion;
  value: TextureAlphaMode;
  onChange(value: TextureAlphaMode): void;
}

function AlphaModeFields({ version, value, onChange }: AlphaModeFieldsProps) {
  return (
    <fieldset className="alpha-mode-picker">
      <legend>Spine 3.x 纹理 Alpha 模式（当前 {version}）</legend>
      <label>
        <input
          type="radio"
          name="spine-3x-alpha-mode"
          value="premultiplied"
          checked={value === "premultiplied"}
          onChange={() => onChange("premultiplied")}
        />
        预乘 Alpha（PMA）
      </label>
      <label>
        <input
          type="radio"
          name="spine-3x-alpha-mode"
          value="straight"
          checked={value === "straight"}
          onChange={() => onChange("straight")}
        />
        直通 Alpha（Straight）
      </label>
    </fieldset>
  );
}

export interface WorkspaceShellProps {
  /** A preloaded bridge injection used by hosts and component tests. */
  bridge?: SpineRuntimeBridge;
  metadata?: SkeletonMetadata;
}

interface IssueFallback {
  code: string;
  severity: AppIssue["severity"];
  subject: string;
}

function issueFrom(error: unknown, fallback: IssueFallback): AppIssue {
  const structured = typeof error === "object" && error !== null && "code" in error
    ? error as Partial<AppIssue> & { pageName?: string; regionName?: string }
    : null;
  const detail = error instanceof Error ? error.message : "处理所选文件时发生未知错误。";
  const webglUnavailable = /不支持 WebGL|WebGL context/i.test(detail);
  return {
    code: webglUnavailable ? "WEBGL_UNAVAILABLE" : structured?.code ?? fallback.code,
    severity: fallback.severity,
    subject: structured?.subject
      ?? (structured?.regionName ? `Region「${structured.regionName}」` : structured?.pageName)
      ?? fallback.subject,
    details: structured?.details?.length ? structured.details : [detail],
  };
}

export function WorkspaceShell({ bridge: suppliedBridge, metadata: suppliedMetadata }: WorkspaceShellProps = {}) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, createInitialWorkspaceState);
  const [status, setStatus] = useState(suppliedMetadata ? "预览已就绪" : "等待导入");
  const [tab, setTab] = useState<ControlTab>("animation");
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(false);
  const [session, setSession] = useState<RuntimeSession | null>(null);
  const [loadedMetadata, setLoadedMetadata] = useState<SkeletonMetadata | null>(null);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [manualRuntimeRequired, setManualRuntimeRequired] = useState(false);
  const [manualVersion, setManualVersion] = useState<SupportedSpineVersion>("4.2");
  const [alphaMode, setAlphaMode] = useState<TextureAlphaMode>("straight");
  const [alphaModeVersion, setAlphaModeVersion] = useState<SupportedSpineVersion | null>(null);
  const sessionRef = useRef<RuntimeSession | null>(null);
  const preparedRef = useRef<PreparedImport | null>(null);
  const operationRef = useRef(0);
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const leftDrawerTriggerRef = useRef<HTMLButtonElement>(null);
  const rightDrawerTriggerRef = useRef<HTMLButtonElement>(null);
  const leftDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const rightDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const activeBridge = suppliedBridge ?? session?.bridge ?? null;
  const activeMetadata = suppliedMetadata ?? loadedMetadata;
  const ready = Boolean(activeBridge && activeMetadata && state.phase === "ready");
  const exportResourcesState = prepared?.exportResources ?? null;
  const inferredScale = useMemo<ScaleInference>(() => {
    if (!exportResourcesState) return inferExportScale([]);
    const pageScales = exportResourcesState.atlas.pages.flatMap((page) => (
      page.scale === undefined ? [] : [{ pageName: page.name, scale: page.scale }]
    ));
    if (!activeMetadata) return inferExportScale([], pageScales);
    const regionsByName = new Map<string, typeof exportResourcesState.atlas.regions[number]>();
    for (const region of exportResourcesState.atlas.regions) {
      if (!regionsByName.has(region.name)) regionsByName.set(region.name, region);
    }
    const attachmentSamples = activeMetadata.regionAttachments.flatMap((attachment) => {
      const region = regionsByName.get(attachment.name);
      if (!region) return [];
      return [{
        regionKey: `${region.name}#${region.index}`,
        regionName: region.name,
        atlasWidth: region.originalWidth,
        atlasHeight: region.originalHeight,
        attachmentWidth: attachment.width,
        attachmentHeight: attachment.height,
      }];
    });
    return inferExportScale(attachmentSamples, pageScales);
  }, [activeMetadata, exportResourcesState]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1099px)");
    const update = () => setNarrowViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => () => {
    operationRef.current += 1;
    sessionRef.current?.release();
    preparedRef.current?.exportResources.release();
  }, []);

  useEffect(() => {
    leftPanelRef.current?.toggleAttribute("inert", narrowViewport && !leftDrawerOpen);
    rightPanelRef.current?.toggleAttribute("inert", narrowViewport && !rightDrawerOpen);
    if (!narrowViewport) return;
    if (leftDrawerOpen) leftDrawerCloseRef.current?.focus();
    if (rightDrawerOpen) rightDrawerCloseRef.current?.focus();
  }, [leftDrawerOpen, narrowViewport, rightDrawerOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (rightDrawerOpen) {
        setRightDrawerOpen(false);
        queueMicrotask(() => rightDrawerTriggerRef.current?.focus());
      } else if (leftDrawerOpen) {
        setLeftDrawerOpen(false);
        queueMicrotask(() => leftDrawerTriggerRef.current?.focus());
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [leftDrawerOpen, rightDrawerOpen]);

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

  const replaceSession = useCallback((next: RuntimeSession | null) => {
    if (sessionRef.current !== next) sessionRef.current?.release();
    sessionRef.current = next;
    setSession(next);
  }, []);

  const replacePrepared = useCallback((next: PreparedImport | null) => {
    if (preparedRef.current !== next) preparedRef.current?.exportResources.release();
    preparedRef.current = next;
    setPrepared(next);
  }, []);

  const handleLoaded = useCallback((nextMetadata: SkeletonMetadata) => {
    setLoadedMetadata(nextMetadata);
    const version = sessionRef.current?.bridge.version;
    setStatus(version ? `Spine ${version} · 预览已就绪` : "预览已就绪");
    dispatch({ type: "IMPORT_SUCCEEDED" });
  }, []);

  const handlePreviewError = useCallback((error: unknown) => {
    const bundle = preparedRef.current?.bundle;
    const issue = issueFrom(error, {
      code: bundle?.skeletonKind === "json" ? "INVALID_JSON" : "PREVIEW_LOAD_FAILED",
      severity: "warning",
      subject: bundle?.skeletonFile.name ?? "Spine 预览",
    });
    replaceSession(null);
    setLoadedMetadata(null);
    setStatus("预览不可用 · Atlas 仍可导出");
    dispatch({ type: "IMPORT_FAILED", issue });
  }, [replaceSession]);

  const startRuntime = useCallback(async (
    bundle: ImportBundle,
    version: SupportedSpineVersion,
    alphaMode?: TextureAlphaMode,
  ) => {
    const operation = ++operationRef.current;
    replaceSession(null);
    setLoadedMetadata(null);
    setStatus(`正在加载 Spine ${version} Runtime…`);
    try {
      const nextSession = runtimeDescriptor(version).requiresExplicitAlphaMode
        ? await createRuntimeSession(bundle, version, { alphaMode })
        : await createRuntimeSession(bundle, version);
      if (operation !== operationRef.current) {
        nextSession.release();
        return;
      }
      replaceSession(nextSession);
      setStatus(`正在解析 Spine ${version} 骨骼…`);
    } catch (error) {
      if (operation !== operationRef.current) return;
      const issue = issueFrom(error, {
        code: "PREVIEW_LOAD_FAILED",
        severity: "warning",
        subject: bundle.skeletonFile.name,
      });
      setStatus("预览不可用 · Atlas 仍可导出");
      dispatch({ type: "IMPORT_FAILED", issue });
    }
  }, [replaceSession]);

  const resetImport = () => {
    if (suppliedBridge) return;
    operationRef.current += 1;
    dispatch({ type: "IMPORT_STARTED" });
    replaceSession(null);
    replacePrepared(null);
    setLoadedMetadata(null);
    setManualRuntimeRequired(false);
    setAlphaModeVersion(null);
    setStatus("请选择新的文件");
  };

  const handleImport = async (bundle: ImportBundle) => {
    const operation = ++operationRef.current;
    dispatch({ type: "IMPORT_STARTED" });
    replaceSession(null);
    replacePrepared(null);
    setLoadedMetadata(null);
    setManualRuntimeRequired(false);
    setAlphaModeVersion(null);
    setStatus("正在解析 Atlas 与识别版本…");
    try {
      const nextPrepared = await prepareImport(bundle);
      if (operation !== operationRef.current) {
        nextPrepared.exportResources.release();
        return;
      }
      replacePrepared(nextPrepared);
      setAlphaMode(suggestLegacyAlphaMode(bundle));

      if (nextPrepared.detected.compatibility === "spine-3.8.75") {
        dispatch({
          type: "REPORT_ISSUE",
          issue: {
            code: "SPINE_3_8_75_COMPATIBILITY",
            severity: "warning",
            subject: `Spine ${nextPrepared.detected.raw}`,
            details: [
              "已自动选择 Spine 3.8 Runtime；不会改写 JSON 或 SKEL 中的版本及其他数据。",
            ],
          },
        });
      }

      if (bundle.unusedTextures.length > 0) {
        dispatch({
          type: "REPORT_ISSUE",
          issue: {
            code: "UNUSED_TEXTURES",
            severity: "warning",
            subject: "额外 PNG",
            details: bundle.unusedTextures,
          },
        });
      }

      if (!nextPrepared.detected.majorMinor) {
        const code = nextPrepared.detected.raw
          ? "UNSUPPORTED_SPINE_VERSION"
          : bundle.skeletonKind === "skel"
            ? "INVALID_SKEL_HEADER"
            : "UNDETECTABLE_SPINE_VERSION";
        setManualRuntimeRequired(true);
        setStatus("Atlas 已就绪 · 请选择 Runtime 版本");
        dispatch({
          type: "IMPORT_FAILED",
          issue: {
            code,
            severity: "warning",
            subject: bundle.skeletonFile.name,
            details: nextPrepared.detected.raw
              ? [`检测到 Spine ${nextPrepared.detected.raw}`]
              : ["没有找到可识别的版本信息。"],
          },
        });
        return;
      }

      if (runtimeDescriptor(nextPrepared.detected.majorMinor).requiresExplicitAlphaMode) {
        setAlphaModeVersion(nextPrepared.detected.majorMinor);
        setStatus(`Atlas 已就绪 · 请确认 Spine ${nextPrepared.detected.majorMinor} Alpha 模式`);
        return;
      }

      await startRuntime(bundle, nextPrepared.detected.majorMinor);
    } catch (error) {
      if (operation !== operationRef.current) return;
      const issue = issueFrom(error, {
        code: "IMPORT_FAILED",
        severity: "error",
        subject: bundle.atlasFile.name,
      });
      setStatus("导入失败 · 请修正后重新选择");
      dispatch({ type: "IMPORT_FAILED", issue });
    }
  };

  const handleImportError = (issue: AppIssue) => {
    operationRef.current += 1;
    dispatch({ type: "IMPORT_STARTED" });
    replaceSession(null);
    replacePrepared(null);
    setLoadedMetadata(null);
    setManualRuntimeRequired(false);
    setAlphaModeVersion(null);
    setStatus("导入失败 · 请修正后重新选择");
    dispatch({ type: "IMPORT_FAILED", issue: { ...issue, subject: issue.subject ?? "所选文件" } });
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
          <button ref={leftDrawerTriggerRef} type="button" className="button drawer-toggle" aria-expanded={leftDrawerOpen} aria-controls="workspace-controls" onClick={() => setLeftDrawerOpen((open) => !open)}>
            <PanelLeftOpen size={18} aria-hidden="true" /> 控制面板
          </button>
          <button ref={rightDrawerTriggerRef} type="button" className="button drawer-toggle" aria-expanded={rightDrawerOpen} aria-controls="workspace-export" onClick={() => setRightDrawerOpen((open) => !open)}>
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
          <button ref={leftDrawerCloseRef} type="button" className="icon-button drawer-close" aria-label="关闭控制面板" onClick={() => {
            setLeftDrawerOpen(false);
            queueMicrotask(() => leftDrawerTriggerRef.current?.focus());
          }}>
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

      <section className={`preview-panel${state.warnings.length > 0 ? " has-issues" : ""}`} aria-label="动画预览">
        <StatusCenter issues={state.warnings} />
        <div className="preview-surface">
          {activeBridge ? (
            <PreviewCanvas bridge={activeBridge} metadata={activeMetadata} loadInput={suppliedBridge ? undefined : session?.input} onLoaded={handleLoaded} onLoadError={handlePreviewError} onFrameError={handlePreviewError} onSnapshot={handleSnapshot} />
          ) : (
            <div className="preview-empty">
              <FileUp size={42} aria-hidden="true" />
              <h2>{prepared ? "Atlas 已就绪，预览尚未可用" : "尚未导入 Spine 文件"}</h2>
              <p>{prepared
                ? "有效 Region 已保留在导出面板中；你可以继续导出，或重新选择完整文件。"
                : "选择 Atlas、JSON 或 SKEL 以及对应 PNG 纹理页，所有文件仅在本地处理。"}</p>
              {manualRuntimeRequired && prepared && (
                <form className="manual-runtime" onSubmit={(event) => {
                  event.preventDefault();
                  void startRuntime(
                    prepared.bundle,
                    manualVersion,
                    runtimeDescriptor(manualVersion).requiresExplicitAlphaMode ? alphaMode : undefined,
                  );
                }}>
                  <h3>手动选择 Runtime</h3>
                  <p>只在自动识别失败或版本超出支持范围时需要选择。</p>
                  <label>
                    Runtime 版本
                    <select aria-label="Runtime 版本" value={manualVersion} onChange={(event) => setManualVersion(event.currentTarget.value as SupportedSpineVersion)}>
                      <option value="3.8">Spine 3.8</option>
                      <option value="4.0">Spine 4.0</option>
                      <option value="4.1">Spine 4.1</option>
                      <option value="4.2">Spine 4.2</option>
                    </select>
                  </label>
                  {runtimeDescriptor(manualVersion).requiresExplicitAlphaMode && (
                    <>
                      <AlphaModeFields version={manualVersion} value={alphaMode} onChange={setAlphaMode} />
                      <p>文件名仅用于建议默认值；请确认纹理实际采用的 Alpha 模式。</p>
                    </>
                  )}
                  <button type="submit" className="button">使用所选 Runtime 加载预览</button>
                </form>
              )}
              {alphaModeVersion && prepared && (
                <form className="manual-runtime" onSubmit={(event) => {
                  event.preventDefault();
                  const version = alphaModeVersion;
                  setAlphaModeVersion(null);
                  void startRuntime(prepared.bundle, version, alphaMode);
                }}>
                  <h3>Spine 3.x 纹理 Alpha 模式</h3>
                  <p>Spine {alphaModeVersion} Atlas 可能不含 pma 字段。文件名仅用于建议默认值；请按纹理实际导出方式确认。</p>
                  <AlphaModeFields version={alphaModeVersion} value={alphaMode} onChange={setAlphaMode} />
                  <button type="submit" className="button">确认 Alpha 模式并加载预览</button>
                </form>
              )}
              <ImportDropzone inputId="spine-import-files" onImport={handleImport} onError={handleImportError} />
            </div>
          )}
        </div>
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
          <button ref={rightDrawerCloseRef} type="button" className="icon-button drawer-close" aria-label="关闭导出面板" onClick={() => {
            setRightDrawerOpen(false);
            queueMicrotask(() => rightDrawerTriggerRef.current?.focus());
          }}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <ExportPanel
          resources={exportResourcesState}
          inferredScale={inferredScale}
          onIssue={(issue) => dispatch({ type: "REPORT_ISSUE", issue })}
        />
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
