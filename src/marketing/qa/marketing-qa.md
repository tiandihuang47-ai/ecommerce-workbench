---
id: marketing-qa
label: 营销质检
version: "1"
failStatusCode: MARKETING_INTENT_FAILED
checks:
  - id: product_fidelity
    label: 商品还原度
    required: true
    description: 生成图中的商品颜色、版型、结构、标识是否与参考图一致。
  - id: marketing_intent
    label: 营销意图执行
    required: true
    description: 是否真正执行了用户要求的营销策略，而不是退化成普通场景图。
  - id: selling_point_presence
    label: 卖点是否出现
    required: true
    description: 要求出现的卖点是否真的在画面文案或视觉中体现。
  - id: text_requirement
    label: 文字要求
    required: true
    description: 用户要求画面文字时，画面是否真的有清晰可读的中文营销文字。
  - id: message_hierarchy
    label: 信息层级
    required: true
    description: 是否有明确的主标题与辅助信息层级，而不是一堆同级文字。
  - id: platform_fit
    label: 平台适配
    required: true
    description: 是否符合目标平台的内容风格与文字规范。
  - id: generic_image
    label: 通用图检测
    required: true
    description: 是否又退化成没有营销结构的普通人物图或场景图。
  - id: primary_message
    label: 单一主主题
    required: true
    description: 是否只有一个清晰主主题，没有同时主打多个卖点。
  - id: information_overload
    label: 信息过载
    required: true
    description: 主卖点是否 1 个、辅助卖点是否不超过 3 个、文字密度是否受控。
  - id: copy_accuracy
    label: 文案一致性
    required: true
    description: 画面上的中文文案是否与计划一致，没有错字或缺失。
  - id: text_readability
    label: 文字可读性
    required: true
    description: 中文是否清晰可读、不遮挡主体；程序排版时应天然满足。
  - id: truthfulness
    label: 真实性
    required: true
    description: 是否出现产品资料中不存在的价格、销量、认证、功效或评价。
---

## 说明

营销质检与生图成功是两件事。图片生成成功，不代表营销任务成功。

当用户明确要求营销文字和卖点时，如果最终画面没有任何文字或卖点结构，必须标记为 MARKETING_INTENT_FAILED / TEXT_REQUIRED_MISSING。

商品跑样标记为 PRODUCT_FIDELITY_FAILED；信息堆砌标记为 INFORMATION_OVERLOAD；文案与计划不一致标记为 COPY_MISMATCH。

生图 API 成功（ImageGenerationSuccess）与营销任务成功（MarketingTaskSuccess）必须分开记录。

视觉能力可用时用视觉模型核对文字与商品；不可用时明确记录 unavailable，不得假装识别成功。
