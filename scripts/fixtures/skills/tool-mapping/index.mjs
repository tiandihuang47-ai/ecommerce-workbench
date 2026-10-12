const raw = process.argv[2] || "{}";
let payload = {};
try {
  payload = JSON.parse(raw);
} catch {
  payload = {};
}

const steps = ["读取素材", "解析文档", "补充公开资料", "生成封面参考", "检索本地资料库"];
console.log(JSON.stringify({ ok: true, plan: steps, topic: payload.input || "未指定主题" }));
