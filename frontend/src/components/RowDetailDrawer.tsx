import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Eye, FileJson, KeyRound, Save, Undo2, X } from 'lucide-react';
import type { CellValue, ColumnInfo, Driver } from '../types';
import {
  blobInfo,
  booleanValue,
  coerceInputValue,
  dateInputKind,
  dateInputToCell,
  dateInputValue,
  enumOptions,
  formatByteSize,
  isBinaryColumn,
  isBooleanColumn,
  isLargeCellValue,
  isLongTextColumn,
  isSetColumn,
} from '../lib/grid';
import { classNames } from '../lib/utils';
import { Spinner } from './ui';

interface RowDetailDrawerProps {
  open: boolean;
  driver: Driver;
  columns: ColumnInfo[];
  primaryKey: string[];
  title: string;
  subtitle?: string;
  values: Record<string, CellValue>;
  original: Record<string, CellValue> | null;
  changedColumns: Set<string>;
  deleted?: boolean;
  dirtyCount: number;
  saving?: boolean;
  onClose: () => void;
  onChange: (name: string, value: CellValue) => void;
  onSave: () => void;
  onCopyJson: () => void;
  onCopyInsert: () => void;
  onOpenBlob: (column: ColumnInfo) => void;
  onOpenLarge: (column: ColumnInfo) => void;
  onToggleDelete?: () => void;
}

export function RowDetailDrawer({
  open,
  driver,
  columns,
  primaryKey,
  title,
  subtitle,
  values,
  original,
  changedColumns,
  deleted = false,
  dirtyCount,
  saving = false,
  onClose,
  onChange,
  onSave,
  onCopyJson,
  onCopyInsert,
  onOpenBlob,
  onOpenLarge,
  onToggleDelete,
}: RowDetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (document.querySelector('.modal-overlay')) return;
      if (event.key === 'Escape') onClose();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirtyCount > 0 && !saving) onSave();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, onSave, dirtyCount, saving]);

  if (!open) return null;

  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="row-drawer" role="dialog" aria-modal="true">
        <header className="row-drawer-head">
          <div>
            <strong>{title}</strong>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="row-drawer-body">
          {deleted ? (
            <div className="drawer-deleted-note">
              该行已标记为待删除，保存后才会真正删除。
              {onToggleDelete ? (
                <button type="button" className="btn btn-small" onClick={onToggleDelete}>
                  <Undo2 size={13} /> 取消删除
                </button>
              ) : null}
            </div>
          ) : null}

          {columns.map((column) => (
            <DetailField
              key={column.name}
              driver={driver}
              column={column}
              value={values[column.name] ?? null}
              original={original ? original[column.name] ?? null : undefined}
              changed={changedColumns.has(column.name)}
              primary={primaryKey.includes(column.name)}
              disabled={
                deleted ||
                saving ||
                (driver === 'mongodb' && column.name === '_id')
              }
              onChange={(value) => onChange(column.name, value)}
              onOpenBlob={() => onOpenBlob(column)}
              onOpenLarge={() => onOpenLarge(column)}
            />
          ))}
        </div>

        <footer className="row-drawer-foot">
          <button type="button" className="btn btn-ghost" onClick={onCopyJson}>
            <FileJson size={13} /> JSON
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCopyInsert}>
            <Copy size={13} /> INSERT
          </button>
          <div className="toolbar-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={dirtyCount === 0 || saving}>
            {saving ? <Spinner /> : <Save size={13} />}
            保存{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function DetailField({
  driver,
  column,
  value,
  original,
  changed,
  primary,
  disabled,
  onChange,
  onOpenBlob,
  onOpenLarge,
}: {
  driver: Driver;
  column: ColumnInfo;
  value: CellValue;
  original: CellValue | undefined;
  changed: boolean;
  primary: boolean;
  disabled: boolean;
  onChange: (value: CellValue) => void;
  onOpenBlob: () => void;
  onOpenLarge: () => void;
}) {
  const binary = isBinaryColumn(column);
  const boolean = isBooleanColumn(column);
  const options = enumOptions(column);
  const enumColumn = options.length > 0 && !isSetColumn(column);
  const kind = dateInputKind(driver, column);
  const inputId = `detail-${column.name}`;
  const isNull = value === null;
  const canReset = !disabled && changed && original !== undefined;
  const enumValue = isNull ? '__navideck_null__' : value === '' ? '__navideck_empty__' : String(value);

  return (
    <div className={classNames('drawer-field', changed && 'changed', disabled && 'disabled')}>
      <div className="drawer-field-head">
        <label htmlFor={inputId}>
          {primary ? <KeyRound size={11} className="pk-icon" /> : null}
          {column.name}
        </label>
        <span className="drawer-field-type">{column.columnType || column.dataType}</span>
        {changed ? <span className="pending-badge">已修改</span> : null}
      </div>

      {binary ? (
        <div className="drawer-binary">
          <span>{isNull ? <span className="null-badge">NULL</span> : `BLOB · ${formatByteSize(blobInfo(value).size)}`}</span>
          <button type="button" className="btn btn-small" onClick={onOpenBlob} disabled={isNull}>
            <Eye size={13} /> 查看
          </button>
        </div>
      ) : boolean ? (
        <select
          id={inputId}
          className="input"
          value={isNull ? '' : booleanValue(value) ? 'true' : 'false'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}
        >
          {column.nullable ? <option value="">NULL</option> : null}
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : enumColumn ? (
        <select
          id={inputId}
          className="input"
          value={enumValue}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next === '__navideck_null__' ? null : next === '__navideck_empty__' ? '' : next);
          }}
        >
          {column.nullable ? <option value="__navideck_null__">NULL</option> : null}
          <option value="__navideck_empty__">（空字符串）</option>
          {!isNull && value !== '' && !options.includes(String(value)) ? (
            <option value={String(value)}>{String(value)}</option>
          ) : null}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : kind ? (
        <input
          id={inputId}
          className="input"
          type={kind === 'datetime' ? 'datetime-local' : kind}
          step={kind === 'date' ? undefined : 1}
          value={dateInputValue(value, kind) ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? '' : dateInputToCell(kind, event.target.value))}
        />
      ) : isLongTextColumn(column) || isLargeCellValue(value) ? (
        <div className="drawer-long-text">
          <textarea
            id={inputId}
            className="input drawer-textarea"
            value={isNull ? '' : String(value)}
            disabled={disabled}
            onChange={(event) => onChange(coerceInputValue(column, event.target.value))}
            placeholder={isNull ? 'NULL' : ''}
          />
          <button type="button" className="btn btn-small" onClick={onOpenLarge} disabled={disabled}>
            大文本编辑
          </button>
        </div>
      ) : (
        <input
          id={inputId}
          className="input"
          value={isNull ? '' : String(value)}
          placeholder={isNull ? 'NULL' : ''}
          disabled={disabled}
          onChange={(event) => onChange(coerceInputValue(column, event.target.value))}
        />
      )}

      <div className="drawer-field-foot">
        <span>
          {column.nullable ? '可空' : '必填'}
          {column.defaultValue !== null ? ` · 默认 ${column.defaultValue}` : ''}
          {original !== undefined && changed ? ` · 原值：${original === null ? 'NULL' : String(original)}` : ''}
        </span>
        <span className="drawer-field-actions">
          {canReset ? (
            <button type="button" className="link-btn" onClick={() => onChange(original ?? null)}>
              撤销
            </button>
          ) : null}
          {column.nullable && !isNull && !disabled ? (
            <button type="button" className="link-btn" onClick={() => onChange(null)}>
              设为 NULL
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
