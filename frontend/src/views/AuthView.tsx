import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  Mail,
  Monitor,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { api } from '../lib/api';
import { classNames } from '../lib/utils';
import { useAuthStore } from '../store/authStore';
import type { CaptchaChallenge } from '../types';
import { Spinner } from '../components/ui';
import { DownloadDialog } from '../components/DownloadDialog';

type Mode = 'login' | 'register' | 'reset';

const EMAIL_PATTERN = /^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AuthView() {
  const status = useAuthStore((state) => state.status);
  const storeError = useAuthStore((state) => state.error);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const clearError = useAuthStore((state) => state.clearError);

  const [mode, setMode] = useState<Mode>('login');
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devEmailCode, setDevEmailCode] = useState<string | null>(null);

  const registrationEnabled = Boolean(status?.registrationEnabled);
  const devCodes = Boolean(status?.devCodes);
  const mailReady = Boolean(status?.mailConfigured) || devCodes;
  const title = mode === 'login' ? '登录 StarBase' : mode === 'register' ? '创建账号' : '重置密码';
  const subtitle =
    mode === 'login'
      ? '使用账号密码和图形验证码登录'
      : mode === 'register'
        ? '通过邮箱验证码完成注册'
        : '通过邮箱验证码重设密码';

  const loadCaptcha = async () => {
    setCaptchaLoading(true);
    try {
      const challenge = await api.authCaptcha();
      setCaptcha(challenge);
      setCaptchaCode('');
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    void loadCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (!status?.registrationEnabled && mode === 'register') setMode('login');
  }, [status?.registrationEnabled, mode]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setLocalError(null);
    setNotice(null);
    setDevEmailCode(null);
    setVerifyCode('');
    setConfirmPassword('');
    clearError();
    void loadCaptcha();
  };

  const sendEmailCode = async () => {
    setLocalError(null);
    setNotice(null);
    if (!EMAIL_PATTERN.test(email.trim())) {
      setLocalError('请先填写正确的邮箱');
      return;
    }
    if (!mailReady) {
      setLocalError('邮件服务未配置，当前无法发送验证码，请联系管理员');
      return;
    }
    setSendingCode(true);
    try {
      const result = await api.sendEmailCode(email.trim(), mode === 'reset' ? 'reset' : 'register');
      setCountdown(60);
      setNotice(result.message);
      setDevEmailCode(result.devCode ?? null);
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setSendingCode(false);
    }
  };

  const validateCaptcha = (): boolean => {
    if (!captcha) {
      setLocalError('验证码加载失败，请点击刷新');
      return false;
    }
    if (!captchaCode.trim()) {
      setLocalError('请输入图形验证码');
      return false;
    }
    return true;
  };

  const validatePassword = (value: string): boolean => {
    if (Array.from(value).length < 8) {
      setLocalError('密码长度至少 8 位');
      return false;
    }
    return true;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);
    if (!validateCaptcha()) return;
    if (!captcha) return;
    setSubmitting(true);
    try {
      if (mode === 'login') {
        if (!loginValue.trim()) throw new Error('请输入用户名或邮箱');
        if (!password) throw new Error('请输入密码');
        await login({
          login: loginValue.trim(),
          password,
          captchaId: captcha.captchaId,
          captchaCode: captchaCode.trim(),
        });
      } else if (mode === 'register') {
        if (!username.trim()) throw new Error('请输入用户名');
        if (!EMAIL_PATTERN.test(email.trim())) throw new Error('请输入正确的邮箱');
        if (!verifyCode.trim()) throw new Error('请输入邮箱验证码');
        if (!validatePassword(password)) return;
        if (password !== confirmPassword) throw new Error('两次输入的密码不一致');
        await register({
          username: username.trim(),
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          password,
          verifyCode: verifyCode.trim(),
          captchaId: captcha.captchaId,
          captchaCode: captchaCode.trim(),
        });
      } else {
        if (!EMAIL_PATTERN.test(email.trim())) throw new Error('请输入正确的邮箱');
        if (!verifyCode.trim()) throw new Error('请输入邮箱验证码');
        if (!validatePassword(password)) return;
        if (password !== confirmPassword) throw new Error('两次输入的密码不一致');
        await resetPassword({
          email: email.trim(),
          verifyCode: verifyCode.trim(),
          newPassword: password,
          captchaId: captcha.captchaId,
          captchaCode: captchaCode.trim(),
        });
        setMode('login');
        setLoginValue(email.trim());
        setPassword('');
        setConfirmPassword('');
        setVerifyCode('');
        setNotice('密码已重置，请使用新密码登录');
        void loadCaptcha();
      }
    } catch (error) {
      setLocalError(errorMessage(error));
      void loadCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  if (!status && !storeError) {
    return (
      <div className="auth-shell auth-shell-loading">
        <Spinner size={26} />
        <span>正在连接后端服务…</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="auth-shell auth-shell-loading">
        <AlertCircle size={24} />
        <strong>无法连接后端服务</strong>
        <span>{storeError}</span>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={14} /> 重试
        </button>
      </div>
    );
  }

  const error = localError || storeError;
  const passwordType = showPassword ? 'text' : 'password';
  const codeButtonDisabled = sendingCode || countdown > 0 || !email.trim();
  const captchaImage = captcha?.imageBase64 ? (
    <img
      className="auth-captcha-image"
      src={captcha.imageBase64}
      alt="图形验证码"
      onClick={() => void loadCaptcha()}
      title="点击刷新验证码"
    />
  ) : (
    <button type="button" className="auth-captcha-placeholder" onClick={() => void loadCaptcha()}>
      {captchaLoading ? <Spinner /> : '点击加载验证码'}
    </button>
  );

  return (
    <div className="auth-shell">
      <aside className="auth-brand-panel">
        <div className="auth-brand-head">
          <span className="auth-brand-mark">
            <Database size={24} strokeWidth={1.8} />
          </span>
          <div>
            <strong>StarBase</strong>
            <span>WEB DATABASE STUDIO</span>
          </div>
        </div>
        <div className="auth-brand-copy">
          <h1>安全的 Web 数据库工作台</h1>
          <p>账号登录、邮箱验证码与连接隔离，适合部署在多用户服务器上。</p>
          <ul>
            <li>
              <ShieldCheck size={17} />
              <span>图形验证码与登录失败锁定</span>
            </li>
            <li>
              <Mail size={17} />
              <span>注册与找回密码均需邮箱验证码</span>
            </li>
            <li>
              <KeyRound size={17} />
              <span>每个账号只能看到自己的数据库连接与查询收藏</span>
            </li>
            <li>
              <Database size={17} />
              <span>普通用户无法连接服务器本机/内网数据库或读取服务器文件</span>
            </li>
          </ul>
        </div>
        <div className="auth-brand-foot">
          <span className="server-dot online" />
          服务端认证与连接隔离已启用
        </div>
      </aside>

      <main className="auth-main-panel">
        <section className="auth-card" aria-live="polite">
          <div className="auth-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={classNames('auth-mode-tab', mode === 'login' && 'active')}
              onClick={() => switchMode('login')}
            >
              <LogIn size={14} /> 登录
            </button>
            {registrationEnabled ? (
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={classNames('auth-mode-tab', mode === 'register' && 'active')}
                onClick={() => switchMode('register')}
              >
                <UserPlus size={14} /> 注册
              </button>
            ) : null}
          </div>

          <div className="auth-card-head">
            {mode === 'reset' ? (
              <button type="button" className="auth-back" onClick={() => switchMode('login')}>
                <ArrowLeft size={14} /> 返回登录
              </button>
            ) : null}
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>

          {devCodes ? (
            <div className="auth-notice dev">
              {status.mailConfigured
                ? '本机开发模式：图形验证码会显示在页面上，邮箱验证码通过 SMTP 发送。'
                : '本机开发模式：图形验证码和邮箱验证码会直接显示在页面上，请勿用于公网部署。'}
            </div>
          ) : null}
          {!mailReady ? (
            <div className="auth-notice warning">
              <AlertCircle size={14} /> 邮件服务未配置，注册和找回密码暂不可用，请联系管理员。
            </div>
          ) : null}
          {notice ? (
            <div className="auth-notice success">
              <CheckCircle2 size={14} /> {notice}
            </div>
          ) : null}
          {error ? (
            <div className="auth-notice error">
              <AlertCircle size={14} /> {error}
            </div>
          ) : null}

          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === 'login' ? (
              <>
                <label className="auth-field">
                  <span>用户名或邮箱</span>
                  <input
                    className="input auth-input"
                    value={loginValue}
                    onChange={(event) => setLoginValue(event.target.value)}
                    placeholder="admin 或 you@example.com"
                    autoComplete="username"
                    autoFocus
                  />
                </label>
                <label className="auth-field">
                  <span>密码</span>
                  <div className="auth-input-wrap">
                    <input
                      className="input auth-input"
                      type={passwordType}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="输入密码"
                      autoComplete="current-password"
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
              </>
            ) : null}

            {mode === 'register' ? (
              <>
                <div className="auth-grid-2">
                  <label className="auth-field">
                    <span>用户名</span>
                    <input
                      className="input auth-input"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="3-32 位字母/数字/._-"
                      autoComplete="username"
                      autoFocus
                    />
                  </label>
                  <label className="auth-field">
                    <span>显示名称（可选）</span>
                    <input
                      className="input auth-input"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="例如 张三"
                      autoComplete="nickname"
                    />
                  </label>
                </div>
                <label className="auth-field">
                  <span>邮箱</span>
                  <div className="auth-code-row">
                    <input
                      className="input auth-input"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                    <button
                      type="button"
                      className="btn auth-code-btn"
                      disabled={codeButtonDisabled}
                      onClick={() => void sendEmailCode()}
                    >
                      {sendingCode ? <Spinner /> : null}
                      {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
                    </button>
                  </div>
                </label>
                <label className="auth-field">
                  <span>邮箱验证码</span>
                  <input
                    className="input auth-input auth-code-input"
                    value={verifyCode}
                    onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6 位数字"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  {devEmailCode ? <small className="auth-dev-code">开发验证码：{devEmailCode}</small> : null}
                </label>
                <div className="auth-grid-2">
                  <label className="auth-field">
                    <span>密码</span>
                    <div className="auth-input-wrap">
                      <input
                        className="input auth-input"
                        type={passwordType}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="至少 8 位"
                        autoComplete="new-password"
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
                  <label className="auth-field">
                    <span>确认密码</span>
                    <input
                      className="input auth-input"
                      type={passwordType}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="再次输入密码"
                      autoComplete="new-password"
                    />
                  </label>
                </div>
              </>
            ) : null}

            {mode === 'reset' ? (
              <>
                <label className="auth-field">
                  <span>注册邮箱</span>
                  <div className="auth-code-row">
                    <input
                      className="input auth-input"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn auth-code-btn"
                      disabled={codeButtonDisabled}
                      onClick={() => void sendEmailCode()}
                    >
                      {sendingCode ? <Spinner /> : null}
                      {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
                    </button>
                  </div>
                </label>
                <label className="auth-field">
                  <span>邮箱验证码</span>
                  <input
                    className="input auth-input auth-code-input"
                    value={verifyCode}
                    onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6 位数字"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  {devEmailCode ? <small className="auth-dev-code">开发验证码：{devEmailCode}</small> : null}
                </label>
                <div className="auth-grid-2">
                  <label className="auth-field">
                    <span>新密码</span>
                    <div className="auth-input-wrap">
                      <input
                        className="input auth-input"
                        type={passwordType}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="至少 8 位"
                        autoComplete="new-password"
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
                  <label className="auth-field">
                    <span>确认新密码</span>
                    <input
                      className="input auth-input"
                      type={passwordType}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="再次输入密码"
                      autoComplete="new-password"
                    />
                  </label>
                </div>
              </>
            ) : null}

            <label className="auth-field">
              <span>图形验证码</span>
              <div className="auth-captcha-row">
                <input
                  className="input auth-input auth-captcha-input"
                  value={captchaCode}
                  onChange={(event) => setCaptchaCode(event.target.value.replace(/\s/g, '').slice(0, 4))}
                  placeholder="4 位字符"
                  autoComplete="off"
                  maxLength={4}
                />
                {captchaImage}
                <button
                  type="button"
                  className="icon-btn auth-captcha-refresh"
                  onClick={() => void loadCaptcha()}
                  title="刷新验证码"
                  disabled={captchaLoading}
                >
                  <RefreshCw size={15} className={captchaLoading ? 'spin' : ''} />
                </button>
              </div>
              {captcha?.devCode ? <small className="auth-dev-code">开发验证码：{captcha.devCode}</small> : null}
            </label>

            <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
              {submitting ? <Spinner /> : <ShieldCheck size={15} />}
              {mode === 'login' ? '登录' : mode === 'register' ? '注册并登录' : '重置密码'}
            </button>

            {mode === 'login' ? (
              <button type="button" className="auth-link" onClick={() => switchMode('reset')}>
                忘记密码？
              </button>
            ) : null}
          </form>

          <button type="button" className="auth-local-download" onClick={() => setDownloadOpen(true)}>
            <Monitor size={14} />
            下载桌面版 · 无需登录 / 离线可用
          </button>

          <div className="auth-card-foot">
            <span>首次部署请查看服务端启动日志中的管理员初始密码。</span>
            <span>普通用户无法连接服务器本机/内网数据库。</span>
          </div>
        </section>
      </main>
      <DownloadDialog open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    </div>
  );
}
