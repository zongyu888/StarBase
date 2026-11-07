# StarBase：品牌升级与本地连接架构

> 目标：把「线上 navicat」升级为 **StarBase**，并让部署在 Linux 上的网站用户也能连接**自己电脑上的**数据库（localhost / 内网）。
> 方案：**本地 Agent + 桌面客户端**，两者复用同一套 Go 数据库引擎。

## 1. 为什么需要本地 Agent

浏览器中的 JavaScript 只能发起 HTTP / WebSocket，**不能开任意 TCP 连接**。MySQL、PostgreSQL、Redis、SQL Server 都是原生 TCP 协议，所以纯网页无法直接连接用户电脑上的 `localhost:3306`。

Apifox 能测试本地接口，是因为：

- 桌面客户端本身就是本机进程，请求由本机直接发出；
- Web 版配合 **本地 Agent**（监听 `127.0.0.1` 的小程序），网页通过回环地址与 Agent 通信，再由 Agent 访问本地数据库。

浏览器插件不是必须的。即使做插件，也需要额外的 Native Messaging 宿主进程，复杂度和安装成本都更高。

因此 StarBase 提供两种本地入口：

| 入口 | 适用场景 | 特点 |
| --- | --- | --- |
| **StarBase Agent** | 用户访问 `stargrow.store` 网站，需要连自己电脑上的库 | 小体积后台程序；网站切换「本地模式」后全部业务请求走 Agent |
| **StarBase Desktop** | 离线/不想开浏览器；需要完整本地应用 | Wails 桌面窗口，内置前端 + 后端，本机管理员模式 |

## 2. 总体架构

```
[用户浏览器] --HTTPS--> [stargrow.store 网站后端 (Linux)]
      |
      | 本地模式时，业务 API 指向 127.0.0.1:18620
      v
[StarBase Agent (用户电脑)] --TCP--> [用户本地 MySQL/Redis/...]

[StarBase Desktop (用户电脑)] --内置后端--> [本地数据库]
```

云端后端继续负责账号、会话、连接归属和公网数据库访问；Agent 只服务当前这台电脑，不经过云端，也不向云端上传连接密码。

## 3. Agent 设计

### 3.1 进程与端口

- 独立二进制：`starbase-agent`（Windows: `starbase-agent.exe`）。
- 只监听 `127.0.0.1:18620`，**不监听 0.0.0.0**，不暴露公网。
- 默认数据目录：
  - Windows：`%APPDATA%\StarBaseAgent`
  - macOS/Linux：`~/.config/StarBaseAgent`
  - 可用 `-data` 或 `STARBASE_AGENT_DATA` 覆盖。
- 启动时在控制台打印：版本、数据目录、配对码（6 位数字）和监听地址。
- 退出时关闭所有数据库连接池。

### 3.2 复用现有后端

Agent 直接复用：

- `backend/internal/store`：本地连接配置与密码加密存储；
- `backend/internal/db.Manager`：MySQL/PostgreSQL/Redis/Mongo/Chroma 等全部驱动；
- `backend/internal/api.Server`：连接、查询、对象树、Redis、Chroma 等完整 API；
- `backend/internal/auth`：`Enabled: false`，以本机管理员身份运行。

Agent 与桌面版的区别只是：Agent 没有窗口、只监听回环、带跨域与配对校验。

### 3.3 API 契约

Agent 在网站 API 之外增加两个本地端点：

```
GET  /api/agent/health      -> { "name": "StarBase Agent", "version": "1.5.0", "paired": true|false }
POST /api/agent/pair        -> { "pin": "123456" } => { "token": "<64 hex>" }
```

其余 `/api/*` 与主后端保持同构，例如：

```
GET  /api/connections
POST /api/connections/test
POST /api/connections/:id/connect
GET  /api/connections/:id/databases
...
```

除 `health` / `pair` 外，所有请求必须携带：

```
X-StarBase-Agent-Token: <token>
```

### 3.4 安全模型

Agent 是本机高权限程序，必须防止任意网页借它访问本机数据库：

1. **只监听回环**：`127.0.0.1:18620`。
2. **Origin 白名单**：默认只允许
   - `https://stargrow.store`
   - `https://www.stargrow.store`
   - `http://localhost:5173` / `http://127.0.0.1:5173`（开发）
   - `http://localhost:8620` / `http://127.0.0.1:8620`（本地生产构建）
   - 额外域名可通过 `-origin` / `STARBASE_AGENT_ORIGINS` 追加。
   - 拒绝 `Origin: null` 与未知来源。
3. **配对码**：启动时生成 6 位数字，仅打印在本机控制台；5 分钟有效；连续失败 5 次锁定 1 分钟。
4. **配对令牌**：32 字节随机数，仅保存在 Agent 内存和浏览器 localStorage；Agent 重启后失效，需要重新配对。
5. **不使用 Cookie**：跨域请求只带 token header，前端使用 `credentials: 'omit'`。
6. **不开放 CORS `*`**：始终回显具体 Origin。
7. **不落盘明文密码**：沿用主后端 AES-GCM 加密存储。

### 3.5 与主后端 CORS 的衔接

主后端已有 `corsMiddleware`（loopback + `PublicOrigin`）。Agent：

