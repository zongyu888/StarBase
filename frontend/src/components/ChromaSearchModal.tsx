import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import { Modal, Spinner } from './ui';
import type { ChromaDocument } from '../types';

interface ChromaSearchModalProps {
  open: boolean;
  connectionId: string;
  collectionId: string;
  collectionName: string;
  onClose: () => void;
}

function parseJSON(text: string, label: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = JSON.parse(trimmed) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return value as Record<string, unknown>;
}

function parseVector(text: string): number[] {
  const value = JSON.parse(text.trim()) as unknown;
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('查询向量必须是非空数字数组，例如 [0.1, 0.2, 0.3]');
  }
  return value as number[];
}

export function ChromaSearchModal({
  open,
  connectionId,
  collectionId,
  collectionName,
  onClose,
}: ChromaSearchModalProps) {
  const [mode, setMode] = useState<'vector' | 'filter'>('vector');
  const [vectorText, setVectorText] = useState('');
  const [nResults, setNResults] = useState('10');
  const [whereText, setWhereText] = useState('');
  const [filterText, setFilterText] = useState('');
  const [limit, setLimit] = useState('20');
  const [results, setResults] = useState<ChromaDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('vector');
    setVectorText('');
    setNResults('10');
    setWhereText('');
    setFilterText('');
    setLimit('20');
    setResults(null);
    setError(null);
    setSearching(false);
  }, [open, collectionId]);

  const execute = async () => {
    setError(null);
    setSearching(true);
    try {
      if (mode === 'vector') {
        const embedding = parseVector(vectorText);
        const where = parseJSON(whereText, '元数据过滤条件');
        const n = Number(nResults);
        if (!Number.isFinite(n) || n <= 0) throw new Error('返回数量必须大于 0');
        const response = await api.chromaQuery(connectionId, collectionId, {
          embedding,
          nResults: Math.min(Math.max(Math.trunc(n), 1), 1000),
          where,
        });
        setResults(response.documents);
      } else {
        const where = parseJSON(filterText, '过滤条件');
        if (!where) throw new Error('请输入元数据过滤条件');
        const count = Number(limit);
        if (!Number.isFinite(count) || count <= 0) throw new Error('返回数量必须大于 0');
        const response = await api.chromaFilter(connectionId, collectionId, {
          where,
          limit: Math.min(Math.max(Math.trunc(count), 1), 1000),
        });
        setResults(response.documents);
      }
    } catch (searchError) {
      setResults(null);
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      setSearching(false);
    }
  };

  return (
    <Modal
      open={open}
      title="向量搜索 / 元数据过滤"
      subtitle={`集合：${collectionName}`}
      onClose={onClose}
      width={860}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={searching}>
            关闭
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void execute()} disabled={searching}>
            {searching ? <Spinner /> : <Search size={14} />}
            执行搜索
          </button>
        </>
      }
    >
      <div className="chroma-search">
        <div className="chroma-segmented">
          <button
            type="button"
            className={mode === 'vector' ? 'active' : ''}
            onClick={() => setMode('vector')}
          >
            <Search size={13} /> 向量搜索
          </button>
          <button
            type="button"
            className={mode === 'filter' ? 'active' : ''}
            onClick={() => setMode('filter')}
          >
            <SlidersHorizontal size={13} /> 元数据过滤
          </button>
        </div>

        {mode === 'vector' ? (
          <div className="chroma-form">
            <label className="field">
              <span>查询向量（JSON 数字数组）</span>
              <textarea
                className="input chroma-textarea chroma-mono"
                value={vectorText}
                onChange={(event) => setVectorText(event.target.value)}
                placeholder="[0.12, -0.03, 0.88, ...]"
                rows={5}
              />
            </label>
            <label className="field">
              <span>返回数量（n_results）</span>
              <input className="input" value={nResults} onChange={(event) => setNResults(event.target.value)} />
            </label>
            <label className="field">
              <span>元数据过滤（可选，JSON）</span>
              <textarea
                className="input chroma-textarea chroma-mono"
                value={whereText}
                onChange={(event) => setWhereText(event.target.value)}
                placeholder={'{"category": "tech"} 或 {"score": {"$gt": 80}}'}
                rows={3}
              />
            </label>
          </div>
        ) : (
          <div className="chroma-form">
            <label className="field">
              <span>过滤条件（JSON）</span>
              <textarea
                className="input chroma-textarea chroma-mono"
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder={'{"category": "tech"} 或 {"score": {"$gte": 60, "$lt": 100}}'}
                rows={5}
              />
            </label>
            <label className="field">
              <span>返回数量</span>
              <input className="input" value={limit} onChange={(event) => setLimit(event.target.value)} />
            </label>
          </div>
        )}

        {error ? <div className="form-error">{error}</div> : null}

        {results ? (
          <div className="chroma-search-results">
            <div className="chroma-search-summary">
              共 {results.length} 条结果
            </div>
            {results.length === 0 ? (
              <div className="chroma-placeholder">没有匹配的文档</div>
            ) : (
              <div className="chroma-table-wrap">
                <table className="chroma-doc-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>ID</th>
                      <th>距离</th>
                      <th>文档</th>
                      <th>元数据</th>
                      <th>向量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((document, index) => (
                      <tr key={`${document.id}-${index}`}>
                        <td>{index + 1}</td>
                        <td className="chroma-doc-id" title={document.id}>
                          {document.id}
                        </td>
                        <td>{document.distance === undefined ? '—' : document.distance.toFixed(4)}</td>
                        <td className="chroma-doc-text" title={document.document}>
                          {(document.document ?? '').slice(0, 160) || '—'}
                        </td>
                        <td className="chroma-doc-meta">
                          {document.metadata ? JSON.stringify(document.metadata) : '—'}
                        </td>
                        <td>{document.embedding && document.embedding.length > 0 ? `${document.embedding.length} 维` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}