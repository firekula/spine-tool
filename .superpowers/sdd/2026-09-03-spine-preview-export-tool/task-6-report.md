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

## Fix Round 1

### 修复内容

- 扩展 `SpineRuntimeBridge`：
  - `getBounds()` 从当前 Runtime Skeleton 的 `getBounds(offset, size)` 返回带位置的整体世界坐标边界；无效或空边界返回 `null`。
  - `setView({ centerX, centerY, zoom })` 更新 Runtime OrthoCamera 的位置和 zoom 并调用 `camera.update()`；UI zoom 定义为视觉放大倍率，Runtime camera 使用其倒数。
  - `setLoop(loop)` 原位修改当前 TrackEntry 的 `loop`，不调用 `setAnimation`，因此不改变 track time 或 paused 状态。
- `PreviewCanvas` 移除 Canvas CSS transform。拖动、指针中心缩放、整体 bounds 适配、重置均改为精确 view 数值并通过 Bridge 驱动 Runtime 投影；DPR backing store resize 流程保持不变。
- `getBounds()` 使用带 `set(x, y)` 的轻量 mutable vector，匹配 Spine 3.8–4.2 的真实 `Vector2` 调用契约，避免普通对象在真实 Runtime 中失败。
- 预览交互区域增加 `role="region"`、可访问名称、`tabIndex=0` 和 `aria-keyshortcuts`；方向键平移、`+`/`-` 缩放、`Home` 适配、`0` 重置与鼠标行为共用同一 view 状态。
- `WorkspaceShell` 将动画选择和 loop 同步拆开：只有动画名称变化才调用 `play()`，loop 变化只调用 `setLoop()`。

### RED / GREEN

- 修改 `tests/unit/workspace-controls.test.tsx`：把旧的静态 transform 字符串断言拆为精确的 pointer pan、指针中心 wheel zoom、真实 bounds fit 和键盘等价调用断言；增加“暂停并 seek 后切 loop 不调用 play”覆盖。删除任一对应事件处理器都会使调用参数或调用次数断言失败。
- 修改 `tests/unit/runtime-loader.test.ts`：增加真实 Skeleton bounds、TrackEntry 原位 loop、camera center/zoom 和 DPR backing store 联合覆盖。
- RED：`npm test -- tests/unit/workspace-controls.test.tsx tests/unit/runtime-loader.test.ts` 得到 6 个预期失败，分别为旧 loop 重播、缺失 `getBounds/setView`、pointer/wheel 未同步和预览区域不可聚焦。
- GREEN：同一 covering 命令 32/32 通过。
- 真实 Runtime 源码契约复核后进一步收紧 bounds harness；聚焦 RED 为 `offset.set is not a function`，改用兼容 mutable vector 后该回归用例转绿。

### 最终验证

- `npm test`：8 个测试文件、66 个测试全部通过。
- `npm run build`：通过，四个 Runtime 动态 chunk 保持分离。
- `npm run build:offline`：通过，离线产物生成成功。
- `npm run verify-runtime-assets`：通过，输出 `Verified 4 isolated Spine runtimes`，三份 npm tarball SHA-256 与 3.8 vendor 资产验证均通过。
- `git diff --check`：通过。
