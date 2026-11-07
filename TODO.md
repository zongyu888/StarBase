# Navideck 未完成功能与后续计划

> 最后更新：2026-10-28 · 当前主版本：1.3.0（认证、多用户隔离、数据网格批量编辑）
> 项目路径：`C:\Users\mouji\Desktop\线上navicat`
> 可直接运行：双击 `start.bat`，访问 <http://127.0.0.1:8620>

## 一、当前状态快照

已完成并可运行的核心闭环：

- 连接管理：MySQL / MariaDB / PostgreSQL / SQL Server / Oracle / SQLite / Snowflake / MongoDB / Redis，测试连接、只读连接、AES-GCM 密码加密、连接颜色。
- 连接模板：Amazon AWS、Microsoft Azure、Google Cloud、Oracle Cloud、阿里云（RDS/PolarDB/OceanBase）、华为云（GaussDB/DWS）、腾讯云（TencentDB/TDSQL）、Fujitsu、Kingbase、HighGo、TiDB、CockroachDB 等 51 个预设。
- 对象树：数据库、Schema（PG/SQL Server/Oracle/Snowflake）、表、视图；MongoDB 集合；Redis DB/键；懒加载、右键菜单、对象计数、筛选。
- SQL 工作台：CodeMirror 6、SQL 方言高亮、补全、选中执行、多语句、多结果、消息、历史、服务端查询收藏、结果限制。
- MongoDB：集合字段推断、文档分页/筛选、按 `_id` 编辑/删除、CSV/JSON 导出；Redis：DB 0-15、键类型/TTL、值查看编辑、命令控制台。
- 数据网格：分页、排序、组合筛选、暂存批量编辑（单元格/区域多选、键盘导航、Ctrl+C/V、复制行/暂存新增/暂存删除、Ctrl+S 统一保存）、事务化批量写入、类型感知编辑器（布尔/日期/枚举/大文本）、列宽拖拽/隐藏/排序、行详情抽屉、复制 INSERT/UPDATE、BLOB 图片预览与下载、CSV 映射导入、整表/筛选结果 CSV/JSON 导出。
- 结构：列/索引/外键/DDL；可视化建表；添加/删除/重命名列、修改列类型与默认值、重命名表、表注释、加/删索引、加/删外键（SQLite/Snowflake 受限）。
- 数据库操作：新建/删除数据库（MySQL/MariaDB/PG/SQL Server/Snowflake）、清空表、删表/视图/集合。
- 认证与多用户：默认登录；图形验证码、邮箱验证码注册/找回密码、bcrypt、JWT HttpOnly Cookie、登录失败锁定、IP 限流、管理员用户管理；连接/收藏按账号隔离；新用户自动获得个人 SQLite 示例库。
- 连接隔离：普通用户禁止本机/内网/服务器自身 IP；MySQL/PostgreSQL/SQL Server/MongoDB/Redis 拨号时再次锁定 IP；SQLite 用户沙箱；Oracle Wallet 普通用户禁用。
- 安全：仅 localhost 默认、Host 白名单、CORS/Origin 校验、SameSite Cookie、请求体上限、密码不返回前端。
- 部署：前端嵌入 Go 单二进制；Windows 一键脚本；开发模式自动显示验证码。

已经完成的关键修复（本轮）：

- 修复 SQLite `CREATE INDEX` 使用 schema 限定导致的语法错误。
- 修复 `rename_column` 缺少列定义时的潜在 panic。
- 查询收藏从浏览器历史升级为服务端持久化，刷新/换浏览器不丢失。
- CSV 导入支持列映射、编码、分隔符、空值策略，并正确处理自增/identity 空值。
- 导出支持当前筛选与排序，不再只能导出整表。
- 表设计器刷新/重命名后对象树与标签页同步。
- 新增 MariaDB、SQL Server、Oracle 驱动与 SQL 方言；SQL Server 支持 OFFSET/FETCH、GO 分隔符、GUID 规范化；Oracle 支持 Service Name/SID/Wallet/TCPS、OFFSET/FETCH、PL/SQL 块。
- 新增 Snowflake 驱动与元数据（账户/仓库/角色、GET_DDL、约束）。
- 新增 MongoDB 文档浏览与按 `_id` 编辑；Redis DB/键浏览、类型/TTL、值编辑与命令控制台。
- 连接模板扩展到 51 个，覆盖主流云厂商、国产兼容数据库和 MariaDB/TiDB/CockroachDB。
- 新增认证与多用户隔离：参考项目中的图形验证码、SMTP 邮箱验证码、JWT、限流/锁定逻辑已移植；密码改用 bcrypt；旧连接/收藏在首次创建管理员时迁移。
- 接入参考项目的 163 SMTP 配置（`data/mail.json`，gitignored），实际发送验证码/测试邮件成功；管理员用户管理增加 SMTP 测试入口；`参考项目/` 已加入 `.gitignore`。
- 修复开发模式数据目录错误：`scripts/dev-backend.bat` 现在固定使用项目根 `data/`，并开启仅本机的开发验证码。

