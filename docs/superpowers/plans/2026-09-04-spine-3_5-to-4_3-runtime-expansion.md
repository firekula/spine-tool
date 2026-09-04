# Spine 3.5–4.3 Runtime Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Spine 预览与 Atlas 导出工具扩展为自动支持 3.5–4.3 的八条版本线：3.5–3.7 支持 JSON，3.8–4.3 支持 JSON/SKEL，并为官方主动拒绝的 3.8.75 提供带警告的尽力兼容加载。

**Architecture:** 使用强类型 Runtime 注册表把原始版本映射到八个互相隔离、按需加载的 WebGL Runtime chunk；每个旧版本差异封装在自己的 adapter 内，工作区只依赖统一 bridge。Atlas-only 导出继续独立于 Runtime；Runtime 解析或渲染失败时仍保留导出资源。

**Tech Stack:** React、TypeScript、Vite、Vitest、Playwright、JSZip、官方 Esoteric Software `spine-runtimes` 源码与 `@esotericsoftware/spine-webgl` npm 包。

**Spec:** `docs/superpowers/specs/2026-09-04-spine-3_5-to-4_3-runtime-expansion-design.md`

## Global Constraints

- 明确支持 `3.5 | 3.6 | 3.7 | 3.8 | 4.0 | 4.1 | 4.2 | 4.3` 八条 Runtime 版本线。
- 同一 `major.minor` 下所有稳定补丁号路由到该版本线；Beta 后缀允许尝试，但必须显示兼容警告。
- JSON 必须由匹配的 `major.minor` Runtime 读取；SKEL 仅由匹配的 3.8–4.3 Runtime 读取。3.5–3.7 SKEL 明确报能力错误，不用其他版本 Runtime 静默读取。
- 3.8.75 使用尽力兼容模式，只移除官方 Runtime 的精确主动拒绝，不修改用户文件或其他数据检查。
- 3.5–3.8 在 Atlas 没有可靠 `pma` 时必须让用户确认 PMA/Straight；文件名仅可预选。
- Runtime 失败不阻断已经有效的 Atlas-only PNG ZIP 导出。
- 用户提供的 `xhm` 只做本地验收，不提交、不放入网站、源码包或离线包。
- 所有新增 Runtime 必须固定官方来源、提交或包版本、许可证和 SHA-256；离线审计保持 fail-closed。
- 所有界面、错误和报告保持中文；专有名词保留英文。
- 不改写骨骼数据，不转换版本，不承诺恢复缩小导出前丢失的像素细节。

## Planned File Structure

```text
lib/spine/
  version.ts                         八版本类型、原始版本分类和兼容标记
  runtime-registry.ts                Runtime 描述、懒加载、Alpha/兼容策略
  runtime-loader.ts                  从注册表加载隔离模块
  bridge-types.ts                    统一 bridge 输入和来源类型
  runtime-factory.ts                 共享生命周期、渲染和 metadata 流程
  runtime-3_5.ts                     Spine 3.5 adapter
  runtime-3_6.ts                     Spine 3.6 adapter
  runtime-3_7.ts                     Spine 3.7 adapter
  runtime-3_8.ts                     Spine 3.8 adapter 与 3.8.75 标记
  runtime-4_3.ts                     Spine 4.3 adapter
vendor/
  spine-runtime-3.5/                 官方 3.5 构建、许可、SOURCE.json
  spine-runtime-3.6/                 官方 3.6 构建、许可、SOURCE.json
  spine-runtime-3.7/                 官方 3.7 构建、许可、SOURCE.json
  spine-runtime-3.8/                 现有构建与可审查 3.8.75 补丁
scripts/
  vendor-legacy-runtime.mjs           从固定提交可重复生成旧 Runtime
  runtime-sources.json                八版本来源、hash、package integrity
  verify-runtime-assets.mjs           无 npm cache 依赖的来源和隔离校验
tests/fixtures/official-spine/
  3.5/ 3.6/ 3.7/                     官方 JSON、Atlas、PNG fixture 与 SKEL 能力错误覆盖
  4.3/                               官方 JSON、SKEL、Atlas、PNG fixture
  SOURCES.json                        fixture 来源与 SHA-256
tests/fixtures/spine-3.8.75-minimal/  不含用户素材的最小回归 fixture
tests/unit/runtime-registry.test.ts
tests/unit/spine-3875-compat.test.ts
tests/e2e/spine-version-matrix.spec.ts
```

---

