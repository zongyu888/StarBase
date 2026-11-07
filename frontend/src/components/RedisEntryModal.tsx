import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Modal, Spinner } from './ui';

export type RedisEntryKind = 'hash' | 'list' | 'set' | 'zset' | 'stream';

export interface RedisEntryDraft {
  field?: string;
  value?: string;
  member?: string;
  score?: number;
  index?: number;
  id?: string;
  fieldsText?: string;
  left?: boolean;
}

export function RedisEntryModal({
  open,
  kind,
  title,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  kind: RedisEntryKind;
  title: string;
  initial?: RedisEntryDraft;
  onClose: () => void;
  onSave: (draft: RedisEntryDraft) => Promise<void>;
}) {
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [member, setMember] = useState('');
  const [score, setScore] = useState('0');
  const [fieldsText, setFieldsText] = useState('{}');
  const [left, setLeft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setField(initial?.field ?? '');
    setValue(initial?.value ?? '');
    setMember(initial?.member ?? '');
    setScore(String(initial?.score ?? 0));
    setFieldsText(initial?.fieldsText ?? '{}');
    setLeft(Boolean(initial?.left));
    setError(null);
    setSaving(false);
  }, [open, initial]);

  const save = async () => {
    setError(null);
    if (kind === 'hash' && !field.trim()) {
      setError('字段名不能为空');
      return;
    }
    if (kind === 'set' && !member.trim()) {
      setError('成员不能为空');
      return;
    }
    if (kind === 'zset') {
      if (!member.trim()) {
        setError('成员不能为空');
        return;
      }
      if (!Number.isFinite(Number(score))) {
        setError('Score 必须是数字');
        return;
      }
    }
    if (kind === 'stream') {
      try {
        const parsed = JSON.parse(fieldsText || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('必须是 JSON 对象');
        }
      } catch (parseError) {
        setError(`字段 JSON 无效：${parseError instanceof Error ? parseError.message : String(parseError)}`);
        return;
      }
    }
    setSaving(true);
    try {
      await onSave({
        field: field.trim(),
        value,
        member: member.trim(),
        score: Number(score),
        index: initial?.index,
        id: initial?.id,
        fieldsText,
        left,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
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
      title={title}
      subtitle={
        kind === 'hash'
          ? 'Hash 字段'
          : kind === 'list'
            ? 'List 元素'
            : kind === 'set'
              ? 'Set 成员'
              : kind === 'zset'
                ? 'Sorted Set 成员'
                : 'Stream 条目'
      }
      width={560}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner /> : <Save size={14} />} 保存
          </button>
        </>
      }
    >
      <div className="redis-entry-form">
        {kind === 'hash' ? (
          <>
            <label className="field">
              <span>Field</span>
              <input className="input" value={field} onChange={(event) => setField(event.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Value</span>
              <textarea
                className="input redis-entry-textarea"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                spellCheck={false}
              />
            </label>
          </>
        ) : null}

        {kind === 'list' ? (
          <>
            {initial?.index !== undefined ? (
              <div className="redis-entry-index">当前索引：{initial.index}</div>
            ) : (
              <label className="redis-entry-check">
                <input type="checkbox" checked={left} onChange={(event) => setLeft(event.target.checked)} />
                从列表左侧插入
              </label>
            )}
            <label className="field">
              <span>Value</span>
              <textarea
                className="input redis-entry-textarea"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                autoFocus
                spellCheck={false}
              />
            </label>
          </>
        ) : null}

        {kind === 'set' ? (
          <label className="field">
            <span>Member</span>
            <input className="input" value={member} onChange={(event) => setMember(event.target.value)} autoFocus />
            <small>修改成员会先删除旧成员，再添加新成员。</small>
          </label>
        ) : null}

        {kind === 'zset' ? (
          <>
            <label className="field">
              <span>Member</span>
              <input className="input" value={member} onChange={(event) => setMember(event.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Score</span>
              <input className="input" value={score} onChange={(event) => setScore(event.target.value)} inputMode="decimal" />
            </label>
          </>
        ) : null}

        {kind === 'stream' ? (
          <>
            {initial?.id ? <div className="redis-entry-index">条目 ID：{initial.id}</div> : null}
            <label className="field">
              <span>字段（JSON 对象）</span>
              <textarea
                className="input redis-entry-textarea mono"
                value={fieldsText}
                onChange={(event) => setFieldsText(event.target.value)}
                spellCheck={false}
              />
            </label>
            {!initial?.id ? <small className="redis-entry-note">条目 ID 留空时由 Redis 自动生成（*）。</small> : null}
          </>
        ) : null}

        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </Modal>
  );
}
