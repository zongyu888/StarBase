import { useEffect, useState } from 'react';
import {
  Cable,
  Database,
  Download,
  HelpCircle,
  Info,
  Keyboard,
  KeyRound,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Shield,
  Sun,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { startNewConnection, startNewQuery } from '../lib/actions';
import { isDesktopShell } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import type { HealthInfo } from '../types';
import { DriverBadge, Dropdown, Modal } from './ui';
import type { MenuItem } from './ui';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { AdminUsersDialog } from './AdminUsersDialog';
import { AgentDialog } from './AgentDialog';
import { DownloadDialog } from './DownloadDialog';

export function TopBar() {
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const loadConnections = useAppStore((state) => state.loadConnections);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const closeTab = useAppStore((state) => state.closeTab);
  const aboutOpen = useAppStore((state) => state.aboutOpen);
  const setAboutOpen = useAppStore((state) => state.setAboutOpen);
  const connections = useAppStore((state) => state.connections);
  const setVersion = useAppStore((state) => state.setVersion);
  const version = useAppStore((state) => state.version);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const agentMode = useAppStore((state) => state.agentMode);
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);
  const authEnabled = authStatus?.authEnabled ?? true;
  const desktop = isDesktopShell();
  const isAdmin = user?.role === 'ADMIN';
  const userInitial = (user?.displayName || user?.username || '?').slice(0, 1).toUpperCase();

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((data) => {
        if (cancelled) return;
        setHealth(data);
        setVersion(data.version);
        setOnline(true);
      })
      .catch(() => {
        if (!cancelled) setOnline(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setVersion]);

  const fileMenu: MenuItem[] = [
    { label: '新建连接', icon: <Database size={14} />, shortcut: 'Ctrl+N', onClick: startNewConnection },
    { label: '新建查询', icon: <Terminal size={14} />, shortcut: 'Ctrl+T', onClick: startNewQuery },
    { label: '', separator: true },
    {
      label: '关闭当前标签',
      icon: <X size={14} />,
      shortcut: 'Alt+W',
      disabled: activeTabId === 'welcome',
      onClick: () => closeTab(activeTabId),
    },
  ];

  const viewMenu: MenuItem[] = [
    {
      label: '刷新连接列表',
      icon: <RefreshCw size={14} />,
      onClick: () => void loadConnections(),
    },
    { label: '', separator: true },
    {
      label: theme === 'dark' ? '切换到浅色主题' : '切换到深色主题',
      icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
      onClick: toggleTheme,
    },
    { label: '', separator: true },
    {
      label: agentMode ? '本地 Agent（已启用）' : '本地 Agent（连接本机数据库）',
      icon: <Cable size={14} />,
      checked: agentMode,
      onClick: () => setAgentOpen(true),
    },
  ];

  const helpMenu: MenuItem[] = [
    { label: '键盘快捷键', icon: <Keyboard size={14} />, onClick: () => setShortcutsOpen(true) },
    { label: '关于 StarBase', icon: <Info size={14} />, onClick: () => setAboutOpen(true) },
  ];

  const accountMenu: MenuItem[] = [
    { label: user?.displayName || user?.username || '账号', header: true },
    { label: user?.email || `@${user?.username ?? ''}`, disabled: true },
    { label: '', separator: true },
    { label: '修改密码', icon: <KeyRound size={14} />, onClick: () => setPasswordOpen(true) },
    ...(isAdmin
      ? [{ label: '用户管理', icon: <Users size={14} />, onClick: () => setUsersOpen(true) } as MenuItem]
      : []),
    { label: '', separator: true },
    {
      label: '退出登录',
      icon: <LogOut size={14} />,
      danger: true,
      onClick: () => void logout(),
    },
  ];

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Database size={18} strokeWidth={2.2} />
          </span>
          <div className="brand-text">
            <strong>StarBase</strong>
            <span>{desktop ? 'DESKTOP DATABASE STUDIO' : 'WEB DATABASE STUDIO'}</span>
          </div>
        </div>

        <nav className="app-menu">
          <Dropdown trigger={<button type="button" className="menu-trigger">文件</button>} items={fileMenu} />
          <Dropdown trigger={<button type="button" className="menu-trigger">查看</button>} items={viewMenu} />
          <button
            type="button"
            className="menu-trigger download-trigger"
            onClick={() => setDownloadOpen(true)}
            title="下载 StarBase 源码、Agent 与桌面版"
          >
            <Download size={13} />
            下载
          </button>
          <Dropdown trigger={<button type="button" className="menu-trigger">帮助</button>} items={helpMenu} />
        </nav>

        <div className="topbar-spacer" />

        <div className="connection-count" title="已保存的连接">
          <span className="connection-count-dot" />
          {connections.filter((connection) => connection.connected).length}
          <span className="muted">/ {connections.length} 已连接</span>
        </div>
        <span className={`server-pill ${online === false ? 'offline' : online ? 'online' : ''}`}>
          <span className="server-dot" />
          {online === null ? '检测中' : online ? (desktop ? '引擎在线' : '后端在线') : (desktop ? '引擎离线' : '后端离线')}
        </span>
        {agentMode ? (
          <span className="server-pill agent-mode-pill" title="业务请求正在通过本机 StarBase Agent 转发">
            <span className="server-dot" />
            本地模式
          </span>
        ) : null}
        <button type="button" className="icon-btn theme-toggle" onClick={toggleTheme} title="切换主题">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" className="btn btn-primary new-connection-btn" onClick={startNewConnection}>
          <Plus size={14} /> 新建连接
        </button>
        {authEnabled ? (
          <Dropdown
            align="right"
            trigger={
              <button type="button" className="user-chip" title="账号菜单">
                <span className="user-avatar">{userInitial}</span>
                <span className="user-chip-text">
                  <strong>{user?.displayName || user?.username}</strong>
                  <small>{isAdmin ? '管理员' : '用户'}</small>
                </span>
              </button>
            }
            items={accountMenu}
          />
        ) : (
          <span className="local-mode-pill" title={desktop ? '桌面单用户模式，可直接连接本机与内网数据库' : '认证已关闭，仅限本机单用户使用'}>
            <Shield size={13} /> 本机模式
          </span>
        )}
      </header>

      <Modal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        title="关于 StarBase"
        width={500}
        footer={
          <>
            <div className="modal-footer-spacer" />
            <button type="button" className="btn btn-primary" onClick={() => setAboutOpen(false)}>
              知道了
            </button>
          </>
        }
      >
        <div className="about-panel">
          <div className="about-logo">
            <Database size={26} />
          </div>
          <div>
            <h3>StarBase <span>v{version || health?.version || '—'}</span></h3>
            <p>一个本地优先的{desktop ? '桌面' : ' Web '}数据库工作台，使用 React + Go 构建，交互参考 Navicat。</p>
          </div>
          <div className="about-grid">
            <div><span>数据库驱动</span><strong>MySQL · MariaDB · PostgreSQL · SQL Server · Oracle · SQLite · Snowflake · MongoDB · Redis</strong></div>
            <div><span>后端状态</span><strong>{online ? '运行中' : '离线'}</strong></div>
            <div><span>认证方式</span><strong>{authEnabled ? '账号 + 图形验证码 + 邮箱验证码' : '本机模式（无登录）'}</strong></div>
            <div><span>当前账号</span><strong>{user ? `${user.displayName || user.username}（${isAdmin ? '管理员' : '用户'}）` : '—'}</strong></div>
            <div><span>密码存储</span><strong>bcrypt 哈希 · 连接密码 AES-GCM</strong></div>
            <div><span>连接隔离</span><strong>{desktop ? '桌面版直接连接本机/内网数据库；连接与密码仅保存在本机' : '仅当前账号可见；普通用户禁止内网/本机目标'}</strong></div>
          </div>
          <div className="about-driver-row">
            <DriverBadge driver="mysql" />
            <DriverBadge driver="postgres" />
            <DriverBadge driver="sqlite" />
            <span>前端 React 19 · 后端 Go · CodeMirror 6</span>
          </div>
          <p className="about-note">
            StarBase 是独立开源实现，与 Navicat 官方无关联。所有连接和数据操作均在本地服务中执行。
          </p>
        </div>
      </Modal>

      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="键盘快捷键"
        width={460}
        footer={
          <>
            <div className="modal-footer-spacer" />
            <button type="button" className="btn" onClick={() => setShortcutsOpen(false)}>
              关闭
            </button>
          </>
        }
      >
        <div className="shortcut-list">
          <div><span>新建连接</span><kbd>Ctrl / ⌘ + N</kbd></div>
          <div><span>新建查询</span><kbd>Ctrl / ⌘ + T</kbd></div>
          <div><span>执行 SQL</span><kbd>Ctrl / ⌘ + Enter</kbd></div>
          <div><span>关闭标签</span><kbd>Alt + W</kbd></div>
          <div><span>编辑单元格</span><kbd>双击单元格</kbd></div>
          <div><span>取消 / 关闭弹窗</span><kbd>Esc</kbd></div>
        </div>
        <div className="shortcut-note">
          <HelpCircle size={14} />
          提示：在查询编辑器中选中 SQL 后执行，只会运行选中部分。
        </div>
      </Modal>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <AdminUsersDialog open={usersOpen} onClose={() => setUsersOpen(false)} />
      <AgentDialog open={agentOpen} onClose={() => setAgentOpen(false)} />
      <DownloadDialog open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    </>
  );
}
