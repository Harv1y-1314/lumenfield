#!/usr/bin/env bash
# package.sh —— 打一个可直接双击的分发包
#
# 产物是 zip，解开就是整个站点，双击里面的 index.html 即可运行。
# 不出 .app/dmg：那需要签名与公证，未签名的 app 在别人机器上会被 Gatekeeper 拦下，
# 反而破坏"点开即用"；Pages 链接与 zip 两条路已经够评委上手。
set -uo pipefail
cd "$(dirname "$0")/.."
ver=${1:-v1.0.0}
out="dist/lumenfield-${ver}.zip"
mkdir -p dist
rm -f "$out"
git -c core.quotePath=false ls-files -co --exclude-standard | grep -v '^dist/' | zip -q "$out" -@
printf '打包完成：%s（%s KB，%s 个文件）\n' "$out" \
  "$(( $(wc -c < "$out") / 1024 ))" "$(unzip -l "$out" | tail -1 | awk '{print $2}')"
