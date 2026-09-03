# Spine 动画预览与图集子图导出工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个全中文、纯浏览器运行的 Spine 3.8–4.2 动画预览和 Atlas 原始尺寸 PNG 批量恢复工具，同时交付部署网站与断网可用离线包。

**Architecture:** React/TypeScript 客户端负责文件导入、控制面板和导出工作流；独立领域模块负责 Atlas 解析、版本检测、倍率推算和像素恢复；四个隔离的 Runtime Bridge 统一封装 Spine 3.8、4.0、4.1、4.2 WebGL Runtime。所有文件只保存在浏览器内存中，ZIP 在客户端生成。

**Tech Stack:** React、TypeScript、Vite/Vinext Sites starter、Vitest、Playwright、JSZip、官方 `@esotericsoftware/spine-webgl` 版本化 Runtime、Lucide 图标。

**Spec:** `docs/superpowers/specs/2026-09-03-spine-preview-export-tool-design.md`

## Global Constraints

- 明确支持 Spine 3.8、4.0、4.1、4.2，JSON 与 SKEL 都必须由匹配的大版本 Runtime 加载。
- 每次导入恰好一个 `.atlas`、一个 `.json` 或 `.skel`，以及一张或多张 `.png`。
- 单页、多页 Atlas 都必须按页文件名匹配，用户文件不得上传服务器。
- 所有界面、错误和导出报告使用中文；Spine、Runtime、Atlas、Region、JSON、SKEL、PNG、ZIP、WebGL 等专有名词保留英文。
- 子图必须反向恢复 Atlas 旋转、被裁剪的透明边距和最终逻辑尺寸。
- 缩放恢复采用自动推算、置信度说明、全局手动倍率和单 Region 覆盖。
- ZIP 必须包含全部有效 PNG 和 `export-report.json`，并安全保留 Region 目录结构。
- 网站版和离线版必须使用同一套业务代码；离线包断网可运行。
- 页面必须显示 Spine Runtime 授权提醒，并保留官方 Runtime 要求的版权与许可文件。

## Planned File Structure

```text
app/
  page.tsx                         页面入口与应用壳
  spine-app.tsx                    网站版与离线版共享的客户端根组件
  globals.css                      全局主题、布局和响应式样式
components/
  import-dropzone.tsx              文件选择、拖放和组成提示
  workspace-shell.tsx              五区域工作台布局及状态编排
  preview-canvas.tsx               Canvas 生命周期、视图交互
  animation-panel.tsx              动画搜索与选择
  skin-panel.tsx                   单皮肤和组合皮肤控制
  slot-panel.tsx                   插槽搜索和批量可见性
  playback-bar.tsx                 播放、循环、速度和时间拖动
  export-panel.tsx                 Region、倍率、警告与 ZIP 导出
  status-center.tsx                阻断错误和非阻断警告
lib/files/
  import-files.ts                  文件分类、名称标准化和纹理匹配
lib/atlas/
  types.ts                         AtlasPage、AtlasRegion 等稳定类型
  parse-atlas.ts                   3.8–4.2 文本 Atlas 解析
  restore-math.ts                  旋转、裁切、透明边距的纯数学计算
  restore-region.ts                Canvas 像素恢复和 PNG Blob 生成
lib/spine/
  version.ts                       JSON/SKEL 版本识别及支持判断
  bridge-types.ts                  Runtime Bridge 消息和统一模型
  runtime-loader.ts                按版本懒加载唯一 Runtime Bridge
  runtime-3_8.ts                   Spine 3.8 适配器
  runtime-4_0.ts                   Spine 4.0 适配器
  runtime-4_1.ts                   Spine 4.1 适配器
  runtime-4_2.ts                   Spine 4.2 适配器
  runtime-factory.ts               四版本共享的适配器构造逻辑
  scale-inference.ts               附件尺寸采样、离群值过滤和置信度
lib/export/
  safe-path.ts                     ZIP 路径清理和确定性重名
  export-zip.ts                    PNG 队列、报告与 ZIP 生成
lib/state/
  workspace-store.ts               导入、预览、可见性和导出状态
lib/issues/
  types.ts                         AppIssue 结构化错误基础类型
lib/ui/
  messages.ts                      中文错误代码与建议
tests/unit/                         纯函数和状态单元测试
tests/fixtures/                     人工构造的小型 Atlas/骨骼元数据
tests/e2e/                          浏览器导入、控制和导出测试
scripts/
  verify-runtime-assets.mjs        校验四版本 Runtime 与许可文件
  package-offline.mjs              生成离线 ZIP
public/licenses/                   Spine Runtime 许可与版权文件
offline/
  index.html                       离线构建入口
  main.tsx                         挂载共享 SpineApp
vite.offline.config.ts             生成完全本地化的离线静态资源
docs/runtime-versions.md           锁定版本、来源和兼容说明
```

