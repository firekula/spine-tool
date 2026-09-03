# Spine Runtime 版本与来源

四个 Runtime 在构建时进入各自的动态 chunk。任何 `runtime-X_Y.ts` 只导入其对应的官方包或 vendored 3.8 构建；4.x 的 npm alias 各自解析到同版本 `@esotericsoftware/spine-core`，不能跨版本复用 core。

| Editor 版本 | Runtime 来源 | 固定 revision | 来源产物 SHA-256 | 隔离的 core |
| --- | --- | --- | --- | --- |
| 3.8 | [官方 `spine-runtimes/spine-ts`](https://github.com/EsotericSoftware/spine-runtimes/tree/8b4844bd4b193ba9e54487ed397a777993cbad56/spine-ts) | commit `8b4844bd4b193ba9e54487ed397a777993cbad56` | `a31be4f37fb5ffa9b88822c38889efa406fb2201046592b8fdcb6d22925db9a4`（`git archive --format=tar <commit> spine-ts`） | vendored namespace build，自包含 core |
| 4.0 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.0.31`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.0.31.tgz) | `4.0.31` | `fdfe7fc72b870a4da238f349634dd043390b5035dbce6782e7e4288adc6648a1`（tarball） | `@esotericsoftware/spine-core@4.0.31` |
| 4.1 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.1.56`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.1.56.tgz) | `4.1.56` | `fc9c0c579e7d91fcba007fabdc7ecced6fad70fca84bd6e3374a3a4f6ac23e4d`（tarball） | `@esotericsoftware/spine-core@4.1.56` |
| 4.2 | [官方 npm tarball `@esotericsoftware/spine-webgl@4.2.120`](https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.2.120.tgz) | `4.2.120` | `d1cfacd523602524ed497c8b794cd394a52cc8118cf6a680b4542585e1f36666`（tarball） | `@esotericsoftware/spine-core@4.2.120` |

## 3.8 构建记录

官方 npm 包没有 3.8.x，因此没有用第三方 Runtime 替代。`vendor/spine-runtime-3.8/spine-webgl.js` 来自上述固定 commit 的 `spine-ts`：安装官方构建脚本所需的 `@types/offscreencanvas@2019.7.3`，再用 TypeScript 3.9.10 执行 `tsc -p tsconfig.webgl.json`。生成的 JS SHA-256 为 `46fa3cc7d59ccbd81f69f2e04313092243133d3e32e6bca953d63aefdcbdafa3`。

旧构建输出的是全局 `spine` namespace。为让 Vite 作为隔离 ESM chunk 导入，只在生成文件末尾追加 `export { spine }` 边界；追加后的 vendored JS SHA-256 为 `f50f6e18535881b5563b12bf0fa16a12972125677da3496959acdd5ed2619123`。完整机器可读记录位于 `vendor/spine-runtime-3.8/SOURCE.json`。

## 许可

- `vendor/spine-runtime-3.8/LICENSE` 是 3.8 commit 中 `spine-ts/LICENSE` 的未改写副本（SHA-256 `6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39`）。
- `public/licenses/SPINE-RUNTIMES-LICENSE.txt` 是 4.2.120 官方 npm 包 `LICENSE` 的未改写副本（SHA-256 `435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e`）；4.0.31 与 4.1.56 自身的官方 LICENSE 也随各自 npm 包进入依赖树。

运行 `npm run verify-runtime-assets` 会校验版本、package-lock 完整性、vendored 哈希、许可副本，以及一次不落盘的 Vite 构建中四个动态 chunk 的实际模块来源和 core 隔离。

对 4.x，验证脚本还会要求 lockfile 的 `resolved` 精确等于表中的官方 registry tarball URL，并要求完整 SRI 分别为：

- 4.0.31：`sha512-G6j31+caQJck/4UN8TVaTKnU0RPysI7ECMkCxcXBGsTmv98m0O5Wx18YgeIf//Bg8KAO+mZ/DmwzeScwGG9HPA==`
- 4.1.56：`sha512-LNr/X4B81/rC96mzFV+L5LPnqaIj1v3RBCKTagmFlAd/2MtXcxwEatIQVPq487NigFwlrkvmxQuMpl1TRf3xxw==`
- 4.2.120：`sha512-xhITm18dZ6DclPaI1jEiTVOoXYQASsubbDEs3Ik1AjmVSXdNFtvdvzLVwhPQ8eHu1OXsxtWfuW+wpGHib8V4hw==`

脚本通过官方 package spec 执行离线 `npm pack`（读取 npm cache），对实际 `.tgz` 同时重算完整 SRI 与 SHA-256；无匹配缓存或任一摘要不一致都会失败，不会只信任文档或 lockfile 字符串。
