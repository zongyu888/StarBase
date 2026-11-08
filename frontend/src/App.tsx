import { lazy, Suspense, useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { StatusBar } from './components/StatusBar';
import { ConnectionDialog } from './components/ConnectionDialog';
import { ConfirmDialog, Spinner, ToastViewport } from './components/ui';
import { WelcomeView } from './views/WelcomeView';

import { AuthView } from './views/AuthView';
import { startNewConnection, startNewQuery } from './lib/actions';
import { useAppStore } from './store/appStore';
import { useAuthStore } from './store/authStore';
import { classNames } from './lib/utils';

const SIDEBAR_MIN = 230;
const SIDEBAR_MAX = 480;

const QueryView = lazy(() => import('./views/QueryView').then((module) => ({ default: module.QueryView })));
const TableView = lazy(() => import('./views/TableView').then((module) => ({ default: module.TableView })));
const RedisView = lazy(() => import('./views/RedisView').then((module) => ({ default: module.RedisView })));
const ChromaView = lazy(() => import('./views/ChromaView').then((module) => ({ default: module.ChromaView })));

function App() {
  const theme = useAppStore((state) => state.theme);
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const closeTab = useAppStore((state) => state.closeTab);
  const loadConnections = useAppStore((state) => state.loadConnections);
  const user = useAuthStore((state) => state.user);
  const authLoading = useAuthStore((state) => state.loading || !state.initialized);
  const initializeAuth = useAuthStore((state) => state.initialize);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('navideck.sidebarWidth'));
    return Number.isFinite(stored) && stored >= SIDEBAR_MIN && stored <= SIDEBAR_MAX ? stored : 286;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (!user) return;
    useAppStore.getState().resetWorkspace();
    void loadConnections();
    // 只在登录用户变化时重建工作区，避免同一用户的资料更新清空标签页。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    localStorage.setItem('navideck.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (!document.querySelector('.modal-overlay')) startNewConnection();
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        if (!document.querySelector('.modal-overlay')) startNewQuery();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        if (!document.querySelector('.modal-overlay') && activeTabId !== 'welcome') closeTab(activeTabId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, closeTab]);

  const startSidebarResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    const move = (moveEvent: MouseEvent) => {
      const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, moveEvent.clientX));
      setSidebarWidth(width);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (authLoading) {
    return (
      <div className="auth-shell-loading">
        <Spinner size={26} />
        <span>正在验证登录状态…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthView />
        <ToastViewport />
      </>
    );
  }

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <Sidebar width={sidebarWidth} />
        <div
          className="sidebar-resizer"
          style={{ left: sidebarWidth - 2 }}
          onMouseDown={startSidebarResize}
          title="拖动调整侧栏宽度"
        />
        <main className="workspace">
          <TabBar />
          <div className="workspace-content">
            <Suspense
              fallback={
                <div className="workspace-loading">
                  <Spinner size={18} />
                  <span>正在加载模块…</span>
                </div>
              }
            >
              {tabs.map((tab) => (
              <div
                key={tab.id}
                className={classNames('tab-pane', tab.id === activeTabId && 'active')}
                aria-hidden={tab.id !== activeTabId}
              >
                {tab.kind === 'welcome' ? (
                  <WelcomeView />
                ) : tab.kind === 'query' ? (
                  <QueryView tab={tab} />
                ) : tab.kind === 'redis' ? (
                  <RedisView tab={tab} />
                ) : tab.kind === 'chroma' ? (
                  <ChromaView tab={tab} />
                ) : (
                  <TableView tab={tab} />
                )}
              </div>
            ))}
            </Suspense>
          </div>
        </main>
      </div>
      <StatusBar />
      <ConnectionDialog />
      <ConfirmDialog />
      <ToastViewport />
    </div>
  );
}

export default App;