### Task 1: 建立八版本模型与 Runtime 注册表

**Files:**
- Create: `lib/spine/runtime-registry.ts`
- Create: `tests/unit/runtime-registry.test.ts`
- Modify: `lib/spine/version.ts`
- Modify: `lib/spine/runtime-loader.ts`
- Modify: `lib/spine/bridge-types.ts`
- Modify: `tests/unit/spine-version.test.ts`
- Modify: `tests/unit/runtime-loader.test.ts`

**Interfaces:**
- Produces: `SupportedSpineVersion`, `RuntimeCompatibility`, `classifySpineVersion(raw, source)`, `runtimeDescriptor(version)`, `loadRuntimeModule(version)`。
- Consumes: 后续每个 adapter 导出的 `SpineRuntimeModule`。

- [ ] **Step 1: 写八版本与兼容标记失败测试**

```ts
it.each([
  ["3.5.51", "3.5"], ["3.6.53", "3.6"], ["3.7.94", "3.7"],
  ["3.8.75", "3.8"], ["3.8.99", "3.8"], ["4.0.64", "4.0"],
  ["4.1.24", "4.1"], ["4.2.120", "4.2"], ["4.3.9", "4.3"],
])("将 %s 路由到 %s", async (raw, expected) => {
  await expect(detectSpineVersion(file("hero.json", JSON.stringify({ skeleton: { spine: raw } }))))
    .resolves.toMatchObject({ raw, majorMinor: expected, supported: true });
});

it("标记 3.8.75 特殊兼容与 Beta 风险", () => {
  expect(classifySpineVersion("3.8.75", "json-field").compatibility).toBe("spine-3.8.75");
  expect(classifySpineVersion("4.3.0-beta", "json-field").compatibility).toBe("prerelease");
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- tests/unit/spine-version.test.ts tests/unit/runtime-registry.test.ts tests/unit/runtime-loader.test.ts`

Expected: FAIL，3.5、3.6、3.7、4.3 不在联合类型/加载表，且 compatibility 字段不存在。

- [ ] **Step 3: 实现版本分类和注册表**

```ts
export type SupportedSpineVersion = "3.5" | "3.6" | "3.7" | "3.8" | "4.0" | "4.1" | "4.2" | "4.3";
export type RuntimeCompatibility = "stable" | "prerelease" | "spine-3.8.75";

export interface RuntimeDescriptor {
  majorMinor: SupportedSpineVersion;
  requiresExplicitAlphaMode: boolean;
}

export function classifySpineVersion(
  raw: string,
  source: Exclude<DetectedSpineVersion["source"], "unknown">,
): DetectedSpineVersion;
export function runtimeDescriptor(version: SupportedSpineVersion): RuntimeDescriptor;
```

注册表先显式列出八个版本的元数据；不要根据用户字符串拼接模块路径。`DetectedSpineVersion` 增加 `compatibility`，unknown 时为 `null`。`runtime-loader.ts` 在本任务保持一个显式的 `Partial<Record<SupportedSpineVersion, Loader>>`：已有 3.8–4.2 继续加载，尚未集成的 3.5–3.7、4.3 返回“对应 Runtime 尚未安装”的结构化错误。后续 Runtime 任务在模块真实存在的同一提交中加入动态 import，保证每个中间提交都能编译。

- [ ] **Step 4: 运行聚焦测试确认 GREEN**

Run: `npm test -- tests/unit/spine-version.test.ts tests/unit/runtime-registry.test.ts tests/unit/runtime-loader.test.ts`

Expected: 所有版本分类通过；3.8–4.2 继续加载，3.5–3.7、4.3 返回明确的未安装错误，不引用不存在的模块或伪造生产 adapter。

- [ ] **Step 5: 提交**

```bash
git add lib/spine/version.ts lib/spine/runtime-registry.ts lib/spine/runtime-loader.ts lib/spine/bridge-types.ts tests/unit/spine-version.test.ts tests/unit/runtime-registry.test.ts tests/unit/runtime-loader.test.ts
git commit -m "feat: register Spine 3.5 through 4.3 runtimes"
```

---

### Task 2: 固定官方来源并消除 npm cache 验证依赖

**Files:**
- Create: `scripts/runtime-sources.json`
- Create: `scripts/vendor-legacy-runtime.mjs`
- Modify: `scripts/verify-runtime-assets.mjs`
- Modify: `docs/runtime-versions.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/unit/runtime-loader.test.ts`

