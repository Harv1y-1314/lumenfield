---
version: 1
name: 光野 LumenField
platform: web (桌面浏览器优先，兼容 iOS Safari)
language: zh-CN
fonts:
  ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
  numeric: '"SF Pro Display", -apple-system, "Helvetica Neue", sans-serif'
  mono: 'ui-monospace, "SF Mono", Menlo, monospace'
type_scale:
  large_title: { size: 26, leading: 32, weight: 600 }
  title_1: { size: 22, leading: 26, weight: 600 }
  title_2: { size: 17, leading: 22, weight: 600 }
  title_3: { size: 15, leading: 20, weight: 600 }
  body: { size: 13, leading: 18, weight: 400, tracking: -0.006 }
  callout: { size: 12, leading: 15, weight: 400 }
  footnote: { size: 10, leading: 13, weight: 400 }
spacing: [4, 8, 12, 16, 20, 24, 32, 40]
radius: { control: 6, card: 10, window: 12, pill: 999 }
layout:
  sidebar: 232
  inspector: 268
  titlebar: 52
  control_height: 22
color_light:
  blue: "#007AFF"
  green: "#34C759"
  orange: "#FF8F00"
  red: "#FF3B30"
  label: "rgba(0,0,0,0.85)"
  secondary_label: "rgba(60,60,43,0.60)"
  separator: "rgba(60,60,43,0.29)"
  background: "#FFFFFF"
  background_secondary: "#F2F2F7"
  fill: "rgba(120,120,128,0.16)"
color_dark:
  blue: "#0A84FF"
  green: "#30D158"
  orange: "#FF9F0A"
  red: "#FF453A"
  label: "rgba(255,255,255,0.85)"
  secondary_label: "rgba(235,235,245,0.60)"
  separator: "rgba(84,84,88,0.60)"
  background: "#000000"
  background_secondary: "#1C1C1E"
  fill: "rgba(120,120,128,0.32)"
materials:
  ultrathin: { blur: 20, saturate: "180%", light_bg: "rgba(255,255,255,0.55)", dark_bg: "rgba(30,30,32,0.45)" }
  regular: { blur: 40, saturate: "180%", light_bg: "rgba(255,255,255,0.72)", dark_bg: "rgba(30,30,32,0.62)" }
  thick: { blur: 60, saturate: "180%", light_bg: "rgba(255,255,255,0.85)", dark_bg: "rgba(30,30,32,0.78)" }
motion:
  durations: [120, 200, 320, 480]
  standard_curve: "cubic-bezier(0.32, 0.72, 0, 1)"
  reduced_motion: "全部退化为 200ms ease 的淡入淡出"
components: [sidebar-nav, toolbar, segmented, slider-row, switch, card, stat, chip, data-table, timeline, stage, filmstrip, dialog, toast]
---

# 设计约定

## 数值来源

字体阶、系统色、明暗两套背景、材质分层来自 Apple Human Interface Guidelines 的 Typography、Color、Materials、Dark Mode、Layout、Motion 六页。HIG 只给定性描述的两处（材质模糊半径与饱和系数、动效时长与曲线）在 `assets/css/tokens.css` 的注释里明确标为"经验值"，不当官方规格使用。

连续圆角（squircle）在 Web 上只有 Chrome 139+ 支持 `corner-shape`，Safari 与 Firefox 不支持，所以本项目统一用 `border-radius` + 1px 内描边高光近似，不写 `@supports` 分支——两套圆角在同一界面里会看出差异。

## 结构

三段式窗口：左侧栏（导航 + 拍摄地 + 日期）、中间工作区、右侧检查器（参数）。这是 macOS 应用的骨架，不是网页的。窄屏（≤1180px）时检查器变成右侧抽屉，≤780px 时侧栏压成顶部横向导航。

层级只铺一层：卡片之间用细分隔线与留白，不允许卡片套卡片。数据密集处（路书表格、直方图读数）用三线表风，表头下 1.5px、行间 1px，不封底。

## 星空界面例外

星图区固定深色（`--sky-deep`），不跟随明暗模式：夜间取景时任何浅色背景都是干扰。星点不用纯白，最亮也压到 `rgb(232,238,255)`，长时间盯着看需要这个。

## 文案

界面文案是摄影师说话的方式，不是产品发布稿：

- 说"到场时间"而不是"最佳体验时刻"。
- 每个数带口径：`-0.833° 为升落`、`蓝调 -6~0°`、`银心取银经 4°`。
- 算不出来的直接留白并写明：云量、光污染、视宁度标成"自填"或"需联网"，不做假数据填充。
- 错误提示说清是哪一屏、什么原因，不写"出了点问题"。

## 无障碍

所有交互控件带 `aria-label`；滑杆读数用等宽数字（`font-variant-numeric: tabular-nums`）避免跳动；焦点环用系统蓝 3px 外发光；对比度按 HIG 的 4.5:1 底线，脚注级小字按 7:1 自查；`prefers-reduced-motion` 下动效全部退化为淡入淡出。
