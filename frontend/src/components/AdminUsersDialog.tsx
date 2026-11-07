import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Mail, RefreshCw, Shield, Trash2, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { classNames, formatDateTime } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import type { UserProfile } from '../types';
import { EmptyState, Modal, Spinner } from './ui';

export function AdminUsersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useAppStore((state) => state.toast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const currentUser = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [testingMail, setTestingMail] = useState(false);
  const [mailMessage, setMailMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.adminUsers();
      setUsers(response.users);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
      setTestEmail(currentUser?.email ?? '');
      setMailMessage(null);
      setError(null);
    }
  }, [open, load, currentUser?.email]);

  const toggleEnabled = async (user: UserProfile) => {
    setBusyId(user.id);
    try {
      await api.adminSetUserEnabled(user.id, !user.enabled);
      toast('success', user.enabled ? '账号已禁用' : '账号已启用', user.username);
      await load();
    } catch (toggleError) {
      toast('error', '操作失败', toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setBusyId(null);
    }
  };

  const deleteUser = (user: UserProfile) => {
    requestConfirm({
      title: '删除用户',
      message: `确定删除用户「${user.username}」吗？该用户的连接、查询收藏和示例数据库都会一并删除，操作不可撤销。`,
      confirmText: '删除用户',
      danger: true,
      onConfirm: async () => {
        setBusyId(user.id);
        try {
          await api.adminDeleteUser(user.id);
          toast('success', '用户已删除', user.username);
          await load();
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const sendTestMail = async () => {
    setMailMessage(null);
    if (!testEmail.trim()) {
      setMailMessage('请填写收件邮箱');
      return;
    }
    setTestingMail(true);
    try {
      const result = await api.adminTestMail(testEmail.trim());
      setMailMessage(result.message);
    } catch (mailError) {
      setMailMessage(mailError instanceof Error ? mailError.message : String(mailError));
    } finally {
      setTestingMail(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="用户管理"
      subtitle="启用/禁用账号，或删除用户及其数据"
      width={880}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> 刷新
          </button>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}

      <div className="admin-mail-test">
        <div className="admin-mail-test-head">
          <span>
            <Mail size={13} /> SMTP 邮件测试
          </span>
          <span className={classNames('status-pill', authStatus?.mailConfigured ? 'enabled' : 'disabled')}>
            {authStatus?.mailConfigured ? '已配置' : '未配置'}
          </span>
        </div>
        <div className="auth-code-row">
          <input
            className="input"
            type="email"
            value={testEmail}
            onChange={(event) => setTestEmail(event.target.value)}
            placeholder="收件邮箱，例如 you@example.com"
          />
          <button
            type="button"
            className="btn"
            disabled={testingMail || !authStatus?.mailConfigured}
            onClick={() => void sendTestMail()}
          >
            {testingMail ? <Spinner /> : <Mail size={13} />}
            发送测试邮件
          </button>
        </div>
        {mailMessage ? <small className="admin-mail-message">{mailMessage}</small> : null}
      </div>
      {loading && users.length === 0 ? (
        <div className="center-loading">
          <Spinner size={22} />
          <span>正在加载用户…</span>
        </div>
      ) : users.length === 0 ? (
        <EmptyState compact icon={<UserRound size={24} />} title="还没有用户" description="用户通过注册页面创建账号后会显示在这里。" />
      ) : (
        <div className="admin-users-table-wrap">
          <table className="data-grid admin-users-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th>最近登录</th>
                <th className="action-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUser?.id;
                const busy = busyId === user.id;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-user-cell">
                        <span className="admin-user-avatar">{(user.displayName || user.username).slice(0, 1).toUpperCase()}</span>
                        <span>
                          <strong>{user.displayName || user.username}</strong>
                          <small>@{user.username}{isSelf ? ' · 当前账号' : ''}</small>
                        </span>
                      </div>
                    </td>
                    <td className="muted">{user.email || '—'}</td>
                    <td>
                      <span className={classNames('soft-badge', user.role === 'ADMIN' && 'strong')}>
                        {user.role === 'ADMIN' ? <Shield size={10} /> : null}
                        {user.role === 'ADMIN' ? '管理员' : '用户'}
                      </span>
                    </td>
                    <td>
                      <span className={classNames('status-pill', user.enabled ? 'enabled' : 'disabled')}>
                        {user.enabled ? '正常' : '已禁用'}
                      </span>
                    </td>
                    <td className="muted">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}</td>
                    <td className="action-column">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          title={user.enabled ? '禁用账号' : '启用账号'}
                          disabled={isSelf || busy}
                          onClick={() => void toggleEnabled(user)}
                        >
                          {busy ? <Spinner /> : user.enabled ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger-hover"
                          title={isSelf ? '不能删除当前账号' : '删除用户'}
                          disabled={isSelf || busy}
                          onClick={() => deleteUser(user)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-users-tip">禁用账号会立即使其登录会话失效；删除用户会同时清理该用户的连接、查询收藏和个人 SQLite 示例库。</p>
    </Modal>
  );
}
