// 发布与下载地址集中配置。Gitee 镜像在创建后填入 REPO_GITEE 即可。
export const REPO_GITHUB = 'https://github.com/zongyu888/StarBase';
export const REPO_GITEE = '';
export const SOURCE_ZIP_GITHUB = `${REPO_GITHUB}/archive/refs/heads/main.zip`;
export const RELEASES_LATEST = `${REPO_GITHUB}/releases/latest`;

export const RELEASE_FILES = {
  desktopExe: `${RELEASES_LATEST}/download/StarBaseDesktop.exe`,
  desktopWindows: `${RELEASES_LATEST}/download/StarBase-Desktop-Windows-amd64.zip`,
  agentWindows: `${RELEASES_LATEST}/download/StarBase-Agent-Windows-amd64.zip`,
  agentUnix: `${RELEASES_LATEST}/download/StarBase-Agent-Unix-amd64.tar.gz`,
  serverLinux: `${RELEASES_LATEST}/download/StarBase-Server-Linux-amd64.tar.gz`,
  checksums: `${RELEASES_LATEST}/download/SHA256SUMS.txt`,
};
// 站内本地下载：文件位于服务端数据目录的 downloads/ 下，未登录也可下载。
export const LOCAL_DOWNLOADS = {
  desktopExe: '/downloads/StarBaseDesktop.exe',
  desktopWindows: '/downloads/StarBase-Desktop-Windows-amd64.zip',
  agentWindows: '/downloads/StarBase-Agent-Windows-amd64.zip',
  agentUnix: '/downloads/StarBase-Agent-Unix-amd64.tar.gz',
  serverLinux: '/downloads/StarBase-Server-Linux-amd64.tar.gz',
  checksums: '/downloads/SHA256SUMS.txt',
};