# 抖音评论接入（脚本模块）

> 本轮把「抖音链接 → 逐字稿」升级成「抖音链接 → 逐字稿 + 评论 → 评论洞察 → 脚本创作」。
> 阿里云/豆包等模型接入见 CHANGELOG；本文只讲评论链路。

## 1. 现在的整体流程

```
脚本页粘贴抖音链接 / 整段分享文案
        ↓
POST /api/script/douyin-transcript        POST /api/script/douyin-comments
   （原有链路，未改动）                        （本轮新增）
   importDouyinVideo → 本地 MP4                  extractDouyinUrl
        ↓                                        ↓
   ffmpeg 抽音 → 豆包语音转写                  DouyinCommentAdapter
        ↓                                        ↓
     逐字稿                                   crawler-service /resolve-comments
        └──────────────┬─────────────────────────┘
                       ↓
              （前端 localStorage 草稿 + 保存时写入 ScriptRecord）
                       ↓
        POST /api/script/comment-insights（DeepSeek，comment-insight-v1）
                       ↓
        CommentInsights + 代表性原评论
                       ↓
   generate / compose / recommend / assistant 四个提示词都带上【观众评论洞察】块
```

评论采集与 ASR **并行**：点「解析逐字稿」时同时发起两条请求，互不等待。
评论失败只影响评论区，逐字稿、脚本生成、推荐方向全部照常（已真机验证，见 §12）。

## 2. 评论能力来源（没有重复造轮子）

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 评论抓取策略 | `crawler-service/server.mjs`（本项目已有） | 三种策略：DouyinComments 授权 Cookie 签名接口 → 抖音公开接口 → yt-dlp。本轮只**增强**它，没有替换 |
| a_bogus 签名 | `external-tools/DouyinComments/douyin.js`（第三方，见 §3） | 由 crawler-service 在沙箱里调用 |
| 分页 | 本轮新增（`fetchDouyinSignedComments` 里的 cursor 循环） | 上游是单页 count 抓取，这里按 `cursor` / `has_more` 循环到 maxComments |
| 回复 | 本轮新增（`fetchDouyinSignedReplies`，默认关闭） | 只对点赞最高的少量主评论抓一页 |
| Cookie | Desktop App 注入的 `DOUYIN_COOKIE_JAR` | 与爆款复刻/逐字稿同源，**没有第二套登录态** |
| 适配层 | `src/lib/video-import/douyin-comments.ts` | 唯一依赖 crawler-service 的地方 |
| 数据模型/清洗/采样/上下文块 | `src/lib/douyin-comments.ts` | 纯函数，无 IO |
| 洞察分析 | `src/app/api/script/comment-insights/route.ts` | DeepSeek + 本地兜底 |

脚本页 UI / 生成链路**不接触** Cookie、cursor、签名与分页。

## 3. 上游项目与 License

- **jiji262/douyin-downloader**（MIT）：本项目 `external-tools/douyin-downloader/` 里的 vendored 副本（`core/comments_collector.py`、`tests/test_comments_collector.py`）本轮**只读参考**，用于确认评论采集的字段与流程；没有把它的代码搬进 src，也没有替换现有下载链路。
- **DouyinComments**（`external-tools/DouyinComments/`，MIT）：实际被复用的是它的 `douyin.js` 签名实现与 `fetch_comments.py` / `fetch_replies.py` 的参数形态；crawler-service 通过沙箱调用 `douyin.js`，没有修改其源码。
- 复用的**思路**（非代码）：cursor/has_more 分页、count 上限、Cookie 注入方式、回复单独接口。
- 声明位置：`external-tools/douyin-importer/THIRD_PARTY_NOTICES.md`（既有约定）与本文 §3；未删除任何上游版权声明。
- 未 vendor 整个仓库：`external-tools/` 里本来就是按需放置的上游目录，本轮没有新增第三方代码到 `src/`。

## 4. CommentRecord Schema（`src/lib/douyin-comments.ts`）

```ts
interface CommentRecord {
  commentId: string;        // 抖音 cid
  awemeId: string;
  text: string;
  createdAt: string;        // ISO；抖音给的是秒级时间戳，已在服务端转换
  likeCount: number;
  replyCount: number;
  user: { userId?: string; secUid?: string; nickname?: string; avatar?: string };
  parentCommentId?: string;
  isReply: boolean;
  ipLocation?: string;      // 抖音返回的 ip_label，例如「黑龙江」
  raw?: Record<string, unknown>;  // 上游原始字段（仅排查用）
}
```

