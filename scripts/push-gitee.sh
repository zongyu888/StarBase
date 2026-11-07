#!/usr/bin/env bash
# 把当前仓库镜像到 Gitee。
# 用法：GITEE_REPO=https://gitee.com/<你的用户名>/StarBase.git ./scripts/push-gitee.sh
set -euo pipefail

REPO="${GITEE_REPO:-}"
if [ -z "$REPO" ]; then
  echo "用法：GITEE_REPO=https://gitee.com/<用户名>/StarBase.git ./scripts/push-gitee.sh"
  echo "提示：可先在 Gitee 网页中「从 GitHub 导入仓库」，再执行本脚本推送后续更新。"
  exit 1
fi

if ! git remote get-url gitee >/dev/null 2>&1; then
  git remote add gitee "$REPO"
else
  git remote set-url gitee "$REPO"
fi

git push gitee main --tags
echo "已推送到 Gitee: $REPO"