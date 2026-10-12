# 模型路由说明书

这份文档给不写代码的人看，讲清楚两件事：**哪个功能在用哪个模型**，以及**想换模型时该改哪里**。

所有模型配置只有两份文件：

| 文件 | 作用 |
| --- | --- |
| `config/model-routing.yaml` | 业务功能（Route）→ 模型别名。**平时只改这个。** |
| `config/models.yaml` | 模型注册表：别名对应哪个真实模型、走哪个 Provider、用哪个环境变量。**只有新增模型时才改。** |

---

## 一、我平时怎么换模型

换某个功能用的模型，**五步**：

1. 打开 `config/model-routing.yaml`。
2. 找到要做那个功能的 Route（例如 `script_generation`）。
3. 把 `model:` 后面的别名改掉（例如从 `opus_5_5` 改成 `deepseek_v4_flash`）。
4. 保存文件。
5. **完全退出并重新打开 App**，让新配置生效。

请放心：**不需要改 TypeScript，也不需要找 Harness。** 模型名、Provider、Base URL、API Key 全部由这两份 YAML 决定，代码只按 Route 名称调用。

---

## 二、所有可用模型别名

下面是从 `config/models.yaml` 读到的全部模型。改 `model-routing.yaml` 时，只能填**别名（alias）**这一列的名字。

| 别名（alias） | 名称（label） | 真实 Model ID | Provider | 能力（中文说明） |
| --- | --- | --- | --- | --- |
| `opus_5_5` | Claude Opus 5.5 | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 文本、视觉理解、结构化输出 |
| `deepseek_v4_flash` | DeepSeek V4 Flash | `deepseek-v4-flash` | DeepSeek | 文本、结构化输出 |
| `doubao_vision` | 豆包视觉理解（Seed 2.0 Lite） | `doubao-seed-2-0-lite-260428` | 火山方舟（豆包） | 文本、视觉理解、结构化输出 |
| `doubao_asr` | 豆包语音转写（Seed 2.0 Lite 音频输入） | `doubao-seed-2-0-lite-260428` | 火山方舟（豆包） | 语音转写 |
| `seedream_5_pro` | 豆包 Seedream 5.0 Pro | `doubao-seedream-5-0-pro-260628` | 豆包 Seedream（生图） | 生图 |
| `seedream_5` | 豆包 Seedream 5.0 | `doubao-seedream-5-0-260128` | 豆包 Seedream（生图） | 生图 |
| `gpt_image_2_5` | GPT Image 2.5（Sunburst，较慢） | `gpt-image-2.5-sunburst-4k` | OriginGateway GPT Image 2.5 | 生图 |
| `gpt_image_2` | GPT Image 2 | `gpt-image-2` | OpenAI 生图 | 生图 |

能力的含义：文本＝普通文字生成；视觉理解＝能看图、看视频画面；结构化输出＝能稳定返回 JSON；生图＝生成图片；语音转写＝把语音变文字。换模型时，**新模型的能力必须覆盖这个功能需要的能力**，否则启动或调用会报错。

---

## 三、功能路由真实总表

这张表就是当前 `config/model-routing.yaml` 的真实内容。Route 一列与配置文件里的 key 完全一致。

