# Spine Runtime 版本与来源

`scripts/runtime-sources.json` 固定 3.5–4.3 八条官方来源。3.5、3.6、3.7、3.8 与 4.0–4.3 Runtime 都已集成，并在构建时进入各自的动态 chunk。任何 `runtime-X_Y.ts` 只导入其对应的官方包或 vendor 构建；4.x 的 npm alias 各自解析到同版本 `@esotericsoftware/spine-core`，不能跨版本复用 core。

## 用户文件能力矩阵

| Editor 版本线 | JSON | SKEL | 兼容策略 |
| --- | --- | --- | --- |
| 3.5 | 支持 | 不支持 | 3.5 Runtime；SKEL 返回中文能力错误 |
| 3.6 | 支持 | 不支持 | 3.6 Runtime；SKEL 返回中文能力错误 |
| 3.7 | 支持 | 不支持 | 3.7 Runtime；SKEL 返回中文能力错误 |
| 3.8 | 支持 | 支持 | 3.8 Runtime；`3.8.75` 显示警告并尽力兼容 |
| 4.0 | 支持 | 支持 | 4.0 Runtime |
| 4.1 | 支持 | 支持 | 4.1 Runtime |
| 4.2 | 支持 | 支持 | 4.2 Runtime |
| 4.3 | 支持 | 支持 | 4.3 Runtime；预发布/Beta 显示警告 |

稳定补丁号按相同 `major.minor` 路由，不跨版本读取。静态 Runtime registry 为每条版本线显式声明 JSON/SKEL 能力。3.5–3.7 的官方 Web Runtime 没有 `SkeletonBinary`，所以这些版本只支持 JSON；SKEL 会在 Alpha 确认以及 Runtime module、对象 URL、canvas/WebGL 或预览 session 创建前被拒绝，手动 Runtime 重试也不会绕过限制，已经解码的 Atlas-only 资源则继续保留供导出。

JSON 与 SKEL 共用完整版本语法校验。完整的 `major.minor` 或 `major.minor.patch` 可带由非空标识符组成的预发布后缀；`4.3.bad`、`4.3.`、`4.3.9foo`、`4.3.9-` 和 `4.3.0-beta..2` 都是未知/不支持，而不会误进 4.3 Runtime。4.x SKEL 的两个数值 hash 后版本分支由官方完整 `4.3.75-beta` fixture 覆盖，fixture 来源 revision 和 SHA-256 固定在 `tests/fixtures/official-spine/SOURCES.json`。

3.5–3.8 预览和导出前都需用户明确确认 `PMA` 或 `Straight Alpha`；文件名只负责预选。4.x 按每个 Atlas 页大小写不敏感的 `pma: true|false` 分别处理，未声明时按 Straight，因此混合 PMA/Straight 的多页图集也能正确导出。Straight/PMA 页都通过 WebGL 读取 PNG 原始 RGBA 通道；PMA 在任何缩放/PNG 编码前反预乘，Alpha 为 0 时 RGB 归零，最终导出始终是 Straight Alpha PNG。批次只保留当前一个纹理页缓存并在压缩前释放，报告逐 Region 记录 Alpha 来源、输入模式和转换；因此无损导出也要求可用 WebGL。

纹理在浏览器解码前必须通过 PNG 签名与 IHDR 门禁；重置、替换导入或组件卸载会通过 `AbortSignal` 停止后续页面，并关闭已经返回的 `ImageBitmap`。选择阶段最多接受一个 Atlas、一个骨骼文件和 64 张 PNG；在读取全文前分别限制 Atlas 为 8 MiB、JSON/SKEL 为 128 MiB、单张 PNG 为 128 MiB、PNG 累计为 256 MiB，并在第 65 个 Atlas 页面声明立即停止。Atlas 解析和导出层都限制每批最多 4,096 个 Region；此外分别限制解码像素、所有实际使用页的原始 RGBA、恢复 RGBA 与压缩前 PNG/report entry 总量，避免小 Region 数量、未使用 PNG 或伪装扩展名绕过内存预算。