已验证：

- SQLite：示例电商库全流程（查询、分页、筛选、CRUD、DDL、重命名、索引、CSV 映射导入、筛选导出、收藏、删表）。
- MySQL 8.0（本机真实实例）：连接、数据库/对象元数据、分页数据、SQL 查询（只读验证，未修改现有业务库）。
- PostgreSQL 16.2（临时实例）：建库、建表、插入/更新/删除、筛选、加/删索引、CSV 导入、外键识别、删库（临时资源已清理）。
- MariaDB：MySQL 协议路径、连接串与方言已纳入单元测试；未在本机真实 MariaDB 实例回归。
- SQL Server / Oracle：驱动、DSN、标识符、分页、元数据 SQL 与 DDL 已实现并通过编译/单元测试；当前环境没有实例，未做真实读写回归。
- Snowflake / MongoDB / Redis：驱动、DSN/选项、元数据/浏览/编辑接口已实现并通过编译/单元测试；连接失败路径已验证；当前环境没有实例，未做真实读写回归。
- 认证与隔离：干净数据目录下完成管理员登录、开发验证码注册、新用户个人示例库、401/403/404、普通用户连接 127.0.0.1 拒绝、SQLite 逃逸拒绝、管理员用户禁用/启用、退出后 401；Go 单元测试覆盖验证码一次性、邮箱冷却、JWT 吊销、用户唯一性、内网/沙箱/拨号隔离。SMTP 已用参考项目的 163 配置实际发送验证码和测试邮件成功。

## 二、P0：下次接手先做

1. **用最终二进制做一次回归**
   - 当前 `navideck.exe` 为 1.3.0 构建。
   - 回归路径：登录（管理员初始密码见启动日志或 `NAVIDECK_ADMIN_PASSWORD`）→ 打开示例库 → 查询 → 表数据/结构/设计 → 编辑列（SQLite 重命名）→ CSV 映射导入 → 筛选导出 → 查询收藏 → 新建连接查看 9 种引擎与 51 个模板 → 注册普通用户验证连接隔离。
2. **SQL Server / Oracle / Snowflake / MongoDB / Redis 真实实例回归（优先）**
   - 当前环境没有可用实例；已通过驱动、DSN 单元测试和连接失败路径验证。
   - 建议准备临时实例，按“连接 → 库/Schema/集合/键 → 数据浏览 → 结构/设计 → 写入”顺序回归，并记录方言差异。
3. **截图已重新生成（2026-10-27）**
   - README 引用的截图已用 1.3.0 UI 重新生成（连接对话框含 9 种引擎与 51 个模板）。
   - 截图脚本：`frontend/scripts/final-shots.mjs`，默认使用本机 Edge（`PLAYWRIGHT_CHANNEL=msedge`），也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。
   - `screenshots/` 中仍有旧编号截图与测试截图，可按需清理，只保留 README 引用的图片。
4. **清理开发/测试残留**
   - 停止临时截图实例、Vite 开发服务（5173）和临时 `data-demo/`。
   - `frontend/scripts/*.mjs` 是开发期 Playwright 脚本，正式交付前建议删除或移到 `tests/` 并加说明。
   - 如不需要，执行 `npm uninstall -D playwright`，减小依赖。
5. **确认最终数据库状态**
   - `data/` 内保留：示例库 `demo`、用户自己的 MySQL 连接 `123`。
6. **MySQL 写路径验证（需用户允许）**
   - 插入/更新/删除、修改列、表注释、外键等尚未在真实 MySQL 库执行，避免影响现有库。
   - 下次可新建临时数据库 `navideck_mysql_test`，验证完立即删除。

## 三、P1：最值得补的 Navicat 常用能力

### 表设计器