| 功能 | Route | 当前 Model Alias | 真实 Model ID | Provider | 一句话用途 |
| --- | --- | --- | --- | --- | --- |
| AI 对话 | `ai_chat` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 对话助手（按需求不回退） |
| 脚本生成 | `script_generation` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 脚本生成器与脚本工作台正文生成 |
| 脚本改稿 | `script_rewrite` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 改某一段、按底稿改、编导助手改稿 |
| 创作方向推荐 | `script_direction_recommendation` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 脚本工作台推荐 3 个方向 |
| 脚本问答 | `script_qa` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 脚本工作台「只问不改」 |
| 参考素材分析 | `script_analysis` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 逐字稿、参考文案、产品文档要点提取 |
| 选题生成 | `topic_generation` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 生成选题 |
| 自然流采访提纲 | `interview_generation` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 生成采访提纲 |
| 拆片分析 | `deconstruction_analysis` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 爆款结构拆解 |
| 剪辑建议 | `editing_plan` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 给剪辑方案 |
| 原创仿写 | `link_deconstruction_rewrite` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 链接拆片后的原创仿写 |
| 评论洞察 | `comment_insight` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 拆片页与评论模块分析 |
| 抖音评论洞察 | `douyin_comment_insight` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 脚本工作台用的抖音评论分析 |
| AI 工作流 | `workflow_ai` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 产品洞察、选题、脚本、复盘等动作 |
| 产品资料结构化 | `product_document_structure` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | Word、文档转产品档案 |
| Skill 安装自检 | `skill_verify` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 验证 Skill 指令能被模型执行 |
| 营销策略层 | `marketing_strategy` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 选策略、定主线 |
| 营销图文案编排 | `marketing_creative_plan` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 画面文案、标题、CTA |
| 营销复盘 | `marketing_review` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 数据回填后的结论与下一步 |
| 图像意图编排 | `image_task_planning` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 生图前的文本编排 |
| 图像任务对话 | `commerce_chat` | `opus_5_5` | `claude-opus-5-5` | TeamoRouter（Claude 中转站） | 图像任务里的任务级聊天 |
| 爆款复刻台词适配 | `replica_dialogue_adaptation` | `deepseek_v4_flash` | `deepseek-v4-flash` | DeepSeek | 爆款复刻台词文案适配（按产品要求继续走 DeepSeek） |
| 爆款复刻提示词润色 | `replica_prompt_refine` | `deepseek_v4_flash` | `deepseek-v4-flash` | DeepSeek | 爆款复刻提示词润色 |
| 爆款复刻对话 | `replica_chat` | `deepseek_v4_flash` | `deepseek-v4-flash` | DeepSeek | 爆款复刻模块内 AI 对话 |
| 爆款复刻自检 | `replica_self_check` | `deepseek_v4_flash` | `deepseek-v4-flash` | DeepSeek | 爆款复刻提示词发布前自检 |
| 产品与竞品图理解 | `product_image_understanding` | `doubao_vision` | `doubao-seed-2-0-lite-260428` | 火山方舟（豆包） | 长图拆解、画面分析 |
| 视频画面理解 | `video_understanding` | `doubao_vision` | `doubao-seed-2-0-lite-260428` | 火山方舟（豆包） | 爆款复刻逐帧分析 |
| 语音转写 | `speech_to_text` | `doubao_asr` | `doubao-seed-2-0-lite-260428` | 火山方舟（豆包） | 抖音视频、直播录音转逐字稿 |
| AI 生图 | `image_generation` | `seedream_5_pro` | `doubao-seedream-5-0-pro-260628` | 豆包 Seedream（生图） | 生图默认模型（界面选模型优先） |

生图 Route 还额外配置了候选顺序：用户选「自动推荐」时，先试 `seedream_5_pro`，再依次试 `gpt_image_2_5`、`gpt_image_2`；修图类任务先试 `gpt_image_2`。

想知道机器上**此刻**解析出来的结果，可以打开只读接口 `GET /api/settings/model-routing`，它会返回每个 Route 的 label、capability、modelAlias、modelId、provider、apiKeyEnv、configured、fallback，并且会带配置校验结果，但**不会返回任何 Key 的值**。

---

## 四、怎么新增模型

分三步：

1. **在 `config/models.yaml` 注册模型。** 在 `models:` 下面新增一个别名，写清 `label`、`provider`、`model_id`、`capabilities`（必要时加 `default_timeout_ms`）。如果这个模型用的是目前还没有的厂商，先在 `providers:` 里加一个 Provider，写清协议、`base_url`、`base_url_env`、`api_key_env`。
2. **确认对应的 API Key 环境变量已经存在。** 新增 Provider 时，它的 `api_key_env` 指向的那个变量（必要时还有 `base_url_env`）必须先配好，否则功能调用时会报「未配置」。
3. **在 `config/model-routing.yaml` 把目标 Route 指向新别名。** 把该 Route 的 `model:` 改成新别名，保存，完全退出并重开 App。

补充说明：**新模型只要走 OpenAI 兼容协议，业务代码不用改。** 在 `models.yaml` 里把 Provider 的 `protocol` 写成 `openai_compatible` 即可，请求格式由适配层处理。只有 Anthropic Messages 这类非 OpenAI 协议，才需要已有适配支持。

---

## 五、环境变量清单

这里只列**名称**，方便对照。**真实 Key 只放在 `.env.local`，绝不写进文档和 YAML。**

