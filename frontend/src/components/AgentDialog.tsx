import { useEffect, useState } from 'react';
import { Cable, KeyRound, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import { getAgentBase } from '../lib/agent';
import { useAppStore } from '../store/appStore';
import { Modal, Spinner, Switch } from './ui';

interface AgentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AgentDialog({ open, onClose }: AgentDialogProps) {
  const agentAvailable = useAppStore((state) => state.agentAvailable);
  const agentPaired = useAppStore((state) => state.agentPaired);
  const agentMode = useAppStore((state) => state.agentMode);
  const agentVersion = useAppStore((state) => state.agentVersion);
  const refreshAgent = useAppStore((state) => state.refreshAgent);
  const pairAgent = useAppStore((state) => state.pairAgent);
  const setAgentMode = useAppStore((state) => state.setAgentMode);

  const [checking, setChecking] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      await refreshAgent();
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (open) {
      setPin('');
      setError(null);
      void check();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handlePair = async () => {
    if (!/^\d{6}$/.test(pin.trim())) {
      setError('请输入 Agent 控制台显示的 6 位数字配对码');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await pairAgent(pin.trim());
      setPin('');
      await refreshAgent();
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : String(pairError));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setAgentMode(enabled);
      if (enabled) onClose();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="本地 Agent"
      subtitle="让浏览器里的 StarBase 连接你电脑上的 localhost / 内网数据库"
      onClose={() => {
        if (!busy) onClose();
      }}
      width={560}
      closeOnOverlay={!busy}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={() => void check()} disabled={checking || busy}>
            {checking ? <Spinner /> : <RefreshCw size={14} />}
            重新检测
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </>
      }
    >
      <div className="agent-panel">
        <div className="agent-status-card">
          <span className={`agent-status-icon ${agentAvailable ? 'online' : 'offline'}`}>
            <Cable size={20} />
          </span>
          <div className="agent-status-copy">
            <strong>
              {checking
                ? '正在检测本地 Agent…'
                : agentAvailable
                  ? agentPaired
                    ? '本地 Agent 已连接并配对'
                    : '已检测到本地 Agent，尚未配对'
                  : '未检测到本地 Agent'}
            </strong>
            <span>
              {agentAvailable
                ? `${getAgentBase()}${agentVersion ? ` · v${agentVersion}` : ''}`
                : '请先在本机启动 StarBase Agent'}
            </span>
          </div>
          {agentMode ? <span className="agent-active-badge">本地模式</span> : null}
        </div>

        {!agentAvailable ? (
          <div className="agent-steps">
            <div className="agent-step">
              <span className="agent-step-index">1</span>
              <div>
                <strong>下载并启动 StarBase Agent</strong>
                <p>Windows 构建产物为 <code>starbase-agent.exe</code>（项目内运行 <code>scripts\build-agent.bat</code> 生成）。</p>
              </div>
            </div>
            <div className="agent-step">
              <span className="agent-step-index">2</span>
              <div>
                <strong>保持 Agent 运行</strong>
                <p>控制台会显示监听地址与本机配对码。Agent 只监听 127.0.0.1，不会暴露到公网。</p>
              </div>
            </div>
            <div className="agent-step">
              <span className="agent-step-index">3</span>
              <div>
                <strong>回到这里重新检测并配对</strong>
                <p>点击「重新检测」，输入控制台中的 6 位配对码。</p>
              </div>
            </div>
            <div className="agent-tip">
              <Terminal size={14} />
              推荐使用 Chrome / Edge。浏览器允许 HTTPS 页面访问 127.0.0.1；如果被安全软件拦截，请改用桌面版。
            </div>
          </div>
        ) : !agentPaired ? (
          <div className="agent-pair">
            <label className="field">
              <span>配对码</span>
              <div className="agent-pin-row">
                <KeyRound size={15} />
                <input
                  className="input agent-pin-input"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Agent 控制台中的 6 位数字"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                />
                <button type="button" className="btn btn-primary" onClick={() => void handlePair()} disabled={busy}>
                  {busy ? <Spinner /> : <Cable size={14} />}
                  配对
                </button>
              </div>
            </label>
            <div className="agent-tip">
              <ShieldCheck size={14} />
              配对码 5 分钟内有效；Agent 重启后需要重新配对。令牌只保存在本机浏览器和 Agent 内存中。
            </div>
          </div>
        ) : (
          <div className="agent-mode">
            <div className="agent-mode-row">
              <div>
                <strong>使用本机 Agent</strong>
                <p>开启后，连接、查询、Redis、Chroma 等业务请求全部发往你电脑上的 Agent。</p>
              </div>
              <Switch checked={agentMode} onChange={(value) => void handleToggle(value)} disabled={busy} />
            </div>
            <ul className="agent-mode-list">
              <li>可以连接 localhost、127.0.0.1 和内网数据库</li>
              <li>连接配置与密码保存在 Agent 本地，不上传云端</li>
              <li>关闭开关后立即回到网站云端连接</li>
            </ul>
          </div>
        )}

        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </Modal>
  );
}