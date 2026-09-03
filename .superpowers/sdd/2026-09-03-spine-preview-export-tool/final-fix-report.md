# Spine 预览与导出工具最终修复报告

日期：2026-09-03
修复基线：`5a2aad2`
审查输入：`final-review-findings.md`、设计规格、Task 9/10 报告

## 结论

四项阻断发现均已修复，完整单元测试、真实浏览器测试、在线/离线构建、Runtime 来源与哈希验证、离线网络审计和确定性双打包均通过。用户文件仍只通过浏览器本地 API 处理；本次没有增加上传或远程运行依赖。Spine 4.x 继续读取 Atlas/Runtime 的 `pma`，只有 3.8 要求用户明确确认 Alpha 模式。

## 修复内容

### 1. Atlas page name 统一身份

- 新增唯一入口 `normalizeAtlasPageName`：统一 `\\` 为 `/`，并移除任意多个开头 `./` 段。
- 导入分类、Atlas 解析结果、Runtime 纹理/页面配置查找和 ZIP 导出查找全部使用同一规则。
- `normalizeAtlasPageMap` 对规范化别名碰撞 fail closed；解析和导入也在各自边界拒绝重复页面身份。
- 浏览器用真实文件导入 `.\\page-a.png` 与 `./page-b.png`，下载并解压 ZIP，确认两张 PNG 存在且报告中的来源页为规范化名称。

### 2. Page scale 直接证据、冲突确认与样本去重

- Atlas 页 `scale` 解析为正有限 `number`，不再留在 `custom`。
- page scale 优先于附件尺寸推算，并直接产生高置信证据：`0.5 → 2x / 50%`、`1 → 1x / 100%`、`2 → 0.5x / 200%`。
- 多页 scale 不一致时返回安全的 `1x`、低置信、逐页明细 warning 与 `requiresConfirmation`，导出按钮保持阻断。
- 用户填写手动全局倍率并勾选确认后可继续导出；确认后再次修改倍率会清除旧确认，必须重新核对。
- 附件证据以 `${region.name}#${region.index}` 稳定 Region 身份去重，多个皮肤不会虚增置信度。
- 真实浏览器用例在冲突场景填写 `2x`、确认、下载并解压 ZIP，核对两张 PNG 均为 `2×2`，报告两项 `finalMultiplier` 均为 `2`。

### 3. Windows portable ZIP path

- 每段清理控制字符与 Windows 禁用字符，去掉尾随点/空格，防止驱动器前缀与路径穿越。
- `CON`、`PRN`、`AUX`、`NUL`、`COM1..9`、`LPT1..9`（包括带扩展名）自动加安全前缀。
- 单段限制为 100 个 UTF-16 code unit，完整路径限制为 240，并为稳定数字后缀保留空间。
- 碰撞键使用 NFC 规范化及不区分大小写的折叠；保留原始可用大小写，同时稳定分配 `-2` 等后缀。
- 真实浏览器 ZIP 已解压验证 `CON`、`aux.txt`、`bad?.name`、尾随点、`Head/head`，并逐项核对 `export-report.json` 映射。

### 4. Spine 3.8 显式 PMA / Straight

- 新增 `TextureAlphaMode`，从中文 UI 经 Runtime session/load input 传入 bridge。
- 自动识别或手动选择 Spine 3.8 时均显示“预乘 Alpha（PMA）/直通 Alpha（Straight）”单选项；文件名只负责预选，用户仍须点击确认后才加载。
- 3.8 bridge 缺少选择时直接拒绝加载；明确选择覆盖 3.8 Atlas 的缺省行为并传给 renderer。
- 4.x 不使用该覆盖，仍从 Runtime page `pma` 或 Atlas page 配置自动得出混合模式；单测特意向 4.0 传入 `straight`，Atlas `pma: true` 仍绘制为 PMA。
- 真实 Chromium/WebGL 像素测试分别使用 PMA 像素 `[128,0,0,128]` 与 straight 像素 `[255,0,0,128]`；两种正确模式合成后的中心红通道均在 `118..138`，错误模式分别会落在约 `64` 或 `255`，因此测试可区分实际 blend 行为。

## TDD RED / GREEN 记录

### Atlas page name

RED：

```text
npm test -- tests/unit/atlas-page-name.test.ts tests/unit/import-files.test.ts tests/unit/parse-atlas.test.ts tests/unit/runtime-loader.test.ts tests/unit/export-zip.test.ts
```

预期失败包括：统一模块不存在、重复开头 `./` 未清除、规范化碰撞未拒绝、Runtime/导出不能以统一身份查找。

GREEN：同一目标集合 60 项通过；随后补充中央 map 碰撞断言，最终全套中该文件 2 项通过。真实浏览器 page-name ZIP 用例 1/1 通过。

### Page scale 与样本去重

RED：

```text
npm test -- tests/unit/parse-atlas.test.ts tests/unit/scale-inference.test.ts tests/unit/export-panel.test.tsx
```

