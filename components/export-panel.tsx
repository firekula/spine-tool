import { Download, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { AtlasDocument } from "@/lib/atlas/types";
import { exportAllRegions } from "@/lib/export/export-zip";
import type { ScaleInference } from "@/lib/spine/scale-inference";

export interface ExportPanelProps {
  atlas: AtlasDocument | null;
  textures: Map<string, ImageBitmap> | null;
  inferredScale: ScaleInference;
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

export function ExportPanel({ atlas, textures, inferredScale }: ExportPanelProps) {
  const [globalValue, setGlobalValue] = useState("1");
  const [overrideValues, setOverrideValues] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const exporting = progress !== null;
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
  const canExport = Boolean(atlas && textures && !globalError && overrideErrors.size === 0 && !exporting);
  const overrides = useMemo(() => {
    const values = new Map<string, number>();
    for (const [key, value] of overrideValues) {
      if (!value.trim()) continue;
      const multiplier = Number(value);
      if (Number.isFinite(multiplier) && multiplier > 0) values.set(key, multiplier);
    }
    return values;
  }, [overrideValues]);

  const updateOverride = (key: string, value: string) => {
    setOverrideValues((current) => {
      const next = new Map(current);
      next.set(key, value);
      return next;
    });
  };

  const startExport = async () => {
    if (!atlas || !textures || !canExport) return;
    setNotice(null);
    setProgress({ done: 0, total: atlas.regions.length });
    try {
      const blob = await exportAllRegions({
        atlas,
        textures,
        inferredScale,
        globalMultiplier,
        regionOverrides: overrides,
      }, (done, total) => setProgress({ done, total }));
      downloadZip(blob);
      setNotice("ZIP 已生成；其中包含 PNG 和 export-report.json。请查看报告中的跳过或失败项。");
    } catch (error) {
      setNotice(`导出失败：${error instanceof Error ? error.message : "无法生成 ZIP。"}`);
    } finally {
      setProgress(null);
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
          onChange={(event) => setGlobalValue(event.target.value)}
          disabled={exporting}
        />
        {globalError && <span className="export-field-error" id="global-multiplier-error">全局倍率必须是大于 0 的有限数值。</span>}
      </label>

      <section className="export-region-list" aria-label="Region 单项倍率覆盖">
        <h3>Region（{atlas.regions.length}）</h3>
        {atlas.regions.map((region) => {
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
      </section>

      {progress && <p className="export-progress" role="status">已处理 {progress.done} / {progress.total}</p>}
      {notice && <p className="export-notice" role="status">{notice}</p>}
      <button type="button" className="button button-primary" disabled={!canExport} onClick={startExport}>
        <Download size={18} aria-hidden="true" /> {exporting ? "正在导出 ZIP" : inferredScale.confidence === "low" ? "仍要导出全部 ZIP" : "导出全部 ZIP"}
      </button>
    </div>
  );
}
