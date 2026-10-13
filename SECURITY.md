# 安全说明

漏洞报告不要在公开 Issue 粘贴密钥、Cookie 或用户数据。仓库管理员应启用 GitHub Private vulnerability reporting、Secret scanning 和 Push protection（以账号可用能力为准）。

发现凭据泄露，先在服务商控制台撤销并重建凭据，再清理代码和 Git 历史；仅删除文件或把仓库改回私有不能使泄露的密钥失效。

贡献前检查 Git 暂存差异并扫描新增文件。`.gitignore` 不会保护已经被 Git 跟踪的文件，密钥扫描也不能保证发现所有敏感信息。

## 本地使用与联网边界

- 默认只在 `127.0.0.1` 启动服务。默认本机免登录仅适用于自己控制的本地环境，不创建公共用户名或默认密码。共享、公网或代理部署必须显式设置 `DIRECTOR_REQUIRE_LOGIN=1`；`DIRECTOR_WEB_AUTH_DISABLED=1` 是桌面运行标记，不能作为公网部署的权限方案。
- API Key 和运行资料保存在本机私有目录，未加密；不要分享整个项目文件夹、旧迁移 ZIP、运行目录、浏览器 Cookie 或备份。源码开源不会自动把这些文件上传。
- 使用 AI、语音转写、链接解析等功能时，相应的提示词、图片、视频/音频或链接可能发送给你配置的服务商；只填写自己信任的 API 地址，不使用来历不明的中转接口。
- **只导入可信来源的可执行 Skill。** 导入后系统会自动安装依赖和进行验证，过程中可能运行第三方代码。这里的“隔离环境”用于分开依赖和工作目录，**不是限制文件读取或联网的操作系统沙箱**；第三方脚本仍可能访问本机文件。自检通过也不代表代码已经过安全审查。

## 安全检查与部署

2026-10-13 补全了共享资料读取接口的身份检查，并将 Skill 清理、全局 AI 理解配置写入和本机文件诊断限制为管理员；本机直接访问与桌面模式保持兼容。生产构建后可执行 `node scripts/test-public-api-privacy.mjs`，使用临时数据验证权限边界，不调用付费 API。

依赖检查须同时查看 `npm audit --registry=https://registry.npmjs.org` 和 `npm audit --omit=dev --registry=https://registry.npmjs.org`。桌面运行时 Electron 虽登记在 `devDependencies`，仍影响桌面版本，不能用“生产依赖没有高危”代替桌面安全结论。不要直接执行 `npm audit fix --force`，它可能进行破坏性升级或降级。正式公网/多人部署还需要 HTTPS、会话 Cookie 安全配置、请求和上传限制、出站网络限制及独立部署测试。

2026-10-13 兼容安全更新后，全量审计从 1 严重、12 高危、12 中危降至 **0 严重、5 高危、10 中危**；生产依赖为 0 严重、0 高危、3 中危。Electron 42.11.12 和 tar 7.5.22 已不在当前告警列表中。剩余包项来自两个上游公告：[braces 嵌套模式拒绝服务](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[sprintf-js 精度参数拒绝服务](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)，公告当时均无已发布补丁。不要将受影响包项数理解为独立漏洞数量或已发生的泄露。

为移除 CSS 解析器公告，`postcss-selector-parser` 固定为 7.1.6；生产构建、桌面打包及实际渲染验证，并核对编译 CSS 与升级前完全一致。此更新没有迁移 Tailwind 4，也没有降级 Mammoth 或打包器。复现依赖版本应使用已提交锁文件执行 `npm ci`；当前 Electron 下载工具要求 Node.js 22.12.0 或更高版本。
