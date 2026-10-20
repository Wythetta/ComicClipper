#!/usr/bin/env bash
# 把 src/ 打包成 firefox-extension-comic.zip，在 about:debugging 載入
set -euo pipefail
cd "$(dirname "$0")"
rm -f firefox-extension-comic.zip
(cd src && zip -r -X -q ../firefox-extension-comic.zip . -x '.*')
echo "已產生 firefox-extension-comic.zip"