| Editor 版本 | Runtime 来源 | 固定 revision | 来源产物 SHA-256 | 隔离的 core |
| --- | --- | --- | --- | --- |
| 3.5 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/afdbbc2044fb56c762d4e2eb54b63b1bb9276a48/spine-ts) | commit `afdbbc2044fb56c762d4e2eb54b63b1bb9276a48` | `a40a64268da2782405b66516c45736f7c86d438fe82e8e950733b5f3aa74a7c5`（`git archive --format=tar <commit> spine-ts`） | vendored namespace build，自包含 core（仅 JSON） |
| 3.6 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/654c20e5b0e523040b6366bbd1042510d2645134/spine-ts) | commit `654c20e5b0e523040b6366bbd1042510d2645134` | `cb9da14b05076037bdfc136840f3a1ab5a50da6390da0a3e5e2dbe8a0b7348e9`（`git archive --format=tar <commit> spine-ts`） | vendored namespace build，自包含 core（仅 JSON） |
| 3.7 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/9639bcc81722d7178fd9d1cdc1a3d55a4c91f989/spine-ts) | commit `9639bcc81722d7178fd9d1cdc1a3d55a4c91f989` | `6d955be39f6898cfaeec2b9a0e0f475c8437f8d550eedf9ef618937eadf043eb`（`git archive --format=tar <commit> spine-ts`） | vendored namespace build，自包含 core（仅 JSON） |
| 3.8 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/8b4844bd4b193ba9e54487ed397a777993cbad56/spine-ts) | commit `8b4844bd4b193ba9e54487ed397a777993cbad56` | `a31be4f37fb5ffa9b88822c38889efa406fb2201046592b8fdcb6d22925db9a4`（解压后的固定 `git archive`）；仓库内确定性 gzip 为 `258c42722ae77b0e115a52c0d5dde05671d513cc3cad257dd453097e9373e693` | vendored namespace build，自包含 core |
| 4.0 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.0.31`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.0.31.tgz) | `4.0.31` | `fdfe7fc72b870a4da238f349634dd043390b5035dbce6782e7e4288adc6648a1`（tarball） | `@esotericsoftware/spine-core@4.0.31` |
| 4.1 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.1.56`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.1.56.tgz) | `4.1.56` | `fc9c0c579e7d91fcba007fabdc7ecced6fad70fca84bd6e3374a3a4f6ac23e4d`（tarball） | `@esotericsoftware/spine-core@4.1.56` |
| 4.2 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.2.120`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.2.120.tgz) | `4.2.120` | `d1cfacd523602524ed497c8b794cd394a52cc8118cf6a680b4542585e1f36666`（tarball） | `@esotericsoftware/spine-core@4.2.120` |
| 4.3 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.3.9`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.3.9.tgz) | `4.3.9` | `fd8f6a38f9ab394e84801967209c304738c7ac84f1db9a7d8b0428203114b390`（tarball） | `@esotericsoftware/spine-core@4.3.9` |

## 3.5–3.8 构建记录

3.5 vendor 使用 TypeScript 2.3.4 执行固定 commit 自带的 `tsc -p tsconfig.webgl.json`，不安装额外类型包；官方生成 JS SHA-256 为 `067b966379a1264abc42977517a3fbe10cfba5d819d78b45437ed17d180280f6`。该版官方 `spine-ts` 没有 `SkeletonBinary`，因此 adapter 明确只声明 JSON 能力；3.5 SKEL 不会转交给其他版本 Runtime。

3.6 vendor 同样使用 TypeScript 2.3.4 执行固定 commit 自带的 `tsc -p tsconfig.webgl.json`，不安装额外类型包；官方源码构建的 JS SHA-256 为 `ca5c82a86151232f1c7f1fb6a54021da2706b83e5dd0b95426ef994f6629b025`。该版官方 `spine-ts` 没有 `SkeletonBinary`，因此 adapter 明确只声明 JSON 能力；3.6 SKEL 不会转交给其他版本 Runtime。

