# StarBase

一个本地优先、也可部署为多用户 Web 服务的数据库工作台，交互参考 Navicat。前端 React + TypeScript，后端 Go，支持 **MySQL / MariaDB / PostgreSQL / SQL Server / Oracle / SQLite / Snowflake / MongoDB / Redis / Chroma**，并内置 50+ 云厂商与兼容数据库模板。

> 当前版本 **v1.5.0**。

## 下载

- **源码仓库（GitHub）**：https://github.com/zongyu888/StarBase
- **发布包（Agent / 桌面版 / Linux 服务端）**：https://github.com/zongyu888/StarBase/releases/latest
- **Gitee 镜像**：待配置。可在 Gitee 中「从 GitHub 导入仓库」后，把仓库地址补充到 `frontend/src/lib/links.ts` 的 `REPO_GITEE`。

网站顶部菜单「下载」已内置这些入口；普通用户可直接下载 Windows Agent 或桌面版，用来连接自己电脑上的数据库。

> **未完成功能、已知限制和恢复开发指引：见 [TODO.md](TODO.md)。**
> 当前版本已经覆盖连接管理、SQL/文档/键值数据浏览、表结构/设计、CSV 导入导出等核心流程；对象管理、备份、自动运行、模型与 BI 等 Navicat 高级模块仍在路线图中。

## 功能

- **账号与认证**：默认开启登录；注册需要图形验证码 + 邮箱验证码，找回密码同样走邮箱验证码；JWT 使用 HttpOnly + SameSite=Strict Cookie，密码使用 bcrypt 哈希；支持登录失败锁定、IP 限流、管理员用户管理（禁用/删除）。可用 `NAVIDECK_AUTH=off` 切回本机单用户模式。
- **多用户隔离**：连接、查询收藏按账号完全隔离；管理员默认也只看到自己的连接。新注册用户自动获得个人 SQLite 示例库。旧版本无归属的连接/收藏会在首次创建管理员时迁移给管理员。
- **连接安全隔离**：普通用户禁止连接 `127.0.0.1`、内网/链路本地、服务器自身 IP 和云元数据地址；MySQL / PostgreSQL / SQL Server / MongoDB / Redis / Chroma 在真正拨号时再次解析并锁定 IP，防止 DNS 重绑定；SQLite 只能访问 `data/users/<用户ID>/` 沙箱；普通用户不能使用服务器本地 Oracle Wallet。管理员可连接本机/内网，也可通过环境变量收紧或配置普通用户主机白名单。
- **连接管理**：新建、编辑、测试、删除连接；支持 SSL/TCPS、只读模式、颜色标识；密码使用 AES-GCM 加密保存在本机，并仅对所属账号可见。
- **连接模板**：Amazon AWS、Microsoft Azure、Google Cloud、Oracle Cloud、阿里云（RDS/PolarDB/OceanBase）、华为云（GaussDB/DWS）、腾讯云（TencentDB/TDSQL）、Fujitsu、Kingbase、HighGo、TiDB、CockroachDB 等 50+ 预设。
- **对象树**：连接 → 数据库 → Schema（PostgreSQL / SQL Server / Oracle / Snowflake）→ 表/视图；MongoDB 集合；Redis DB/键；Chroma 集合；懒加载、右键菜单、对象数量显示、已加载对象筛选。
- **SQL 工作台**：CodeMirror 6 编辑器、九种方言/驱动适配、表名补全、执行选中 SQL、`Ctrl/⌘ + Enter`、多语句执行、多结果集、消息面板、查询历史、查询收藏、结果行数限制。
- **Redis 工作台**：DB 切换、SCAN 分组键树（按 `:` 分层、计数、多选删除）、搜索（包含/前缀/后缀/精确/通配符）与类型过滤、Server/Memory/Stats 卡片、keyspace 与完整 INFO、String/Hash/List/Set/ZSet/Stream 类型化编辑、TTL/重命名/单键与按前缀批量删除、带历史的 CLI 和新建键。
- **Chroma 工作台**：集合浏览/创建/删除、集合详情（HNSW 距离函数与索引参数）、文档分页浏览与新增/编辑/删除（文档、元数据、向量）、向量相似度搜索、元数据过滤，兼容 Chroma v2 REST API（自动回退 v1）。功能设计参考开源项目 chroma-gui，按本项目原生 API 与界面重写。
- **文档 / 键值**：MongoDB 集合字段推断、分页文档网格、按 `_id` 编辑/删除、集合导出；Redis 连接在独立工作台中浏览与编辑。
- **数据网格**：服务端分页/排序/组合筛选、Navicat 风格批量编辑（单元格与区域多选、方向键/Tab 导航、`Ctrl+C/V` 复制粘贴、暂存修改后统一保存）、类型感知编辑器（布尔/日期/枚举/大文本）、列宽拖拽/隐藏/排序、行详情抽屉、复制为 INSERT/UPDATE、BLOB 图片预览与下载、暂存新增/复制/删除行、CSV 导入、整表或按当前筛选导出 CSV/JSON（关系型/MongoDB）。关系型数据库的批量保存通过服务端事务执行，任一操作失败会整体回滚。
- **结构与设计**：列、索引、外键、DDL 查看；可视化新建表；编辑列、重命名表/列、表注释、添加/删除索引、添加/删除外键（SQLite/Snowflake 等引擎不支持的项会明确提示）。
- **数据库操作**：新建/删除数据库（MySQL/MariaDB、PostgreSQL、SQL Server、Snowflake），清空表、删除表/视图/集合。
- **体验**：深色/浅色主题、可拖动侧栏、可拖动编辑器/结果分栏、快捷键、Toast 通知、单二进制部署。
- **示例数据**：首次启动自动创建 SQLite 电商示例库（客户、商品、订单、员工、视图）。

