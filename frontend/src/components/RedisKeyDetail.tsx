import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Braces,
  Check,
  Clock3,
  Copy,
  Edit3,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { classNames, formatBytes, formatNumber } from '../lib/utils';
import {
  formatRedisTTL,
  redisTypeClass,
  redisTypeLabel,
} from '../lib/redisTree';
import { useAppStore } from '../store/appStore';
import type {
  RedisHashEntry,
  RedisKeyInfo,
  RedisStreamEntry,
  RedisZSetEntry,
} from '../types';
import { EmptyState, Spinner } from './ui';
import {
  RedisEntryModal,
  type RedisEntryDraft,
  type RedisEntryKind,
} from './RedisEntryModal';

interface EntryModalState {
  kind: RedisEntryKind;
  title: string;
  initial?: RedisEntryDraft;
}

function mergeValues(current: RedisKeyInfo, next: RedisKeyInfo): unknown {
  const left = Array.isArray(current.value) ? current.value : [];
  const right = Array.isArray(next.value) ? next.value : [];
  if (next.type === 'hash') {
    const map = new Map<string, RedisHashEntry>();
    for (const item of [...left, ...right] as RedisHashEntry[]) map.set(item.field, item);
    return [...map.values()];
  }
  if (next.type === 'set') {
    return [...new Set([...(left as string[]), ...(right as string[])])];
  }
  if (next.type === 'zset') {
    const map = new Map<string, RedisZSetEntry>();
    for (const item of [...left, ...right] as RedisZSetEntry[]) map.set(item.member, item);
    return [...map.values()];
  }
  return [...left, ...right];
}