3.7 vendor 使用 TypeScript 2.8.4 执行固定 commit 自带的 `tsc -p tsconfig.webgl.json`，不安装额外类型包；官方源码构建的 JS SHA-256 为 `074079ce08c0ad643578da8ec17dfe7e1e5d7ec7065106b05cd4cc703dca9c68`。该 compiler 的输出经上游 `build.sh` 指定的 `unexpand -t 4` 后与 commit 内自带的 `spine-webgl.js`、declaration 和 source map 逐字节一致，vendor 则与既有 legacy 流程相同保留 `tsc` 原始输出再追加固定 ESM 边界。该版官方 `spine-ts` 没有 `SkeletonBinary`，因此 adapter 明确只声明 JSON 能力；3.7 SKEL 不会转交给其他版本 Runtime。

官方 npm 包没有 3.8.x，因此没有用第三方 Runtime 替代。`vendor/spine-runtime-3.8/spine-webgl.js` 来自上述固定 commit 的 `spine-ts`。仓库提交了 10.65 MB 的确定性 gzip 来源归档；校验器先核对压缩文件 hash，再解压并核对原始 tar hash。构建只使用 lockfile 固定的 npm alias `offscreencanvas-types-2019`（`@types/offscreencanvas@2019.7.3`）与 `typescript-3.9`（`typescript@3.9.10`），直接调用已安装的 compiler，不调用 npm、npx、registry 或 npm cache。未补丁上游 JS SHA-256 为 `46fa3cc7d59ccbd81f69f2e04313092243133d3e32e6bca953d63aefdcbdafa3`。受控兼容 patch（SHA-256 `3218fce4eef0781e1814b38842806d3d7b3d249615b8af652ec8e356af88d394`）只删除 JSON/Binary reader 对精确 `3.8.75` 的主动拒绝；补丁后 namespace JS SHA-256 为 `5b3e8ec15c3c70c8c2db03a23248538b3bca9ee01a25094a52bbe5eb26e803f7`。

旧构建输出的是全局 `spine` namespace。为让 Vite 作为隔离 ESM chunk 导入，只在补丁后生成文件末尾追加 `export { spine }` 边界；最终 vendored JS SHA-256 为 `94ce2ebffcb581a45aac1f88a8aeafd12232fe37f8f45b5274d42ddbe881c00e`。完整机器可读记录位于 `vendor/spine-runtime-3.8/SOURCE.json`，分别固定上游、补丁后和最终 JS/declaration/source map hash。`scripts/vendor-legacy-runtime.mjs --version X.Y --commit SHA --archive PATH` 只接受清单中对应 commit 且 SHA-256 匹配的官方 archive；来源、patch 或任一构建 hash 未固定时会 fail-closed，不生成资产。

## 许可

八条 Runtime 实际对应三份不同的官方许可原文。公开副本逐字节匹配下表的固定来源，并随在线 `dist`、离线 ZIP 和源码 ZIP 交付：

| Runtime 版本 | 仓库/发布路径 | SHA-256 | 固定原始来源 |
| --- | --- | --- | --- |
| 3.5–3.6 | `public/licenses/SPINE-RUNTIMES-LICENSE-v2.5.txt`（发布包为 `licenses/...`） | `d2af98ecac7e4bb6e4c4491fc734db7762b94626b18bcc87c7eac6febd86e1b5` | `vendor/spine-runtime-3.5/LICENSE` / `3.6/LICENSE` |
| 3.7–4.1 | `public/licenses/SPINE-RUNTIMES-LICENSE-2019.txt`（发布包为 `licenses/...`） | `6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39` | `vendor/spine-runtime-3.7/LICENSE`；3.8 vendor 与 4.0/4.1 npm 包同文同 hash |
| 4.2–4.3 | `public/licenses/SPINE-RUNTIMES-LICENSE-2025.txt`（发布包为 `licenses/...`） | `435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e` | `@esotericsoftware/spine-webgl@4.2.120` / `4.3.9` 的 `LICENSE` |

