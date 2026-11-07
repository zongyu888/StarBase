import { useEffect, useState } from 'react';
import { Database, KeyRound, Plus, Trash2, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { DRIVER_TYPE_PRESETS, driverHasSchemas } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { Connection, NewColumn } from '../types';
import { Modal, Spinner } from './ui';

interface DraftColumn extends NewColumn {
  key: string;
}

let columnCounter = 0;
function makeColumn(partial: Partial<DraftColumn> = {}): DraftColumn {
  columnCounter += 1;
  return {
    key: `col-${columnCounter}`,
    name: '',
    type: 'VARCHAR(255)',
    nullable: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: '',
    ...partial,
  };
}

function initialColumns(connection: Connection): DraftColumn[] {
  const idType =
    connection.driver === 'sqlite' ? 'INTEGER'
      : connection.driver === 'oracle' ? 'NUMBER(19)'
        : connection.driver === 'sqlserver' ? 'BIGINT'
          : connection.driver === 'postgres' ? 'BIGINT'
            : 'BIGINT';
  const nameType =
    connection.driver === 'sqlite' || connection.driver === 'postgres' ? 'TEXT'
      : connection.driver === 'oracle' ? 'VARCHAR2(255)'
        : connection.driver === 'sqlserver' ? 'NVARCHAR(255)'
          : 'VARCHAR(255)';
  return [
    makeColumn({ name: 'id', type: idType, nullable: false, primaryKey: true, autoIncrement: true }),
    makeColumn({ name: 'name', type: nameType, nullable: false }),
  ];
}

export function CreateTableDialog({
  open,
  connection,
  database,
  schema,
  onClose,
  onCreated,
}: {
  open: boolean;
  connection: Connection;
  database: string;
  schema: string;
  onClose: () => void;
  onCreated: (table: string) => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [columns, setColumns] = useState<DraftColumn[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setComment('');
    setColumns(initialColumns(connection));
    setSaving(false);
    setError(null);
  }, [open, connection]);

  const updateColumn = (key: string, patch: Partial<DraftColumn>) => {
    setColumns((items) => items.map((column) => (column.key === key ? { ...column, ...patch } : column)));
  };

  const toggleAuto = (column: DraftColumn) => {
    const next = !column.autoIncrement;
    let type = column.type;
    if (next) {
      if (connection.driver === 'sqlite') {
        type = 'INTEGER';
      } else if (connection.driver === 'oracle') {
        type = column.type.toLowerCase().startsWith('number') ? column.type : 'NUMBER(19)';
      } else if (connection.driver === 'sqlserver') {
        type = column.type.toLowerCase().includes('int') ? column.type : 'BIGINT';
      } else {
        type = column.type.toLowerCase().includes('int') ? column.type : 'BIGINT';
      }
    }
    updateColumn(column.key, {
      autoIncrement: next,
      primaryKey: next ? true : column.primaryKey,
      nullable: next ? false : column.nullable,
      type,
    });
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('请填写表名');
      return;
    }
    if (columns.length === 0) {
      setError('至少需要定义一列');
      return;
    }
    for (const column of columns) {
      if (!column.name.trim()) {
        setError('所有列都需要填写名称');
        return;
      }
      if (!column.type.trim()) {
        setError(`列 ${column.name} 缺少数据类型`);
        return;
      }
    }
    const payloadColumns: NewColumn[] = columns.map(({ key: _key, ...column }) => ({
      ...column,
      name: column.name.trim(),
      type: column.type.trim(),
      defaultValue: column.defaultValue?.trim() ? column.defaultValue.trim() : null,
      comment: column.comment.trim(),
    }));
    setSaving(true);
    setError(null);
    try {
      await api.createTable(connection.id, {
        database,
        schema,
        name: name.trim(),
        comment: comment.trim(),
        columns: payloadColumns,
      });
      toast('success', '数据表已创建', name.trim());
      onCreated(name.trim());
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
      title="新建表"
      subtitle={`${database}${driverHasSchemas(connection.driver) ? ` / ${schema}` : ''} · 使用可视化设计器创建数据表`}
      width={940}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner /> : <Plus size={14} />}
            创建表
          </button>
        </>
      }
    >
      <div className="form-grid create-table-meta">
        <label className="field">
          <span>表名</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 orders" autoFocus />
        </label>
        <label className="field">
          <span>表注释</span>
          <input className="input" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="可选" />
        </label>
      </div>

      <div className="create-columns">
        <div className="create-columns-head">
          <span>列名</span>
          <span>数据类型</span>
          <span>可空</span>
          <span>主键</span>
          <span>自增</span>
          <span>默认值</span>
          <span>注释</span>
          <span />
        </div>
        {columns.map((column, index) => (
          <div className="create-column-row" key={column.key}>
            <input
              className="input input-compact"
              value={column.name}
              onChange={(event) => updateColumn(column.key, { name: event.target.value })}
              placeholder={`column_${index + 1}`}
            />
            <input
              className="input input-compact"
              list="create-table-type-presets"
              value={column.type}
              onChange={(event) => updateColumn(column.key, { type: event.target.value })}
              placeholder="VARCHAR(255)"
            />
            <label className="mini-check">
              <input
                type="checkbox"
                checked={column.nullable}
                disabled={column.primaryKey}
                onChange={(event) => updateColumn(column.key, { nullable: event.target.checked })}
              />
              <span>NULL</span>
            </label>
            <label className="mini-check">
              <input
                type="checkbox"
                checked={column.primaryKey}
                onChange={(event) =>
                  updateColumn(column.key, {
                    primaryKey: event.target.checked,
                    nullable: event.target.checked ? false : column.nullable,
                  })
                }
              />
              <KeyRound size={12} />
            </label>
            <label className="mini-check">
              <input type="checkbox" checked={column.autoIncrement} onChange={() => toggleAuto(column)} />
              <Zap size={12} />
            </label>
            <input
              className="input input-compact"
              value={column.defaultValue ?? ''}
              onChange={(event) => updateColumn(column.key, { defaultValue: event.target.value })}
              placeholder="默认值"
            />
            <input
              className="input input-compact"
              value={column.comment}
              onChange={(event) => updateColumn(column.key, { comment: event.target.value })}
              placeholder="注释"
            />
            <button
              type="button"
              className="icon-btn danger-hover"
              onClick={() => setColumns((items) => items.filter((item) => item.key !== column.key))}
              disabled={columns.length === 1}
              title="删除列"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <datalist id="create-table-type-presets">
          {DRIVER_TYPE_PRESETS[connection.driver].map((preset) => (
            <option key={preset} value={preset} />
          ))}
        </datalist>
        <button
          type="button"
          className="btn btn-ghost add-column-btn"
          onClick={() => setColumns((items) => [...items, makeColumn()])}
        >
          <Plus size={14} /> 添加列
        </button>
      </div>

      {connection.driver === 'sqlite' ? (
        <div className="design-empty">
          SQLite 自增主键必须使用 INTEGER 类型，且只能作为单一主键。
        </div>
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}

export function NewDatabaseDialog({
  open,
  connection,
  onClose,
  onCreated,
}: {
  open: boolean;
  connection: Connection;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setSaving(false);
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      setError('请填写数据库名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createDatabase(connection.id, name.trim());
      toast('success', '数据库已创建', name.trim());
      onCreated();
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
      onClose={onClose}
      title="新建数据库"
      subtitle={connection.name}
      width={440}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner /> : <Database size={14} />}
            创建
          </button>
        </>
      }
    >
      <label className="field">
        <span>数据库名称</span>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如 analytics"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
      </label>
      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}
