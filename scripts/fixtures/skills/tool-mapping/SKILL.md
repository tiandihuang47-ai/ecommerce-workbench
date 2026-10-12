---
name: 对标素材整理助手
description: 读取本地素材与文档，整理成一份对标分析底稿。
version: 0.9.0
allowed-tools:
  - read_file
  - Read
  - filesystem.read
  - read_document
  - write_file
---

# 对标素材整理助手

## 步骤

1. 用 read_file 读取用户给的对标素材。
2. 用 read_document 解析文档正文。
3. 用 write_file 把整理结果写到工作目录。

如果某个工具当前平台没有，就说明缺少这项能力，不要假装执行过。
