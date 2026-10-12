import {
  deconstructionRules,
  editingRules,
  naturalInterviewRules,
  scriptStructureRules,
  storeContentRules,
  type ScriptType,
  type TopicDirection,
  type VideoType,
  viralElementRules
} from "@/data/director-rules";

export type FormValue = string | string[];
export type ToolInput = Record<string, FormValue>;

export interface GeneratedSection {
  title: string;
  content: string;
}

export async function generateWithAI(toolName: string, input: ToolInput): Promise<GeneratedSection[] | null> {
  void toolName;
  void input;
  // Reserved for DeepSeek / OpenAI / Gemini.
  // Suggested future shape: send toolName, user input, and director-rules context to an API route.
  return null;
}

function value(input: ToolInput, key: string, fallback = "") {
  const raw = input[key];
  if (Array.isArray(raw)) {
    return raw.join("、") || fallback;
  }

  return raw?.trim() || fallback;
}

function values(input: ToolInput, key: string, fallback: string[]) {
  const raw = input[key];
  if (Array.isArray(raw) && raw.length > 0) {
    return raw;
  }

  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }

  return fallback;
}

function scriptTypeFromDirection(direction: string): ScriptType {
  if (direction === "晒过程" || direction === "聊观点" || direction === "讲故事") {
    return direction;
  }

  return "教知识";
}

function section(title: string, lines: string[]) {
  return {
    title,
    content: lines.filter(Boolean).join("\n")
  };
}

export function stringifyResult(result: GeneratedSection[]) {
  return result.map((item) => `【${item.title}】\n${item.content}`).join("\n\n");
}

export function generateTopics(input: ToolInput): GeneratedSection[] {
  const industry = value(input, "industry", "你的行业");
  const product = value(input, "product", "产品/服务");
  const audience = value(input, "audience", "目标人群");
  const purpose = value(input, "purpose", "获客");
  const direction = value(input, "direction", "教知识") as TopicDirection;
  const selectedElements = values(input, "viralElements", ["成本", "人群", "反差", "头牌"]);
  const directionType = scriptTypeFromDirection(direction);
  const templates = [
    "{audience}第一次做{product}，最容易踩的 3 个坑",
    "为什么有些人花更少的钱，反而把{product}做得更好",
    "{industry}里外行不知道的一个离谱真相",
    "我替{audience}试了最不推荐的{product}方案",
    "{audience}别急着下单，先看懂这 4 个判断标准",
    "如果重新选择一次，{audience}一定要避开这个决定",
    "{industry}头部玩家都在做的事，普通人到底要不要跟",
    "{product}看起来差不多，为什么结果差这么多",
    "{audience}最该省的不是钱，而是这一步试错",
    "用自然聊天问出{industry}老板不愿明说的判断标准"
  ];

  const lines = templates.map((template, index) => {
    const elementName = selectedElements[index % selectedElements.length];
    const rule = viralElementRules.find((item) => item.name === elementName) ?? viralElementRules[index % viralElementRules.length];
    const scriptName = direction === "自然流" ? "自然流采访/观点提炼" : scriptStructureRules[directionType].structures[index % scriptStructureRules[directionType].structures.length].name;
    const title = template
      .replaceAll("{industry}", industry)
      .replaceAll("{product}", product)
      .replaceAll("{audience}", audience);
    const hook = rule.hookPatterns[index % rule.hookPatterns.length]
      .replaceAll("{人群}", audience)
      .replaceAll("{目标人群}", audience)
      .replaceAll("{产品}", product)
      .replaceAll("{产品/服务}", product)
      .replaceAll("{行业}", industry)
      .replaceAll("{行业事项}", product)
      .replaceAll("{低成本}", "更低成本")
      .replaceAll("{低价}", "低价")
      .replaceAll("{高价}", "高价")
      .replaceAll("{头牌对象}", `${industry}头部案例`);

    return [
      `${index + 1}. ${title}`,
      `   爆款元素：${rule.name}。${rule.definition}`,
      `   适合结构：${scriptName}，内容目的偏向「${purpose}」。`,
      `   开头钩子：${hook}`
    ].join("\n");
  });

  return [
    section("10 个短视频选题", lines),
    section("拍摄提醒", [
      "不要把选题写成课堂标题，标题里要出现人群、冲突、成本、反差或结果。",
      "如果其中一条数据好，按文档里的主题 IP 方法继续叠加爆款元素，做成系列。"
    ])
  ];
}

