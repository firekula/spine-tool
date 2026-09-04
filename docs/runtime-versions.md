# Spine Runtime 版本与来源

`scripts/runtime-sources.json` 固定 3.5–4.3 八条官方来源。当前已集成的 3.5、3.6、3.8–4.2 Runtime 在构建时进入各自的动态 chunk；3.7 与 4.3 只固定来源或依赖，等对应 adapter 与 vendor 资产真实存在后才纳入 chunk 验证。任何 `runtime-X_Y.ts` 只导入其对应的官方包或 vendor 构建；4.x 的 npm alias 各自解析到同版本 `@esotericsoftware/spine-core`，不能跨版本复用 core。

| Editor 版本 | Runtime 来源 | 固定 revision | 来源产物 SHA-256 | 隔离的 core |
| --- | --- | --- | --- | --- |
| 3.5 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/afdbbc2044fb56c762d4e2eb54b63b1bb9276a48/spine-ts) | commit `afdbbc2044fb56c762d4e2eb54b63b1bb9276a48` | `a40a64268da2782405b66516c45736f7c86d438fe82e8e950733b5f3aa74a7c5`（`git archive --format=tar <commit> spine-ts`） | vendored namespace build，自包含 core（仅 JSON） |
| 3.6 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/654c20e5b0e523040b6366bbd1042510d2645134/spine-ts) | commit `654c20e5b0e523040b6366bbd1042510d2645134` | `cb9da14b05076037bdfc136840f3a1ab5a50da6390da0a3e5e2dbe8a0b7348e9`（`git archive --format=tar <commit> spine-ts`） | vendored namespace build，自包含 core（仅 JSON） |
| 3.7 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/9639bcc81722d7178fd9d1cdc1a3d55a4c91f989/spine-ts) | commit `9639bcc81722d7178fd9d1cdc1a3d55a4c91f989` | `6d955be39f6898cfaeec2b9a0e0f475c8437f8d550eedf9ef618937eadf043eb`（`git archive --format=tar <commit> spine-ts`） | 待集成的 vendor namespace build |
| 3.8 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/8b4844bd4b193ba9e54487ed397a777993cbad56/spine-ts) | commit `8b4844bd4b193ba9e54487ed397a777993cbad56` | `a31be4f37fb5ffa9b88822c38889efa406fb2201046592b8fdcb6d22925db9a4`（`git archive --format=tar <commit> spine-ts`） | vendored namespace build，自包含 core |
| 4.0 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.0.31`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.0.31.tgz) | `4.0.31` | `fdfe7fc72b870a4da238f349634dd043390b5035dbce6782e7e4288adc6648a1`（tarball） | `@esotericsoftware/spine-core@4.0.31` |
| 4.1 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.1.56`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.1.56.tgz) | `4.1.56` | `fc9c0c579e7d91fcba007fabdc7ecced6fad70fca84bd6e3374a3a4f6ac23e4d`（tarball） | `@esotericsoftware/spine-core@4.1.56` |
| 4.2 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.2.120`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.2.120.tgz) | `4.2.120` | `d1cfacd523602524ed497c8b794cd394a52cc8118cf6a680b4542585e1f36666`（tarball） | `@esotericsoftware/spine-core@4.2.120` |
| 4.3 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.3.9`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.3.9.tgz) | `4.3.9` | `fd8f6a38f9ab394e84801967209c304738c7ac84f1db9a7d8b0428203114b390`（tarball） | `@esotericsoftware/spine-core@4.3.9`（adapter 待集成） |

## 3.5、3.6 与 3.8 构建记录

3.5 vendor 使用 TypeScript 2.3.4 执行固定 commit 自带的 `tsc -p tsconfig.webgl.json`，不安装额外类型包；官方生成 JS SHA-256 为 `067b966379a1264abc42977517a3fbe10cfba5d819d78b45437ed17d180280f6`。该版官方 `spine-ts` 没有 `SkeletonBinary`，因此 adapter 明确只声明 JSON 能力；3.5 SKEL 不会转交给其他版本 Runtime。

3.6 vendor 同样使用 TypeScript 2.3.4 执行固定 commit 自带的 `tsc -p tsconfig.webgl.json`，不安装额外类型包；官方源码构建的 JS SHA-256 为 `ca5c82a86151232f1c7f1fb6a54021da2706b83e5dd0b95426ef994f6629b025`。该版官方 `spine-ts` 没有 `SkeletonBinary`，因此 adapter 明确只声明 JSON 能力；3.6 SKEL 不会转交给其他版本 Runtime。

官方 npm 包没有 3.8.x，因此没有用第三方 Runtime 替代。`vendor/spine-runtime-3.8/spine-webgl.js` 来自上述固定 commit 的 `spine-ts`：安装官方构建脚本所需的 `@types/offscreencanvas@2019.7.3`，再用 TypeScript 3.9.10 执行 `tsc -p tsconfig.webgl.json`。生成的 JS SHA-256 为 `46fa3cc7d59ccbd81f69f2e04313092243133d3e32e6bca953d63aefdcbdafa3`。

旧构建输出的是全局 `spine` namespace。为让 Vite 作为隔离 ESM chunk 导入，只在生成文件末尾追加 `export { spine }` 边界；追加后的 vendored JS SHA-256 为 `f50f6e18535881b5563b12bf0fa16a12972125677da3496959acdd5ed2619123`。完整机器可读记录位于 `vendor/spine-runtime-3.8/SOURCE.json`。`scripts/vendor-legacy-runtime.mjs --version X.Y --commit SHA --archive PATH` 只接受清单中对应 commit 且 SHA-256 匹配的官方 archive；来源 hash 或构建配置未固定时会 fail-closed，不生成资产。

## 许可

- 3.5 与 3.6 vendor 中 `spine-ts/LICENSE` 的 SHA-256 均为 `d2af98ecac7e4bb6e4c4491fc734db7762b94626b18bcc87c7eac6febd86e1b5`；3.7 固定 commit 中许可证为 `6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39`，尚未集成。
- `vendor/spine-runtime-3.8/LICENSE` 是 3.8 commit 中 `spine-ts/LICENSE` 的未改写副本（SHA-256 `6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39`）。
- `public/licenses/SPINE-RUNTIMES-LICENSE.txt` 是 4.2.120/4.3.9 官方 npm 包 `LICENSE` 的未改写副本（SHA-256 `435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e`）；4.0.31 与 4.1.56 自身的官方 LICENSE 也随各自 npm 包进入依赖树。

运行 `npm run verify-runtime-assets` 会校验八条来源记录、package alias、package-lock 中 webgl/core 各自的官方 `resolved`/`integrity`、已安装 package 与 core 版本、关键入口及 core 完整 `dist` tree 的 hash、webgl/core LICENSE hash、vendor `SOURCE.json`/ESM 边界，以及一次不落盘的 Vite 构建中所有已集成动态 chunk 的实际模块来源和 core 隔离。未集成版本只报告“来源已固定（Runtime 待集成）”，不会声称不存在的构建产物或 chunk 已验证。

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