**Interfaces:**
- Produces: `runtime-sources.json` 作为来源真相；`vendor-legacy-runtime.mjs --version X.Y --commit SHA --archive PATH` 只从给定官方归档生成 vendor 资产。
- Consumes: 官方归档或 npm 包；不依赖 npm cache 中是否保留 packument。

固定值：

| 版本线 | 官方来源 |
| --- | --- |
| 3.5 | `spine-runtimes` 分支提交 `afdbbc2044fb56c762d4e2eb54b63b1bb9276a48` |
| 3.6 | 提交 `654c20e5b0e523040b6366bbd1042510d2645134` |
| 3.7 | 提交 `9639bcc81722d7178fd9d1cdc1a3d55a4c91f989` |
| 3.8 | 现有提交 `8b4844bd4b193ba9e54487ed397a777993cbad56` |
| 4.0 | npm `4.0.31` |
| 4.1 | npm `4.1.56` |
| 4.2 | npm `4.2.120` |
| 4.3 | npm `4.3.9`，integrity `sha512-eAcqxurSXyGeQg9RFlqSUOqEiMYQcKsKKgcxzNwzcu18G7tcUZMcX7cB5zkN1mlfxtuGtZVx5bmGYSlUBUTrkQ==`，tarball SHA-256 `fd8f6a38f9ab394e84801967209c304738c7ac84f1db9a7d8b0428203114b390` |

- [ ] **Step 1: 写无 npm cache 的失败测试**

```ts
it("Runtime 来源验证不依赖 npm cache", () => {
  const emptyCache = mkdtempSync(join(tmpdir(), "empty-npm-cache-"));
  expect(() => execFileSync(process.execPath, [verifyScript], {
    env: { ...process.env, npm_config_cache: emptyCache },
  })).not.toThrow();
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- tests/unit/runtime-loader.test.ts -t "不依赖 npm cache"`

Expected: FAIL，当前 `npm pack --offline` 无法从空缓存取得 4.0.31。

- [ ] **Step 3: 建立来源清单和确定性校验**

`runtime-sources.json` 为每条版本记录 `kind`、`version`/`commit`、官方 URL、archive SHA-256、构建产物 SHA-256 和 license SHA-256。验证脚本改为：

1. 对 npm Runtime 校验 `package.json` alias、lockfile `resolved`/`integrity`、已安装 package version、core version、license hash；
2. 若仓库保留对应 `.tgz`，再校验 tarball SHA-256；不存在时不调用网络或 npm cache；
3. 对 vendor Runtime 校验 SOURCE.json、官方归档 hash、构建产物 hash、ESM 边界和许可证；
4. 构建后验证八个 Runtime chunk 的模块隔离。

- [ ] **Step 4: 加入 4.3 官方依赖并生成 lockfile**

在 `package.json` 增加：

```json
"@esotericsoftware/spine-webgl-4.3": "npm:@esotericsoftware/spine-webgl@4.3.9"
```

使用现有包管理器更新 lockfile，不升级无关依赖。

- [ ] **Step 5: 运行来源测试确认 GREEN**

Run: `npm test -- tests/unit/runtime-loader.test.ts && npm run verify-runtime-assets`

Expected: 空缓存和正常环境都通过；输出八条 Runtime 来源及八个隔离 chunk。

- [ ] **Step 6: 提交**

```bash
git add scripts/runtime-sources.json scripts/vendor-legacy-runtime.mjs scripts/verify-runtime-assets.mjs docs/runtime-versions.md package.json package-lock.json tests/unit/runtime-loader.test.ts
git commit -m "build: pin Spine 3.5 through 4.3 sources"
```

---

### Task 3: 集成 Spine 3.5 Runtime 与真实 fixture

> 执行时确认：固定的官方 3.5 Web Runtime 不提供 `SkeletonBinary`。用户选择将 3.5–3.7 定为 JSON-only；以下步骤按该决定修订，保留同版本隔离和显式能力错误要求。

**Files:**
- Create: `vendor/spine-runtime-3.5/**`
- Create: `lib/spine/runtime-3_5.ts`
- Create: `tests/fixtures/official-spine/3.5/**`
- Modify: `tests/fixtures/official-spine/SOURCES.json`
- Modify: `tests/unit/official-fixtures.test.ts`
- Modify: `tests/unit/runtime-loader.test.ts`
- Modify: `tests/e2e/official-runtime-fixtures.spec.ts`
- Modify: `lib/spine/runtime-loader.ts`