`node_modules` 中的 npm LICENSE 仅作为固定来源验证输入；`node_modules`、npm cache 和依赖树本身不进入任何交付包。离线包的完整资产、launcher 与许可门禁见 [离线包安全与完整性](security-offline.md)。

运行 `npm run verify-runtime-assets` 会进行严格验证：除校验八条来源记录、package alias、package-lock 中 webgl/core 各自的官方 `resolved`/`integrity`、已安装 package 与 core 版本、关键入口及 core 完整 `dist` tree 的 hash、webgl/core LICENSE hash、vendor `SOURCE.json`/ESM 边界，以及一次不落盘的 Vite 构建中八个动态 Runtime chunk 的实际模块来源和 core 隔离外，还会强制从仓库内固定的 3.8 gzip 来源归档与 patch 完整重建，并逐文件比较 JS、declaration、source map、LICENSE 与 SOURCE.json。归档缺失或任一压缩前后 hash、构建工具 pin、patch 语义、上游/补丁后/最终 hash 不匹配都会失败；`npm run package:offline` 的生命周期门禁也会先执行这条严格验证。普通开发可显式运行 `npm run verify-runtime-assets:fast` 跳过重建，但其输出明确标记不得用于 CI 或发布。

对 4.x，验证脚本还会要求 lockfile 的 `resolved` 精确等于表中的官方 registry tarball URL，并要求完整 SRI 分别为：

- 4.0.31：`sha512-G6j31+caQJck/4UN8TVaTKnU0RPysI7ECMkCxcXBGsTmv98m0O5Wx18YgeIf//Bg8KAO+mZ/DmwzeScwGG9HPA==`
- 4.1.56：`sha512-LNr/X4B81/rC96mzFV+L5LPnqaIj1v3RBCKTagmFlAd/2MtXcxwEatIQVPq487NigFwlrkvmxQuMpl1TRf3xxw==`
- 4.2.120：`sha512-xhITm18dZ6DclPaI1jEiTVOoXYQASsubbDEs3Ik1AjmVSXdNFtvdvzLVwhPQ8eHu1OXsxtWfuW+wpGHib8V4hw==`
- 4.3.9：`sha512-eAcqxurSXyGeQg9RFlqSUOqEiMYQcKsKKgcxzNwzcu18G7tcUZMcX7cB5zkN1mlfxtuGtZVx5bmGYSlUBUTrkQ==`

各 alias 使用的 `@esotericsoftware/spine-core` 也在来源清单中单独固定官方 tarball URL、完整 SRI、入口文件 SHA-256、完整 `dist` tree SHA-256 与 LICENSE SHA-256。core SRI 分别为：

- 4.0.31：`sha512-SiP87Xudw8qfg6t1Gv4NVoqP+Tw0eaCj1ApS+GXLdCvb/i5FNQevqEt4RgEvD8j1vJy+WVriPLMJYQSdaSehgA==`
- 4.1.56：`sha512-sJbqIof+yE7LbkImbJt2cHfYcGBqadABttx8RY3ggu4JCa0sZLGdh+tWwe0+aRoN/91VI0rGSgG16fmkZ7Hc8Q==`
- 4.2.120：`sha512-X62MPnfiZTWok4Wk5Q5DqaAUBUFypKpb94IVd1W/j4eLHhg0HH3tve4HvIlkgxDpls2NokHaAtzjxX12rJknOA==`
- 4.3.9：`sha512-6Vb3DVM8ci2JoDdfpk191IkAMSvVm3YugfA6k27OcvO7f7DmZLrRKHQIICw+XbUVkGa/41VWG2dKZebpdmnvsg==`

验证脚本不会执行 `npm pack`、访问 registry 或读取 npm cache。若仓库显式保留清单约定路径下的 `.tgz`，脚本会额外重算完整 SRI 与 SHA-256；未保留 tarball 时，已安装 package 的版本、核心构建产物与 LICENSE hash 仍必须和来源清单及 lockfile 同时一致，任一处不一致都会失败。