export function generateScript(input: ToolInput): GeneratedSection[] {
  const topic = value(input, "topic", "一个能解决用户真实问题的选题");
  const industry = value(input, "industry", "你的行业");
  const product = value(input, "product", "产品/服务");
  const audience = value(input, "audience", "目标人群");
  const sellingPoint = value(input, "sellingPoint", "靠谱、专业、能解决问题");
  const painPoint = value(input, "painPoint", "担心花钱踩坑、效果不好");
  const materials = value(input, "materials", "口播、产品细节、服务过程、客户案例");
  const scriptType = value(input, "scriptType", "教知识") as ScriptType;
  const rule = scriptStructureRules[scriptType];
  const structure = rule.structures[0];
  const title = `${topic}：给${audience}的实拍脚本`;

  const transcriptByType: Record<ScriptType, string[]> = {
    教知识: [
      `如果你是${audience}，最近准备了解${product}，先别急着花钱。`,
      `很多人踩坑，不是因为不舍得花钱，而是不知道先看哪几个判断标准。`,
      `第一，看这个方案能不能直接解决「${painPoint}」。如果它只讲概念，不讲具体步骤，先放一放。`,
      `第二，看成本是不是可控。好的方案不一定最贵，但一定能解释钱花在哪里。`,
      `第三，看结果怎么验证。你至少要看到真实过程、细节和前后变化。`,
      `我们做${industry}时，核心卖点不是把话说满，而是把「${sellingPoint}」拍清楚、讲清楚。`
    ],
    晒过程: [
      `今天我们用真实素材拍一次「${topic}」。`,
      `开始前先交代任务：这次要解决的是${audience}最担心的「${painPoint}」。`,
      `第一步，先展示现场和材料：${materials}。`,
      `第二步，把关键动作拍清楚，不只拍结果，要拍为什么这么做。`,
      `第三步，中间保留一个小阻碍或判断点，让观众看到专业不是口号。`,
      `最后展示结果，并解释这个结果和「${sellingPoint}」有什么关系。`
    ],
    聊观点: [
      `关于「${topic}」，我先说结论：${audience}最不该忽视的是${sellingPoint}。`,
      `很多人只盯着价格或表面效果，但真正吃亏的地方往往是后面的时间成本和信任成本。`,
      `反面来看，如果只图便宜，最后可能还是回到「${painPoint}」。`,
      `正面来看，一个靠谱的选择，会把标准、过程和边界讲清楚。`,
      `所以这件事不是你要不要花钱，而是你有没有把钱花在能验证的地方。`
    ],
    讲故事: [
      `我第一次遇到${audience}问「${topic}」的时候，也以为只要把产品讲清楚就够了。`,
      `后来发现，真正让人犹豫的不是产品本身，而是「${painPoint}」。`,
      `有一次我们按老方法介绍，对方听完还是没决定。后来我们把真实过程、失败点和判断标准都摊开讲。`,
      `转折就在这里：用户不是不信你，是没看到你为什么靠谱。`,
      `从那以后，我们每次讲${product}，都会先讲清楚「${sellingPoint}」。`
    ]
  };

  return [
    section("标题", [title]),
    section("开头 3 秒钩子", [structure.opening.replaceAll("【困难】", painPoint).replaceAll("【严重后果】", "花钱踩坑").replaceAll("{行业}", industry)]),
    section("逐字稿", transcriptByType[scriptType].map((line, index) => `${index + 1}. ${line}`)),
    section("分镜脚本", [
      "镜头 1：正面中近景，直接抛出钩子，字幕突出痛点。",
      `镜头 2：切到${materials}，让观众看到真实素材，不用空口讲。`,
      "镜头 3：拍关键判断标准或操作步骤，画面跟着每一句具体动作走。",
      "镜头 4：加入对比或案例，证明为什么这样做更稳。",
      "镜头 5：回到 IP/老板，总结核心观点并引导评论或咨询。"
    ]),
    section("画中画建议", [
      "用户痛点出现时：插入评论区问题、差评截图、错误示范或现场问题。",
      "讲判断标准时：插入产品细节、服务流程、材料对比、前后对比。",
      "讲卖点时：插入真实案例、过程记录、检测/清单/合同细节，证明不是空口承诺。"
    ]),
    section("拍摄建议", [
      "开头不要自我介绍，直接进入问题。",
      "每 8-12 秒给一个画面变化：口播、细节、过程、对比、结果交替。",
      "画面感文案多用动词，少用形容词，把“专业”拍成动作和判断。"
    ]),
    section("结尾引导话术", [
      `如果你也在纠结${product}怎么选，把你的情况发我，我按${industry}真实标准帮你判断。`,
      "想看我把完整过程拍出来，评论区留一个你最担心的问题。"
    ]),
    section("自检清单", rule.selfCheck.map((item) => `□ ${item}`))
  ];
}

