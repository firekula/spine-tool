# Spine 动画预览与 Atlas 子图导出工具

一个完全在浏览器本地运行的 Spine 文件预览和 Atlas Region PNG 导出工具。导入内容、预览和 ZIP 导出都不会上传到服务器。

## 支持范围

- Spine Runtime：3.5、3.6、3.7、3.8、4.0、4.1、4.2、4.3
- 图集：一个 `.atlas`，配套的一张或多张 `.png` 纹理页
- 预览：动画、单一/组合皮肤、插槽显示与隐藏
- 导出：按 Region 恢复后的原始逻辑尺寸 PNG，以及 `export-report.json`，全部打包为 ZIP

| Spine Editor 版本线 | JSON | SKEL | 说明 |
| --- | --- | --- | --- |
| 3.5、3.6、3.7 | 支持 | 不支持 | 对应官方 Web Runtime 没有二进制读取器；导入 SKEL 会显示中文能力错误，不会交给其他版本 Runtime |
| 3.8 | 支持 | 支持 | `3.8.75` 为尽力兼容，会显示官方已知导出问题警告 |
| 4.0、4.1、4.2 | 支持 | 支持 | 使用各自隔离的同版本 Runtime |
| 4.3 | 支持 | 支持 | Beta/预发布数据会显示兼容性警告后尝试加载 |

同一 `major.minor` 下的稳定补丁号会路由到该版本线的 Runtime，例如 `3.8.99` 使用 3.8 Runtime。不会静默使用另一个 `major.minor` Runtime，也不会改写或转换骨骼文件。Beta 等预发布版本只提供带警告的尝试加载，不承诺与稳定 Runtime 完全兼容。

需要使用新版 Chrome、Edge 或 Firefox，并开启硬件加速/WebGL。缺少 WebGL 或 Runtime 无法加载骨骼时，Atlas 的 Region 导出仍可继续使用。

## 导入与操作

一次选择同一套资源中的下列文件：

- 恰好一个 `.atlas`
- 恰好一个 `.json` 或 `.skel`
- Atlas 声明的全部 PNG 纹理页

工具会自动匹配单页或多页纹理、检测 Spine 版本并加载相应 Runtime。版本无法确定时可手动选择 Runtime；自动预览失败后也可重新手动选择并重试，原文件不会被修改。可在“动画”选择和搜索动画；在“皮肤”切换单一皮肤或组合皮肤；在“插槽”显示、隐藏或批量恢复插槽。预览区支持鼠标滚轮缩放、拖动平移，以及方向键、`+`、`-`、`Home` 和 `0` 键盘操作。

Spine 3.x 的旧 Atlas 可能没有可靠的 `pma` 信息。工具会要求明确确认 `PMA` 或 `Straight Alpha` 后再预览；文件名只能预选建议值。选错会造成半透明边缘发黑、发白或混合异常，但不会改变 Atlas 子图的裁切坐标。

若版本检测、Runtime 解析或 WebGL 渲染失败，只要 Atlas 和 PNG 有效，仍可使用 Atlas-only 模式导出 Region ZIP。

## 倍率与导出报告

工具会还原 Atlas 的旋转、裁剪、偏移和 `orig` 逻辑尺寸，并从页级 `scale` 或 Region 附件尺寸推算导出倍率。若 Spine 以 50% 导出且 Atlas 记录 `scale: 0.5`，工具会按 2 倍恢复逻辑尺寸。界面会显示高、中、低置信度；低置信度代表证据不足或存在异常尺寸，请在导出前核对，必要时修改全局倍率或单个 Region 倍率。

“导出全部 ZIP”生成的 ZIP 包含成功恢复的 PNG 和 `export-report.json`。报告记录每个 Region 的输出路径、尺寸、使用倍率、跳过或失败原因，方便复查。

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

`npm run package:offline` 会重新生成离线静态构建，校验八个 Runtime chunk、许可文件和远程运行依赖，然后创建根目录的 `spine-preview-export-offline.zip`。

远程依赖审计先按浏览器 HTML 解析规则读取 URL 属性、内联样式和可执行脚本，再用 JavaScript AST 追踪 Worker URL 的 path/base、全局网络 API 的间接调用与别名。普通应用 chunk 中任何可静态求值的外部 URL 都会被拒绝；网络目标必须能直接证明为相对路径、`blob:` 或 `data:`。官方 Spine Runtime 自带的通用资源加载器以及 Vite 的 modulepreload helper 需要接收运行时本地 URL，因此只有路径、调用形状和完整 SHA-256 都与已复核构建一致时才允许这些动态参数；任一字节变化都会撤销例外并阻止打包。离线入口以 `connect-src 'none'`、`form-action 'none'`、`object-src 'none'` 和仅限本地/`blob:` 的 `worker-src` CSP 配合 E2E 外部请求拦截提供运行时防线。

## Spine Runtime 许可

Spine Runtime 受 Esoteric Software 的许可条款约束。使用、分发本工具或离线包前，请阅读包内 `licenses/SPINE-RUNTIMES-LICENSE.txt`，并确认你的 Spine Runtime 使用方式符合适用许可。
