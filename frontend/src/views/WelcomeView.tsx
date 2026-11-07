import { useState } from 'react';
import {
  ArrowRight,
  Database,
  HardDrive,
  KeyRound,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Table2,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { startNewConnection } from '../lib/actions';
import { classNames, connectionSubtitle, defaultSchemaFor, driverLabel, isDesktopShell, timeAgo } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { Connection } from '../types';
import { DriverBadge, EmptyState, Spinner } from '../components/ui';

const DEMO_SQL = `-- 示例查询：客户消费排行
SELECT c.name AS 客户,
       c.country AS 国家,
       COUNT(o.id) AS 订单数,
       ROUND(SUM(o.total), 2) AS 消费总额
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name, c.country
ORDER BY 消费总额 DESC
LIMIT 10;`;

export function WelcomeView() {
  const connections = useAppStore((state) => state.connections);
  const connectionsLoading = useAppStore((state) => state.connectionsLoading);
  const loadConnections = useAppStore((state) => state.loadConnections);
  const openConnectionDialog = useAppStore((state) => state.openConnectionDialog);
  const openQuery = useAppStore((state) => state.openQuery);
  const setConnected = useAppStore((state) => state.setConnectionConnected);
  const toast = useAppStore((state) => state.toast);
  const [busyId, setBusyId] = useState<string | null>(null);
  const desktop = isDesktopShell();

  const demo = connections.find((connection) => connection.id === 'demo');
  const recent = connections.slice(0, 6);
  const connectedCount = connections.filter((connection) => connection.connected).length;

  const openConnection = async (connection: Connection, demoMode = false) => {
    setBusyId(connection.id);
    try {
      if (!connection.connected) {
        await api.connect(connection.id);
        setConnected(connection.id, true);
        await loadConnections();
      }
      openQuery(connection, {
        database: connection.database || (connection.driver === 'sqlite' ? 'main' : undefined),
        schema: defaultSchemaFor(connection.driver, connection, connection.database),
        sql: demoMode ? DEMO_SQL : undefined,
        title: demoMode ? '示例查询' : undefined,
      });
    } catch (error) {
      toast('error', '连接失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="welcome-scroll">
      <div className="welcome">
        <section className="welcome-hero">
          <div className="hero-copy">
            <div className="hero-eyebrow">
              <Sparkles size={13} /> LOCAL-FIRST DATABASE STUDIO
            </div>
            <h1>
              像桌面工具一样顺手，
              <br />
              <span>{desktop ? '在本机驾驭数据库。' : '在浏览器里驾驭数据库。'}</span>
            </h1>
            <p className="hero-description">
              {desktop
                ? 'StarBase 将 Navicat 的连接管理、对象树、SQL 编辑器和数据网格带进桌面，可直接连接本机与内网数据库。'
                : 'StarBase 将 Navicat 的连接管理、对象树、SQL 编辑器和数据网格带进 Web。'}
              支持 MySQL、MariaDB、PostgreSQL、SQL Server、Oracle、SQLite、Snowflake、MongoDB 与 Redis，所有凭据加密保存在你的本机。
            </p>
            <div className="hero-actions">
              <button type="button" className="btn btn-primary btn-large" onClick={startNewConnection}>
                <Plus size={16} /> 新建连接
              </button>
              {demo ? (
                <button
                  type="button"
                  className="btn btn-large demo-button"
                  onClick={() => void openConnection(demo, true)}
                  disabled={busyId === demo.id}
                >
                  {busyId === demo.id ? <Spinner /> : <Play size={15} fill="currentColor" />}
                  打开示例数据库
                </button>
              ) : (
                <button type="button" className="btn btn-large" onClick={startNewConnection}>
                  <Database size={15} /> 添加第一个连接
                </button>
              )}
            </div>
            <div className="hero-stats">
              <div>
                <strong>9</strong>
                <span>数据库引擎</span>
              </div>
              <div>
                <strong>{connections.length}</strong>
                <span>已保存连接</span>
              </div>
              <div>
                <strong>{connectedCount}</strong>
                <span>当前在线</span>
              </div>
              <div className="hero-stats-security">
                <ShieldCheck size={15} /> AES-GCM
              </div>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="preview-glow" />
            <div className="preview-window">
              <div className="preview-titlebar">
                <span className="window-dots"><i /><i /><i /></span>
                <span>StarBase — demo.db</span>
                <span className="preview-badge">SQLite</span>
              </div>
              <div className="preview-content">
                <div className="preview-sidebar">
                  <div className="preview-tree-item active">
                    <Database size={10} /> 示例数据库 · 电商
                  </div>
                  <div className="preview-tree-children">
                    <div className="preview-tree-item"><Table2 size={9} /> customers</div>
                    <div className="preview-tree-item selected"><Table2 size={9} /> orders</div>
                    <div className="preview-tree-item"><Table2 size={9} /> products</div>
                    <div className="preview-tree-item"><Terminal size={9} /> v_order_summary</div>
                  </div>
                </div>
                <div className="preview-main">
                  <div className="preview-tabs">
                    <span><Table2 size={9} /> orders</span>
                    <span className="active"><Play size={8} /> 查询 1</span>
                  </div>
                  <div className="preview-query">
                    <code><span className="kw">SELECT</span> * <span className="kw">FROM</span> orders</code>
                    <code><span className="kw">ORDER BY</span> created_at <span className="kw">DESC</span> <span className="kw">LIMIT</span> 100;</code>
                  </div>
                  <div className="preview-grid">
                    <div className="preview-grid-head">
                      <span>id</span><span>order_no</span><span>customer</span><span>status</span><span>total</span>
                    </div>
                    {[
                      ['1', 'SO-2026-3101', '陈思远', '已完成', '2,319.00'],
                      ['2', 'SO-2026-3102', '林雨桐', '已发货', '1,298.00'],
                      ['3', 'SO-2026-3103', '王浩然', '已付款', '459.00'],
                      ['4', 'SO-2026-3104', '李若曦', '待付款', '3,497.00'],
                      ['5', 'SO-2026-3105', '张一鸣', '已完成', '899.00'],
                    ].map((row, rowIndex) => (
                      <div className={`preview-grid-row ${rowIndex === 2 ? 'highlight' : ''}`} key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <span key={cellIndex} className={cellIndex === 3 ? `status-pill status-${rowIndex}` : ''}>{cell}</span>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="preview-status">
                    <span>6,284 行</span>
                    <span>12 ms</span>
                    <span className="preview-live">● 已连接</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="floating-chip floating-chip-top">
              <Zap size={12} /> Ctrl + Enter
            </div>
            <div className="floating-chip floating-chip-bottom">
              <KeyRound size={12} /> 加密凭据
            </div>
          </div>
        </section>

        <section className="welcome-features">
          <div className="feature-card">
            <span className="feature-icon"><Database size={18} /></span>
            <strong>多数据库统一接入</strong>
            <p>一个界面管理 9 种数据库，并内置阿里云、华为云、腾讯云、AWS、Azure、Google Cloud 等厂商模板。</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon"><Terminal size={18} /></span>
            <strong>SQL 工作台</strong>
            <p>CodeMirror 编辑器、语法高亮、表名补全、多语句执行与结果多标签。</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon"><Table2 size={18} /></span>
            <strong>可视化数据网格</strong>
            <p>分页、排序、组合筛选、单元格编辑、行插入与删除，像桌面端一样操作。</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon"><Wrench size={18} /></span>
            <strong>结构与 DDL</strong>
            <p>查看列、索引、外键和建表语句，并通过设计器编辑列、重命名表、管理注释/索引/外键。</p>
          </div>
        </section>

        <section className="recent-section">
          <div className="section-heading">
            <div>
              <h2>最近连接</h2>
              <p>点击连接直接打开查询窗口</p>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={startNewConnection}>
              <Plus size={13} /> 新建连接
            </button>
          </div>

          {connectionsLoading ? (
            <div className="connection-card-grid">
              {[0, 1, 2].map((index) => (
                <div className="connection-card skeleton-card" key={index}>
                  <div className="skeleton skeleton-badge" />
                  <div className="skeleton skeleton-line" />
                  <div className="skeleton skeleton-line short" />
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="welcome-empty">
              <EmptyState
                icon={<Database size={24} />}
                title="还没有数据库连接"
                description="创建第一个连接，或从示例电商库开始探索 StarBase。"
                action={
                  <button type="button" className="btn btn-primary" onClick={startNewConnection}>
                    <Plus size={14} /> 新建连接
                  </button>
                }
              />
            </div>
          ) : (
            <div className="connection-card-grid">
              {recent.map((connection) => (
                <div
                  className={classNames('connection-card', connection.connected && 'connected')}
                  key={connection.id}
                  onClick={() => void openConnection(connection)}
                >
                  <div className="connection-card-top">
                    <DriverBadge driver={connection.driver} size="lg" />
                    <div className="connection-card-title">
                      <strong>{connection.name}</strong>
                      <span>{driverLabel(connection.driver)} · {connectionSubtitle(connection)}</span>
                    </div>
                    <span className={connection.connected ? 'status-dot online' : 'status-dot'} />
                  </div>
                  <div className="connection-card-meta">
                    <span>
                      {connection.driver === 'sqlite'
                        ? <><HardDrive size={12} /> {connection.sqlitePath || 'SQLite 文件'}</>
                        : <><Database size={12} /> {connection.database || '未指定默认数据库'}</>}
                    </span>
                    <span>{connection.updatedAt ? `更新于 ${timeAgo(new Date(connection.updatedAt).getTime())}` : ''}</span>
                  </div>
                  <div className="connection-card-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={(event) => {
                        event.stopPropagation();
                        openConnectionDialog(connection);
                      }}
                    >
                      <Pencil size={12} /> 编辑
                    </button>
                    <button
                      type="button"
                      className="btn btn-small card-open-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openConnection(connection);
                      }}
                      disabled={busyId === connection.id}
                    >
                      {busyId === connection.id ? <Spinner /> : <Terminal size={12} />}
                      打开查询
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="welcome-footer">
          <span><ShieldCheck size={13} /> 所有连接与 SQL 仅在本机处理</span>
          <span>StarBase · React + Go</span>
        </div>
      </div>
    </div>
  );
}