**Interfaces:**
- Produces: `runtime-3_5.ts` 的 `version`, `source`, `runtimeConstructors`, `createBridge()`。
- Consumes: `RuntimeAdapter` 与统一 `createRuntimeBridge()`。

- [ ] **Step 1: 写真实 JSON 加载与 SKEL 能力错误测试**

将官方 3.5 示例的 JSON、Atlas、PNG 连同来源 URL/SHA-256 固定到 fixture，并用最小二进制输入覆盖 SKEL 能力错误。扩展现有矩阵：

```ts
const versions = ["3.5", "3.8", "4.0", "4.1", "4.2"] as const;
```

断言 3.5 JSON 进入 `Spine 3.5 · 预览已就绪`，能读取动画、皮肤、插槽并绘制非透明像素；3.5 SKEL 返回中文能力错误，且不调用其他版本 Runtime。

- [ ] **Step 2: 运行 3.5 测试确认 RED**

Run: `npm test -- tests/unit/runtime-loader.test.ts tests/unit/official-fixtures.test.ts && npx playwright test tests/e2e/official-runtime-fixtures.spec.ts --grep "3.5"`

Expected: FAIL，3.5 adapter/vendor 尚不存在。

- [ ] **Step 3: 构建最小 3.5 adapter**

`runtime-3_5.ts` 显式映射 3.5 的 `TextureAtlas`、`AtlasAttachmentLoader`、`SkeletonJson`、`AnimationState`、`Skin`、`GLTexture`、`SceneRenderer`，并声明没有 Binary reader。如果方法签名不同，在 adapter 提供 `updateSkeleton`、`updateWorldTransform`、`isRegionAttachment`，不在 `runtime-factory.ts` 判断版本字符串。模块完成后才在 `runtime-loader.ts` 加入 `"3.5": () => import("./runtime-3_5")`。

- [ ] **Step 4: 运行 3.5 测试确认 GREEN**

Run: `npm test -- tests/unit/runtime-loader.test.ts tests/unit/official-fixtures.test.ts && npx playwright test tests/e2e/official-runtime-fixtures.spec.ts --grep "3.5"`

Expected: 3.5 JSON 真实解析、渲染和释放资源；3.5 SKEL 明确失败且不跨版本读取。

- [ ] **Step 5: 提交**

```bash
git add vendor/spine-runtime-3.5 lib/spine/runtime-3_5.ts lib/spine/runtime-loader.ts tests/fixtures/official-spine/3.5 tests/fixtures/official-spine/SOURCES.json tests/unit/official-fixtures.test.ts tests/unit/runtime-loader.test.ts tests/e2e/official-runtime-fixtures.spec.ts
git commit -m "feat: add Spine 3.5 runtime"
```

---

### Task 4: 集成 Spine 3.6 Runtime 与真实 fixture

> 按 Task 3 的用户决定，3.6 同样为 JSON-only，并对 SKEL fail-closed。

**Files:**
- Create: `vendor/spine-runtime-3.6/**`
- Create: `lib/spine/runtime-3_6.ts`
- Create: `tests/fixtures/official-spine/3.6/**`
- Modify: `tests/fixtures/official-spine/SOURCES.json`
- Modify: `tests/unit/official-fixtures.test.ts`
- Modify: `tests/unit/runtime-loader.test.ts`
- Modify: `tests/e2e/official-runtime-fixtures.spec.ts`
- Modify: `lib/spine/runtime-loader.ts`

**Interfaces:** 与 Task 3 相同，但 module version 必须是字面量 `"3.6"`，构造器必须来自 3.6 自己的 vendor chunk。

- [ ] **Step 1: 把 3.6 JSON 与 SKEL 能力错误加入矩阵并确认 RED**

Run: `npm test -- tests/unit/runtime-loader.test.ts tests/unit/official-fixtures.test.ts && npx playwright test tests/e2e/official-runtime-fixtures.spec.ts --grep "3.6"`

Expected: FAIL，3.6 module 不存在。

- [ ] **Step 2: 实现 3.6 adapter 和来源验证**

从固定提交 `654c20e5b0e523040b6366bbd1042510d2645134` 构建 vendor；将 3.6 API 映射到 `RuntimeAdapter`，然后在 loader 显式增加 3.6 动态 import。添加跨 Runtime 身份断言：3.5 与 3.6 的 `Skeleton`/`SkeletonData` 构造器不得相同。

- [ ] **Step 3: 确认 3.6 GREEN 且 3.5 无回归**

