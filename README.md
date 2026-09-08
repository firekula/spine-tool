# Spine 动画预览与 Atlas 子图导出工具

一个完全在浏览器本地运行的 Spine 文件预览和 Atlas Region PNG 导出工具。导入内容、预览和 ZIP 导出都不会上传到服务器。

## 支持范围

- Spine Runtime：3.5、3.6、3.7、3.8、4.0、4.1、4.2、4.3
- 图集：一个 `.atlas`，配套的一张或多张 `.png` 纹理页
- 预览：动画、单一/组合皮肤、插槽显示与隐藏
- 导出：按 Region 恢复后的原始逻辑尺寸 PNG，以及 `export-report.json`，全部打包为 ZIP

| Spine Editor 版本线 | JSON | SKEL | 说明 |
| --- | --- | --- | --- |
| 3.5、3.6、3.7 | 支持 | 不支持 | 对应官方 Web Runtime 没有二进制读取器；SKEL 在 Alpha 确认和任何 Runtime、对象 URL、WebGL 创建前即显示中文能力错误，不会交给其他版本 Runtime |
| 3.8 | 支持 | 支持 | `3.8.75` 为尽力兼容，会显示官方已知导出问题警告 |
| 4.0、4.1、4.2 | 支持 | 支持 | 使用各自隔离的同版本 Runtime |
| 4.3 | 支持 | 支持 | Beta/预发布数据会显示兼容性警告后尝试加载 |

同一 `major.minor` 下的稳定补丁号会路由到该版本线的 Runtime，例如 `3.8.99` 使用 3.8 Runtime。版本字符串必须完整符合 `major.minor` 或 `major.minor.patch`，可带由非空标识符组成的预发布后缀；`4.3.bad`、`4.3.`、`4.3.9foo`、`4.3.0-beta..2` 等畸形值会被视为未知/不支持。工具不会静默使用另一个 `major.minor` Runtime，也不会改写或转换骨骼文件。Beta 等预发布版本只提供带警告的尝试加载，不承诺与稳定 Runtime 完全兼容。

需要使用支持 ES module 的 Chrome、Edge 或 Firefox，并开启硬件加速/WebGL。导入流程只依赖 `AbortSignal.aborted`，不再调用较新的 `AbortSignal.prototype.throwIfAborted`，因此在较旧的 Chromium 内核（约 Chromium 87 及以上）中也能完成导入与 Atlas 导出；无损 Region 恢复仍需要 WebGL。Runtime 无法加载骨骼时仍可使用 Atlas-only 导出，但 Straight/PMA 都通过 WebGL 读取原始 RGBA 通道；缺少 WebGL 时无损 Region 导出会受控失败并提示启用 WebGL。

## 导入与操作

一次选择同一套资源中的下列文件：

- 恰好一个 `.atlas`
- 恰好一个 `.json` 或 `.skel`
- Atlas 声明的全部 PNG 纹理页

工具会自动匹配单页或多页纹理、在浏览器解码前校验每张文件的 PNG 签名与 IHDR、检测 Spine 版本并加载相应 Runtime。版本无法确定时可手动选择 Runtime；自动预览失败后也可重新手动选择并重试，原文件不会被修改。重置、替换导入或离开页面会取消尚未完成的纹理解码，并立即释放已经解码的页面。可在“动画”选择和搜索动画；在“皮肤”切换单一皮肤或组合皮肤；在“插槽”显示、隐藏或批量恢复插槽。预览区支持鼠标滚轮缩放、拖动平移，以及方向键、`+`、`-`、`Home` 和 `0` 键盘操作。

若 JSON 的 Region 或 Mesh 附件引用的名称与 Atlas 中的 Region 名只差首尾空格，工具会在加载任何 Runtime 之前给出中文诊断，指明具体槽位、附件、JSON 中的 `path` 和 Atlas 中的 Region 名，而不是只显示 Runtime 的英文 `Region not found in atlas` 报错。Spine Runtime 解析 Atlas 时会裁剪 Region 名的首尾空格，但读取 JSON `path` 时不裁剪，因此这类素材在任何 Runtime 版本下都无法加载；该诊断只做提示，不会改写骨骼或 Atlas 数据。引用完全不存在的 Region 时会单独报告缺失。

