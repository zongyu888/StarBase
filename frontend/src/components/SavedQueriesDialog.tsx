import { useEffect, useMemo, useState } from 'react';
import { Clock3, CornerDownLeft, Star, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { Connection, SavedQuery } from '../types';
import { EmptyState, Modal, Spinner } from './ui';

export function SavedQueriesDialog({
  open,
  connection,
  database,
  schema,
  sql,
  onClose,
  onLoad,
}: {
  open: boolean;
  connection: Connection;
  database: string;
  schema: string;
  sql: string;
  onClose: () => void;
  onLoad: (item: SavedQuery) => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const [items, setItems] = useState<SavedQuery[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultName = useMemo(() => {
    const now = new Date();
    return `${connection.name} · ${now.toLocaleDateString('zh-CN')}`;
  }, [connection.name]);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setError(null);
    setLoading(true);
    api
      .savedQueries(connection.id)
      .then(({ queries }) => setItems(queries))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)))
      .finally(() => setLoading(false));
  }, [open, connection.id, defaultName]);

  const save = async () => {
    if (!sql.trim()) {
      setError('当前查询没有 SQL');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const item = await api.createSavedQuery({
        name: name.trim() || defaultName,
        connectionId: connection.id,
        database,
        schema,
        sql,
      });
      setItems((current) => [item, ...current]);
      toast('success', '查询已收藏', item.name);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = (item: SavedQuery) => {
    requestConfirm({
      title: '删除收藏',
      message: `确定删除收藏「${item.name}」吗？只会移除收藏，不影响数据库。`,
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        await api.deleteSavedQuery(item.id);
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        toast('success', '收藏已删除');
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="查询收藏"
      subtitle={`${connection.name} · 收藏保存在本机服务端`}
      width={760}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="favorite-save">
        <label className="field">
          <span>收藏名称</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={defaultName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
          <small className="field-hint">保存当前编辑器中的完整 SQL（包含数据库：{database || '默认'}）。</small>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !sql.trim()}>
          {saving ? <Spinner /> : <Star size={14} />}
          收藏当前 SQL
        </button>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="favorite-list">
        {loading ? (
          <div className="center-loading">
            <Spinner size={20} />
            <span>正在加载收藏…</span>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={<Star size={22} />}
            title="还没有收藏"
            description="把常用 SQL 收藏后，下次可以一键载入。"
          />
        ) : (
          items.map((item) => (
            <div className="favorite-item" key={item.id}>
              <span className="favorite-icon">
                <Star size={14} />
              </span>
              <div className="favorite-body">
                <div className="favorite-title">
                  <strong>{item.name}</strong>
                  <span className="favorite-time">
                    <Clock3 size={11} /> {timeAgo(new Date(item.updatedAt).getTime())}
                  </span>
                </div>
                <pre className="favorite-sql">{item.sql.length > 240 ? `${item.sql.slice(0, 240)}…` : item.sql}</pre>
                <span className="favorite-meta">
                  {item.database || '默认数据库'}
                  {item.schema ? ` / ${item.schema}` : ''}
                </span>
              </div>
              <div className="favorite-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => {
                    onLoad(item);
                    onClose();
                  }}
                >
                  <CornerDownLeft size={13} /> 载入
                </button>
                <button
                  type="button"
                  className="icon-btn danger-hover"
                  onClick={() => remove(item)}
                  title="删除收藏"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