Run: `npm test -- tests/unit/runtime-loader.test.ts tests/unit/official-fixtures.test.ts && npx playwright test tests/e2e/official-runtime-fixtures.spec.ts --grep "Spine 3.[56]"`

Expected: 3.5/3.6 JSON 预览通过；两者的 SKEL 都返回明确能力错误且不跨版本读取。

- [ ] **Step 4: 提交**

```bash
git add vendor/spine-runtime-3.6 lib/spine/runtime-3_6.ts lib/spine/runtime-loader.ts tests/fixtures/official-spine/3.6 tests/fixtures/official-spine/SOURCES.json tests/unit/official-fixtures.test.ts tests/unit/runtime-loader.test.ts tests/e2e/official-runtime-fixtures.spec.ts
git commit -m "feat: add Spine 3.6 runtime"
```

---

### Task 5: 集成 Spine 3.7 Runtime 与真实 fixture

> 按 Task 3 的用户决定，3.7 同样为 JSON-only，并对 SKEL fail-closed。

**Files:**
- Create: `vendor/spine-runtime-3.7/**`
- Create: `lib/spine/runtime-3_7.ts`
- Create: `tests/fixtures/official-spine/3.7/**`
- Modify: `tests/fixtures/official-spine/SOURCES.json`
- Modify: `tests/unit/official-fixtures.test.ts`
- Modify: `tests/unit/runtime-loader.test.ts`
- Modify: `tests/e2e/official-runtime-fixtures.spec.ts`
- Modify: `lib/spine/runtime-loader.ts`

**Interfaces:** 与 Task 3 相同，module version 为 `"3.7"`，构造器只来自 3.7 vendor chunk。

- [ ] **Step 1: 把 3.7 JSON 与 SKEL 能力错误加入矩阵并确认 RED**

Run: `npm test -- tests/unit/runtime-loader.test.ts tests/unit/official-fixtures.test.ts && npx playwright test tests/e2e/official-runtime-fixtures.spec.ts --grep "3.7"`

Expected: FAIL，3.7 module 不存在。

- [ ] **Step 2: 实现 3.7 adapter 和来源验证**

从固定提交 `9639bcc81722d7178fd9d1cdc1a3d55a4c91f989` 构建 vendor；所有 3.7 特有调用留在 adapter，然后在 loader 显式增加 3.7 动态 import。扩展构造器身份测试，确保 3.5/3.6/3.7/3.8 四套 core 隔离。

- [ ] **Step 3: 确认 3.5–3.8 GREEN**

Run: `npm test -- tests/unit/runtime-loader.test.ts tests/unit/official-fixtures.test.ts && npx playwright test tests/e2e/official-runtime-fixtures.spec.ts --grep "Spine 3."`

Expected: 3.5、3.6、3.7 JSON 与 3.8 JSON/SKEL 预览通过；3.5–3.7 SKEL 均返回明确能力错误且不跨版本读取。

- [ ] **Step 4: 提交**

```bash
git add vendor/spine-runtime-3.7 lib/spine/runtime-3_7.ts lib/spine/runtime-loader.ts tests/fixtures/official-spine/3.7 tests/fixtures/official-spine/SOURCES.json tests/unit/official-fixtures.test.ts tests/unit/runtime-loader.test.ts tests/e2e/official-runtime-fixtures.spec.ts
git commit -m "feat: add Spine 3.7 runtime"
```

---

### Task 6: 实现 3.8.75 受控兼容与 3.x Alpha 策略

**Files:**
- Create: `vendor/spine-runtime-3.8/patches/allow-3.8.75.patch`
- Create: `tests/fixtures/spine-3.8.75-minimal/**`
- Create: `tests/unit/spine-3875-compat.test.ts`
- Modify: `vendor/spine-runtime-3.8/SOURCE.json`
- Modify: `vendor/spine-runtime-3.8/spine-webgl.js`
- Modify: `lib/spine/runtime-registry.ts`
- Modify: `lib/spine/runtime-factory.ts`
- Modify: `lib/files/import-workflow.ts`
- Modify: `components/workspace-shell.tsx`
- Modify: `lib/ui/messages.ts`
- Modify: `tests/unit/import-workflow.test.ts`
- Modify: `tests/unit/workspace-import.test.tsx`
- Modify: `tests/e2e/spine-38-alpha.spec.ts`

