import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { CellValue, ColumnInfo, Driver } from '../types';
import {
  booleanValue,
  coerceInputValue,
  dateInputKind,
  dateInputToCell,
  dateInputValue,
  enumOptions,
  isBooleanColumn,
  isSetColumn,
} from '../lib/grid';

type MoveDirection = 'down' | 'right' | 'left' | 'up' | 'none';

const NULL_OPTION = '__navideck_null__';
const EMPTY_OPTION = '__navideck_empty__';

export function CellEditor({
  column,
  driver,
  initial,
  seed,
  onCommit,
  onCancel,
}: {
  column: ColumnInfo;
  driver: Driver;
  initial: CellValue;
  seed?: string;
  onCommit: (value: CellValue, move: MoveDirection) => void;
  onCancel: () => void;
}) {
  const options = enumOptions(column);
  const enumColumn = options.length > 0 && !isSetColumn(column);
  const kind = dateInputKind(driver, column);
  const dateValue = kind ? dateInputValue(initial, kind) : null;
  const boolean = isBooleanColumn(column);
  const initialText = initial === null ? '' : String(initial);
  const enumInitial = initial === null ? (column.nullable ? NULL_OPTION : EMPTY_OPTION) : initial === '' ? EMPTY_OPTION : String(initial);
  const [value, setValue] = useState(
    seed ??
      (boolean
        ? initial === null
          ? ''
          : String(booleanValue(initial))
        : enumColumn
          ? enumInitial
          : dateValue ?? initialText),
  );
  const settled = useRef(false);

  const finish = (move: MoveDirection, nextValue?: CellValue) => {
    if (settled.current) return;
    settled.current = true;
    let result: CellValue;
    if (nextValue !== undefined) {
      result = nextValue;
    } else if (boolean) {
      result = value === '' ? null : value === 'true';
    } else if (enumColumn) {
      result = value === NULL_OPTION ? null : value === EMPTY_OPTION ? '' : value;
    } else if (kind && dateValue !== null) {
      result = value === '' ? '' : dateInputToCell(kind, value);
    } else {
      result = coerceInputValue(column, value);
    }
    if (seed !== undefined) {
      onCommit(result, move);
      return;
    }
    if (boolean) {
      const unchanged = initial === null ? value === '' : booleanValue(initial) === (value === 'true');
      onCommit(unchanged ? initial : result, move);
      return;
    }
    if (enumColumn) {
      onCommit(value === enumInitial ? initial : result, move);
      return;
    }
    if (kind && dateValue !== null) {
      onCommit(value === dateValue ? initial : result, move);
      return;
    }
    const original = initial === null ? '' : String(initial);
    onCommit(value === original ? initial : result, move);
  };

  const handleKey = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      settled.current = true;
      onCancel();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      finish('down');
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      finish(event.shiftKey ? 'left' : 'right');
      return;
    }
    const plainText = !boolean && !enumColumn && !(kind && dateValue !== null);
    if (event.key === 'ArrowUp' && plainText) {
      event.preventDefault();
      finish('up');
    } else if (event.key === 'ArrowDown' && plainText) {
      event.preventDefault();
      finish('down');
    }
  };

  const sharedProps = {
    autoFocus: true,
    className: 'grid-cell-editor',
    onBlur: () => finish('none'),
    onKeyDown: handleKey,
    'data-grid-editor': 'true',
  };

  if (boolean) {
    return (
      <select {...sharedProps} value={value} onChange={(event) => setValue(event.target.value)}>
        {column.nullable ? <option value="">NULL</option> : null}
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (enumColumn) {
    const list = [...options];
    if (value !== '' && value !== NULL_OPTION && value !== EMPTY_OPTION && !list.includes(value)) list.unshift(value);
    return (
      <select {...sharedProps} value={value} onChange={(event) => setValue(event.target.value)}>
        {column.nullable ? <option value={NULL_OPTION}>NULL</option> : null}
        <option value={EMPTY_OPTION}>（空字符串）</option>
        {list.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (kind && dateValue !== null) {
    return (
      <input
        {...sharedProps}
        type={kind === 'datetime' ? 'datetime-local' : kind}
        step={kind === 'date' ? undefined : 1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  }

  return (
    <input
      {...sharedProps}
      type="text"
      inputMode="text"
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => {
        if (seed === undefined) event.currentTarget.select();
      }}
    />
  );
}
