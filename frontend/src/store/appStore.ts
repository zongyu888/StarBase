import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';
import {
  getAgentToken,
  isAgentMode as isAgentModeEnabled,
  pairAgent as pairAgentApi,
  probeAgent,
  setAgentMode as setAgentModeApi,
} from '../lib/agent';
import { defaultQueryFor, defaultSchemaFor, driverLabel, driverSupportsSQLQuery } from '../lib/utils';
import type { Connection, ObjectType, Tab, Theme } from '../types';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface ConnectionDialogState {
  open: boolean;
  connection?: Connection;
}

interface OpenQueryOptions {
  database?: string;
  schema?: string;
  sql?: string;
  title?: string;
}

interface OpenTableInput {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  objectType: ObjectType;
  mode?: 'data' | 'structure' | 'design';
}

interface OpenRedisOptions {
  database?: string;
  key?: string;
}

interface OpenChromaOptions {
  database?: string;
  collection?: string;
  collectionId?: string;
}

interface AppState {
  connections: Connection[];
  connectionsLoading: boolean;
  version: string;
  tabs: Tab[];
  activeTabId: string;
  theme: Theme;
  maxRows: number;
  querySeq: number;
  connectionDialog: ConnectionDialogState;
  aboutOpen: boolean;
  toasts: Toast[];
  confirm: ConfirmOptions | null;
  dataVersion: number;
  agentAvailable: boolean;
  agentPaired: boolean;
  agentMode: boolean;
  agentVersion: string;

