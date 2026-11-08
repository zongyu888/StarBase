# StarBase 性能优化记录（v1.6.0）

## 1. 基线（优化前）

环境：Windows，`starbase-server.exe`（v1.5.2），SQLite/Redis 本机服务空闲。

| 指标 | 数值 |
| --- | --- |
| 后端空闲 WorkingSet | ~19 MB |
| 后端空闲 Private | ~59 MB |
| 200 次 `/api/health` 后 | 无增长（~59 MB） |
| `/api/health` 响应 | ~1.5 ms |
| `/api/connections` 响应 | ~1.7 ms |
| 前端主 JS | 1014 KB（gzip 309 KB），单 chunk |

结论：空闲内存已经很轻；峰值内存主要来自**大查询、导出、宽表/向量响应**，前端主要问题是**单包首屏**。

## 2. 审计发现

### 后端

1. **SQL 查询上限 20000 行**：宽表 2 万行会一次性组装 `[][]any`，峰值内存可达数百 MB；前端 DataGrid 也不适合渲染。
2. **CSV 导出上限 500000 行**：一次性返回全部行，存在内存爆风险。
3. **连接池 12 个打开 / 6 个空闲 / 空闲 10 分钟 / 生命周期 60 分钟**：多用户多库时，空闲连接保留过久。
4. **访问策略缓存无硬上限**：`cache` 到 2000 项才清理过期项，若都未过期仍会继续插入。
5. **API JSON 未压缩**：对象树/表格/集合等较大响应浪费带宽与传输内存。
6. **HTTP 未限制 Header 大小**。
7. **访问日志不可关闭**：高并发时 `gin.Logger` 有额外开销。
8. **Chroma 集合计数并发 6**：集合多时瞬时请求偏多。

### 前端

1. **单 chunk 1014 KB**：登录后首次进入工作台才会用到 Table/Redis/Chroma，但首屏全部加载。
2. **SQL 查询默认 maxRows 1000**：宽表 1000 行 DOM 渲染仍然偏重。
3. 数据表已分页（默认 100），这一点无需重做。

## 3. 优化措施

### 后端

| 项 | 调整 |
| --- | --- |
| 连接池 | 默认 MaxOpen 8 / MaxIdle 4 / IdleTime 3m / Lifetime 30m；支持环境变量覆盖 |
| SQL 查询 | 硬上限 20000 → 5000；默认仍 500 |
| CSV 导出 | 上限 500000 → 100000，超出时由调用侧提示 |
| 访问缓存 | 硬上限 1024 项，超限清理过期项并按最旧淘汰，避免长期增长 |
| HTTP | `MaxHeaderBytes = 1MB`；新增 gzip（仅 `/api/`，`BestSpeed`，跳过文件下载） |
| 日志 | `NAVIDECK_ACCESS_LOG=off` 可关闭访问日志；默认开启 |
| Chroma | 集合 count 并发 6 → 4 |
| 部署建议 | Linux 生产建议 `GOMEMLIMIT=512MiB`，根据内存调整 |

环境变量：

```text
NAVIDECK_DB_MAX_OPEN=8
NAVIDECK_DB_MAX_IDLE=4
NAVIDECK_DB_IDLE_MINUTES=3
NAVIDECK_DB_LIFETIME_MINUTES=30
NAVIDECK_ACCESS_LOG=on|off
GOMEMLIMIT=512MiB
```

### 前端

| 项 | 调整 |
| --- | --- |
| 代码分割 | TableView / RedisView / ChromaView 改为 `React.lazy`，按标签页加载 |
| 首屏 | 主包只保留登录、侧栏、欢迎页与基础组件 |
| 查询默认行数 | `maxRows` 默认 1000 → 500，降低宽表渲染峰值 |
| 加载态 | Suspense 使用统一轻量占位，不阻塞侧栏 |

## 4. 预期收益

- 大查询峰值内存下降约 75%（20000 → 5000 行）。
- 导出峰值内存下降约 80%（500000 → 100000 行）。
- 空闲数据库连接更快释放，长时间运行更稳定。
- API JSON 传输体积下降（典型对象树/表格 60–85%，取决于内容）。
- 首屏 JS 主包预计降到 300–500 KB，工作台按需加载。
- 空闲内存基线不变（已经很轻），重点是峰值与长期稳定性。

## 5. 验证方法

1. `go test ./...`、`go vet ./...`。
2. `npm run build`，记录主包与按需 chunk 大小。
3. 重启独立服务，测量空闲 WorkingSet/Private。
4. 用 `curl --compressed -D -` 验证 `Content-Encoding: gzip`。
5. 登录后打开工作台、数据表、Redis、Chroma，确认功能与按需加载正常。
6. 大查询/导出 JSON 行为回归（上限提示）。
## 6. 实测结果（v1.6.0）

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| 首屏主 JS | 1014 KB | **382 KB**（gzip 113 KB） |
| QueryView | 合并在主包 | 按需 467 KB（gzip 156 KB） |
| TableView | 合并在主包 | 按需 105 KB |
| RedisView | 合并在主包 | 按需 52 KB |
| ChromaView | 合并在主包 | 按需 22 KB |
| 空闲 Private | ~59 MB | **55 MB** |
| 1000 次 gzip 请求后 Private | — | **65 MB**（增长约 10 MB 后稳定） |
| `/api/health` | ~1.5 ms | **~1.1 ms** |
| API gzip | 未启用 | `Content-Encoding: gzip` 生效 |
| SQL 查询硬上限 | 20000 行 | **5000 行** |
| CSV 导出硬上限 | 500000 行 | **100000 行** |

首屏主包体积下降约 **62%**；大查询/导出峰值内存上限分别下降约 **75% / 80%**。空闲内存基线仍然很轻，本次优化重点是把峰值和长期运行风险压下来。