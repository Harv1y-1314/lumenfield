#!/usr/bin/env bash
# check.sh —— 发布前自检。只写能机器判定的项；界面这一层用无头 Electron 兜住"渲染没崩、
# 主题切了、画布真出图、没横向溢出"，好不好看仍然走 docs/发布检查.md 的人眼判断。
#
# 用法：bash tools/check.sh
#       LF_ONLINE=1 bash tools/check.sh    # 追加与 NOAA 独立实现的联网对照
# 退出码：0 全通过 / 1 有失败项
#
# 只扫"会被提交的东西"：git ls-files -co --exclude-standard，
# 否则 tools/vendor 里 4 MB 的原始星表会把自己吓一跳。
set -uo pipefail
cd "$(dirname "$0")/.."

fails=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails + 1)); }
note() { printf '       %s\n' "$1"; }
sec() { printf '\n── %s\n' "$1"; }

FILES=()
while IFS= read -r line; do FILES+=("$line"); done < <(git -c core.quotePath=false ls-files -co --exclude-standard 2>/dev/null)
if [ "${#FILES[@]}" = 0 ]; then
  while IFS= read -r line; do FILES+=("$line"); done < <(find . -type f -not -path './.git/*' -not -path './tools/vendor/*')
fi
# 自检脚本自己写着这些模式，扫到自己会一路假阳性，所以先把自己摘出去
scan() { printf '%s\n' "${FILES[@]}" | grep -v '^tools/check.sh$' | xargs grep -InE "$1" -- 2>/dev/null; }
# 危险构造只在运行时代码里查，别拿自检脚本自己当靶子
scan_src() { printf '%s\n' "${FILES[@]}" | grep -E '^src/|^index.html$' | grep -v '^tools/check.sh$' | xargs grep -InE "$1" -- 2>/dev/null; }
scanned() { printf '（扫描 %s 个待提交文件）\n' "${#FILES[@]}"; }

sec "语法"
js=0
for f in "${FILES[@]}"; do
  case "$f" in *.js|*.mjs) js=$((js + 1)); node --check "$f" || fail "语法不通：$f" ;; esac
done
pass "$js 个 JS 文件通过 node --check"
python3 -m py_compile tools/reference/skyfield_check.py 2>/dev/null && pass "取样脚本可编译" || fail "取样脚本编译失败"

sec "测试"
node tests/astro.test.mjs > /tmp/lf-astro.log 2>&1 && pass "历算：$(tail -1 /tmp/lf-astro.log)" || { fail "历算未通过"; tail -8 /tmp/lf-astro.log; }
node tests/imaging.test.mjs > /tmp/lf-img.log 2>&1 && pass "影像：$(tail -1 /tmp/lf-img.log)" || { fail "影像未通过"; tail -8 /tmp/lf-img.log; }
[ "${LF_ONLINE:-0}" = 1 ] && { LF_ONLINE=1 node tests/astro.test.mjs > /tmp/lf-on.log 2>&1 && pass "联网对照：$(grep -c '^ok' /tmp/lf-on.log) 项通过" || fail "联网对照有失败项"; }

sec "点开即用"
miss=0
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  case "$ref" in http*|data:*|\#*) continue ;; esac
  [ -f "${ref%%\?*}" ] || { fail "入口引用了不存在的文件：$ref"; miss=1; }
done < <(grep -oE '(src|href)="[^"]+"' index.html | sed -E 's/.*"([^"]+)"/\1/')
[ "$miss" = 0 ] && pass "index.html 引用的本地资源全部存在"
scan_src 'fetch\(|XMLHttpRequest|new Worker\(' > /dev/null 2>&1 \
  && { fail "存在本地 fetch/XHR：file:// 下会被浏览器拒绝"; scan 'fetch\(|XMLHttpRequest' | head -3 | sed 's/^/       /'; } \
  || pass "零 fetch，file:// 双击可跑"
grep -qE '<script[^>]+src="https?:|<link[^>]+href="https?:|@import url\("?https?:' index.html assets/css/*.css \
  && fail "有 CDN/外链依赖，断网打不开" || pass "无 CDN 与外链，断网可用"

sec "界面"
# 无头 Electron 跑 17 组：五个视图 × 明暗 × 宽窄屏、拖放导入、两套投影。
# Electron 只是开发期工具，运行期仍然零依赖，所以本机没有就跳过而不是失败。
if command -v electron > /dev/null 2>&1; then
  electron tools/shot.mjs > /tmp/lf-ui.log 2>&1 \
    && pass "界面无头回归：$(tail -1 /tmp/lf-ui.log | sed -E 's/，?截图在.*//')" \
    || { fail "界面无头回归有失败项"; grep '^FAIL' /tmp/lf-ui.log | head -6 | sed 's/^/       /'; }
else
  note "本机无 electron，跳过界面无头回归（手动跑：electron tools/shot.mjs）"
fi

sec "外部请求面"
if scan '(fetch|XMLHttpRequest|\.src|new Worker)\s*\(?["'"'"']https?://' > /dev/null 2>&1; then
  fail "有代码在运行期请求外部 URL"
  scan '(fetch|XMLHttpRequest|\.src|new Worker)\s*\(?["'"'"']https?://' | head -3 | sed 's/^/       /'
