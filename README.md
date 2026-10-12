# 电商工作台（开源候选版）

电商工作台（ecommerce-workbench）是基于 Next.js 和 Electron 的内容创作工作台，包含 AI 对话、脚本、爆款复刻、生图与数据复盘。

## 本地启动

安装 Node.js 22，执行 `npm ci`，把 `.env.example` 复制成 `.env.local`，仅在本机填入自己的服务商密钥，然后执行 `npm run dev -- --port 3010`，访问 http://localhost:3010 。首次启动按页面提示设置管理员。

模型注册在 `config/models.yaml`，功能路由在 `config/model-routing.yaml`。模型访问权限、付费及第三方连接由使用者自行配置；没有密钥的能力不可用。

## 数据和安全

不要上传 `.env.local`、Cookie、账号数据库、聊天记录、产品资料、日志、截图、构建产物或已安装 App。不要将服务商密钥放进 `NEXT_PUBLIC_` 环境变量。开源源码不等于开放自己的在线服务，不要直接暴露开发服务器到公网。

此副本不含原 Git 历史、本地运行数据及内部项目记录。公开前必须重新扫描最终提交。不要使用旧迁移压缩包发布；本副本移除了该打包命令。

## 外部依赖和许可证

部分视频与评论能力需要另外安装外部工具；原机器忽略的第三方目录未随本副本发布，因此不能保证开箱即用。参考 `THIRD_PARTY_NOTICES.md`。字体许可证见 `docs/licenses/`。

项目代码按 MIT 许可证发布，见 `LICENSE`。第三方字体、代码和资源仍遵循各自许可证，见 `THIRD_PARTY_NOTICES.md` 与 `docs/licenses/`。

## 验证边界

本候选版已执行源码泄密检查、文件清单核对、独立依赖安装、类型检查、模型路由测试和生产构建。尚未完成真实 AI 调用、桌面打包及全部业务流程验收。

候选版已更新 Next.js、Sharp、Mammoth 等兼容依赖，并将 Next.js 使用的 PostCSS 固定到 8.5.29。仍有 `sprintf-js` 的中危拒绝服务公告（通过 Mammoth / argparse 间接引入），目前没有已发布的修复版本；不应把此候选版视为已完成公网部署安全审计的版本。
