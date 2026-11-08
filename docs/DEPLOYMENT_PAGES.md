# StarBase 生产部署（Cloudflare Pages + Linux API）

部署日期：2026-11-08

## 线上地址

| 入口 | 地址 |
| --- | --- |
| 前端（Cloudflare Pages） | https://starbase-9o0.pages.dev |
| 后端 API | https://starbase-api.stargrow.store |
| 同源兜底页面（后端内置前端） | https://starbase-api.stargrow.store/ |

> 现有的 `api.stargrow.store` 与服务器 8080 端口已被 PDF Star 占用，本次**没有改动**它；StarBase 使用独立子域 `starbase-api.stargrow.store` 与端口 8081。

## 服务器布局

服务器：`ssh3.stargrow.store`（Ubuntu 22.04，x86_64）

- 程序：`/opt/starbase/starbase`（v1.6.0）
- 数据：`/var/lib/starbase`
  - `users.json`（含超级管理员 zongyu）
  - `mail.json`
  - `downloads/`（站内下载文件）
- systemd：`starbase.service`
  - 监听 `127.0.0.1:8081`
  - `NAVIDECK_PUBLIC_ORIGIN=https://starbase-9o0.pages.dev`
  - `NAVIDECK_COOKIE_SECURE=true`
  - `NAVIDECK_TRUSTED_PROXIES=127.0.0.1`
  - `NAVIDECK_ALLOWED_HOSTS=127.0.0.1,localhost,starbase-api.stargrow.store`
  - `GOMEMLIMIT=512MiB`
  - `NAVIDECK_ACCESS_LOG=off`
- 隧道：`starbase-tunnel.service`
  - 二进制：`/usr/local/bin/cloudflared-new`
  - 配置：`/etc/starbase/cloudflared.yml`
  - 路由：`starbase-api.stargrow.store → http://127.0.0.1:8081`

## 前后端分离

- Pages 构建时注入 `VITE_API_BASE=https://starbase-api.stargrow.store`
- 前端 API 使用绝对后端地址，`credentials: include`
- 后端 CORS 精确允许 `https://starbase-9o0.pages.dev`
- 生产 Cookie 使用 `Secure + SameSite=None`（跨站 Pages → API）
- Agent 来源白名单已加入：
  - `https://starbase-9o0.pages.dev`
  - `https://starbase.pages.dev`
  - `https://starbase-api.stargrow.store`

## 重新部署

### 前端（Pages）

```bash
cd frontend
VITE_API_BASE=https://starbase-api.stargrow.store npx vite build --outDir dist-pages --emptyOutDir
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY
npx wrangler pages deploy dist-pages --project-name starbase --branch main --commit-dirty=true
```

### 后端（Linux）

```bash
cd backend
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o ../dist/starbase-server-linux-amd64 .
# 上传到服务器 /opt/starbase/starbase 后：
systemctl restart starbase
systemctl status starbase --no-pager
```

## 登录与 Cookie 注意事项

Pages 与 API 属于不同站点，浏览器需要允许第三方 Cookie 才能跨站保持登录。Chrome / Edge 一般可用；若被浏览器策略拦截，可直接使用：

https://starbase-api.stargrow.store/

该地址由后端内置同一套前端，API 同源，不依赖第三方 Cookie。

后续如需彻底避免跨站 Cookie，可把 Pages 项目绑定到 `starbase.stargrow.store` 等自定义域，并把后端 `NAVIDECK_PUBLIC_ORIGIN` 更新为对应来源。

## 下载

站内下载由后端提供（无需登录）：

```
https://starbase-api.stargrow.store/downloads/StarBaseDesktop.exe
https://starbase-api.stargrow.store/downloads/StarBase-Agent-Windows-amd64.zip
```

文件位于 `/var/lib/starbase/downloads/`，仅允许白名单文件名。