Spine 3.x 的旧 Atlas 可能没有可靠的 `pma` 信息。工具会要求明确确认 `PMA` 或 `Straight Alpha` 后再预览和导出；文件名只能预选建议值。4.x 按每个 Atlas 页大小写不敏感的 `pma: true|false` 分别处理，因此同一多页 Atlas 可以混合 PMA 与 Straight 页面。所有导出的 PNG 都是 Straight Alpha：PMA 页会在缩放和编码前反预乘，Alpha 为 0 的像素会把 RGB 归零。选错 3.x 模式会造成半透明边缘异常，但不会改变 Atlas 子图的裁切坐标。

若版本检测、早期 SKEL 能力检查或 Runtime 解析失败，只要 Atlas 和 PNG 有效，仍会保留 Atlas-only 资源并可导出 Region ZIP；无损 Region 导出仍要求 WebGL。

## 倍率与导出报告

工具会还原 Atlas 的旋转、裁剪、偏移和 `orig` 逻辑尺寸，并从页级 `scale` 或 Region 附件尺寸推算导出倍率。Atlas 的 `rotate: true` 表示打包时把源图逆时针旋转 90°，数字 `90`/`270` 同样表示打包角度；恢复时应用其逆变换。页级 `size` 可以省略或写为官方未知尺寸形式 `0,0`，工具会使用解码后的 PNG 实际尺寸，并在导出前据此拒绝越界 Region。若 Spine 以 50% 导出且 Atlas 记录 `scale: 0.5`，工具会按 2 倍恢复逻辑尺寸。界面会显示高、中、低置信度；低置信度代表证据不足或存在异常尺寸，请在导出前核对，必要时修改全局倍率或单个 Region 倍率。

“导出全部 ZIP”生成的 ZIP 包含成功恢复的 PNG 和 `export-report.json`。报告记录每个 Region 的输出路径、尺寸、使用倍率、跳过或失败原因，以及 `alpha.source`、`alpha.inputMode`、`alpha.conversion`，方便复查。恢复阶段显示 Region 进度，压缩阶段显示“正在压缩 ZIP…”；点击“取消导出”会终止专用压缩 Worker 并释放本次纹理租约。固定文件顺序、时间戳和 DEFLATE 参数保证相同输入产生确定性 ZIP。

为避免异常素材耗尽浏览器内存，一次最多选择一个 Atlas、一个骨骼文件和 64 张纹理；Atlas 文件最多 8 MiB、JSON/SKEL 最多 128 MiB、单张 PNG 最多 128 MiB、PNG 文件累计最多 256 MiB，每份 Atlas 最多 4,096 个 Region。单页最多 16,777,216 像素，全部页面累计最多 33,554,432 像素。批次输出的 RGBA 估算上限为 256 MiB，所有实际使用页面的原始 RGBA 累计预检上限为 128 MiB，压缩前保留的 PNG 与报告 entry 累计上限为 256 MiB；实际恢复只缓存当前一个纹理页的原始通道，并在进入 ZIP 压缩前清空。Region 数上限也让 ZIP 条目远低于当前非 ZIP64 编码器的 65,535 条边界。超限会在全文读取、大块恢复或压缩开始前以中文错误终止，建议拆分素材或降低页面尺寸。

Atlas 只能提供被打包后的像素、裁切、旋转和逻辑尺寸信息。放大可以恢复原始尺寸的画布和摆放关系，但缩小导出时已经丢失的真实像素细节无法重新生成；原图中被压缩、裁掉或本来不存在的细节也无法可靠逆向恢复。导出结果应视为基于 Atlas 元数据的重建，而不是原始美术源文件的替代品。

## 离线包（Windows 64 位）

从发布产物取得 `spine-preview-export-offline.zip` 后，完整解压到本地目录。推荐双击其中的 `启动离线工具.cmd`：它使用 Windows 自带 PowerShell 启动仅监听 `127.0.0.1` 的本地 HTTP 服务，并自动打开浏览器。

