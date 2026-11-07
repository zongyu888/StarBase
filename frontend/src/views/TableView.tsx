import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Columns3,
  Database,
  Eye,
  Layers3,
  Loader2,
  RefreshCw,
  Rows3,
  Table2,
  Terminal,
  Wrench,
} from 'lucide-react';
import { api } from '../lib/api';
import { classNames, driverHasSchemas, driverSupportsSQLQuery, suggestSqlForTable } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { TableMeta, TableTab } from '../types';
import { EmptyState, Spinner } from '../components/ui';
import { TableDataView } from './TableDataView';
import { TableStructureView } from './TableStructureView';
import { TableDesignView } from './TableDesignView';

export function TableView({ tab }: { tab: TableTab }) {
  const connection = useAppStore((state) => state.connections.find((item) => item.id === tab.connectionId));
  const updateTab = useAppStore((state) => state.updateTab);
  const openQuery = useAppStore((state) => state.openQuery);
  const setConnected = useAppStore((state) => state.setConnectionConnected);
  const dataVersion = useAppStore((state) => state.dataVersion);
  const openTable = useAppStore((state) => state.openTable);
  const closeTab = useAppStore((state) => state.closeTab);
  const bumpData = useAppStore((state) => state.bumpData);

  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const connectionId = connection?.id;

  const loadMeta = useCallback(
    async (silent = false) => {
      if (!connectionId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await api.table(connectionId, {
          database: tab.database,
          schema: tab.schema,
          table: tab.table,
        });
        setMeta({
          ...data,
          columns: data.columns ?? [],
          indexes: data.indexes ?? [],
          foreignKeys: data.foreignKeys ?? [],
          primaryKey: data.primaryKey ?? [],
        });
        setConnected(connectionId, true);
        setRefreshToken((value) => value + 1);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setLoading(false);
      }
    },
    [connectionId, setConnected, tab.database, tab.schema, tab.table],
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta, dataVersion, tab.connectionId]);

  if (!connection) {
    return (
      <EmptyState
        icon={<Database size={26} />}
        title="连接已不存在"
        description="该表所属的连接已被删除。"
      />
    );
  }

  const mode = meta?.type === 'view' && tab.mode === 'design' ? 'data' : tab.mode;

  return (
    <div className="table-view">
      <div className="object-header">
        <div className="object-title">
          <span className={classNames('object-icon', meta?.type === 'view' && 'view')}>
            {meta?.type === 'view' ? <Eye size={17} /> : meta?.type === 'collection' ? <Layers3 size={17} /> : <Table2 size={17} />}
          </span>
          <div className="object-title-text">
            <div>
              <h2>{tab.table}</h2>
              <span className={classNames('object-kind-badge', meta?.type)}>
                {meta?.type === 'view' ? '视图' : meta?.type === 'collection' ? '集合' : '表'}
              </span>
              {meta?.editable ? null : (
                <span className="readonly-badge">只读</span>
              )}
            </div>
            <p>
              {tab.database}
              {driverHasSchemas(connection.driver) ? ` / ${tab.schema}` : ''}
              {meta?.comment ? ` · ${meta.comment}` : ''}
            </p>
          </div>
        </div>
        <div className="object-actions">
          {loading ? <Spinner /> : null}
          {driverSupportsSQLQuery(connection.driver) ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                const conn = connection;
                if (!conn) return;
                openQuery(conn, {
                  database: tab.database,
                  schema: tab.schema,
                  sql: suggestSqlForTable(conn.driver, tab.database, tab.schema, tab.table),
                  title: `${tab.table} 查询`,
                });
              }}
            >
              <Terminal size={14} />
              在查询中打开
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void loadMeta()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      <div className="object-tabs">
        <button
          type="button"
          className={classNames('object-tab', mode === 'data' && 'active')}
          onClick={() => updateTab(tab.id, { mode: 'data' })}
        >
          <Rows3 size={14} /> 数据
        </button>
        <button
          type="button"
          className={classNames('object-tab', mode === 'structure' && 'active')}
          onClick={() => updateTab(tab.id, { mode: 'structure' })}
        >
          <Columns3 size={14} /> 结构
        </button>
        {meta?.type === 'table' ? (
          <button
            type="button"
            className={classNames('object-tab', mode === 'design' && 'active')}
            onClick={() => updateTab(tab.id, { mode: 'design' })}
          >
            <Wrench size={14} /> 设计
          </button>
        ) : null}
        <div className="toolbar-spacer" />
        {meta ? (
          <span className="object-meta-inline">
            {meta.columns.length} 列
            {meta.primaryKey.length > 0 ? ` · 主键 ${meta.primaryKey.join(', ')}` : ' · 无主键'}
          </span>
        ) : null}
      </div>

      <div className="object-content">
        {loading && !meta ? (
          <div className="center-loading">
            <Loader2 size={24} className="spin" />
            <span>正在读取表结构…</span>
          </div>
        ) : error && !meta ? (
          <EmptyState
            icon={<AlertCircle size={26} />}
            title="读取失败"
            description={error}
            action={
              <button type="button" className="btn" onClick={() => void loadMeta()}>
                <RefreshCw size={14} /> 重试
              </button>
            }
          />
        ) : meta ? (
          <>
            {error ? (
              <div className="inline-banner error">
                <AlertCircle size={14} />
                {error}
              </div>
            ) : null}
            {mode === 'data' ? (
              <TableDataView
                connection={connection}
                meta={meta}
                refreshToken={refreshToken}
                onRefreshMeta={() => void loadMeta(true)}
              />
            ) : mode === 'structure' ? (
              <TableStructureView meta={meta} loading={loading} onRefresh={() => void loadMeta(true)} />
            ) : (
              <TableDesignView
                connection={connection}
                meta={meta}
                onChanged={async () => {
                  await loadMeta(true);
                }}
                onRenamed={(newName) => {
                  closeTab(tab.id);
                  openTable({
                    connectionId: tab.connectionId,
                    database: tab.database,
                    schema: tab.schema,
                    table: newName,
                    objectType: 'table',
                    mode: 'design',
                  });
                  bumpData();
                }}
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