## 技术栈

| 层 | 实现 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、Zustand、CodeMirror 6、Lucide |
| 后端 | Go、Gin、`database/sql` |
| 驱动 | `go-sql-driver/mysql`（MySQL/MariaDB）、`pgx/v5`、`modernc.org/sqlite`、`microsoft/go-mssqldb`、`sijms/go-ora/v2`、`snowflakedb/gosnowflake`、`mongo-driver`、`go-redis/v9`（均为纯 Go，无 CGO）；Chroma 使用内置 HTTP 客户端（v2 API，自动回退 v1） |
| 存储 | 本地 JSON（连接/用户/收藏）+ AES-GCM 连接密码 + bcrypt 用户密码 + JWT 会话 |
| 部署 | 前端构建产物通过 `go:embed` 嵌入后端的单个可执行文件 |

## 支持的数据库与连接模板

| 类型 | 覆盖能力 | 说明 |
| --- | --- | --- |
| MySQL / MariaDB | 完整 | 连接、对象树、查询、数据网格、结构/设计、导入导出、建删库 |
| PostgreSQL | 完整 | 含 Schema、DDL、列/索引/外键设计 |
| SQLite | 完整（本地单文件） | 改列仅支持重命名，表注释/外键需重建表 |
| SQL Server | 连接、数据库/Schema/对象树、查询、数据网格、结构/DDL、设计器、建删库 | 未在当前环境做真实实例回归 |
| Oracle | 连接、Schema/对象树、查询、数据网格、结构/DDL、设计器 | 支持 Service Name / SID / Wallet 与 TCPS；不提供建删库；identity 列修改受限 |
| Snowflake | 连接、数据库/Schema/对象树、查询、数据网格、结构/DDL、设计器、建删库 | 使用账户标识/仓库/角色；不支持传统索引；未在当前环境做真实实例回归 |
| MongoDB | 连接、数据库/集合树、字段推断、文档分页/筛选、按 `_id` 编辑/删除、导出 | 使用 Mongo 文档模型；SQL 查询不适用；未在当前环境做真实实例回归 |
| Redis | 连接、DB 0-15/键浏览、类型/TTL、字符串/哈希/列表/集合/有序集合编辑、命令控制台 | 键列表单次最多扫描 500 个；未在当前环境做真实实例回归 |
| Chroma | 连接、集合浏览/创建/删除、集合详情（HNSW）、文档 CRUD、向量搜索、元数据过滤、分页 | 兼容 Chroma v2 与 v1 REST API；默认端口 8000、`default_tenant` / `default_database`；未在当前环境做真实实例回归 |

