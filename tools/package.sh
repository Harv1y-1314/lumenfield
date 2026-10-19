#!/usr/bin/env bash
# package.sh —— 打一个可直接双击的分发包
#
# 产物是 zip，解开就是整个站点，双击里面的 index.html 即可运行。
# 不出 .app/dmg：那需要签名与公证，未签名的 app 在别人机器上会被 Gatekeeper 拦下，
# 反而破坏"点开即用"；Pages 链接与 zip 两条路已经够评委上手。
#
# 为什么用 python 的 zipfile 而不是系统 `zip`：docs/ 下是中文文件名，Info-ZIP 只在
# locale 认得 UTF-8 时才置上名称的 bit 11，而 macOS 自带 zip 在非 UTF-8 环境下会写成
# cp437 且**不置标志位**——Windows 资源管理器解压就得到一串乱码名，README 里的相对链接全断。
# zipfile 对非 ASCII 名称一定置标志位，且不受本机 locale 影响。
set -uo pipefail
cd "$(dirname "$0")/.."
ver=${1:-v1.0.0}
out="dist/lumenfield-${ver}.zip"
mkdir -p dist
rm -f "$out"
git -c core.quotePath=false ls-files -co --exclude-standard | grep -v '^dist/' \
  | python3 -c '
import sys, zipfile
names = [l.rstrip("\n") for l in sys.stdin if l.strip()]
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for n in sorted(names):
        z.write(n, n)
print("写入 %d 个文件" % len(names))
' "$out"
python3 - "$out" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = [i.filename for i in z.infolist()
       if any(ord(c) > 127 for c in i.filename) and not (i.flag_bits & 0x800)]
size = __import__('os').path.getsize(sys.argv[1])
if bad:
    print('FAIL：以下条目没置 UTF-8 名称标志位：', *bad, sep='\n  ')
    sys.exit(1)
print('打包完成：%s（%d KB，%d 个文件，非 ASCII 名称已全部置 UTF-8 标志位）'
      % (sys.argv[1], size // 1024, len(z.infolist())))
PY