else
  pass "运行期零网络请求（照片不外传这件事可验证）"
fi

sec "危险构造"
scan_src "e''val\(|new Function\(|document\.write|insertAdjacentHTML" > /dev/null 2>&1 \
  && { fail "出现字符串求值或写入式 DOM API"; scan_src "e''val\(|new Function\(|document\.write|insertAdjacentHTML" | head -4 | sed 's/^/       /'; } \
  || pass "无 eval / new Function / document.write"
ih=$(scan_src 'innerHTML' | wc -l | tr -d ' ')
if [ "$ih" != 0 ]; then
  note "innerHTML 共 $ih 处，逐条确认只喂仓内写死的图标 SVG："
  scan_src 'innerHTML' | sed 's/^/       /'
  bad=$(scan_src 'innerHTML' | grep -vE 'ICONS|k === .html.|内联 SVG' | wc -l | tr -d ' ')
  [ "$bad" = 0 ] && pass "innerHTML 只接常量图标" || fail "$bad 处 innerHTML 可能接了外部数据"
else
  pass "无 innerHTML"
fi

sec "敏感信息"
scanned
if scan "$(id -un)" > /dev/null 2>&1; then fail "出现本机用户名"; scan "$(id -un)" | head -3 | sed 's/^/       /'; else pass "无本机用户名"; fi
if scan '/Use[rs]/[a-zA-Z]' > /dev/null 2>&1; then fail "出现绝对用户路径"; scan '/Use[rs]/[a-zA-Z]' | head -4 | sed 's/^/       /'; else pass "无绝对用户路径"; fi
if scan '(ghp_[A-Za-z0-9]{20,}|dt-[A-Za-z0-9]{8,}|drt-[A-Za-z0-9]{8,}|pt-[A-Za-z0-9]{10,}|BEGIN [A-Z]*PRIVAT[E]|-----BEGIN)' > /dev/null 2>&1; then
  fail "疑似令牌或私钥片段"; scan '(ghp_[A-Za-z0-9]{20,}|dt-[A-Za-z0-9]{8,}|pt-[A-Za-z0-9]{10,}|BEGIN [A-Z]*PRIVAT[E])' | head -3 | sed 's/^/       /'
else
  pass "无令牌与私钥片段"
fi
# 手机号只按号段判，别拿 [0-9]{11} 乱抓——天文常数 360.98564736629 就能撞上
if scan '[^0-9.]1[3-9][0-9]\{1\}[0-9]{9}[^0-9.]' > /dev/null 2>&1 || scan '(^|[^0-9.])1[3-9][0-9]{9}([^0-9.]|$)' > /dev/null 2>&1; then
  fail "疑似 11 位手机号"; scan '(^|[^0-9.])1[3-9][0-9]{9}([^0-9.]|$)' | head -3 | sed 's/^/       /'
else
  pass "无手机号样式数字"
fi
if scan '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | grep -vE 'noreply\.github|example\.' > /dev/null 2>&1; then
  fail "出现真实邮箱"; scan '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | grep -vE 'noreply\.github|example\.' | head -3 | sed 's/^/       /'
else
  pass "无真实邮箱"
fi

sec "文案与仓库卫生"
if scan 'Generated by|AI 生成|由 AI 生|ChatGPT|Claude|GPT-[0-9]|Lorem ipsum|TODO[:：]|FIXME|XXX|🚀|✨|🎉|💡|✅' > /dev/null 2>&1; then
  fail "有模板腔、AI 痕迹字样或待办残留"
  scan 'Generated by|AI 生成|由 AI 生|ChatGPT|Claude|GPT-[0-9]|Lorem ipsum|TODO[:：]|FIXME|🚀|✨|🎉' | head -6 | sed 's/^/       /'
else
  pass "无 AI 痕迹字样、无 TODO/FIXME、无 emoji 装饰"
fi
big=0
for f in "${FILES[@]}"; do
  sz=$(wc -c < "$f" | tr -d ' ')
  [ "$sz" -gt 1228800 ] && { fail "超大文件（$((sz / 1024)) KB）：$f"; big=1; }
done
[ "$big" = 0 ] && pass "无 >1.2MB 的待提交文件"
[ -f LICENSE ] || fail "缺 LICENSE"
if [ "$(head -1 LICENSE)" = "MIT License" ] && ! tail -3 LICENSE | grep -q '本仓库另含'; then
  pass "LICENSE 是纯 MIT 正文"
else
  fail "LICENSE 正文被改动，扫描器可能不认"
fi
[ -f README.md ] && [ -f docs/DESIGN.md ] && pass "README 与设计令牌在" || fail "缺 README 或 DESIGN"
grep -q 'src/data/sites.js' index.html && [ -f src/data/sites.js ] && pass "站点数据已挂进入口" || fail "站点数据未挂进入口"

printf '\n'
[ "$fails" = 0 ] && echo "发布前自检：全部通过" || echo "发布前自检：$fails 项未过"
exit $((fails > 0))