export function RedisKeyDetail({
  connectionId,
  database,
  redisKey,
  readOnly,
  refreshToken,
  onRenamed,
  onDeleted,
  onChanged,
}: {
  connectionId: string;
  database: string;
  redisKey: string;
  readOnly: boolean;
  refreshToken: number;
  onRenamed: (newKey: string) => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const [info, setInfo] = useState<RedisKeyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [keyName, setKeyName] = useState(redisKey);
  const [ttlInput, setTTLInput] = useState('-1');
  const [stringDraft, setStringDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [entryModal, setEntryModal] = useState<EntryModalState | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setInfo(null);
        setDirty(false);
      }
      setError(null);
      try {
        const data = await api.redisKey(connectionId, database, redisKey, 0, 200);
        setInfo(data);
        setKeyName(data.key);
        setTTLInput(String(data.ttl));
        if (data.type === 'string') {
          setStringDraft(String(data.value ?? ''));
          setDirty(false);
        }
        if (!silent) setFilter('');
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [connectionId, database, redisKey],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (refreshToken === 0 || dirty) return;
    void load(true);
  }, [refreshToken, dirty, load]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        if (info?.type === 'string' && !readOnly && !info.truncated) {
          event.preventDefault();
          void saveString();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', '已复制', label);
    } catch {
      toast('error', '复制失败', '当前环境不允许访问剪贴板');
    }
  };

  const saveString = async () => {
    if (!info || info.type !== 'string' || readOnly || info.truncated) return;
    setSaving(true);
    setError(null);
    try {
      await api.redisEntry(connectionId, {
        database,
        key: redisKey,
        action: 'set',
        value: stringDraft,
      });
      setDirty(false);
      toast('success', '字符串已保存', redisKey);
      await load(true);
      onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const renameKey = () => {
    if (!info || readOnly) return;
    const nextKey = keyName.trim();
    if (!nextKey || nextKey === info.key) return;
    requestConfirm({
      title: '重命名 Redis 键',
      message: `确定把「${info.key}」重命名为「${nextKey}」吗？如果目标键已存在，操作会失败且不会覆盖。`,
      confirmText: '重命名',
      onConfirm: async () => {
        try {
          await api.redisRenameKey(connectionId, { database, key: info.key, newKey: nextKey });
          toast('success', '键已重命名', nextKey);
          onRenamed(nextKey);
          onChanged();
        } catch (renameError) {
          toast('error', '重命名失败', renameError instanceof Error ? renameError.message : String(renameError));
        }
      },
    });
  };

  const applyTTL = async (persist = false) => {
    if (!info || readOnly) return;
    const ttl = Number(ttlInput);
    if (!persist && (!Number.isFinite(ttl) || ttl <= 0)) {
      setError('TTL 必须是大于 0 的秒数；永久键请点击“永久”');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.redisExpireKey(connectionId, {
        database,
        key: info.key,
        ttl: persist ? undefined : ttl,
        persist,
      });
      setInfo((current) => (current ? { ...current, ttl: result.ttl } : current));
      setTTLInput(String(result.ttl));
      toast('success', persist ? '已移除过期时间' : 'TTL 已更新', persist ? '永久' : `${ttl} 秒`);
      onChanged();
    } catch (ttlError) {
      setError(ttlError instanceof Error ? ttlError.message : String(ttlError));
    } finally {
      setSaving(false);
    }
  };

  const deleteKey = () => {
    if (!info || readOnly) return;
    requestConfirm({
      title: '删除 Redis 键',
      message: `确定删除键「${info.key}」吗？${info.length ? `该键包含 ${formatNumber(info.length)} 项数据，` : ''}此操作不可撤销。`,
      confirmText: '删除键',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteRedisKey(connectionId, database, info.key);
          toast('success', '键已删除', info.key);
          onDeleted();
          onChanged();
        } catch (deleteError) {
          toast('error', '删除失败', deleteError instanceof Error ? deleteError.message : String(deleteError));
        }
      },
    });
  };

  const loadMore = async () => {
    if (!info || !info.more || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await api.redisKey(connectionId, database, redisKey, info.cursor ?? 0, 200);
      setInfo({
        ...next,
        value: mergeValues(info, next),
        length: next.length,
        cursor: next.cursor,
        more: next.more,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingMore(false);
    }
  };

  const openAdd = () => {
    if (!info || readOnly) return;
    switch (info.type) {
      case 'hash':
        setEntryModal({ kind: 'hash', title: '添加 Hash 字段' });
        break;
      case 'list':
        setEntryModal({ kind: 'list', title: '添加 List 元素', initial: { left: false } });
        break;
      case 'set':
        setEntryModal({ kind: 'set', title: '添加 Set 成员' });
        break;
      case 'zset':
        setEntryModal({ kind: 'zset', title: '添加 ZSet 成员', initial: { score: 0 } });
        break;
      case 'stream':
        setEntryModal({ kind: 'stream', title: '添加 Stream 条目' });
        break;
      default:
        break;
    }
  };

  const saveEntry = async (draft: RedisEntryDraft) => {
    if (!info || !entryModal) return;
    const base = { database, key: redisKey };
    const original = entryModal.initial;
    switch (info.type) {
      case 'hash':
        if (original?.field && original.field !== draft.field) {
          await api.redisEntry(connectionId, { ...base, action: 'delete', field: original.field });
        }
        await api.redisEntry(connectionId, {
          ...base,
          action: 'set',
          field: draft.field,
          value: draft.value ?? '',
        });
        break;
      case 'list':
        if (original?.index !== undefined) {
          await api.redisEntry(connectionId, {
            ...base,
            action: 'set',
            index: original.index,
            value: draft.value ?? '',
          });
        } else {
          await api.redisEntry(connectionId, {
            ...base,
            action: 'push',
            value: draft.value ?? '',
            left: draft.left,
          });
        }
        break;
      case 'set':
        if (original?.member && original.member !== draft.member) {
          await api.redisEntry(connectionId, { ...base, action: 'delete', member: original.member });
        }
        await api.redisEntry(connectionId, { ...base, action: 'add', member: draft.member });
        break;
      case 'zset':
        if (original?.member && original.member !== draft.member) {
          await api.redisEntry(connectionId, { ...base, action: 'delete', member: original.member });
        }
        await api.redisEntry(connectionId, {
          ...base,
          action: 'add',
          member: draft.member,
          score: draft.score ?? 0,
        });
        break;
      case 'stream': {
        const parsed = JSON.parse(draft.fieldsText || '{}') as Record<string, string>;
        await api.redisEntry(connectionId, {
          ...base,
          action: 'add',
          id: original?.id,
          fields: parsed,
        });
        break;
      }
      default:
        break;
    }
    await load(true);
    onChanged();
    toast('success', '已保存', redisKey);
  };

  const deleteEntry = (payload: {
    field?: string;
    member?: string;
    index?: number;
    id?: string;
    label: string;
  }) => {
    if (!info || readOnly) return;
    requestConfirm({
      title: '删除 Redis 数据项',
      message: `确定删除 ${payload.label} 吗？此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        try {
          await api.redisEntry(connectionId, {
            database,
            key: redisKey,
            action: 'delete',
            field: payload.field,
            member: payload.member,
            index: payload.index,
            id: payload.id,
          });
          toast('success', '数据项已删除');
          await load(true);
          onChanged();
        } catch (deleteError) {
          toast('error', '删除失败', deleteError instanceof Error ? deleteError.message : String(deleteError));
        }
      },
    });
  };

  const valueRows = useMemo(() => {
    if (!info) return [];
    const keyword = filter.trim().toLowerCase();
    if (info.type === 'hash') {
      return (info.value as RedisHashEntry[])
        .filter((row) => !keyword || row.field.toLowerCase().includes(keyword) || row.value.toLowerCase().includes(keyword))
        .sort((left, right) => left.field.localeCompare(right.field));
    }
    if (info.type === 'list') {
      return (info.value as string[])
        .map((value, index) => ({ value, index }))
        .filter((row) => !keyword || row.value.toLowerCase().includes(keyword));
    }
    if (info.type === 'set') {
      return (info.value as string[])
        .filter((value) => !keyword || value.toLowerCase().includes(keyword))
        .sort((left, right) => left.localeCompare(right));
    }
    if (info.type === 'zset') {
      return (info.value as RedisZSetEntry[]).filter(
        (row) => !keyword || row.member.toLowerCase().includes(keyword) || String(row.score).includes(keyword),
      );
    }
    if (info.type === 'stream') {
      return (info.value as RedisStreamEntry[]).filter(
        (row) =>
          !keyword ||
          row.id.toLowerCase().includes(keyword) ||
          JSON.stringify(row.fields).toLowerCase().includes(keyword),
      );
    }
    return [];
  }, [info, filter]);

  if (loading) {
    return (
      <div className="center-loading">
        <Spinner size={22} />
        <span>正在读取键详情…</span>
      </div>
    );
  }

  if (error && !info) {
    return (
      <EmptyState
        icon={<KeyRound size={26} />}
        title="无法读取键"
        description={error}
        action={
          <button type="button" className="btn" onClick={() => void load()}>
            重试
          </button>
        }
      />
    );
  }

  if (!info) return null;

  const isString = info.type === 'string';
  const canEdit = !readOnly;
  const isCollection = ['hash', 'list', 'set', 'zset', 'stream'].includes(info.type);

  return (
    <div className="redis-detail">
      <div className="redis-detail-header">
        <div className="redis-detail-keyline">
          <span className={classNames('redis-type-badge', redisTypeClass(info.type))}>
            {redisTypeLabel(info.type)}
          </span>
          <input
            className="input redis-key-name-input"
            value={keyName}
            onChange={(event) => setKeyName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') renameKey();
            }}
            disabled={!canEdit}
            spellCheck={false}
          />
          <button
            type="button"
            className="icon-btn"
            title="重命名（Enter）"
            onClick={renameKey}
            disabled={!canEdit || keyName.trim() === info.key}
          >
            <Check size={15} />
          </button>
          <button type="button" className="icon-btn" title="复制键名" onClick={() => void copyText(info.key, info.key)}>
            <Copy size={15} />
          </button>
          {readOnly ? <span className="readonly-badge">只读</span> : null}
          <div className="redis-detail-spacer" />
          <button type="button" className="icon-btn" title="刷新键详情" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className="icon-btn danger-hover"
            title="删除键"
            onClick={deleteKey}
            disabled={!canEdit}
          >
            <Trash2 size={15} />
          </button>
        </div>
        <div className="redis-detail-meta">
          <span title="TTL"><Clock3 size={12} /> TTL {formatRedisTTL(info.ttl)}</span>
          <span title="类型长度">长度 {formatNumber(info.length)}</span>
          {info.size ? <span title="MEMORY USAGE">大小 {formatBytes(info.size)}</span> : null}
          {info.encoding ? <span title="OBJECT ENCODING">编码 {info.encoding}</span> : null}
          <div className="redis-ttl-control">
            <span>TTL</span>
            <input
              className="input input-compact"
              value={ttlInput}
              onChange={(event) => setTTLInput(event.target.value)}
              disabled={!canEdit || saving}
              inputMode="numeric"
              title="秒；-1 表示永久"
            />
            <button type="button" className="btn btn-small" onClick={() => void applyTTL(false)} disabled={!canEdit || saving}>
              秒
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => void applyTTL(true)} disabled={!canEdit || saving}>
              永久
            </button>
          </div>
        </div>
        {error ? <div className="form-error">{error}</div> : null}
      </div>

      {isString ? (
        <section className="redis-value-card">
          <header className="redis-value-head">
            <div>
              <strong>String 值</strong>
              <span>{formatNumber(String(stringDraft).length)} 字符 · {formatNumber(info.length)} 字节</span>
            </div>
            <div className="redis-value-actions">
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  try {
                    setStringDraft(JSON.stringify(JSON.parse(stringDraft), null, 2));
                    setDirty(true);
                  } catch {
                    toast('error', '无法格式化', '当前内容不是合法 JSON');
                  }
                }}
                disabled={!canEdit || info.truncated}
              >
                <Braces size={13} /> 格式化 JSON
              </button>
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => void saveString()}
                disabled={!canEdit || !dirty || saving || info.truncated}
              >
                {saving ? <Spinner /> : <Save size={13} />} 保存
              </button>
            </div>
          </header>
          {info.truncated ? (
            <div className="redis-warning">
              该字符串超过 4 MB，为避免误覆盖，当前只读显示前 4 MB。请使用 CLI 或 SET 命令完整修改。
            </div>
          ) : (
            <textarea
              className="redis-string-editor"
              value={stringDraft}
              onChange={(event) => {
                setStringDraft(event.target.value);
                setDirty(event.target.value !== String(info.value ?? ''));
              }}
              spellCheck={false}
              disabled={!canEdit}
            />
          )}
          <footer className="redis-value-foot">
            <span>{dirty ? '有未保存的修改' : '已同步'}</span>
            <span>Ctrl+S 保存</span>
          </footer>
        </section>
      ) : null}

      {isCollection ? (
        <section className="redis-value-card">
          <header className="redis-value-head">
            <div>
              <strong>{redisTypeLabel(info.type)} 数据</strong>
              <span>
                已显示 {formatNumber(valueRows.length)} / {formatNumber(info.length)} 项
                {info.type === 'stream' && info.length > valueRows.length ? '（Stream 仅显示首屏）' : ''}
              </span>
            </div>
            <div className="redis-value-actions">
              <label className="redis-value-filter">
                <Search size={13} />
                <input
                  className="input input-compact"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="筛选当前页…"
                />
              </label>
              <button type="button" className="btn btn-small btn-primary" onClick={openAdd} disabled={!canEdit}>
                <Plus size={13} /> 添加
              </button>
            </div>
          </header>

          <div className={classNames('redis-value-table', `redis-value-table-${info.type}`)}>
            <div className="redis-value-row head">
              {info.type === 'hash' ? <><span>Field</span><span>Value</span><span /></> : null}
              {info.type === 'list' ? <><span>#</span><span>Value</span><span /></> : null}
              {info.type === 'set' ? <><span>Member</span><span /></> : null}
              {info.type === 'zset' ? <><span>Member</span><span>Score</span><span /></> : null}
              {info.type === 'stream' ? <><span>ID</span><span>Fields</span><span /></> : null}
            </div>
            {valueRows.length === 0 ? (
              <div className="redis-value-empty">
                {filter ? '当前页没有匹配项' : '暂无数据'}
              </div>
            ) : (
              valueRows.map((row, index) => {
                if (info.type === 'hash') {
                  const item = row as RedisHashEntry;
                  return (
                    <div className="redis-value-row" key={`${item.field}:${index}`}>
                      <span className="mono" title={item.field}>{item.field}</span>
                      <span title={item.value}>{item.value}</span>
                      <span className="redis-row-actions">
                        <button
                          type="button"
                          className="icon-btn tiny"
                          title="编辑"
                          disabled={!canEdit}
                          onClick={() => setEntryModal({
                            kind: 'hash',
                            title: '编辑 Hash 字段',
                            initial: { field: item.field, value: item.value },
                          })}
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn tiny danger-hover"
                          title="删除字段"
                          disabled={!canEdit}
                          onClick={() => deleteEntry({ field: item.field, label: `字段「${item.field}」` })}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                }
                if (info.type === 'list') {
                  const item = row as { value: string; index: number };
                  return (
                    <div className="redis-value-row" key={`${item.index}:${item.value}`}>
                      <span className="redis-index">{formatNumber(item.index)}</span>
                      <span title={item.value}>{item.value}</span>
                      <span className="redis-row-actions">
                        <button
                          type="button"
                          className="icon-btn tiny"
                          title="编辑"
                          disabled={!canEdit}
                          onClick={() => setEntryModal({
                            kind: 'list',
                            title: '编辑 List 元素',
                            initial: { index: item.index, value: item.value },
                          })}
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn tiny danger-hover"
                          title="删除元素"
                          disabled={!canEdit}
                          onClick={() => deleteEntry({ index: item.index, label: `索引 ${item.index} 的元素` })}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                }
                if (info.type === 'set') {
                  const item = row as string;
                  return (
                    <div className="redis-value-row" key={`${item}:${index}`}>
                      <span className="mono" title={item}>{item}</span>
                      <span className="redis-row-actions">
                        <button
                          type="button"
                          className="icon-btn tiny"
                          title="编辑成员"
                          disabled={!canEdit}
                          onClick={() => setEntryModal({
                            kind: 'set',
                            title: '编辑 Set 成员',
                            initial: { member: item },
                          })}
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn tiny danger-hover"
                          title="删除成员"
                          disabled={!canEdit}
                          onClick={() => deleteEntry({ member: item, label: `成员「${item}」` })}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                }
                if (info.type === 'zset') {
                  const item = row as RedisZSetEntry;
                  return (
                    <div className="redis-value-row" key={`${item.member}:${index}`}>
                      <span className="mono" title={item.member}>{item.member}</span>
                      <span className="redis-score">{item.score}</span>
                      <span className="redis-row-actions">
                        <button
                          type="button"
                          className="icon-btn tiny"
                          title="编辑成员"
                          disabled={!canEdit}
                          onClick={() => setEntryModal({
                            kind: 'zset',
                            title: '编辑 ZSet 成员',
                            initial: { member: item.member, score: item.score },
                          })}
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn tiny danger-hover"
                          title="删除成员"
                          disabled={!canEdit}
                          onClick={() => deleteEntry({ member: item.member, label: `成员「${item.member}」` })}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                }
                const item = row as RedisStreamEntry;
                return (
                  <div className="redis-value-row" key={`${item.id}:${index}`}>
                    <span className="mono" title={item.id}>{item.id}</span>
                    <span className="mono redis-stream-fields" title={JSON.stringify(item.fields, null, 2)}>
                      {JSON.stringify(item.fields)}
                    </span>
                    <span className="redis-row-actions">
                      <button
                        type="button"
                        className="icon-btn tiny danger-hover"
                        title="删除条目"
                        disabled={!canEdit}
                        onClick={() => deleteEntry({ id: item.id, label: `条目 ${item.id}` })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <footer className="redis-value-foot">
            <span>
              {info.more ? '还有更多数据未加载' : '已加载全部当前类型数据'}
            </span>
            {info.more ? (
              <button type="button" className="btn btn-small" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? <Spinner /> : <RefreshCw size={12} />} 加载更多
              </button>
            ) : null}
          </footer>
        </section>
      ) : null}

      {entryModal ? (
        <RedisEntryModal
          open
          kind={entryModal.kind}
          title={entryModal.title}
          initial={entryModal.initial}
          onClose={() => setEntryModal(null)}
          onSave={saveEntry}
        />
      ) : null}
    </div>
  );
}