连接对话框的「快速模板」提供 Amazon AWS、Microsoft Azure、Google Cloud、Oracle Cloud、阿里云（RDS/PolarDB/OceanBase）、华为云（GaussDB/DWS）、腾讯云（TencentDB/TDSQL）、Fujitsu、Kingbase、HighGo、TiDB、CockroachDB 等 50+ 预设。模板只预填引擎、端口和 TLS，实际连接仍使用对应数据库驱动，不会调用云厂商 API。

> 说明：MongoDB / Redis 是文档/键值模型，不复用 SQL 工作台；Snowflake 属于 SQL 引擎。达梦等需要专用驱动的数据库尚未接入。

## 快速开始（Windows）

环境要求：Node.js 20+；可选 Go 1.24+（项目已内置便携版 Go 到 `.tools/go`）。

```bat
:: 生产模式（首次会自动构建）
start.bat

:: 仅构建
build.bat

:: 开发模式（后端 8620 + Vite 5173）
dev.bat
```

打开 <http://127.0.0.1:8620>。首次启动会自动生成 `data/` 目录、管理员账号和「示例数据库 · 电商」：

- 若设置了 `NAVIDECK_ADMIN_PASSWORD`，用 `NAVIDECK_ADMIN_USERNAME`（默认 `admin`）+ 该密码登录；
- 否则管理员初始密码只在服务端启动日志中打印一次，登录后请立即修改；
- 开发模式 `dev.bat` 会启用本机验证码显示，可直接在注册页看到图形码和邮箱码；生产环境需要配置 SMTP 才能注册/找回密码。

### 手动运行

```bash
# 构建前端
cd frontend
npm install
npm run build

# 构建并启动后端
cd ../backend
go build -trimpath -ldflags "-s -w" -o ../navideck.exe .
cd ..
./navideck.exe
```

### 本地 Agent（浏览器连接本机/内网数据库）

浏览器不能直接建立数据库 TCP 连接。部署在 Linux 的公网网站要连接用户电脑上的 `localhost` 数据库，需要用户在本人电脑上运行 **StarBase Agent**：

```bat
:: 构建（产物 dist\starbase-agent.exe）
scripts\build-agent.bat

:: 运行
dist\starbase-agent.exe
```

启动后控制台会显示监听地址和 6 位配对码。登录网站 → 顶部「查看」菜单 →「本地 Agent」→ 输入配对码 → 开启「使用本机 Agent」。开启后连接、查询、Redis、Chroma 等请求都会发往本机 Agent，可以连接 localhost / 127.0.0.1 / 内网数据库，配置与密码保存在本机。

- Agent 只监听 `127.0.0.1:18620`，不暴露公网；Origin 白名单 + 配对令牌双重校验，Agent 重启后令牌失效。
- 默认允许 `https://stargrow.store`、`https://www.stargrow.store` 与本地开发地址；额外域名用 `-origins` 或 `STARBASE_AGENT_ORIGINS` 追加。
- 数据目录默认 `%APPDATA%\StarBaseAgent`，可用 `-data` 或 `STARBASE_AGENT_DATA` 覆盖。
- 推荐使用 Chrome / Edge；部分浏览器会限制 HTTPS 页面访问 localhost，此时可改用桌面版。