export function generateInterview(input: ToolInput): GeneratedSection[] {
  const industry = value(input, "ipIndustry", "行业");
  const identity = value(input, "ipIdentity", "老板/IP");
  const theme = value(input, "theme", "拍摄主题");
  const targetOpinion = value(input, "targetOpinion", "想引导出的观点");
  const concern = value(input, "concern", "用户最关心的问题");

  return [
    section("开场破冰问题", [
      `最近${industry}里有没有一件事，让你觉得外行完全看不懂？`,
      `你第一次以${identity}身份处理「${theme}」时，最尴尬或最意外的场面是什么？`,
      `如果让你吐槽一个${industry}里的头牌/常识，你最想说哪一句？`
    ]),
    section("主线采访问题", [
      `这次我们想聊「${theme}」，你先给${concern}的用户一个直接判断：最重要的标准是什么？`,
      `你为什么会形成「${targetOpinion}」这个观点？有没有一个真实案例？`,
      "如果用户只记住一个动作、一个标准或一句话，你希望他记住什么？",
      `在${industry}里，普通人最容易把哪件事想简单？`
    ]),
    section("亲密关系提问", [
      `如果你最好的朋友也遇到「${concern}」，你会让他先做哪一步？`,
      `假如今天你家人要找你做${theme}相关决策，你会让他避开什么？`,
      `如果是老客户来问你，你会怎么把「${targetOpinion}」讲得更具体？`
    ]),
    section("负面假设追问", [
      `如果我按照你说的做，最后还是出现「${concern}」怎么办？`,
      "这么做会不会更贵、更慢，或者让风险转移到后面？",
      "有没有哪类人不适合按这个方法来？边界是什么？"
    ]),
    section("制造对立追问", [
      "新手和老手在这件事上的选择会有什么不同？",
      `内行和外行看「${theme}」最大的分歧是什么？`,
      `如果拿${industry}头部玩家和普通商家比，真正差别在哪里？`
    ]),
    section("什么时候追问", naturalInterviewRules.whenToAskMore.map((item) => `□ ${item}`)),
    section("什么时候切断", naturalInterviewRules.whenToCut.map((item) => `□ ${item}`)),
    section("拍摄前检查清单", naturalInterviewRules.setupChecklist.map((item) => `□ ${item}`))
  ];
}

