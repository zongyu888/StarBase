import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertCircle, FileSpreadsheet, Info, Upload, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatNumber } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { Connection, ImportMapping, TableMeta } from '../types';
import { Modal, Spinner, Switch } from './ui';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DELIMITER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: ',', label: '逗号 ,' },
  { value: ';', label: '分号 ;' },
  { value: '\t', label: '制表符 Tab' },
  { value: '|', label: '竖线 |' },
];

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

function decodeBuffer(buffer: ArrayBuffer, encoding: string): string {
  const bytes = new Uint8Array(buffer);
  if (encoding === 'auto') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      try {
        return new TextDecoder('gbk').decode(bytes);
      } catch {
        return new TextDecoder().decode(bytes);
      }
    }
  }
  try {
    return new TextDecoder(encoding === 'gbk' ? 'gbk' : 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((item) => item.trim() !== '') ?? '';
  let best = ',';
  let bestCount = -1;
  for (const candidate of [',', ';', '\t', '|']) {
    const count = line.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function parseDelimited(text: string, delimiter: string): ParsedCsv {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const cleaned = rows.filter((line) => !(line.length === 1 && line[0].trim() === ''));
  if (cleaned.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = cleaned[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  return { headers, rows: cleaned.slice(1) };
}

export function ImportCsvDialog({
  open,
  connection,
  meta,
  onClose,
  onImported,
}: {
  open: boolean;
  connection: Connection;
  meta: TableMeta;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [text, setText] = useState('');
  const [encoding, setEncoding] = useState('auto');
  const [delimiter, setDelimiter] = useState(',');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [emptyAsNull, setEmptyAsNull] = useState(true);
  const [nullValue, setNullValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columnNames = useMemo(
    () => meta.columns.filter((column) => !column.generated).map((column) => column.name),
    [meta.columns],
  );

  const reset = () => {
    setFileName('');
    setBuffer(null);
    setText('');
    setEncoding('auto');
    setDelimiter(',');
    setParsed(null);
    setTargets([]);
    setEmptyAsNull(true);
    setNullValue('');
    setSaving(false);
    setError(null);
  };

  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyParsed = (next: ParsedCsv) => {
    if (next.headers.some((header) => header === '')) {
      setParsed(null);
      setTargets([]);
      setError('CSV 表头中存在空列名，请检查文件格式。');
      return;
    }
    const seen = new Set<string>();
    for (const header of next.headers) {
      const key = header.toLowerCase();
      if (seen.has(key)) {
        setParsed(null);
        setTargets([]);
        setError(`CSV 表头中的列「${header}」重复。`);
        return;
      }
      seen.add(key);
    }
    const used = new Set<string>();
    const nextTargets = next.headers.map((header) => {
      const match = columnNames.find((name) => name.toLowerCase() === header.toLowerCase());
      if (!match || used.has(match)) return '';
      used.add(match);
      return match;
    });
    setParsed(next);
    setTargets(nextTargets);
    setError(null);
  };

  const loadFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setError('文件超过 20 MB，请拆分后再导入。');
      return;
    }
    try {
      const data = await file.arrayBuffer();
      setFileName(file.name);
      setBuffer(data);
      const decoded = decodeBuffer(data, encoding);
      setText(decoded);
      const detected = detectDelimiter(decoded);
      setDelimiter(detected);
      applyParsed(parseDelimited(decoded, detected));
    } catch {
      setError('读取文件失败');
    }
  };

  const changeEncoding = (nextEncoding: string) => {
    setEncoding(nextEncoding);
    if (!buffer) return;
    const decoded = decodeBuffer(buffer, nextEncoding);
    setText(decoded);
    applyParsed(parseDelimited(decoded, delimiter));
  };

  const changeDelimiter = (nextDelimiter: string) => {
    setDelimiter(nextDelimiter);
    if (text) applyParsed(parseDelimited(text, nextDelimiter));
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void loadFile(file);
  };

  const updateTarget = (index: number, value: string) => {
    setTargets((current) =>
      current.map((target, targetIndex) => {
        if (targetIndex === index) return value;
        if (value && target === value) return '';
        return target;
      }),
    );
  };

  const mappedCount = targets.filter(Boolean).length;

  const submit = async () => {
    if (!parsed || !text) {
      setError('请先选择 CSV 文件');
      return;
    }
    if (parsed.headers.length === 0) {
      setError('CSV 缺少表头');
      return;
    }
    if (parsed.rows.length === 0) {
      setError('CSV 中没有数据行');
      return;
    }
    if (mappedCount === 0) {
      setError('请至少为一列选择目标列');
      return;
    }
    const mapping: ImportMapping[] = parsed.headers.map((header, index) => ({
      csvColumn: header,
      tableColumn: targets[index] ?? '',
    }));
    setSaving(true);
    setError(null);
    try {
      const result = await api.importCsv(
        connection.id,
        { database: meta.database, schema: meta.schema, table: meta.name },
        text,
        { delimiter, emptyAsNull, nullValue: nullValue.trim(), mapping },
      );
      toast('success', `已导入 ${formatNumber(result.affectedRows)} 行`, fileName);
      onImported();
      onClose();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
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
      title="导入 CSV"
      subtitle={`${meta.name} · 预览映射后再写入，失败会整体回滚`}
      width={900}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={saving || !parsed || mappedCount === 0}
          >
            {saving ? <Spinner /> : <Upload size={14} />}
            导入 {parsed && parsed.rows.length > 0 ? `${formatNumber(parsed.rows.length)} 行` : ''}
          </button>
        </>
      }
    >
      <input ref={inputRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={handleFile} />

      {!parsed ? (
        <div className="import-dropzone">
          <span className="import-dropzone-icon"><FileSpreadsheet size={30} /></span>
          <h3>选择要导入的 CSV 文件</h3>
          <p>首行作为表头，单次最大 20 MB；支持逗号、分号、Tab 和竖线分隔。</p>
          <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
            <Upload size={14} /> 选择文件
          </button>
          {fileName ? <small className="muted">{fileName}</small> : null}
        </div>
      ) : (
        <>
          <div className="import-file-row">
            <span className="import-file-icon"><FileSpreadsheet size={16} /></span>
            <div className="import-file-name">
              <strong>{fileName}</strong>
              <span>
                {formatNumber(parsed.headers.length)} 列 · {formatNumber(parsed.rows.length)} 行数据
              </span>
            </div>
            <div className="toolbar-spacer" />
            <button type="button" className="btn btn-ghost btn-small" onClick={() => inputRef.current?.click()}>
              更换文件
            </button>
            <button
              type="button"
              className="icon-btn"
              title="移除文件"
              onClick={() => {
                reset();
              }}
            >
              <X size={14} />
            </button>
          </div>

          <div className="import-settings">
            <label className="field">
              <span>文件编码</span>
              <select className="select" value={encoding} onChange={(event) => changeEncoding(event.target.value)}>
                <option value="auto">自动检测</option>
                <option value="utf-8">UTF-8</option>
                <option value="gbk">GBK / GB18030</option>
              </select>
            </label>
            <label className="field">
              <span>分隔符</span>
              <select className="select" value={delimiter} onChange={(event) => changeDelimiter(event.target.value)}>
                {DELIMITER_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>空文本视为 NULL</span>
              <div className="options-row import-switch-row">
                <Switch checked={emptyAsNull} onChange={setEmptyAsNull} />
                <small className="field-hint">关闭后空单元格会写入空字符串。</small>
              </div>
            </label>
            <label className="field">
              <span>额外 NULL 标记</span>
              <input
                className="input"
                value={nullValue}
                onChange={(event) => setNullValue(event.target.value)}
                placeholder="例如 NULL（可留空）"
              />
            </label>
          </div>

          <div className="import-mapping-head">
            <div>
              <h3>列映射</h3>
              <p>左侧为 CSV 表头，右侧选择目标列；未选择的列会被忽略。</p>
            </div>
            <span className="soft-badge accent">{mappedCount} / {parsed.headers.length} 列已映射</span>
          </div>

          <div className="grid-scroll import-mapping-scroll">
            <table className="data-grid structure-table import-mapping-table">
              <thead>
                <tr>
                  <th>CSV 列</th>
                  <th>示例值</th>
                  <th>目标列</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((header, index) => {
                  const sample = parsed.rows[0]?.[index] ?? '';
                  return (
                    <tr key={`${header}-${index}`}>
                      <td className="column-name">{header}</td>
                      <td className="muted import-sample" title={sample}>
                        {sample === '' ? <span className="null-badge">空</span> : sample}
                      </td>
                      <td>
                        <select
                          className="select select-compact"
                          value={targets[index] ?? ''}
                          onChange={(event) => updateTarget(index, event.target.value)}
                        >
                          <option value="">— 忽略此列 —</option>
                          {columnNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                              {targets.includes(name) && targets[index] !== name ? '（已被映射）' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {parsed.rows.length > 0 ? (
            <details className="import-preview">
              <summary>数据预览（前 {Math.min(5, parsed.rows.length)} 行）</summary>
              <div className="grid-scroll">
                <table className="data-grid structure-table">
                  <thead>
                    <tr>
                      <th className="row-number-cell">#</th>
                      {parsed.headers.map((header, index) => (
                        <th key={`${header}-${index}`}>{targets[index] || header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        <td className="row-number-cell">{rowIndex + 1}</td>
                        {parsed.headers.map((_, columnIndex) => {
                          const value = row[columnIndex] ?? '';
                          return (
                            <td key={columnIndex} title={value}>
                              {value === '' ? <span className="null-badge">NULL</span> : value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      )}

      {error ? (
        <div className="form-error">
          <AlertCircle size={14} /> {error}
        </div>
      ) : null}
      {!parsed ? (
        <div className="design-empty">
          <Info size={15} /> 如果文件包含自增 / identity 列的空单元格，导入时会自动使用数据库默认值。
        </div>
      ) : null}
    </Modal>
  );
}
