import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Modal, Spinner } from './ui';
import type { ChromaDocument, ChromaDocumentInput } from '../types';

interface ChromaDocumentModalProps {
  open: boolean;
  mode: 'add' | 'edit';
  document?: ChromaDocument;
  collectionName?: string;
  onClose: () => void;
  onSubmit: (input: ChromaDocumentInput) => Promise<void>;
}

function newDocumentId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseMetadata(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = JSON.parse(trimmed) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('元数据必须是 JSON 对象，例如 {"category":"tech"}');
  }
  return value as Record<string, unknown>;
}

function parseEmbedding(text: string): number[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('向量必须是数字数组，例如 [0.1, 0.2, 0.3]');
  }
  return value as number[];
}

export function ChromaDocumentModal({
  open,
  mode,
  document,
  collectionName,
  onClose,
  onSubmit,
}: ChromaDocumentModalProps) {
  const [id, setId] = useState('');
  const [content, setContent] = useState('');
  const [metadata, setMetadata] = useState('');
  const [embedding, setEmbedding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setId(mode === 'add' ? newDocumentId() : document?.id ?? '');
    setContent(document?.document ?? '');
    setMetadata(document?.metadata && Object.keys(document.metadata).length > 0 ? JSON.stringify(document.metadata, null, 2) : '');
    setEmbedding(document?.embedding && document.embedding.length > 0 ? JSON.stringify(document.embedding) : '');
    setError(null);
    setSaving(false);
  }, [open, mode, document]);

  const submit = async () => {
    const trimmedId = id.trim();
    if (!trimmedId) {
      setError('文档 ID 不能为空');
      return;
    }
    let parsedMetadata: Record<string, unknown> | undefined;
    let parsedEmbedding: number[] | undefined;
    try {
      parsedMetadata = parseMetadata(metadata);
      parsedEmbedding = parseEmbedding(embedding);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        id: trimmedId,
        document: content,
        metadata: parsedMetadata,
        embedding: parsedEmbedding,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={mode === 'add' ? '添加文档' : '编辑文档'}
      subtitle={collectionName ? `集合：${collectionName}` : undefined}
      onClose={onClose}
      width={680}
      closeOnOverlay={!saving}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner /> : <Save size={14} />}
            保存文档
          </button>
        </>
      }
    >
      <div className="chroma-form">
        <label className="field">
          <span>文档 ID</span>
          <input
            className="input"
            value={id}
            onChange={(event) => setId(event.target.value)}
            disabled={mode === 'edit'}
            placeholder="唯一主键，例如 doc-001"
          />
        </label>
        <label className="field">
          <span>文档内容</span>
          <textarea
            className="input chroma-textarea"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="输入文本内容；可以为空，Chroma 也允许仅存元数据与向量。"
            rows={5}
          />
        </label>
        <label className="field">
          <span>元数据（JSON，可选）</span>
          <textarea
            className="input chroma-textarea chroma-mono"
            value={metadata}
            onChange={(event) => setMetadata(event.target.value)}
            placeholder={'{"category": "tech", "score": 80}'}
            rows={4}
          />
        </label>
        <label className="field">
          <span>向量（JSON 数字数组，可选）</span>
          <textarea
            className="input chroma-textarea chroma-mono"
            value={embedding}
            onChange={(event) => setEmbedding(event.target.value)}
            placeholder="[0.12, -0.03, 0.88, ...]；留空时由 Chroma 默认 embedding function 生成"
            rows={4}
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </Modal>
  );
}