import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { MSSQL, MariaSQL, MySQL, PLSQL, PostgreSQL, SQLite, StandardSQL, sql } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useAppStore } from '../store/appStore';
import type { Driver } from '../types';

export interface SqlEditorHandle {
  getSelectedSql: () => string;
}

const naviDarkTheme = EditorView.theme(
  {
    '&': { color: '#ccd5e3', backgroundColor: 'transparent' },
    '.cm-content': { caretColor: '#f0a33d' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f0a33d' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#3b3222',
    },
    '.cm-activeLine': { backgroundColor: '#181c23' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#59616e', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: '#1b1f27', color: '#aeb7c4' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px' },
  },
  { dark: true },
);

const naviLightTheme = EditorView.theme(
  {
    '&': { color: '#24292f', backgroundColor: 'transparent' },
    '.cm-content': { caretColor: '#b86e00' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#b86e00' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#ffe9c9',
    },
    '.cm-activeLine': { backgroundColor: '#f6f8fa' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#96a0ad', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: '#f1f4f8', color: '#5c6673' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px' },
  },
  { dark: false },
);

const naviDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff9e64', fontWeight: '600' },
  { tag: tags.operatorKeyword, color: '#ffb86b' },
  { tag: tags.definitionKeyword, color: '#c7a9ff' },
  { tag: tags.string, color: '#9ed072' },
  { tag: tags.special(tags.string), color: '#d7ba7d' },
  { tag: tags.number, color: '#ffd479' },
  { tag: tags.bool, color: '#ffb86b' },
  { tag: tags.null, color: '#ff966c', fontStyle: 'italic' },
  { tag: tags.comment, color: '#727e8f', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#727e8f', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#727e8f', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#d7dfec' },
  { tag: tags.propertyName, color: '#c5d0e2' },
  { tag: tags.typeName, color: '#7dcfff' },
  { tag: tags.className, color: '#ffcb6b' },
  { tag: tags.function(tags.variableName), color: '#82aaff' },
  { tag: tags.function(tags.propertyName), color: '#82aaff' },
  { tag: tags.operator, color: '#89ddff' },
  { tag: tags.punctuation, color: '#9ba6b4' },
  { tag: tags.invalid, color: '#ff6b6b' },
]);

const naviLightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#a1470b', fontWeight: '600' },
  { tag: tags.operatorKeyword, color: '#a1470b' },
  { tag: tags.definitionKeyword, color: '#7c3aed' },
  { tag: tags.string, color: '#2f7d32' },
  { tag: tags.special(tags.string), color: '#8a5a00' },
  { tag: tags.number, color: '#a15100' },
  { tag: tags.bool, color: '#a15100' },
  { tag: tags.null, color: '#9a3412', fontStyle: 'italic' },
  { tag: tags.comment, color: '#8a93a1', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#8a93a1', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#8a93a1', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#2b3240' },
  { tag: tags.propertyName, color: '#3d4655' },
  { tag: tags.typeName, color: '#0f6e8c' },
  { tag: tags.className, color: '#8a5a00' },
  { tag: tags.function(tags.variableName), color: '#6644c4' },
  { tag: tags.function(tags.propertyName), color: '#6644c4' },
  { tag: tags.operator, color: '#0f6e8c' },
  { tag: tags.punctuation, color: '#697386' },
  { tag: tags.invalid, color: '#d54848' },
]);

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  driver: Driver;
  schema?: Record<string, string[]>;
  onRun?: (selectedSql?: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, driver, schema, onRun, readOnly = false, placeholder = '输入 SQL，Ctrl/⌘ + Enter 执行' },
  ref,
) {
  const theme = useAppStore((state) => state.theme);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo(() => {
    const dialect =
      driver === 'mysql' ? MySQL
        : driver === 'mariadb' ? MariaSQL
          : driver === 'postgres' ? PostgreSQL
            : driver === 'sqlserver' ? MSSQL
              : driver === 'oracle' ? PLSQL
              : driver === 'snowflake' ? StandardSQL
                : SQLite;
    return [
      sql({
        dialect,
        schema: schema ?? {},
        upperCaseKeywords: true,
      }),
      syntaxHighlighting(theme === 'dark' ? naviDarkHighlight : naviLightHighlight),
    ];
  }, [driver, schema, theme]);

  useImperativeHandle(
    ref,
    () => ({
      getSelectedSql: () => {
        const view = editorRef.current?.view;
        if (!view) return '';
        const selection = view.state.selection.main;
        if (selection.empty) return '';
        return view.state.sliceDoc(selection.from, selection.to);
      },
    }),
    [],
  );

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const view = editorRef.current?.view;
      let selected = '';
      if (view) {
        const range = view.state.selection.main;
        if (!range.empty) selected = view.state.sliceDoc(range.from, range.to);
      }
      onRun?.(selected.trim() ? selected : undefined);
    }
  };

  return (
    <div className="sql-editor" onKeyDownCapture={handleKeyDown}>
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={theme === 'dark' ? naviDarkTheme : naviLightTheme}
        height="100%"
        readOnly={readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          highlightSelectionMatches: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
        }}
      />
    </div>
  );
});
