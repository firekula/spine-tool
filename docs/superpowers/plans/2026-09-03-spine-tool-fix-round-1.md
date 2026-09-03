# Spine Tool Fix Round 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复导出/导入并发资源安全、分类卸载、附件真实路径、结构化 Region 错误、四版本官方 fixture 覆盖和非循环播放结束状态。

**Architecture:** `ExportResources` 成为引用计数所有者，通过租约让旧位图延迟到活跃导出退出后关闭；`ExportPanel` 和 `exportAllRegions` 共享 AbortSignal 与 generation guard，所有迟到副作用受同一代际控制。Runtime 元数据在共同 factory 中从 RegionAttachment 自身解析 Atlas 路径，导出返回 blob、report 与结构化 issues，E2E 使用固定官方 commit 的 spineboy essential JSON/SKEL/Atlas/PNG。

**Tech Stack:** TypeScript 5.7、React 18、Vitest、Playwright、JSZip、Spine WebGL 3.8/4.0/4.1/4.2。

**Spec:** `.superpowers/sdd/2026-09-03-spine-preview-export-tool/task-9-brief.md` 与父任务 Fix Round 1 指令。

## Global Constraints

- 严格 TDD：每项生产行为先写测试并观察预期失败。
- 不派生子代理，不接触 Sites。
- Runtime 失败时 Atlas 导出仍可用；重新导入/卸载不得泄漏或提前关闭在用资源。
- 所有 UI 结构化错误必须有中文标题、对象、原因和可操作建议。
- 官方 fixture 必须记录固定 revision、原始路径、URL、SHA-256 与许可证来源。

---

### Task 1: 可租赁导出资源

**Files:**
- Modify: `lib/files/import-workflow.ts`
- Modify: `tests/unit/import-workflow.test.ts`

**Interfaces:**
- Produces: `ExportResources.acquire(): ExportResourceLease`；owner `release()` 后仅在 lease 数为零时关闭位图。

- [ ] 写测试：持有租约时 owner release 不关闭；最后 lease release 关闭且所有 release 幂等。
- [ ] 运行 `npx vitest run tests/unit/import-workflow.test.ts`，确认因 `acquire` 缺失失败。
- [ ] 实现最小引用计数资源所有者。
- [ ] 重新运行聚焦测试并确认通过。

### Task 2: 导出取消与迟到副作用抑制

**Files:**
- Modify: `lib/export/export-zip.ts`
- Modify: `components/export-panel.tsx`
- Modify: `components/workspace-shell.tsx`
- Modify: `tests/unit/export-zip.test.ts`
- Create: `tests/unit/workspace-export-race.test.tsx`

**Interfaces:**
- `exportAllRegions(input, onProgress, { signal? }) -> Promise<ExportAllResult>`。
- `ExportAllResult { blob, report, issues }`。
- `ExportPanel` 从 `ExportResources.acquire()` 获得租约，atlas 变化/卸载时 abort；generation 不匹配时不 progress、不 issue、不 download。

- [ ] 写 abort 测试：第一项 progress 后取消，第二项不得执行且 promise 以 AbortError 结束。
- [ ] 写 200 Region 工作台竞态测试：旧导出启动后导入新项目，旧下载、通知和问题不得出现，旧位图在导出退出后才关闭。
- [ ] 运行两个聚焦测试，确认当前实现失败。
- [ ] 实现 signal 检查、结果类型、panel generation/mounted guard 和 shell 资源传递。
- [ ] 重新运行聚焦测试并确认通过。

### Task 3: Dropzone classification 卸载保护

**Files:**
- Modify: `components/import-dropzone.tsx`
- Create: `tests/unit/import-dropzone.test.tsx`

**Interfaces:**
- Dropzone 用 `mountedRef` 与 `generationRef` 标识每次分类；卸载增加 generation，迟到结果不调用 `onImport`/`onError`/setState。

- [ ] 写 deferred `atlasFile.text()` 测试，分类期间卸载后 resolve，断言不调用 onImport 且工作流资源工厂不启动。
- [ ] 运行聚焦测试，确认迟到 onImport 失败。
- [ ] 实现 generation/mounted guard。
- [ ] 重新运行聚焦测试并确认通过。

