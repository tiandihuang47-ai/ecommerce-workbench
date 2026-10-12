export type FieldType = "text" | "textarea" | "select" | "multiselect";

export interface ToolField {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}

export interface ToolDefinition {
  id: "topics" | "scripts" | "interview" | "deconstruction" | "editing";
  title: string;
  description: string;
  fields: ToolField[];
  example: Record<string, string | string[]>;
}

const contentPurposes = ["涨粉", "获客", "成交", "建信任", "引发讨论"].map((item) => ({
  label: item,
  value: item
}));

const directions = ["教知识", "晒过程", "聊观点", "讲故事", "自然流"].map((item) => ({
  label: item,
  value: item
}));

const scriptTypes = ["教知识", "晒过程", "聊观点", "讲故事"].map((item) => ({
  label: item,
  value: item
}));

const viralElements = ["成本", "人群", "奇葩", "最差", "反差", "怀旧", "荷尔蒙", "头牌"].map((item) => ({
  label: item,
  value: item
}));

export const toolDefinitions: Record<ToolDefinition["id"], ToolDefinition> = {
  topics: {
    id: "topics",
    title: "选题生成器",
    description: "基于八大爆款元素和五类内容方向，生成可直接开拍的短视频选题。",
    fields: [
      { name: "industry", label: "行业", type: "text", placeholder: "例如：装修、珠宝、餐饮、摄影" },
      { name: "product", label: "产品/服务", type: "text", placeholder: "例如：全屋定制、钻戒、火锅店" },
      { name: "audience", label: "目标人群", type: "text", placeholder: "例如：第一次装修的年轻夫妻" },
      { name: "purpose", label: "内容目的", type: "select", options: contentPurposes },
      { name: "direction", label: "选题方向", type: "select", options: directions },
      { name: "viralElements", label: "爆款元素", type: "multiselect", options: viralElements }
    ],
    example: {
      industry: "本地装修",
      product: "半包装修服务",
      audience: "第一次装修的年轻夫妻",
      purpose: "获客",
      direction: "教知识",
      viralElements: ["成本", "反差", "人群", "奇葩"]
    }
  },
  scripts: {
    id: "scripts",
    title: "脚本生成器",
    description: "按教知识、晒过程、聊观点、讲故事四类结构输出逐字稿、分镜和画中画建议。",
    fields: [
      { name: "topic", label: "选题", type: "text", placeholder: "例如：第一次装修别急着看效果图" },
      { name: "industry", label: "行业", type: "text", placeholder: "例如：装修" },
      { name: "product", label: "产品/服务", type: "text", placeholder: "例如：半包装修服务" },
      { name: "audience", label: "目标人群", type: "text", placeholder: "例如：第一次装修的年轻夫妻" },
      { name: "sellingPoint", label: "核心卖点", type: "textarea", placeholder: "例如：预算透明、材料可查、施工节点每天汇报" },
      { name: "painPoint", label: "用户痛点", type: "textarea", placeholder: "例如：怕增项、怕材料以次充好、怕工期拖延" },
      { name: "materials", label: "素材条件", type: "textarea", placeholder: "例如：工地现场、预算表、材料样板、客户验收视频" },
      { name: "scriptType", label: "脚本类型", type: "select", options: scriptTypes }
    ],
    example: {
      topic: "第一次装修别急着看效果图，先看这 3 个隐藏成本",
      industry: "本地装修",
      product: "半包装修服务",
      audience: "第一次装修的年轻夫妻",
      sellingPoint: "预算透明、材料可查、施工节点每天汇报",
      painPoint: "怕增项、怕材料以次充好、怕工期拖延",
      materials: "工地现场、预算表、材料样板、客户验收视频、师傅施工细节",
      scriptType: "教知识"
    }
  },
  interview: {
    id: "interview",
    title: "自然流采访助手",
    description: "为无稿拍摄准备主线问题、追问工具、切断判断和拍前检查。",
    fields: [
      { name: "ipIndustry", label: "IP 行业", type: "text", placeholder: "例如：珠宝" },
      { name: "ipIdentity", label: "IP 身份", type: "text", placeholder: "例如：从业 12 年珠宝老板" },
      { name: "theme", label: "拍摄主题", type: "text", placeholder: "例如：人工钻石到底值不值得买" },
      { name: "targetOpinion", label: "想引导出的观点", type: "textarea", placeholder: "例如：不是所有人都适合买天然钻，先看佩戴场景和预算" },
      { name: "concern", label: "用户最关心的问题", type: "textarea", placeholder: "例如：怕买贵、怕不保值、怕送礼没面子" }
    ],
    example: {
      ipIndustry: "珠宝",
      ipIdentity: "从业 12 年珠宝老板",
      theme: "人工钻石到底值不值得买",
      targetOpinion: "不是所有人都适合买天然钻，先看佩戴场景、预算和送礼关系",
      concern: "怕买贵、怕不保值、怕送礼没面子"
    }
  },
  deconstruction: {
    id: "deconstruction",
    title: "拆片分析工具",
    description: "拆出爆款视频的元素、结构、情绪和广告植入，再迁移到自己的行业。",
    fields: [
      { name: "videoTitle", label: "爆款视频标题", type: "text", placeholder: "例如：孩子钢琴弹得不好，要不要着急？" },
      { name: "videoContent", label: "视频逐字稿或大概内容", type: "textarea", placeholder: "粘贴逐字稿，或用大白话写出这条视频讲了什么" },
      { name: "ownIndustry", label: "自己的行业", type: "text", placeholder: "例如：代运营、摄影、养生、教育" }
    ],
    example: {
      videoTitle: "孩子钢琴弹得不好，要不要着急？",
      videoContent: "有家长问孩子钢琴弹得不好是不是要加练。视频先举了一个钢琴很厉害的人现实并不幸福的例子，然后表达观点：技能强不等于人生幸福，孩子喜欢、开心更重要。",
      ownIndustry: "短视频代运营"
    }
  },
  editing: {
    id: "editing",
    title: "剪辑结构助手",
    description: "帮你从素材中确定开头、删掉无效内容，并按内容类型重排剪辑结构。",
    fields: [
      { name: "materials", label: "素材内容", type: "textarea", placeholder: "描述拍到了哪些口播、现场、过程、对比、客户反馈" },
      {
        name: "videoType",
        label: "视频类型",
        type: "select",
        options: ["观点型", "故事型", "测评型", "解决问题型"].map((item) => ({ label: item, value: item }))
      }
    ],
    example: {
      materials: "老板讲了为什么装修少放几张桌子，拍到了设计图、桌距对比、服务员上菜动线、顾客坐下后的空间感，也有一段老板重复解释成本压力。",
      videoType: "观点型"
    }
  }
};

export const featureCards = [
  {
    title: "选题生成器",
    href: "/topics",
    description: "用八大爆款元素批量生成选题、钩子和结构。"
  },
  {
    title: "脚本生成器",
    href: "/scripts",
    description: "输出标题、逐字稿、分镜、画中画和拍摄建议。"
  },
  {
    title: "自然流采访助手",
    href: "/interview",
    description: "准备主线采访、亲密关系、负面假设和对立追问。"
  },
  {
    title: "拆片分析工具",
    href: "/deconstruction",
    description: "拆元素、结构、情绪、广告植入并迁移到自己行业。"
  },
  {
    title: "剪辑结构助手",
    href: "/editing",
    description: "找开头、删废话、重排结构并输出成片标准。"
  },
  {
    title: "知识库",
    href: "/knowledge",
    description: "搜索文档方法论、步骤、示例和提示词模板。"
  }
];
