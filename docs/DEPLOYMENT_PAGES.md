# StarBase 生产部署（Cloudflare Pages + Linux API）

部署日期：2026-11-08

## 线上地址

| 入口 | 地址 |
| --- | --- |
| 前端（自定义域） | https://starbase.stargrow.store |
| 前端（Pages 默认域） | https://starbase-9o0.pages.dev |
| 后端 API | https://starbase-api.stargrow.store |
| 同源兜底页面（后端内置前端） | https://starbase-api.stargrow.store/ |

> 自定义域 `starbase.stargrow.store` 通过 CNAME 指向 `starbase-9o0.pages.dev`，并已在 Pages 项目 `starbase` 中绑定。
> 当前部署的 CORS 只允许自定义域；源码已支持逗号分隔多来源，后续部署新二进制后可同时允许 Pages 默认域。

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
  - `NAVIDECK_PUBLIC_ORIGIN=https://starbase.stargrow.store`
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
- 后端 CORS 允许 `https://starbase.stargrow.store`；源码支持 `NAVIDECK_PUBLIC_ORIGIN` 逗号分隔多来源
- 生产 Cookie 使用 `Secure + SameSite=None`
- Agent 来源白名单已加入：
  - `https://starbase.stargrow.store`
  - `https://starbase-9o0.pages.dev`
  - `https://starbase.pages.dev`
  - `https://starbase-api.stargrow.store`
  - `https://stargrow.store`

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

自定义域 `https://starbase.stargrow.store` 与 API `https://starbase-api.stargrow.store` 同属 `stargrow.store`，Cookie 不再依赖第三方 Cookie 策略，登录更稳定。

Pages 默认域 `https://starbase-9o0.pages.dev` 与 API 跨站，当前后端 CORS 只允许自定义域；如需继续使用默认域登录，需要把 `NAVIDECK_PUBLIC_ORIGIN` 改为逗号分隔并部署新版后端。

若遇到跨域/登录异常，可直接使用同源兜底页面：

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