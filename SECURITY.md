# 安全说明

漏洞报告不要在公开 Issue 粘贴密钥、Cookie 或用户数据。仓库管理员应启用 GitHub Private vulnerability reporting、Secret scanning 和 Push protection（以账号可用能力为准）。

发现凭据泄露，先在服务商控制台撤销并重建凭据，再清理代码和 Git 历史；仅删除文件或把仓库改回私有不能使泄露的密钥失效。

贡献前检查 Git 暂存差异并扫描新增文件。`.gitignore` 不会保护已经被 Git 跟踪的文件，密钥扫描也不能保证发现所有敏感信息。
