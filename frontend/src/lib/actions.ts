import { useAppStore } from '../store/appStore';

export function startNewQuery(): void {
  const state = useAppStore.getState();
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  let connection = active && active.kind !== 'welcome'
    ? state.connections.find((item) => item.id === active.connectionId)
    : undefined;
  const database = active && active.kind !== 'welcome' ? active.database : undefined;
  const schema = active && (active.kind === 'query' || active.kind === 'table') ? active.schema : undefined;

  if (!connection) {
    connection = state.connections.find((item) => item.connected) ?? state.connections[0];
  }
  if (!connection) {
    state.openConnectionDialog();
    state.toast('info', '请先创建一个数据库连接');
    return;
  }
  state.openQuery(connection, { database, schema });
}

export function startNewConnection(): void {
  useAppStore.getState().openConnectionDialog();
}