**Interfaces:**
- Produces: `requiresExplicitAlphaMode` 对 3.5–3.8 为 true；`SPINE_3_8_75_COMPATIBILITY` warning。
- Consumes: `DetectedSpineVersion.compatibility` 和现有 `TextureAlphaMode`。

- [ ] **Step 1: 写 3.8.75 RED**

```ts
it("3.8.75 不修改输入即可读出最小骨骼", () => {
  const original = readFileSync(fixtureJson, "utf8");
  expect(() => readWithSpine38(original)).not.toThrow();
  expect(JSON.parse(original).skeleton.spine).toBe("3.8.75");
});
```

UI 测试断言自动识别后出现黄色警告但仍进入 Alpha 确认；确认后加载，不出现手动 Runtime 选择器。

- [ ] **Step 2: 运行测试确认精确失败**

Run: `npm test -- tests/unit/spine-3875-compat.test.ts tests/unit/import-workflow.test.ts tests/unit/workspace-import.test.tsx`

Expected: FAIL，官方 Runtime 抛出 `Unsupported skeleton data`。

- [ ] **Step 3: 应用最小可审查 Runtime 补丁**

补丁只删除 JSON 和 Binary reader 中对精确字符串 `3.8.75` 的主动 throw。`vendor-legacy-runtime.mjs` 先把补丁应用到固定提交的官方 TypeScript 源码，再执行该版本原有构建，生成 JS、声明和 source map；不直接手改构建产物。SOURCE.json 记录上游 archive hash、patch hash和最终产物 hash；验证脚本必须从相同输入重建并证明除补丁 hunks 与既有 ESM boundary 外没有额外变化。

- [ ] **Step 4: 将 Alpha 策略扩展到全部 3.x**

用注册表属性替换 `version === "3.8"` 判断：

```ts
const descriptor = runtimeDescriptor(version);
const alphaMode = descriptor.requiresExplicitAlphaMode ? selectedAlphaMode : undefined;
```

界面标题改为 `Spine 3.x 纹理 Alpha 模式`，仍要求显式确认。4.x 不接受该选择覆盖 Atlas `pma`。

- [ ] **Step 5: 验证 GREEN 与像素行为**

Run: `npm test -- tests/unit/spine-3875-compat.test.ts tests/unit/import-workflow.test.ts tests/unit/workspace-import.test.tsx && npx playwright test tests/e2e/spine-38-alpha.spec.ts`

Expected: 最小 3.8.75 JSON/SKEL 尽力加载；PMA/Straight 半透明像素仍正确；失败时 Atlas-only 仍可导出。

- [ ] **Step 6: 用用户 xhm 做本地验收但不提交**

通过浏览器导入 `/workspace/scratch/418652f92b5d/upload/xhm.atlas`、`xhm.json`、`xhm.png`，确认显示原始版本 3.8.75、警告、动画 `animation`、皮肤 `default`、六个插槽和非空画面。检查 `git status --short` 不包含 `xhm`。

- [ ] **Step 7: 提交**

```bash
git add vendor/spine-runtime-3.8 lib/spine/runtime-registry.ts lib/spine/runtime-factory.ts lib/files/import-workflow.ts components/workspace-shell.tsx lib/ui/messages.ts tests/fixtures/spine-3.8.75-minimal tests/unit/spine-3875-compat.test.ts tests/unit/import-workflow.test.ts tests/unit/workspace-import.test.tsx tests/e2e/spine-38-alpha.spec.ts
git commit -m "fix: compatibly load Spine 3.8.75 data"
```

---

### Task 7: 集成 Spine 4.3 Runtime 与真实 fixture

**Files:**
- Create: `lib/spine/runtime-4_3.ts`
- Create: `tests/fixtures/official-spine/4.3/**`
- Modify: `tests/fixtures/official-spine/SOURCES.json`
- Modify: `tests/unit/official-fixtures.test.ts`
- Modify: `tests/unit/runtime-loader.test.ts`
- Modify: `tests/e2e/official-runtime-fixtures.spec.ts`
- Modify: `lib/spine/runtime-loader.ts`

**Interfaces:**
- Produces: 4.3 `SpineRuntimeModule`，source version `4.3.9`。
- Consumes: `@esotericsoftware/spine-webgl-4.3` 与统一 factory。

- [ ] **Step 1: 加入 4.3 JSON/SKEL 测试并确认 RED**

Run: `npm test -- tests/unit/runtime-loader.test.ts tests/unit/official-fixtures.test.ts && npx playwright test tests/e2e/official-runtime-fixtures.spec.ts --grep "4.3"`