- ~~修改列类型、NULL、默认值、注释~~（已完成 MySQL/PG；SQLite 仅重命名）
- ~~重命名表、重命名列~~（已完成）
- ~~外键设计器（创建/删除外键）~~（已完成 MySQL/PG）
- ~~表注释编辑~~（已完成 MySQL/PG）
- 修改/重命名索引、查看索引 DDL。
- 设计变更预览 SQL、事务化执行（当前 DDL 即时执行）。
- 创建/删除 Schema（PostgreSQL）。
- SQLite 表重建式改列/加外键（需要安全重建索引与触发器）。
- PostgreSQL 修改列类型时自动处理默认值与 identity 依赖。

### 查询工作台

- ~~查询收藏/保存~~（已完成，服务端持久化）
- SQL 格式化、EXPLAIN/执行计划可视化。
- 列级自动补全（当前只补全表名）。
- 结果集分页/虚拟滚动（当前最多 20,000 行客户端渲染）。
- 事务模式：手动 BEGIN/COMMIT/ROLLBACK。
- 服务端取消查询的更彻底实现（当前依赖请求 context 取消）。
- 查询收藏重命名/搜索/导出、与连接绑定管理。
- 查询结果直接编辑/生成 SQL。

### 数据网格

- ~~批量修改并一次保存、单元格复制/粘贴、行复制/粘贴~~（已完成：暂存编辑 + `POST /table/rows/batch` 事务化保存）
- ~~多选单元格编辑~~（已完成：区域选择、方向键/Tab 导航、Delete 清空）
- ~~列宽拖拽、列顺序、隐藏列~~（已完成，按表持久化在 localStorage）
- ~~BLOB/图片查看器~~（已完成：图片预览、HEX、下载）
- ~~ENUM/SET 下拉选择、日期选择器~~（ENUM/布尔/日期已完成；SET 仍按文本编辑）
- ~~行详情抽屉~~（已完成）
- ~~复制行/暂存新增行/暂存删除行~~（已完成）
- 无主键表通过 rowid/ctid 安全编辑（SQLite/PostgreSQL 可选支持）。
- 跨页选择/批量编辑、编辑历史与多级撤销、保存冲突检测。
- 数据库原生分页/键集分页（大表性能）。
- SET 多值编辑器、JSON 结构化编辑与校验。

### CSV / 导入导出

- ~~导入列映射 UI~~（已完成）
- ~~分隔符/编码配置~~（已完成 UTF-8/GBK/逗号/分号/Tab/竖线）
- ~~导入空值策略与自增/identity 空值处理~~（已完成）
- Excel、JSON、JSONL 导入。
- 导入预检查/试运行、错误行下载。
- 文件大小/行数上限提高，改为流式处理（当前 20 MB / 50,000 行，内存载入）。
- ~~按当前筛选条件导出~~（已完成 CSV/JSON）
- 导出 Excel/JSONL；后台异步导出与进度。

### 连接与工作区

- 连接分组、搜索、排序、复制连接。
- 连接配置导入/导出（不包含明文密码）。
- 清空已保存密码、密钥轮换。
- SSH Tunnel / HTTP Tunnel。
- 连接超时、重连策略、连接池参数配置。
- 自动重连、断线状态检测。
- 多工作区/窗口。

## 四、P2：完整 Navicat 对齐（较大工程）

- 数据传输、结构/数据同步。
- 备份/还原、SQL 导出、定时备份。
- ER 图生成与编辑。
- 用户/角色/权限管理，服务器监控面板。
- 定时任务、事件调度。
- 可视化查询构建器。
- 数据库对比（Schema Diff）。
- ClickHouse、Dameng、Kingbase 原生驱动等更多数据源（当前国产兼容库走 PostgreSQL/MySQL 协议）。
- 云厂商 API 自动发现、IAM/凭据托管（当前为连接模板预填）。
- 团队协作、共享连接、云同步（需要服务端多用户与认证）。
- AI SQL 助手、数据洞察。

## 五、已知限制 / 非目标

