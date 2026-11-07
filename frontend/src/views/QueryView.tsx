import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  AlertCircle,
  Clock3,
  Copy,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  Play,
  Square,
  Star,
  Table2,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { clearHistory, loadHistory, pushHistory } from '../lib/history';
import {
  classNames,
  defaultSchemaFor,
  downloadText,
  driverHasSchemas,
  formatNumber,
  isNumericType,
  safeFileName,
  timeAgo,
} from '../lib/utils';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import type {
  CellValue,
  DatabaseInfo,
  QueryHistoryItem,
  QueryResult,
  QueryTab,
  ResultColumn,
} from '../types';
import { SqlEditor, type SqlEditorHandle } from '../components/SqlEditor';
import { ContextMenu, Dropdown, EmptyState, Spinner } from '../components/ui';
import { SavedQueriesDialog } from '../components/SavedQueriesDialog';

interface QueryViewProps {
  tab: QueryTab;
}

interface CellMenuState {
  x: number;
  y: number;
  value: CellValue;
  row: CellValue[];
  columns: ResultColumn[];
}

function exportCell(value: CellValue): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function QueryView({ tab }: QueryViewProps) {
  const connection = useAppStore((state) => state.connections.find((item) => item.id === tab.connectionId));
  const activeTabId = useAppStore((state) => state.activeTabId);
  const maxRows = useAppStore((state) => state.maxRows);
  const userId = useAuthStore((state) => state.user?.id);
  const setMaxRows = useAppStore((state) => state.setMaxRows);
  const updateTab = useAppStore((state) => state.updateTab);
  const toast = useAppStore((state) => state.toast);
  const setConnected = useAppStore((state) => state.setConnectionConnected);
  const dataVersion = useAppStore((state) => state.dataVersion);

  const editorRef = useRef<SqlEditorHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [objects, setObjects] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<QueryResult[] | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [activePanel, setActivePanel] = useState<number | 'messages'>('messages');
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [editorHeight, setEditorHeight] = useState(() => Math.round(window.innerHeight * 0.36));
  const [sort, setSort] = useState<{ index: number; dir: 'asc' | 'desc' } | null>(null);
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const isActive = activeTabId === tab.id;

  useEffect(() => {
    setHistory(loadHistory(userId));
  }, [userId]);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    setDatabasesLoading(true);
    api
      .databases(connection.id)
      .then(({ databases: items }) => {
        if (cancelled) return;
        setDatabases(items);
        setConnected(connection.id, true);
        const fallback = connection.database || items.find((item) => !item.isSystem)?.name || items[0]?.name || '';
        if (!tab.database && fallback) {
          const schema = defaultSchemaFor(connection.driver, connection, fallback);
          updateTab(tab.id, { database: fallback, schema });
        }
      })
      .catch((loadError) => {
        if (!cancelled) toast('error', '读取数据库列表失败', loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setDatabasesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection?.id, connection?.driver, connection?.database, tab.id, updateTab, setConnected, toast]);

  useEffect(() => {
    if (!connection || !driverHasSchemas(connection.driver) || !tab.database) {
      setSchemas([]);
      return;
    }
    let cancelled = false;
    api
      .schemas(connection.id, tab.database)
      .then(({ schemas: items }) => {
        if (cancelled) return;
        setSchemas(items);
        if (tab.schema && !items.includes(tab.schema) && items.length > 0) {
          const preferred = defaultSchemaFor(connection.driver, connection, tab.database);
          updateTab(tab.id, { schema: items.includes(preferred) ? preferred : items[0] });
        }
      })
      .catch((loadError) => {
        if (!cancelled) toast('error', '读取 Schema 失败', loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [connection?.id, connection?.driver, tab.database, tab.id, tab.schema, updateTab, toast]);

  useEffect(() => {
    if (!connection || !tab.database) return;
    let cancelled = false;
    api
      .objects(connection.id, tab.database, tab.schema)
      .then(({ objects: items }) => {
        if (cancelled) return;
        const completion: Record<string, string[]> = {};
        items.forEach((item) => {
          completion[item.name] = [];
        });
        setObjects(completion);
      })
      .catch(() => {
        if (!cancelled) setObjects({});
      });
    return () => {
      cancelled = true;
    };
  }, [connection?.id, connection?.driver, tab.database, tab.schema, dataVersion]);

  const runQuery = useCallback(
    async (overrideSql?: string) => {
      if (!connection || running) return;
      const selectedSql = overrideSql ?? editorRef.current?.getSelectedSql();
      const sql = (selectedSql && selectedSql.trim() ? selectedSql : tab.sql).trim();
      if (!sql) {
        toast('warning', '请先输入 SQL');
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      try {
        const response = await api.query(
          connection.id,
          { database: tab.database, schema: tab.schema, sql, maxRows },
          controller.signal,
        );
        setResults(response.results);
        setDuration(response.durationMs);
        if (response.results.some((item) => item.error)) {
          setActivePanel('messages');
        } else {
          const firstRows = response.results.findIndex((item) => item.kind === 'rows');
          setActivePanel(firstRows >= 0 ? firstRows : 'messages');
        }
        setConnected(connection.id, true);
        const hasError = response.results.some((item) => item.error);
        const rowCount = response.results.reduce((sum, item) => sum + (item.kind === 'rows' ? item.rowCount : 0), 0);
        const nextHistory = pushHistory(userId, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          connectionId: connection.id,
          connectionName: connection.name,
          database: tab.database,
          sql,
          at: Date.now(),
          durationMs: response.durationMs,
          success: !hasError,
          rows: rowCount,
        });
        setHistory(nextHistory);
        if (hasError) {
          const firstError = response.results.find((item) => item.error);
          toast('error', 'SQL 执行出错', firstError?.error);
        }
      } catch (execError) {
        if (controller.signal.aborted) {
          toast('info', '已取消执行');
          return;
        }
        const message = execError instanceof Error ? execError.message : String(execError);
        setError(message);
        setActivePanel('messages');
        setDuration(null);
        const nextHistory = pushHistory(userId, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          connectionId: connection.id,
          connectionName: connection.name,
          database: tab.database,
          sql,
          at: Date.now(),
          durationMs: 0,
          success: false,
          rows: 0,
        });
        setHistory(nextHistory);
        toast('error', '执行失败', message);
      } finally {
        abortRef.current = null;
        setRunning(false);
      }
    },
    [connection, maxRows, running, setConnected, tab.database, tab.schema, tab.sql, toast, userId],
  );

  useEffect(() => {
    if (!isActive) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (event.defaultPrevented) return;
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
        event.preventDefault();
        void runQuery();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, runQuery]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setSort(null);
  }, [activePanel]);

  const handleSplitStart = (event: ReactMouseEvent) => {
    event.preventDefault();
    const container = bodyRef.current;
    if (!container) return;
    const startY = event.clientY;
    const startHeight = editorHeight;
    const maxHeight = Math.max(180, container.clientHeight - 180);
    const move = (moveEvent: MouseEvent) => {
      const next = Math.min(maxHeight, Math.max(120, startHeight + moveEvent.clientY - startY));
      setEditorHeight(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!connection) {
    return (
      <EmptyState
        icon={<Database size={26} />}
        title="连接已不存在"
        description="该查询所属的连接已被删除，请新建连接后重新打开查询。"
      />
    );
  }

  const changeDatabase = (database: string) => {
    const schema = defaultSchemaFor(connection.driver, connection, database);
    updateTab(tab.id, { database, schema });
  };

  const rowsResults = (results ?? []).filter((item) => item.kind === 'rows' && !item.error);
  const activeResult = typeof activePanel === 'number' ? results?.[activePanel] : undefined;
  const hasResultError = Boolean(results?.some((item) => item.error));
  const filteredHistory = history.filter((item) => item.connectionId === connection.id);

  return (
    <div className="query-view">
      <div className="query-toolbar">
        <div className="query-target">
          <Database size={14} className="muted-icon" />
          <select
            className="select select-compact database-select"
            value={tab.database}
            onChange={(event) => changeDatabase(event.target.value)}
            disabled={databasesLoading || databases.length === 0}
            title="选择数据库"
          >
            {tab.database === '' ? <option value="">选择数据库</option> : null}
            {databases.map((database) => (
              <option key={database.name} value={database.name}>
                {database.name}
              </option>
            ))}
          </select>
          {driverHasSchemas(connection.driver) ? (
            <>
              <span className="breadcrumb-sep">/</span>
              <select
                className="select select-compact"
                value={tab.schema}
                onChange={(event) => updateTab(tab.id, { schema: event.target.value })}
                title="选择 Schema"
              >
                {schemas.length === 0 ? <option value={tab.schema}>{tab.schema || 'public'}</option> : null}
                {schemas.map((schema) => (
                  <option key={schema} value={schema}>
                    {schema}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <span className="connection-chip" title={connection.name}>
            {connection.name}
          </span>
        </div>

        <div className="query-actions">
          <button
            type="button"
            className="btn btn-run"
            onClick={() => void runQuery()}
            disabled={running}
            title="执行选中内容或全部 SQL (Ctrl/⌘ + Enter)"
          >
            {running ? <Spinner /> : <Play size={14} fill="currentColor" />}
            运行
          </button>
          {running ? (
            <button
              type="button"
              className="btn btn-stop"
              onClick={() => abortRef.current?.abort()}
              title="取消执行"
            >
              <Square size={12} fill="currentColor" />
              停止
            </button>
          ) : null}
          <label className="limit-control" title="结果最多返回行数">
            最多
            <select className="select select-compact" value={maxRows} onChange={(event) => setMaxRows(Number(event.target.value))}>
              {[100, 500, 1000, 5000, 10000].map((value) => (
                <option key={value} value={value}>
                  {formatNumber(value)}
                </option>
              ))}
            </select>
            行
          </label>
          <div className="toolbar-divider" />
          <button
            type="button"
            className="icon-btn"
            title="查询收藏（保存 / 载入常用 SQL）"
            onClick={() => setFavoritesOpen(true)}
          >
            <Star size={16} />
          </button>
          <Dropdown
            align="right"
            trigger={
              <button type="button" className="icon-btn" title="查询历史">
                <History size={16} />
              </button>
            }
            items={[
              { label: '最近执行', header: true },
              ...(filteredHistory.length === 0
                ? [{ label: '暂无执行记录', disabled: true }]
                : filteredHistory.slice(0, 12).map((item) => ({
                    label: item.sql.replace(/\s+/g, ' ').slice(0, 56),
                    icon: <Clock3 size={13} />,
                    shortcut: timeAgo(item.at),
                    onClick: () => updateTab(tab.id, { sql: item.sql }),
                  }))),
              { label: '', separator: true },
              {
                label: '清空历史',
                icon: <Trash2 size={13} />,
                danger: true,
                disabled: filteredHistory.length === 0,
                onClick: () => {
                  clearHistory(userId);
                  setHistory([]);
                  toast('success', '查询历史已清空');
                },
              },
            ]}
            menuClassName="history-menu"
          />
          <Dropdown
            align="right"
            trigger={
              <button type="button" className="icon-btn" title="导出结果" disabled={!activeResult?.rows?.length}>
                <Download size={16} />
              </button>
            }
            items={[
              {
                label: '导出为 CSV',
                icon: <FileSpreadsheet size={14} />,
                disabled: !activeResult?.rows?.length,
                onClick: () => exportResult('csv'),
              },
              {
                label: '导出为 JSON',
                icon: <FileJson size={14} />,
                disabled: !activeResult?.rows?.length,
                onClick: () => exportResult('json'),
              },
            ]}
          />
        </div>
      </div>

      <div className="query-body" ref={bodyRef}>
        <div className="editor-pane" style={{ height: editorHeight }}>
          <SqlEditor
            ref={editorRef}
            value={tab.sql}
            onChange={(sql) => updateTab(tab.id, { sql })}
            driver={connection.driver}
            schema={objects}
            onRun={(selectedSql) => void runQuery(selectedSql)}
          />
        </div>
        <div className="split-handle" onMouseDown={handleSplitStart} title="拖动调整编辑器高度">
          <span />
        </div>
        <div className="results-pane">
          {error ? (
            <div className="result-error-banner">
              <AlertCircle size={16} />
              <div>
                <strong>执行失败</strong>
                <span>{error}</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => setError(null)}>
                <X size={14} />
              </button>
            </div>
          ) : null}

          {results && results.length > 0 ? (
            <>
              <div className="result-tabs">
                {rowsResults.map((result) => {
                  const panelIndex = results.indexOf(result);
                  return (
                    <button
                      type="button"
                      key={`${result.index}-${panelIndex}`}
                      className={classNames('result-tab', activePanel === panelIndex && 'active')}
                      onClick={() => setActivePanel(panelIndex)}
                    >
                      <Table2 size={13} />
                      结果 {panelIndex + 1}
                      <span className="result-tab-count">{formatNumber(result.rowCount)}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={classNames('result-tab', activePanel === 'messages' && 'active')}
                  onClick={() => setActivePanel('messages')}
                >
                  <Terminal size={13} />
                  消息
                  {results.some((item) => item.error) ? <span className="result-tab-dot error" /> : null}
                </button>
                <div className="toolbar-spacer" />
                {running ? (
                  <span className="result-running">
                    <Spinner /> 执行中
                  </span>
                ) : null}
                {duration !== null ? <span className="result-duration">{formatNumber(duration)} ms</span> : null}
              </div>

              <div className="result-content">
                {typeof activePanel === 'number' && activeResult ? (
                  <ResultGrid
                    result={activeResult}
                    sort={sort}
                    onSort={setSort}
                    onCellMenu={(event, value, row) => {
                      event.preventDefault();
                      setCellMenu({
                        x: event.clientX,
                        y: event.clientY,
                        value,
                        row,
                        columns: activeResult.columns ?? [],
                      });
                    }}
                  />
                ) : (
                  <MessagesPanel results={results} />
                )}
                {running ? (
                  <div className="result-overlay">
                    <Spinner size={22} />
                    <span>正在执行 SQL…</span>
                  </div>
                ) : null}
              </div>

              <div className="view-statusbar">
                <span>
                  {hasResultError
                    ? '执行失败'
                    : activeResult?.kind === 'rows'
                      ? `${formatNumber(activeResult.rowCount)} 行`
                      : `${formatNumber(results.reduce((sum, item) => sum + item.affectedRows, 0))} 行受影响`}
                  {activeResult?.truncated ? ' · 已截断' : ''}
                </span>
                <span className="statusbar-spacer" />
                <span>数据库：{tab.database || '默认'}</span>
                <span>总耗时：{duration !== null ? `${formatNumber(duration)} ms` : '—'}</span>
              </div>
            </>
          ) : (
            <div className="result-empty">
              {running ? (
                <div className="query-running-state">
                  <Spinner size={26} />
                  <h3>正在执行 SQL</h3>
                  <p>请稍候，结果返回后会自动显示。</p>
                </div>
              ) : (
                <EmptyState
                  icon={<Terminal size={28} />}
                  title="准备就绪"
                  description="输入 SQL 后按 Ctrl/⌘ + Enter 执行，结果会显示在这里。"
                  action={
                    <div className="shortcut-hint">
                      <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
                      <span>执行全部或选中语句</span>
                    </div>
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>

      {cellMenu ? (
        <ContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          onClose={() => setCellMenu(null)}
          items={[
            {
              label: '复制单元格',
              icon: <Copy size={13} />,
              onClick: () => {
                void navigator.clipboard
                  .writeText(exportCell(cellMenu.value))
                  .then(() => toast('success', '已复制单元格内容'))
                  .catch(() => toast('error', '复制失败'));
              },
            },
            {
              label: '复制整行（JSON）',
              icon: <FileJson size={13} />,
              onClick: () => {
                const object: Record<string, CellValue> = {};
                cellMenu.columns.forEach((column, index) => {
                  object[column.name] = cellMenu.row[index] ?? null;
                });
                void navigator.clipboard
                  .writeText(JSON.stringify(object, null, 2))
                  .then(() => toast('success', '已复制整行 JSON'))
                  .catch(() => toast('error', '复制失败'));
              },
            },
          ]}
        />
      ) : null}

      <SavedQueriesDialog
        open={favoritesOpen}
        connection={connection}
        database={tab.database}
        schema={tab.schema}
        sql={tab.sql}
        onClose={() => setFavoritesOpen(false)}
        onLoad={(item) => {
          updateTab(tab.id, {
            sql: item.sql,
            database: item.database || tab.database,
            schema: item.schema || tab.schema,
          });
          toast('success', '已载入收藏', item.name);
        }}
      />
    </div>
  );

  function exportResult(format: 'csv' | 'json') {
    if (!activeResult?.rows?.length) return;
    const columns = activeResult.columns ?? [];
    const headers = columns.map((column) => column.name);
    if (format === 'csv') {
      const lines = [headers.map(csvCell).join(',')];
      activeResult.rows.forEach((row) => {
        lines.push(headers.map((_, index) => csvCell(exportCell(row[index] ?? null))).join(','));
      });
      downloadText(`\uFEFF${lines.join('\r\n')}`, `${safeFileName(tab.title)}-结果.csv`, 'text/csv;charset=utf-8');
    } else {
      const data = activeResult.rows.map((row) => {
        const object: Record<string, CellValue> = {};
        headers.forEach((header, index) => {
          object[header] = row[index] ?? null;
        });
        return object;
      });
      downloadText(JSON.stringify(data, null, 2), `${safeFileName(tab.title)}-结果.json`, 'application/json;charset=utf-8');
    }
    toast('success', `已导出 ${format.toUpperCase()} 文件`);
  }
}

function ResultGrid({
  result,
  sort,
  onSort,
  onCellMenu,
}: {
  result: QueryResult;
  sort: { index: number; dir: 'asc' | 'desc' } | null;
  onSort: (sort: { index: number; dir: 'asc' | 'desc' } | null) => void;
  onCellMenu: (event: ReactMouseEvent, value: CellValue, row: CellValue[]) => void;
}) {
  const columns = result.columns ?? [];
  const rows = useMemo(() => {
    const source = result.rows ?? [];
    if (!sort) return source;
    const sorted = [...source].sort((left, right) => {
      const a = left[sort.index];
      const b = right[sort.index];
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
    });
    return sort.dir === 'asc' ? sorted : sorted.reverse();
  }, [result.rows, sort]);

  if (!columns.length) {
    return <EmptyState compact icon={<Table2 size={22} />} title="没有结果列" description={result.error || '该语句没有返回结果集。'} />;
  }

  return (
    <div className="grid-scroll">
      <table className="data-grid result-grid">
        <thead>
          <tr>
            <th className="row-number-cell">#</th>
            {columns.map((column, index) => (
              <th
                key={`${column.name}-${index}`}
                title="点击排序"
                onClick={() => {
                  if (sort?.index !== index) onSort({ index, dir: 'asc' });
                  else if (sort.dir === 'asc') onSort({ index, dir: 'desc' });
                  else onSort(null);
                }}
              >
                <span className="column-head">
                  <span>{column.name}</span>
                  {sort?.index === index ? <span className="sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
                </span>
                {column.databaseType || column.scanType ? (
                  <small>{String(column.databaseType || column.scanType).toLowerCase()}</small>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="row-number-cell">{rowIndex + 1}</td>
              {columns.map((column, columnIndex) => {
                const value = row[columnIndex] ?? null;
                return (
                  <td
                    key={`${column.name}-${columnIndex}`}
                    className={classNames(isNumericType(column.databaseType) && 'numeric-cell')}
                    onContextMenu={(event) => onCellMenu(event, value, row)}
                    title={value === null ? 'NULL' : String(value)}
                  >
                    {value === null ? (
                      <span className="null-badge">NULL</span>
                    ) : (
                      <span className="cell-value">{String(value)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated ? (
        <div className="truncated-note">
          <AlertCircle size={13} /> 结果已截断，仅显示前 {formatNumber(result.rowCount)} 行。可在工具栏调整返回行数。
        </div>
      ) : null}
    </div>
  );
}

function MessagesPanel({ results }: { results: QueryResult[] }) {
  return (
    <div className="messages-panel">
      {results.map((result, index) => (
        <div key={index} className={classNames('message-item', result.error && 'has-error')}>
          <div className="message-head">
            <span className={classNames('message-status', result.error ? 'error' : 'ok')}>
              {result.error ? '执行失败' : result.kind === 'rows' ? '查询成功' : '执行成功'}
            </span>
            <span className="message-stats">
              {result.kind === 'rows'
                ? `${formatNumber(result.rowCount)} 行返回`
                : `${formatNumber(result.affectedRows)} 行受影响`}
              {result.lastInsertId ? ` · 自增 ID ${result.lastInsertId}` : ''}
              {' · '}
              {formatNumber(result.durationMs)} ms
            </span>
          </div>
          <pre className="message-sql">{result.statement.length > 600 ? `${result.statement.slice(0, 600)}…` : result.statement}</pre>
          {result.error ? <div className="message-error">{result.error}</div> : null}
        </div>
      ))}
    </div>
  );
}
