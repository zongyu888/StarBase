import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../store/appStore';
import type { Connection } from '../types';
import { Modal, Spinner } from './ui';

type NewKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset';

interface PairRow {
  key: string;
  value: string;
}

interface ScoreRow {
  member: string;
  score: string;
}

export function RedisNewKeyDialog({
  open,
  connection,
  database,
  onClose,
  onCreated,
}: {
  open: boolean;
  connection: Connection;
  database: string;
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const [key, setKey] = useState('');
  const [type, setType] = useState<NewKeyType>('string');
  const [ttl, setTTL] = useState('0');
  const [stringValue, setStringValue] = useState('');
  const [lines, setLines] = useState('');
  const [hashRows, setHashRows] = useState<PairRow[]>([{ key: '', value: '' }]);
  const [zsetRows, setZsetRows] = useState<ScoreRow[]>([{ member: '', score: '0' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKey('');
    setType('string');
    setTTL('0');
    setStringValue('');
    setLines('');
    setHashRows([{ key: '', value: '' }]);
    setZsetRows([{ member: '', score: '0' }]);
    setSaving(false);
    setError(null);
  }, [open]);

  const create = async () => {
    if (!key.trim()) {
      setError('键名不能为空');
      return;
    }
    const ttlValue = Number(ttl);
    if (!Number.isFinite(ttlValue) || ttlValue < 0) {
      setError('TTL 必须是不小于 0 的秒数（0 表示永久）');
      return;
    }
    let value: unknown = stringValue;
    if (type === 'hash') {
      const entries = hashRows
        .map((row) => [row.key.trim(), row.value] as const)
        .filter(([field]) => field);
      if (entries.length === 0) {
        setError('Hash 至少需要一个字段');
        return;
      }
      value = Object.fromEntries(entries);
    }
    if (type === 'list' || type === 'set') {
      const items = lines.split(/\r?\n/).filter((item) => item !== '');
      if (items.length === 0) {
        setError(`${type === 'list' ? 'List' : 'Set'} 至少需要一个元素`);
        return;
      }
      value = items;
    }
    if (type === 'zset') {
      const items = zsetRows
        .map((row) => ({ member: row.member.trim(), score: Number(row.score) }))
        .filter((row) => row.member);
      if (items.length === 0) {
        setError('ZSet 至少需要一个成员');
        return;
      }
      if (items.some((row) => !Number.isFinite(row.score))) {
        setError('ZSet 的 Score 必须是数字');
        return;
      }
      value = items;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setRedisKey(connection.id, {
        database,
        key: key.trim(),
        type,
        value,
        ttl: ttlValue,
        overwrite: false,
      });
      toast('success', 'Redis 键已创建', key.trim());
      onCreated(key.trim());
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title="新建 Redis 键"
      subtitle={`${connection.name} · DB ${database}`}
      width={640}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={saving}>
            {saving ? <Spinner /> : <Save size={14} />} 创建
          </button>
        </>
      }
    >
      <div className="redis-new-key-form">
        <div className="redis-new-key-row">
          <label className="field">
            <span>键名</span>
            <input
              className="input"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="例如 user:1001"
              autoFocus
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>类型</span>
            <select
              className="input"
              value={type}
              onChange={(event) => setType(event.target.value as NewKeyType)}
            >
              <option value="string">String</option>
              <option value="hash">Hash</option>
              <option value="list">List</option>
              <option value="set">Set</option>
              <option value="zset">Sorted Set</option>
            </select>
          </label>
          <label className="field redis-new-key-ttl">
            <span>TTL（秒，0 永久）</span>
            <input
              className="input"
              value={ttl}
              onChange={(event) => setTTL(event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>

        {type === 'string' ? (
          <label className="field">
            <span>值</span>
            <textarea
              className="input redis-entry-textarea"
              value={stringValue}
              onChange={(event) => setStringValue(event.target.value)}
              spellCheck={false}
            />
          </label>
        ) : null}

        {type === 'hash' ? (
          <div className="redis-new-key-rows">
            <div className="redis-new-key-rows-head">
              <span>Field</span>
              <span>Value</span>
              <span />
            </div>
            {hashRows.map((row, index) => (
              <div className="redis-new-key-rows-row" key={index}>
                <input
                  className="input"
                  value={row.key}
                  onChange={(event) =>
                    setHashRows((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, key: event.target.value } : item))
                  }
                  placeholder="field"
                />
                <input
                  className="input"
                  value={row.value}
                  onChange={(event) =>
                    setHashRows((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, value: event.target.value } : item))
                  }
                  placeholder="value"
                />
                <button
                  type="button"
                  className="icon-btn tiny danger-hover"
                  onClick={() => setHashRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  disabled={hashRows.length <= 1}
                  title="删除字段"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => setHashRows((current) => [...current, { key: '', value: '' }])}
            >
              <Plus size={12} /> 添加字段
            </button>
          </div>
        ) : null}

        {type === 'list' || type === 'set' ? (
          <label className="field">
            <span>{type === 'list' ? 'List 元素（一行一个，按顺序写入）' : 'Set 成员（一行一个）'}</span>
            <textarea
              className="input redis-entry-textarea mono"
              value={lines}
              onChange={(event) => setLines(event.target.value)}
              placeholder={type === 'list' ? 'first\nsecond\nthird' : 'member-a\nmember-b'}
              spellCheck={false}
            />
          </label>
        ) : null}

        {type === 'zset' ? (
          <div className="redis-new-key-rows">
            <div className="redis-new-key-rows-head zset">
              <span>Member</span>
              <span>Score</span>
              <span />
            </div>
            {zsetRows.map((row, index) => (
              <div className="redis-new-key-rows-row zset" key={index}>
                <input
                  className="input"
                  value={row.member}
                  onChange={(event) =>
                    setZsetRows((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, member: event.target.value } : item))
                  }
                  placeholder="member"
                />
                <input
                  className="input"
                  value={row.score}
                  onChange={(event) =>
                    setZsetRows((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, score: event.target.value } : item))
                  }
                  inputMode="decimal"
                  placeholder="0"
                />
                <button
                  type="button"
                  className="icon-btn tiny danger-hover"
                  onClick={() => setZsetRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  disabled={zsetRows.length <= 1}
                  title="删除成员"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => setZsetRows((current) => [...current, { member: '', score: '0' }])}
            >
              <Plus size={12} /> 添加成员
            </button>
          </div>
        ) : null}

        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </Modal>
  );
}
