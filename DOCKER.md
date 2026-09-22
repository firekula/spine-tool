# Docker 部署

镜像把构建好的静态站点放进 `nginx:alpine`，容器只监听 80 端口提供 HTTP 服务。应用 100% 在浏览器本地运行：没有后端、没有数据库、没有需要挂载的数据卷，导入的文件不会离开浏览器。

## 交付物

| 文件 | 说明 |
| --- | --- |
| `docker-image/spine-tool-0.1.1.tar.gz` | 已构建好的镜像归档（压缩后约 21 MB，解压后约 76 MB），可直接上传服务器 |
| `docker-compose.yml` | 单服务编排文件，默认发布到宿主 `8080` 端口 |
| `Dockerfile` | 多阶段构建：`node:22-alpine` 执行 `npm ci && npm run build`，产物复制到 `nginx:1.27-alpine` |
| `docker/nginx.conf` | SPA 回退、gzip、静态资源缓存、安全响应头、`/healthz` 健康检查 |
| `.dockerignore` | 排除 `node_modules`、构建产物、`.git` 与 11 MB 的 `vendor/source` 源码包 |

镜像标签：`spine-tool:0.1.1`，平台 `linux/amd64`。
随仓库附带归档的 SHA-256：`a1121a89b8354c7f89428212dfdce32207eea41ee0bc9a9caceb740400cce2be`（20.6 MB）。用 `npm run docker:package` 重新构建时，脚本会打印新归档的大小与 SHA-256。
0.1.1 相对 0.1.0 只改了应用代码：PNG 小于 Atlas 声明尺寸时按官方拆图行为补齐右侧和底部透明像素（详见 [CHANGELOG.md](CHANGELOG.md)）。

## 手动构建镜像

构建脚本用 Node 实现，不依赖 gzip 等额外命令，Windows、macOS 和 Linux 通用：

```bash
npm run docker:build                              # 按 package.json 版本构建镜像
npm run docker:package                            # 构建并导出 docker-image/spine-tool-<版本>.tar.gz
npm run docker:package -- --platform linux/arm64  # 指定目标平台
npm run docker:package -- --tag spine-tool:0.2.0  # 指定标签
npm run docker:build -- --no-cache                # 忽略构建缓存
npm run docker:build -- --npm-registry https://registry.npmmirror.com  # 构建阶段走国内镜像
```

也可直接运行 `node scripts/build-docker-image.mjs --help` 查看全部参数。脚本默认关闭 BuildKit provenance/SBOM，以得到可用 `docker save` 单清单导出的镜像；需要保留证明时加 `--with-provenance`。导出结束后会打印归档路径、大小和 SHA-256。

### 构建阶段的 npm registry

构建的第一阶段会执行 `npm ci`。默认使用官方源 `https://registry.npmjs.org`；网络受限时用上面的 `--npm-registry` 指定镜像源，等价于直接构建时传参：

```bash
docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t spine-tool:0.1.1 .
```

该参数只影响构建镜像时的依赖下载，运行时镜像里没有 npm，应用也不访问任何 registry。构建产物内容与用哪个源无关。


## 方式一：上传镜像并部署（推荐）

在本地（或任意能访问该归档的机器）把镜像和编排文件传到服务器：

```bash
scp docker-image/spine-tool-0.1.1.tar.gz user@server:/opt/spine-tool/
scp docker-compose.yml user@server:/opt/spine-tool/
```

在服务器上：

```bash
cd /opt/spine-tool

# 1. 校验并导入镜像（docker load 会自动识别 .tar.gz）
sha256sum -c <<'EOF'
a1121a89b8354c7f89428212dfdce32207eea41ee0bc9a9caceb740400cce2be  spine-tool-0.1.1.tar.gz
EOF
docker load -i spine-tool-0.1.1.tar.gz

# 2. 启动
docker compose up -d

# 3. 确认状态
docker compose ps
```

浏览器打开 `http://<服务器地址>:8080`。

`docker-compose.yml` 里同时写了 `image:` 和 `build:`。服务器上只有归档、没有源码时，`docker compose up -d` 会直接使用已导入的镜像，不会尝试构建。

### 换端口

默认发布到 `8080`。二选一：

