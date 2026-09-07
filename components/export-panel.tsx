import { Download, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { exportAllRegions } from "@/lib/export/export-zip";
import type { ExportResources } from "@/lib/files/import-workflow";
import type { AppIssue } from "@/lib/issues/types";
import type { ScaleInference } from "@/lib/spine/scale-inference";
import type { TextureAlphaMode } from "@/lib/spine/bridge-types";
import type { SupportedSpineVersion } from "@/lib/spine/runtime-registry";

export type AtlasExportSourceVersion = SupportedSpineVersion | "3.x";

export interface ExportPanelProps {
  resources: ExportResources | null;
  inferredScale: ScaleInference;
  onIssue?: (issue: AppIssue) => void;
  sourceVersion: AtlasExportSourceVersion | null;
  legacyAlphaMode?: TextureAlphaMode | null;
}

function displayMultiplier(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : "";
}

function multiplierError(value: string, allowBlank: boolean): string | null {
  if (!value.trim() && allowBlank) return null;
  const multiplier = Number(value);
  return Number.isFinite(multiplier) && multiplier > 0
    ? null
    : "倍率必须是大于 0 的有限数值。";
}

function downloadZip(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "spine-regions.zip";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportPanel({
  resources,
  inferredScale,
  onIssue,
  sourceVersion,
  legacyAlphaMode = null,
}: ExportPanelProps) {
  const [globalValue, setGlobalValue] = useState("1");
  const [overrideValues, setOverrideValues] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number; phase: "restoring" | "compressing" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [regionQuery, setRegionQuery] = useState("");
  const [scaleConflictConfirmed, setScaleConflictConfirmed] = useState(false);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const atlas = resources?.atlas ?? null;
  const textures = resources?.textures ?? null;
  const exporting = progress !== null;
  const sourceVersionRequired = Boolean(resources && !sourceVersion);
  const legacyAlphaConfirmationRequired = Boolean(sourceVersion?.startsWith("3.") && !legacyAlphaMode);

  const cancelCurrentExport = useCallback((): boolean => {
    generationRef.current += 1;
    const active = abortRef.current;
    if (!active) return false;
    active.abort();
    return true;
  }, []);

  const cancelFromUi = useCallback(() => {
    cancelCurrentExport();
    setNotice("导出已取消。");
  }, [cancelCurrentExport]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelCurrentExport();
    };
  }, [cancelCurrentExport]);

  useEffect(() => {
    const cancelled = cancelCurrentExport();
    setGlobalValue("1");
    setOverrideValues(new Map());
    if (!cancelled) setProgress(null);
    setNotice(null);
    setRegionQuery("");
    setScaleConflictConfirmed(false);
  }, [cancelCurrentExport, resources]);

  const configMountedRef = useRef(false);
  useEffect(() => {
    if (!configMountedRef.current) {
      configMountedRef.current = true;
      return;
    }
    if (cancelCurrentExport()) {
      setNotice("导出配置已变化，旧导出正在取消。");
    }
  }, [cancelCurrentExport, inferredScale, legacyAlphaMode, sourceVersion]);

  const globalMultiplier = Number(globalValue);
  const globalError = multiplierError(globalValue, false);
  const overrideErrors = useMemo(() => {
    const errors = new Map<string, string>();
    for (const [key, value] of overrideValues) {
      const error = multiplierError(value, true);
      if (error) errors.set(key, error);
    }
    return errors;
  }, [overrideValues]);
  const finalMultiplier = globalError ? null : inferredScale.restoreMultiplier * globalMultiplier;
  const requiresScaleConfirmation = Boolean(inferredScale.requiresConfirmation);
  const canExport = Boolean(
    atlas
    && textures
    && !globalError
    && overrideErrors.size === 0
    && !exporting
    && !sourceVersionRequired
    && !legacyAlphaConfirmationRequired
    && (!requiresScaleConfirmation || scaleConflictConfirmed),
  );
  const overrides = useMemo(() => {
    const values = new Map<string, number>();
    for (const [key, value] of overrideValues) {
      if (!value.trim()) continue;
      const multiplier = Number(value);
      if (Number.isFinite(multiplier) && multiplier > 0) values.set(key, multiplier);
    }
    return values;
  }, [overrideValues]);
  const filteredRegions = useMemo(() => {
    const normalized = regionQuery.trim().toLocaleLowerCase();
    return !atlas || !normalized
      ? atlas?.regions ?? []
      : atlas.regions.filter((region) => region.name.toLocaleLowerCase().includes(normalized));
  }, [atlas, regionQuery]);

  const updateOverride = (key: string, value: string) => {
    setOverrideValues((current) => {
      const next = new Map(current);
      next.set(key, value);
      return next;
    });
  };

  const startExport = async () => {
    if (!resources || !atlas || !textures || !canExport) return;
    cancelCurrentExport();
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    let lease: ReturnType<ExportResources["acquire"]> | null = null;
    const isCurrent = () => mountedRef.current
      && generation === generationRef.current
      && !controller.signal.aborted;
    setNotice(null);
    setProgress({ done: 0, total: atlas.regions.length, phase: "restoring" });
    try {
      lease = resources.acquire();
      const result = await exportAllRegions({
        atlas: lease.atlas,
        textures: lease.textures,
        inferredScale,
        globalMultiplier,
        regionOverrides: overrides,
        sourceVersion,
        legacyAlphaMode,
      }, (done, total, phase = "restoring") => {
        if (isCurrent()) setProgress({ done, total, phase });
      }, { signal: controller.signal });
      if (!isCurrent()) return;
      downloadZip(result.blob);
      for (const issue of result.issues) onIssue?.(issue);
      const { successful, skipped, failed } = result.report.summary;
      setNotice(`导出完成：成功 ${successful} 项，跳过 ${skipped} 项，失败 ${failed} 项。ZIP 已包含详细报告。`);
    } catch (error) {
      if (!isCurrent() || (error instanceof Error && error.name === "AbortError")) return;
      const detail = error instanceof Error ? error.message : "无法生成 ZIP。";
      setNotice(`导出失败：${detail}`);
      onIssue?.({ code: "ZIP_FAILED", severity: "error", subject: "spine-regions.zip", details: [detail] });
    } finally {
      lease?.release();
      if (mountedRef.current && abortRef.current === controller) {
        abortRef.current = null;
        setProgress(null);
      }
    }
  };

  if (!atlas || !textures) {
    return <p className="empty-copy">导入后将在这里列出 Region、自动比例和恢复倍率。</p>;
  }

  return (
    <div className="export-content">
      <section className="export-summary" aria-label="自动倍率推算">
        <h3>自动倍率</h3>
        <dl>
          <div><dt>恢复倍率</dt><dd>{displayMultiplier(inferredScale.restoreMultiplier)} 倍</dd></div>
          <div><dt>推算导出比例</dt><dd>{displayMultiplier(inferredScale.exportPercent)}%</dd></div>
          <div><dt>最终恢复倍率</dt><dd>{finalMultiplier === null
            ? "请先修正全局倍率"
            : `${displayMultiplier(inferredScale.restoreMultiplier)} × ${displayMultiplier(globalMultiplier)} = ${displayMultiplier(finalMultiplier)} 倍`}</dd></div>
          <div><dt>有效样本</dt><dd>{inferredScale.sampleCount}</dd></div>
          <div><dt>置信度</dt><dd>{inferredScale.confidence === "high" ? "高" : inferredScale.confidence === "medium" ? "中" : "低"}</dd></div>
        </dl>
        {inferredScale.evidence.length > 0 && (
          <p className="export-evidence">依据：{inferredScale.evidence.filter((item) => item.included).map((item) => item.regionName).join("、") || "没有一致样本"}</p>
        )}
        {(inferredScale.pageEvidence?.length ?? 0) > 0 && (
          <p className="export-evidence">Atlas 页：{inferredScale.pageEvidence!.map((item) => (
            `${item.pageName}（scale ${displayMultiplier(item.atlasScale)} → 恢复 ${displayMultiplier(item.restoreMultiplier)} 倍）`
          )).join("、")}</p>
        )}
        {inferredScale.confidence === "low" && (
          <p className="export-warning"><TriangleAlert size={16} aria-hidden="true" /> 自动倍率置信度低；请核对后明确点击导出。</p>
        )}
        {inferredScale.warnings.map((warning) => <p className="export-warning" key={warning}>{warning}</p>)}
      </section>

      <label className="export-number-field">
        <span>全局倍率（乘在自动倍率之后）</span>
        <input
          type="text"
          inputMode="decimal"
          value={globalValue}
          aria-invalid={Boolean(globalError)}
          aria-describedby={globalError ? "global-multiplier-error" : undefined}
          onChange={(event) => {
            setGlobalValue(event.target.value);
            if (requiresScaleConfirmation) setScaleConflictConfirmed(false);
          }}
          disabled={exporting}
        />
        {globalError && <span className="export-field-error" id="global-multiplier-error">全局倍率必须是大于 0 的有限数值。</span>}
      </label>

      {requiresScaleConfirmation && (
        <label className="check-row export-scale-confirmation">
          <input
            type="checkbox"
            checked={scaleConflictConfirmed}
            onChange={(event) => setScaleConflictConfirmed(event.currentTarget.checked)}
            disabled={exporting}
          />
          我已核对冲突页面并确认使用上述手动倍率
        </label>
      )}

      {legacyAlphaConfirmationRequired && (
        <p className="export-warning"><TriangleAlert size={16} aria-hidden="true" /> 请先在预览区明确确认 Spine 3.x 纹理 Alpha 模式。</p>
      )}
      {sourceVersionRequired && (
        <p className="export-warning"><TriangleAlert size={16} aria-hidden="true" /> 请先在预览区选择素材对应的 Runtime 版本，再导出 Atlas 子图。</p>
      )}

      <section className="export-region-list" aria-label="Region 单项倍率覆盖">
        <h3>Region（{atlas.regions.length}）</h3>
        <label className="visually-hidden" htmlFor="export-region-search">搜索 Region</label>
        <input
          id="export-region-search"
          className="search-input"
          type="search"
          aria-label="搜索 Region"
          value={regionQuery}
          onChange={(event) => setRegionQuery(event.currentTarget.value)}
          disabled={exporting}
        />
        {filteredRegions.map((region) => {
          const key = `${region.name}#${region.index}`;
          const error = overrideErrors.get(key);
          const errorId = `region-multiplier-${region.index}-error`;
          return (
            <label className="export-region-row" key={key}>
              <span title={region.name}>{region.name}</span>
              <span className="export-override-input">
                <input
                  aria-label={`${region.name} 的单项倍率`}
                  type="text"
                  inputMode="decimal"
                  placeholder="继承"
                  value={overrideValues.get(key) ?? ""}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => updateOverride(key, event.target.value)}
                  disabled={exporting}
                />
                {error && <span className="export-field-error" id={errorId}>单项倍率必须是大于 0 的有限数值。</span>}
              </span>
            </label>
          );
        })}
        {filteredRegions.length === 0 && <p className="empty-copy">没有匹配的 Region。</p>}
      </section>

      {progress && <p className="export-progress" role="status">{progress.phase === "compressing"
        ? "正在压缩 ZIP…"
        : `已处理 ${progress.done} / ${progress.total}`}</p>}
      {notice && <p className="export-notice" role="status">{notice}</p>}
      <button type="button" className="button button-primary" disabled={!canExport} onClick={startExport}>
        <Download size={18} aria-hidden="true" /> {exporting
          ? "正在导出 ZIP"
          : requiresScaleConfirmation
            ? "确认倍率后导出全部 ZIP"
            : inferredScale.confidence === "low"
              ? "仍要导出全部 ZIP"
              : "导出全部 ZIP"}
      </button>
      {exporting && (
        <button
          type="button"
          className="button"
          onClick={cancelFromUi}
          disabled={Boolean(abortRef.current?.signal.aborted)}
        >
          {abortRef.current?.signal.aborted ? "正在取消导出" : "取消导出"}
        </button>
      )}
    </div>
  );
}
