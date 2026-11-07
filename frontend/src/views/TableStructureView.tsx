import { useState } from 'react';
import {
  Code2,
  Columns3,
  Copy,
  Download,
  Info,
  KeyRound,
  Link2,
  RefreshCw,
  Table2,
} from 'lucide-react';
import { downloadText, formatBytes, formatNumber, safeFileName } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { TableMeta } from '../types';
import { EmptyState, Spinner } from '../components/ui';

type StructureTab = 'columns' | 'indexes' | 'foreignKeys' | 'ddl';

export function TableStructureView({
  meta,
  loading,
  onRefresh,
}: {
  meta: TableMeta;
  loading: boolean;
  onRefresh: () => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const [tab, setTab] = useState<StructureTab>('columns');

  const copyDdl = async () => {
    try {
      await navigator.clipboard.writeText(meta.ddl);
      toast('success', 'DDL 已复制');
    } catch {
      toast('error', '复制失败');
    }
  };

  return (
    <div className="structure-view">
      <div className="structure-summary">
        <div className="summary-card">
          <span>数据行数</span>
          <strong>{formatNumber(meta.rows)}</strong>
          <small>{meta.type === 'view' ? '视图结果' : '估算值'}</small>
        </div>
        <div className="summary-card">
          <span>占用空间</span>
          <strong>{formatBytes(meta.sizeBytes)}</strong>
          <small>数据 + 索引</small>
        </div>
        <div className="summary-card">
          <span>存储引擎</span>
          <strong>{meta.engine || (meta.type === 'view' ? 'VIEW' : '—')}</strong>
          <small>{meta.type === 'view' ? '只读对象' : '表类型'}</small>
        </div>
        <div className="summary-card">
          <span>列 / 索引</span>
          <strong>
            {meta.columns.length} / {meta.indexes.length}
          </strong>
          <small>{meta.primaryKey.length ? `主键 ${meta.primaryKey.join(', ')}` : '无主键'}</small>
        </div>
        <div className="summary-card">
          <span>外键</span>
          <strong>{meta.foreignKeys.length}</strong>
          <small>引用关系</small>
        </div>
        <div className="summary-card summary-card-wide">
          <span>注释</span>
          <strong className="summary-comment">{meta.comment || '—'}</strong>
          <small>
            更新于 {meta.updatedAt || '未知'}
          </small>
        </div>
      </div>

      <div className="sub-tabs">
        <button type="button" className={tab === 'columns' ? 'active' : ''} onClick={() => setTab('columns')}>
          <Columns3 size={14} /> 列 <span>{meta.columns.length}</span>
        </button>
        <button type="button" className={tab === 'indexes' ? 'active' : ''} onClick={() => setTab('indexes')}>
          <Table2 size={14} /> 索引 <span>{meta.indexes.length}</span>
        </button>
        <button type="button" className={tab === 'foreignKeys' ? 'active' : ''} onClick={() => setTab('foreignKeys')}>
          <Link2 size={14} /> 外键 <span>{meta.foreignKeys.length}</span>
        </button>
        <button type="button" className={tab === 'ddl' ? 'active' : ''} onClick={() => setTab('ddl')}>
          <Code2 size={14} /> DDL
        </button>
        <div className="toolbar-spacer" />
        <button type="button" className="btn btn-ghost btn-small" onClick={onRefresh} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw size={13} />} 刷新
        </button>
      </div>

      <div className="structure-content">
        {tab === 'columns' ? (
          <div className="grid-scroll">
            <table className="data-grid structure-table">
              <thead>
                <tr>
                  <th className="row-number-cell">#</th>
                  <th>名称</th>
                  <th>数据类型</th>
                  <th>可空</th>
                  <th>默认值</th>
                  <th>键</th>
                  <th>额外</th>
                  <th>注释</th>
                </tr>
              </thead>
              <tbody>
                {meta.columns.map((column) => (
                  <tr key={column.name}>
                    <td className="row-number-cell">{column.position}</td>
                    <td>
                      <span className="column-name">
                        {meta.primaryKey.includes(column.name) ? <KeyRound size={12} className="pk-icon" /> : null}
                        {column.name}
                      </span>
                    </td>
                    <td>
                      <code className="type-code">{column.columnType || column.dataType}</code>
                    </td>
                    <td>
                      {column.nullable ? <span className="soft-badge">YES</span> : <span className="soft-badge strong">NO</span>}
                    </td>
                    <td>
                      {column.defaultValue === null || column.defaultValue === '' ? (
                        <span className="muted">—</span>
                      ) : (
                        <code className="default-code">{column.defaultValue}</code>
                      )}
                    </td>
                    <td>
                      {column.key ? <span className="soft-badge accent">{column.key}</span> : <span className="muted">—</span>}
                    </td>
                    <td>
                      {column.extra ? <span className="soft-badge">{column.extra}</span> : <span className="muted">—</span>}
                    </td>
                    <td className="comment-cell" title={column.comment}>
                      {column.comment || <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === 'indexes' ? (
          meta.indexes.length === 0 ? (
            <EmptyState compact icon={<Table2 size={22} />} title="没有索引" description="当前表尚未定义索引。" />
          ) : (
            <div className="grid-scroll">
              <table className="data-grid structure-table">
                <thead>
                  <tr>
                    <th>索引名称</th>
                    <th>列</th>
                    <th>类型</th>
                    <th>唯一</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.indexes.map((index) => (
                    <tr key={index.name}>
                      <td>
                        <span className="column-name">
                          <KeyRound size={12} className={index.primary ? 'pk-icon' : 'muted-icon'} />
                          {index.name}
                        </span>
                      </td>
                      <td>
                        <div className="chip-row">
                          {index.columns.map((column, columnIndex) => (
                            <span className="column-chip" key={`${column}-${columnIndex}`}>
                              {column || '(表达式)'}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{index.type || 'BTREE'}</td>
                      <td>
                        {index.unique ? <span className="soft-badge accent">UNIQUE</span> : <span className="muted">否</span>}
                        {index.primary ? <span className="soft-badge strong">PRIMARY</span> : null}
                      </td>
                      <td className="muted">{index.comment || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === 'foreignKeys' ? (
          meta.foreignKeys.length === 0 ? (
            <EmptyState compact icon={<Link2 size={22} />} title="没有外键" description="当前表尚未定义外键关系。" />
          ) : (
            <div className="grid-scroll">
              <table className="data-grid structure-table">
                <thead>
                  <tr>
                    <th>外键名称</th>
                    <th>本表列</th>
                    <th>引用表</th>
                    <th>引用列</th>
                    <th>删除规则</th>
                    <th>更新规则</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.foreignKeys.map((foreignKey) => (
                    <tr key={foreignKey.name}>
                      <td className="column-name">{foreignKey.name}</td>
                      <td>
                        <div className="chip-row">
                          {foreignKey.columns.map((column) => (
                            <span className="column-chip" key={column}>{column}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {foreignKey.refSchema ? `${foreignKey.refSchema}.` : ''}
                        {foreignKey.refTable}
                      </td>
                      <td>
                        <div className="chip-row">
                          {foreignKey.refColumns.map((column) => (
                            <span className="column-chip" key={column}>{column}</span>
                          ))}
                        </div>
                      </td>
                      <td>{foreignKey.onDelete || 'NO ACTION'}</td>
                      <td>{foreignKey.onUpdate || 'NO ACTION'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === 'ddl' ? (
          <div className="ddl-panel">
            <div className="ddl-toolbar">
              <span>
                <Info size={13} /> 由数据库元数据生成的建表语句
              </span>
              <div className="toolbar-spacer" />
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void copyDdl()}>
                <Copy size={13} /> 复制
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() =>
                  downloadText(meta.ddl, `${safeFileName(meta.name)}.sql`, 'text/plain;charset=utf-8')
                }
              >
                <Download size={13} /> 下载 .sql
              </button>
            </div>
            <pre className="ddl-code">{meta.ddl || '-- 暂无 DDL 信息'}</pre>
          </div>
        ) : null}

        {loading ? (
          <div className="structure-loading">
            <RefreshCw size={14} className="spin" /> 正在刷新结构…
          </div>
        ) : null}
      </div>
    </div>
  );
}