### 桌面版（Windows，直连本机/内网数据库）

浏览器版要求数据库对“运行后端的机器”可达；如果服务部署在公网，浏览器用户无法直接连接自己内网的数据库。桌面版把 Go 后端与 React 界面一起打包进本机进程，因此可以直接访问本机与内网数据库。

```bat
:: 构建（前端 + Go + Wails，输出 desktop\StarBaseDesktop.exe）
desktop\build-desktop.bat

:: 运行
desktop\StarBaseDesktop.exe
```

- 桌面版不使用账号登录，以本机单用户模式运行；数据目录默认 `%APPDATA%\StarBaseDesktop`。
- 可用 `StarBaseDesktop.exe -data D:\StarBaseData` 或环境变量 `NAVIDECK_DATA_DIR` 指定数据目录。
- 桌面版复用同一套 Go API 与 React 界面，但不再对目标地址做内网限制；请只连接你有权限访问的数据库。
- 依赖：Windows 10/11 自带的 Microsoft Edge WebView2 运行时；构建需要 Node.js 与 Go 1.26+。首次构建前先在 `frontend/` 执行 `npm install`。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NAVIDECK_HOST` | `127.0.0.1` | 服务监听地址；默认仅本机可访问 |
| `NAVIDECK_PORT` | `8620` | HTTP 端口 |
| `NAVIDECK_DATA_DIR` | `data` | 数据目录（连接、用户、密钥、示例库） |
| `NAVIDECK_ALLOWED_HOSTS` | 空 | 额外允许的 Host 头（逗号分隔） |
| `NAVIDECK_AUTH` | `on` | `on`/`off`；`off` 为本机单用户模式，不显示登录页 |
| `NAVIDECK_REGISTRATION` | `on` | 是否开放邮箱验证码注册 |
| `NAVIDECK_ADMIN_USERNAME` | `admin` | 首次启动（无用户时）创建的管理员用户名 |
| `NAVIDECK_ADMIN_PASSWORD` | 自动生成 | 首次启动管理员密码；留空时随机生成并打印到启动日志 |
| `NAVIDECK_ADMIN_EMAIL` | 空 | 管理员邮箱，可用于找回密码 |
| `NAVIDECK_AUTH_DEV_CODES` | `off` | 开发验证码模式：图形码/邮箱码直接显示在页面；仅允许 `127.0.0.1`/`localhost` 监听时生效 |
| `NAVIDECK_SMTP_HOST` / `NAVIDECK_SMTP_PORT` | 空 / `465` | SMTP 服务器；465 走 TLS 直连，其它端口尝试 STARTTLS；环境变量优先，缺失项由 `data/mail.json` 补齐 |
| `NAVIDECK_SMTP_USERNAME` / `NAVIDECK_SMTP_PASSWORD` | 空 | SMTP 账号 |
| `NAVIDECK_SMTP_FROM` / `NAVIDECK_SMTP_FROM_NAME` | 空 / `StarBase` | 发件地址与发件人名称 |
| `NAVIDECK_JWT_SECRET` | 自动生成 | JWT 签名密钥；留空时生成 `data/session.key`（0600） |
| `NAVIDECK_SESSION_HOURS` | `72` | 登录有效期 |
| `NAVIDECK_COOKIE_SECURE` | `off` | HTTPS 部署必须设为 `on` |
| `NAVIDECK_PUBLIC_ORIGIN` | 空 | 反向代理后的站点 Origin，例如 `https://db.example.com` |
| `NAVIDECK_TRUSTED_PROXIES` | 空 | 可信反向代理 IP/CIDR（逗号分隔）；用于正确识别客户端 IP |
| `NAVIDECK_DB_ALLOWED_HOSTS` | 空 | 普通用户可连接的内网/私有主机白名单；支持 `.example.com` 后缀 |
| `NAVIDECK_ADMIN_ALLOW_PRIVATE` | `on` | 管理员是否允许连接本机/内网数据库 |
| `NAVIDECK_ADMIN_ALLOW_SERVER_PATHS` | `on` | 管理员是否允许任意 SQLite/Wallet 路径；公网部署建议设为 `off` |

