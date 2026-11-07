# Chroma 向量数据库工作台集成设计

> 状态：已实现（v1.5 规划）
> 参考开源项目：[sqalongl/chroma-gui](https://github.com/sqalongl/chroma-gui)（MIT License）
> 目标：把 chroma-gui 的「多配置 / 连接测试 / 集合管理 / 文档 CRUD / 向量搜索 / 元数据过滤 / 分页浏览 / 集合详情」能力，以 Navideck 的原生驱动 + 原生工作台方式加入本项目，而不是 iframe 嵌套或启动第二个进程。

## 1. 现有项目架构回顾

Navideck 是「Go(Gin) 后端 + React 19/Vite 前端」的本地优先数据库工作台：

- 连接配置：`data/connections.json`，密码 AES-GCM 加密（`backend/internal/store`）。
- 驱动抽象：`backend/internal/db.Manager` 按 `model.Driver*` 分派；SQL 类驱动走 `database/sql`，MongoDB / Redis 走各自客户端。
- API：`backend/internal/api`，全部接口挂在 `/api/connections/:id/...`，统一做登录、归属隔离和 `access.Policy` 主机安全校验。
- 对象树：`frontend/src/components/Sidebar.tsx` 通过 `databases → schemas → objects` 懒加载；Redis 的 `key` 是对象类型，MongoDB 的 `collection` 是对象类型。
- 工作台：Redis 有独立 `RedisView`（DB 切换、键树、详情、CLI）；MongoDB 复用通用数据网格。标签页类型见 `frontend/src/types.ts` 的 `Tab` 联合类型。
- 样式：CSS 变量主题（`frontend/src/styles/global.css`），深浅色由 `data-theme` 控制。

因此 Chroma 不应作为“外挂页面”，而应成为：

1. 一种新的 `chroma` 驱动（连接、对象树、权限可复用）；
2. 一个独立 `ChromaView` 工作台（集合 + 文档 + 向量检索，天然不同于 SQL 网格）。

## 2. 参考项目能力拆解

`chroma-gui` 是一个 Go 单文件服务 + 原生 JS 前端：

| 原项目能力 | 原实现 | 本项目对应实现 |
| --- | --- | --- |
| 多配置管理 | LocalStorage `chromadb_configs` | 复用 Navideck 连接管理（`connections.json` + 账号隔离） |
| 连接测试 | 代理 `GET /api/v2/.../collections` | `POST /api/connections/test`，后端直连 Chroma |
| 集合浏览/创建/删除 | `/api/v2/.../collections` | 后端 Chroma 客户端 + 对象树 + 工作台集合栏 |
| 集合详情（HNSW） | `configuration_json.hnsw` | 集合详情对话框（space / ef_construction / ef_search / M / resize_factor / sync_threshold） |
| 文档 CRUD | `/collections/{id}/get|add|update|delete` | Chroma 文档表格 + 编辑对话框 |
| 向量搜索 | `/collections/{id}/query` | 搜索对话框（向量 + `n_results` + 可选 `where`） |
| 元数据过滤 | `/collections/{id}/get` + `where` | 元数据过滤标签页 |
| 分页 | `offset` / `limit` | 10 / 20 / 50 / 100 条每页 |
| 暗色主题 / i18n | CSS 变量 / translations | 复用 Navideck 主题与中文界面（不引入第二套 i18n） |
| CORS 代理 | 浏览器带 `X-Target-Host/Port` 代理 | **不再需要**：所有请求由 Go 后端发出，浏览器只访问同源 `/api` |

原项目的 CORS 代理是“浏览器 → 代理 → Chroma”，会把目标地址暴露给浏览器且缺少权限控制；本项目改为“浏览器 → Navideck 后端 → Chroma”，可复用登录、归属、只读模式和内网访问策略。

## 3. Chroma REST 契约

默认端口 `8000`，同时兼容旧版 v1 与新版 v2 API：

- v2（Chroma ≥ 0.4 推荐）：
  - `GET  /api/v2/heartbeat`
  - `GET  /api/v2/version`
  - `GET  /api/v2/tenants/{tenant}/databases/{database}/collections`
  - `POST /api/v2/tenants/{tenant}/databases/{database}/collections`
  - `GET|DELETE /api/v2/tenants/{tenant}/databases/{database}/collections/{collection}`
  - `GET  .../collections/{collection}/count`
  - `POST .../collections/{collection}/get`
  - `POST .../collections/{collection}/add|update|delete|query`
- v1（无 tenant/database 层级）：
  - `GET /api/v1/heartbeat`、`/api/v1/version`
  - `/api/v1/collections...` 同名端点

请求/响应约定：

- 集合列表：`[{ id, name, metadata, configuration_json, ... }]`
- 创建集合：`{ "name": "...", "get_or_create": false, "metadata": { "hnsw:space": "l2|cosine|ip" } }`
- 集合详情：`{ id, name, configuration_json: { hnsw: {...} }, metadata, ... }`
- 计数：数字（`42`）
- `get`：`{ "limit": 10, "offset": 0, "include": ["documents","metadatas","embeddings"] }`
  - 响应是**列式**：`{ ids: [], documents: [], metadatas: [], embeddings: [[]], ... }`，后端需转换成行。
- `add`：`{ ids: [], documents: [], metadatas: [], embeddings?: [[]] }`
- `update`：`{ ids: [], documents?: [], metadatas?: [], embeddings?: [[]] }`
- `delete`：`{ ids: [] }`
- `query`：`{ query_embeddings: [[...]], n_results, include: [...], where? }`

兼容策略：首次请求 v2；若返回 404/405 或路径不存在，则回退 v1，并在本次进程内缓存版本选择。集合路径参数优先使用集合 ID（列表接口返回），删除/详情使用集合名。

## 4. 数据模型

后端 `model` 新增：

```go
const DriverChroma = "chroma"

type Connection struct {
    // ... 原有字段
    Tenant string `json:"tenant,omitempty"`
}

type ChromaCollection struct {
    ID          string         `json:"id"`
    Name        string         `json:"name"`
    Metadata    map[string]any `json:"metadata"`
    HNSW        map[string]any `json:"hnsw"`
    Count       int64          `json:"count"`
    Dimension   int            `json:"dimension,omitempty"`
    Version     int            `json:"version,omitempty"`
    Tenant      string         `json:"tenant,omitempty"`
    Database    string         `json:"database,omitempty"`
}

type ChromaDocument struct {
    ID        string         `json:"id"`
    Document  string         `json:"document,omitempty"`
    Metadata  map[string]any `json:"metadata,omitempty"`
    Embedding []float64      `json:"embedding,omitempty"`
    Distance  *float64       `json:"distance,omitempty"`
}

type ChromaDocumentsPage struct {
    Documents []ChromaDocument `json:"documents"`
    Total     int64            `json:"total"`
    Limit     int              `json:"limit"`
    Offset    int              `json:"offset"`
}

type ChromaQueryRequest struct {
    Embedding []float64      `json:"embedding"`
    NResults  int            `json:"nResults"`
    Where     map[string]any `json:"where"`
}

type ChromaQueryResult struct {
    Documents []ChromaDocument `json:"documents"`
}
```

`ConnectionInput` 同步增加 `Tenant`，并在 `connectionFromInput` 中对 `chroma` 做默认值：

- host 默认 `127.0.0.1`，port 默认 `8000`
- tenant 默认 `default_tenant`，database 默认 `default_database`
- 不需要用户名/密码/SSL（留空）

`ObjectInfo` 增加可选 `ID` 字段，Chroma 集合在对象树中携带集合 ID，供工作台直接调用 `get/query`。

## 5. 后端设计

新增 `backend/internal/db/chroma.go`：

- `chromaClient`：`baseURL`、`tenant`、`database`、`http.Client`。
- `Manager.chromaClient(ctx, conn)`：使用 `access.Policy.DialContext` 作为 `http.Transport.DialContext`，因此管理员/普通用户的内网限制、DNS 重绑定防护与现有驱动一致。
- `chromaRequest(ctx, method, path, body, out)`：JSON 请求/响应，非 2xx 返回精简错误（最多 600 字符）。
- 公开方法（供 API 层调用）：
  - `ChromaHeartbeat` / `ChromaVersion`
  - `ChromaCollections`
  - `ChromaCollection(ctx, nameOrID)`
  - `ChromaCollectionCount`
  - `ChromaCreateCollection(ctx, name, space)`
  - `ChromaDeleteCollection(ctx, nameOrID)`
  - `ChromaDocuments(ctx, collectionID, limit, offset)`
  - `ChromaAddDocument` / `ChromaUpdateDocument` / `ChromaDeleteDocuments`
  - `ChromaQuery` / `ChromaFilter`
  - `ChromaDatabases` / `ChromaObjects`（给对象树用）

接入点：

| 文件 | 修改 |
| --- | --- |
| `internal/model/model.go` | 驱动常量、默认端口、Tenant 与 Chroma 模型 |
| `internal/db/manager.go` | `Connect` 分支：heartbeat；`Disconnect`：清理 connected |
| `internal/db/meta.go` | `Databases` / `Schemas` / `Objects` 的 chroma 分支 |
| `internal/db/data.go` | 明确拒绝把 Chroma 当关系表读写（提示使用工作台） |
| `internal/store/store.go` | 校验/保存 tenant，默认端口 8000 |
| `internal/access/guard.go` | 凭据字段校验加入 tenant；走普通主机安全校验 |
| `internal/api/chroma.go` | 新增 HTTP handler |
| `internal/api/connections.go` | 测试连接支持 chroma |
| `internal/api/server.go` | 注册 `/api/connections/:id/chroma/...`，health 驱动列表加入 chroma |

新增 API：

```
GET    /api/connections/:id/chroma/info
GET    /api/connections/:id/chroma/collections
POST   /api/connections/:id/chroma/collections
GET    /api/connections/:id/chroma/collections/:collection
DELETE /api/connections/:id/chroma/collections/:collection
GET    /api/connections/:id/chroma/collections/:collection/documents?limit=&offset=
POST   /api/connections/:id/chroma/collections/:collection/documents
PUT    /api/connections/:id/chroma/collections/:collection/documents/:doc
DELETE /api/connections/:id/chroma/collections/:collection/documents/:doc
POST   /api/connections/:id/chroma/collections/:collection/query
POST   /api/connections/:id/chroma/collections/:collection/filter
```

写操作统一检查 `conn.ReadOnly`；请求走限流（复用 `rateLimit`）、登录校验与 `loadConnection` 的访问策略。

## 6. 前端设计

### 6.1 类型与状态

- `Driver` 增加 `'chroma'`。
- `Connection` / `ConnectionInput` 增加 `tenant`。
- 新增 `ChromaTab`：

```ts
interface ChromaTab {
  id: string;
  kind: 'chroma';
  title: string;
  connectionId: string;
  database: string;
  collection?: string;
  collectionId?: string;
}
```

- `appStore.openChroma(connection, { collection?, collectionId?, database? })`：同一连接 + database 复用标签页，切换集合时更新选中项。
- `Tab` 联合类型、`App.tsx`、`TabBar.tsx` 增加 chroma 分支；图标使用 `Boxes`。

### 6.2 连接表单

`ConnectionDialog`：

- 驱动列表加入 Chroma。
- 选中 Chroma 时显示：`主机`、`端口`、`租户名（Tenant）`、`数据库名`，隐藏用户名/密码/SSL/Wallet 等字段。
- 默认值：`127.0.0.1:8000`、`default_tenant`、`default_database`。
- 校验：host / port / tenant / database 必填。
- `buildPayload` 只提交 Chroma 需要的字段，避免清空其它驱动字段。
- 连接模板新增「Chroma 向量数据库」。

`lib/utils.ts`：

- `DRIVER_META.chroma`（短标识 `CH`、颜色 `#7c5cf0`、默认端口 8000）。
- `driverSupportsSQLQuery/TableDesign/ImportExport/Indexes` 排除 chroma。
- `defaultSchemaFor` 对 chroma 返回空串。
- `driverHasSchemas` 不包含 chroma。

### 6.3 侧栏

- 连接菜单增加「打开 Chroma 工作台」。
- Chroma 连接展开 → 数据库（即连接配置中的 database）→ 集合列表。
- 点击集合 / 集合右键「打开集合」→ `openChroma`，不再进入 SQL `TableView`。
- 集合不显示「设计表 / 导出 CSV / 删除表」等 SQL 专属菜单；提供「集合详情」「删除集合」。

### 6.4 Chroma 工作台（`views/ChromaView.tsx`）

布局参考 Redis 工作台：

```
┌─────────────────────────────────────────────────────────────┐
│ 工具栏：连接名 / tenant.database / 集合下拉 / 刷新 / 搜索 / 新建集合 / 添加文档 │
├──────────────┬──────────────────────────────────────────────┤
│ 集合列表      │ 文档表格（ID / 文档 / 元数据 / 向量维度 / 距离） │
│ 名称 + count  │ 分页：10/20/50/100，上一页/下一页             │
│ 详情 / 删除   │ 行操作：编辑 / 删除                           │
└──────────────┴──────────────────────────────────────────────┘
```

组件拆分：

- `ChromaView.tsx`：数据加载、集合选择、分页、删除确认、Toast。
- `ChromaDocumentModal.tsx`：新增/编辑文档（ID、文档、元数据 JSON、向量 JSON，含 JSON 校验）。
- `ChromaCollectionModal.tsx`：创建集合（名称 + 距离函数）与集合详情（HNSW 参数、metadata、完整配置）。
- `ChromaSearchModal.tsx`：向量搜索 / 元数据过滤两个标签页，结果展示距离与排名。
- `styles/chroma.css`：沿用 CSS 变量，深浅色自动适配。

交互细节：

- 首次进入若连接未建立，先调用 `api.connect`。
- 集合列表加载后逐个取 count（与原项目一致），失败时显示 0 而不是整页报错。
- 文档为空显示空状态；`embedding` 只展示维度，不渲染完整向量（避免大向量撑爆界面，编辑框中可查看/修改）。
- 只读连接禁用新建集合/添加/编辑/删除按钮。
- 所有写操作完成后刷新集合计数与当前页。
- 后端返回的 Chroma 错误会以 Toast 显示，不吞错。

## 7. 安全

- 不再暴露 `X-Target-Host/Port` 给浏览器；目标地址只保存在后端连接配置中。
- Chroma 请求复用 `access.Policy.DialContext`：
  - 普通用户不能连接本机/内网/元数据地址；
  - 管理员默认放行本机/内网；
  - DNS 解析与拨号阶段双重校验，防 DNS 重绑定。
- 连接归属隔离、只读模式、限流与其它驱动一致。
- Chroma 无内置账号体系（默认无鉴权），部署公网时需自行在反向代理层加认证；本项目不会向 Chroma 发送任何本地凭据。

## 8. 兼容与限制

- 支持 Chroma v2；v1 自动回退。
- 不支持 Chroma Cloud 的 API Key 认证（需要额外 header 配置，当前版本未纳入；如需可后续在连接中增加 `apiKey`）。
- 文档的 `embedding` 为可选；若未提供，是否成功取决于 Chroma 服务端是否配置默认 embedding function。
- 集合详情中的 HNSW 参数随 Chroma 版本不同，字段缺失时显示 `—`。
- 单次文档读取上限 1000 条；搜索 `n_results` 上限 1000。

## 9. 验证计划

1. `go test ./...`（新增 Chroma HTTP 客户端单测：列式响应转行、v2→v1 回退、错误信息）。
2. `cd frontend && npm run build`（TypeScript + Vite）。
3. 启动后端 `go run .` 与前端 `npm run dev`。
4. 若无真实 Chroma 服务：
   - 用 Go 单测覆盖 REST 契约；
   - 用本地 mock HTTP 服务验证连接测试/集合列表/文档分页/搜索链路；
   - 页面验证连接表单、标签页、空状态与错误提示。
5. 有真实 Chroma 服务时：创建集合 → 添加文档 → 编辑 → 向量搜索 → 元数据过滤 → 删除文档/集合。

## 10. 许可与归属

`chroma-gui` 采用 MIT License。本次集成按其功能行为重写为 Navideck 原生代码，未直接复制其静态资源；在 `THIRD_PARTY_NOTICES.md` 中保留原项目版权与许可声明。