- **认证默认开启**：首次启动自动创建管理员；未设置 `NAVIDECK_ADMIN_PASSWORD` 时初始密码只打印在启动日志，登录后应立即修改。`NAVIDECK_AUTH=off` 可恢复本机单用户模式。
- **注册/找回密码依赖 SMTP**：优先读 `NAVIDECK_SMTP_*`，缺失项由 `data/mail.json` 补齐；`data/mail.json` 含 SMTP 授权码，必须保持 gitignored 和 0600。`NAVIDECK_AUTH_DEV_CODES=1` 仅在本机监听时生效，绝不能用于公网。注册默认开放，公网部署可在创建账号后设置 `NAVIDECK_REGISTRATION=off`。
- **单实例限制**：验证码、邮箱验证码、限流、登录锁定和 JWT 吊销列表都在进程内，多实例部署需要共享存储；进程重启后已签发 JWT 仍有效（除非 `session.key`/JWT 密钥变化）。
- **管理员权限**：管理员默认可连接本机/内网、可配置任意 SQLite/Wallet 路径，可用 `NAVIDECK_ADMIN_ALLOW_PRIVATE=off`、`NAVIDECK_ADMIN_ALLOW_SERVER_PATHS=off` 收紧；一旦管理员账号泄露，服务器数据库仍可能被访问。
- **DNS 重绑定**：MySQL/PostgreSQL/SQL Server/MongoDB/Redis 已在拨号层锁定 IP；Oracle/Snowflake 仅做保存/连接前校验，存在有限窗口，敏感环境建议使用 `NAVIDECK_DB_ALLOWED_HOSTS`。
- `NAVIDECK_DB_ALLOWED_HOSTS` 会显式允许普通用户连接列出的私有主机，请谨慎配置。
- 没有内置 TLS、审计日志、OAuth/SSO、细粒度角色权限、团队共享；公网部署请使用 HTTPS 反向代理并设置 `NAVIDECK_COOKIE_SECURE=on`。
- 查询历史保存在浏览器 `localStorage`，换浏览器/清缓存会丢；查询收藏已改为服务端保存。
- MySQL 表行数来自 `information_schema`，是估算值；PostgreSQL 行数来自统计信息，未 ANALYZE 时可能为 0。
- 视图、无主键表在 UI 中为只读。
- 所有元数据接口较“重”（每次表请求会重复查询列/索引/外键/DDL），大库需缓存/合并。
- SQLite 不支持 `ALTER COLUMN`、表注释和 `ALTER TABLE ... ADD/DROP FOREIGN KEY`，UI 会禁用或返回明确提示。
- SQL Server / Oracle / Snowflake / MongoDB / Redis 尚未在真实实例上回归；SQL Server 默认依赖 OFFSET/FETCH（2012+），Oracle 目标 12c+（`OFFSET/FETCH`、identity 元数据），Snowflake 不支持传统索引。
- Oracle 不支持通过本工具建/删数据库；identity 列的类型/默认值修改会返回提示，请使用 SQL。
- Oracle 列默认值通过 `ALL_TAB_COLUMNS.DATA_DEFAULT` 读取，复杂 LONG 默认表达式可能需要人工确认。
- SQL Server GUID 使用 `guid conversion` 统一为 UUID 字符串；如遇旧版驱动或特殊排序规则，请验证编辑/筛选。
- SQL Server 标识列若在 CSV 中显式提供值，可能因 `IDENTITY_INSERT` 限制失败；建议映射时不选 id 列。
- MongoDB 字段由样本文档推断，集合结构可变；文档更新只支持 `$set`，不支持数组元素级编辑；CSV 导入不适用。
- Redis 键列表单次最多扫描 500 个；值编辑以 JSON/文本为单位，暂不支持二进制/Stream 复杂编辑；命令控制台使用简单分词。
- 云厂商模板只预填连接参数，不调用云 API，也不会自动发现实例/凭据；OceanBase Oracle 模式等兼容路径仍为实验性。
- 达梦 DM 需要专用 Go 驱动与元数据适配，当前未接入；电科金仓/瀚高等按 PostgreSQL 协议模板接入。
- 修改列定义与表注释等 DDL 会即时执行，尚未提供事务化预览/回滚。
- 数据网格的暂存修改只保留在当前分页/当前标签内：切换分页、排序、筛选或刷新前会提示丢弃；从外部触发的刷新或直接关闭标签可能直接丢失（关闭标签尚未拦截）；不支持跨页选择和保存冲突检测。
- 批量保存单次最多 5000 处修改；关系型数据库使用事务，MongoDB 为逐条执行（无多文档事务保证）。
- 无主键表仍为只读网格；二进制列的编辑不开放，只提供查看/下载。
- PostgreSQL 修改列类型时若列上存在默认值/identity，数据库可能拒绝，需要先手动处理依赖。
- 外键设计器 UI 当前主要面向当前数据库/同 Schema；跨库/跨 Schema 复杂关系请使用 SQL。
- CSV 导入要求首行表头，单次 20 MB / 50,000 行，内存载入；暂不支持 Excel/JSON 导入与错误行下载。
- 查询收藏只有服务端本地存储，暂无共享、搜索、导入导出。
- CSV 导出的 JSON 对象键顺序不保证；CSV 带 BOM 方便 Excel。
- 仅中文界面；非移动端优先，窄屏只做基础适配。
- 没有自动化 CI、安装包、自动更新、Linux/macOS 启动脚本。
- README 截图可能早于最终 UI 修复，需重新生成。
- `frontend/scripts` 里 Playwright 测试用于开发验证，不是正式测试套件。

