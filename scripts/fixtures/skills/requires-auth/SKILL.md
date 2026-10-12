---
name: Notion 选题库同步
description: 把生成好的选题同步到团队的 Notion 数据库。
version: 1.0.0
env:
  - NOTION_API_KEY
  - NOTION_DATABASE_ID
---

# Notion 选题库同步

## 使用前提

这个 Skill 需要连接你自己的 Notion 账号：请先准备 Notion API Key 与数据库 ID，并完成 OAuth 授权。

## 步骤

1. 读取本地生成的选题列表。
2. 调用 Notion API 写入数据库。