---

### Task 1: 建立可测试的客户端项目骨架

**Files:**
- Create: `app/page.tsx`
- Create: `app/spine-app.tsx`
- Create: `app/globals.css`
- Create: `components/workspace-shell.tsx`
- Create: `lib/state/workspace-store.ts`
- Create: `lib/issues/types.ts`
- Create: `offline/index.html`
- Create: `offline/main.tsx`
- Create: `vite.offline.config.ts`
- Create: `vitest.config.ts`
- Create: `tests/unit/workspace-store.test.ts`
- Modify: `package.json`
- Modify: `.openai/hosting.json`

**Interfaces:**
- Consumes: 设计文档中的五区域布局和本地处理约束。
- Produces: `AppIssue`、`WorkspaceState`、`createInitialWorkspaceState()`、`workspaceReducer()`，以及网站/离线共享的 `SpineApp`，供所有后续组件使用。

- [ ] **Step 1: 用 Sites starter 初始化项目并保留已确认文档**

在当前 Site checkout 使用官方项目初始化脚本，只初始化一次。保留 `docs/superpowers/**`，确认 `.openai/hosting.json` 存在且尚未写入虚构 `project_id`。

- [ ] **Step 2: 写状态模型的失败测试**

```ts
it("重新导入会清除旧预览状态但保留播放速度", () => {
  const before = { ...createInitialWorkspaceState(), speed: 1.5, selectedAnimation: "walk" };
  const after = workspaceReducer(before, { type: "IMPORT_STARTED" });
  expect(after.speed).toBe(1.5);
  expect(after.selectedAnimation).toBeNull();
  expect(after.phase).toBe("loading");
});
```

- [ ] **Step 3: 运行测试并确认因状态模块不存在而失败**

Run: `npm test -- tests/unit/workspace-store.test.ts`

Expected: FAIL，提示无法解析 `lib/state/workspace-store`。

- [ ] **Step 4: 实现最小状态模型与应用壳**

```ts
export type WorkspacePhase = "empty" | "loading" | "ready" | "error";
export interface AppIssue {
  code: string;
  severity: "warning" | "error";
  subject?: string;
  details?: string[];
}
export interface WorkspaceState {
  phase: WorkspacePhase;
  speed: number;
  selectedAnimation: string | null;
  hiddenSlots: Set<string>;
  warnings: AppIssue[];
}
export function createInitialWorkspaceState(): WorkspaceState;
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState;
```

页面先渲染顶部栏、左右栏、中央预览区和底部播放栏的空状态，所有按钮使用真实中文标签，图标使用 Lucide，不用 Unicode 符号模拟图标。

`app/page.tsx` 和 `offline/main.tsx` 都只挂载 `app/spine-app.tsx`；`vite.offline.config.ts` 以 `offline/index.html` 为入口并把输出写入 `dist-offline`。在 `package.json` 固定依赖 `@esotericsoftware/spine-webgl` 的版本化 alias、`jszip` 与 `lucide-react`，增加 `test`、`build`、`build:offline` 脚本。

- [ ] **Step 5: 验证基础项目**

Run: `npm test -- tests/unit/workspace-store.test.ts && npm run build && npm run build:offline`

Expected: 单元测试通过，生产构建成功且无 TypeScript 错误。

- [ ] **Step 6: 提交**

```bash
git add app components lib/state lib/issues offline vite.offline.config.ts tests/unit vitest.config.ts package.json package-lock.json .openai/hosting.json
git commit -m "feat: scaffold Spine workspace"
```

---

### Task 2: 实现文件分类和多页纹理匹配

**Files:**
- Create: `lib/files/import-files.ts`
- Create: `tests/unit/import-files.test.ts`
- Create: `components/import-dropzone.tsx`

