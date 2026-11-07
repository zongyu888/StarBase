import { useState } from 'react';
import {
  Activity,
  BarChart3,
  Database,
  MemoryStick,
  RefreshCw,
  Search,
  Server,
  Timer,
  Users,
} from 'lucide-react';
import type { RedisInfo } from '../types';
import { formatNumber } from '../lib/utils';
import {
  formatMemoryValue,
  formatRedisAvgTTL,
  formatUptime,
} from '../lib/redisTree';
import { Spinner } from './ui';

export function RedisDashboard({
  info,
  loading,
  error,
  database,
  updatedAt,
  onRefresh,
  onSelectDatabase,
}: {
  info: RedisInfo | null;
  loading: boolean;
  error: string | null;
  database: string;
  updatedAt: number;
  onRefresh: () => void;
  onSelectDatabase: (database: string) => void;
}) {
  const [infoFilter, setInfoFilter] = useState('');
  const raw = info?.raw ?? {};
  const hits = Number(raw.keyspace_hits ?? 0);
  const misses = Number(raw.keyspace_misses ?? 0);
  const hitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : null;
  const entries = Object.entries(raw)
    .filter(([key]) => !infoFilter.trim() || key.toLowerCase().includes(infoFilter.trim().toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right));
  const keyspace = info?.keyspace ?? [];

  return (
    <div className="redis-dashboard">
      <div className="redis-dashboard-head">
        <div>
          <h2>Redis 服务器</h2>
          <p>
            {raw.role ? `${raw.role} · ` : ''}
            {raw.mode ? `${raw.mode} · ` : ''}
            DB {database}
            {updatedAt ? ` · 更新于 ${new Date(updatedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-small" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> 刷新
        </button>
      </div>

      {error ? (
        <div className="redis-dashboard-error">
          <strong>无法读取 INFO</strong>
          <span>{error}</span>
          <button type="button" className="btn btn-small" onClick={onRefresh}>
            重试
          </button>
        </div>
      ) : null}

      <div className="redis-status-grid">
        <section className="redis-status-card">
          <header>
            <span className="redis-status-icon server"><Server size={15} /></span>
            <strong>Server</strong>
          </header>
          <div className="redis-status-row">
            <span>Redis 版本</span>
            <b>{raw.redis_version || '—'}</b>
          </div>
          <div className="redis-status-row" title={raw.os}>
            <span>操作系统</span>
            <b className="truncate">{raw.os || '—'}</b>
          </div>
          <div className="redis-status-row">
            <span>进程 ID</span>
            <b>{raw.process_id || '—'}</b>
          </div>
          <div className="redis-status-row">
            <span>运行时长</span>
            <b>{formatUptime(Number(raw.uptime_in_seconds ?? 0))}</b>
          </div>
        </section>

        <section className="redis-status-card">
          <header>
            <span className="redis-status-icon memory"><MemoryStick size={15} /></span>
            <strong>Memory</strong>
          </header>
          <div className="redis-status-row">
            <span>已用内存</span>
            <b>{formatMemoryValue(raw.used_memory)}</b>
          </div>
          <div className="redis-status-row">
            <span>内存峰值</span>
            <b>{formatMemoryValue(raw.used_memory_peak)}</b>
          </div>
          <div className="redis-status-row">
            <span>Lua 内存</span>
            <b>{formatMemoryValue(raw.used_memory_lua)}</b>
          </div>
          <div className="redis-status-row">
            <span>RSS 内存</span>
            <b>{formatMemoryValue(raw.used_memory_rss)}</b>
          </div>
        </section>

        <section className="redis-status-card">
          <header>
            <span className="redis-status-icon stats"><Activity size={15} /></span>
            <strong>Stats</strong>
          </header>
          <div className="redis-status-row">
            <span>已连接客户端</span>
            <b>{raw.connected_clients ? formatNumber(Number(raw.connected_clients)) : '—'}</b>
          </div>
          <div className="redis-status-row">
            <span>累计连接数</span>
            <b>{raw.total_connections_received ? formatNumber(Number(raw.total_connections_received)) : '—'}</b>
          </div>
          <div className="redis-status-row">
            <span>累计命令数</span>
            <b>{raw.total_commands_processed ? formatNumber(Number(raw.total_commands_processed)) : '—'}</b>
          </div>
          <div className="redis-status-row">
            <span>缓存命中率</span>
            <b>{hitRate === null ? '—' : `${hitRate.toFixed(1)}%`}</b>
          </div>
        </section>
      </div>

      <section className="redis-card">
        <header className="redis-card-head">
          <div>
            <span className="redis-status-icon keyspace"><BarChart3 size={15} /></span>
            <strong>Key Statistics</strong>
          </div>
          <span className="redis-card-hint">点击数据库行切换当前 DB</span>
        </header>
        {keyspace.length === 0 ? (
          <div className="redis-card-empty">{loading ? <Spinner size={16} /> : '暂无 keyspace 数据'}</div>
        ) : (
          <div className="redis-keyspace-table">
            <div className="redis-keyspace-row head">
              <span>DB</span>
              <span>Keys</span>
              <span>Expires</span>
              <span>Avg TTL</span>
            </div>
            {keyspace.map((row) => (
              <button
                type="button"
                key={row.db}
                className={`redis-keyspace-row ${String(row.db) === database ? 'active' : ''}`}
                onClick={() => onSelectDatabase(String(row.db))}
              >
                <span><Database size={12} /> DB{row.db}</span>
                <span>{formatNumber(row.keys)}</span>
                <span>{formatNumber(row.expires)}</span>
                <span>{formatRedisAvgTTL(row.avgTtl)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="redis-card">
        <header className="redis-card-head">
          <div>
            <span className="redis-status-icon info"><Timer size={15} /></span>
            <strong>全部 INFO</strong>
            <span className="redis-card-count">{entries.length}</span>
          </div>
          <label className="redis-info-filter">
            <Search size={13} />
            <input
              className="input input-compact"
              value={infoFilter}
              onChange={(event) => setInfoFilter(event.target.value)}
              placeholder="筛选字段…"
            />
          </label>
        </header>
        <div className="redis-info-table">
          <div className="redis-info-row head">
            <span>字段</span>
            <span>值</span>
          </div>
          {entries.map(([key, value]) => (
            <div className="redis-info-row" key={key}>
              <span>{key}</span>
              <span title={value}>{value}</span>
            </div>
          ))}
          {entries.length === 0 ? <div className="redis-card-empty">没有匹配的 INFO 字段</div> : null}
        </div>
      </section>

      <div className="redis-dashboard-foot">
        <Users size={12} /> INFO 数据由 Redis 服务端实时返回，自动刷新周期可在顶部调整。
      </div>
    </div>
  );
}
