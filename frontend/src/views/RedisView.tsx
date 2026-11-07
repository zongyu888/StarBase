import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  Database,
  Plus,
  RefreshCw,
  Search,
  Terminal,
} from 'lucide-react';
import { api } from '../lib/api';
import { classNames } from '../lib/utils';
import { buildRedisPattern, type RedisMatchMode } from '../lib/redisTree';
import { useAppStore } from '../store/appStore';
import type {
  DatabaseInfo,
  RedisInfo,
  RedisKeyMeta,
  RedisTab,
} from '../types';
import { EmptyState, Spinner, Switch } from '../components/ui';
import { RedisKeyTree } from '../components/RedisKeyTree';
import { RedisDashboard } from '../components/RedisDashboard';
import { RedisKeyDetail } from '../components/RedisKeyDetail';
import { RedisNewKeyDialog } from '../components/RedisNewKeyDialog';
import { RedisCli } from '../components/RedisCli';

function mergeKeys(current: RedisKeyMeta[], incoming: RedisKeyMeta[]): RedisKeyMeta[] {
  const map = new Map(current.map((item) => [item.key, item]));
  for (const item of incoming) map.set(item.key, item);
  return [...map.values()];
}

export function RedisView({ tab }: { tab: RedisTab }) {
  const connection = useAppStore((state) => state.connections.find((item) => item.id === tab.connectionId));
  const updateTab = useAppStore((state) => state.updateTab);
  const setConnected = useAppStore((state) => state.setConnectionConnected);
  const toast = useAppStore((state) => state.toast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);

  const [database, setDatabase] = useState(tab.database);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(tab.key);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [keys, setKeys] = useState<RedisKeyMeta[]>([]);
  const [keysCursor, setKeysCursor] = useState(0);
  const [keysDone, setKeysDone] = useState<boolean>(false);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [info, setInfo] = useState<RedisInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [matchMode, setMatchMode] = useState<RedisMatchMode>('contains');
  const [typeFilter, setTypeFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(5);
  const [cliOpen, setCliOpen] = useState(false);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const keySeq = useRef(0);
  const infoSeq = useRef(0);

  const pattern = useMemo(() => buildRedisPattern(searchInput, matchMode), [searchInput, matchMode]);

  useEffect(() => {
    setDatabase(tab.database);
  }, [tab.database]);

  useEffect(() => {
    setSelectedKey(tab.key);
  }, [tab.key]);

  const loadDatabases = useCallback(async () => {
    if (!connection) return;
    try {
      const data = await api.databases(connection.id);
      setDatabases(data.databases);
    } catch {
      setDatabases([]);
    }
  }, [connection?.id]);

  const loadInfo = useCallback(async () => {
    if (!connection) return;
    const seq = ++infoSeq.current;
    setInfoLoading(true);
    setInfoError(null);
    try {
      const data = await api.redisInfo(connection.id, database);
      if (seq !== infoSeq.current) return;
      setInfo(data);
      setUpdatedAt(Date.now());
      setConnected(connection.id, true);
    } catch (loadError) {
      if (seq !== infoSeq.current) return;
      setInfo(null);
      setInfoError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (seq === infoSeq.current) setInfoLoading(false);
    }
  }, [connection?.id, database, setConnected]);

  const loadKeys = useCallback(
    async (reset: boolean, cursor: number) => {
      if (!connection) return;
      const seq = ++keySeq.current;
      if (reset) {
        setLoadingKeys(true);
        setKeys([]);
        setKeysCursor(0);
        setKeysDone(false);
      } else {
        setLoadingMore(true);
      }
      setKeysError(null);
      try {
        const page = await api.redisKeys(connection.id, {
          database,
          pattern,
          type: typeFilter,
          cursor,
          count: 300,
        });
        if (seq !== keySeq.current) return;
        setKeys((current) => (reset ? page.keys : mergeKeys(current, page.keys)));
        setKeysCursor(page.cursor);
        setKeysDone(page.done);
        setConnected(connection.id, true);
      } catch (loadError) {
        if (seq !== keySeq.current) return;
        setKeysError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (seq === keySeq.current) {
          setLoadingKeys(false);
          setLoadingMore(false);
        }
      }
    },
    [connection?.id, database, pattern, typeFilter, setConnected],
  );

  useEffect(() => {
    if (!connection) return;
    if (!connection.connected) {
      void api
        .connect(connection.id)
        .then(() => setConnected(connection.id, true))
        .catch(() => undefined);
    }
    void loadDatabases();
  }, [connection?.id, loadDatabases, setConnected]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadKeys(true, 0);
    }, searchInput ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadKeys, searchInput]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void loadInfo();
      setRefreshToken((value) => value + 1);
    }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshSeconds, loadInfo]);

  useEffect(() => {
    setLoadingKeys(true);
    setKeys([]);
    setSelectedKey(undefined);
    if (tab.key) setSelectedKey(tab.key);
  }, [database]);

  const refreshAll = () => {
    void loadInfo();
    void loadKeys(true, 0);
    void loadDatabases();
    setRefreshToken((value) => value + 1);
  };

  const loadMore = () => {
    if (keysDone || loadingMore || loadingAll) return;
    void loadKeys(false, keysCursor);
  };

  const loadAll = async () => {
    if (!connection || keysDone || loadingAll) return;
    setLoadingAll(true);
    setKeysError(null);
    let all = keys;
    let cursor = keysCursor;
    let done: boolean = keysDone;
    let rounds = 0;
    try {
      while (!done && all.length < 5000 && rounds < 8) {
        const page = await api.redisKeys(connection.id, {
          database,
          pattern,
          type: typeFilter,
          cursor,
          count: 1000,
        });
        all = mergeKeys(all, page.keys);
        cursor = page.cursor;
        done = page.done;
        rounds += 1;
        setKeys(all);
        setKeysCursor(cursor);
        setKeysDone(done);
      }
      if (!done) {
        toast('warning', '已加载 5000 个键', '继续加载请再次点击“加载全部”，或使用前缀缩小范围');
      }
    } catch (loadError) {
      setKeysError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingAll(false);
    }
  };

  const switchDatabase = (next: string) => {
    if (!connection || next === database) return;
    setDatabase(next);
    setSelectedKey(undefined);
    setKeysDone(false);
    setKeysCursor(0);
    updateTab(tab.id, { database: next, title: `Redis · DB${next}`, key: undefined });
  };

  const selectKey = (key: string) => {
    setSelectedKey(key);
    updateTab(tab.id, { key });
  };

  const clearSelection = () => {
    setSelectedKey(undefined);
    updateTab(tab.id, { key: undefined });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', '已复制', text);
    } catch {
      toast('error', '复制失败', '当前环境不允许访问剪贴板');
    }
  };

  const deleteKeys = (keysToDelete: string[]) => {
    if (!connection || connection.readOnly || keysToDelete.length === 0) {
      if (connection?.readOnly) toast('warning', '当前连接为只读模式');
      return;
    }
    requestConfirm({
      title: '删除 Redis 键',
      message: `确定删除选中的 ${keysToDelete.length} 个键吗？此操作不可撤销。`,
      confirmText: '删除键',
      danger: true,
      onConfirm: async () => {
        try {
          const result = await api.redisDeleteKeys(connection.id, {
            database,
            keys: keysToDelete,
          });
          toast('success', '键已删除', `${result.deleted} 个键`);
          if (selectedKey && keysToDelete.includes(selectedKey)) clearSelection();
          await loadKeys(true, 0);
          await loadDatabases();
        } catch (deleteError) {
          toast('error', '删除失败', deleteError instanceof Error ? deleteError.message : String(deleteError));
        }
      },
    });
  };

  const deletePattern = (targetPattern: string) => {
    if (!connection || connection.readOnly) {
      toast('warning', '当前连接为只读模式');
      return;
    }
    const allowAll = targetPattern === '*';
    requestConfirm({
      title: '按前缀删除 Redis 键',
      message: `将删除当前 DB 中匹配「${targetPattern}」的所有键（单次最多 5000 个）。此操作不可撤销，确定继续吗？`,
      confirmText: allowAll ? '删除全部键' : '删除匹配键',
      danger: true,
      onConfirm: async () => {
        try {
          const result = await api.redisDeleteKeys(connection.id, {
            database,
            pattern: targetPattern,
            allowAll,
            limit: 5000,
          });
          toast(
            result.truncated ? 'warning' : 'success',
            '删除完成',
            `${result.deleted} 个键${result.truncated ? '，仍有匹配键未处理，请再次执行' : ''}`,
          );
          clearSelection();
          await loadKeys(true, 0);
          await loadDatabases();
        } catch (deleteError) {
          toast('error', '删除失败', deleteError instanceof Error ? deleteError.message : String(deleteError));
        }
      },
    });
  };

  const usePrefix = (prefixPattern: string) => {
    setSearchInput(prefixPattern);
    setMatchMode('glob');
  };

  const refreshAfterChange = () => {
    void loadKeys(true, 0);
    void loadDatabases();
  };

  if (!connection) {
    return (
      <EmptyState
        icon={<Database size={26} />}
        title="连接已不存在"
        description="该 Redis 连接已被删除。"
      />
    );
  }

  if (connection.driver !== 'redis') {
    return (
      <EmptyState
        icon={<Boxes size={26} />}
        title="不是 Redis 连接"
        description="当前标签页只能用于 Redis 连接。"
      />
    );
  }

  const dbOptions = databases.length > 0
    ? databases
    : Array.from({ length: 16 }, (_, index) => ({ name: String(index), tableCount: 0, sizeBytes: 0 } as DatabaseInfo));

  return (
    <div className="redis-workspace">
      <header className="redis-toolbar">
        <div className="redis-connection">
          <span className="redis-brand-icon"><Boxes size={18} /></span>
          <div className="redis-connection-text">
            <div>
              <strong>{connection.name}</strong>
              {connection.readOnly ? <span className="readonly-badge">只读</span> : null}
            </div>
            <span>{connection.host}:{connection.port} · Redis</span>
          </div>
        </div>
        <div className="redis-toolbar-actions">
          <label className="redis-db-picker">
            <span>DB</span>
            <select
              className="input input-compact"
              value={database}
              onChange={(event) => switchDatabase(event.target.value)}
            >
              {dbOptions.map((item) => (
                <option key={item.name} value={item.name}>
                  DB{item.name} · {item.tableCount}
                </option>
              ))}
            </select>
          </label>
          <div className="redis-auto-refresh">
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
            <span>自动刷新</span>
            <select
              className="input input-compact"
              value={refreshSeconds}
              onChange={(event) => setRefreshSeconds(Number(event.target.value))}
              disabled={!autoRefresh}
            >
              <option value={2}>2s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => setNewKeyOpen(true)}
            disabled={connection.readOnly}
          >
            <Plus size={13} /> 新建键
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={refreshAll}>
            <RefreshCw size={13} /> 刷新
          </button>
          <button
            type="button"
            className={classNames('btn btn-small', cliOpen ? 'btn-active' : 'btn-ghost')}
            onClick={() => setCliOpen((value) => !value)}
          >
            <Terminal size={13} /> CLI
          </button>
        </div>
      </header>

      <div className="redis-body">
        <aside className="redis-sidebar">
          <div className="redis-sidebar-head">
            <div>
              <span className="redis-eyebrow">KEYS</span>
              <strong>{keys.length}{keysDone ? '' : '+'}</strong>
            </div>
            <button type="button" className="icon-btn" title="刷新键列表" onClick={() => void loadKeys(true, 0)} disabled={loadingKeys}>
              <RefreshCw size={14} className={loadingKeys ? 'spin' : ''} />
            </button>
          </div>
          <div className="redis-search-row">
            <Search size={14} />
            <input
              className="input input-compact"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索键名…"
              spellCheck={false}
            />
          </div>
          <div className="redis-filter-row">
            <select
              className="input input-compact"
              value={matchMode}
              onChange={(event) => setMatchMode(event.target.value as RedisMatchMode)}
              title="匹配方式"
            >
              <option value="contains">包含</option>
              <option value="prefix">前缀</option>
              <option value="suffix">后缀</option>
              <option value="exact">精确</option>
              <option value="glob">通配符</option>
            </select>
            <select
              className="input input-compact"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              title="类型过滤"
            >
              <option value="">全部类型</option>
              <option value="string">String</option>
              <option value="hash">Hash</option>
              <option value="list">List</option>
              <option value="set">Set</option>
              <option value="zset">ZSet</option>
              <option value="stream">Stream</option>
            </select>
          </div>
          {pattern !== '*' ? <div className="redis-pattern-hint">MATCH {pattern}</div> : null}
          {keysError ? <div className="redis-list-error">{keysError}</div> : null}
          <RedisKeyTree
            keys={keys}
            selectedKey={selectedKey}
            loading={loadingKeys}
            onSelect={selectKey}
            onDeleteKeys={deleteKeys}
            onDeletePattern={deletePattern}
            onUsePrefix={usePrefix}
            onCopy={(text) => void copyText(text)}
          />
          <div className="redis-list-foot">
            <button
              type="button"
              className="btn btn-small"
              onClick={loadMore}
              disabled={keysDone || loadingMore || loadingAll}
            >
              {loadingMore ? <Spinner /> : <RefreshCw size={12} />} 加载更多
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => void loadAll()}
              disabled={keysDone || loadingAll || loadingMore || keys.length >= 5000}
            >
              {loadingAll ? <Spinner /> : null} 加载全部
            </button>
          </div>
          <div className="redis-list-status">
            {keysDone ? `已加载 ${keys.length} 个键` : `已加载 ${keys.length} 个键，继续加载请点击上方按钮`}
          </div>
        </aside>

        <main className="redis-main">
          {selectedKey ? (
            <RedisKeyDetail
              key={`${database}:${selectedKey}`}
              connectionId={connection.id}
              database={database}
              redisKey={selectedKey}
              readOnly={connection.readOnly}
              refreshToken={refreshToken}
              onRenamed={(nextKey) => {
                setSelectedKey(nextKey);
                updateTab(tab.id, { key: nextKey });
                refreshAfterChange();
              }}
              onDeleted={() => {
                clearSelection();
                refreshAfterChange();
              }}
              onChanged={refreshAfterChange}
            />
          ) : (
            <RedisDashboard
              info={info}
              loading={infoLoading}
              error={infoError}
              database={database}
              updatedAt={updatedAt}
              onRefresh={() => void loadInfo()}
              onSelectDatabase={switchDatabase}
            />
          )}
        </main>
      </div>

      {cliOpen ? (
        <RedisCli
          connectionId={connection.id}
          database={database}
          onChanged={(command) => {
            const first = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
            const removedSelected =
              Boolean(selectedKey) &&
              (first === 'del' || first === 'unlink') &&
              command.includes(selectedKey ?? '');
            const flushed = first === 'flushdb' || first === 'flushall';
            if (removedSelected || flushed) clearSelection();
            refreshAfterChange();
            if (!removedSelected && !flushed) setRefreshToken((value) => value + 1);
          }}
          onClose={() => setCliOpen(false)}
        />
      ) : null}

      <RedisNewKeyDialog
        open={newKeyOpen}
        connection={connection}
        database={database}
        onClose={() => setNewKeyOpen(false)}
        onCreated={(key) => {
          setSelectedKey(key);
          updateTab(tab.id, { key });
          setNewKeyOpen(false);
          refreshAfterChange();
        }}
      />
    </div>
  );
}
