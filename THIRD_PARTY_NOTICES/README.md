# 第三方声明

本仓库的 `LICENSE`（MIT，版权人 `Harv1y-1314`）**只覆盖本仓的代码与文档**，不覆盖随仓分发的第三方数据。这一页把每一层的来源、许可与引用方式写清，避免把"封装的许可"当成"数据的许可"。

## 一、恒星星表（`src/data/stars.js`，3249 颗）

分两层，别混：

| 层 | 是什么 | 许可 | 随仓分发的方式 |
| --- | --- | --- | --- |
| 封装 | Bretton Wade 整理的 Yale BSC5 JSON（`bsc5.json`，本仓按 `tools/fetch-data.sh` 取回后生成 `stars.js`） | MIT（Copyright (c) 2016 Bretton Wade） | 正文逐字保留在 `THIRD_PARTY_NOTICES/brettonw-YaleBrightStarCatalog-MIT.txt`，随本仓一起分发——MIT 要求"所有副本必须包含此许可"，所以这份正文**必须**在仓里，不能只留在被 `.gitignore` 挡掉的 `tools/vendor/` |
| 星表本体 | Yale Bright Star Catalogue 第 5 版（Hoffleit & Jaschek, 1991；Yale University Observatory 发布，NASA ADC 与 CDS/VizieR 均有分发） | 该星表是已发表的天文实测数据集，历史上未附开放许可条款，通行做法是**自由使用 + 请求引用** | 本仓只取其中 3249 条的坐标、星等、颜色等**实测数值**（事实数据），并在下方给出正式引用 |

引用：`Hoffleit, D., Jaschek, C., The Bright Star Catalogue, 5th revised edition (1991), Bibcode: 1991bsc..book.....H.`

一句实话：本仓不主张对星表内容拥有版权，也不主张 MIT 覆盖了它；MIT 覆盖的是我们写的代码与 Wade 的 JSON 封装。目录编号不写死在文档里——可核的是作者、年份与 Bibcode，编号随镜像站而异。

## 二、IAU 专名对照（生成 `stars.js` 里的 `labels`）

`tools/vendor/starNames-IAU.txt` —— 取自同一个 brettonw 仓库（同 MIT，见上面正文），用于把拜耳/弗兰斯蒂德键映射到通用专名。原始来源是 IAU 命名工作组的公开对照表；本仓只入库生成结果（专名字符串），不入库该 txt。

## 三、DE440s 参照件（`tests/fixtures/de440s.json`）

由 `tools/reference/skyfield_check.py` 用 Skyfield（MIT）+ JPL DE440s 星历表生成，只用于测试比对。JPL 星历表由 NASA 资助、可免费用于任何用途（含商业），Skyfield 的许可见其上游项目。生成命令与本仓数值口径见 `docs/验证记录.md`。

## 四、拍摄地预设（`src/data/sites.js`，40 个点）

**自编数据，不是从任何数据集抄来的**：每个点是公开景区或成熟机位的中心坐标，海拔取该处公开标注值，时区取所在国现行偏移。用途是"给一个起点"，不是"精确到米的机位"——界面与文档一律按近似值对待，用户可就地用数字框改成自己的机位。

因此这一份没有第三方许可问题，但也**没有精度承诺**：其中"光污染极低（Bortle 1–2）"一类描述是主观估计，与本仓"算不出来的东西不假装能算"这条一致，任何需要真实测量的量在界面上都标成自填。

## 五、字体与图标

界面用系统字体栈（`-apple-system` → SF Pro / PingFang SC），**不分发任何字体文件**；图标全部为本仓手写的内联 SVG 与 `assets/icons/` 下的原创几何，不使用 SF Symbols 字体或素材。详见 `docs/数据来源与许可.md`。
