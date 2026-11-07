import { useEffect, useMemo, useState } from 'react';
import { Braces, Check, Copy, X } from 'lucide-react';
import type { CellValue, ColumnInfo } from '../types';
import { isJsonColumn, isLongTextColumn } from '../lib/grid';
import { Modal } from './ui';

export function LargeTextModal({
  open,
  column,
  value,
  title,
  onClose,
  onCommit,
  onCopy,
}: {
  open: boolean;
  column: ColumnInfo | null;
  value: CellValue;
  title: string;
  onClose: () => void;
  onCommit: (value: CellValue) => void;
  onCopy: (text: string, message: string) => void;
}) {
  const [text, setText] = useState('');
  const [asNull, setAsNull] = useState(false);
  const json = useMemo(() => (column ? isJsonColumn(column) : false), [column]);

  useEffect(() => {
    if (!open) return;
    setText(value === null ? '' : String(value));
    setAsNull(value === null);
  }, [open, value]);

  if (!column) return null;

  const formatJson = () => {
    try {
      const parsed = JSON.parse(text);
      setText(JSON.stringify(parsed, null, 2));
    } catch {
      onCopy(text, '当前内容不是合法 JSON');
    }
  };

  const apply = () => {
    onCommit(asNull ? null : text);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={`${column.name} · ${column.columnType || column.dataType}${isLongTextColumn(column) ? ' · 大文本' : ''}`}
      width={760}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => onCopy(asNull ? 'NULL' : text, '已复制内容')}>
            <Copy size={13} /> 复制
          </button>
          {json && !asNull ? (
            <button type="button" className="btn btn-ghost" onClick={formatJson}>
              <Braces size={13} /> 格式化 JSON
            </button>
          ) : null}
          <div className="modal-footer-spacer" />
          {column.nullable ? (
            <button
              type="button"
              className={`btn ${asNull ? 'btn-active' : ''}`}
              onClick={() => setAsNull((current) => !current)}
              title="将单元格设为 NULL"
            >
              {asNull ? <Check size={13} /> : <X size={13} />} NULL
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={apply}>
            应用
          </button>
        </>
      }
    >
      <div className="large-text-meta">
        <span>{asNull ? '将写入 NULL' : `${text.length} 个字符`}</span>
        <span>Ctrl + Enter 应用</span>
      </div>
      <textarea
        className="large-text-editor"
        value={asNull ? '' : text}
        autoFocus
        spellCheck={false}
        disabled={asNull}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
        }}
      />
    </Modal>
  );
}
