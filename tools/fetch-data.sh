#!/usr/bin/env bash
# fetch-data.sh —— 取回生成星表需要的第三方原始数据（不入库，见 .gitignore）
#
# 用法：bash tools/fetch-data.sh
# 之后：node tools/build-stars.js
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p tools/vendor
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
base=https://raw.githubusercontent.com/brettonw/YaleBrightStarCatalog/master

get() { # get <url> <落盘名> <最小字节>
  local url="$1" out="tools/vendor/$2" min="$3"
  if [ -f "$out" ] && [ "$(wc -c < "$out" | tr -d ' ')" -ge "$min" ]; then
    printf '  已有 %s（%s B）\n' "$2" "$(wc -c < "$out" | tr -d ' ')"; return 0
  fi
  curl -sSL --fail -m 180 -A "$UA" -o "$out" "$url" || { printf '  拉取失败：%s\n' "$url"; return 1; }
  local size; size=$(wc -c < "$out" | tr -d ' ')
  [ "$size" -ge "$min" ] || { printf '  体积异常（%s B < %s B）：%s\n' "$size" "$min" "$2"; return 1; }
  printf '  取回 %s（%s B）\n' "$2" "$size"
}

echo "取 Yale BSC5 与 IAU 专名表（MIT）"
get "$base/bsc5.json"            bsc5.json            4000000
get "$base/starNames-IAU.txt"    starNames-IAU.txt    6000
get "$base/LICENSE"              LICENSE-brettonw-YaleBrightStarCatalog 900

echo
echo "下一步：node tools/build-stars.js"
