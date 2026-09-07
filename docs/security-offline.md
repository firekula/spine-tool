# 离线包安全与完整性

离线包只包含浏览器运行所需的静态页面、八个隔离的 Spine Runtime、ZIP 压缩 Worker、三份 Runtime 许可、使用说明和两个 Windows launcher。`node_modules`、npm cache、构建依赖树和用户导入文件都不属于交付内容。

## 完整资产门禁

`scripts/offline-assets.json` 是人工复核后提交的最终离线构建清单。每一项同时固定 ZIP 内的规范相对路径和完整 SHA-256；`package:offline` 不会从当前构建自动学习或改写 hash。打包前，实际构建快照必须与该清单精确相等：缺失、额外、重命名、重复、大小写不敏感碰撞、Windows 保留路径或任一文件的单字节变化都会 fail-closed。

八个 Runtime chunk 和共享 Runtime helper 还各有单独的路径/hash descriptor。完整门禁通过后，HTML/CSS/JavaScript 审计作为第二层防线继续检查：

- HTML URL 属性、内联样式、可执行脚本与 `meta refresh`；
- `fetch`、XHR、dynamic import、Worker/SharedWorker、WebSocket、EventSource、sendBeacon 和 importScripts；
- `window.open`、`location.assign/replace`、直接 location/href 赋值；
- 间接调用、别名、模板表达式以及无法静态证明安全的动态/计算目标。

普通应用目标必须能证明是相对 URL、`blob:` 或 `data:`。确需接收运行时本地 URL 的官方 Runtime 加载器、Vite modulepreload helper 和本地 ZIP Worker，只有在完整路径、调用形状和完整 SHA-256 都与已复核构建一致时才获得最小例外。入口 CSP 使用 `connect-src 'none'`、`form-action 'none'`、`object-src 'none'` 及仅限本地/`blob:` 的 `worker-src`；浏览器测试同时要求零外部请求、零外部导航、零 popup 和不离开本地 origin。

## 快照与 launcher

`dist-offline/` 和 `offline/` 使用同一套遍历与快照边界：保持已打开的目录 handle，反复校验祖先目录 identity、realpath 与根目录 containment；叶节点必须是普通文件。符号链接、junction、特殊文件、遍历期间目录替换或越界路径都会被拒绝。遍历最多接受 128 个文件、64 个目录、16 层深度和 192 个目录项；单文件最多 8 MiB、一次快照累计最多 32 MiB，文件在固定尺寸 Buffer 分配前完成预算检查。每个文件只读取一次进入该 Buffer，同一 Buffer 用于 SHA 校验、语义审计和 ZIP 写入，避免校验后再次读取磁盘产生不一致。

输出 ZIP 的父目录也保持 ancestor identity guard。已有目标只在验证为同一普通文件后移入同文件系统隔离目录；隔离目录、临时目录和其中的文件在整个敏感窗口保持打开的 handle 与 `dev`/`ino` identity。新 ZIP 以 `0644` 写入临时普通文件并 `fsync`，提交钩子前后都通过同一固定尺寸 handle 重读并核对 SHA-256、identity、尺寸和模式，再通过 hard-link no-replace 原子发布；发布后还会从目标的独立 handle 重读核对。提交窗口若有其他进程创建同名目标，链接以 `EEXIST` 失败并保留对方文件，不使用会覆盖目标的普通 `rename`。

异常清理只会在路径仍指向已记录的普通文件 identity 时 `unlink` 已知叶节点，再对已记录 identity 的空临时目录执行非递归 `rmdir`。若任一临时或隔离路径被替换，打包会 fail-closed 并保留替换内容供人工处理，绝不递归删除未知目录或 sentinel。

launcher 只允许下列两个精确文件，不允许额外 `.cmd`、`.bat` 或 `.ps1`：

| 路径 | SHA-256 |
| --- | --- |
| `Start-Offline.ps1` | `5687647adc007d34e7b6d94b715b1d16d2ad7336349a5cf0e4687ce1bfe24e6b` |
| `启动离线工具.cmd` | `a3410032a6b2cf6593a294a085e23625430946becc6a0abbd2db66647baac180` |

## Runtime 许可

许可文件也从同一构建快照 Buffer 校验并写入 ZIP。版本映射如下：

| Runtime 版本 | 文件 | SHA-256 |
| --- | --- | --- |
| 3.5–3.6 | `licenses/SPINE-RUNTIMES-LICENSE-v2.5.txt` | `d2af98ecac7e4bb6e4c4491fc734db7762b94626b18bcc87c7eac6febd86e1b5` |
| 3.7–4.1 | `licenses/SPINE-RUNTIMES-LICENSE-2019.txt` | `6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39` |
| 4.2–4.3 | `licenses/SPINE-RUNTIMES-LICENSE-2025.txt` | `435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e` |

三份公开副本逐字节匹配固定的官方来源。详细来源、revision 和校验链见 [Runtime 版本与来源](runtime-versions.md)。

## 可重复打包

归档条目使用排序后的固定路径、1980-01-01 时间戳、固定权限和 DEFLATE level 9。发布验收必须从同一提交独立执行两次完整 `build:offline + package:offline`，两个 ZIP 的完整 SHA-256 必须一致；只对同一构建目录重复调用 JSZip 不构成发布级确定性证明。
