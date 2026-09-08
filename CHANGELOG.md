# 更新记录

本文件记录工具的重要变更，日期为提交日期。

## 未发布

### 修复

- 修复导入在部分旧版 Chromium 内核中必然失败的问题（2026-09-08）。这些内核缺少 `AbortSignal.prototype.throwIfAborted`，导入流程在解析任何文件之前就会抛出 `o.throwIfAborted is not a function`，界面表现为 `IMPORT_FAILED`、错误对象为所选 `.atlas`。导入改为使用与 `restore-region`、`export-zip` 一致的 `signal.aborted` 本地检查，不再依赖该较新 API；该问题与 Spine 版本无关，修复后 `3.8.75` 等素材可在 Chromium 约 87 及以上的内核中正常识别与导入。
- 同步重建离线包并更新 `scripts/offline-assets.json` 与 `scripts/offline-runtime-audit.mjs` 中的固定 SHA-256（主 chunk 变化会级联改变引用它的 Runtime chunk 与 `index.html`），`ready-to-run` 内容已与清单逐字节核对。

### 文档

- README 补充浏览器兼容性说明与更新记录入口。

## 历史

- 2026-09-07：修复 `Start-Offline.ps1` 的 UTF-8 BOM，兼容 Windows PowerShell 5.1 解析中文脚本；恢复最终交付快照并纳入离线分发包。
- 2026-09-04：补充 Spine 3.5–4.3 支持文档；加固离线压缩包路径遍历防护；固定离线运行时产物与哈希门禁。
- 更早：接入 Spine 3.5–4.3 工作流，新增 3.5–3.7 JSON、3.8/4.0–4.3 JSON 与 SKEL 支持，并加固 Spine 4.3 集成。
