# 应用内置字体目录

此目录存放随应用打包的 CJK 字体文件（网页服务器与 Electron 桌面端共用同一套）。

## 文件清单

| 文件名 | 字体 | 用途 |
|---|---|---|
| NotoSansSC-Regular.otf | Noto Sans CJK SC（黑体） | 无衬线、现代排版 |
| NotoSerifSC-Regular.otf | Noto Serif CJK SC（宋体） | 衬线、杂志感排版 |
| SHA256SUMS.txt | 校验值 | 替换字体后必须重新生成并核对 |

## 来源与许可证

- 官方仓库：https://github.com/notofonts/noto-cjk （Sans/OTF/SimplifiedChinese 与 Serif/OTF/SimplifiedChinese）
- 许可证：SIL Open Font License 1.1，副本见 `docs/licenses/Noto-CJK-OFL-1.1.txt`

## 渲染行为

渲染器（`src/lib/commerce-image-v4-render.ts`）按“内置字体 → 系统字体”顺序解析；
两个内置字体都缺失且没有可用系统字体时，导出会**明确报错**（不再用字符数估算伪装排版成功）。
缺字信息会写入导出 ZIP 的《未验证提示.txt》。

验证：`node scripts/test-fonts-render.mjs`（校验哈希、字形覆盖、度量确定性与导出可复现性）。
