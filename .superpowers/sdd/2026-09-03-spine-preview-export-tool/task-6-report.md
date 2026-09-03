# Task 6 实现报告：预览、动画、皮肤和插槽控制

## 结果

- `WorkspaceShell` 已将导入、版本检测、Runtime 创建、元数据初始化和所有预览控制接入统一 reducer。
- 动画、皮肤、插槽、播放与 seek 操作先 dispatch 稳定 action，再由 effect 同步 `SpineRuntimeBridge`；切换动画会重新应用隐藏插槽集合。
- `PreviewCanvas` 只有一条 RAF 链，按 `ResizeObserver` 和 DPR resize；支持拖动、以指针为中心缩放、基于 `SkeletonMetadata.regionAttachments` 逻辑边界适配、重置视角和三种背景。
- Canvas 在 bridge 更换或真实卸载后释放；可取消的微任务清理和缓存的 load Promise 避免 React StrictMode 探测阶段提前 dispose 或重复 load。
- 左侧面板提供动画搜索、单一/组合皮肤和插槽搜索/批量操作；底栏提供播放、暂停、循环、完整速度档位和拖动 seek。
- 小于 1100px 时左右栏为可切换抽屉，关闭态设置 `aria-hidden` 和 `inert`，支持显式关闭与 Escape；Canvas 保持至少 480px 高度，导出入口仍可通过导出抽屉访问。
- 未修改 `SpineRuntimeBridge`、`SkeletonMetadata` 或 runtime playback snapshot 实现；账本中的非循环完成态 minor 保持 deferred。

## TDD 记录

1. RED：`npm test -- tests/unit/workspace-controls.test.tsx` 因 `@/components/preview-canvas` 不存在而失败。
2. GREEN：控制面板、store/bridge 同步和 Canvas 生命周期实现后，7 个聚焦用例通过。
3. 回归 RED：加入 StrictMode 生命周期用例，确认旧实现会在 effect 探测阶段错误调用 `dispose()`。
4. 回归 GREEN：加入可取消释放和 load Promise 去重后，8 个聚焦用例通过。

覆盖项包括：动画搜索与选择、跨动画的隐藏插槽、单一/组合皮肤、插槽批量操作、播放/循环/速度/seek、RAF/resize/DPR/dispose、拖动/缩放/适配及 StrictMode 生命周期。

## 验证

- `npm test -- tests/unit/workspace-controls.test.tsx`：8/8 通过。
- `npm test`：8 个测试文件、62 个测试全部通过。
- `npm run build`：通过，四个 Runtime 保持独立 chunk。
- `npm run build:offline`：通过，离线产物生成成功。
- `git diff --check`：通过。

## 依赖与配置

- 增加 `@testing-library/react`、`@testing-library/user-event` 与 `jsdom` 作为交互测试 devDependencies。
- Vitest 仅为 `*.test.tsx` 使用 jsdom；既有 `*.test.ts` 继续使用 Node 环境。