**Interfaces:**
- Consumes: 浏览器 `File[]`。
- Produces: `classifyImport(files: File[]): Promise<ImportBundle>`；`ImportBundle` 包含 `atlasText`、`skeletonFile`、`textureFiles: Map<string, File>`、`unusedTextures`。

- [ ] **Step 1: 写文件校验失败测试**

```ts
it("报告 Atlas 声明但未选择的纹理页", async () => {
  const files = [file("hero.atlas", "page-a.png\nsize: 16,16\n\npage-b.png\nsize: 16,16"), file("hero.json", "{}"), png("page-a.png")];
  await expect(classifyImport(files)).rejects.toMatchObject({ code: "MISSING_TEXTURE_PAGES", details: ["page-b.png"] });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/unit/import-files.test.ts`

Expected: FAIL，提示 `classifyImport` 未定义。

- [ ] **Step 3: 实现文件分类和名称规则**

实现以下签名：

```ts
export interface ImportBundle {
  atlasFile: File;
  atlasText: string;
  skeletonFile: File;
  skeletonKind: "json" | "skel";
  textureFiles: Map<string, File>;
  unusedTextures: string[];
}
export async function classifyImport(files: File[]): Promise<ImportBundle>;
```

匹配时统一反斜杠为 `/`，先精确匹配完整 Atlas 页名，再使用 basename；basename 发生歧义时返回 `AMBIGUOUS_TEXTURE_PAGE`，不得猜测。

- [ ] **Step 4: 完成导入区**

支持点击选择和拖放；显示已识别的 Atlas、骨骼文件、PNG 数量和缺失页；导入期间禁用重复提交，并注明“文件仅在本地处理”。

- [ ] **Step 5: 运行测试与构建**

Run: `npm test -- tests/unit/import-files.test.ts && npm run build`

Expected: 文件匹配测试全部通过，构建成功。

- [ ] **Step 6: 提交**

```bash
git add lib/files components/import-dropzone.tsx tests/unit/import-files.test.ts
git commit -m "feat: validate Spine import bundles"
```

---

### Task 3: 解析旧版与新版 Atlas

**Files:**
- Create: `lib/atlas/types.ts`
- Create: `lib/atlas/parse-atlas.ts`
- Create: `tests/fixtures/atlas-old.atlas`
- Create: `tests/fixtures/atlas-new.atlas`
- Create: `tests/unit/parse-atlas.test.ts`

**Interfaces:**
- Consumes: `parseAtlas(text: string): AtlasDocument`。
- Produces: 标准化的 `AtlasDocument { pages, regions }`，Region 统一为左下偏移、原始宽高、打包宽高和顺时针角度。

- [ ] **Step 1: 写新旧字段的失败测试**

```ts
it.each([
  [oldAtlas, { x: 4, y: 8, packedWidth: 12, packedHeight: 20, originalWidth: 32, originalHeight: 40, offsetLeft: 3, offsetBottom: 5, rotation: 90 }],
  [newAtlas, { x: 4, y: 8, packedWidth: 12, packedHeight: 20, originalWidth: 32, originalHeight: 40, offsetLeft: 3, offsetBottom: 5, rotation: 90 }],
])("把 Atlas 字段标准化", (source, expected) => {
  expect(parseAtlas(source).regions[0]).toMatchObject(expected);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/unit/parse-atlas.test.ts`

Expected: FAIL，提示解析模块不存在。

- [ ] **Step 3: 实现行解析状态机**

```ts
export interface AtlasRegion {
  name: string;
  pageName: string;
  index: number;
  x: number;
  y: number;
  packedWidth: number;
  packedHeight: number;
  originalWidth: number;
  originalHeight: number;
  offsetLeft: number;
  offsetBottom: number;
  rotation: number;
  custom: Record<string, string>;
}
export function parseAtlas(text: string): AtlasDocument;
```

识别 `xy + size`、`bounds`、`orig + offset`、`offsets`、`rotate: true/false/角度`；未知键存入 `custom`。页边界以空行和下一页属性结构共同判断，不能把 Region 名误识别为页名。

- [ ] **Step 4: 增加错误位置测试**

