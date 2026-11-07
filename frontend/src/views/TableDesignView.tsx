import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Info,
  KeyRound,
  Link2,
  ListPlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
} from 'lucide-react';
import { api } from '../lib/api';
import { classNames, DRIVER_TYPE_PRESETS, driverHasSchemas, driverSupportsIndexes } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { ColumnInfo, Connection, ForeignKeyInput, NewColumn, ObjectInfo, TableMeta } from '../types';
import { Modal, Spinner, Switch } from '../components/ui';

const FK_ACTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT', 'SET DEFAULT'];

function isAutoColumn(column: ColumnInfo): boolean {
  const extra = (column.extra ?? '').toLowerCase();
  return extra.includes('auto_increment') || extra.includes('identity');
}

export function TableDesignView({
  connection,
  meta,
  onChanged,
  onRenamed,
}: {
  connection: Connection;
  meta: TableMeta;
  onChanged: () => Promise<void>;
  onRenamed: (newName: string) => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [addIndexOpen, setAddIndexOpen] = useState(false);
  const [addForeignKeyOpen, setAddForeignKeyOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnInfo | null>(null);
  const [tableName, setTableName] = useState(meta.name);
  const [tableComment, setTableComment] = useState(meta.comment ?? '');
  const [savingComment, setSavingComment] = useState(false);

  const supportsComment = connection.driver !== 'sqlite';
  const supportsForeignKeys = connection.driver !== 'sqlite';

  useEffect(() => {
    setTableName(meta.name);
    setTableComment(meta.comment ?? '');
  }, [meta.name, meta.comment]);

  const dropColumn = (name: string) => {
    requestConfirm({
      title: '删除列',
      message: `确定删除列「${name}」吗？列中的数据将被永久删除，且操作不可撤销。`,
      confirmText: '删除列',
      danger: true,
      onConfirm: async () => {
        await api.alterTable(connection.id, {
          database: meta.database,
          schema: meta.schema,
          table: meta.name,
          action: 'drop_column',
          name,
        });
        toast('success', `列 ${name} 已删除`);
        await onChanged();
      },
    });
  };

  const dropIndex = (name: string) => {
    requestConfirm({
      title: '删除索引',
      message: `确定删除索引「${name}」吗？删除后相关查询可能变慢。`,
      confirmText: '删除索引',
      danger: true,
      onConfirm: async () => {
        await api.alterTable(connection.id, {
          database: meta.database,
          schema: meta.schema,
          table: meta.name,
          action: 'drop_index',
          name,
        });
        toast('success', `索引 ${name} 已删除`);
        await onChanged();
      },
    });
  };

  const dropForeignKey = (name: string) => {
    requestConfirm({
      title: '删除外键',
      message: `确定删除外键「${name}」吗？删除后数据库将不再校验这组引用关系。`,
      confirmText: '删除外键',
      danger: true,
      onConfirm: async () => {
        await api.alterTable(connection.id, {
          database: meta.database,
          schema: meta.schema,
          table: meta.name,
          action: 'drop_foreign_key',
          name,
        });
        toast('success', `外键 ${name} 已删除`);
        await onChanged();
      },
    });
  };

  const renameTable = () => {
    const next = tableName.trim();
    if (!next) {
      toast('warning', '请填写新表名');
      return;
    }
    if (next === meta.name) {
      toast('info', '表名没有变化');
      return;
    }
    requestConfirm({
      title: '重命名表',
      message: `确定把表「${meta.name}」重命名为「${next}」吗？已打开的相关标签页会切换到新表名。`,
      confirmText: '重命名',
      onConfirm: async () => {
        const result = await api.alterTable(connection.id, {
          database: meta.database,
          schema: meta.schema,
          table: meta.name,
          action: 'rename_table',
          newName: next,
        });
        toast('success', '表已重命名', result.ddl);
        onRenamed(next);
      },
    });
  };

  const saveComment = async () => {
    setSavingComment(true);
    try {
      const result = await api.alterTable(connection.id, {
        database: meta.database,
        schema: meta.schema,
        table: meta.name,
        action: 'set_table_comment',
        comment: tableComment.trim(),
      });
      toast('success', '表注释已保存', result.ddl);
      await onChanged();
    } catch (error) {
      toast('error', '保存表注释失败', error instanceof Error ? error.message : String(error));
    } finally {
      setSavingComment(false);
    }
  };

  return (
    <div className="design-view">
      <div className="design-banner">
        <span className="design-banner-icon">
          <Wrench size={16} />
        </span>
        <div>
          <strong>表结构设计器</strong>
          <p>
            支持编辑列、重命名表、表注释、索引与外键。所有变更会立即在数据库执行；SQLite
            仅支持添加/删除/重命名列与索引，其余能力需通过查询窗口重建表。
          </p>
        </div>
        <AlertTriangle size={16} className="design-warning-icon" />
      </div>

      <div className="design-section">
        <div className="design-section-head">
          <div>
            <h3>表设置</h3>
            <p>重命名表与维护表注释</p>
          </div>
        </div>
        <div className="design-settings">
          <label className="field">
            <span>表名</span>
            <div className="inline-action-row">
              <input
                className="input"
                value={tableName}
                onChange={(event) => setTableName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') renameTable();
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={renameTable}
                disabled={savingComment || tableName.trim() === meta.name || !tableName.trim()}
              >
                重命名
              </button>
            </div>
          </label>
          <label className="field">
            <span>表注释</span>
            <div className="inline-action-row">
              <input
                className="input"
                value={tableComment}
                onChange={(event) => setTableComment(event.target.value)}
                placeholder={supportsComment ? '可选' : 'SQLite 不支持表注释'}
                disabled={!supportsComment}
              />
              <button
                type="button"
                className="btn"
                onClick={() => void saveComment()}
                disabled={!supportsComment || savingComment || tableComment.trim() === (meta.comment ?? '')}
              >
                {savingComment ? <Spinner /> : null}
                保存注释
              </button>
            </div>
            <small className="field-hint">
              {supportsComment ? 'MySQL / MariaDB / PostgreSQL / SQL Server / Oracle 支持表注释。' : 'SQLite 没有表注释，可改用列注释或外部文档。'}
            </small>
          </label>
        </div>
      </div>

      <div className="design-section">
        <div className="design-section-head">
          <div>
            <h3>列定义</h3>
            <p>{meta.columns.length} 个列 · 主键 {meta.primaryKey.length ? meta.primaryKey.join(', ') : '未设置'}</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setAddColumnOpen(true)}>
            <Plus size={14} /> 添加列
          </button>
        </div>
        <div className="grid-scroll">
          <table className="data-grid design-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>可空</th>
                <th>默认值</th>
                <th>键 / 额外</th>
                <th>注释</th>
                <th className="action-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {meta.columns.map((column) => {
                const isPrimary = meta.primaryKey.includes(column.name);
                const canDrop = !isPrimary && meta.columns.length > 1;
                return (
                  <tr key={column.name}>
                    <td>
                      <span className="column-name">
                        {isPrimary ? <KeyRound size={12} className="pk-icon" /> : null}
                        {column.name}
                      </span>
                    </td>
                    <td><code className="type-code">{column.columnType || column.dataType}</code></td>
                    <td>{column.nullable ? 'YES' : 'NO'}</td>
                    <td>
                      {column.defaultValue === null ? <span className="muted">—</span> : <code className="default-code">{column.defaultValue}</code>}
                    </td>
                    <td>
                      <div className="chip-row">
                        {column.key ? <span className="soft-badge accent">{column.key}</span> : null}
                        {column.extra ? <span className="soft-badge">{column.extra}</span> : null}
                        {!column.key && !column.extra ? <span className="muted">—</span> : null}
                      </div>
                    </td>
                    <td className="comment-cell">{column.comment || <span className="muted">—</span>}</td>
                    <td className="action-column">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setEditingColumn(column)}
                          title="编辑列"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger-hover"
                          onClick={() => dropColumn(column.name)}
                          disabled={!canDrop}
                          title={isPrimary ? '不能删除主键列' : meta.columns.length === 1 ? '至少需要保留一列' : '删除列'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {driverSupportsIndexes(connection.driver) ? (
      <div className="design-section">
        <div className="design-section-head">
          <div>
            <h3>索引</h3>
            <p>{meta.indexes.length} 个索引</p>
          </div>
          <button type="button" className="btn" onClick={() => setAddIndexOpen(true)}>
            <ListPlus size={14} /> 新建索引
          </button>
        </div>
        {meta.indexes.length === 0 ? (
          <div className="design-empty">
            <Info size={15} /> 当前表没有索引。建议为常用查询条件创建索引。
          </div>
        ) : (
          <div className="grid-scroll">
            <table className="data-grid design-table">
              <thead>
                <tr>
                  <th>索引名称</th>
                  <th>列</th>
                  <th>唯一</th>
                  <th>说明</th>
                  <th className="action-column">操作</th>
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
                          <span className="column-chip" key={`${column}-${columnIndex}`}>{column || '(表达式)'}</span>
                        ))}
                      </div>
                    </td>
                    <td>{index.unique ? '是' : '否'}</td>
                    <td className="muted">{index.primary ? '主键索引' : index.comment || '—'}</td>
                    <td className="action-column">
                      <button
                        type="button"
                        className="icon-btn danger-hover"
                        onClick={() => dropIndex(index.name)}
                        disabled={index.primary || index.name.toLowerCase().startsWith('sqlite_autoindex')}
                        title={
                          index.primary
                            ? '主键索引不能删除'
                            : index.name.toLowerCase().startsWith('sqlite_autoindex')
                              ? 'SQLite 自动索引由约束管理'
                              : '删除索引'
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      ) : (
        <div className="design-section">
          <div className="design-section-head">
            <div>
              <h3>索引</h3>
              <p>Snowflake 不提供传统索引</p>
            </div>
          </div>
          <div className="design-empty">
            <Info size={15} /> Snowflake 使用微分区与聚簇，不需要传统索引；主键/唯一约束可在结构视图查看。
          </div>
        </div>
      )}

      <div className="design-section">
        <div className="design-section-head">
          <div>
            <h3>外键</h3>
            <p>{meta.foreignKeys.length} 个引用关系</p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => setAddForeignKeyOpen(true)}
            disabled={!supportsForeignKeys}
            title={supportsForeignKeys ? '添加外键' : 'SQLite 需要通过重建表添加外键'}
          >
            <Link2 size={14} /> 添加外键
          </button>
        </div>
        {meta.foreignKeys.length === 0 ? (
          <div className="design-empty">
            <Info size={15} /> 当前表没有外键。
            {supportsForeignKeys ? null : ' SQLite 暂不支持在此添加外键。'}
          </div>
        ) : (
          <div className="grid-scroll">
            <table className="data-grid design-table">
              <thead>
                <tr>
                  <th>外键名称</th>
                  <th>本表列</th>
                  <th>引用</th>
                  <th>删除 / 更新规则</th>
                  <th className="action-column">操作</th>
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
                      <span className="fk-ref">
                        {foreignKey.refSchema ? `${foreignKey.refSchema}.` : ''}
                        {foreignKey.refTable}
                      </span>
                      <small className="fk-ref-columns">({foreignKey.refColumns.join(', ')})</small>
                    </td>
                    <td>
                      <div className="chip-row">
                        <span className="soft-badge">DEL {foreignKey.onDelete || 'NO ACTION'}</span>
                        <span className="soft-badge">UPD {foreignKey.onUpdate || 'NO ACTION'}</span>
                      </div>
                    </td>
                    <td className="action-column">
                      <button
                        type="button"
                        className="icon-btn danger-hover"
                        onClick={() => dropForeignKey(foreignKey.name)}
                        disabled={!supportsForeignKeys}
                        title={supportsForeignKeys ? '删除外键' : 'SQLite 需要通过重建表删除外键'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="design-footnote">
        <RefreshCw size={13} />
        所有操作会立即生效；执行后结构视图会自动刷新。
      </div>

      <AddColumnModal
        open={addColumnOpen}
        connection={connection}
        meta={meta}
        onClose={() => setAddColumnOpen(false)}
        onCreated={async () => {
          await onChanged();
          setAddColumnOpen(false);
        }}
      />

      <AddIndexModal
        open={addIndexOpen}
        connection={connection}
        meta={meta}
        onClose={() => setAddIndexOpen(false)}
        onCreated={async () => {
          await onChanged();
          setAddIndexOpen(false);
        }}
      />

      <EditColumnModal
        open={Boolean(editingColumn)}
        connection={connection}
        meta={meta}
        column={editingColumn}
        onClose={() => setEditingColumn(null)}
        onSaved={async () => {
          setEditingColumn(null);
          await onChanged();
        }}
      />

      <AddForeignKeyModal
        open={addForeignKeyOpen}
        connection={connection}
        meta={meta}
        onClose={() => setAddForeignKeyOpen(false)}
        onCreated={async () => {
          setAddForeignKeyOpen(false);
          await onChanged();
        }}
      />
    </div>
  );
}

function AddColumnModal({
  open,
  connection,
  meta,
  onClose,
  onCreated,
}: {
  open: boolean;
  connection: Connection;
  meta: TableMeta;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useAppStore((state) => state.toast);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [nullable, setNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presets = DRIVER_TYPE_PRESETS[connection.driver];

  const reset = () => {
    setName('');
    setType('');
    setNullable(true);
    setDefaultValue('');
    setComment('');
    setError(null);
    setSaving(false);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('请填写列名');
      return;
    }
    if (!type.trim()) {
      setError('请填写数据类型');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const column: NewColumn = {
        name: name.trim(),
        type: type.trim(),
        nullable,
        defaultValue: defaultValue.trim() === '' ? null : defaultValue.trim(),
        primaryKey: false,
        autoIncrement: false,
        comment: comment.trim(),
      };
      await api.alterTable(connection.id, {
        database: meta.database,
        schema: meta.schema,
        table: meta.name,
        action: 'add_column',
        column,
      });
      toast('success', `列 ${column.name} 已添加`);
      await onCreated();
      reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) {
          reset();
          onClose();
        }
      }}
      title="添加列"
      subtitle={`${meta.name} · 数据库会立即执行 ALTER TABLE`}
      width={520}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={() => { reset(); onClose(); }} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner /> : <Plus size={14} />}
            添加列
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>列名</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 phone" autoFocus />
        </label>
        <label className="field">
          <span>数据类型</span>
          <input
            className="input"
            list="column-type-presets"
            value={type}
            onChange={(event) => setType(event.target.value)}
            placeholder="VARCHAR(255)"
          />
          <datalist id="column-type-presets">
            {presets.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
        </label>
        <label className="field field-span-2">
          <span>默认值（原始 SQL 表达式，可留空）</span>
          <input
            className="input"
            value={defaultValue}
            onChange={(event) => setDefaultValue(event.target.value)}
            placeholder="例如 CURRENT_TIMESTAMP、0 或 'abc'"
          />
        </label>
        <label className="field field-span-2">
          <span>注释</span>
          <input className="input" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="可选" />
        </label>
        <div className="field field-span-2 options-row">
          <div>
            <span className="options-title">允许 NULL</span>
            <small className="field-hint">关闭后新增列会带 NOT NULL 约束，已有数据行需要能提供默认值。</small>
          </div>
          <Switch checked={nullable} onChange={setNullable} />
        </div>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}

function EditColumnModal({
  open,
  connection,
  meta,
  column,
  onClose,
  onSaved,
}: {
  open: boolean;
  connection: Connection;
  meta: TableMeta;
  column: ColumnInfo | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useAppStore((state) => state.toast);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [nullable, setNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSqlite = connection.driver === 'sqlite';
  const isPrimary = Boolean(column && meta.primaryKey.includes(column.name));
  const isGenerated = Boolean(column?.generated);
  const isAuto = Boolean(column && isAutoColumn(column));

  useEffect(() => {
    if (!open || !column) return;
    setName(column.name);
    setType(column.columnType || column.dataType);
    setNullable(column.nullable);
    setDefaultValue(column.defaultValue ?? '');
    setComment(column.comment ?? '');
    setSaving(false);
    setError(null);
  }, [open, column]);

  if (!column) return null;

  const submit = async () => {
    const nextName = name.trim();
    if (!nextName) {
      setError('请填写列名');
      return;
    }
    if (!isSqlite && !type.trim()) {
      setError('请填写数据类型');
      return;
    }
    if (isSqlite) {
      if (nextName === column.name) {
        setError('SQLite 仅支持重命名列；修改类型、默认值或注释请重建表。');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const result = await api.alterTable(connection.id, {
          database: meta.database,
          schema: meta.schema,
          table: meta.name,
          action: 'rename_column',
          name: column.name,
          column: {
            name: nextName,
            type: column.columnType || column.dataType,
            nullable: column.nullable,
            defaultValue: column.defaultValue,
            primaryKey: isPrimary,
            autoIncrement: isAuto,
            comment: column.comment ?? '',
          },
        });
        toast('success', `列已重命名为 ${nextName}`, result.ddl);
        await onSaved();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : String(submitError));
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.alterTable(connection.id, {
        database: meta.database,
        schema: meta.schema,
        table: meta.name,
        action: 'modify_column',
        name: column.name,
        column: {
          name: nextName,
          type: type.trim(),
          nullable,
          defaultValue: defaultValue.trim() === '' ? null : defaultValue.trim(),
          primaryKey: isPrimary,
          autoIncrement: isAuto,
          comment: comment.trim(),
        },
      });
      toast('success', '列定义已更新', result.ddl);
      await onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  };

  const disabled = isSqlite || isGenerated;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title="编辑列"
      subtitle={`${meta.name} · ${isSqlite ? 'SQLite 仅支持重命名列' : '修改会立即执行 ALTER TABLE'}`}
      width={560}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving || isGenerated}>
            {saving ? <Spinner /> : <Pencil size={14} />}
            保存修改
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>列名</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>数据类型</span>
          <input
            className="input"
            list="edit-column-type-presets"
            value={type}
            onChange={(event) => setType(event.target.value)}
            disabled={disabled}
            placeholder="VARCHAR(255)"
          />
          <datalist id="edit-column-type-presets">
            {DRIVER_TYPE_PRESETS[connection.driver].map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
        </label>
        <label className="field field-span-2">
          <span>默认值（原始 SQL 表达式，留空表示移除默认值）</span>
          <input
            className="input"
            value={defaultValue}
            onChange={(event) => setDefaultValue(event.target.value)}
            disabled={disabled}
            placeholder="例如 CURRENT_TIMESTAMP、0 或 'abc'"
          />
        </label>
        <label className="field field-span-2">
          <span>注释</span>
          <input
            className="input"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={disabled}
            placeholder="可选"
          />
        </label>
        <div className="field field-span-2 options-row">
          <div>
            <span className="options-title">允许 NULL</span>
            <small className="field-hint">
              {isPrimary ? '主键列不能为 NULL。' : '关闭后列会带 NOT NULL 约束，已有空值会导致修改失败。'}
            </small>
          </div>
          <Switch checked={nullable} onChange={setNullable} disabled={disabled || isPrimary} />
        </div>
        <div className="field field-span-2 options-row">
          <div>
            <span className="options-title">键与自增</span>
            <small className="field-hint">
              {isGenerated
                ? '生成列由数据库表达式计算，当前不支持在此修改。'
                : isAuto
                  ? '自增 / identity 属性会自动保留；如需变更请使用 SQL。'
                  : '主键与自增属性暂不支持在编辑列中调整。'}
            </small>
          </div>
          <div className="chip-row">
            {isPrimary ? <span className="soft-badge strong">PRIMARY</span> : null}
            {isAuto ? <span className="soft-badge accent">AUTO</span> : null}
            {!isPrimary && !isAuto ? <span className="muted">—</span> : null}
          </div>
        </div>
      </div>
      {isSqlite ? (
        <div className="design-empty">
          <Info size={15} /> SQLite 不支持 ALTER COLUMN；这里只能修改列名，其他字段请通过“表结构重建”方式处理。
        </div>
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}

function AddForeignKeyModal({
  open,
  connection,
  meta,
  onClose,
  onCreated,
}: {
  open: boolean;
  connection: Connection;
  meta: TableMeta;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useAppStore((state) => state.toast);
  const [name, setName] = useState('');
  const [refSchema, setRefSchema] = useState(driverHasSchemas(connection.driver) ? meta.schema : meta.database);
  const [tables, setTables] = useState<ObjectInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [refTable, setRefTable] = useState('');
  const [refColumns, setRefColumns] = useState<ColumnInfo[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [localSelected, setLocalSelected] = useState<string[]>([]);
  const [refSelected, setRefSelected] = useState<string[]>([]);
  const [onDelete, setOnDelete] = useState('NO ACTION');
  const [onUpdate, setOnUpdate] = useState('NO ACTION');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schemaForObjects = driverHasSchemas(connection.driver) ? refSchema : meta.schema;

  useEffect(() => {
    if (!open) return;
    setName('');
    setRefSchema(driverHasSchemas(connection.driver) ? meta.schema : meta.database);
    setRefTable('');
    setRefColumns([]);
    setLocalSelected([]);
    setRefSelected([]);
    setOnDelete('NO ACTION');
    setOnUpdate('NO ACTION');
    setError(null);
    setSaving(false);
  }, [open, connection.driver, meta.database, meta.schema]);

  useEffect(() => {
    if (!open || !schemaForObjects) return;
    let cancelled = false;
    setTablesLoading(true);
    api
      .objects(connection.id, meta.database, schemaForObjects)
      .then(({ objects: items }) => {
        if (cancelled) return;
        setTables(items.filter((item) => item.type === 'table'));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setTablesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connection.id, meta.database, schemaForObjects]);

  useEffect(() => {
    if (!open || !refTable) {
      setRefColumns([]);
      return;
    }
    let cancelled = false;
    setRefLoading(true);
    api
      .table(connection.id, { database: meta.database, schema: schemaForObjects, table: refTable })
      .then((data) => {
        if (cancelled) return;
        setRefColumns((data.columns ?? []).filter((column) => !column.generated));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setRefLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connection.id, meta.database, schemaForObjects, refTable]);

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const submit = async () => {
    if (!refTable) {
      setError('请选择引用的表');
      return;
    }
    if (localSelected.length === 0) {
      setError('请选择本表列');
      return;
    }
    if (localSelected.length !== refSelected.length) {
      setError('本表列与引用列的数量必须一致');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const foreignKey: ForeignKeyInput = {
        name: name.trim(),
        columns: localSelected,
        refSchema: driverHasSchemas(connection.driver) ? refSchema.trim() : undefined,
        refTable,
        refColumns: refSelected,
        onDelete,
        onUpdate: connection.driver === 'oracle' || connection.driver === 'snowflake' ? 'NO ACTION' : onUpdate,
      };
      const result = await api.alterTable(connection.id, {
        database: meta.database,
        schema: meta.schema,
        table: meta.name,
        action: 'add_foreign_key',
        foreignKey,
      });
      toast('success', '外键已创建', result.ddl);
      await onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
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
      title="添加外键"
      subtitle={`${meta.name} · 建立引用关系`}
      width={760}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving || refLoading}>
            {saving ? <Spinner /> : <Link2 size={14} />}
            创建外键
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>外键名称（可留空自动生成）</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={`fk_${meta.name}_...`} autoFocus />
        </label>
        {driverHasSchemas(connection.driver) ? (
          <label className="field">
            <span>引用 Schema</span>
            <input
              className="input"
              value={refSchema}
              onChange={(event) => {
                setRefSchema(event.target.value);
                setRefTable('');
                setRefSelected([]);
              }}
              placeholder="public / dbo / 用户名"
            />
          </label>
        ) : (
          <label className="field">
            <span>引用数据库</span>
            <input className="input" value={meta.database} disabled />
          </label>
        )}
        <label className="field field-span-2">
          <span>引用表</span>
          <select
            className="select"
            value={refTable}
            onChange={(event) => {
              setRefTable(event.target.value);
              setRefSelected([]);
            }}
            disabled={tablesLoading}
          >
            <option value="">{tablesLoading ? '正在加载表…' : '选择引用的表'}</option>
            {tables.map((table) => (
              <option key={table.name} value={table.name}>
                {table.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field field-span-2">
          <span>本表列（按点击顺序组成联合外键）</span>
          <div className="column-picker">
            {meta.columns.map((column) => {
              const index = localSelected.indexOf(column.name);
              return (
                <button
                  type="button"
                  key={column.name}
                  className={classNames('column-pick', index >= 0 && 'active')}
                  onClick={() => setLocalSelected((current) => toggle(current, column.name))}
                >
                  {index >= 0 ? <span className="pick-order">{index + 1}</span> : null}
                  {column.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field field-span-2">
          <span>引用列（顺序需与本表列一致）</span>
          {refLoading ? (
            <div className="design-empty"><Spinner /> 正在读取引用表结构…</div>
          ) : refTable && refColumns.length === 0 ? (
            <div className="design-empty"><Info size={15} /> 引用表没有可用的列。</div>
          ) : refColumns.length === 0 ? (
            <div className="design-empty"><Info size={15} /> 先选择引用表。</div>
          ) : (
            <div className="column-picker">
              {refColumns.map((column) => {
                const index = refSelected.indexOf(column.name);
                return (
                  <button
                    type="button"
                    key={column.name}
                    className={classNames('column-pick', index >= 0 && 'active')}
                    onClick={() => setRefSelected((current) => toggle(current, column.name))}
                  >
                    {index >= 0 ? <span className="pick-order">{index + 1}</span> : null}
                    {column.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <label className="field">
          <span>删除时</span>
          <select className="select" value={onDelete} onChange={(event) => setOnDelete(event.target.value)}>
            {FK_ACTIONS.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{connection.driver === 'oracle' || connection.driver === 'snowflake' ? '更新时（该引擎不支持 ON UPDATE）' : '更新时'}</span>
          <select
            className="select"
            value={connection.driver === 'oracle' || connection.driver === 'snowflake' ? 'NO ACTION' : onUpdate}
            onChange={(event) => setOnUpdate(event.target.value)}
            disabled={connection.driver === 'oracle' || connection.driver === 'snowflake'}
          >
            {FK_ACTIONS.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}

function AddIndexModal({
  open,
  connection,
  meta,
  onClose,
  onCreated,
}: {
  open: boolean;
  connection: Connection;
  meta: TableMeta;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useAppStore((state) => state.toast);
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedName = useMemo(() => {
    if (selected.length === 0) return '';
    return `idx_${meta.name}_${selected.join('_')}`.slice(0, 60);
  }, [meta.name, selected]);

  const toggleColumn = (column: string) => {
    setSelected((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column],
    );
  };

  const close = () => {
    if (saving) return;
    setName('');
    setUnique(false);
    setSelected([]);
    setError(null);
    onClose();
  };

  const submit = async () => {
    const indexName = (name || suggestedName).trim();
    if (!indexName) {
      setError('请填写索引名称');
      return;
    }
    if (selected.length === 0) {
      setError('请至少选择一列');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.alterTable(connection.id, {
        database: meta.database,
        schema: meta.schema,
        table: meta.name,
        action: 'add_index',
        name: indexName,
        columns: selected,
        unique,
      });
      toast('success', `索引 ${indexName} 已创建`);
      await onCreated();
      setName('');
      setUnique(false);
      setSelected([]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="新建索引"
      subtitle={`${meta.name} · 为查询条件加速`}
      width={520}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={close} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner /> : <ListPlus size={14} />}
            创建索引
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field field-span-2">
          <span>索引名称</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={suggestedName || 'idx_table_column'}
            autoFocus
          />
        </label>
        <div className="field field-span-2">
          <span>选择列（按点击顺序组成联合索引）</span>
          <div className="column-picker">
            {meta.columns.map((column) => {
              const index = selected.indexOf(column.name);
              return (
                <button
                  type="button"
                  key={column.name}
                  className={classNames('column-pick', index >= 0 && 'active')}
                  onClick={() => toggleColumn(column.name)}
                >
                  {index >= 0 ? <span className="pick-order">{index + 1}</span> : null}
                  {column.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field field-span-2 options-row">
          <div>
            <span className="options-title">唯一索引</span>
            <small className="field-hint">确保索引列组合的值不重复。</small>
          </div>
          <Switch checked={unique} onChange={setUnique} />
        </div>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}
