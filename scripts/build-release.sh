#!/usr/bin/env bash
# 构建 StarBase 发布包：服务端、Agent（多平台）、Windows 桌面版、压缩包与校验和。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RELEASE="$ROOT/release"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"

echo "[1/6] 构建前端"
npm --prefix frontend run build

echo "[2/6] 构建服务端"
(
  cd backend
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$RELEASE/starbase-server-linux-amd64" .
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$RELEASE/starbase-server-windows-amd64.exe" .
)

echo "[3/6] 构建 Agent"
(
  cd backend
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$RELEASE/starbase-agent-windows-amd64.exe" ./cmd/starbase-agent
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$RELEASE/starbase-agent-linux-amd64" ./cmd/starbase-agent
  CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$RELEASE/starbase-agent-darwin-amd64" ./cmd/starbase-agent
  CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o "$RELEASE/starbase-agent-darwin-arm64" ./cmd/starbase-agent
)

echo "[4/6] 构建 Windows 桌面版"
rm -rf desktop/web/dist
mkdir -p desktop/web
cp -r backend/web/dist desktop/web/dist
(
  cd desktop
  go build -tags production -trimpath -ldflags "-H windowsgui -s -w" -o "$RELEASE/StarBaseDesktop.exe" .
)

echo "[5/6] 打包"
pack_dir="$RELEASE/.pack"
mkdir -p "$pack_dir"

cp "$RELEASE/starbase-agent-windows-amd64.exe" "$pack_dir/starbase-agent.exe"
cat > "$pack_dir/README.txt" <<'TXT'
StarBase Agent
==============
1. 双击 starbase-agent.exe 启动，控制台会显示配对码。
2. 登录网站，打开“查看 -> 本地 Agent”，输入配对码并开启本地模式。
3. Agent 只监听 127.0.0.1:18620，关闭窗口即停止。
TXT
powershell -NoProfile -Command "Compress-Archive -Force -Path '$(cygpath -w "$pack_dir")\\*' -DestinationPath '$(cygpath -w "$RELEASE/StarBase-Agent-Windows-amd64.zip")'" >/dev/null
rm -rf "$pack_dir"
mkdir -p "$pack_dir"

cp "$RELEASE/StarBaseDesktop.exe" "$pack_dir/StarBaseDesktop.exe"
cat > "$pack_dir/README.txt" <<'TXT'
StarBase Desktop
=================
双击 StarBaseDesktop.exe 启动。桌面版把前后端都运行在本机，可直接连接 localhost/内网数据库，不需要账号登录。
数据目录默认 %APPDATA%\StarBaseDesktop。
TXT
powershell -NoProfile -Command "Compress-Archive -Force -Path '$(cygpath -w "$pack_dir")\\*' -DestinationPath '$(cygpath -w "$RELEASE/StarBase-Desktop-Windows-amd64.zip")'" >/dev/null
rm -rf "$pack_dir"

mkdir -p "$pack_dir"
cp "$RELEASE/starbase-agent-linux-amd64" "$pack_dir/starbase-agent"
cp "$RELEASE/starbase-agent-darwin-amd64" "$pack_dir/starbase-agent-darwin-amd64"
tar -czf "$RELEASE/StarBase-Agent-Unix-amd64.tar.gz" -C "$pack_dir" .
rm -rf "$pack_dir"

mkdir -p "$pack_dir"
cp "$RELEASE/starbase-server-linux-amd64" "$pack_dir/starbase-server"
cat > "$pack_dir/README.txt" <<'TXT'
StarBase Server (Linux amd64)
=============================
./starbase-server  默认监听 127.0.0.1:8620，数据目录 ./data。
建议使用 systemd + Nginx 反向代理，并配置 TLS 指向 starbase.store。
TXT
tar -czf "$RELEASE/StarBase-Server-Linux-amd64.tar.gz" -C "$pack_dir" .
rm -rf "$pack_dir"

echo "[6/6] 生成校验和"
(
  cd "$RELEASE"
  sha256sum StarBase-*.zip StarBase-*.tar.gz starbase-server-* starbase-agent-* StarBaseDesktop.exe > SHA256SUMS.txt
)

echo
echo "发布包已生成: $RELEASE"
ls -lh "$RELEASE"