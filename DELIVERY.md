# 使用说明

## 直接使用（Windows）
打开 ready-to-run 文件夹，双击“启动离线工具.cmd”。无需安装 Node.js。请完整解压 ZIP 后运行，不要直接在压缩包内运行。

## 开发
在本目录执行 `npm ci`，再执行 `npm run dev`，打开终端显示的网址。
运行测试：`npm test`。构建：`npm run build`。

## Git 历史说明
此目录包含独立完整的 .git 对象库，不依赖原工作区。保留可恢复的历史至 2020c50，随后新增恢复提交，将源码恢复为上次最终交付的 e1f861f 源码快照。最后几次原始提交对象无法恢复，因此不伪造其提交 ID。
源码快照 ZIP SHA-256：e1f24c3895288b1f490ebe3cccc6205aa27f6c907c5619eb7cbeccaecf885da5
离线 ZIP SHA-256：7fb6c83aaf4cb53f2d0c3296fd7e37b661b0f3021b576ac1503bddfa1ad9830c

3.5–3.7 支持 JSON；3.8、4.0–4.3 支持 JSON/SKEL。缩小导出丢失的像素细节不能重建。

## Windows PowerShell 启动修复
Start-Offline.ps1 已改为 UTF-8 BOM，兼容 Windows PowerShell 5.1 的中文脚本解析。请通过“启动离线工具.cmd”运行。若需从 PowerShell 手动启动，请在 ready-to-run 中执行：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\Start-Offline.ps1"
```

此参数只影响新启动的进程，不修改系统全局执行策略；组织组策略仍有更高优先级。没有 Windows 运行环境，此次已检查编码、脚本副本、固定哈希与离线打包，未宣称 Windows 实机测试通过。
