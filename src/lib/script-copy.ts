/**
 * 脚本页「只保留文案」的清洗器。
 * 只做保守清理：删掉整行的舞台提示、行内的动作括号、说明性前缀；
 * 纯函数、零依赖，可以在服务端和客户端复用，也可以单独跑单测。
 */

// 整行就是一个括号提示，例如「（摸了摸衣服）」「（看向镜头）」
const wrappedStageLine = /^[（(【\[][^）)】\]]*[）)】\]]$/;

// 行首说明词，例如「画面：人物自然出镜。」
const stageLinePrefix = /^(画面|镜头|分镜|动作|拍摄|机位|运镜|景别|画中画|字幕|音效|配乐|BGM|台词|旁白)\s*[:：]/;

// 说话人标签后面又跟了一层说明前缀，例如「女生：台词：这厚」
const redundantPrefix = /^(.{1,6}?[：:])\s*(台词|口播|旁白)\s*[：:]\s*/;

// 行内括号：只删「像动作/表情提示」的，含数字的（占比、价格、年份）一律保留
const inlineBracket = /[（(【\[][^（）()【】\[\]]{1,20}[）)】\]]/g;
const actionHint = /(摸|看|指|转|走|跑|拿|递|举|比划|拍|拉|穿|脱|站|坐|点|笑|皱眉|挥|打开|翻|展示|回头|低头|抬头|抬手|靠近|离开|蹲|推|摘|装|放下)/;

// 只剩一个说话人标签、没有内容，例如「女生：」
const bareSpeakerLine = /^[^：:]{0,6}[：:]$/;

export function sanitizeScriptCopy(input: string): string {
  const lines = String(input || "").replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];

  for (const raw of lines) {
    let line = raw.replace(/\u3000/g, " ").trim();
    if (!line) {
      output.push("");
      continue;
    }
    if (wrappedStageLine.test(line)) continue;
    if (stageLinePrefix.test(line)) continue;

    line = line.replace(redundantPrefix, "$1");
    line = line.replace(inlineBracket, (group) => {
      const inner = group.slice(1, -1);
      if (/\d/.test(inner)) return group;
      return actionHint.test(inner) ? "" : group;
    });
    line = line.trim();
    if (!line || bareSpeakerLine.test(line)) continue;

    output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