- 字段缺失一律空值，**不伪造**。
- `raw` 只在 crawler-service 里保留精简子集；业务层只消费上面的字段。上游字段变化只需要改 `normalizeDouyinComments()`。

## 5. CommentInsights Schema（`comment-insight-v1`）

```ts
{
  sampleSize: number;
  summary: string;
  highFrequencyTopics: [{ topic, count, evidenceCommentIds[] }];
  highFrequencyQuestions: string[];
  painPoints: string[];
  purchaseBarriers: string[];
  desiredOutcomes: string[];
  productConcerns: string[];
  positiveSignals: string[];
  negativeSignals: string[];
  contentOpportunities: [{ angle, reason, evidenceCommentIds[] }];
  representativeComments: [{ commentId, text, reason, signalType }];
  confidence: "low" | "medium" | "high";
  promptVersion: "comment-insight-v1";
  commentsHash: string;     // 输入指纹，用于判断是否需要重新分析
  generatedAt: string;
  source: "deepseek" | "fallback";
}
```

- `signalType` ∈ question / pain_point / purchase_barrier / positive / negative / content_opportunity，UI 用它挑真正有价值的评论。
- 洞察必须可追溯：结论尽量带 `evidenceCommentIds`。
- 不是舆情情感分析：不做「正面 60%／负面 30%」，只回答「用户最关心什么、最怕什么、为什么还没买、下一條拍什么」。

## 6. 抓取流程细节

1. `POST /api/script/douyin-comments` 接收整段分享文案或链接 → `extractDouyinUrl()` 校验平台。
2. `DouyinCommentAdapter.fetchDouyinComments()`：读 `DOUYIN_COOKIE_JAR`（Netscape → Cookie 头）→ 健康检查 crawler-service → 不可达且是本机地址则**按需拉起**（`node crawler-service/server.mjs`，进程内单例）→ POST `/resolve-comments`。
3. crawler-service：签名策略分页抓主评论（`pageSize`、`maxPages` 有上限），返回归一化评论 + `hasMore`。
4. Adapter → `normalizeDouyinComments()` → `cleanComments()`（去空/去纯表情/去重/压空格/限长）→ 返回给前端。
5. 前端写入 `douyinComments` 状态（随草稿持久化）。

配置（全部可用环境变量覆盖，见 `douyinCommentConfig`）：

| 配置 | 默认 | 环境变量 |
| --- | --- | --- |
| 开关 | 开 | `DOUYIN_COMMENTS_ENABLED=0` 关闭 |
| 单次抓取上限 | 200 | `DOUYIN_COMMENTS_MAX` |
| 每页条数 | 20 | `DOUYIN_COMMENTS_PAGE_SIZE` |
| 抓回复 | 否 | `DOUYIN_COMMENTS_INCLUDE_REPLIES=1` |
| 分析采样量 | 80 | `DOUYIN_COMMENTS_SAMPLE_SIZE` |
| 代表性评论数 | 10 | `DOUYIN_COMMENTS_REPRESENTATIVES` |
| 请求超时 | 60s | `DOUYIN_COMMENTS_TIMEOUT_MS` |
| 重试次数 | 2 | `DOUYIN_COMMENTS_MAX_RETRIES` |
| 评论缓存有效期 | 6h | `DOUYIN_COMMENTS_CACHE_TTL_MS` |

## 7. AI 分析流程

1. 前端拿回评论后自动调 `POST /api/script/comment-insights`（用户不需要点任何按钮）。
2. 服务端：`cleanComments` → `buildAnalysisSample`（高赞 40% + 高回复 20% + 近期 20% + 中位区间补足，**不是只取最高赞**）→ DeepSeek（`deepseek-v4-flash`，温度 0.4）。
3. 提示词硬约束：区分「产品事实」与「观众看法」；样本 <10 条必须说「现有 N 条评论中出现…」；不许编造价格/销量/检测报告；内容机会要能直接变成选题。
4. 失败或未配置 Key → `buildFallbackCommentInsights()` 本地关键词归纳（原始评论仍然完整保留与展示）。
5. `commentsHash` 相同的评论不会重复分析；`promptVersion` 记录本次用的是哪一版提示词。

## 8. 脚本 Agent 怎么用评论

