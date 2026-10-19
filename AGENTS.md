# Mizar 光野

风光与旅拍的本地工作台（纯前端，无构建、无依赖、无网络）。本文件是冷启动入口：接手这个项目的任何新任务，先读它。

品牌口径：**对外名字是 Mizar，中文叫光野**；仓名与 Pages 地址仍是 `lumenfield`（发布链接已写进参赛材料，不改名）。用户可见的文案一律用 Mizar；代码注释、`localStorage` 键 `lumenfield.v1`、模块内 `LF` 全局名不动。图标几何只有一个真源 `assets/icons/mark.svg`（侧栏用 CSS mask 引它），改形状就改它，然后 `electron tools/make-icon.mjs` 重出 PNG。

## 当前状态（2026-10-19）

| 项 | 值 |
| --- | --- |
| 位置 | `开发/光野/`（仓根即此目录） |
| 远端 | 公开 `github.com/Harv1y-1314/lumenfield` |
| 形态 | 单页应用，双击 `index.html` 即可；无 npm 依赖、无构建步骤 |
| 视图 | 工作台 / 路书 / 星野 / 精修 / 工具箱，五个都可用 |
| 核对 | 历算 330 项、影像算子 52 项、界面 17 组无头回归全通过；外部参照 JPL DE440s + NOAA 实现，偏差见 docs/验证记录.md |
| 发布门槛 | `bash tools/check.sh` 全绿才允许 push |

## 读代码的顺序

1. `README.md` —— 能做什么、边界在哪
2. `src/core/astro.js` —— 历算核心，界面不许自己算天文量
3. `src/core/imaging.js` —— 影像算子与 `renderPipeline()` 的固定顺序
4. `src/core/skymap.js` —— 投影与绘制；`src/data/` 是数据与手写星群连线
5. `src/ui/app.js` —— 外壳、状态存储、共用控件；`src/ui/*-view.js` 各视图互不引用
6. `docs/DESIGN.md` + `assets/css/tokens.css` —— 界面数值

## 每轮固定动作

```bash
bash tools/check.sh                 # 语法 + 两套测试 + 界面回归 + 发布前自检（本机有 electron 才跑界面那步）
electron tools/shot.mjs             # 只跑界面回归，截图落 $TMPDIR/lf-shots 肉眼过
python3 -m http.server 8795         # 需要真浏览器时再用（file:// 与 http:// 都要顺手验）
node tools/build-stars.js           # 改过星表或连线才需要
```

改了算子必须补一条断言，改了界面必须跑一遍 `shot.mjs` 并对截图肉眼复核。别只跑测试就发布。

## 红线

- **零网络**：运行期不许出现 fetch / XHR / 外链脚本 / CDN。照片不出本机是这产品的立身之本，`tools/check.sh` 会拦。
- **不装依赖**：不引入 npm 包、不引入构建工具。要新能力就先在 `src/core/` 里手写实现，写不出真东西就不做（语义分割、RAW 解码都是这样砍掉的）。
- **算不出来就留白**：云量、光污染、视宁度一律标"自填/需联网"，不许用假数据把界面填满。
- **数据可追源**：任何常数、星表、参照件都要在 docs/数据来源与许可.md 里有条目；`tests/fixtures/` 的外部参照必须能由 `tools/` 里的脚本重新生成。
- **提交身份**：`Harv1y-1314@users.noreply.github.com`；文档与脚本不写绝对用户路径、不写真实姓名邮箱手机号。
- **文案不说人话以外的话**：不写"极致体验""一键大片"，每个数带口径；不加 emoji。
- **界面数值改动要注明**：HIG 没给数字的地方（材质模糊、动效时长）在 `tokens.css` 注释里标"经验值"，不许冒充官方规格。

## 指路

| 要什么 | 去哪 |
| --- | --- |
| 发过什么版本、每轮动了什么 | `docs/迭代总览.md` |
| 用户反馈与取证结论 | `docs/反馈记录.md`（编号 `F-0XX`） |
| 还缺什么、什么值得先做、什么明确不做 | `docs/升级路线.md`（缺口 `G-XX` / 候选 `C-XX`） |
| 为什么这么设计、砍了什么 | `docs/像素蛋糕拆解.md` 的"我们故意不抄的" |
| 实测数字与踩过的坑 | `docs/验证记录.md`（含 13 个被测试抓出来的真 bug） |
| 发布前该核什么、哪些只能肉眼核 | `docs/发布检查.md` |
| 界面令牌与文案约定 | `docs/DESIGN.md`、`assets/css/tokens.css` |
| 重取星表 / 重生成 DE440s 参照 | `tools/fetch-data.sh`、`tools/reference/skyfield_check.py` |