## 六、关键文件

后端：

- `backend/main.go` — 启动、环境变量、认证/隔离策略装配、静态资源嵌入。
- `backend/internal/auth/` — 用户存储、bcrypt、JWT Cookie、图形验证码、SMTP 邮箱验证码、登录锁定、限流、注册/登录/找回密码。
- `backend/internal/access/guard.go` — 内网/回环/服务器 IP 校验、SQLite 沙箱、拨号层 IP 锁定。
- `backend/internal/api/auth.go` — 认证中间件、认证/管理员 API、Cookie 与 CSRF Origin 校验。
- `backend/internal/store/store.go` — 连接持久化、AES-GCM 密码、按用户过滤、旧数据迁移。
- `backend/internal/store/queries.go` — 查询收藏持久化（`data/saved-queries.json`）。
- `backend/internal/db/manager.go` — 连接池、DSN、按连接/数据库隔离。
- `backend/internal/db/meta.go` — 数据库/Schema/对象/列/索引/外键/DDL 分发与方言。
- `backend/internal/db/sqlserver.go` — SQL Server 列/索引/外键/DDL/扩展属性。
- `backend/internal/db/oracle.go` — Oracle 列/索引/外键/DDL/注释。
- `backend/internal/db/snowflake.go` — Snowflake 元数据/约束/DDL。
- `backend/internal/db/mongo.go` — MongoDB 数据库/集合/文档推断与 CRUD。
- `backend/internal/db/redis.go` — Redis DB/键/TTL/值/命令。
- `backend/internal/api/redis.go` — Redis 键与命令 API。
- `backend/internal/db/manager_test.go` — 新驱动 DSN 与标识符单元测试。
- `backend/internal/db/data.go` — 分页、筛选、行 CRUD、SQL 构建、筛选导出、参数编码、批量行变更事务。
- `backend/internal/db/query.go` — SQL 拆分、只读校验、多结果执行。
- `backend/internal/db/ddl.go` — 建表、改列/重命名/注释/外键、索引、建/删数据库。
- `backend/internal/db/importcsv.go` — CSV 映射导入与事务。
- `backend/internal/api/data.go` — 表数据、导入导出、DDL、批量行变更路由。
- `backend/internal/api/queries.go` — 查询收藏 REST。
- `backend/internal/api/server.go` — 路由、Host/CORS、静态文件。
- `backend/internal/model/model.go` — API/持久化结构。
- `backend/internal/db/seed.go` — 电商示例库。

前端：

- `frontend/src/App.tsx` — 布局、主题、快捷键、侧栏拖拽。
- `frontend/src/views/QueryView.tsx` — 查询工作台与收藏入口。
- `frontend/src/views/AuthView.tsx` — 登录/注册/找回密码、图形码、邮箱码、开发验证码提示。
- `frontend/src/store/authStore.ts` — 登录状态、401 处理、退出清理。
- `frontend/src/components/AdminUsersDialog.tsx` / `ChangePasswordDialog.tsx` — 管理员用户管理与改密。
- `frontend/src/components/TopBar.tsx` — 账号菜单、角色、退出登录。
- `frontend/scripts/auth-e2e.mjs` — 认证与隔离端到端验证。
- `frontend/src/views/TableDataView.tsx` — 数据网格、批量编辑、复制粘贴、列管理、保存/放弃。
- `frontend/src/lib/grid.ts` — 网格类型判断、剪贴板解析、SQL 生成、BLOB 工具、列偏好。
- `frontend/src/components/CellEditor.tsx` — 类型感知单元格编辑器。
- `frontend/src/components/RowDetailDrawer.tsx` — 行详情抽屉。
- `frontend/src/components/BlobViewerModal.tsx` / `LargeTextModal.tsx` — BLOB 与大文本编辑器。
- `frontend/src/styles/grid-editor.css` — 网格编辑相关样式。
- `frontend/src/views/TableStructureView.tsx` — 结构/索引/外键/DDL。
- `frontend/src/views/TableDesignView.tsx` — 列编辑、重命名、注释、索引、外键。
- `frontend/src/views/TableView.tsx` — 元数据、数据/结构/设计切换、重命名后标签同步。
- `frontend/src/components/ConnectionDialog.tsx` — 连接管理、6 种引擎与云模板。
- `frontend/src/lib/utils.ts` — 驱动元数据、模板、方言标识符与默认 SQL。
- `frontend/src/components/Sidebar.tsx` — 对象树、右键菜单、数据版本刷新。
- `frontend/src/components/ImportCsvDialog.tsx` — CSV 解析、编码/分隔符、列映射预览。
- `frontend/src/components/RedisKeyDialog.tsx` — Redis 键值编辑与命令控制台。
- `frontend/src/components/SavedQueriesDialog.tsx` — 查询收藏管理。
- `frontend/src/components/SqlEditor.tsx` — CodeMirror 主题与快捷键。
- `frontend/src/lib/api.ts` — 前端 API 客户端。
- `frontend/src/store/appStore.ts` — Zustand 状态、标签页、通知。
- `frontend/src/styles/global.css` — 全部主题和样式。