  loadConnections: () => Promise<void>;
  refreshAgent: () => Promise<void>;
  pairAgent: (pin: string) => Promise<void>;
  setAgentMode: (enabled: boolean) => Promise<void>;
  setConnectionConnected: (id: string, connected: boolean) => void;
  setVersion: (version: string) => void;
  openConnectionDialog: (connection?: Connection) => void;
  closeConnectionDialog: () => void;
  openQuery: (connection: Connection, options?: OpenQueryOptions) => string;
  openRedis: (connection: Connection, options?: OpenRedisOptions) => string;
  openChroma: (connection: Connection, options?: OpenChromaOptions) => string;
  openTable: (input: OpenTableInput) => string;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  closeTab: (id: string) => void;
  closeTabsForConnection: (connectionId: string) => void;
  setActiveTab: (id: string) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setMaxRows: (value: number) => void;
  setAboutOpen: (open: boolean) => void;
  toast: (kind: ToastKind, message: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  requestConfirm: (options: ConfirmOptions) => void;
  clearConfirm: () => void;
  bumpData: () => void;
  resetWorkspace: () => void;
}

const welcomeTab: Tab = { id: 'welcome', kind: 'welcome', title: '开始' };

function nextActiveAfterClose(tabs: Tab[], closingId: string, activeId: string): string {
  if (activeId !== closingId) return activeId;
  const index = tabs.findIndex((tab) => tab.id === closingId);
  const remaining = tabs.filter((tab) => tab.id !== closingId);
  if (remaining.length === 0) return 'welcome';
  return remaining[Math.max(0, Math.min(index - 1, remaining.length - 1))].id;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      connections: [],
      connectionsLoading: true,
      version: '',
      tabs: [welcomeTab],
      activeTabId: 'welcome',
      theme: 'dark',
      maxRows: 500,
      querySeq: 0,
      connectionDialog: { open: false },
      aboutOpen: false,
      toasts: [],
      confirm: null,
      dataVersion: 0,
      agentAvailable: false,
      agentPaired: Boolean(getAgentToken()),
      agentMode: isAgentModeEnabled(),
      agentVersion: '',

      loadConnections: async () => {
        set({ connectionsLoading: true });
        try {
          const data = await api.listConnections();
          set({ connections: data.connections, connectionsLoading: false });
        } catch (error) {
          set({ connectionsLoading: false });
          get().toast('error', '加载连接失败', error instanceof Error ? error.message : String(error));
        }
      },

      setConnectionConnected: (id, connected) => {
        set((state) => {
          const existing = state.connections.find((connection) => connection.id === id);
          if (!existing || existing.connected === connected) return {};
          return {
            connections: state.connections.map((connection) =>
              connection.id === id ? { ...connection, connected } : connection,
            ),
          };
        });
      },

      setVersion: (version) => set({ version }),

      openConnectionDialog: (connection) => set({ connectionDialog: { open: true, connection } }),
      closeConnectionDialog: () => set({ connectionDialog: { open: false } }),

      openQuery: (connection, options = {}) => {
        const state = get();
        if (!driverSupportsSQLQuery(connection.driver)) {
          state.toast('info', `${driverLabel(connection.driver)} 不使用 SQL 查询`, '请在对象树中打开集合或键');
          return state.activeTabId;
        }
        const seq = state.querySeq + 1;
        const database = options.database ?? connection.database ?? (connection.driver === 'sqlite' ? 'main' : '');
        const schema = options.schema ?? defaultSchemaFor(connection.driver, connection, database);
        const id = `query:${seq}`;
        const tab: Tab = {
          id,
          kind: 'query',
          title: options.title ?? `查询 ${seq}`,
          connectionId: connection.id,
          database,
          schema,
          sql: options.sql ?? defaultQueryFor(connection, database),
          seq,
        };
        set({
          tabs: [...state.tabs, tab],
          activeTabId: id,
          querySeq: seq,
        });
        return id;
      },

      openRedis: (connection, options = {}) => {
        const database = options.database ?? connection.database ?? '0';
        const id = `redis:${connection.id}:${database}`;
        const state = get();
        const existing = state.tabs.find((tab) => tab.id === id);
        if (existing && existing.kind === 'redis') {
          set({
            activeTabId: id,
            tabs: state.tabs.map((tab) =>
              tab.id === id && options.key ? ({ ...tab, key: options.key } as Tab) : tab,
            ),
          });
          return id;
        }
        const tab: Tab = {
          id,
          kind: 'redis',
          title: `Redis · DB${database}`,
          connectionId: connection.id,
          database,
          key: options.key,
        };
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },

      openTable: (input) => {
        const mode = input.mode ?? 'data';
        const id = `table:${input.connectionId}:${input.database}:${input.schema}:${input.table}`;
        const state = get();
        const existing = state.tabs.find((tab) => tab.id === id);
        if (existing && existing.kind === 'table') {
          const nextMode = input.objectType === 'view' && mode === 'design' ? 'data' : mode;
          set({
            activeTabId: id,
            tabs: state.tabs.map((tab) =>
              tab.id === id ? ({ ...tab, mode: nextMode, objectType: input.objectType } as Tab) : tab,
            ),
          });
          return id;
        }
        const tab: Tab = {
          id,
          kind: 'table',
          title: input.table,
          connectionId: input.connectionId,
          database: input.database,
          schema: input.schema,
          table: input.table,
          objectType: input.objectType,
          mode: input.objectType === 'view' && mode === 'design' ? 'data' : mode,
        };
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },

      openChroma: (connection, options = {}) => {
        const database = options.database ?? connection.database ?? 'default_database';
        const id = `chroma:${connection.id}:${database}`;
        const state = get();
        const existing = state.tabs.find((tab) => tab.id === id);
        if (existing && existing.kind === 'chroma') {
          set({
            activeTabId: id,
            tabs: state.tabs.map((tab) =>
              tab.id === id && tab.kind === 'chroma'
                ? ({
                    ...tab,
                    collection: options.collection ?? tab.collection,
                    collectionId: options.collectionId ?? tab.collectionId,
                    title: options.collection ? `Chroma · ${options.collection}` : tab.title,
                  } as Tab)
                : tab,
            ),
          });
          return id;
        }
        const tab: Tab = {
          id,
          kind: 'chroma',
          title: options.collection ? `Chroma · ${options.collection}` : 'Chroma 工作台',
          connectionId: connection.id,
          database,
          collection: options.collection,
          collectionId: options.collectionId,
        };
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },

      updateTab: (id, patch) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === id ? ({ ...tab, ...patch } as Tab) : tab)),
        }));
      },

      closeTab: (id) => {
        if (id === 'welcome') return;
        const state = get();
        const nextActive = nextActiveAfterClose(state.tabs, id, state.activeTabId);
        const nextTabs = state.tabs.filter((tab) => tab.id !== id);
        set({
          tabs: nextTabs.length > 0 ? nextTabs : [welcomeTab],
          activeTabId: nextTabs.length > 0 ? nextActive : 'welcome',
        });
      },

      closeTabsForConnection: (connectionId) => {
        const state = get();
        const tabs = state.tabs.filter(
          (tab) => tab.kind === 'welcome' || tab.connectionId !== connectionId,
        );
        const activeStillExists = tabs.some((tab) => tab.id === state.activeTabId);
        set({
          tabs: tabs.length > 0 ? tabs : [welcomeTab],
          activeTabId: activeStillExists ? state.activeTabId : 'welcome',
        });
      },

      setActiveTab: (id) => set({ activeTabId: id }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      setMaxRows: (maxRows) => set({ maxRows }),
      setAboutOpen: (aboutOpen) => set({ aboutOpen }),

      refreshAgent: async () => {
        const health = await probeAgent();
        set({
          agentAvailable: Boolean(health),
          agentPaired: Boolean(health?.paired),
          agentVersion: health?.version ?? '',
        });
        if (!health?.paired && isAgentModeEnabled()) {
          setAgentModeApi(false);
          set({ agentMode: false, tabs: [welcomeTab], activeTabId: 'welcome' });
        }
      },

      pairAgent: async (pin) => {
        await pairAgentApi(pin);
        set({ agentAvailable: true, agentPaired: true });
        get().toast('success', '本地 Agent 配对成功');
      },

      setAgentMode: async (enabled) => {
        if (enabled) {
          if (!getAgentToken()) throw new Error('请先配对本地 Agent');
          setAgentModeApi(true);
          set({ agentMode: true, tabs: [welcomeTab], activeTabId: 'welcome' });
          await get().loadConnections();
          get().toast('success', '已切换到本地 Agent 模式', '现在可以连接本机与内网数据库');
        } else {
          setAgentModeApi(false);
          set({ agentMode: false, tabs: [welcomeTab], activeTabId: 'welcome' });
          await get().loadConnections();
          get().toast('info', '已切换回云端模式');
        }
      },

      toast: (kind, message, detail) => {
        const id = makeId('toast');
        set((state) => ({ toasts: [...state.toasts, { id, kind, message, detail }].slice(-3) }));
        window.setTimeout(() => {
          set((state) => ({ toasts: state.toasts.filter((toastItem) => toastItem.id !== id) }));
        }, kind === 'error' ? 6500 : 3600);
      },

      dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toastItem) => toastItem.id !== id) })),

      requestConfirm: (options) => set({ confirm: options }),
      clearConfirm: () => set({ confirm: null }),
      bumpData: () => set((state) => ({ dataVersion: state.dataVersion + 1 })),
      resetWorkspace: () => {
        setAgentModeApi(false);
        set({
          connections: [],
          connectionsLoading: false,
          tabs: [welcomeTab],
          activeTabId: 'welcome',
          querySeq: 0,
          dataVersion: 0,
          connectionDialog: { open: false },
          confirm: null,
          toasts: [],
          aboutOpen: false,
          agentMode: false,
        });
      },
    }),
    {
      name: 'navideck.ui',
      partialize: (state) => ({ theme: state.theme, maxRows: state.maxRows }),
    },
  ),
);
