import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  KeyRound,
  Square,
  Trash2,
} from 'lucide-react';
import type { RedisKeyMeta } from '../types';
import {
  buildRedisTree,
  redisTypeClass,
  redisTypeLabel,
  type RedisTreeNode,
} from '../lib/redisTree';
import { classNames } from '../lib/utils';
import { ContextMenu, Spinner } from './ui';
import type { MenuItem } from './ui';

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function RedisKeyTree({
  keys,
  selectedKey,
  loading,
  onSelect,
  onDeleteKeys,
  onDeletePattern,
  onUsePrefix,
  onCopy,
}: {
  keys: RedisKeyMeta[];
  selectedKey?: string;
  loading?: boolean;
  onSelect: (key: string) => void;
  onDeleteKeys: (keys: string[]) => void;
  onDeletePattern: (pattern: string) => void;
  onUsePrefix: (pattern: string) => void;
  onCopy: (text: string) => void;
}) {
  const tree = useMemo(() => buildRedisTree(keys), [keys]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [multi, setMulti] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    setChecked((current) => {
      const available = new Set(keys.map((item) => item.key));
      const next = new Set([...current].filter((key) => available.has(key)));
      return next;
    });
  }, [keys]);

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      const expandAll = keys.length <= 80;
      const visit = (nodes: RedisTreeNode[], depth: number) => {
        for (const node of nodes) {
          if (!node.folder) continue;
          if (expandAll || depth === 0) next.add(node.id);
          if (node.children) visit(node.children, depth + 1);
        }
      };
      visit(tree, 0);
      return next;
    });
  }, [tree, keys.length]);

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const descendantKeys = (node: RedisTreeNode): string[] => {
    if (!node.folder) return node.key ? [node.key.key] : [];
    return (node.children ?? []).flatMap(descendantKeys);
  };

  const folderState = (node: RedisTreeNode): 'all' | 'some' | 'none' => {
    const leafKeys = descendantKeys(node);
    if (leafKeys.length === 0) return 'none';
    let count = 0;
    for (const key of leafKeys) if (checked.has(key)) count += 1;
    if (count === 0) return 'none';
    return count === leafKeys.length ? 'all' : 'some';
  };

  const toggleChecked = (node: RedisTreeNode) => {
    const leafKeys = descendantKeys(node);
    setChecked((current) => {
      const next = new Set(current);
      const all = leafKeys.length > 0 && leafKeys.every((key) => next.has(key));
      for (const key of leafKeys) {
        if (all) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  const showMenu = (event: ReactMouseEvent, node: RedisTreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    const items: MenuItem[] = node.folder
      ? [
          {
            label: '以此前缀筛选',
            icon: <Copy size={13} />,
            onClick: () => onUsePrefix(`${node.fullName}*`),
          },
          {
            label: '加载此前缀',
            icon: <FolderOpen size={13} />,
            onClick: () => onUsePrefix(`${node.fullName}*`),
          },
          { label: '', separator: true },
          {
            label: '删除此前缀下的键',
            icon: <Trash2 size={13} />,
            danger: true,
            onClick: () => onDeletePattern(`${node.fullName}*`),
          },
          {
            label: '复制前缀',
            icon: <Copy size={13} />,
            onClick: () => onCopy(node.fullName),
          },
        ]
      : [
          {
            label: '打开',
            icon: <KeyRound size={13} />,
            onClick: () => node.key && onSelect(node.key.key),
          },
          {
            label: '复制键名',
            icon: <Copy size={13} />,
            onClick: () => node.key && onCopy(node.key.key),
          },
          { label: '', separator: true },
          {
            label: '删除键',
            icon: <Trash2 size={13} />,
            danger: true,
            onClick: () => node.key && onDeleteKeys([node.key.key]),
          },
        ];
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const renderNode = (node: RedisTreeNode, depth: number): ReactNode => {
    if (node.folder) {
      const open = expanded.has(node.id);
      const state = folderState(node);
      return (
        <div key={node.id} className="redis-tree-branch">
          <div
            className="redis-tree-row redis-tree-folder"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => (multi ? toggleChecked(node) : toggleExpanded(node.id))}
            onContextMenu={(event) => showMenu(event, node)}
            title={node.fullName}
          >
            {multi ? (
              <span className="redis-check" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={state === 'all'}
                  ref={(element) => {
                    if (element) element.indeterminate = state === 'some';
                  }}
                  onChange={() => toggleChecked(node)}
                />
              </span>
            ) : (
              <span className="redis-chevron">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
            )}
            <span className="redis-folder-icon">{open ? <FolderOpen size={13} /> : <Folder size={13} />}</span>
            <span className="redis-tree-label">{node.label}</span>
            <span className="redis-tree-count">{node.count ?? 0}</span>
          </div>
          {open ? (node.children ?? []).map((child) => renderNode(child, depth + 1)) : null}
        </div>
      );
    }
    const key = node.key;
    if (!key) return null;
    return (
      <div
        key={node.id}
        className={classNames('redis-tree-row', 'redis-tree-key', selectedKey === key.key && 'selected')}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (multi ? toggleChecked(node) : onSelect(key.key))}
        onContextMenu={(event) => showMenu(event, node)}
        title={`${key.key}\n${redisTypeLabel(key.type)}`}
      >
        {multi ? (
          <span className="redis-check" onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" checked={checked.has(key.key)} onChange={() => toggleChecked(node)} />
          </span>
        ) : (
          <span className="redis-chevron redis-chevron-leaf" />
        )}
        <span className={classNames('redis-type-dot', redisTypeClass(key.type))} />
        <span className="redis-tree-label">{node.label}</span>
      </div>
    );
  };

  return (
    <div className="redis-key-tree">
      <div className="redis-tree-toolbar">
        <span className="redis-tree-total">{keys.length} 个键</span>
        <button
          type="button"
          className={classNames('redis-tree-action', multi && 'active')}
          onClick={() => {
            if (multi) setChecked(new Set());
            setMulti((value) => !value);
          }}
          title={multi ? '退出多选' : '多选键'}
        >
          {multi ? <CheckSquare size={13} /> : <Square size={13} />}
          {multi ? '退出多选' : '多选'}
        </button>
      </div>
      {multi ? (
        <div className="redis-batch-bar">
          <button
            type="button"
            className="redis-batch-select"
            onClick={() => setChecked(new Set(keys.map((item) => item.key)))}
          >
            全选
          </button>
          <span className="redis-batch-count">{checked.size} 已选</span>
          <div className="redis-batch-spacer" />
          <button
            type="button"
            className="btn btn-small btn-danger"
            disabled={checked.size === 0}
            onClick={() => {
              const selected = [...checked];
              setChecked(new Set());
              setMulti(false);
              onDeleteKeys(selected);
            }}
          >
            <Trash2 size={12} /> 删除
          </button>
        </div>
      ) : null}
      <div className="redis-tree-scroll">
        {loading && keys.length === 0 ? (
          <div className="redis-tree-loading">
            <Spinner size={18} />
            <span>正在扫描键…</span>
          </div>
        ) : keys.length === 0 ? (
          <div className="redis-tree-empty">
            <KeyRound size={22} />
            <strong>没有匹配的键</strong>
            <span>调整搜索词或匹配模式后重试</span>
          </div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
