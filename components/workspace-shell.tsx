import {
  Download,
  FileUp,
  Pause,
  Play,
  RotateCcw,
  Settings2,
} from "lucide-react";

export function WorkspaceShell() {
  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Spine 本地工具</p>
          <h1>动画预览与 Atlas 子图导出</h1>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="button button-primary">
            <FileUp size={18} aria-hidden="true" /> 导入文件
          </button>
          <button type="button" className="button">
            <RotateCcw size={18} aria-hidden="true" /> 重新导入
          </button>
          <span className="status">等待导入</span>
        </div>
      </header>

      <aside className="sidebar control-panel" aria-label="动画控制">
        <div className="panel-heading">
          <h2>控制</h2>
          <Settings2 size={18} aria-hidden="true" />
        </div>
        <div className="tabs" role="tablist" aria-label="控制类别">
          <button type="button" role="tab" aria-selected="true">动画</button>
          <button type="button" role="tab" aria-selected="false">皮肤</button>
          <button type="button" role="tab" aria-selected="false">插槽</button>
        </div>
        <p className="empty-copy">导入 Spine 文件后即可查看可用控制项。</p>
      </aside>

      <section className="preview-panel" aria-label="动画预览">
        <div className="preview-empty">
          <FileUp size={42} aria-hidden="true" />
          <h2>尚未导入 Spine 文件</h2>
          <p>选择 Atlas、JSON 或 SKEL 以及对应 PNG 纹理页，所有文件仅在本地处理。</p>
          <button type="button" className="button button-primary">
            <FileUp size={18} aria-hidden="true" /> 选择文件
          </button>
        </div>
      </section>

      <aside className="sidebar export-panel" aria-label="Atlas 导出">
        <div className="panel-heading">
          <h2>Atlas 导出</h2>
          <Download size={18} aria-hidden="true" />
        </div>
        <p className="empty-copy">导入后将在这里列出 Region 和恢复倍率。</p>
        <button type="button" className="button" disabled>
          <Download size={18} aria-hidden="true" /> 导出全部 ZIP
        </button>
      </aside>

      <footer className="playback-bar" aria-label="播放控制">
        <button type="button" className="icon-button" aria-label="播放" disabled>
          <Play size={18} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="暂停" disabled>
          <Pause size={18} aria-hidden="true" />
        </button>
        <label>
          速度
          <select defaultValue="1" disabled>
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </label>
        <span>0:00 / 0:00</span>
        <input aria-label="动画进度" type="range" min="0" max="100" value="0" disabled readOnly />
      </footer>
    </main>
  );
}