export function generateDeconstruction(input: ToolInput): GeneratedSection[] {
  const title = value(input, "videoTitle", "爆款视频标题");
  const content = value(input, "videoContent", "视频逐字稿或大概内容");
  const industry = value(input, "ownIndustry", "你的行业");
  const element = viralElementRules.find((item) => content.includes(item.name) || title.includes(item.name)) ?? viralElementRules[4];

  return [
    section("原视频讲了什么", [
      `这条视频表面讲的是「${title}」。`,
      `从内容看，核心不是逐句文案，而是围绕一个用户关心的问题，用案例/冲突/结果持续推进：${content.slice(0, 160)}${content.length > 160 ? "..." : ""}`
    ]),
    section("爆款元素", [
      `${element.name}：${element.definition}`,
      "建议同时检查是否还有人群圈定、对立、内幕或成本感。"
    ]),
    section("开头钩子", [
      "它大概率用了“先抛问题/冲突/反常识，再承诺后面有答案”的方式。",
      `迁移钩子：${industry}里很多人以为【表面判断】就够了，其实真正影响结果的是【隐藏标准】。`
    ]),
    section("内容结构", deconstructionRules.process.map((item, index) => `${index + 1}. ${item}`)),
    section("情绪变化", [
      "好奇：标题或第一句话让观众想知道为什么。",
      "焦虑/共鸣：中段放大用户担心或常见错误。",
      "认同：通过案例、对比或反转让观众接受观点。",
      "行动：结尾给出可迁移判断或下一步动作。"
    ]),
    section("广告/成交植入位置", deconstructionRules.adRules.map((item) => `□ ${item}`)),
    section("可迁移结构", [
      "大众关心的问题 → 具体案例/冲突 → 揭示真实原因 → 给出判断标准 → 回到自己行业的解决方案。",
      "不要照搬原文，把每一段的功能换成你的行业动作。"
    ]),
    section("迁移到用户行业后的新选题", [
      `${industry}客户问我：现在做这件事是不是已经晚了？`,
      `${industry}里最容易被外行误解的 3 个判断标准`,
      `为什么有人在${industry}少花钱，反而拿到了更稳的结果？`
    ]),
    section("迁移后的新脚本大纲", [
      `1. 开头：${industry}里很多人一上来就看错了重点。`,
      "2. 案例：讲一个真实客户/老板/用户遇到的具体问题。",
      "3. 原因：解释为什么这个问题会发生。",
      "4. 标准：给 2-3 个可执行判断标准。",
      "5. 植入：把你的产品/服务作为解决方案自然带出。",
      "6. 结尾：引导用户留言自己的情况，方便二次转化。"
    ])
  ];
}

export function generateEditing(input: ToolInput): GeneratedSection[] {
  const materials = value(input, "materials", "素材内容");
  const videoType = value(input, "videoType", "观点型") as VideoType;
  const order = editingRules.byType[videoType] ?? editingRules.byType["观点型"];

  return [
    section("最适合放开头的一句话", [
      videoType === "观点型"
        ? "我先说结论：这件事真正的问题，不是表面看到的那个。"
        : videoType === "故事型"
          ? "一开始我也误会了他，直到最后才知道真相。"
          : videoType === "测评型"
            ? "这个东西到底值不值，我今天按真实场景测给你看。"
            : "如果你也遇到这个问题，先别急着花钱，按这几步做。"
    ]),
    section("应该删除的无效内容", editingRules.deleteRules.map((item) => `□ ${item}`)),
    section("推荐剪辑顺序", order.map((item, index) => `${index + 1}. ${item}`)),
    section("开头方式", [
      `从素材里优先找：${editingRules.openingTypes.slice(0, 6).join("、")}。`,
      "不要自我介绍，前三秒直接让观众知道这条视频值得看。"
    ]),
    section("中间推进方式", [
      `素材关键词：${materials.slice(0, 180)}${materials.length > 180 ? "..." : ""}`,
      "中间不要按拍摄顺序剪，要按观众理解顺序剪。",
      "每一段只服务一个核心观点，跑题素材移到下一条视频。"
    ]),
    section("结尾强化方式", editingRules.endings.map((item) => `□ ${item}`)),
    section("成片自检标准", editingRules.standards.map((item) => `□ ${item}`))
  ];
}

export function generateStoreIdeas(input: ToolInput): GeneratedSection[] {
  const industry = value(input, "industry", "实体店");
  const product = value(input, "product", "产品/服务");
  const audience = value(input, "audience", "本地顾客");
  const formula = storeContentRules.formulas[0];

  return [
    section("实体店内容方向", [
      `${industry}不要只拍${product}成品，要拍筹备、选择、服务、售后和老板判断。`,
      `核心目标：让${audience}觉得你靠谱。`
    ]),
    section("可直接拍的 5 条", [
      `1. ${formula.name}：我是一个【身份】老板，准备用【周期】把这家${industry}做起来。`,
      `2. 装修汇报：今天我为什么多花钱改一个细节，因为它会影响${audience}体验。`,
      `3. 老板靠谱：别人为了省成本会省掉这一步，但我偏要保留，因为${product}稳定更重要。`,
      `4. 售后处理：今天有顾客反馈一个问题，我不解释，先亲自核查。`,
      `5. AI 活动：让 AI 挑一个${product}方案，老板现场验证谁更懂顾客。`
    ])
  ];
}
