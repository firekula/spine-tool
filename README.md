# Spine 动画预览与 Atlas 子图导出工具

一个完全在浏览器本地运行的 Spine 文件预览和 Atlas Region PNG 导出工具。导入内容、预览和 ZIP 导出都不会上传到服务器。

## 支持范围

- Spine Runtime：3.8、4.0、4.1、4.2
- 骨骼：`.json` 或 `.skel`（需使用对应大版本 Runtime）
- 图集：一个 `.atlas`，配套的一张或多张 `.png` 纹理页
- 导出：按 Region 恢复后的 PNG，以及 `export-report.json`

需要使用新版 Chrome、Edge 或 Firefox，并开启硬件加速/WebGL。缺少 WebGL 或 Runtime 无法加载骨骼时，Atlas 的 Region 导出仍可继续使用。

## 导入与操作

一次选择同一套资源中的下列文件：

- 恰好一个 `.atlas`
- 恰好一个 `.json` 或 `.skel`
- Atlas 声明的全部 PNG 纹理页

工具会自动匹配纹理页、检测 Spine 版本并加载相应 Runtime。可在“动画”选择和搜索动画；在“皮肤”切换单一皮肤或组合皮肤；在“插槽”显示、隐藏或批量恢复插槽。预览区支持鼠标滚轮缩放、拖动平移，以及方向键、`+`、`-`、`Home` 和 `0` 键盘操作。

## 倍率与导出报告

工具会从 Region 附件尺寸推算 Atlas 的导出倍率，并显示高、中、低置信度。低置信度代表证据不足或存在异常尺寸；请在导出前核对，必要时修改全局倍率或单个 Region 倍率。

“导出全部 ZIP”生成的 ZIP 包含成功恢复的 PNG 和 `export-report.json`。报告记录每个 Region 的输出路径、尺寸、使用倍率、跳过或失败原因，方便复查。

Atlas 只能提供被打包后的像素、裁切、旋转和逻辑尺寸信息。原图中被缩放、压缩、裁掉或本来不存在的像素细节无法被可靠地逆向恢复；导出的结果应视为基于 Atlas 元数据的重建，而不是原始美术源文件的替代品。

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

`npm run package:offline` 会重新生成离线静态构建，校验四个 Runtime chunk、许可文件和远程运行依赖，然后创建根目录的 `spine-preview-export-offline.zip`。

远程依赖审计先按浏览器 HTML 解析规则读取元素与属性，再用 JavaScript AST 检查可执行脚本。普通应用代码里的 `fetch`、动态 `import()`、XHR、WebSocket、EventSource 等网络目标必须能静态确定为相对路径、`blob:` 或 `data:`；无法证明安全的表达式会让打包失败。官方 Spine Runtime 自带的通用资源加载器以及 Vite 的 modulepreload helper 需要接收运行时本地 URL，因此只有路径、调用形状和完整 SHA-256 都与已复核构建一致时才允许这些动态参数；任一字节变化都会撤销例外并阻止打包。离线入口的 `connect-src 'none'` CSP 和 E2E 的外部请求拦截继续提供运行时防线。

## Spine Runtime 许可

Spine Runtime 受 Esoteric Software 的许可条款约束。使用、分发本工具或离线包前，请阅读包内 `licenses/SPINE-RUNTIMES-LICENSE.txt`，并确认你的 Spine Runtime 使用方式符合适用许可。
