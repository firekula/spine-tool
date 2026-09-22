# 更新记录

本文件记录工具的重要变更，日期为提交日期。

## 未发布

### 修复

- 修复 PNG 小于 Atlas 声明页面尺寸时整份 Atlas 被拒绝、Region 右侧和底部透明区域丢失的问题（2026-09-22）。部分素材的 PNG 比 Atlas 的页级 `size` 少若干像素（导出后被裁掉整行/整列透明像素），旧逻辑直接用解码尺寸覆盖页面 `size`，任何落在 PNG 之外的 Region 都会触发 `REGION_OUT_OF_BOUNDS` 并在恢复前终止整批导出。现在页面框取 Atlas 声明尺寸与 PNG 解码尺寸的并集，PNG 之外的像素按完全透明读取（与官方拆图一致），旋转 Region 的图外取样同样返回透明而不再回绕到相邻行像素；导入时仍拒绝同时超出声明尺寸和 PNG 实际尺寸的 Region，并新增“PNG 小于 Atlas 声明尺寸”诊断（`TEXTURE_PAGE_PADDED`）与报告字段 `sourcePadding`。新增 `lib/atlas/page-padding.ts` 及单元测试、浏览器级回归用例。
- 新增 Region 引用诊断：当 JSON 的 Region/Mesh 附件引用的名称与 Atlas 中的 Region 名只差首尾空格时（Spine Runtime 解析 Atlas 时会裁剪 Region 名，但读取 JSON 附件 `path` 时不裁剪，两者无法精确匹配），工具会在加载任何 Runtime 之前给出中文诊断，指明槽位、附件、JSON 中的 `path`、Atlas 中的 Region 名以及修复方式，不再只显示 Runtime 的英文 `Region not found in atlas` 报错；引用完全不存在的 Region 时也会单独报告（2026-09-08）。新增 `lib/atlas/region-references.ts` 及单元测试；该检查只做诊断，不改写任何骨骼或 Atlas 数据。
- 修复导入在部分旧版 Chromium 内核中必然失败的问题（2026-09-08）。这些内核缺少 `AbortSignal.prototype.throwIfAborted`，导入流程在解析任何文件之前就会抛出 `o.throwIfAborted is not a function`，界面表现为 `IMPORT_FAILED`、错误对象为所选 `.atlas`。导入改为使用与 `restore-region`、`export-zip` 一致的 `signal.aborted` 本地检查，不再依赖该较新 API；该问题与 Spine 版本无关，修复后 `3.8.75` 等素材可在 Chromium 约 87 及以上的内核中正常识别与导入。
- 同步重建离线包并更新 `scripts/offline-assets.json` 与 `scripts/offline-runtime-audit.mjs` 中的固定 SHA-256（主 chunk 变化会级联改变引用它的 Runtime chunk 与 `index.html`），`ready-to-run` 内容已与清单逐字节核对。

### 构建

- 新增 `scripts/build-docker-image.mjs` 与 `npm run docker:build` / `npm run docker:package`：用 Node 实现、不依赖 gzip，跨平台构建镜像，支持 `--tag`、`--platform`、`--no-cache`，导出 `.tar.gz` 归档后打印大小与 SHA-256。
- `Dockerfile` 新增构建参数 `NPM_REGISTRY`（默认 `https://registry.npmjs.org`），`scripts/build-docker-image.mjs` 新增 `--npm-registry <地址>`（2026-09-22）。构建阶段直连官方源会 `ECONNRESET` 时改用镜像源，只影响 `npm ci` 的下载来源，不影响镜像内容。
- 镜像版本升到 `spine-tool:0.1.1`（`package.json`、`Dockerfile` 标签、`docker-compose.yml` 同步），并重建 `docker-image/spine-tool-0.1.1.tar.gz`（`linux/amd64`，20.6 MB，SHA-256 `a1121a89b8354c7f89428212dfdce32207eea41ee0bc9a9caceb740400cce2be`）。与 0.1.0 的差异只有上面的透明补齐修复，容器配置、端口和服务方式不变。

### 文档

- README 补充浏览器兼容性说明与更新记录入口。
- README 的倍率与导出章节新增「Atlas 声明尺寸与 PNG 不一致时按并集补齐透明像素」的说明（含新增诊断与 `sourcePadding` 字段）；[DOCKER.md](DOCKER.md) 补充构建阶段 `NPM_REGISTRY` 参数用法。
- 新增 Docker 部署：`Dockerfile`（`node:22-alpine` 构建 → `nginx:1.27-alpine` 提供服务）、`docker-compose.yml`、`docker/nginx.conf`、`.dockerignore` 与 [DOCKER.md](DOCKER.md)，并导出 `docker-image/spine-tool-0.1.0.tar.gz`（`linux/amd64`）。nginx 配置包含 SPA 回退、哈希资源长期缓存、gzip、`/healthz` 与安全响应头（含与离线包一致的 CSP）；已用真实 Chrome 验证页面渲染、`blob:` Worker 与 `self` 模块 Worker 可用、无 CSP 违规。

## 历史

- 2026-09-07：修复 `Start-Offline.ps1` 的 UTF-8 BOM，兼容 Windows PowerShell 5.1 解析中文脚本；恢复最终交付快照并纳入离线分发包。
- 2026-09-04：补充 Spine 3.5–4.3 支持文档；加固离线压缩包路径遍历防护；固定离线运行时产物与哈希门禁。
- 更早：接入 Spine 3.5–4.3 工作流，新增 3.5–3.7 JSON、3.8/4.0–4.3 JSON 与 SKEL 支持，并加固 Spine 4.3 集成。
