import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Database,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { classNames, formatNumber } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { ChromaCollection, ChromaDocument, ChromaInfo, ChromaTab } from '../types';
import { EmptyState, Spinner } from '../components/ui';
import { ChromaDocumentModal } from '../components/ChromaDocumentModal';
import { ChromaCollectionDetailsModal, ChromaCreateCollectionModal } from '../components/ChromaCollectionModal';
import { ChromaSearchModal } from '../components/ChromaSearchModal';

const PAGE_SIZES = [10, 20, 50, 100];

function metadataPreview(metadata?: Record<string, unknown>): string {
  if (!metadata || Object.keys(metadata).length === 0) return '—';
  const text = JSON.stringify(metadata);
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

function documentPreview(document?: string): string {
  const text = (document ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export function ChromaView({ tab }: { tab: ChromaTab }) {
  const connection = useAppStore((state) => state.connections.find((item) => item.id === tab.connectionId));
  const updateTab = useAppStore((state) => state.updateTab);
  const setConnected = useAppStore((state) => state.setConnectionConnected);
  const toast = useAppStore((state) => state.toast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);

  const [collections, setCollections] = useState<ChromaCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(tab.collectionId);
  const [info, setInfo] = useState<ChromaInfo | null>(null);
  const [documents, setDocuments] = useState<ChromaDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [refreshToken, setRefreshToken] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [documentModal, setDocumentModal] = useState<{ mode: 'add' | 'edit'; document?: ChromaDocument } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const readOnly = connection?.readOnly ?? false;
  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedId),
    [collections, selectedId],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setSelectedId(tab.collectionId);
  }, [tab.collectionId]);

  const loadCollections = useCallback(async (): Promise<ChromaCollection[]> => {
    if (!connection) return [];
    setCollectionsLoading(true);
    setCollectionsError(null);
    try {
      const data = await api.chromaCollections(connection.id);
      setCollections(data.collections);
      setConnected(connection.id, true);

      if (!selectedId && data.collections.length > 0) {
        const preferred = tab.collection
          ? data.collections.find((item) => item.name === tab.collection || item.id === tab.collection)
          : undefined;
        const initial = preferred ?? data.collections[0];
        setSelectedId(initial.id);
        updateTab(tab.id, {
          collection: initial.name,
          collectionId: initial.id,
          title: `Chroma · ${initial.name}`,
        });
      }
      return data.collections;
    } catch (error) {
      setCollectionsError(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      setCollectionsLoading(false);
    }
  }, [connection?.id, selectedId, tab.collection, tab.id, updateTab, setConnected]);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    const boot = async () => {
      try {
        if (!connection.connected) {
          await api.connect(connection.id);
          if (cancelled) return;
          setConnected(connection.id, true);
        }
        const chromaInfo = await api.chromaInfo(connection.id);
        if (!cancelled) setInfo(chromaInfo);
      } catch (error) {
        if (!cancelled) {
          toast('error', '连接 Chroma 失败', error instanceof Error ? error.message : String(error));
        }
      }
      if (!cancelled) await loadCollections();
    };
    void boot();
    return () => {
      cancelled = true;
    };
    // 连接变化时重新初始化；集合选择变化不应重复连接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.id]);

  useEffect(() => {
    if (refreshToken > 0) void loadCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    if (!connection || !selectedId) {
      setDocuments([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setDocumentsLoading(true);
      setDocumentsError(null);
      try {
        const data = await api.chromaDocuments(connection.id, selectedId, pageSize, (page - 1) * pageSize);
        if (cancelled) return;
        setDocuments(data.documents);
        setTotal(data.total);
        setConnected(connection.id, true);
      } catch (error) {
        if (!cancelled) {
          setDocuments([]);
          setDocumentsError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setDocumentsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [connection?.id, selectedId, page, pageSize, refreshToken, setConnected]);

  const selectCollection = (collection: ChromaCollection) => {
    setSelectedId(collection.id);
    setPage(1);
    updateTab(tab.id, {
      collection: collection.name,
      collectionId: collection.id,
      title: `Chroma · ${collection.name}`,
    });
  };

  const refresh = () => {
    setRefreshToken((value) => value + 1);
  };

  const createCollection = async (name: string, space: string) => {
    if (!connection) return;
    try {
      const created = await api.chromaCreateCollection(connection.id, name, space);
      toast('success', '集合已创建', name);
      setCreateOpen(false);
      await loadCollections();
      setSelectedId(created.id || name);
      setPage(1);
    } catch (error) {
      toast('error', '创建集合失败', error instanceof Error ? error.message : String(error));
    }
  };

  const deleteCollection = (collection: ChromaCollection) => {
    if (!connection) return;
    requestConfirm({
      title: '删除集合',
      message: `确定删除集合「${collection.name}」吗？集合中的文档与向量会一并删除，此操作不可恢复。`,
      confirmText: '删除集合',
      danger: true,
      onConfirm: async () => {
        await api.chromaDeleteCollection(connection.id, collection.id || collection.name);
        toast('success', '集合已删除', collection.name);
        if (collection.id === selectedId) {
          setSelectedId(undefined);
          setDocuments([]);
          setTotal(0);
        }
        setRefreshToken((value) => value + 1);
      },
    });
  };

  const deleteDocument = (document: ChromaDocument) => {
    if (!connection || !selectedId) return;
    requestConfirm({
      title: '删除文档',
      message: `确定删除文档「${document.id}」吗？此操作不可恢复。`,
      confirmText: '删除文档',
      danger: true,
      onConfirm: async () => {
        await api.chromaDeleteDocument(connection.id, selectedId, document.id);
        toast('success', '文档已删除', document.id);
        setRefreshToken((value) => value + 1);
      },
    });
  };

  const submitDocument = async (input: { id: string; document?: string; metadata?: Record<string, unknown>; embedding?: number[] }) => {
    if (!connection || !selectedId || !documentModal) return;
    if (documentModal.mode === 'add') {
      await api.chromaAddDocument(connection.id, selectedId, input);
      toast('success', '文档已添加', input.id);
    } else {
      await api.chromaUpdateDocument(connection.id, selectedId, input.id, input);
      toast('success', '文档已更新', input.id);
    }
    setDocumentModal(null);
    setRefreshToken((value) => value + 1);
  };

  if (!connection) {
    return (
      <div className="chroma-workspace">
        <EmptyState icon={<Database size={24} />} title="连接已删除" description="该标签页对应的连接已不存在。" />
      </div>
    );
  }

  return (
    <div className="chroma-workspace">
      <div className="chroma-toolbar">
        <div className="chroma-connection">
          <span className="chroma-brand-icon">
            <Boxes size={18} />
          </span>
          <div className="chroma-connection-text">
            <div>
              <strong>{connection.name}</strong>
              <span className="chroma-version">{info?.version ? `Chroma ${info.version}` : 'Chroma'}</span>
              {readOnly ? <span className="chroma-readonly">只读</span> : null}
            </div>
            <span>
              {connection.host || '127.0.0.1'}:{connection.port || 8000} · {connection.tenant || info?.tenant || 'default_tenant'} /{' '}
              {connection.database || info?.database || 'default_database'}
            </span>
          </div>
        </div>
        <div className="chroma-toolbar-actions">
          <button type="button" className="btn btn-small" onClick={refresh} disabled={collectionsLoading}>
            <RefreshCw size={13} className={collectionsLoading ? 'spin' : undefined} />
            刷新
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setSearchOpen(true)}
            disabled={!selectedCollection}
          >
            <Search size={13} />
            搜索
          </button>
          <button type="button" className="btn btn-small" onClick={() => setDetailsOpen(true)} disabled={!selectedCollection}>
            <Layers3 size={13} />
            详情
          </button>
          <button type="button" className="btn btn-small btn-primary" onClick={() => setCreateOpen(true)} disabled={readOnly}>
            <Plus size={13} />
            新建集合
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setDocumentModal({ mode: 'add' })}
            disabled={!selectedCollection || readOnly}
          >
            <Plus size={13} />
            添加文档
          </button>
        </div>
      </div>

      <div className="chroma-body">
        <aside className="chroma-collections">
          <div className="chroma-panel-header">
            <span>
              集合 <span className="chroma-count">{collections.length}</span>
            </span>
            <button type="button" className="icon-btn tiny" title="刷新集合" onClick={refresh}>
              <RefreshCw size={12} className={collectionsLoading ? 'spin' : undefined} />
            </button>
          </div>
          <div className="chroma-collection-list">
            {collectionsLoading && collections.length === 0 ? (
              <div className="chroma-placeholder">
                <Spinner size={14} /> 正在加载集合…
              </div>
            ) : collectionsError ? (
              <div className="chroma-error">{collectionsError}</div>
            ) : collections.length === 0 ? (
              <EmptyState
                compact
                icon={<Layers3 size={20} />}
                title="暂无集合"
                description="创建一个集合后即可写入文档与向量。"
                action={
                  <button type="button" className="btn btn-small btn-primary" onClick={() => setCreateOpen(true)}>
                    <Plus size={12} /> 新建集合
                  </button>
                }
              />
            ) : (
              collections.map((collection) => (
                <div
                  key={collection.id || collection.name}
                  className={classNames('chroma-collection-item', collection.id === selectedId && 'active')}
                  onClick={() => selectCollection(collection)}
                >
                  <div className="chroma-collection-main">
                    <span className="chroma-collection-name">{collection.name}</span>
                    <span className="chroma-collection-meta">
                      {formatNumber(collection.count)} 条{collection.distance ? ` · ${collection.distance}` : ''}
                    </span>
                  </div>
                  <div className="chroma-collection-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn tiny"
                      title="集合详情"
                      onClick={() => {
                        setSelectedId(collection.id);
                        setDetailsOpen(true);
                      }}
                    >
                      <Search size={11} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn tiny"
                      title="删除集合"
                      disabled={readOnly}
                      onClick={() => deleteCollection(collection)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="chroma-documents">
          <div className="chroma-panel-header">
            <div className="chroma-documents-title">
              <Layers3 size={14} />
              <strong>{selectedCollection ? selectedCollection.name : '文档浏览'}</strong>
              {selectedCollection ? <span className="chroma-count">{formatNumber(total)} 条</span> : null}
            </div>
            <div className="chroma-documents-actions">
              <label className="chroma-page-size">
                每页
                <select
                  className="select"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                条
              </label>
            </div>
          </div>

          <div className="chroma-documents-body">
            {!selectedCollection ? (
              <EmptyState
                icon={<Layers3 size={24} />}
                title="选择一个集合"
                description="从左侧集合列表中选择集合后浏览文档、向量与元数据。"
              />
            ) : documentsLoading ? (
              <div className="chroma-placeholder">
                <Spinner size={16} /> 正在加载文档…
              </div>
            ) : documentsError ? (
              <div className="chroma-error">{documentsError}</div>
            ) : documents.length === 0 ? (
              <EmptyState
                icon={<Layers3 size={24} />}
                title="暂无文档"
                description="添加文档后即可在此查看 id、文档内容、元数据与向量维度。"
                action={
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    onClick={() => setDocumentModal({ mode: 'add' })}
                    disabled={readOnly}
                  >
                    <Plus size={12} /> 添加文档
                  </button>
                }
              />
            ) : (
              <div className="chroma-table-wrap">
                <table className="chroma-doc-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>文档</th>
                      <th>元数据</th>
                      <th>向量</th>
                      <th className="chroma-col-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr key={document.id}>
                        <td className="chroma-doc-id" title={document.id}>
                          {document.id}
                        </td>
                        <td className="chroma-doc-text" title={document.document}>
                          {documentPreview(document.document)}
                        </td>
                        <td className="chroma-doc-meta" title={document.metadata ? JSON.stringify(document.metadata) : undefined}>
                          {metadataPreview(document.metadata)}
                        </td>
                        <td className="chroma-doc-vector">
                          {document.embedding && document.embedding.length > 0
                            ? `${document.embedding.length} 维`
                            : '—'}
                        </td>
                        <td className="chroma-col-actions">
                          <button
                            type="button"
                            className="icon-btn tiny"
                            title="编辑文档"
                            disabled={readOnly}
                            onClick={() => setDocumentModal({ mode: 'edit', document })}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn tiny"
                            title="删除文档"
                            disabled={readOnly}
                            onClick={() => deleteDocument(document)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selectedCollection && documents.length > 0 ? (
            <div className="chroma-pagination">
              <span>
                第 {page} / {totalPages} 页，共 {formatNumber(total)} 条
              </span>
              <div className="chroma-pagination-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={page <= 1 || documentsLoading}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft size={13} /> 上一页
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={page >= totalPages || documentsLoading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页 <ChevronRight size={13} />
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <ChromaCreateCollectionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createCollection}
      />
      <ChromaCollectionDetailsModal
        open={detailsOpen}
        collection={selectedCollection}
        onClose={() => setDetailsOpen(false)}
      />
      <ChromaDocumentModal
        open={documentModal !== null}
        mode={documentModal?.mode ?? 'add'}
        document={documentModal?.document}
        collectionName={selectedCollection?.name}
        onClose={() => setDocumentModal(null)}
        onSubmit={submitDocument}
      />
      {selectedCollection ? (
        <ChromaSearchModal
          open={searchOpen}
          connectionId={connection.id}
          collectionId={selectedCollection.id || selectedCollection.name}
          collectionName={selectedCollection.name}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default ChromaView;
