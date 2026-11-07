import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Copy,
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  Filter as FilterIcon,
  FilterX,
  GripVertical,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Save,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  classNames,
  downloadUrl,
  driverSupportsImportExport,
  formatNumber,
  isNumericType,
  keyOfRow,
  safeFileName,
} from '../lib/utils';
import {
  blobInfo,
  buildInsertSql,
  buildUpdateSql,
  cellEquals,
  clampColumnWidth,
  coerceInputValue,
  columnLabel,
  dateInputKind,
  defaultColumnWidth,
  enumOptions,
  formatByteSize,
  gridPrefsKey,
  isAutoIncrementColumn,
  isBinaryColumn,
  isBooleanColumn,
  isJsonColumn,
  isLargeCellValue,
  isLongTextColumn,
  isSetColumn,
  isSqliteRowID,
  loadGridPrefs,
  parseClipboard,
  saveGridPrefs,
  serializeTsv,
  type GridPrefs,
} from '../lib/grid';
import { useAppStore } from '../store/appStore';
import type {
  CellValue,
  ColumnInfo,
  Connection,
  Filter as DataFilter,
  RowsResponse,
  TableMeta,
} from '../types';
import { ContextMenu, Dropdown, EmptyState, Modal, Spinner } from '../components/ui';
import type { MenuItem } from '../components/ui';
import { ImportCsvDialog } from '../components/ImportCsvDialog';
import { CellEditor } from '../components/CellEditor';
import { LargeTextModal } from '../components/LargeTextModal';
import { BlobViewerModal } from '../components/BlobViewerModal';
import { RowDetailDrawer } from '../components/RowDetailDrawer';

interface TableDataViewProps {
  connection: Connection;
  meta: TableMeta;
  refreshToken: number;
  onRefreshMeta: () => void;
}

type SortState = { column: string; dir: 'asc' | 'desc' } | null;

const OPERATORS: Array<{ value: string; label: string; needsValue: boolean }> = [
  { value: 'contains', label: '包含', needsValue: true },
  { value: 'not_contains', label: '不包含', needsValue: true },
  { value: 'eq', label: '等于', needsValue: true },
  { value: 'neq', label: '不等于', needsValue: true },
  { value: 'gt', label: '大于', needsValue: true },
  { value: 'gte', label: '大于等于', needsValue: true },
  { value: 'lt', label: '小于', needsValue: true },
  { value: 'lte', label: '小于等于', needsValue: true },
  { value: 'starts_with', label: '开头是', needsValue: true },
  { value: 'ends_with', label: '结尾是', needsValue: true },
  { value: 'is_null', label: '为 NULL', needsValue: false },
  { value: 'is_not_null', label: '不为 NULL', needsValue: false },
];

interface CellMenuState {
  x: number;
  y: number;
  row: number;
  col: number;
}

interface CellSelection {
  anchorRow: number;
  anchorCol: number;
  row: number;
  col: number;
}

interface DraftRow {
  id: string;
  values: Record<string, CellValue>;
}

interface CellEditorState {
  row: number;
  col: number;
  seed?: string;
}

interface DetailState {
  kind: 'row' | 'draft';
  row: number;
  draftId?: string;
}

function operatorNeedsValue(operator: string): boolean {
  return OPERATORS.find((item) => item.value === operator)?.needsValue ?? true;
}

