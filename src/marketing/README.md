# src/marketing · 营销生图配置

这个目录是整个营销生图的「可调教部分」。改营销风格、商品高保真、中文排版、质检，
优先改这里的 Markdown，不要改核心代码。

## 目录说明

- strategies/       营销策略（痛点对比、场景带入、详情卖点、价格锚点、身份代入、对标复刻）
- platforms/        平台风格（小红书、抖音、电商详情）
- copy/             文案规则（标题、卖点、行动引导）
- product-fidelity/ 商品高保真规则（颜色、版型、绗缝、Logo、印花、袖口等必须锁定的特征）
- typography/       中文营销排版规则（三套模板、字号、安全区、配色；文字由程序渲染）
- qa/               营销质检规则
- generated/        由上面的 Markdown 自动生成的 JSON，不要手改
- engine/           引擎代码（商品事实 / 意图 / 策略 / 高保真 / 创意 / 排版 / Prompt 编译 / 质检 / 编排）

## 修改流程

1. 直接编辑对应的 .md 文件（头部 YAML 是配置，正文是给模型的策略说明）。
2. 运行 npm run marketing:build 重新生成配置。
   日常 npm run dev 和 npm run build 会自动执行，通常不用手动跑。
3. 运行 npm run test:marketing-engine 确认 5 个标准案例没有被改坏。

## 常见问题改哪里

- 图太普通 / 痛点不够 / 场景不够 → strategies/*.md
- 不像小红书 / 抖音 / 详情 → platforms/*.md
- 文案太弱 / 太广告 → copy/*.md
- 衣服跑样 / Logo 变了 → product-fidelity/fidelity-rules.md
- 中文乱码 / 排版太乱 / 文字太多 → typography/typography-rules.md
- 废图被放行 / 质检误判 → qa/marketing-qa.md

## 新增策略

复制一个 strategies/*.md，改 id / label / version / matchKeywords / 结构 / 默认值，
重新 build 即可。引擎会自动读取；只有涉及全新页面类型时才需要动 engine 代码。

## 版本与回退

- 每个文件头部的 version 是该规则版本。
- 建议升级时新建版本文件，验证通过再替换，不要直接覆盖。
- 每次任务都会记录当时使用的版本号与配置指纹，效果变差可以快速回退。

更完整的说明见 docs/MARKETING_IMAGE_ENGINE.md。
