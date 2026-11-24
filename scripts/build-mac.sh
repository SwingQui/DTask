#!/bin/zsh
set -e
cd "$(dirname "$0")/.."

export PATH="$PWD/.tools/node/bin:$PATH"

npm run typecheck
npm run build
npx electron-builder --mac dmg
echo
echo "安装包在 dist/ 目录。"