- 在外层 `agentGuard` 完成 CORS 预检与 token 校验；
- 预检 `OPTIONS` 直接返回 204，不进入 Gin；
- 允许请求头补充 `X-StarBase-Agent-Token`、`X-StarBase-Agent-Pin`；
- `PublicOrigin` 设置为 `https://stargrow.store`，兼容主后端自己的 Origin 判断。

## 4. 网站前端「本地模式」

### 4.1 状态

```ts
type AgentStatus = 'unknown' | 'unavailable' | 'available' | 'paired';

interface AgentState {
  status: AgentStatus;
  mode: boolean;        // 是否启用本地模式
  version?: string;
  baseUrl: string;      // 默认 http://127.0.0.1:18620
  token?: string;       // localStorage，Agent 重启后失效
}
```

### 4.2 请求路由

`lib/api.ts` 的 `request()` 根据模式选择目标：

- 认证相关（`/api/auth/*`）与站点健康（`/api/health`）：始终走网站同源；
- 其余业务接口（连接、查询、对象树、Redis、Chroma）：本地模式走 `http://127.0.0.1:18620`；
- 本地模式请求带 `X-StarBase-Agent-Token`，`credentials: 'omit'`；
- 云端模式保持 `credentials: 'same-origin'` 与现有 Cookie 会话。

### 4.3 交互

- 顶栏菜单新增「本地 Agent」入口。
- `AgentDialog`：
  - 自动探测 `127.0.0.1:18620`；
  - 未启动：显示下载/启动说明；
  - 已启动未配对：输入控制台显示的 6 位配对码；
  - 已配对：开关「使用本机 Agent」。
- 启用本地模式后：
  - 侧栏连接列表切换为 Agent 本地连接；
  - 新建/测试/连接/查询都发往 Agent；
  - 连接表单顶部提示「本地模式下可连接 localhost/内网」；
  - 顶栏/状态栏显示「本地模式」标记。
- 关闭本地模式后立即重新加载云端连接列表。

## 5. 桌面版

- 产物重命名：`StarBaseDesktop.exe`。
- 窗口标题：`StarBase Desktop`。
- 数据目录：默认 `%APPDATA%\StarBaseDesktop`；若旧 `%APPDATA%\NavideckDesktop` 存在且新目录不存在，则继续使用旧目录，避免用户连接丢失。
- 单实例锁：`com.starbase.desktop`。
- 构建：`desktop/build-desktop.bat`（前端构建 → 复制 dist → Wails 构建）。
- 桌面版本机单用户、管理员模式，localhost 直连，不受网站普通用户策略限制。

## 6. 品牌改名范围

统一改为 **StarBase**：

- 前端页面标题、登录页、顶栏、欢迎页、状态栏、关于对话框；
- `frontend/index.html` 的 title / description；
- 后端启动日志、邮件发件人、MySQL application name；
- 桌面版标题与产物名；
- README 与设计文档。

**保持不变（兼容性）**：

- Go module 路径 `navideck/backend`；
- 环境变量前缀 `NAVIDECK_*`（后续可增加 `STARBASE_*` 别名）；
- 数据目录 `data` 与旧桌面目录 `NavideckDesktop`；
- 已有数据库连接配置与密码加密格式。

这样改名不会导致已有用户数据丢失，也不会破坏部署脚本。

## 7. 文件规划

新增：

```
backend/cmd/starbase-agent/main.go      Agent 入口 + 配对/Origin/Token 守卫
frontend/src/lib/agent.ts               Agent 探测、配对、模式状态
frontend/src/components/AgentDialog.tsx 本地 Agent 配对与切换
scripts/build-agent.bat                  Windows 构建
scripts/build-agent.sh                   Linux/macOS 构建
docs/STARBASE_AGENT.md                  本文档
```

修改：

```
backend/internal/api/server.go          允许 Agent token 请求头
backend/main.go / auth / db 展示名称     Navideck -> StarBase
frontend/src/lib/api.ts                 本地模式请求路由
frontend/src/store/appStore.ts          Agent 状态与切换
frontend/src/components/TopBar.tsx      本地 Agent 入口与本地模式标记
frontend/src/views/ConnectionDialog.tsx 本地模式提示
frontend/src/views/AuthView.tsx         品牌名
frontend/index.html                     title/description
desktop/main.go / build-desktop.bat     产物名、标题、目录兼容
README.md                               品牌与本地连接说明
```

## 8. 验证计划

1. `go build ./...` + `go test ./...`。
2. 启动 Agent：
   - `/api/agent/health` 无需 token；
   - 未配对请求业务接口返回 401；
   - 用控制台 PIN 配对后拿到 token；
   - 带 token 连接本机 Redis `127.0.0.1:6379` 成功；
   - 非法 Origin 返回 403。
3. 启动网站（8620 + 5173）：
   - AgentDialog 探测到 Agent；
   - 配对并开启本地模式；
   - 新建本机 Redis/MySQL 连接并测试成功；
   - 关闭本地模式后恢复云端连接列表。
4. 构建 `StarBaseDesktop.exe`。
5. 品牌检查：页面标题、登录页、顶栏、README 均显示 StarBase。