| 用途 | 环境变量名 |
| --- | --- |
| DeepSeek Key | `DEEPSEEK_API_KEY` |
| DeepSeek Base URL | `DEEPSEEK_BASE_URL` |
| TeamoRouter（Claude 中转站）Key | `TEAMOROUTER_API_KEY` |
| TeamoRouter Base URL | `TEAMOROUTER_BASE_URL` |
| 火山方舟（豆包）Key | `ARK_API_KEY` |
| 火山方舟（豆包）备用 Key | `DOUBAO_API_KEY` |
| 火山方舟 Base URL | `ARK_BASE_URL` |
| OpenAI Key | `OPENAI_API_KEY` |
| OpenAI Base URL | `OPENAI_BASE_URL` |
| 豆包 Seedream 生图 Key | `COMMERCE_SEEDREAM_API_KEY` |
| 豆包 Seedream 生图 Base URL | `COMMERCE_SEEDREAM_BASE_URL` |
| OpenAI 生图 Key | `COMMERCE_OPENAI_API_KEY` |
| OpenAI 生图 Base URL | `COMMERCE_OPENAI_BASE_URL` |
| OriginGateway GPT Image 2.5 Key | `ORIGIN_GATEWAY_API_KEY` |
| OriginGateway GPT Image 2.5 Base URL | `ORIGIN_GATEWAY_BASE_URL` |

生图的 Key 有备用变量：`COMMERCE_SEEDREAM_API_KEY` 找不到时会用 `ARK_API_KEY`，`COMMERCE_OPENAI_API_KEY` 找不到时会用 `OPENAI_API_KEY`。Base URL 也一样，环境变量优先于 YAML 里的默认地址。GPT Image 2.5 走 OriginGateway（`https://origingateway.com/v1`），Base URL 配成裸域名时系统会自动补 `/v1`。

---

## 六、写错会怎样

配置写错**不会静默换一个模型**，而是会**明确报错**：

- **Route 引用了不存在的模型**：报错会写明「哪个功能 Route 引用了不存在的模型」，并列出可用模型别名。
- **capability 不匹配**：例如视觉理解的 Route 指向了一个没有视觉能力的模型，报错会写明该 Route 需要什么能力、该模型只有哪些能力。
- **Provider 不存在**：模型注册时写的 `provider` 找不到，会报错并列出可用 Provider。
- **Route 不存在**：代码调用了没有登记的 Route，会报错并列出可用 Route。
- **只缺 API Key**：不算配置错误，启动时只打印告警，调用该功能时才报「未配置」。

这些校验在**启动时**就会跑一遍（配置不自洽会直接阻止启动并打印 `[MODEL_ROUTER]` 错误），调用功能时还会再校验一次。另外，主模型**调用失败**时是否换模型，由该 Route 的 `fallback` 决定：写了别的别名才回退，写 `none` 或不写就直接把原因显示出来，不会擅自换模型。

---

## 七、已知例外

下面三处是有意为之的例外，看到它们不等于配置写错：

1. **爆款复刻（`replica_*`）继续走 DeepSeek。** 按产品要求，爆款复刻的四条 Route 固定用 `deepseek_v4_flash`，且都不回退。不要单纯为了「统一用 Opus」把它们改掉。
2. **系统设置里的「生图／文本／视觉连接配置」是 Provider 连接层，不是模型路由层。** 那里配的是「用哪个厂商的连接、填哪个 Key」，对应 `models.yaml` 里的 `connection_store`。生图这类功能仍然支持用户在界面上**显式选模型**，而且**界面选择优先于 Route 默认**；用户选「自动推荐」时才按 Route 里的候选顺序走。所以界面选了模型却没走 `model-routing.yaml` 的默认值，是正常行为。
3. **`src/lib/commerce-image-models.ts` 里会出现 model id。** 它是生图模型的界面标签与画质档位表（负责几个模型在界面上的名字、参考图数量、1K／2K／4K 档位和真实请求像素），属于登记过的例外。它不参与 Route 解析，改 `model-routing.yaml` 时不要动这个文件。

补充登记例外（与 `src/lib/commerce-image-types.ts` 对应）：

- `CommerceImageModel` 是生图接口的取值联合类型，TypeScript 类型无法在运行时读取 YAML，所以只能写成字面量；
  运行时默认模型仍然来自 `config/model-routing.yaml` 的 `image_generation`。
  `node scripts/check-model-routing.mjs` 已把这个文件加入允许清单。
