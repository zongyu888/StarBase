import { useEffect, useState } from 'react';
import { Layers3, Plus } from 'lucide-react';
import { Modal, Spinner } from './ui';
import type { ChromaCollection } from '../types';

interface CreateProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, space: string) => Promise<void>;
}

const DISTANCE_OPTIONS: Array<[string, string]> = [
  ['l2', 'L2（欧几里得距离）'],
  ['cosine', 'Cosine（余弦相似度）'],
  ['ip', 'IP（内积）'],
];

export function ChromaCreateCollectionModal({ open, onClose, onCreate }: CreateProps) {
  const [name, setName] = useState('');
  const [space, setSpace] = useState('l2');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setSpace('l2');
    setError(null);
    setSaving(false);
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请填写集合名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate(trimmed, space);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="创建集合"
      subtitle="集合创建后可在工作台中写入文档与向量。"
      onClose={onClose}
      width={440}
      closeOnOverlay={!saving}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner /> : <Plus size={14} />}
            创建集合
          </button>
        </>
      }
    >
      <div className="chroma-form">
        <label className="field">
          <span>集合名称</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 documents"
            autoFocus
          />
        </label>
        <label className="field">
          <span>距离函数</span>
          <select className="select" value={space} onChange={(event) => setSpace(event.target.value)}>
            {DISTANCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </Modal>
  );
}

interface DetailsProps {
  open: boolean;
  collection?: ChromaCollection;
  onClose: () => void;
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ChromaCollectionDetailsModal({ open, collection, onClose }: DetailsProps) {
  if (!collection) return null;
  const hnsw = collection.hnsw ?? {};
  const rows: Array<[string, string, string?]> = [
    ['集合名称', collection.name],
    ['集合 ID', collection.id],
    ['向量维度', displayValue(collection.dimension)],
    ['文档数量', displayValue(collection.count)],
    ['距离度量', displayValue(collection.distance ?? hnsw.space)],
    ['构建参数 (ef_construction)', displayValue(hnsw.ef_construction)],
    ['搜索参数 (ef_search)', displayValue(hnsw.ef_search)],
    ['最大邻居数 (M)', displayValue(hnsw.max_neighbors ?? hnsw.M)],
    ['扩容因子', displayValue(hnsw.resize_factor)],
    ['同步阈值', displayValue(hnsw.sync_threshold)],
    ['租户', displayValue(collection.tenant)],
    ['数据库', displayValue(collection.database)],
  ];

  return (
    <Modal
      open={open}
      title="集合详情"
      subtitle={`HNSW 索引与集合配置 · ${collection.name}`}
      onClose={onClose}
      width={720}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="chroma-details">
        <div className="chroma-details-title">
          <Layers3 size={15} /> 基本信息与索引配置
        </div>
        <div className="chroma-details-grid">
          {rows.map(([label, value]) => (
            <div className="chroma-detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {collection.metadata && Object.keys(collection.metadata).length > 0 ? (
          <>
            <div className="chroma-details-title">元数据</div>
            <pre className="chroma-json-view">{JSON.stringify(collection.metadata, null, 2)}</pre>
          </>
        ) : null}
        {collection.configuration && Object.keys(collection.configuration).length > 0 ? (
          <>
            <div className="chroma-details-title">完整配置</div>
            <pre className="chroma-json-view">{JSON.stringify(collection.configuration, null, 2)}</pre>
          </>
        ) : null}
      </div>
    </Modal>
  );
}