### Task 4: RegionAttachment 真实 Atlas 路径

**Files:**
- Modify: `lib/spine/runtime-factory.ts`
- Modify: `tests/unit/runtime-loader.test.ts`
- Modify: `tests/unit/workspace-import.test.tsx`

**Interfaces:**
- `RuntimeRegionAttachment` 支持 `path?: string`、`region?: { name?: string }`；元数据 name 优先 `path`，其次 `region.name`，不回退到 skin attachment key，缺失真实路径则忽略倍率样本条目。

- [ ] 写四版本参数测试：attachment key 为 alias、path 或 region.name 为 Atlas 名，metadata.name 必须是 Atlas 名。
- [ ] 写工作台倍率测试：alias key 不影响匹配，界面产生有效样本。
- [ ] 运行聚焦测试，确认 metadata 仍返回 alias 而失败。
- [ ] 实现共同 factory 路径提取并运行测试。

### Task 5: Region 结构化 warning 与准确摘要

**Files:**
- Modify: `lib/export/export-zip.ts`
- Modify: `components/export-panel.tsx`
- Modify: `lib/ui/messages.ts`
- Modify: `tests/unit/export-zip.test.ts`
- Modify: `tests/unit/export-panel.test.tsx`

**Interfaces:**
- 每个 failed/skipped report 生成 `AppIssue`；越界错误 code 为 `REGION_OUT_OF_BOUNDS`，其他为 `REGION_EXPORT_FAILED`/`MISSING_TEXTURE_PAGE`。
- 成功提示使用 report.summary 明确显示成功、跳过、失败数。

- [ ] 写结果结构与越界 issue 测试；写 panel 中文 warning/准确计数测试。
- [ ] 运行并确认旧 Blob API/泛化成功提示导致失败。
- [ ] 实现 issue 分类与摘要 UI；补齐中文映射。
- [ ] 重新运行聚焦测试并确认通过。

### Task 6: 非循环播放完成态

**Files:**
- Modify: `lib/spine/runtime-factory.ts`
- Modify: `tests/unit/runtime-loader.test.ts`

**Interfaces:**
- 非循环 entry 的 snapshot `time = min(trackTime, duration)`；达到 duration 后 `playing = false`。

- [ ] 写超出 duration 的失败测试。
- [ ] 修改 snapshot 并运行聚焦测试确认通过。

### Task 7: 固定官方四版本 JSON/SKEL E2E

**Files:**
- Create: `tests/fixtures/official-spine/<version>/...`
- Create: `tests/fixtures/official-spine/SOURCES.json`
- Create: `tests/e2e/official-runtime-fixtures.spec.ts`
- Modify: `tests/e2e/fixtures.ts`

**Interfaces:**
- 每版本 fixture 包含同一固定 EsotericSoftware/spine-runtimes revision 的 `spineboy-ess.json`、`spineboy-ess.skel`、`spineboy-pma.atlas`、`spineboy-pma.png`。

- [ ] 先写 fixture 加载 E2E 并确认文件缺失失败。
- [ ] 从官方固定 commit 下载文件，计算并记录 SHA-256、Git blob 与许可 URL。
- [ ] 对 3.8/4.0/4.1/4.2 分别执行 JSON、SKEL bridge load，均收集 console/page errors。
- [ ] 至少让一条官方 metadata→scale→ZIP 链解压并核对成功计数与文件。
- [ ] 运行聚焦 E2E 并确认通过。

### Task 8: 完整验证、报告和提交

**Files:**
- Modify: `.superpowers/sdd/2026-09-03-spine-preview-export-tool/task-9-report.md`（ignored 工作报告）

- [ ] 运行 `npm test`、`npx playwright test`、`npm run build`、`npm run build:offline`、`npm run verify-runtime-assets`、`git diff --check`。
- [ ] 对照 Fix Round 1 五项与 non-loop deferred 逐项自查。
- [ ] 在原报告追加 `Fix Round 1`，列出测试文件、命令输出与官方来源。
- [ ] 提交 `fix: harden Spine workflow integration`，保留工作树给父任务集成。