断言负尺寸、缺页、重复页和不完整 Region 返回包含行号、Region 名称及中文建议的 `AtlasParseError`。

- [ ] **Step 5: 验证**

Run: `npm test -- tests/unit/parse-atlas.test.ts`

Expected: 旧版、新版、多页和错误输入用例全部通过。

- [ ] **Step 6: 提交**

```bash
git add lib/atlas tests/fixtures tests/unit/parse-atlas.test.ts
git commit -m "feat: parse Spine atlas variants"
```

---

### Task 4: 检测 JSON 与 SKEL 版本

**Files:**
- Create: `lib/spine/version.ts`
- Create: `tests/unit/spine-version.test.ts`

**Interfaces:**
- Consumes: `detectSpineVersion(file: File): Promise<DetectedSpineVersion>`。
- Produces: `{ raw, majorMinor, source, supported }`，支持值限定为 `"3.8" | "4.0" | "4.1" | "4.2"`。

- [ ] **Step 1: 写 JSON 和 SKEL 头部失败测试**

```ts
it("读取 JSON skeleton.spine", async () => {
  expect(await detectSpineVersion(file("hero.json", '{"skeleton":{"spine":"4.1.24"}}'))).toMatchObject({ majorMinor: "4.1", supported: true });
});

it("读取 SKEL 的版本字符串", async () => {
  expect(await detectSpineVersion(binaryFile("hero.skel", skelHeader("3.8.99")))).toMatchObject({ majorMinor: "3.8", source: "skel-header" });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/unit/spine-version.test.ts`

Expected: FAIL，提示版本检测模块不存在。

- [ ] **Step 3: 实现有界二进制头部读取**

JSON 只解析一次并校验 `skeleton.spine`。SKEL 最多读取前 256 bytes，按 Spine Binary 格式跳过 hash 字符串后读取 version 字符串；同时提供受控 ASCII 扫描作为损坏头部的低置信度回退。

```ts
export type SupportedSpineVersion = "3.8" | "4.0" | "4.1" | "4.2";
export interface DetectedSpineVersion {
  raw: string | null;
  majorMinor: SupportedSpineVersion | null;
  source: "json-field" | "skel-header" | "ascii-fallback" | "unknown";
  supported: boolean;
}
```

- [ ] **Step 4: 测试范围外和损坏数据**

加入 3.7、4.3、无版本字段、超长 varint 和截断 SKEL，用例必须返回结构化结果或中文 `INVALID_SKEL_HEADER`，不得无限读取。

- [ ] **Step 5: 验证并提交**

Run: `npm test -- tests/unit/spine-version.test.ts`

```bash
git add lib/spine/version.ts tests/unit/spine-version.test.ts
git commit -m "feat: detect Spine JSON and SKEL versions"
```

---

### Task 5: 接入四个隔离 Runtime Bridge

**Files:**
- Create: `lib/spine/bridge-types.ts`
- Create: `lib/spine/runtime-factory.ts`
- Create: `lib/spine/runtime-loader.ts`
- Create: `lib/spine/runtime-3_8.ts`
- Create: `lib/spine/runtime-4_0.ts`
- Create: `lib/spine/runtime-4_1.ts`
- Create: `lib/spine/runtime-4_2.ts`
- Create: `scripts/verify-runtime-assets.mjs`
- Create: `docs/runtime-versions.md`
- Create: `public/licenses/SPINE-RUNTIMES-LICENSE.txt`
- Create: `tests/unit/runtime-loader.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RuntimeLoadInput`，包含 Atlas 文本、JSON 文本或 SKEL bytes、纹理对象 URL 和 Canvas。
- Produces: `SpineRuntimeBridge`，供预览和元数据模块使用。

- [ ] **Step 1: 锁定官方 Runtime 版本与许可**

锁定 `@esotericsoftware/spine-webgl` Runtime 为 `3.8.99`、`4.0.64`、`4.1.24`、`4.2.118`；安装前用 npm 元数据和官方 runtime tag 验证这四个精确版本，任一版本不存在时停止并记录阻断原因，不用近似版本静默替代。在 `docs/runtime-versions.md` 记录每个 package version、对应 Spine Editor 大版本、官方来源 URL 和 SHA-256；依赖使用 npm alias，确保四个版本不会共享错误的 `spine-core`。复制官方许可原文到 `public/licenses`，不要改写法律文本。