不要直接双击 `index.html`。部分浏览器会限制 `file://` 页面加载 ES module；本地启动脚本无需安装 Node.js、Python 或任何第三方软件。若端口 8765 已被占用，请在解压目录的 PowerShell 中运行：

```powershell
.\Start-Offline.ps1 -Port 8766
```

关闭 PowerShell 窗口即可停止本地服务。离线包内还包含 `离线使用说明.txt`，供转交时一并保留。

## 本地构建

```bash
npm install
npm test
npm run build
npm run build:offline
npm run verify-runtime-assets
npm run package:offline
```

`npm run package:offline` 会重新生成离线静态构建，先按 `scripts/offline-assets.json` 校验最终构建的完整路径集合和每个文件的完整 SHA-256，再校验八个 Runtime、共享 helper、ZIP Worker、三份许可和两个 launcher，最后以原子 no-replace 方式创建根目录的 `spine-preview-export-offline.zip`。旧目标会先在已校验的同文件系统路径中隔离，失败不会留下可误发的旧目标；提交窗口若出现同名文件则 fail-closed 而不会覆盖。缺失、额外、改名、重复、大小写/Windows 路径碰撞或任一单字节变化都会 fail-closed；打包过程不会自动学习新 hash。

完整 hash 门禁通过后，远程依赖审计按浏览器 HTML 规则检查 URL 属性、meta refresh、内联样式和可执行脚本，再用 JavaScript AST 追踪 Worker URL、全局网络 API 的直接/间接调用、`window.open`、`location.assign/replace`、location 赋值以及可计算或动态目标。普通应用 chunk 的目标必须能直接证明为相对路径、`blob:` 或 `data:`。官方 Spine Runtime 通用资源加载器、Vite modulepreload 与本地 ZIP Worker 只有路径、调用形状和完整 SHA-256 都与已复核构建一致时才获得最小例外。离线入口以 `connect-src 'none'`、`form-action 'none'`、`object-src 'none'` 和仅限本地/`blob:` 的 `worker-src` CSP 配合浏览器零外部请求、导航和 popup 测试提供运行时防线。完整设计见 [离线包安全与完整性](docs/security-offline.md)。

## Docker 部署

仓库提供 `Dockerfile`、`docker-compose.yml` 与已构建的 `docker-image/spine-tool-0.1.0.tar.gz`（`linux/amd64`，压缩后约 21 MB）。镜像基于 `nginx:alpine`，只提供静态站点，默认发布到宿主 `8080` 端口。

```bash
docker load -i docker-image/spine-tool-0.1.0.tar.gz
docker compose up -d          # 打开 http://<服务器地址>:8080
```

应用完全在浏览器本地运行，容器无需数据卷、环境变量或数据库。手动构建：`npm run docker:build`；构建并导出可上传的归档：`npm run docker:package`，可追加 `-- --tag spine-tool:0.2.0`、`-- --platform linux/arm64`、`-- --no-cache`。构建、部署、换端口、ARM64 与多架构、反向代理、升级流程和已应用的响应头见 [Docker 部署说明](DOCKER.md)。

## Spine Runtime 许可

Spine Runtime 受 Esoteric Software 的许可条款约束。在线 `dist`、离线 ZIP 和源码 ZIP 均包含以下三份固定官方原文；使用或分发前请阅读适用于对应版本的文件，并确认你的使用方式符合条款。

| Runtime 版本 | 源码 ZIP / 仓库路径 | 在线与离线发布路径 |
| --- | --- | --- |
| 3.5–3.6 | `public/licenses/SPINE-RUNTIMES-LICENSE-v2.5.txt` | `licenses/SPINE-RUNTIMES-LICENSE-v2.5.txt` |
| 3.7–4.1 | `public/licenses/SPINE-RUNTIMES-LICENSE-2019.txt` | `licenses/SPINE-RUNTIMES-LICENSE-2019.txt` |
| 4.2–4.3 | `public/licenses/SPINE-RUNTIMES-LICENSE-2025.txt` | `licenses/SPINE-RUNTIMES-LICENSE-2025.txt` |

`node_modules`、npm cache 和构建依赖树只用于本地构建/来源验证，不会被放入网站、离线 ZIP 或源码 ZIP。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。
