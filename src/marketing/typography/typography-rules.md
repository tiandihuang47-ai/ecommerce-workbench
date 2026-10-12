---
id: typography-rules
label: 中文营销排版
version: "1"
textMode: overlay
templates: [pain_comparison, scenario_hook, detail_benefit]
headlineMaxChars: 18
subheadlineMaxChars: 22
sellingPointMaxChars: 10
maxSellingPoints: 3
defaultFontFamily: sans
palette:
  headlineColor: "#FFFFFF"
  subheadlineColor: "#FFFFFF"
  sellingPointColor: "#FFFFFF"
  ctaColor: "#FFFFFF"
  panelColor: "#1F1A17"
  panelOpacity: 0.42
geometry:
  pain_comparison:
    headline: { x: 0.06, y: 0.05, width: 0.88, height: 0.2, fontSize: 0.058, fontWeight: 800, lineHeight: 1.18, align: left }
    subheadline: { x: 0.06, y: 0.25, width: 0.66, height: 0.09, fontSize: 0.03, fontWeight: 600, lineHeight: 1.3, align: left }
    comparison_left: { x: 0.05, y: 0.64, width: 0.43, height: 0.13, fontSize: 0.031, fontWeight: 700, lineHeight: 1.25, align: left, background: "#1F1A17", backgroundOpacity: 0.5 }
    comparison_right: { x: 0.52, y: 0.64, width: 0.43, height: 0.13, fontSize: 0.031, fontWeight: 700, lineHeight: 1.25, align: left, background: "#7B2D35", backgroundOpacity: 0.62 }
    selling_point: { x: 0.06, y: 0.4, width: 0.52, height: 0.062, gap: 0.078, fontSize: 0.027, fontWeight: 600, lineHeight: 1.2, align: left, background: "#1F1A17", backgroundOpacity: 0.46 }
    cta: { x: 0.3, y: 0.88, width: 0.4, height: 0.07, fontSize: 0.03, fontWeight: 600, lineHeight: 1.2, align: center, background: "#7B2D35", backgroundOpacity: 0.7 }
  scenario_hook:
    headline: { x: 0.07, y: 0.07, width: 0.86, height: 0.2, fontSize: 0.056, fontWeight: 800, lineHeight: 1.18, align: left }
    subheadline: { x: 0.07, y: 0.28, width: 0.7, height: 0.09, fontSize: 0.029, fontWeight: 600, lineHeight: 1.3, align: left }
    selling_point: { x: 0.07, y: 0.74, width: 0.6, height: 0.06, gap: 0.072, fontSize: 0.026, fontWeight: 600, lineHeight: 1.2, align: left, background: "#1F1A17", backgroundOpacity: 0.42 }
    cta: { x: 0.32, y: 0.89, width: 0.36, height: 0.065, fontSize: 0.028, fontWeight: 600, lineHeight: 1.2, align: center, background: "#7B2D35", backgroundOpacity: 0.68 }
  detail_benefit:
    headline: { x: 0.06, y: 0.05, width: 0.88, height: 0.16, fontSize: 0.05, fontWeight: 800, lineHeight: 1.18, align: left }
    subheadline: { x: 0.06, y: 0.21, width: 0.8, height: 0.08, fontSize: 0.028, fontWeight: 600, lineHeight: 1.3, align: left }
    selling_point: { x: 0.06, y: 0.36, width: 0.56, height: 0.07, gap: 0.09, fontSize: 0.028, fontWeight: 600, lineHeight: 1.2, align: left, background: "#1F1A17", backgroundOpacity: 0.44 }
    cta: { x: 0.3, y: 0.88, width: 0.4, height: 0.07, fontSize: 0.028, fontWeight: 600, lineHeight: 1.2, align: center, background: "#7B2D35", backgroundOpacity: 0.68 }
fonts:
  sans: "PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
  serif: "Songti SC, Noto Serif CJK SC, serif"
  rounded: "PingFang SC, Arial Rounded MT Bold, sans-serif"
---

## 说明

生图模型只负责画干净底图并预留文案安全区；中文营销文字由程序用真实系统字体渲染，再叠加到底图上。

这样可以保证：字是正确的、不会乱码、可以修改、可以重新渲染，不把文字烧死在模型结果里。

V1 只做三套模板：pain_comparison、scenario_hook、detail_benefit。每套支持主标题、副标题、1 到 3 个卖点、可选行动引导。

以后用户说「排版太乱」「字号太小」「文字太多」，主要改这个文件。