- [ ] **Step 2: 写 Runtime 路由失败测试**

```ts
it.each(["3.8", "4.0", "4.1", "4.2"] as const)("为 %s 只加载对应模块", async version => {
  const module = await loadRuntimeModule(version);
  expect(module.version).toBe(version);
  expect(module.createBridge).toEqual(expect.any(Function));
});
```

- [ ] **Step 3: 定义统一接口**

```ts
export interface SpineRuntimeBridge {
  readonly version: SupportedSpineVersion;
  load(input: RuntimeLoadInput): Promise<SkeletonMetadata>;
  play(name: string, loop: boolean): void;
  pause(paused: boolean): void;
  seek(seconds: number): void;
  setSpeed(speed: number): void;
  setSkins(names: string[]): void;
  setHiddenSlots(names: ReadonlySet<string>): void;
  resize(width: number, height: number, dpr: number): void;
  frame(deltaSeconds: number): PlaybackSnapshot;
  dispose(): void;
}
```

`SkeletonMetadata` 返回动画名称与时长、皮肤、插槽以及 Region 附件的逻辑宽高样本。

- [ ] **Step 4: 用共享工厂实现版本差异**

每个 `runtime-X_Y.ts` 只能导入对应 alias。共享工厂接收该版本导出的构造器集合，封装 Atlas/纹理加载、JSON/SKEL reader、SkeletonRenderer、AnimationState 和资源释放。隐藏插槽必须在 `AnimationState.apply` 后把 attachment 暂时置空；下一帧先由动画重新应用，再执行隐藏集合。

- [ ] **Step 5: 校验版本隔离和许可资产**

Run: `node scripts/verify-runtime-assets.mjs && npm test -- tests/unit/runtime-loader.test.ts && npm run build`

Expected: 四个 Runtime chunk 均存在、版本号符合声明、没有跨版本 core 导入、许可文件存在，构建通过。

- [ ] **Step 6: 提交**

```bash
git add lib/spine scripts/verify-runtime-assets.mjs docs/runtime-versions.md public/licenses package.json package-lock.json tests/unit/runtime-loader.test.ts
git commit -m "feat: add isolated Spine runtime bridges"
```

---

### Task 6: 实现预览、动画、皮肤和插槽控制

**Files:**
- Create: `components/preview-canvas.tsx`
- Create: `components/animation-panel.tsx`
- Create: `components/skin-panel.tsx`
- Create: `components/slot-panel.tsx`
- Create: `components/playback-bar.tsx`
- Create: `tests/unit/workspace-controls.test.tsx`
- Modify: `components/workspace-shell.tsx`
- Modify: `lib/state/workspace-store.ts`

**Interfaces:**
- Consumes: `SpineRuntimeBridge` 和 `SkeletonMetadata`。
- Produces: 完整预览交互；所有操作通过稳定 action 更新 store，再同步至 Bridge。

- [ ] **Step 1: 写控制器失败测试**

```tsx
it("隐藏插槽在切换动画后仍然生效", async () => {
  render(<WorkspaceShell bridge={fakeBridge({ slots: ["eyes", "weapon"], animations: ["idle", "walk"] })} />);
  await user.click(screen.getByRole("checkbox", { name: "weapon" }));
  await user.click(screen.getByRole("button", { name: "walk" }));
  expect(bridge.setHiddenSlots).toHaveBeenLastCalledWith(new Set(["weapon"]));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/unit/workspace-controls.test.tsx`

Expected: FAIL，缺少真实控制组件。

- [ ] **Step 3: 实现 Canvas 生命周期和视图控制**

`PreviewCanvas` 使用单一 `requestAnimationFrame` 循环；`ResizeObserver` 更新 DPR 尺寸；拖动修改相机中心、滚轮以指针为中心缩放；“适配画面”使用骨骼 bounds；卸载和重新导入时取消帧循环并调用 `bridge.dispose()`。

- [ ] **Step 4: 实现四组控制面板**

动画面板支持搜索和选择；皮肤面板支持单选/组合模式；插槽面板支持搜索、全选、全不选、恢复默认；播放栏支持播放、暂停、循环、0.25/0.5/0.75/1/1.25/1.5/2 倍速度与拖动时间。