export function TableDataView({ connection, meta, refreshToken, onRefreshMeta }: TableDataViewProps) {
  const toast = useAppStore((state) => state.toast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const target = { database: meta.database, schema: meta.schema, table: meta.name };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<DataFilter[]>([]);
  const [draftFilters, setDraftFilters] = useState<DataFilter[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [data, setData] = useState<RowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);

  const [pending, setPending] = useState<Map<string, Map<number, CellValue>>>(new Map());
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [deletedRows, setDeletedRows] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [editing, setEditing] = useState<CellEditorState | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [largeEdit, setLargeEdit] = useState<{ row: number; col: number } | null>(null);
  const [blobView, setBlobView] = useState<{ row: number; col: number } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [savingBatch, setSavingBatch] = useState(false);
  const [columnsPanel, setColumnsPanel] = useState(false);

  const prefsKey = gridPrefsKey(connection.id, meta.database, meta.schema, meta.name);
  const [prefs, setPrefs] = useState<GridPrefs>(() => loadGridPrefs(prefsKey, meta.columns));

  const columns = meta.columns;
  const columnNames = useMemo(() => columns.map((column) => column.name), [columns]);
  const columnKey = columnNames.join('\u0001');
  const columnIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    columns.forEach((column, index) => map.set(column.name, index));
    return map;
  }, [columns]);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const editable = meta.editable;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedCount = selected.size;
  const totalRows = rows.length + drafts.length;
  const dirtyCellCount = useMemo(() => {
    let count = 0;
    pending.forEach((cells) => {
      count += cells.size;
    });
    return count;
  }, [pending]);
  const dirtyCount = dirtyCellCount + drafts.length + deletedRows.size;

  const gridRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const columnsButtonRef = useRef<HTMLButtonElement>(null);
  const columnsPanelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);
  const dragColumnRef = useRef<string | null>(null);
  const draftSeq = useRef(0);
  const savingRef = useRef(false);
  const saveRef = useRef<() => void>(() => {});
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const makeDraftId = () => {
    draftSeq.current += 1;
    return `draft-${Date.now()}-${draftSeq.current}`;
  };

  const rowIdAt = (rowIndex: number): string => {
    if (rowIndex < rows.length) return `${page}:${rowIndex}`;
    return drafts[rowIndex - rows.length]?.id ?? `missing:${rowIndex}`;
  };

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.rows(connection.id, target, {
        page,
        pageSize,
        sortColumn: sort?.column,
        sortDir: sort?.dir,
        filters,
      });
      const pages = Math.max(1, Math.ceil(response.total / pageSize));
      if (page > pages) {
        setPage(pages);
        return;
      }
      setData(response);
      setSelected(new Set());
      setPending(new Map());
      setDrafts([]);
      setDeletedRows(new Set());
      setSelection(null);
      setEditing(null);
      setDetail(null);
      setLastLoaded(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
    // target fields are represented by meta dependencies below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, meta.database, meta.schema, meta.name, page, pageSize, sort, filters]);

  useEffect(() => {
    void loadRows();
  }, [loadRows, refreshToken, reloadKey]);

  useEffect(() => {
    setFilters([]);
    setDraftFilters([]);
    setSort(null);
    setSelected(new Set());
    setSelection(null);
    setPending(new Map());
    setDrafts([]);
    setDeletedRows(new Set());
    setEditing(null);
    setDetail(null);
    setPrefs(loadGridPrefs(prefsKey, meta.columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey, prefsKey]);

  useEffect(() => {
    saveGridPrefs(prefsKey, prefs);
  }, [prefs, prefsKey]);

  useEffect(() => {
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    if (!dirtyCount) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyCount]);

  useEffect(() => {
    if (!dirtyCount) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        if (event.defaultPrevented) return;
        if (document.querySelector('.modal-overlay')) return;
        if (!rootRef.current?.closest('.tab-pane.active')) return;
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirtyCount]);

  useEffect(() => {
    if (!columnsPanel) return;
    const onDown = (event: MouseEvent) => {
      const node = event.target as Node;
      if (columnsPanelRef.current?.contains(node)) return;
      if (columnsButtonRef.current?.contains(node)) return;
      setColumnsPanel(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [columnsPanel]);

  const orderedColumns = useMemo(() => {
    const map = new Map(columns.map((column) => [column.name, column]));
    const ordered: ColumnInfo[] = [];
    prefs.order.forEach((name) => {
      const column = map.get(name);
      if (column) ordered.push(column);
    });
    columns.forEach((column) => {
      if (!ordered.includes(column)) ordered.push(column);
    });
    return ordered;
  }, [columns, prefs.order]);

  const visibleColumns = useMemo(
    () => orderedColumns.filter((column) => !prefs.hidden.includes(column.name)),
    [orderedColumns, prefs.hidden],
  );
  const visibleIndexes = useMemo(
    () => visibleColumns.map((column) => columnIndexMap.get(column.name) ?? -1).filter((index) => index >= 0),
    [visibleColumns, columnIndexMap],
  );
  const visiblePositions = useMemo(() => {
    const map = new Map<number, number>();
    visibleIndexes.forEach((columnIndex, position) => map.set(columnIndex, position));
    return map;
  }, [visibleIndexes]);

  const columnWidth = (column: ColumnInfo) => prefs.widths[column.name] ?? defaultColumnWidth(column);
  const tableWidth =
    (editable ? 32 : 0) + 46 + visibleColumns.reduce((sum, column) => sum + columnWidth(column), 0);

  const cellValueAt = useCallback(
    (rowIndex: number, colIndex: number): CellValue => {
      const column = columns[colIndex];
      if (!column) return null;
      if (rowIndex >= rows.length) {
        const draft = drafts[rowIndex - rows.length];
        if (!draft) return null;
        return Object.prototype.hasOwnProperty.call(draft.values, column.name) ? draft.values[column.name] : null;
      }
      const pendingRow = pending.get(`${page}:${rowIndex}`);
      if (pendingRow?.has(colIndex)) return pendingRow.get(colIndex) as CellValue;
      return rows[rowIndex]?.[colIndex] ?? null;
    },
    [columns, rows, drafts, pending, page],
  );

  const recordForRow = (rowIndex: number): Record<string, CellValue> => {
    const record: Record<string, CellValue> = {};
    columns.forEach((column, colIndex) => {
      record[column.name] = cellValueAt(rowIndex, colIndex);
    });
    return record;
  };

  const draftRecord = (draft: DraftRow): Record<string, CellValue> => ({ ...draft.values });

  const originalRecord = (rowIndex: number): Record<string, CellValue> => {
    const record: Record<string, CellValue> = {};
    columns.forEach((column, colIndex) => {
      record[column.name] = rows[rowIndex]?.[colIndex] ?? null;
    });
    return record;
  };

  const isRowDeleted = (rowIndex: number): boolean => rowIndex < rows.length && deletedRows.has(`${page}:${rowIndex}`);

  const stageServerCells = (cells: Array<{ rowIndex: number; colIndex: number; value: CellValue }>) => {
    if (cells.length === 0) return;
    setPending((current) => {
      const next = new Map(current);
      cells.forEach(({ rowIndex, colIndex, value }) => {
        const rowId = `${page}:${rowIndex}`;
        const original = rows[rowIndex]?.[colIndex] ?? null;
        const inner = new Map(next.get(rowId) ?? []);
        if (cellEquals(original, value)) inner.delete(colIndex);
        else inner.set(colIndex, value);
        if (inner.size > 0) next.set(rowId, inner);
        else next.delete(rowId);
      });
      return next;
    });
  };

  const stageDraftCells = (
    cells: Array<{ draftOffset: number; colIndex: number; value: CellValue }>,
    needed: number,
  ) => {
    if (cells.length === 0 && needed <= drafts.length) return;
    setDrafts((current) => {
      const next = [...current];
      while (next.length < needed) next.push({ id: makeDraftId(), values: {} });
      const touched = new Map<number, DraftRow>();
      cells.forEach(({ draftOffset, colIndex, value }) => {
        const column = columns[colIndex];
        if (!column) return;
        const draft = touched.get(draftOffset) ?? {
          ...next[draftOffset],
          values: { ...next[draftOffset].values },
        };
        draft.values[column.name] = value;
        touched.set(draftOffset, draft);
      });
      touched.forEach((draft, offset) => {
        next[offset] = draft;
      });
      return next;
    });
  };

  const stageCell = (rowIndex: number, colIndex: number, value: CellValue) => {
    if (!editable || savingRef.current) return;
    const column = columns[colIndex];
    if (!column || column.generated || isBinaryColumn(column)) return;
    if (isRowDeleted(rowIndex)) return;
    if (rowIndex < rows.length) stageServerCells([{ rowIndex, colIndex, value }]);
    else stageDraftCells([{ draftOffset: rowIndex - rows.length, colIndex, value }], drafts.length);
  };

  const toggleDraftValue = (draftId: string, columnName: string, value: CellValue) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId ? { ...draft, values: { ...draft.values, [columnName]: value } } : draft,
      ),
    );
  };

  const clearTransient = () => {
    setPending(new Map());
    setDrafts([]);
    setDeletedRows(new Set());
    setEditing(null);
    setSelection(null);
    setDetail(null);
    setLargeEdit(null);
    setBlobView(null);
  };

  const guardDirty = (action: () => void) => {
    if (dirtyCount === 0) {
      action();
      return;
    }
    requestConfirm({
      title: '放弃未保存的修改？',
      message: `当前有 ${dirtyCount} 处未保存的修改，继续操作会丢弃它们。`,
      confirmText: '丢弃并继续',
      danger: true,
      onConfirm: () => {
        clearTransient();
        action();
      },
    });
  };

  const refresh = () => setReloadKey((value) => value + 1);

  const toggleSort = (column: string) => {
    guardDirty(() => {
      if (!sort || sort.column !== column) setSort({ column, dir: 'asc' });
      else if (sort.dir === 'asc') setSort({ column, dir: 'desc' });
      else setSort(null);
      setPage(1);
    });
  };

  const applyFilters = () => {
    guardDirty(() => {
      setFilters(draftFilters.filter((filter) => filter.column));
      setPage(1);
    });
  };

  const resetFilters = () => {
    guardDirty(() => {
      setDraftFilters([]);
      setFilters([]);
      setPage(1);
    });
  };

  const openFilterPanel = () => {
    if (!filterOpen) setDraftFilters(filters.length ? filters.map((filter) => ({ ...filter })) : []);
    setFilterOpen((value) => !value);
  };

  const addFilterRow = () => {
    setDraftFilters((items) => [...items, { column: columns[0]?.name ?? '', operator: 'contains', value: '' }]);
  };

  const updateDraft = (index: number, patch: Partial<DataFilter>) => {
    setDraftFilters((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const selectAll = (checked: boolean) => {
    setSelected(checked ? new Set(rows.map((_, index) => index)) : new Set());
  };

  const toggleRow = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectionInfo = useCallback((current: CellSelection | null) => {
    if (!current) return null;
    const anchorPos = visiblePositions.get(current.anchorCol) ?? 0;
    const focusPos = visiblePositions.get(current.col) ?? anchorPos;
    const minPos = Math.min(anchorPos, focusPos);
    const maxPos = Math.max(anchorPos, focusPos);
    const cols = visibleIndexes.slice(minPos, maxPos + 1);
    const minRow = Math.min(current.anchorRow, current.row);
    const maxRow = Math.max(current.anchorRow, current.row);
    return { cols, minRow, maxRow, minPos, maxPos };
  }, [visiblePositions, visibleIndexes]);

  const selectedCells = (): Array<{ rowIndex: number; colIndex: number; column: ColumnInfo }> => {
    const info = selectionInfo(selection);
    if (!info) return [];
    const cells: Array<{ rowIndex: number; colIndex: number; column: ColumnInfo }> = [];
    for (let rowIndex = info.minRow; rowIndex <= info.maxRow; rowIndex += 1) {
      info.cols.forEach((colIndex) => {
        const column = columns[colIndex];
        if (column) cells.push({ rowIndex, colIndex, column });
      });
    }
    return cells;
  };

  const selectionStats = useMemo(() => {
    const info = selection ? selectionInfo(selection) : null;
    if (!info) return null;
    let cells = 0;
    let nonNull = 0;
    let numericCount = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let rowIndex = info.minRow; rowIndex <= info.maxRow; rowIndex += 1) {
      info.cols.forEach((colIndex) => {
        const column = columns[colIndex];
        if (!column) return;
        cells += 1;
        const value = cellValueAt(rowIndex, colIndex);
        if (value === null) return;
        nonNull += 1;
        if (isNumericType(column.columnType || column.dataType)) {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) {
            numericCount += 1;
            sum += numeric;
            min = Math.min(min, numeric);
            max = Math.max(max, numeric);
          }
        }
      });
    }
    const rowOffset = (page - 1) * pageSize;
    const firstCol = info.cols[0] ?? 0;
    const lastCol = info.cols[info.cols.length - 1] ?? firstCol;
    return {
      cells,
      nonNull,
      numericCount,
      sum,
      min: numericCount ? min : null,
      max: numericCount ? max : null,
      label: `${columnLabel(firstCol)}${rowOffset + info.minRow + 1}:${columnLabel(lastCol)}${rowOffset + info.maxRow + 1}`,
    };
  }, [selection, selectionInfo, cellValueAt, columns, page, pageSize]);

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', message);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        toast('success', message);
      } catch {
        toast('error', '复制到剪贴板失败');
      }
    }
  };

  const copySelection = () => {
    const info = selectionInfo(selection);
    if (!info) {
      toast('info', '先点击单元格选择要复制的内容');
      return;
    }
    const matrix: CellValue[][] = [];
    for (let rowIndex = info.minRow; rowIndex <= info.maxRow; rowIndex += 1) {
      matrix.push(info.cols.map((colIndex) => cellValueAt(rowIndex, colIndex)));
    }
    const text = serializeTsv(matrix);
    void copyText(text, `已复制 ${matrix.length} 行 × ${info.cols.length} 列`);
  };

  const applyPasteMatrix = (matrix: string[][]) => {
    if (!editable) {
      toast('warning', '当前表格为只读，无法粘贴');
      return;
    }
    if (!matrix.length) return;
    const startRow = selection?.row ?? 0;
    const startCol = selection?.col ?? visibleIndexes[0] ?? 0;
    const startPos = visiblePositions.get(startCol) ?? 0;
    const isSingle = matrix.length === 1 && matrix[0].length === 1;
    const info = selectionInfo(selection);
    const targetCols = isSingle
      ? info?.cols ?? [startCol]
      : visibleIndexes.slice(startPos, startPos + Math.max(...matrix.map((line) => line.length)));
    if (targetCols.length === 0) {
      toast('warning', '没有可粘贴的可见列');
      return;
    }
    const serverCells: Array<{ rowIndex: number; colIndex: number; value: CellValue }> = [];
    const draftCells: Array<{ draftOffset: number; colIndex: number; value: CellValue }> = [];
    let skipped = 0;
    let pasted = 0;
    const blockRows = isSingle ? (info ? info.maxRow - info.minRow + 1 : 1) : matrix.length;
    const blockCols = targetCols.length;
    const firstRow = isSingle ? info?.minRow ?? startRow : startRow;
    for (let r = 0; r < blockRows; r += 1) {
      const rowIndex = firstRow + r;
      for (let c = 0; c < blockCols; c += 1) {
        const colIndex = targetCols[c];
        const column = columns[colIndex];
        if (!column || column.generated || isBinaryColumn(column)) {
          skipped += 1;
          continue;
        }
        if (rowIndex < rows.length && isRowDeleted(rowIndex)) {
          skipped += 1;
          continue;
        }
        const raw = isSingle ? matrix[0][0] : matrix[r]?.[c] ?? '';
        const value = coerceInputValue(column, raw);
        if (rowIndex < rows.length) serverCells.push({ rowIndex, colIndex, value });
        else draftCells.push({ draftOffset: rowIndex - rows.length, colIndex, value });
        pasted += 1;
      }
    }
    const neededDrafts = Math.max(drafts.length, firstRow + blockRows - rows.length);
    stageServerCells(serverCells);
    stageDraftCells(draftCells, neededDrafts);
    const focusRow = Math.min(firstRow + blockRows - 1, rows.length + neededDrafts - 1);
    if (focusRow >= 0) {
      setSelection({
        anchorRow: firstRow,
        anchorCol: targetCols[0],
        row: focusRow,
        col: targetCols[targetCols.length - 1],
      });
      window.requestAnimationFrame(() => scrollToCell(focusRow, targetCols[targetCols.length - 1]));
    }
    toast(
      skipped > 0 ? 'warning' : 'success',
      `已粘贴 ${pasted} 个单元格${skipped ? `，跳过 ${skipped} 个不可编辑单元格` : ''}`,
      '按 Ctrl+S 或点击保存后写入数据库',
    );
    focusGrid();
  };

  const requestPaste = async () => {
    if (!editable) {
      toast('warning', '当前表格为只读，无法粘贴');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast('info', '剪贴板为空');
        return;
      }
      applyPasteMatrix(parseClipboard(text));
    } catch {
      setPasteText('');
      setPasteOpen(true);
    }
  };

  const applyPasteDialog = () => {
    if (!pasteText.trim()) return;
    applyPasteMatrix(parseClipboard(pasteText));
    setPasteOpen(false);
    setPasteText('');
  };

  const clearSelectedCells = () => {
    if (!editable) return;
    const serverCells: Array<{ rowIndex: number; colIndex: number; value: CellValue }> = [];
    const draftCells: Array<{ draftOffset: number; colIndex: number; value: CellValue }> = [];
    selectedCells().forEach(({ rowIndex, colIndex, column }) => {
      if (column.generated || isBinaryColumn(column) || isRowDeleted(rowIndex)) return;
      const value: CellValue = column.nullable ? null : '';
      if (rowIndex < rows.length) serverCells.push({ rowIndex, colIndex, value });
      else draftCells.push({ draftOffset: rowIndex - rows.length, colIndex, value });
    });
    stageServerCells(serverCells);
    stageDraftCells(draftCells, drafts.length);
  };

  const scrollToCell = (rowIndex: number, colIndex: number) => {
    window.requestAnimationFrame(() => {
      const cell = gridRef.current?.querySelector<HTMLElement>(
        `[data-row="${rowIndex}"][data-col="${colIndex}"]`,
      );
      cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };

  const focusGrid = () => {
    window.requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
  };

  const setCellFocus = (rowIndex: number, colIndex: number, extend = false) => {
    setSelection((current) => {
      if (!current || !extend) {
        return { anchorRow: rowIndex, anchorCol: colIndex, row: rowIndex, col: colIndex };
      }
      return { ...current, row: rowIndex, col: colIndex };
    });
  };

  const moveSelection = (fromRow: number, fromCol: number, dRow: number, dCol: number, extend: boolean) => {
    if (totalRows === 0 || visibleIndexes.length === 0) return;
    let nextCol = fromCol;
    if (dCol !== 0) {
      const pos = visiblePositions.get(fromCol) ?? 0;
      const nextPos = Math.max(0, Math.min(visibleIndexes.length - 1, pos + dCol));
      nextCol = visibleIndexes[nextPos];
    }
    const nextRow = Math.max(0, Math.min(totalRows - 1, fromRow + dRow));
    setSelection((current) => {
      const anchor = extend && current ? { row: current.anchorRow, col: current.anchorCol } : { row: fromRow, col: fromCol };
      return { anchorRow: anchor.row, anchorCol: anchor.col, row: nextRow, col: nextCol };
    });
    scrollToCell(nextRow, nextCol);
  };

  const selectAllCells = () => {
    if (totalRows === 0 || visibleIndexes.length === 0) return;
    setSelection({
      anchorRow: 0,
      anchorCol: visibleIndexes[0],
      row: totalRows - 1,
      col: visibleIndexes[visibleIndexes.length - 1],
    });
  };

  const openCellEditor = (rowIndex: number, colIndex: number, seed?: string) => {
    const column = columns[colIndex];
    if (!column) return;
    if (isRowDeleted(rowIndex)) {
      toast('info', '该行已标记为待删除，请先取消删除');
      return;
    }
    if (column.generated) {
      toast('info', '生成列由数据库计算，不能直接编辑');
      return;
    }
    if (connection.driver === 'mongodb' && column.name === '_id') {
      toast('info', 'MongoDB 的 _id 是文档定位键，不能修改');
      return;
    }
    const currentValue = cellValueAt(rowIndex, colIndex);
    const longText = isLongTextColumn(column) || isLargeCellValue(currentValue);
    if (!editable) {
      if (isBinaryColumn(column) || longText) {
        setBlobView({ row: rowIndex, col: colIndex });
      } else {
        toast('info', '当前表格为只读');
      }
      return;
    }
    setCellFocus(rowIndex, colIndex);
    if (isBinaryColumn(column)) {
      setBlobView({ row: rowIndex, col: colIndex });
      return;
    }
    if (longText) {
      setLargeEdit({ row: rowIndex, col: colIndex });
      return;
    }
    setEditing({ row: rowIndex, col: colIndex, seed });
  };

  const finishCellEdit = (value: CellValue, move: 'down' | 'right' | 'left' | 'up' | 'none') => {
    if (!editing) return;
    const { row, col } = editing;
    stageCell(row, col, value);
    setEditing(null);
    if (move === 'down') moveSelection(row, col, 1, 0, false);
    else if (move === 'up') moveSelection(row, col, -1, 0, false);
    else if (move === 'right') moveSelection(row, col, 0, 1, false);
    else if (move === 'left') moveSelection(row, col, 0, -1, false);
    else setCellFocus(row, col);
    focusGrid();
  };

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const element = event.target as HTMLElement;
    if (element.closest('input, textarea, select, button, a')) return;
    const metaKey = event.ctrlKey || event.metaKey;
    if (metaKey) {
      const key = event.key.toLowerCase();
      if (key === 'c') {
        event.preventDefault();
        copySelection();
      } else if (key === 'v') {
        event.preventDefault();
        void requestPaste();
      } else if (key === 'a') {
        event.preventDefault();
        selectAllCells();
      }
      return;
    }
    if (!selection) {
      if (['ArrowDown', 'ArrowRight', 'Enter', 'F2'].includes(event.key) && totalRows > 0) {
        event.preventDefault();
        setCellFocus(0, visibleIndexes[0]);
        scrollToCell(0, visibleIndexes[0]);
      }
      return;
    }
    const { row, col } = selection;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(row, col, 1, 0, event.shiftKey);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(row, col, -1, 0, event.shiftKey);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveSelection(row, col, 0, 1, event.shiftKey);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveSelection(row, col, 0, -1, event.shiftKey);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      moveSelection(row, col, 0, event.shiftKey ? -1 : 1, false);
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      openCellEditor(row, col);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      clearSelectedCells();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      openCellEditor(row, col, '');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setSelection(null);
      setColumnsPanel(false);
    } else if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      const column = columns[col];
      const seed = column && (isBooleanColumn(column) || isSetColumn(column) || enumOptions(column).length > 0 || dateInputKind(connection.driver, column))
        ? undefined
        : event.key;
      openCellEditor(row, col, seed);
    }
  };

  const setCellNull = (rowIndex: number, colIndex: number) => {
    const column = columns[colIndex];
    if (!column) return;
    if (isRowDeleted(rowIndex)) return;
    if (!column.nullable) {
      toast('warning', `列 ${column.name} 不允许 NULL`);
      return;
    }
    stageCell(rowIndex, colIndex, null);
  };

  const copyRowJson = (rowIndex: number) => {
    const record = rowIndex >= rows.length && drafts[rowIndex - rows.length]
      ? draftRecord(drafts[rowIndex - rows.length])
      : recordForRow(rowIndex);
    void copyText(JSON.stringify(record, null, 2), '已复制整行 JSON');
  };

  const copyRowInsert = (rowIndex: number) => {
    const record = rowIndex >= rows.length && drafts[rowIndex - rows.length]
      ? draftRecord(drafts[rowIndex - rows.length])
      : recordForRow(rowIndex);
    const sql = buildInsertSql(connection.driver, meta.database, meta.schema, meta.name, columns, [record]);
    void copyText(sql, '已复制 INSERT 语句');
  };

  const copyRowUpdate = (rowIndex: number) => {
    if (rowIndex >= rows.length) {
      copyRowInsert(rowIndex);
      return;
    }
    const changes: Record<string, CellValue> = {};
    const rowPending = pending.get(`${page}:${rowIndex}`);
    rowPending?.forEach((value, colIndex) => {
      const column = columns[colIndex];
      if (column) changes[column.name] = value;
    });
    if (Object.keys(changes).length === 0) {
      toast('info', '该行没有待保存的修改');
      return;
    }
    const keys = keyOfRow(meta.primaryKey, columnNames, rows[rowIndex]) as Record<string, CellValue>;
    const sql = buildUpdateSql(
      connection.driver,
      meta.database,
      meta.schema,
      meta.name,
      columns,
      meta.primaryKey,
      keys,
      changes,
    );
    void copyText(sql, '已复制 UPDATE 语句');
  };

  const filterByCell = (rowIndex: number, colIndex: number) => {
    const column = columns[colIndex];
    if (!column) return;
    const value = cellValueAt(rowIndex, colIndex);
    const nextFilter: DataFilter = value === null
      ? { column: column.name, operator: 'is_null', value: '' }
      : { column: column.name, operator: 'eq', value: String(value) };
    guardDirty(() => {
      setDraftFilters([nextFilter]);
      setFilters([nextFilter]);
      setFilterOpen(true);
      setPage(1);
    });
  };

  const addDraft = () => {
    if (!editable) return;
    if (visibleColumns.length === 0) {
      toast('warning', '请先在“列”面板中显示至少一列');
      return;
    }
    const draft = { id: makeDraftId(), values: {} as Record<string, CellValue> };
    const draftIndex = rows.length + drafts.length;
    setDrafts((current) => [...current, draft]);
    setSelected(new Set());
    setSelection({
      anchorRow: draftIndex,
      anchorCol: visibleIndexes[0],
      row: draftIndex,
      col: visibleIndexes[0],
    });
    window.requestAnimationFrame(() => {
      const container = gridRef.current;
      if (container) container.scrollTop = container.scrollHeight;
      scrollToCell(draftIndex, visibleIndexes[0]);
      focusGrid();
    });
    toast('info', '已添加一行草稿', '填写后按 Ctrl+S 或点击保存写入数据库');
  };

  const removeDraftByIndex = (rowIndex: number) => {
    const draft = drafts[rowIndex - rows.length];
    if (!draft) return;
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
    setSelection(null);
    setDetail(null);
    setEditing(null);
  };

  const toggleRowDeleted = (rowIndex: number) => {
    if (rowIndex >= rows.length) {
      removeDraftByIndex(rowIndex);
      return;
    }
    if (!editable) return;
    const rowId = `${page}:${rowIndex}`;
    setDeletedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
    if (editing?.row === rowIndex) setEditing(null);
  };

  const stageDelete = () => {
    if (!editable) return;
    const targets = selectedCount > 0
      ? [...selected]
      : selection
        ? [selection.row]
        : [];
    if (targets.length === 0) {
      toast('info', '先选择要删除的行');
      return;
    }
    const serverTargets = targets.filter((rowIndex) => rowIndex < rows.length);
    const draftTargets = targets.filter((rowIndex) => rowIndex >= rows.length);
    if (draftTargets.length > 0) {
      const ids = new Set(
        draftTargets
          .map((rowIndex) => drafts[rowIndex - rows.length]?.id)
          .filter((id): id is string => Boolean(id)),
      );
      setDrafts((current) => current.filter((draft) => !ids.has(draft.id)));
    }
    if (serverTargets.length > 0) {
      setDeletedRows((current) => {
        const next = new Set(current);
        serverTargets.forEach((rowIndex) => next.add(`${page}:${rowIndex}`));
        return next;
      });
    }
    setSelected(new Set());
    setSelection(null);
    setEditing(null);
    setDetail(null);
    toast(
      'warning',
      `已标记 ${serverTargets.length + draftTargets.length} 行为待删除`,
      '保存后才会真正删除；可在右键菜单中取消',
    );
  };

  const duplicateRows = (sourceRows?: number[]) => {
    if (!editable) return;
    const targets = sourceRows && sourceRows.length > 0
      ? sourceRows
      : selectedCount > 0
        ? [...selected]
        : selection
          ? [selection.row]
          : [];
    if (targets.length === 0) {
      toast('info', '先选择要复制的行');
      return;
    }
    const copies: DraftRow[] = [];
    targets.forEach((rowIndex) => {
      if (rowIndex >= totalRows) return;
      const record = rowIndex >= rows.length && drafts[rowIndex - rows.length]
        ? draftRecord(drafts[rowIndex - rows.length])
        : recordForRow(rowIndex);
      const values: Record<string, CellValue> = {};
      columns.forEach((column) => {
        if (column.generated || isAutoIncrementColumn(column) || isBinaryColumn(column)) return;
        if (isSqliteRowID(column, meta.primaryKey)) return;
        if (connection.driver === 'mongodb' && column.name === '_id') return;
        if (Object.prototype.hasOwnProperty.call(record, column.name)) values[column.name] = record[column.name];
      });
      copies.push({ id: makeDraftId(), values });
    });
    if (copies.length === 0) return;
    const firstDraftIndex = rows.length + drafts.length;
    setDrafts((current) => [...current, ...copies]);
    setSelected(new Set());
    setSelection({
      anchorRow: firstDraftIndex,
      anchorCol: visibleIndexes[0] ?? 0,
      row: firstDraftIndex,
      col: visibleIndexes[0] ?? 0,
    });
    window.requestAnimationFrame(() => {
      const container = gridRef.current;
      if (container) container.scrollTop = container.scrollHeight;
      scrollToCell(firstDraftIndex, visibleIndexes[0] ?? 0);
      focusGrid();
    });
    toast('success', `已复制 ${copies.length} 行为待保存的新行`);
  };

  const openDetail = (rowIndex: number) => {
    if (rowIndex < rows.length) setDetail({ kind: 'row', row: rowIndex });
    else {
      const draft = drafts[rowIndex - rows.length];
      if (draft) setDetail({ kind: 'draft', row: rowIndex, draftId: draft.id });
    }
  };

  const validateDrafts = (): string | null => {
    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index];
      for (const column of columns) {
        if (column.generated || isAutoIncrementColumn(column) || isSqliteRowID(column, meta.primaryKey)) continue;
        if (Object.prototype.hasOwnProperty.call(draft.values, column.name)) continue;
        if (!column.nullable && column.defaultValue === null) {
          return `新增第 ${index + 1} 行：列「${column.name}」为必填，请填写后再保存`;
        }
      }
    }
    return null;
  };

  const saveAll = async () => {
    if (savingRef.current || !dirtyCount) return;
    const validation = validateDrafts();
    if (validation) {
      toast('warning', validation);
      return;
    }
    const updates: Array<{ keys: Record<string, CellValue>; changes: Record<string, CellValue> }> = [];
    for (const [rowId, cells] of pending.entries()) {
      if (deletedRows.has(rowId)) continue;
      const rowIndex = Number(rowId.slice(rowId.indexOf(':') + 1));
      const row = rows[rowIndex];
      if (!row) continue;
      const keys = keyOfRow(meta.primaryKey, columnNames, row) as Record<string, CellValue>;
      if (meta.primaryKey.some((name) => keys[name] === undefined || keys[name] === null)) {
        toast('error', '无法保存：该行主键值为空');
        return;
      }
      const changes: Record<string, CellValue> = {};
      cells.forEach((value, colIndex) => {
        const column = columns[colIndex];
        if (column) changes[column.name] = value;
      });
      if (Object.keys(changes).length > 0) updates.push({ keys, changes });
    }
    const inserts = drafts.map((draft) => ({ ...draft.values }));
    const deletes: Array<Record<string, CellValue>> = [];
    for (const rowId of deletedRows) {
      const rowIndex = Number(rowId.slice(rowId.indexOf(':') + 1));
      const row = rows[rowIndex];
      if (!row) continue;
      const keys = keyOfRow(meta.primaryKey, columnNames, row) as Record<string, CellValue>;
      if (meta.primaryKey.some((name) => keys[name] === undefined || keys[name] === null)) {
        toast('error', '无法删除：该行主键值为空');
        return;
      }
      deletes.push(keys);
    }
    if (updates.length === 0 && inserts.length === 0 && deletes.length === 0) {
      toast('info', '没有需要保存的修改');
      return;
    }
    savingRef.current = true;
    setSavingBatch(true);
    try {
      const result = await api.batchMutate(connection.id, target, { updates, inserts, deletes });
      clearTransient();
      setLastLoaded(Date.now());
      toast(
        'success',
        '修改已保存',
        `更新 ${result.updated} 行 · 新增 ${result.inserted} 行 · 删除 ${result.deleted} 行`,
      );
      onRefreshMeta();
    } catch (saveError) {
      toast(
        'error',
        '保存失败，未写入任何修改',
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      savingRef.current = false;
      setSavingBatch(false);
    }
  };
  saveRef.current = () => {
    void saveAll();
  };

  const discardAll = () => {
    if (!dirtyCount) return;
    requestConfirm({
      title: '放弃所有未保存的修改？',
      message: `将丢弃 ${dirtyCellCount} 处单元格修改、${drafts.length} 行新增和 ${deletedRows.size} 行删除标记。`,
      confirmText: '放弃修改',
      danger: true,
      onConfirm: () => {
        clearTransient();
        toast('info', '已放弃未保存的修改');
      },
    });
  };

  const addColumnWidth = (column: ColumnInfo, width: number) => {
    setPrefs((current) => ({
      ...current,
      widths: { ...current.widths, [column.name]: clampColumnWidth(width) },
    }));
  };

  const startResize = (event: ReactMouseEvent, column: ColumnInfo) => {
    event.preventDefault();
    event.stopPropagation();
    resizingRef.current = true;
    const startX = event.clientX;
    const startWidth = columnWidth(column);
    const onMove = (moveEvent: MouseEvent) => {
      addColumnWidth(column, startWidth + moveEvent.clientX - startX);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-column');
      window.setTimeout(() => {
        resizingRef.current = false;
      }, 0);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.classList.add('resizing-column');
  };

  const resetColumnWidth = (column: ColumnInfo) => {
    setPrefs((current) => {
      const widths = { ...current.widths };
      delete widths[column.name];
      return { ...current, widths };
    });
  };

  const toggleColumnHidden = (name: string) => {
    const currentlyHidden = prefs.hidden.includes(name);
    if (!currentlyHidden && visibleColumns.length <= 1) {
      toast('warning', '至少需要保留一列可见列');
      return;
    }
    setPrefs((current) => {
      const hidden = new Set(current.hidden);
      if (hidden.has(name)) hidden.delete(name);
      else hidden.add(name);
      return { ...current, hidden: [...hidden] };
    });
    if (!currentlyHidden) {
      setSelection(null);
      setEditing(null);
    }
  };

  const reorderColumn = (from: string, to: string) => {
    if (!from || from === to) return;
    setPrefs((current) => {
      const order = [...current.order];
      const fromIndex = order.indexOf(from);
      const toIndex = order.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return current;
      order.splice(fromIndex, 1);
      order.splice(toIndex, 0, from);
      return { ...current, order };
    });
  };

  const detailInfo = (() => {
    if (!detail) return null;
    if (detail.kind === 'row') {
      if (detail.row >= rows.length) return null;
      const rowId = `${page}:${detail.row}`;
      const changed = new Set<string>();
      pending.get(rowId)?.forEach((_, colIndex) => {
        const column = columns[colIndex];
        if (column) changed.add(column.name);
      });
      return {
        title: `第 ${(page - 1) * pageSize + detail.row + 1} 行`,
        subtitle: `${meta.name}${meta.primaryKey.length ? ` · 主键 ${meta.primaryKey.join(', ')}` : ''}`,
        values: recordForRow(detail.row),
        original: originalRecord(detail.row),
        changed,
        deleted: isRowDeleted(detail.row),
        rowIndex: detail.row,
      };
    }
    const draft = drafts.find((item) => item.id === detail.draftId);
    if (!draft) return null;
    return {
      title: '新增行',
      subtitle: `${meta.name} · 保存后写入数据库`,
      values: recordForRow(detail.row),
      original: null,
      changed: new Set(Object.keys(draft.values)),
      deleted: false,
      rowIndex: detail.row,
    };
  })();

  const readOnlyReason = meta.type === 'view'
    ? '视图为只读，不能直接编辑数据。'
    : connection.readOnly
      ? '该连接处于只读模式。'
      : meta.primaryKey.length === 0
        ? '该表没有主键，数据网格为只读。'
        : null;

  const cellMenuItems: MenuItem[] = cellMenu
    ? (() => {
        const column = columns[cellMenu.col];
        const value = cellValueAt(cellMenu.row, cellMenu.col);
        const deleted = isRowDeleted(cellMenu.row);
        const binary = Boolean(column && isBinaryColumn(column));
        const longText = Boolean(column && (isLongTextColumn(column) || isLargeCellValue(value)));
        const info = selectionInfo(selection);
        const menuCells = info ? (info.maxRow - info.minRow + 1) * info.cols.length : 1;
        if (!column) return [];
        return [
          {
            label: longText ? '编辑大文本' : binary ? '查看二进制' : '编辑单元格',
            icon: <Pencil size={13} />,
            disabled:
              deleted ||
              (!editable && !binary && !longText) ||
              column.generated ||
              (connection.driver === 'mongodb' && column.name === '_id'),
            onClick: () => openCellEditor(cellMenu.row, cellMenu.col),
          },
          {
            label: '设为 NULL',
            icon: <X size={13} />,
            disabled: deleted || !editable || !column.nullable || value === null || column.generated || binary,
            onClick: () => setCellNull(cellMenu.row, cellMenu.col),
          },
          { label: '', separator: true },
          {
            label: '复制单元格',
            icon: <Copy size={13} />,
            onClick: () => void copyText(value === null ? '' : String(value), '已复制单元格内容'),
          },
          {
            label: menuCells > 1 ? `复制选区（${menuCells} 格）` : '复制选区',
            icon: <Copy size={13} />,
            onClick: copySelection,
          },
          {
            label: '粘贴（Ctrl+V）',
            icon: <Plus size={13} />,
            disabled: !editable,
            onClick: () => void requestPaste(),
          },
          { label: '', separator: true },
          {
            label: '复制整行 JSON',
            icon: <FileJson size={13} />,
            onClick: () => copyRowJson(cellMenu.row),
          },
          {
            label: '复制整行 INSERT',
            icon: <FileJson size={13} />,
            onClick: () => copyRowInsert(cellMenu.row),
          },
          {
            label: '复制本行 UPDATE',
            icon: <FileJson size={13} />,
            disabled: deleted,
            onClick: () => copyRowUpdate(cellMenu.row),
          },
          { label: '', separator: true },
          {
            label: '行详情',
            icon: <Rows3 size={13} />,
            onClick: () => openDetail(cellMenu.row),
          },
          {
            label: '复制为新行',
            icon: <Copy size={13} />,
            disabled: !editable,
            onClick: () => duplicateRows([cellMenu.row]),
          },
          {
            label: deleted ? '取消删除' : '删除行（暂存）',
            icon: deleted ? <Undo2 size={13} /> : <Trash2 size={13} />,
            danger: !deleted,
            disabled: !editable && !deleted,
            onClick: () => toggleRowDeleted(cellMenu.row),
          },
          { label: '', separator: true },
          {
            label: value === null ? '筛选 NULL' : '按此值筛选',
            icon: <FilterIcon size={13} />,
            onClick: () => filterByCell(cellMenu.row, cellMenu.col),
          },
        ];
      })()
    : [];

  const largeColumn = largeEdit ? columns[largeEdit.col] : null;
  const largeValue = largeEdit ? cellValueAt(largeEdit.row, largeEdit.col) : null;
  const blobColumn = blobView ? columns[blobView.col] : null;
  const blobValue = blobView ? cellValueAt(blobView.row, blobView.col) : null;

  return (
    <div ref={rootRef} className={classNames('data-view', savingBatch && 'is-saving')}>
      <div className="data-toolbar">
        <button
          type="button"
          className="btn"
          onClick={addDraft}
          disabled={!editable || savingBatch}
          title={editable ? '添加一行待保存的草稿行' : readOnlyReason ?? ''}
        >
          <Plus size={14} />
          新增行
        </button>
        <button
          type="button"
          className="btn"
          onClick={stageDelete}
          disabled={!editable || savingBatch || (selectedCount === 0 && !selection)}
          title="标记选中行为待删除，保存后生效"
        >
          <Trash2 size={14} />
          删除
          {selectedCount > 0 ? <span className="btn-count">{selectedCount}</span> : null}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => duplicateRows()}
          disabled={!editable || savingBatch || (selectedCount === 0 && !selection)}
          title="把选中行复制为待保存的新行"
        >
          <Copy size={14} />
          复制行
        </button>
        <div className="toolbar-divider" />
        <button
          type="button"
          className={classNames('btn', filterOpen && 'btn-active')}
          onClick={openFilterPanel}
        >
          <FilterIcon size={14} />
          筛选
          {filters.length > 0 ? <span className="btn-count">{filters.length}</span> : null}
        </button>
        <button
          type="button"
          ref={columnsButtonRef}
          className={classNames('btn', columnsPanel && 'btn-active')}
          onClick={() => setColumnsPanel((value) => !value)}
          title="显示/隐藏列、调整列顺序"
        >
          <Columns3 size={14} />
          列
          {prefs.hidden.length > 0 ? <span className="btn-count">{prefs.hidden.length}</span> : null}
        </button>
        <button type="button" className="btn" onClick={() => guardDirty(refresh)} disabled={loading || savingBatch}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          刷新
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => guardDirty(() => setImportOpen(true))}
          disabled={!editable || savingBatch || !driverSupportsImportExport(connection.driver)}
          title={
            !driverSupportsImportExport(connection.driver)
              ? `${connection.driver === 'mongodb' ? 'MongoDB' : '当前数据库'} 不支持 CSV 导入`
              : editable ? '导入 CSV：支持列映射、编码与空值策略' : readOnlyReason ?? ''
          }
        >
          <Upload size={14} />
          导入
        </button>
        <div className="toolbar-spacer" />
        <span className="table-total">
          共 <strong>{formatNumber(total)}</strong> 行
        </span>
        <Dropdown
          align="right"
          trigger={
            <button type="button" className="btn" title="导出数据">
              <Download size={14} />
              导出
            </button>
          }
          items={[
            {
              label: '导出整表 CSV',
              icon: <FileSpreadsheet size={14} />,
              onClick: () => {
                downloadUrl(api.exportUrl(connection.id, target, 'csv'));
                toast('success', '已开始下载 CSV 文件');
              },
            },
            {
              label: '导出整表 JSON',
              icon: <FileJson size={14} />,
              onClick: () => {
                downloadUrl(api.exportUrl(connection.id, target, 'json'));
                toast('success', '已开始下载 JSON 文件');
              },
            },
            { label: '', separator: true },
            {
              label: '导出当前筛选 CSV',
              icon: <FileSpreadsheet size={14} />,
              disabled: filters.length === 0 && !sort,
              onClick: () => {
                downloadUrl(
                  api.exportUrl(connection.id, target, 'csv', {
                    filters,
                    sortColumn: sort?.column,
                    sortDir: sort?.dir,
                  }),
                );
                toast('success', '已按当前筛选下载 CSV 文件');
              },
            },
            {
              label: '导出当前筛选 JSON',
              icon: <FileJson size={14} />,
              disabled: filters.length === 0 && !sort,
              onClick: () => {
                downloadUrl(
                  api.exportUrl(connection.id, target, 'json', {
                    filters,
                    sortColumn: sort?.column,
                    sortDir: sort?.dir,
                  }),
                );
                toast('success', '已按当前筛选下载 JSON 文件');
              },
            },
          ]}
        />
      </div>

      {dirtyCount > 0 ? (
        <div className="bulk-edit-bar">
          <span className="dirty-dot" />
          <strong>{dirtyCount} 处未保存</strong>
          <span className="bulk-edit-breakdown">
            {dirtyCellCount > 0 ? `${dirtyCellCount} 处修改` : ''}
            {drafts.length > 0 ? `${dirtyCellCount > 0 ? ' · ' : ''}${drafts.length} 行新增` : ''}
            {deletedRows.size > 0 ? `${dirtyCellCount > 0 || drafts.length > 0 ? ' · ' : ''}${deletedRows.size} 行删除` : ''}
          </span>
          <span className="bulk-edit-hint">Ctrl+S 保存</span>
          <div className="toolbar-spacer" />
          <button type="button" className="btn btn-ghost" onClick={discardAll} disabled={savingBatch}>
            <Undo2 size={13} />
            放弃
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void saveAll()} disabled={savingBatch}>
            {savingBatch ? <Spinner /> : <Save size={13} />}
            保存
          </button>
        </div>
      ) : null}

      {columnsPanel ? (
        <div className="columns-panel" ref={columnsPanelRef}>
          <div className="columns-panel-head">
            <span>
              <Columns3 size={13} /> 显示列与顺序
            </span>
            <button type="button" className="icon-btn" onClick={() => setColumnsPanel(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="columns-panel-list">
            {orderedColumns.map((column) => (
              <label className="columns-panel-item" key={column.name}>
                <input
                  type="checkbox"
                  checked={!prefs.hidden.includes(column.name)}
                  onChange={() => toggleColumnHidden(column.name)}
                />
                <span>{column.name}</span>
                <small>{column.columnType || column.dataType}</small>
              </label>
            ))}
          </div>
          <div className="columns-panel-actions">
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => setPrefs((current) => ({ ...current, hidden: [] }))}
            >
              全部显示
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => setPrefs((current) => ({ ...current, widths: {} }))}
            >
              重置列宽
            </button>
          </div>
          <p className="columns-panel-tip">拖动表头左侧的手柄可调整列顺序；拖动表头右边缘可调整列宽。</p>
        </div>
      ) : null}

      {filterOpen ? (
        <div className="filter-panel">
          <div className="filter-panel-head">
            <span>
              <FilterIcon size={13} /> 筛选条件
            </span>
            <button type="button" className="icon-btn" onClick={() => setFilterOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="filter-rows">
            {draftFilters.length === 0 ? (
              <div className="filter-empty">尚未添加条件，点击「添加条件」开始筛选。</div>
            ) : (
              draftFilters.map((filter, index) => (
                <div className="filter-row" key={index}>
                  <select
                    className="select select-compact"
                    value={filter.column}
                    onChange={(event) => updateDraft(index, { column: event.target.value })}
                  >
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select select-compact"
                    value={filter.operator}
                    onChange={(event) => updateDraft(index, { operator: event.target.value })}
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {operator.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input input-compact"
                    value={filter.value}
                    onChange={(event) => updateDraft(index, { value: event.target.value })}
                    placeholder="筛选值"
                    disabled={!operatorNeedsValue(filter.operator)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') applyFilters();
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn danger-hover"
                    onClick={() => setDraftFilters((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                    title="移除条件"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="filter-actions">
            <button type="button" className="btn btn-ghost" onClick={addFilterRow}>
              <Plus size={13} /> 添加条件
            </button>
            <div className="toolbar-spacer" />
            <button type="button" className="btn" onClick={resetFilters} disabled={filters.length === 0 && draftFilters.length === 0}>
              <FilterX size={13} /> 清空
            </button>
            <button type="button" className="btn btn-primary" onClick={applyFilters}>
              应用筛选
            </button>
          </div>
        </div>
      ) : null}

      {!editable && readOnlyReason ? (
        <div className="readonly-note">
          <Lock size={13} />
          {readOnlyReason}
        </div>
      ) : null}

      {error ? (
        <div className="inline-banner error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => guardDirty(refresh)}>
            重试
          </button>
        </div>
      ) : null}

      <div className="data-grid-wrap">
        {loading && !data ? (
          <div className="center-loading">
            <Spinner size={22} />
            <span>正在读取数据…</span>
          </div>
        ) : visibleColumns.length === 0 ? (
          <EmptyState
            compact
            icon={<Columns3 size={24} />}
            title="所有列都已隐藏"
            description="在“列”面板中勾选需要显示的列。"
            action={
              <button type="button" className="btn" onClick={() => setColumnsPanel(true)}>
                打开列面板
              </button>
            }
          />
        ) : totalRows === 0 ? (
          <EmptyState
            compact
            icon={<Rows3 size={24} />}
            title={filters.length > 0 ? '没有符合条件的数据' : '表里还没有数据'}
            description={filters.length > 0 ? '尝试调整或清空筛选条件。' : editable ? '点击「新增行」插入第一条记录。' : undefined}
            action={
              filters.length > 0 ? (
                <button type="button" className="btn" onClick={resetFilters}>
                  清空筛选
                </button>
              ) : editable ? (
                <button type="button" className="btn btn-primary" onClick={addDraft}>
                  <Plus size={14} /> 新增行
                </button>
              ) : undefined
            }
          />
        ) : (
          <div
            className="grid-scroll table-grid-scroll"
            ref={gridRef}
            tabIndex={0}
            onKeyDown={handleGridKeyDown}
            aria-label="数据网格"
          >
            <table className="data-grid table-data-grid" style={{ width: tableWidth }}>
              <colgroup>
                {editable ? <col style={{ width: 32 }} /> : null}
                <col style={{ width: 46 }} />
                {visibleColumns.map((column) => (
                  <col key={column.name} style={{ width: columnWidth(column) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {editable ? (
                    <th className="checkbox-cell">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={(event) => selectAll(event.target.checked)}
                        aria-label="全选当前页"
                      />
                    </th>
                  ) : null}
                  <th className="row-number-cell">#</th>
                  {visibleColumns.map((column) => {
                    const colIndex = columnIndexMap.get(column.name) ?? 0;
                    const selectedInfo = selectionInfo(selection);
                    const selectedCols = selectedInfo?.cols ?? [];
                    const columnSelected = selectedCols.includes(colIndex);
                    return (
                      <th
                        key={column.name}
                        data-column={column.name}
                        onClick={() => {
                          if (resizingRef.current) return;
                          toggleSort(column.name);
                        }}
                        onDragOver={(event) => {
                          if (dragColumnRef.current && dragColumnRef.current !== column.name) {
                            event.preventDefault();
                            setDragOverColumn(column.name);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverColumn === column.name) setDragOverColumn(null);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const from = dragColumnRef.current;
                          dragColumnRef.current = null;
                          setDragOverColumn(null);
                          if (from) reorderColumn(from, column.name);
                        }}
                        className={classNames(
                          'sortable-th',
                          sort?.column === column.name && 'sorted',
                          columnSelected && 'column-selected',
                          dragOverColumn === column.name && 'column-drop-target',
                        )}
                        style={{ width: columnWidth(column) }}
                        title={`${column.columnType} · 点击排序`}
                      >
                        <span className="column-head">
                          <span
                            className="col-grip"
                            draggable
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onDragStart={(event) => {
                              dragColumnRef.current = column.name;
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', column.name);
                            }}
                            onDragEnd={() => {
                              dragColumnRef.current = null;
                              setDragOverColumn(null);
                            }}
                            title="拖动调整列顺序"
                          >
                            <GripVertical size={10} />
                          </span>
                          <span className="column-name-text">{column.name}</span>
                          {meta.primaryKey.includes(column.name) ? <KeyRound size={11} className="pk-icon" /> : null}
                          {column.nullable ? <span className="nullable-dot" title="允许 NULL" /> : null}
                          <span className="sort-icon">
                            {sort?.column !== column.name ? (
                              <ArrowUpDown size={11} />
                            ) : sort.dir === 'asc' ? (
                              <ArrowUp size={11} />
                            ) : (
                              <ArrowDown size={11} />
                            )}
                          </span>
                          <span
                            className="col-resize"
                            onMouseDown={(event) => startResize(event, column)}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              resetColumnWidth(column);
                            }}
                            onClick={(event) => event.stopPropagation()}
                            title="拖动调整列宽，双击恢复默认"
                          />
                        </span>
                        <small>{column.columnType}</small>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: totalRows }, (_, rowIndex) => {
                  const isDraft = rowIndex >= rows.length;
                  const draft = isDraft ? drafts[rowIndex - rows.length] : null;
                  const isDeleted = isRowDeleted(rowIndex);
                  const absRowNumber = (page - 1) * pageSize + rowIndex + 1;
                  const info = selectionInfo(selection);
                  return (
                    <tr
                      key={rowIdAt(rowIndex)}
                      className={classNames(
                        isDraft && 'row-draft',
                        isDeleted && 'row-deleted',
                        !isDraft && selected.has(rowIndex) && 'selected',
                      )}
                    >
                      {editable ? (
                        <td className="checkbox-cell">
                          {isDraft ? (
                            <span className="draft-new-dot" title="待新增行" />
                          ) : (
                            <input
                              type="checkbox"
                              checked={selected.has(rowIndex)}
                              onChange={() => toggleRow(rowIndex)}
                              aria-label="选择行"
                            />
                          )}
                        </td>
                      ) : null}
                      <td
                        className={classNames('row-number-cell', isDraft && 'draft-row-number')}
                        onDoubleClick={() => openDetail(rowIndex)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setSelection({
                            anchorRow: rowIndex,
                            anchorCol: visibleIndexes[0] ?? 0,
                            row: rowIndex,
                            col: visibleIndexes[0] ?? 0,
                          });
                          setCellMenu({
                            x: event.clientX,
                            y: event.clientY,
                            row: rowIndex,
                            col: visibleIndexes[0] ?? 0,
                          });
                        }}
                        title="双击查看行详情；右键更多操作"
                      >
                        {isDraft ? (
                          <span className="draft-badge">新</span>
                        ) : isDeleted ? (
                          <span className="deleted-badge">删</span>
                        ) : (
                          formatNumber(absRowNumber)
                        )}
                      </td>
                      {visibleColumns.map((column) => {
                        const colIndex = columnIndexMap.get(column.name) ?? 0;
                        const value = cellValueAt(rowIndex, colIndex);
                        const isEditing = editing?.row === rowIndex && editing.col === colIndex;
                        const cellDirty = isDraft
                          ? Boolean(draft && Object.prototype.hasOwnProperty.call(draft.values, column.name))
                          : Boolean(pending.get(`${page}:${rowIndex}`)?.has(colIndex));
                        const blankDraft = Boolean(draft && !Object.prototype.hasOwnProperty.call(draft.values, column.name));
                        const selectedCell = Boolean(
                          info &&
                            rowIndex >= info.minRow &&
                            rowIndex <= info.maxRow &&
                            info.cols.includes(colIndex),
                        );
                        const anchorCell = Boolean(
                          selection &&
                            selection.anchorRow === rowIndex &&
                            selection.anchorCol === colIndex,
                        );
                        const editableCell =
                          editable &&
                          !column.generated &&
                          !isBinaryColumn(column) &&
                          !(connection.driver === 'mongodb' && column.name === '_id');
                        const binary = isBinaryColumn(column);
                        const blob = binary ? blobInfo(value) : null;
                        const longText = isLongTextColumn(column);
                        const displayValue = value === null ? '' : String(value);
                        return (
                          <td
                            key={column.name}
                            data-row={rowIndex}
                            data-col={colIndex}
                            data-column={column.name}
                            className={classNames(
                              isNumericType(column.columnType) && 'numeric-cell',
                              editableCell && 'editable-cell',
                              selectedCell && 'cell-selected',
                              anchorCell && 'cell-anchor',
                              cellDirty && 'cell-pending',
                              isDeleted && 'cell-deleted',
                              binary && 'cell-binary',
                              isBooleanColumn(column) && 'cell-boolean',
                              longText && 'cell-long-text',
                            )}
                            onMouseDown={(event) => {
                              if (event.button !== 0) return;
                              const node = event.target as HTMLElement;
                              if (node.closest('input, select, textarea, button, a')) return;
                              draggingRef.current = true;
                              setSelection((current) => {
                                if (event.shiftKey && current) return { ...current, row: rowIndex, col: colIndex };
                                return {
                                  anchorRow: rowIndex,
                                  anchorCol: colIndex,
                                  row: rowIndex,
                                  col: colIndex,
                                };
                              });
                              gridRef.current?.focus({ preventScroll: true });
                            }}
                            onMouseEnter={() => {
                              if (!draggingRef.current) return;
                              setSelection((current) =>
                                current ? { ...current, row: rowIndex, col: colIndex } : current,
                              );
                            }}
                            onDoubleClick={(event) => {
                              const node = event.target as HTMLElement;
                              if (node.closest('input, select, textarea, button, a')) return;
                              openCellEditor(rowIndex, colIndex);
                            }}
                            onContextMenu={(event) => {
                              const node = event.target as HTMLElement;
                              if (node.closest('input, select, textarea')) return;
                              event.preventDefault();
                              const info = selectionInfo(selection);
                              const insideSelection = Boolean(
                                info &&
                                  rowIndex >= info.minRow &&
                                  rowIndex <= info.maxRow &&
                                  info.cols.includes(colIndex),
                              );
                              if (!insideSelection) {
                                setSelection({
                                  anchorRow: rowIndex,
                                  anchorCol: colIndex,
                                  row: rowIndex,
                                  col: colIndex,
                                });
                              }
                              setCellMenu({ x: event.clientX, y: event.clientY, row: rowIndex, col: colIndex });
                            }}
                            title={
                              binary
                                ? `${column.name} · BLOB ${formatByteSize(blob?.size ?? 0)}`
                                : value === null
                                  ? 'NULL'
                                  : displayValue.slice(0, 500)
                            }
                          >
                            {isEditing ? (
                              <CellEditor
                                column={column}
                                driver={connection.driver}
                                initial={value}
                                seed={editing.seed}
                                onCommit={(nextValue, move) => finishCellEdit(nextValue, move)}
                                onCancel={() => {
                                  setEditing(null);
                                  focusGrid();
                                }}
                              />
                            ) : blankDraft ? (
                              <span className="draft-placeholder">使用默认值</span>
                            ) : binary ? (
                              <span className="blob-cell">
                                <Eye size={10} />
                                BLOB · {formatByteSize(blob?.size ?? 0)}
                              </span>
                            ) : value === null ? (
                              <span className="null-badge">NULL</span>
                            ) : (
                              <span className={classNames('cell-value', isJsonColumn(column) && 'mono-value')}>
                                {displayValue}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {loading && data ? (
          <div className="grid-loading-bar">
            <span />
          </div>
        ) : null}
      </div>

      <div className="pagination-bar">
        <div className="pagination-info">
          {total === 0
            ? '没有数据'
            : `第 ${formatNumber((page - 1) * pageSize + 1)}–${formatNumber(Math.min(page * pageSize, total))} 行`}
          {' · '}共 {formatNumber(total)} 行
          {selectedCount > 0 ? ` · 已选 ${formatNumber(selectedCount)} 行` : ''}
          {drafts.length > 0 ? ` · 新增 ${drafts.length} 行待保存` : ''}
        </div>
        <div className="pagination-actions">
          <select
            className="select select-compact"
            value={pageSize}
            onChange={(event) => {
              const next = Number(event.target.value);
              guardDirty(() => {
                setPageSize(next);
                setPage(1);
              });
            }}
            title="每页行数"
            disabled={savingBatch}
          >
            {[50, 100, 200, 500].map((size) => (
              <option key={size} value={size}>
                {size} 行/页
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn"
            disabled={page <= 1 || savingBatch}
            onClick={() => guardDirty(() => setPage(1))}
            title="第一页"
          >
            <ChevronsLeft size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={page <= 1 || savingBatch}
            onClick={() => guardDirty(() => setPage((value) => Math.max(1, value - 1)))}
            title="上一页"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="page-indicator">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="icon-btn"
            disabled={page >= totalPages || savingBatch}
            onClick={() => guardDirty(() => setPage((value) => Math.min(totalPages, value + 1)))}
            title="下一页"
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={page >= totalPages || savingBatch}
            onClick={() => guardDirty(() => setPage(totalPages))}
            title="最后一页"
          >
            <ChevronsRight size={15} />
          </button>
        </div>
      </div>

      <div className="view-statusbar">
        <span>
          {lastLoaded ? `更新于 ${new Date(lastLoaded).toLocaleTimeString('zh-CN', { hour12: false })}` : '尚未加载'}
        </span>
        {selectionStats ? (
          <span className="selection-status">
            选区 {selectionStats.label} · {formatNumber(selectionStats.cells)} 格 · 非空 {formatNumber(selectionStats.nonNull)}
            {selectionStats.numericCount > 0
              ? ` · 合计 ${formatNumber(selectionStats.sum)} · 平均 ${formatNumber(
                  selectionStats.sum / selectionStats.numericCount,
                )}`
              : ''}
          </span>
        ) : null}
        <span className="statusbar-spacer" />
        {sort ? <span>排序：{sort.column} {sort.dir === 'asc' ? '升序' : '降序'}</span> : null}
        {filters.length > 0 ? <span>筛选：{filters.length} 个条件</span> : null}
        {dirtyCount > 0 ? <span className="dirty-status">{dirtyCount} 处未保存</span> : null}
        <span>{editable ? '可编辑' : '只读'}</span>
      </div>

      {cellMenu ? (
        <ContextMenu x={cellMenu.x} y={cellMenu.y} items={cellMenuItems} onClose={() => setCellMenu(null)} />
      ) : null}

      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="粘贴数据"
        subtitle="支持从 Excel / Navicat / 文本中复制的制表符或 CSV 内容"
        width={620}
        footer={
          <>
            <div className="modal-footer-spacer" />
            <button type="button" className="btn" onClick={() => setPasteOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={applyPasteDialog} disabled={!pasteText.trim()}>
              解析并粘贴
            </button>
          </>
        }
      >
        <textarea
          className="paste-textarea"
          value={pasteText}
          autoFocus
          spellCheck={false}
          placeholder={'每列使用 Tab 分隔，每行一条记录\n例如：\nAlice\t28\tShanghai\nBob\t31\tBeijing'}
          onChange={(event) => setPasteText(event.target.value)}
        />
        <p className="paste-hint">
          粘贴内容会先进入待保存状态，点击“保存”或按 Ctrl+S 后才会写入数据库；单值粘贴可填充当前选区。
        </p>
      </Modal>

      <ImportCsvDialog
        open={importOpen}
        connection={connection}
        meta={meta}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setSelected(new Set());
          onRefreshMeta();
        }}
      />

      <LargeTextModal
        open={Boolean(largeEdit)}
        column={largeColumn}
        value={largeValue}
        title={largeEdit ? `${meta.name} · ${largeColumn?.name ?? ''}` : ''}
        onClose={() => setLargeEdit(null)}
        onCommit={(value) => {
          if (largeEdit) stageCell(largeEdit.row, largeEdit.col, value);
        }}
        onCopy={(text, message) => void copyText(text, message)}
      />

      <BlobViewerModal
        open={Boolean(blobView)}
        column={blobColumn}
        value={blobValue}
        filename={`${safeFileName(meta.name)}-${safeFileName(blobColumn?.name ?? 'blob')}.bin`}
        onClose={() => setBlobView(null)}
      />

      {detailInfo ? (
        <RowDetailDrawer
          open
          driver={connection.driver}
          columns={columns}
          primaryKey={meta.primaryKey}
          title={detailInfo.title}
          subtitle={detailInfo.subtitle}
          values={detailInfo.values}
          original={detailInfo.original}
          changedColumns={detailInfo.changed}
          deleted={detailInfo.deleted}
          dirtyCount={dirtyCount}
          saving={savingBatch}
          onClose={() => setDetail(null)}
          onChange={(name, value) => {
            const colIndex = columnIndexMap.get(name);
            if (colIndex === undefined) return;
            if (detail?.kind === 'draft' && detail.draftId) toggleDraftValue(detail.draftId, name, value);
            else stageCell(detailInfo.rowIndex, colIndex, value);
          }}
          onSave={() => void saveAll()}
          onCopyJson={() => copyRowJson(detailInfo.rowIndex)}
          onCopyInsert={() => copyRowInsert(detailInfo.rowIndex)}
          onOpenBlob={(column) => {
            const colIndex = columnIndexMap.get(column.name);
            if (colIndex !== undefined) setBlobView({ row: detailInfo.rowIndex, col: colIndex });
          }}
          onOpenLarge={(column) => {
            const colIndex = columnIndexMap.get(column.name);
            if (colIndex !== undefined) setLargeEdit({ row: detailInfo.rowIndex, col: colIndex });
          }}
          onToggleDelete={() => toggleRowDeleted(detailInfo.rowIndex)}
        />
      ) : null}
    </div>
  );
}
