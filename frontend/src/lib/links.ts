// 发布与下载地址集中配置。Gitee 镜像在创建后填入 REPO_GITEE 即可。
export const REPO_GITHUB = 'https://github.com/zongyu888/StarBase';
export const REPO_GITEE = '';
export const SOURCE_ZIP_GITHUB = `${REPO_GITHUB}/archive/refs/heads/main.zip`;
export const RELEASES_LATEST = `${REPO_GITHUB}/releases/latest`;

export const RELEASE_FILES = {
  agentWindows: `${RELEASES_LATEST}/download/StarBase-Agent-Windows-amd64.zip`,
  agentUnix: `${RELEASES_LATEST}/download/StarBase-Agent-Unix-amd64.tar.gz`,
  desktopWindows: `${RELEASES_LATEST}/download/StarBase-Desktop-Windows-amd64.zip`,
  serverLinux: `${RELEASES_LATEST}/download/StarBase-Server-Linux-amd64.tar.gz`,
  checksums: `${RELEASES_LATEST}/download/SHA256SUMS.txt`,
};