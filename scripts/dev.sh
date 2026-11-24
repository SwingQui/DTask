#!/bin/zsh
set -e
cd "$(dirname "$0")/.."

export PATH="$PWD/.tools/node/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node。请先安装 Node 22+，或把 Node 解压到 .tools/node。"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，安装依赖…"
  npm install
fi

exec npm run dev