- [ ] **Step 5: 加入可访问性和窄窗口行为**

所有控件具有 label、键盘焦点和禁用状态；低于 1100px 时左右面板变为可切换抽屉，Canvas 保持最小 480px 高度；不隐藏核心导出操作。

- [ ] **Step 6: 验证**

Run: `npm test -- tests/unit/workspace-controls.test.tsx && npm run build`

Expected: 控制状态、跨动画插槽隐藏、皮肤模式和构建全部通过。

- [ ] **Step 7: 提交**

```bash
git add components lib/state tests/unit/workspace-controls.test.tsx
git commit -m "feat: add Spine preview controls"
```

---

### Task 7: 推算恢复倍率并还原 Region PNG

**Files:**
- Create: `lib/spine/scale-inference.ts`
- Create: `lib/atlas/restore-math.ts`
- Create: `lib/atlas/restore-region.ts`
- Create: `tests/unit/scale-inference.test.ts`
- Create: `tests/unit/restore-math.test.ts`
- Create: `tests/e2e/restore-region.spec.ts`

**Interfaces:**
- Consumes: `AtlasRegion[]`、`AttachmentSizeSample[]`、纹理页 `ImageBitmap`。
- Produces: `ScaleInference` 与 `restoreRegion(input): Promise<RestoredRegion>`。

- [ ] **Step 1: 写倍率推算失败测试**

```ts
it("把一组接近 2 倍的附件证据归一为 50% 导出的恢复倍率", () => {
  const result = inferExportScale([
    { regionName: "head", atlasWidth: 50, atlasHeight: 60, attachmentWidth: 100, attachmentHeight: 120 },
    { regionName: "body", atlasWidth: 81, atlasHeight: 100, attachmentWidth: 160, attachmentHeight: 200 },
  ]);
  expect(result.restoreMultiplier).toBe(2);
  expect(result.confidence).toBe("high");
});
```

- [ ] **Step 2: 写旋转和透明边距数学失败测试**

```ts
it("90 度打包后恢复到原始透明画布", () => {
  expect(planRegionRestore(region({ rotation: 90, packedWidth: 10, packedHeight: 20, originalWidth: 30, originalHeight: 40, offsetLeft: 3, offsetBottom: 4 }), 2)).toMatchObject({
    crop: { width: 10, height: 20 },
    unrotated: { width: 20, height: 10 },
    output: { width: 60, height: 80 },
    destination: { x: 6, y: 52, width: 40, height: 20 },
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- tests/unit/scale-inference.test.ts tests/unit/restore-math.test.ts`

Expected: FAIL，两个实现模块均不存在。

- [ ] **Step 4: 实现稳健倍率推算**

```ts
export interface ScaleInference {
  restoreMultiplier: number;
  exportPercent: number;
  confidence: "high" | "medium" | "low";
  sampleCount: number;
  evidence: ScaleEvidence[];
  warnings: string[];
}
export function inferExportScale(samples: AttachmentSizeSample[]): ScaleInference;
```

只接收正数 Region 附件样本；宽高比误差超过 3% 的样本降权；使用中位数和 MAD 排除离群值；候选值吸附到 `4、2、4/3、1、2/3、1/2`，相对误差在 6% 内才吸附。少于 2 个一致样本不得返回高置信度；无证据时返回 1 倍、低置信度和中文警告。

- [ ] **Step 5: 实现恢复数学和像素管线**

`planRegionRestore` 负责验证范围和计算 top-left Canvas 坐标；`restoreRegion` 使用 `createImageBitmap` 裁切、临时 Canvas 反旋转、目标 Canvas 补透明边距，再以 `imageSmoothingEnabled=true`、`imageSmoothingQuality="high"` 应用倍率，最后 `toBlob("image/png")`。

- [ ] **Step 6: 在真实浏览器验证像素方向**

Playwright 用 2×3 的彩色角标 PNG 构造 90°、180°、270° Region，读取导出 PNG 的四角像素和尺寸，确保方向、offsetBottom 到 Canvas top 坐标转换及透明边距正确。

Run: `npx playwright test tests/e2e/restore-region.spec.ts`

Expected: 所有角度与尺寸断言通过。

- [ ] **Step 7: 提交**

