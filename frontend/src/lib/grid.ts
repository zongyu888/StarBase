import type { CellValue, ColumnInfo, Driver } from '../types';
import { isNumericType, qualifiedTable, quoteIdent } from './utils';

export interface GridPrefs {
  widths: Record<string, number>;
  hidden: string[];
  order: string[];
}

export type DateInputKind = 'date' | 'datetime' | 'time';

const DEFAULT_WIDTH = 148;
const MIN_WIDTH = 56;
const MAX_WIDTH = 900;

export function gridPrefsKey(connectionId: string, database: string, schema: string, table: string): string {
  return ['navideck.grid', connectionId, database, schema, table].join('.');
}

export function loadGridPrefs(key: string, columns: ColumnInfo[]): GridPrefs {
  let widths: Record<string, number> = {};
  let hidden: string[] = [];
  let order: string[] = [];
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GridPrefs>;
      if (parsed && typeof parsed === 'object') {
        widths = parsed.widths && typeof parsed.widths === 'object' ? parsed.widths : {};
        hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((name) => typeof name === 'string') : [];
        order = Array.isArray(parsed.order) ? parsed.order.filter((name) => typeof name === 'string') : [];
      }
    }
  } catch {
    // 忽略损坏的本地列偏好
  }
  const names = columns.map((column) => column.name);
  const valid = new Set(names);
  const mergedOrder = [
    ...order.filter((name) => valid.has(name)),
    ...names.filter((name) => !order.includes(name)),
  ];
  return {
    widths,
    hidden: hidden.filter((name) => valid.has(name)),
    order: mergedOrder,
  };
}

export function saveGridPrefs(key: string, prefs: GridPrefs): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // 忽略无法写入 localStorage 的场景
  }
}

export function clampColumnWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

export function defaultColumnWidth(column: ColumnInfo): number {
  const type = rawType(column);
  if (isBinaryColumn(column)) return 120;
  if (isBooleanColumn(column)) return 86;
  if (type.includes('date') || type.includes('time')) return 160;
  if (type.includes('int') || type.startsWith('number') || type.includes('serial')) return 104;
  if (isJsonColumn(column) || isLongTextColumn(column)) return 220;
  return DEFAULT_WIDTH;
}

export function rawType(column: ColumnInfo): string {
  return (column.columnType || column.dataType || '').toLowerCase();
}

export function isBooleanColumn(column: ColumnInfo): boolean {
  const type = rawType(column);
  return (
    type === 'boolean' ||
    type === 'bool' ||
    type === 'bit' ||
    /^bit\s*\(\s*1\s*\)/.test(type) ||
    /^tinyint\s*\(\s*1\s*\)/.test(type) ||
    type === 'tinyint(1) unsigned'
  );
}

export function isBinaryColumn(column: ColumnInfo): boolean {
  const type = rawType(column);
  return /(^|\W)(blob|tinyblob|mediumblob|longblob|binary|varbinary|bytea|image|raw|geography|geometry)(\W|$|\()/.test(type);
}

export function isJsonColumn(column: ColumnInfo): boolean {
  const type = rawType(column);
  return type.includes('json') || type === 'variant' || type === 'object' || type === 'array';
}

export function isLongTextColumn(column: ColumnInfo): boolean {
  const type = rawType(column);
  return (
    isJsonColumn(column) ||
    type.includes('clob') ||
    type.includes('ntext') ||
    type.includes('longtext') ||
    type.includes('mediumtext') ||
    type.includes('varchar(max)') ||
    type.includes('nvarchar(max)')
  );
}

export function isLargeCellValue(value: CellValue): boolean {
  return typeof value === 'string' && value.length > 200;
}

export function isAutoIncrementColumn(column: ColumnInfo): boolean {
  const extra = (column.extra ?? '').toLowerCase();
  return extra.includes('auto_increment') || extra.includes('identity');
}

export function isSqliteRowID(column: ColumnInfo, primaryKey: string[]): boolean {
  return (
    primaryKey.length === 1 &&
    primaryKey[0] === column.name &&
    /^integer$/i.test((column.columnType || column.dataType || '').trim())
  );
}

export function enumOptions(column: ColumnInfo): string[] {
  const type = column.columnType || column.dataType || '';
  const match = /^(enum|set)\s*\(([\s\S]*)\)\s*$/i.exec(type.trim());
  if (!match) return [];
  const options: string[] = [];
  const literal = /'((?:[^']|'')*)'/g;
  let item: RegExpExecArray | null;
  while ((item = literal.exec(match[2])) !== null) {
    options.push(item[1].replaceAll("''", "'"));
  }
  return options;
}