观察到 15 项预期失败：scale 未类型化、没有直接倍率证据、冲突仍可静默导出、重复皮肤样本仍计数、UI 未要求确认。

GREEN：目标集合 55 项通过；真实浏览器 page-scale/冲突用例通过，随后加强为真实 ZIP/PNG/report 校验。

补充自查 RED：在冲突确认后把全局倍率由 `2` 改为 `3`，测试观察到 checkbox 仍为 `true`（目标文件 1 项失败）；实现重置后目标文件 9/9 通过，并验证导出收到新倍率 `3`。

### Windows portable path

RED：

```text
npm test -- tests/unit/safe-path.test.ts
```

3 项预期失败分别覆盖设备名/禁用字符、大小写与 Unicode 规范化碰撞、路径长度。

GREEN：目标文件 7/7 通过；真实浏览器 ZIP 解压与报告映射用例 1/1 通过。

### Spine 3.8 Alpha mode

RED：

```text
npm test -- tests/unit/runtime-loader.test.ts tests/unit/import-workflow.test.ts
```

3 项预期失败覆盖选择未传播、3.8 仍缺少显式 PMA/Straight 行为、缺失选择未拒绝；最初浏览器检查也无法找到 Alpha 确认 UI。

GREEN：目标单测 36/36 通过；两项真实 WebGL 像素测试 2/2 通过；官方 3.8 JSON、3.8 SKEL 及 4.2 完整链回归 3/3 通过。

### Offline trusted index

RED：完整 Playwright 首轮为 27/28；唯一失败是 offline package 对新 bundle 路径/hash fail closed。`SPINE_OFFLINE_SKIP_BUILD=1 node scripts/package-offline.mjs` 同样逐项报告 1 个 Vite preload 动态目标与 4 个官方 Runtime 内置加载器不再受旧 digest 信任。

审查方法：从 `HEAD` 干净归档重建旧离线 bundle，得到的五个路径及 SHA-256 与旧 trusted index 完全一致；新 bundle 连续两次构建 hash 一致。逐项核对新 Runtime 的官方来源元数据、动态 `fetch/XMLHttpRequest` 形态及共享 chunk 变化后，只替换精确路径和完整 SHA-256，没有放宽语法或 trust kind：

| Bundle | SHA-256 |
|---|---|
| `assets/index-D-1-wl_e.js` | `719f411e1d5ec59d86d95928bbee69b99811fb1500e1041ac3d34ed7ff394b8d` |
| `assets/runtime-3_8-DP0ZnDjL.js` | `6a7332f08877ed79536fa11da136aa7e234d75d879de7075e39495a0a4a05aa9` |
| `assets/runtime-4_0-D6vn5Ofx.js` | `a0f27a0e6e303f2a15ac2f05c3885d908e11d60849565aca8658a6a82b7d06ad` |
| `assets/runtime-4_1-C6HBTeNT.js` | `b85012ef8b46f291aab9310d2a3ccc760f524cb70833f32cd8a8b94731f9b560` |
| `assets/runtime-4_2-BXwJOlpe.js` | `1e1034ec43aeed4f6ccf77f12dfe5fdb8e91ea5282e8ec4cd922b00285ed66cb` |

GREEN：offline audit 35/35，通过真实离线打包；最终 offline browser 测试也在阻断所有外部请求时通过。

## 最终验证

| 命令 | 结果 |
|---|---|
| `npm test` | PASS；23 files，221 tests |
| `npm run verify-runtime-assets` | PASS；4 个隔离 Runtime；4.0/4.1/4.2 官方 tarball SHA-256 匹配，3.8 vendored 来源构建通过 |
| `npm run build` | PASS；TypeScript + Vite，1792 modules |
| `npm run build:offline` | PASS；TypeScript + Vite，1791 modules；五个 trusted digest 逐项复核匹配 |
| `npx playwright test` | PASS；Chromium 28/28 |
| `npm run package:offline`（连续两次，各自重建） | PASS；两次均生成 12-file ZIP |
| `git diff --check` | PASS |

确定性离线 ZIP：

```text
first  23c6068d08572e4c5bb42c26fe05c04aa668c54be1caca1bd9dc24cdf1897013
second 23c6068d08572e4c5bb42c26fe05c04aa668c54be1caca1bd9dc24cdf1897013
```

## 自查与残余关注

- 无阻断 concern。
- Windows portable 规则已由单元测试和 Chromium 中的真实 ZIP 解压验证，但本轮没有在物理 Windows 主机上双击启动离线包。
- Playwright 启动时仍会报告 vendored Spine 3.8 sourcemap 指向缺失源文件；不影响 bundle、Runtime 来源验证或运行行为，且不是本次引入。
- npm 输出环境级 `http-proxy` 配置弃用警告；所有命令退出码仍为 0。
- 半透明像素断言保留约 ±10 的 WebGL 栅格化容差，同时与两种错误混合结果保持足够间隔。