```bash
# 临时指定
SPINE_TOOL_PORT=9000 docker compose up -d
```

或在本目录新建 `.env`：

```ini
SPINE_TOOL_PORT=9000
```

然后 `docker compose up -d`。

### 常用运维命令

```bash
docker compose logs -f          # 查看日志
docker compose restart          # 重启
docker compose down             # 停止并删除容器
docker inspect spine-tool --format '{{.State.Health.Status}}'   # 健康状态
```

镜像自带 HEALTHCHECK，每 30 秒请求一次 `/healthz`；`docker compose ps` 的 STATUS 列会显示 `healthy`。

## 方式二：在服务器上用源码构建

服务器装有 Docker 且能访问 npm registry 时，把整个项目目录上传后直接构建：

```bash
docker compose up -d --build
```

或只构建镜像：

```bash
npm run docker:build
```

等价于 `docker build -t spine-tool:0.1.1 .`；用 `npm run docker:package` 可在构建后直接导出归档。

构建阶段会执行 `npm ci` 和 `npm run build`（即 `tsc --noEmit && vite build`），因此需要能下载 npm 依赖。已设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`，不会下载 Playwright 浏览器。国内服务器直连官方 npm 源不稳定时，用 `docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`，或改用 `npm run docker:build -- --npm-registry https://registry.npmmirror.com`。

## 其他平台架构

当前归档是 `linux/amd64`。若服务器是 ARM64（例如 Apple Silicon 或部分云主机），在项目目录执行：

```bash
docker buildx build --platform linux/arm64 --provenance=false --sbom=false --load -t spine-tool:0.1.1 .
```

或使用脚本：`npm run docker:package -- --platform linux/arm64`。

需要同时支持两种架构时构建多架构镜像并推到镜像仓库：

```bash
docker buildx build --platform linux/amd64,linux/arm64 --provenance=false --sbom=false \
  -t <registry>/spine-tool:0.1.1 --push .
```

多架构镜像不能用 `docker save` 导出成单个归档再 `docker load`，请走镜像仓库分发。

## 反向代理与 HTTPS

容器只提供 HTTP。如果需要域名或 HTTPS，在前面加一层反向代理即可，例如 Caddy：

```
spine.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx 也可以，注意透传 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`。应用不依赖 Cookie、认证或跨域，不需要额外配置。

## 已应用的响应头与缓存策略

`docker/nginx.conf` 中已配置：

- `/assets/` 下的文件名带内容哈希，`Cache-Control: max-age=31536000`，可长期缓存。
- `index.html` 为 `Cache-Control: no-cache`，保证刷新后拿到新的哈希引用。
- `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: SAMEORIGIN`。
- `Content-Security-Policy` 与离线包 `<meta>` 中的策略一致：`connect-src 'none'` 等。工具不发起任何网络请求，构建产物也没有内联脚本/样式和 `eval`，因此该策略不影响功能。已用真实 Chrome 验证：页面正常渲染、`blob:` Worker 与 `self` 模块 Worker 均可用、无 CSP 违规、无控制台报错。

## 运行时要求

客户端需要支持 ES module 的 Chrome、Edge 或 Firefox，并开启硬件加速/WebGL。无损 Region 导出依赖 WebGL；缺少 WebGL 时仍可使用 Atlas-only 导出。这部分要求与浏览器版本无关，由用户浏览器决定，与容器无关。

## 升级镜像

1. 修改版本号：`Dockerfile` 里的 `org.opencontainers.image.version` 标签、`docker-compose.yml` 里的 `image:` 标签（例如 `spine-tool:0.2.0`）。
2. 重新构建并导出（脚本会打印归档的 SHA-256）：

   ```bash
   npm run docker:package -- --tag spine-tool:0.2.0
   ```

3. 服务器上 `docker load -i` 新归档，改 `docker-compose.yml` 的 `image:` 为新标签，再 `docker compose up -d`。

## 许可

镜像内包含 `licenses/` 下三份 Spine Runtime 官方许可原文，对应 Runtime 3.5–3.6、3.7–4.1、4.2–4.3。分发镜像前请阅读并确认使用方式符合条款，详见 [README.md](README.md#spine-runtime-许可)。
