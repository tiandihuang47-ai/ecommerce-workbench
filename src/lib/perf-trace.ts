/**
 * 生图链路的轻量性能打点。
 *
 * 只在服务端写一行结构化日志，方便把「一次生成到底慢在哪」拆成时间线；
 * 不参与业务逻辑，任何异常都不影响生成。
 */
export function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function trace(stage: string, data: Record<string, unknown>) {
  try {
    const parts = Object.entries(data)
      .map(([key, value]) => `${key}=${typeof value === "number" ? Math.round(value) : String(value)}`)
      .join(" ");
    console.info(`[TIMELINE] ${stage} ${parts}`);
  } catch {
    /* 打点失败绝不影响生成 */
  }
}

export function since(startedAt: number) {
  return now() - startedAt;
}