- 前端用 `buildCommentContextBlock(comments, insights)` 生成**紧凑块**：结构化洞察 + 最多 10 条代表性原评论，末尾固定一句「以上是观众看法，不是产品事实」。
- 该块作为 `commentContext` 传给 `generate`（fresh/adapt 两条路）、`compose`、`recommend`；AI 助手则拼进 `context`。
- 服务端 `buildCommentBlock()` 把它放成独立 section【观众评论洞察】，**不会**把 200 条原文塞进提示词。
- 优先级（服务端提示词已写死）：产品事实 > 用户明确需求 > 评论洞察 > 原视频逐字稿 > 其他参考。
- 一条脚本仍然只有一个主要方向：评论有 10 个问题也不许塞进一条脚本。

## 9. Cookie 如何复用

- 只读 Desktop App 注入的 `DOUYIN_COOKIE_JAR`（Netscape 格式），转成 Cookie 头按**单次请求**传给 crawler-service。
- 不新增 Cookie 文件、不新增登录、不读浏览器 Cookie、不落盘日志（日志里对 `cookie=…` 做脱敏）。
- Web 部署时把 `CRAWLER_SERVICE_URL` 指向独立服务；非本机地址时 Adapter **不会**尝试 spawn。

## 10. 缓存与刷新

- 评论随脚本工作区草稿持久化（`director-platform.scriptWorkbenchDraft` 的 `douyinComments`）。
- 打开历史脚本（`?record=`）时，若记录里有 `douyinSource`，直接恢复逐字稿 + 评论 + 洞察，`stage = RESTORED`，**不重新抓取**。
- 只有用户点「刷新评论」才会重新请求；刷新会更新 `fetchedAt` 并在评论变化时重新分析洞察。
- 保存脚本时把 `douyinSource`（url/awemeId/逐字稿/最多 200 条评论/洞察/抓取时间）写进 `ScriptRecord`。

## 11. 失败降级

| 情况 | 结果 |
| --- | --- |
| 评论服务不可达 / 抓取失败 | 评论区显示「暂时未获取到评论」，逐字稿与脚本生成照常 |
| 评论成功但 ASR 失败 | 评论完整保留在草稿与记录里 |
| 洞察 AI 失败 | 保留原始评论 + 本地规则洞察，界面不报错 |
| 抖音字段变化 | 只改 `normalizeDouyinComments()` / crawler-service 的 `normalizeComments()` |
| 签名失效（a_bogus / 风控） | crawler-service 依次回退公开接口与 yt-dlp；仍失败就降级。**不做**验证码绕过、代理池、账号池等反风控动作 |

## 12. 真实验证记录（2026-09-24）

| 用例 | 结果 |
| --- | --- |
| 真实公开视频（`www.douyin.com/video/7590285958164139314`）抓评论 | ✅ 152 条，12 页，4.4s |
| 逐字稿 + 评论并行 | ✅ 逐字稿 179 字，评论 152 条，互不阻塞 |
| AI 评论洞察 | ✅ `sampleSize=80`、`confidence=medium`、含购买阻力与内容机会 |
| UI | ✅ 显示「评论 152」「评论洞察」「购买阻力」，可展开全部 |
| 刷新评论 | ✅ `fetchedAt` 更新 |
| 保存 / 重新打开历史脚本 | ✅ `commentCount=152`，重开为 `RESTORED`，不重新抓 |
| 脚本生成对比 | ✅ 带评论与不带评论两次产出不同；带评论版本体现了评论里的「真假/划算」顾虑 |
| 评论失败隔离 | ✅ 评论服务指向不可达地址时：评论 failed，逐字稿 173 字与脚本生成 196 字均照常 |

## 13. 上游接口变动以后改哪里

1. 字段变了 → `normalizeDouyinComments()`（Adapter 侧）与 crawler-service 的 `normalizeComments()`。
2. 接口路径/参数变了 → `crawler-service/server.mjs` 的 `fetchDouyinSignedComments` / `buildSignedDouyinCommentParams`。
3. 签名算法变了 → 换 `external-tools/DouyinComments/douyin.js`（上游更新）即可，业务层不动。
4. 换评论 Provider（例如自建服务）→ 只改 `src/lib/video-import/douyin-comments.ts` 的实现，UI / 洞察 / 脚本上下文全部不用改。

## 14. Web 部署迁移

- `CRAWLER_SERVICE_URL` 指向部署好的评论服务即可；Adapter 在非本机地址时不会 spawn 子进程。
- 评论数据目前随草稿存 localStorage、随记录存 `ScriptRecord.douyinSource`；上 Web 后按既有 persistence 迁移计划改到服务端存储，字段结构不变。
- 脚本页 UI 只依赖接口返回的 `CommentRecord[]` 与 `CommentInsights`，与运行位置无关。
