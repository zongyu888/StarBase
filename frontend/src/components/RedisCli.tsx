import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Eraser, Play, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../store/appStore';
import { Spinner } from './ui';

interface CliEntry {
  id: number;
  command: string;
  output: string;
  error?: boolean;
}

const WRITE_COMMANDS = new Set([
  'set', 'setnx', 'setex', 'psetex', 'mset', 'msetnx', 'append', 'incr', 'decr', 'incrby', 'decrby',
  'del', 'unlink', 'hset', 'hmset', 'hdel', 'hincrby', 'lpush', 'rpush', 'lpop', 'rpop', 'lset',
  'lrem', 'ltrim', 'sadd', 'srem', 'spop', 'zadd', 'zrem', 'zincrby', 'xadd', 'xdel', 'xtrim',
  'expire', 'pexpire', 'expireat', 'persist', 'rename', 'renamenx', 'flushdb', 'flushall',
]);

function isWriteCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return WRITE_COMMANDS.has(first);
}

export function RedisCli({
  connectionId,
  database,
  onChanged,
  onClose,
}: {
  connectionId: string;
  database: string;
  onChanged: (command: string) => void;
  onClose: () => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const [command, setCommand] = useState('');
  const [entries, setEntries] = useState<CliEntry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(1);
  const storageKey = `navideck.redisCli.${connectionId}.${database}`;

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      setHistory(Array.isArray(stored) ? stored.filter((item) => typeof item === 'string') : []);
    } catch {
      setHistory([]);
    }
    setEntries([]);
    setCommand('');
    setHistoryIndex(-1);
    inputRef.current?.focus();
  }, [storageKey]);

  const pushHistory = (value: string) => {
    setHistory((current) => {
      const next = [value, ...current.filter((item) => item !== value)].slice(0, 60);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const execute = async (raw?: string) => {
    const value = (raw ?? command).trim();
    if (!value || running) return;
    setRunning(true);
    setCommand('');
    setHistoryIndex(-1);
    pushHistory(value);
    try {
      const response = await api.redisCommand(connectionId, database, value);
      const result = response.result;
      const output =
        typeof result === 'string'
          ? result
          : result === null || result === undefined
            ? '(nil)'
            : JSON.stringify(result, null, 2);
      setEntries((current) => [
        ...current,
        { id: seq.current++, command: value, output },
      ].slice(-100));
      if (isWriteCommand(value)) onChanged(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEntries((current) => [
        ...current,
        { id: seq.current++, command: value, output: message, error: true },
      ].slice(-100));
      toast('error', 'Redis 命令执行失败', message);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  };

  const moveHistory = (direction: -1 | 1) => {
    if (history.length === 0) return;
    const nextIndex = Math.max(-1, Math.min(history.length - 1, historyIndex + direction));
    setHistoryIndex(nextIndex);
    setCommand(nextIndex >= 0 ? history[nextIndex] : '');
  };

  return (
    <div className="redis-cli">
      <header className="redis-cli-head">
        <div>
          <strong>Redis CLI</strong>
          <span>DB {database} · 支持引号与转义，Enter 执行，↑/↓ 查看历史</span>
        </div>
        <div className="redis-cli-head-actions">
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setEntries([])} disabled={entries.length === 0}>
            <Eraser size={12} /> 清空
          </button>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭 CLI">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="redis-cli-output" onClick={() => inputRef.current?.focus()}>
        {entries.length === 0 ? (
          <div className="redis-cli-hint">
            <p>在当前数据库中执行任意 Redis 命令。</p>
            <div>
              {['GET user:1:name', 'HGETALL user:1', 'INFO server', 'SCAN 0 COUNT 20'].map((example) => (
                <button key={example} type="button" className="redis-cli-example" onClick={() => { setCommand(example); inputRef.current?.focus(); }}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((entry) => (
            <div className="redis-cli-entry" key={entry.id}>
              <div className="redis-cli-command">
                <span>DB{database}&gt;</span> {entry.command}
              </div>
              <pre className={entry.error ? 'error' : ''}>{entry.output}</pre>
            </div>
          ))
        )}
      </div>
      <div className="redis-cli-input">
        <span className="redis-cli-prompt">DB{database}&gt;</span>
        <input
          ref={inputRef}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void execute();
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveHistory(-1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveHistory(1);
            }
          }}
          placeholder="输入 Redis 命令…"
          spellCheck={false}
          disabled={running}
        />
        <button type="button" className="btn btn-small btn-primary" onClick={() => void execute()} disabled={running || !command.trim()}>
          {running ? <Spinner /> : <Play size={12} />} 执行
          <CornerDownLeft size={11} />
        </button>
      </div>
    </div>
  );
}