### 邮件配置（SMTP）

除环境变量外，也可以把邮件配置写到 `data/mail.json`（`data/` 已被 `.gitignore` 忽略，适合保存密码）：

```json
{
  "host": "smtp.163.com",
  "port": 465,
  "username": "your-account@163.com",
  "password": "your-smtp-authorization-code",
  "from": "your-account@163.com",
  "fromName": "StarBase"
}
```

环境变量优先于文件，文件用于补齐缺失项。当前本机已按参考项目导入 163 SMTP 配置到 `data/mail.json`，并已实际发送成功。登录管理员后，在右上角账号菜单 →“用户管理”里可以填写收件邮箱并点击“发送测试邮件”验证 SMTP。SMTP 授权码属于敏感信息，请勿提交到仓库；如果参考目录曾对外分发，建议在邮箱后台重置授权码。

### 认证与多用户部署

1. 首次启动会创建管理员。若设置了 `NAVIDECK_ADMIN_PASSWORD` 则使用该密码；否则随机密码只打印在启动日志中，登录后请立即在右上角账号菜单修改。
2. 注册和找回密码需要 SMTP。未配置 SMTP 时，生产环境这两个入口会明确提示不可用；本机开发可设置 `NAVIDECK_AUTH_DEV_CODES=1` 在页面上显示验证码，**不要用于公网**。
3. 普通用户默认不能连接本机/内网/服务器自身 IP。MySQL、PostgreSQL、SQL Server、MongoDB、Redis 在拨号层再次校验并锁定解析到的 IP；Oracle/Snowflake 依赖保存/连接前校验。
4. 每个用户只能看到自己的连接和查询收藏；管理员默认也只看自己的连接，但可以管理用户。
5. 反向代理部署示例（HTTPS 在代理层终止）：

```bat
set NAVIDECK_HOST=127.0.0.1
set NAVIDECK_ALLOWED_HOSTS=db.example.com
set NAVIDECK_PUBLIC_ORIGIN=https://db.example.com
set NAVIDECK_TRUSTED_PROXIES=127.0.0.1
set NAVIDECK_COOKIE_SECURE=on
```

> `NAVIDECK_DB_ALLOWED_HOSTS` 一旦配置，普通用户就可以连接其中列出的私有主机；这是显式放行，请只加入确实允许用户访问的数据库。

## 数据与安全

- 连接密码不会返回给前端，也不会写入浏览器；使用本机 `data/secret.key` 对密码做 AES-GCM 加密后存入 `data/connections.json`，并按账号隔离。
- 用户密码使用 bcrypt 哈希保存在 `data/users.json`（0600）；JWT 密钥保存在 `data/session.key`（0600），登录态放在 HttpOnly、SameSite=Strict Cookie 中，前端 JavaScript 无法读取。
- 查询收藏保存在 `data/saved-queries.json`，按账号隔离；查询历史保存在浏览器 `localStorage`，按用户 ID 分键。
- 删除 `data/secret.key` 会导致已保存密码无法解密；删除 `data/session.key` 会使所有登录会话失效；删除整个 `data/` 会丢失连接、用户、收藏和示例库。
- 默认只监听 `127.0.0.1`；Host 头白名单、CORS 限制、请求 Origin 校验和 SameSite Cookie 可降低 DNS rebinding / 本地跨站调用风险。
- 普通用户禁止连接本机/内网/服务器自身 IP；SQLite 限制在个人沙箱；Oracle Wallet 对普通用户禁用。管理员默认可以连接本机/内网，可用 `NAVIDECK_ADMIN_ALLOW_PRIVATE=off` 收紧。
- 「只读连接」会阻止 DML/DDL，并在查询层阻止修改性语句；数据库账号权限仍应作为最终防线。
- 认证与限流状态保存在进程内，当前按单实例部署设计；多实例部署需要额外的共享会话/限流存储。公网部署请配合 HTTPS 反向代理、`NAVIDECK_COOKIE_SECURE=on` 和可信代理配置。