```bash
git add lib/spine/scale-inference.ts lib/atlas tests/unit/scale-inference.test.ts tests/unit/restore-math.test.ts tests/e2e/restore-region.spec.ts
git commit -m "feat: restore atlas regions at logical size"
```

---

### Task 8: 生成安全、可追踪的 ZIP

**Files:**
- Create: `lib/export/safe-path.ts`
- Create: `lib/export/export-zip.ts`
- Create: `tests/unit/safe-path.test.ts`
- Create: `tests/unit/export-zip.test.ts`
- Create: `components/export-panel.tsx`
- Modify: `components/workspace-shell.tsx`

**Interfaces:**
- Consumes: Atlas Regions、纹理页、全局倍率、`Map<regionKey, number>` 单项覆盖和 `ScaleInference`。
- Produces: `exportAllRegions(input, onProgress): Promise<Blob>`。

- [ ] **Step 1: 写 ZIP 路径安全失败测试**

```ts
it("移除路径穿越并确定性处理重名", () => {
  const allocator = createZipPathAllocator();
  expect(allocator.allocate("../body/head")).toBe("body/head.png");
  expect(allocator.allocate("body/head")).toBe("body/head-2.png");
});
```

- [ ] **Step 2: 写报告一致性失败测试**

断言 ZIP 内每个 PNG 都有唯一报告项，失败 Region 有错误报告但不会阻止其他有效 Region；最终摘要包含成功、跳过、失败数量。

- [ ] **Step 3: 实现路径与导出队列**

```ts
export interface ExportAllInput {
  atlas: AtlasDocument;
  textures: Map<string, ImageBitmap>;
  inferredScale: ScaleInference;
  globalMultiplier: number;
  regionOverrides: Map<string, number>;
}
export async function exportAllRegions(input: ExportAllInput, onProgress: (done: number, total: number) => void): Promise<Blob>;
```

路径清理删除空段、`.`、`..`、盘符、NUL 和控制字符；重复路径按 Atlas 顺序添加 `-2`、`-3`。Region 逐个恢复并立即加入 JSZip，报告字段与设计文档一致。

- [ ] **Step 4: 实现导出面板**

显示自动比例、导出百分比、样本数、置信度与证据；支持全局倍率数字输入和单 Region 覆盖；低置信度显示警告但允许用户明确继续；导出时显示 `已处理 n / total` 并防止重复启动。

- [ ] **Step 5: 验证**

Run: `npm test -- tests/unit/safe-path.test.ts tests/unit/export-zip.test.ts && npm run build`

Expected: 路径安全、报告一致性和构建通过。

- [ ] **Step 6: 提交**

```bash
git add lib/export components/export-panel.tsx components/workspace-shell.tsx tests/unit/safe-path.test.ts tests/unit/export-zip.test.ts
git commit -m "feat: export restored regions as ZIP"
```

---

### Task 9: 完成中文错误系统、集成流程和视觉质量

**Files:**
- Create: `lib/ui/messages.ts`
- Create: `components/status-center.tsx`
- Create: `tests/e2e/import-workflow.spec.ts`
- Create: `tests/e2e/preview-controls.spec.ts`
- Create: `tests/e2e/export-workflow.spec.ts`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `components/workspace-shell.tsx`

**Interfaces:**
- Consumes: Task 1 定义的结构化 `AppIssue { code, severity, subject, details }`。
- Produces: 完整端到端用户流程和统一中文问题展示。

- [ ] **Step 1: 建立错误代码映射测试**

```ts
it.each(["MISSING_ATLAS", "MISSING_SKELETON", "MISSING_TEXTURE_PAGES", "UNSUPPORTED_SPINE_VERSION", "INVALID_SKEL_HEADER", "WEBGL_UNAVAILABLE", "REGION_OUT_OF_BOUNDS", "ZIP_FAILED"])("%s 有中文标题和操作建议", code => {
  const message = getIssueMessage({ code, severity: "error", subject: "hero" });
  expect(message.title).toMatch(/[\u4e00-\u9fff]/);
  expect(message.action).toMatch(/[\u4e00-\u9fff]/);
});
```

- [ ] **Step 2: 实现错误中心与可恢复流程**

阻断错误停止预览但保留重新选择入口；Atlas 导出能独立继续时显示为警告；错误必须包含对象、原因和下一步。手动 Runtime 选择只在自动识别失败或范围外时展开。

