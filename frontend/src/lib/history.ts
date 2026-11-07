import type { QueryHistoryItem } from '../types';

const HISTORY_PREFIX = 'navideck.queryHistory';
const MAX_ITEMS = 50;

function historyKey(userId?: string): string {
  return `${HISTORY_PREFIX}.${userId || 'local'}`;
}

export function loadHistory(userId?: string): QueryHistoryItem[] {
  try {
    const raw = localStorage.getItem(historyKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushHistory(userId: string | undefined, item: QueryHistoryItem): QueryHistoryItem[] {
  const next = [item, ...loadHistory(userId).filter((entry) => entry.id !== item.id)].slice(0, MAX_ITEMS);
  localStorage.setItem(historyKey(userId), JSON.stringify(next));
  return next;
}

export function clearHistory(userId?: string): void {
  localStorage.removeItem(historyKey(userId));
}

