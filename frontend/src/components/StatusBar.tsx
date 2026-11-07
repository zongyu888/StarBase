import { Database, Lock, ShieldCheck } from 'lucide-react';
import { driverHasSchemas } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import { DriverBadge } from './ui';

export function StatusBar() {
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const connections = useAppStore((state) => state.connections);
  const version = useAppStore((state) => state.version);
  const active = tabs.find((tab) => tab.id === activeTabId);
  const connection = active && active.kind !== 'welcome'
    ? connections.find((item) => item.id === active.connectionId)
    : undefined;

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        {connection ? (
          <>
            <DriverBadge driver={connection.driver} size="sm" />
            <span className="statusbar-connection">{connection.name}</span>
            <span className="statusbar-sep">·</span>
            <span className="statusbar-path">
              {active && active.kind !== 'welcome' ? active.database || '默认数据库' : connection.database || '未选择数据库'}
              {driverHasSchemas(connection.driver) && active && 'schema' in active ? ` / ${active.schema}` : ''}
            </span>
            <span className={connection.connected ? 'status-dot online' : 'status-dot'} />
            <span className="statusbar-state">{connection.connected ? '已连接' : '未连接'}</span>
            {connection.readOnly ? (
              <>
                <Lock size={11} className="statusbar-lock" />
                <span>只读</span>
              </>
            ) : null}
          </>
        ) : (
          <>
            <Database size={12} />
            <span>本地工作区</span>
            <span className="statusbar-sep">·</span>
            <span className="statusbar-state">选择连接以开始工作</span>
          </>
        )}
      </div>
      <div className="statusbar-right">
        <span>{connections.filter((item) => item.connected).length} 个活动连接</span>
        <span className="statusbar-sep">·</span>
        <span className="statusbar-security">
          <ShieldCheck size={11} /> 本地加密存储
        </span>
        <span className="statusbar-sep">·</span>
        <span>StarBase{version ? ` v${version}` : ''}</span>
      </div>
    </footer>
  );
}
