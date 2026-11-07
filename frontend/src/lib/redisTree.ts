// 键树分组算法参考 Another Redis Desktop Manager (MIT, Copyright (c) shibo)，已改写为 TypeScript。
import type { RedisKeyMeta } from '../types';

export type RedisMatchMode = 'contains' | 'prefix' | 'suffix' | 'exact' | 'glob';

export interface RedisTreeNode {
  id: string;
  label: string;
  fullName: string;
  folder: boolean;
  count?: number;
  children?: RedisTreeNode[];
  key?: RedisKeyMeta;
}

interface RawNode {
  keyNode?: RedisKeyMeta;
  children?: Map<string, RawNode>;
}

function escapeRedisGlob(value: string): string {
  return value.replace(/[\\*?[\]]/g, (character) => `\\${character}`);
}

export function buildRedisPattern(term: string, mode: RedisMatchMode): string {
  const value = term.trim();
  if (!value) return '*';
  if (mode === 'glob') return value;
  const escaped = escapeRedisGlob(value);
  switch (mode) {
    case 'prefix':
      return `${escaped}*`;
    case 'suffix':
      return `*${escaped}`;
    case 'exact':
      return escaped;
    default:
      return `*${escaped}*`;
  }
}

export function buildRedisTree(keys: RedisKeyMeta[], separator = ':'): RedisTreeNode[] {
  const root = new Map<string, RawNode>();
  const sep = separator || ':';
  for (const key of keys) {
    const parts = key.key.split(sep);
    let current = root;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        current.set(`${part}\u0000k`, { keyNode: key });
        return;
      }
      const label = part || '[空]';
      let node = current.get(label);
      if (!node) {
        node = { children: new Map() };
        current.set(label, node);
      }
      if (!node.children) node.children = new Map();
      current = node.children;
    });
  }
  return formatTree(root, '', sep);
}

function formatTree(nodes: Map<string, RawNode>, prefix: string, separator: string): RedisTreeNode[] {
  const out: RedisTreeNode[] = [];
  for (const [rawName, node] of nodes) {
    const isKeyName = rawName.endsWith('\u0000k');
    const label = isKeyName ? rawName.slice(0, -2) : rawName;
    if (isKeyName && node.keyNode) {
      out.push({
        id: `key:${node.keyNode.key}`,
        label: label || '[空]',
        fullName: node.keyNode.key,
        folder: false,
        key: node.keyNode,
      });
      continue;
    }
    if (node.children && node.children.size > 0) {
      const fullName = prefix + label + separator;
      const children = formatTree(node.children, fullName, separator);
      const count = children.reduce((sum, child) => sum + (child.folder ? child.count ?? 0 : 1), 0);
      out.push({
        id: `folder:${fullName}`,
        label: label || '[空]',
        fullName,
        folder: true,
        count,
        children,
      });
    }
  }
  out.sort((left, right) => {
    if (left.folder !== right.folder) return left.folder ? -1 : 1;
    return left.label.localeCompare(right.label, 'zh-CN');
  });
  return out;
}

export function redisTypeLabel(type: string): string {
  switch (type) {
    case 'string':
      return 'String';
    case 'hash':
      return 'Hash';
    case 'list':
      return 'List';
    case 'set':
      return 'Set';
    case 'zset':
      return 'ZSet';
    case 'stream':
      return 'Stream';
    default:
      return type || 'Unknown';
  }
}

export function redisTypeClass(type: string): string {
  return `redis-type-${type || 'unknown'}`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  }
  if (totalSeconds < 86400) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  }
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  return hours ? `${days} 天 ${hours} 小时` : `${days} 天`;
}

export function formatRedisTTL(seconds: number): string {
  if (seconds === -2) return '不存在';
  if (seconds < 0) return '永久';
  if (seconds === 0) return '即将过期';
  return formatDuration(seconds);
}

export function formatRedisAvgTTL(milliseconds: number): string {
  if (!milliseconds || milliseconds <= 0) return '0';
  return formatDuration(Math.round(milliseconds / 1000));
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  return formatDuration(seconds);
}

export function formatMemoryValue(value: string | undefined): string {
  if (!value) return '—';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return value;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}