## 示例截图

| 查询工作台 | 数据网格 |
| --- | --- |
| ![查询](screenshots/query-results.png) | ![数据](screenshots/data-grid.png) |

| 批量编辑与待保存 | 行详情抽屉 |
| --- | --- |
| ![批量编辑](screenshots/grid-editor-pending.png) | ![行详情](screenshots/grid-editor-detail.png) |

| BLOB 图片预览 | 表结构 |
| --- | --- |
| ![BLOB](screenshots/grid-editor-blob.png) | ![结构](screenshots/structure.png) |

| 表设计器 | CSV 导入映射 |
| --- | --- |
| ![设计](screenshots/design.png) | ![导入](screenshots/import-mapping.png) |

| 查询收藏 | 9 种引擎与云模板 |
| --- | --- |
| ![收藏](screenshots/query-favorites.png) | ![连接](screenshots/connection-dialog.png) |

| 浅色主题 |
| --- |
| ![浅色](screenshots/light.png) |

| 桌面版（Wails 原生窗口） |
| --- |
| ![桌面版](screenshots/desktop-main.png) |

| 桌面版直连本机 MySQL |
| --- |
| ![桌面版 MySQL](screenshots/desktop-mysql.png) |

| Redis 工作台 | Redis 键详情 |
| --- | --- |
| ![Redis 工作台](screenshots/redis-dashboard.png) | ![Redis 键详情](screenshots/redis-key-detail.png) |

| Redis CLI | 桌面版 Redis 工作台 |
| --- | --- |
| ![Redis CLI](screenshots/redis-cli.png) | ![桌面版 Redis](screenshots/desktop-redis.png) |

| 登录与注册 | 用户管理 |
| --- | --- |
| ![认证](screenshots/auth-login.png) | ![用户管理](screenshots/admin-users.png) |

## 项目结构

```
.
├─ backend/
│  ├─ main.go                     # 启动、静态资源嵌入、环境变量
│  ├─ internal/api/               # REST 路由、认证中间件、处理器、Host/CORS 防护
│  ├─ internal/auth/              # 用户存储、bcrypt、JWT、图形/邮箱验证码、限流、注册登录
│  ├─ internal/access/            # 数据库目标隔离、SQLite 沙箱、拨号时 IP 校验
│  ├─ internal/db/                # 多驱动连接池、元数据、查询、CRUD、DDL、CSV 导入
│  │  ├─ redis.go                 # Redis 键详情、类型判定、命令解析
│  │  ├─ redis_workspace.go       # Redis INFO/SCAN、类型化条目编辑、TTL/重命名、批量删除
│  │  ├─ manager.go               # DSN（MySQL/MariaDB/PG/SQL Server/Oracle/SQLite）
│  │  ├─ meta.go                  # 方言标识符、库/Schema/对象/表元数据
│  │  ├─ sqlserver.go / oracle.go # SQL Server / Oracle 元数据与 DDL
│  │  ├─ snowflake.go / mongo.go / redis.go  # Snowflake、MongoDB、Redis
│  │  ├─ data.go / query.go       # 分页、筛选、CRUD、SQL 执行
│  │  └─ ddl.go / importcsv.go    # 表设计、CSV 导入
│  ├─ internal/store/             # 连接配置、查询收藏、密钥与密码加密
│  ├─ internal/model/             # API/持久化模型
│  └─ web/dist/                   # 前端构建产物（由 Vite 输出）
├─ desktop/                       # Windows 桌面版（Wails，复用 backend/internal）
│  ├─ main.go                     # 窗口、内置资源服务器、本机数据目录
│  ├─ build-desktop.bat           # 构建前端 + 复制资源 + 生成 exe
│  └─ web/dist/                   # 桌面版嵌入的前端构建产物
├─ frontend/
│  ├─ src/views/                  # 欢迎页、认证、查询、表数据/结构/设计、Redis 工作台
│  ├─ src/components/             # 侧栏、连接/导入/收藏、Redis 键树/仪表盘/详情/CLI 等
│  ├─ src/lib/                    # API 客户端、驱动元数据/模板、Redis 键树算法
│  ├─ src/store/                  # Zustand 应用与认证状态
│  └─ src/styles/                 # 主题、数据网格、认证与 Redis 工作台样式
├─ data/                          # 运行时数据（自动生成，不提交）
├─ scripts/                       # 开发启动脚本
├─ start.bat / build.bat / dev.bat
└─ .tools/                        # 便携工具链（仅本机，不提交）
```