Expected: FAIL，`runtime-4_3.ts` 不存在。

- [ ] **Step 2: 实现 4.3 adapter**

复用 4.2 adapter 形状，但逐项使用 4.3.9 导出的构造器和 `Physics.update` 等实际 API；禁止从 4.2 module 重导出 Runtime 类型。模块完成后在 loader 显式增加 4.3 动态 import。

- [ ] **Step 3: 验证 4.3 和全 4.x 隔离**

Run: `npm test -- tests/unit/runtime-loader.test.ts tests/unit/official-fixtures.test.ts && npx playwright test tests/e2e/official-runtime-fixtures.spec.ts --grep "Spine 4."`

Expected: 4.0–4.3 JSON/SKEL 全部通过，四套 core 构造器身份互不相同。

- [ ] **Step 4: 提交**

```bash
git add lib/spine/runtime-4_3.ts lib/spine/runtime-loader.ts tests/fixtures/official-spine/4.3 tests/fixtures/official-spine/SOURCES.json tests/unit/official-fixtures.test.ts tests/unit/runtime-loader.test.ts tests/e2e/official-runtime-fixtures.spec.ts
git commit -m "feat: add Spine 4.3 runtime"
```

---

### Task 8: 完成八版本 UI、错误提示与降级流程

**Files:**
- Modify: `components/workspace-shell.tsx`
- Modify: `components/import-dropzone.tsx`
- Modify: `lib/files/import-workflow.ts`
- Modify: `lib/state/workspace-store.ts`
- Modify: `lib/ui/messages.ts`
- Modify: `tests/unit/workspace-import.test.tsx`
- Modify: `tests/unit/workspace-controls.test.tsx`
- Modify: `tests/unit/messages.test.ts`
- Modify: `tests/e2e/import-workflow.spec.ts`
- Create: `tests/e2e/spine-version-matrix.spec.ts`

**Interfaces:**
- Consumes: Runtime 注册表、兼容标记、统一 bridge。
- Produces: 自动/手动来源展示、八版本选择器、3.8.75/Beta warning、失败后的 Atlas-only 状态。

- [ ] **Step 1: 写 UI RED**

断言手动选择器依次包含八条版本线；自动导入显示 `素材版本 3.8.75`、`Runtime 3.8（自动）`；Beta 显示非阻断警告；Runtime load error 后 Region 列表和 ZIP 按钮仍可用。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- tests/unit/workspace-import.test.tsx tests/unit/workspace-controls.test.tsx tests/unit/messages.test.ts && npx playwright test tests/e2e/import-workflow.spec.ts tests/e2e/spine-version-matrix.spec.ts`

Expected: FAIL，UI 仍硬编码四版本和 3.8 专用 Alpha 文案。

- [ ] **Step 3: 用注册表驱动 UI**

从注册表导出排序后的只读版本列表供 `<select>` 与文案使用；工作区状态记录 `rawVersion`、`runtimeVersion`、`selectionSource` 和 `compatibility`。不在 React 组件重复维护版本数组。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- tests/unit/workspace-import.test.tsx tests/unit/workspace-controls.test.tsx tests/unit/messages.test.ts && npx playwright test tests/e2e/import-workflow.spec.ts tests/e2e/spine-version-matrix.spec.ts`

Expected: 八版本自动/手动流程、警告和 Atlas-only 降级通过。

- [ ] **Step 5: 提交**

```bash
git add components/workspace-shell.tsx components/import-dropzone.tsx lib/files/import-workflow.ts lib/state/workspace-store.ts lib/ui/messages.ts tests/unit/workspace-import.test.tsx tests/unit/workspace-controls.test.tsx tests/unit/messages.test.ts tests/e2e/import-workflow.spec.ts tests/e2e/spine-version-matrix.spec.ts
git commit -m "feat: expose Spine 3.5 through 4.3 workflows"
```

---

### Task 9: 扩展离线安全审计与确定性打包

**Files:**
- Modify: `scripts/offline-runtime-audit.mjs`
- Modify: `scripts/package-offline.mjs`
- Modify: `tests/unit/offline-runtime-audit.test.ts`
- Modify: `tests/unit/offline-build.test.ts`
- Modify: `tests/unit/offline-package.test.ts`
- Modify: `tests/e2e/offline-package.spec.ts`

**Interfaces:**
- Consumes: 构建生成的八个 Runtime chunk。
- Produces: 精确 path+SHA-256 trusted index 和确定性离线 ZIP。