export function isSetColumn(column: ColumnInfo): boolean {
  return /^set\s*\(/i.test((column.columnType || column.dataType || '').trim());
}

export function dateInputKind(driver: Driver, column: ColumnInfo): DateInputKind | null {
  const type = rawType(column);
  if (type.includes('timestamp') || type.includes('datetime')) return 'datetime';
  if (type.includes('time') && !type.includes('date')) return 'time';
  if (driver === 'oracle' && /^date\b/.test(type)) return 'datetime';
  if (/^date/.test(type)) return 'date';
  return null;
}

export function dateInputValue(value: CellValue, kind: DateInputKind): string | null {
  if (value === null || typeof value === 'boolean') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (kind === 'date') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return match ? match[1] : null;
  }
  if (kind === 'time') {
    const match = /^(\d{2}:\d{2})(:\d{2})?/.exec(text);
    if (!match) return null;
    return match[2] ? `${match[1]}${match[2]}` : `${match[1]}:00`;
  }
  if (text.includes('.') || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/.exec(text);
  if (!match) return null;
  return `${match[1]}T${match[2]}${match[3] ?? ':00'}`;
}

export function dateInputToCell(kind: DateInputKind, input: string): string {
  if (kind === 'date') return input;
  if (kind === 'time') return input.length === 5 ? `${input}:00` : input;
  const normalized = input.replace('T', ' ');
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

export function cellEquals(a: CellValue, b: CellValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return booleanValue(a) === booleanValue(b);
  return String(a) === String(b);
}

export function coerceInputValue(column: ColumnInfo, raw: string | null): CellValue {
  if (raw === null) return null;
  if (isBooleanColumn(column)) {
    const text = raw.trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes') return true;
    if (text === 'false' || text === '0' || text === 'no') return false;
    return raw;
  }
  if (isNumericType(column.columnType || column.dataType)) {
    const text = raw.trim();
    if (text !== '' && /^-?\d+(\.\d+)?$/.test(text) && !/^-?0\d/.test(text) && text.replace(/[-.]/g, '').length <= 15) {
      return Number(text);
    }
  }
  return raw;
}

export function booleanValue(value: CellValue): boolean {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'on';
}

export function formatCellForClipboard(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function serializeTsv(rows: CellValue[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = formatCellForClipboard(value);
          return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join('\t'),
    )
    .join('\n');
}

export function parseClipboard(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delimiter = normalized.includes('\t') ? '\t' : normalized.includes('\n') && normalized.includes(',') ? ',' : null;
  if (!delimiter) {
    const rows = normalized.split('\n');
    while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
    return rows.map((row) => [row]);
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quoted) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

export function columnLabel(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function sqlLiteral(driver: Driver, column: ColumnInfo | undefined, value: CellValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') {
    if (driver === 'sqlserver' || driver === 'oracle') return value ? '1' : '0';
    return value ? 'TRUE' : 'FALSE';
  }
  const text = String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return text;
  if (column) {
    const type = column.columnType || column.dataType;
    if (isNumericType(type) && /^-?\d+(\.\d+)?$/.test(text)) return text;
    if (isBooleanColumn(column)) {
      const lower = text.trim().toLowerCase();
      if (lower === 'true' || lower === '1') return driver === 'sqlserver' || driver === 'oracle' ? '1' : 'TRUE';
      if (lower === 'false' || lower === '0') return driver === 'sqlserver' || driver === 'oracle' ? '0' : 'FALSE';
    }
  }
  return `'${text.replaceAll("'", "''")}'`;
}

export function buildInsertSql(
  driver: Driver,
  database: string,
  schema: string,
  table: string,
  columns: ColumnInfo[],
  rows: Array<Record<string, CellValue>>,
): string {
  const target = qualifiedTable(driver, database, schema, table);
  const statements = rows.map((row) => {
    const entries = columns.filter(
      (column) => !column.generated && !isAutoIncrementColumn(column) && Object.prototype.hasOwnProperty.call(row, column.name),
    );
    if (entries.length === 0) {
      if (driver === 'mysql' || driver === 'mariadb') return `INSERT INTO ${target} () VALUES ();`;
      if (driver === 'oracle' || driver === 'snowflake') {
        return `INSERT INTO ${target} (${quoteIdent(driver, columns[0].name)}) VALUES (DEFAULT);`;
      }
      return `INSERT INTO ${target} DEFAULT VALUES;`;
    }
    return `INSERT INTO ${target} (${entries.map((column) => quoteIdent(driver, column.name)).join(', ')}) VALUES (${entries
      .map((column) => sqlLiteral(driver, column, row[column.name]))
      .join(', ')});`;
  });
  return statements.join('\n');
}

export function buildUpdateSql(
  driver: Driver,
  database: string,
  schema: string,
  table: string,
  columns: ColumnInfo[],
  primaryKeys: string[],
  keys: Record<string, CellValue>,
  changes: Record<string, CellValue>,
): string {
  const target = qualifiedTable(driver, database, schema, table);
  const columnMap = new Map(columns.map((column) => [column.name, column]));
  const sets = Object.entries(changes).map(
    ([name, value]) => `${quoteIdent(driver, name)} = ${sqlLiteral(driver, columnMap.get(name), value)}`,
  );
  const where = primaryKeys.map((name) => `${quoteIdent(driver, name)} = ${sqlLiteral(driver, columnMap.get(name), keys[name] ?? null)}`);
  return `UPDATE ${target} SET ${sets.join(', ')} WHERE ${where.join(' AND ')};`;
}

export interface BlobInfo {
  bytes: Uint8Array | null;
  size: number;
  mime: string | null;
  text: string | null;
  hex: string | null;
}

export function blobInfo(value: CellValue): BlobInfo {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return { bytes: null, size: 0, mime: null, text: value === null ? null : String(value), hex: null };
  }
  const text = String(value);
  if (/^0x[0-9a-f]+$/i.test(text) && text.length % 2 === 0) {
    const bytes = new Uint8Array((text.length - 2) / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(text.slice(2 + index * 2, 4 + index * 2), 16);
    }
    return { bytes, size: bytes.length, mime: detectMime(bytes), text: null, hex: text.slice(2).toLowerCase() };
  }
  const bytes = new TextEncoder().encode(text);
  return { bytes, size: bytes.length, mime: detectMime(bytes), text, hex: bytesToHex(bytes).slice(0, 4096) };
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function formatByteSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function hexDump(hex: string, limit = 2048): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, limit); offset += 16) {
    const slice = Array.from(bytes.subarray(offset, offset + 16));
    const hexPart = slice.map((byte) => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const asciiPart = slice.map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hexPart}  ${asciiPart}`);
  }
  if (bytes.length > limit) lines.push(`… 仅显示前 ${limit} 字节，共 ${bytes.length} 字节`);
  return lines.join('\n');
}
