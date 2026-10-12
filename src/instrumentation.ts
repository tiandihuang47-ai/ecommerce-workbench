/**
 * Next.js 启动钩子：校验中央模型路由配置。
 *
 * 配置写错（Route 引用了不存在的模型 / 模型引用了不存在的 Provider / capability 不匹配）
 * 会在启动时明确报错，不会等到用户点了功能才发现，也不会静默回退到别的模型。
 * 只缺环境变量（还没配 Key）时只打印告警，不影响启动。
 *
 * 注意：必须用块级 if + 动态导入的官方写法，让 webpack 在 edge 构建（存在 middleware
 * 时也会编译本文件）中消除 node-only 依赖；提前 return 的写法会导致 node:fs 进入 edge 包。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { assertModelRoutingValid } = await import("@/lib/model-router");
      const { warnings } = assertModelRoutingValid();
      console.info("[MODEL_ROUTER] 配置校验通过：config/model-routing.yaml + config/models.yaml");
      for (const warning of warnings) console.warn(`[MODEL_ROUTER] ${warning}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[MODEL_ROUTER] 启动校验失败：${message}`);
      throw error;
    }
  }
}