## API 概览

所有接口均位于 `/api`：

- 认证：`GET /auth/status|captcha|me`、`POST /auth/email-code|register|login|logout|reset-password|change-password`
- 管理：`GET /admin/users`、`PATCH/DELETE /admin/users/:id`、`POST /admin/mail/test`（需管理员）
- `GET /health`、`GET/POST/PUT/DELETE /connections`
- `POST /connections/test`、`POST /connections/:id/connect|disconnect`
- `GET /connections/:id/databases|schemas|objects`
- `GET /connections/:id/table?database=&schema=&table=`
- `GET/POST/PATCH/DELETE /connections/:id/table/rows`
- `POST /connections/:id/table/rows/batch`（批量新增/更新/删除；关系型数据库使用事务）
- `POST /connections/:id/query`
- `POST /connections/:id/tables`、`POST /connections/:id/table/alter|drop|truncate`
- `GET /connections/:id/table/export?format=csv|json`（支持 `filters`、`sortColumn`、`sortDir`、`limit`）
- `POST /connections/:id/table/import`（支持 `mapping`、`delimiter`、`emptyAsNull`、`nullValue`）
- `POST/DELETE /connections/:id/databases`
- `GET/POST/PUT/DELETE /queries`（查询收藏）
- Redis：`GET /connections/:id/redis/info`、`GET /connections/:id/redis/keys?pattern=&type=&cursor=&count=`、`GET/PUT/DELETE /connections/:id/redis/key`、`POST /connections/:id/redis/keys/delete`、`POST /connections/:id/redis/key/rename|expire|entry`、`POST /connections/:id/redis/command`

`table/alter` 支持 `add_column`、`drop_column`、`rename_column`、`modify_column`、`rename_table`、`set_table_comment`、`add_index`、`drop_index`、`add_foreign_key`、`drop_foreign_key`。不同引擎不支持的组合会返回明确错误。

请求/响应使用 JSON；错误响应为 `{ "error": "..." }`。

## 已验证

