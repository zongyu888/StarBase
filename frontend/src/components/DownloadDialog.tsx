import { Cable, Download, GitBranch, Monitor, Server } from 'lucide-react';
import { RELEASE_FILES, REPO_GITHUB, REPO_GITEE, SOURCE_ZIP_GITHUB } from '../lib/links';
import { useAppStore } from '../store/appStore';
import { Modal } from './ui';

interface DownloadDialogProps {
  open: boolean;
  onClose: () => void;
}

function DownloadLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <a className="download-item" href={href} target="_blank" rel="noreferrer">
      <span className="download-item-icon">
        <Download size={15} />
      </span>
      <span className="download-item-copy">
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <span className="download-item-arrow">→</span>
    </a>
  );
}

export function DownloadDialog({ open, onClose }: DownloadDialogProps) {
  const version = useAppStore((state) => state.version);

  return (
    <Modal
      open={open}
      title="下载 StarBase"
      subtitle="桌面应用、源码、Agent 与 Linux 服务端"
      onClose={onClose}
      width={640}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="download-panel">
        <section className="download-section download-primary">
          <h3>桌面应用（推荐）</h3>
          <p className="download-note">
            像 Navicat 一样双击打开。内置前端与数据库引擎，<strong>无需登录、离线可用</strong>，可直接连接
            localhost、127.0.0.1 与内网数据库。
          </p>
          <div className="download-grid">
            <a
              className="download-item download-item-featured"
              href={RELEASE_FILES.desktopExe}
              target="_blank"
              rel="noreferrer"
            >
              <span className="download-item-icon">
                <Monitor size={15} />
              </span>
              <span className="download-item-copy">
                <strong>直接下载 StarBaseDesktop.exe</strong>
                <small>单文件 · 双击即用 · Windows 10/11 x64</small>
              </span>
              <span className="download-item-arrow">→</span>
            </a>
            <a className="download-item" href={RELEASE_FILES.desktopWindows} target="_blank" rel="noreferrer">
              <span className="download-item-icon">
                <Download size={15} />
              </span>
              <span className="download-item-copy">
                <strong>桌面版 ZIP（含说明）</strong>
                <small>压缩后体积更小，解压后双击 StarBaseDesktop.exe</small>
              </span>
              <span className="download-item-arrow">→</span>
            </a>
          </div>
          <div className="agent-tip">
            Windows 首次运行可能提示“未知发布者”，点击“更多信息 → 仍要运行”即可。桌面版不需要账号登录。
          </div>
        </section>

        <section className="download-section">
          <h3>源码仓库</h3>
          <div className="download-grid">
            <a className="download-item" href={REPO_GITHUB} target="_blank" rel="noreferrer">
              <span className="download-item-icon">
                <GitBranch size={15} />
              </span>
              <span className="download-item-copy">
                <strong>GitHub 仓库</strong>
                <small>浏览源码、提交 issue、下载历史版本</small>
              </span>
              <span className="download-item-arrow">→</span>
            </a>
            <a className="download-item" href={SOURCE_ZIP_GITHUB} target="_blank" rel="noreferrer">
              <span className="download-item-icon">
                <Download size={15} />
              </span>
              <span className="download-item-copy">
                <strong>GitHub 源码 ZIP</strong>
                <small>直接下载 main 分支源码</small>
              </span>
              <span className="download-item-arrow">→</span>
            </a>
            {REPO_GITEE ? (
              <a className="download-item" href={REPO_GITEE} target="_blank" rel="noreferrer">
                <span className="download-item-icon">
                  <GitBranch size={15} />
                </span>
                <span className="download-item-copy">
                  <strong>Gitee 镜像</strong>
                  <small>国内访问更快的源码镜像</small>
                </span>
                <span className="download-item-arrow">→</span>
              </a>
            ) : (
              <div className="download-item disabled" aria-disabled="true">
                <span className="download-item-icon">
                  <GitBranch size={15} />
                </span>
                <span className="download-item-copy">
                  <strong>Gitee 镜像</strong>
                  <small>尚未配置：可在 Gitee 中从 GitHub 导入后填写仓库地址</small>
                </span>
                <span className="download-item-tag">待配置</span>
              </div>
            )}
          </div>
        </section>

        <section className="download-section">
          <h3>连接本机数据库（Agent）</h3>
          <p className="download-note">
            Agent 运行在你自己的电脑上，只监听 127.0.0.1。启动后把控制台配对码输入网站「查看 → 本地 Agent」，即可让浏览器连接 localhost / 内网数据库。
          </p>
          <div className="download-grid">
            <DownloadLink
              href={RELEASE_FILES.agentWindows}
              label="Windows Agent"
              hint="starbase-agent.exe · Windows 10/11 x64"
            />
            <DownloadLink
              href={RELEASE_FILES.agentUnix}
              label="Linux / macOS Agent"
              hint="命令行运行 · amd64"
            />
          </div>
        </section>

        <section className="download-section">
          <h3>Linux 服务端</h3>
          <div className="download-grid">
            <a className="download-item" href={RELEASE_FILES.serverLinux} target="_blank" rel="noreferrer">
              <span className="download-item-icon">
                <Server size={15} />
              </span>
              <span className="download-item-copy">
                <strong>Linux 服务端</strong>
                <small>单二进制，配合 Nginx / TLS 部署网站</small>
              </span>
              <span className="download-item-arrow">→</span>
            </a>
          </div>
        </section>

        <div className="download-steps">
          <div className="download-step">
            <span>1</span>
            <p>下载并双击 StarBaseDesktop.exe，不需要登录。</p>
          </div>
          <div className="download-step">
            <span>2</span>
            <p>进入工作台后新建连接，填 localhost / 127.0.0.1。</p>
          </div>
          <div className="download-step">
            <span>3</span>
            <p>桌面版离线可用，连接配置与密码只保存在本机。</p>
          </div>
        </div>

        <div className="download-footer">
          <span className="download-version">{version ? `当前版本 v${version}` : 'StarBase'}</span>
          <a href={RELEASE_FILES.checksums} target="_blank" rel="noreferrer">
            SHA256 校验和
          </a>
          <span className="download-hint">
            <Cable size={12} /> Agent 不会上传连接密码
          </span>
        </div>
      </div>
    </Modal>
  );
}