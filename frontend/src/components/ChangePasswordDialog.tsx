import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import { Modal, Spinner } from './ui';

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useAppStore((state) => state.toast);
  const changePassword = useAuthStore((state) => state.changePassword);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setSaving(false);
    setShowPassword(false);
  }, [open]);

  const submit = async () => {
    setError(null);
    if (!oldPassword) {
      setError('请输入原密码');
      return;
    }
    if (Array.from(newPassword).length < 8) {
      setError('新密码长度至少 8 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      toast('success', '密码已更新', '其他已登录设备需要重新登录');
      onClose();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : String(changeError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title="修改密码"
      subtitle="修改后当前账号的其他登录会话会失效"
      width={440}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner /> : <KeyRound size={14} />}
            保存新密码
          </button>
        </>
      }
    >
      <div className="auth-form">
        <label className="field">
          <span>原密码</span>
          <input
            className="input"
            type="password"
            value={oldPassword}
            onChange={(event) => setOldPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        <label className="field">
          <span>新密码</span>
          <div className="auth-input-wrap">
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="至少 8 位"
            />
            <button
              type="button"
              className="auth-eye"
              onClick={() => setShowPassword((value) => !value)}
              title={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </label>
        <label className="field">
          <span>确认新密码</span>
          <input
            className="input"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </Modal>
  );
}