- **SQLite**：示例库全流程——连接、对象树、查询、多结果、错误、分页、筛选、单元格编辑、增删行、可视化建表、加/删/重命名列、重命名表、索引、CSV 映射导入、筛选导出、删表。
- **MySQL 8.0**：本机真实 MySQL 实例上的连接、数据库/对象元数据、分页数据、SQL 查询（只读方式验证，避免修改现有业务库）；修改列、表注释、外键等接口已实现，写路径未在真实业务库执行。
- **MariaDB**：复用 MySQL 协议驱动；连接串、方言与 DDL 已纳入单元测试与代码路径，未在本机真实 MariaDB 实例回归。
- **PostgreSQL 16.2**：临时实例上的连接、建库、建表、插入/更新/删除行、筛选、查询、加索引、CSV 导入/导出、删表/删库；修改列、表注释、外键接口已实现。
- **SQL Server / Oracle / Snowflake**：驱动注册、连接串、数据库/Schema/对象元数据、分页、DDL 生成与设计器已实现；连接串与标识符有单元测试，连接失败路径已验证。当前环境没有可用实例，因此未做真实实例的读写回归。
- **MongoDB / Redis**：驱动、连接串/选项、数据库/集合/键列表、文档/键值浏览与编辑、命令执行接口已实现；DSN/选项有单元测试，连接失败路径已验证。当前环境没有可用实例，因此未做真实实例的读写回归。
- **浏览器端到端**：Playwright 覆盖查询、CRUD、连接保存/删除、主题切换、连接测试等主流程；`frontend/scripts/grid-editor-e2e.mjs` 覆盖批量编辑、区域复制粘贴、草稿新增、复制行、行详情、列宽拖拽、列隐藏、事务化保存、暂存删除、BLOB 图片预览、大文本编辑、日期/布尔编辑器等网格编辑流程。
- **认证与隔离**：`frontend/scripts/auth-e2e.mjs` 在干净数据目录验证了未登录 401、管理员登录、图形/邮箱开发验证码、注册新用户、个人示例库、普通用户连接 `127.0.0.1` 被拒、SQLite 路径逃逸被拒、越权访问他人连接 404、管理员用户禁用/启用、退出后 401。Go 单元测试覆盖验证码一次性、邮箱码冷却、JWT 签发/吊销、用户唯一性和内网/回环/沙箱/拨号隔离。
- **桌面版（Windows）**：Wails 原生窗口启动，内嵌资源服务器同源提供 React 页面与 `/api`；示例 SQLite 查询、本机 MySQL 8.0.40 连接与 `SHOW TABLES`（12 张表）均在桌面窗口内实际执行成功；首次启动自动创建数据目录与示例库。
- **Redis 7.4.0**：真实实例上的 INFO 仪表盘、SCAN 搜索/类型过滤/分组键树、Hash 字段编辑与新增、String 保存、ZSet 列表、TTL 设置/永久、CLI、新建键；`frontend/scripts/redis-e2e.mjs` 覆盖主流程，后端单元测试覆盖 keyspace INFO 解析。
- **SMTP 实际发信**：已使用参考项目的 163 SMTP 配置实际发送注册验证码和管理员测试邮件成功（`smtp.163.com:465`、SSL、发件人一致）；配置保存在本机 gitignored 的 `data/mail.json`。管理员“用户管理”里提供 SMTP 测试入口。

## 当前范围与后续路线

Navicat 是功能非常庞大的商业产品。当前版本聚焦于最常用的数据库管理闭环，以下能力尚未实现：

- SSH/HTTP 隧道、云厂商 API 自动发现与凭据托管（当前为连接模板预填，不调用云 API）
- 函数/存储过程、用户/角色对象管理；自动运行、模型/ER、BI 看板
- 备份/还原、数据库同步、数据传输
- ER 图、查询可视化构建器
- 细粒度角色/权限、OAuth/SSO、审计日志、团队共享与云同步
- 定时任务、监控看板
- SQLite 表结构重建式改列、Excel/JSON 导入、后台异步导出
- 查询收藏的团队共享与云同步
- ClickHouse、Dameng 等需要额外驱动的数据源
- 多实例共享会话/限流；当前验证码、登录锁定、限流与 JWT 吊销列表都在进程内
- Oracle/Snowflake 的拨号级 IP 锁定（当前为保存/连接前校验；MySQL/PostgreSQL/SQL Server/MongoDB/Redis 已有拨号层校验）

> StarBase 为独立实现，与 Navicat 官方无任何关联。仓库中不包含任何 Navicat 源代码或资源。

## 第三方参考

Redis 工作台的分组键树交互与算法参考了 [Another Redis Desktop Manager](https://github.com/qishibo/AnotherRedisDesktopManager)（MIT License，Copyright (c) shibo），并改写为 React/TypeScript + Go 实现。许可证全文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