## 七、如何继续开发

```text
# 生产
start.bat

# 开发（后端 8620 + Vite 5173）
dev.bat

# 构建
build.bat

# 手动
cd frontend && npm run build
cd backend && go build -trimpath -ldflags "-s -w" -o ../navideck.exe .
```

- 默认账号/数据：首次启动生成 `data/demo.db` 和「示例数据库 · 电商」，并创建管理员（密码见启动日志或 `NAVIDECK_ADMIN_PASSWORD`）。
- 端口、数据目录、允许 Host 等环境变量见 `README.md`。
- 若要运行截图脚本：`cd frontend && node scripts/final-shots.mjs`，默认使用本机 Edge；也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向 Chromium。

## 八、验证记录（2026-10-28）

- 认证/隔离 E2E（2026-10-28）：`frontend/scripts/auth-e2e.mjs` 在干净数据目录验证未登录 401、管理员登录、图形/邮箱开发验证码注册、个人沙箱示例库、普通用户连接 `127.0.0.1` 403、SQLite `../secret.key` 403、访问他人连接 404、管理员禁用/启用用户、退出后 401；管理员经安全拨号器访问本机测试端口可用。
- Go 单元测试：验证码一次性、邮箱码冷却与一次性、JWT 签发/吊销、用户唯一性、用户名/邮箱/密码校验、内网/回环/服务器 IP 阻断、SQLite 沙箱、拨号层管理员放行/普通用户阻断。
- 前端构建：`tsc + Vite` 通过；认证页、用户管理、连接隔离提示已截图（`screenshots/auth-login.png`、`admin-users.png`、`auth-connection-isolation.png`）。
- 未验证：Oracle/Snowflake 无拨号层 IP 锁定；SMTP 已在 163 上验证发信，其他厂商需部署时回归。
- SQLite：完整 UI + API 闭环通过。
- PostgreSQL：临时 PG 16.2 上建库/建表/写读/筛选/外键/导入/删库通过。
- MySQL：本机 8.0 上读路径通过，写路径未触碰。
- 浏览器：连接对话框已验证 9 张引擎卡片、11 个厂商分组、51 个模板；Snowflake/MongoDB/Redis 模板字段正确切换。
- 数据网格编辑 E2E（2026-10-27）：`frontend/scripts/grid-editor-e2e.mjs` 在示例 SQLite 库验证了单元格/键盘编辑、4 格剪贴板粘贴、放弃修改、草稿新增、复制行、行详情、列宽拖拽、列隐藏/恢复、事务化批量保存（更新+新增）、暂存删除、BLOB 图片预览、大文本编辑、DATE 与 BOOLEAN 编辑器；测试数据已清理。
- 批量 API 事务回滚已单独验证：更新与唯一键冲突的插入同批提交时整体回滚，数据保持不变。
- 本轮单元/编译：`go test ./...`、`go vet`、前端 `tsc + Vite` 构建通过；Snowflake DSN、Mongo URI、Redis Options、SQL Server/Oracle/MariaDB 标识符测试通过。
- 本轮连接失败路径：SQL Server、Oracle、MongoDB、Redis 均返回中文驱动错误；连接配置字段（instance/SID/account/authSource/Redis DB）持久化正确。
- 未验证：SQL Server、Oracle、Snowflake、MongoDB、Redis 的真实实例读写（当前环境无实例）。
- 安全：Host 伪造 403；恶意 Origin 预检 403；localhost CORS 204。