- [ ] **Step 1: 写新增 Runtime fail-closed RED**

构建离线产物后断言 trusted index 含八个 Runtime；复制后改动 3.5、3.6、3.7、4.3 任一 chunk 一个字节，`package:offline` 必须失败；未改动产物必须通过且不发外部请求。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- tests/unit/offline-runtime-audit.test.ts tests/unit/offline-build.test.ts tests/unit/offline-package.test.ts`

Expected: FAIL，新增 chunk 未被精确批准。

- [ ] **Step 3: 审查并更新精确可信索引**

先运行 AST 审计记录新增旧 Runtime 的动态本地资源调用；仅在来源验证通过后添加完整构建路径和 SHA-256。不得按文件名前缀、部分 hash 或目录整体放行。

- [ ] **Step 4: 运行离线测试确认 GREEN**

Run: `npm test -- tests/unit/offline-runtime-audit.test.ts tests/unit/offline-build.test.ts tests/unit/offline-package.test.ts && npx playwright test tests/e2e/offline-package.spec.ts`

Expected: 正常离线全流程通过，任一受信 chunk 改动都会被拒绝。

- [ ] **Step 5: 提交**

```bash
git add scripts/offline-runtime-audit.mjs scripts/package-offline.mjs tests/unit/offline-runtime-audit.test.ts tests/unit/offline-build.test.ts tests/unit/offline-package.test.ts tests/e2e/offline-package.spec.ts
git commit -m "build: trust eight pinned offline runtimes"
```

---

### Task 10: 文档、全量验收、交付与本地合并

**Files:**
- Modify: `README.md`
- Modify: `docs/runtime-versions.md`
- Modify: `public/licenses/SPINE-RUNTIMES-LICENSE.txt` only if the pinned official license differs
- Rebuild: `dist/**`
- Rebuild: `dist-offline/**`
- Rebuild: `spine-preview-export-offline.zip`

**Interfaces:**
- Consumes: Tasks 1–9 的八版本功能和测试。
- Produces: 验证通过的网站、离线 ZIP、源码 ZIP和可合并分支。

- [ ] **Step 1: 更新用户文档**

README 列出八版本矩阵、同 major.minor 补丁兼容原则、Beta 警告、3.8.75 尽力兼容、3.x Alpha 选择、手动 Runtime、Atlas-only 降级和像素细节限制。

- [ ] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 所有 Vitest 测试通过，包含空 npm cache 来源验证。

Run: `npx playwright test`

Expected: 所有 Chromium 测试通过，八版本 JSON、3.8–4.3 SKEL、3.5–3.7 SKEL 能力错误、3.8.75、PMA/Straight、动画/皮肤/插槽、旋转/裁剪/倍率/ZIP 均为 GREEN。

Run: `npm run verify-runtime-assets`

Expected: 八条官方来源、许可证、hash 与 chunk 隔离通过。

Run: `npm run build`

Expected: TypeScript 与在线构建通过。

Run: `npm run build:offline`

Expected: 离线构建只含相对本地资源。

- [ ] **Step 3: 验证确定性离线 ZIP**

连续执行两次 `npm run package:offline`，每次分别运行 `sha256sum spine-preview-export-offline.zip`；两个完整 SHA-256 必须完全相同。

- [ ] **Step 4: 本地验收 xhm 且保护用户文件**

导入用户三件套，确认 3.8.75 警告、`animation`、`default`、六插槽、非空渲染和 ZIP；确认构建目录、git diff、源码 ZIP、离线 ZIP 中均不存在 `xhm` 文件或其内容 hash。

- [ ] **Step 5: 提交文档与可信构建索引**

```bash
git add README.md docs/runtime-versions.md public/licenses/SPINE-RUNTIMES-LICENSE.txt scripts/offline-runtime-audit.mjs
git commit -m "docs: document Spine 3.5 through 4.3 support"
```

- [ ] **Step 6: 重新交付**

从通过验证的同一 HEAD 生成源码 ZIP；保存离线 ZIP和源码 ZIP；把同一 `dist` 逐字节复制到现有 Site checkout，保存并部署新私有版本，轮询到 `succeeded` 后返回 URL。

- [ ] **Step 7: 执行用户已选择的本地合并**

确认 feature branch 干净，从主仓库合并到 `master`，在合并结果再次运行 `npm test`。通过后删除由本流程创建的 feature worktree 和分支；若测试失败，保留二者并报告，不强制清理。