- [ ] **Step 3: 完成视觉系统**

采用深灰蓝工作台、清晰边框和有限的青色强调；导入空状态提供明确拖放区域；状态用文字、图标和颜色共同表达；长动画、皮肤、插槽和 Region 名称可搜索且不会挤压布局；禁止大面积渐变和装饰性空白。

- [ ] **Step 4: 编写三个端到端流程**

`import-workflow` 覆盖单页、多页、缺页和版本手动选择；`preview-controls` 覆盖动作、组合皮肤、插槽、缩放和平移；`export-workflow` 解压浏览器生成的 ZIP 并检查 PNG 数量、尺寸、路径和报告。

- [ ] **Step 5: 执行完整验证**

Run: `npm test && npx playwright test && npm run build`

Expected: 所有单元测试、浏览器测试和生产构建通过；控制台无未处理异常。

- [ ] **Step 6: 提交**

```bash
git add app components lib/ui tests/e2e
git commit -m "feat: complete Spine tool workflow"
```

---

### Task 10: 构建离线包并发布网站

**Files:**
- Create: `scripts/package-offline.mjs`
- Create: `tests/e2e/offline-package.spec.ts`
- Create: `README.md`
- Modify: `package.json`
- Modify: `.openai/hosting.json`

**Interfaces:**
- Consumes: 已通过验证的 Sites 生产构建与 `dist-offline` 静态构建。
- Produces: 可部署 Site 版本与 `spine-preview-export-offline.zip`。

- [ ] **Step 1: 写离线包失败测试**

测试解压包必须包含 `index.html`、所有 hashed JS/CSS、四个 Runtime chunk 和许可文件；扫描 HTML/JS/CSS 中的 `http://`、`https://`、`//cdn.` 外部运行依赖并要求结果为空。

- [ ] **Step 2: 实现离线打包脚本**

`package-offline.mjs` 从 `npm run build:offline` 生成的 `dist-offline` 创建 ZIP，加入简短的 `离线使用说明.txt`，并拒绝缺少 Runtime、动态远程 import 或许可文件的构建。

- [ ] **Step 3: 编写使用文档**

README 说明支持版本、导入组成、动画/皮肤/插槽操作、倍率置信度、ZIP 报告、离线启动方法、浏览器要求、像素细节无法逆向恢复的限制和 Spine Runtime 授权提醒。

- [ ] **Step 4: 验证断网运行**

Run: `npm run build && npm run package:offline && npx playwright test tests/e2e/offline-package.spec.ts`

Expected: 离线 ZIP 生成；在拦截全部外部请求的浏览器上下文中页面加载、导入示例并完成 ZIP 导出。

- [ ] **Step 5: 执行发布前总验证**

Run: `npm test && npx playwright test && npm run build && node scripts/verify-runtime-assets.mjs && npm run package:offline`

Expected: 全部命令退出码为 0；Git 工作区只包含预期交付文件。

- [ ] **Step 6: 提交并保存交付物**

```bash
git add README.md scripts/package-offline.mjs tests/e2e/offline-package.spec.ts package.json package-lock.json .openai/hosting.json
git commit -m "build: package offline Spine tool"
```

将离线 ZIP 保存为用户可下载文件。网站按 Sites 托管流程使用已经验证的同一提交构建、保存版本并部署；保持现有访问级别，不自行扩大公开范围。

---

## Final Verification Checklist

- [ ] `npm test`：Atlas、版本检测、状态、倍率、路径和 ZIP 单元测试全部通过。
- [ ] `npx playwright test`：像素恢复、导入、预览控制、导出和断网包测试全部通过。
- [ ] `npm run build`：生产构建成功。
- [ ] `node scripts/verify-runtime-assets.mjs`：四版本 Runtime、版本隔离和许可文件验证成功。
- [ ] `npm run package:offline`：生成完整离线 ZIP，无远程运行依赖。
- [ ] 用至少一组真实 Spine 3.8、4.0、4.1、4.2 JSON/SKEL 样本进行最终人工冒烟验证；若缺少真实授权样本，明确记录未覆盖项，不伪造通过结论。
- [ ] 网站部署状态为 succeeded，下载链接和网站链接均可访问。
