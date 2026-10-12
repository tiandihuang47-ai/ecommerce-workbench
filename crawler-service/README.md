# crawler-service

`crawler-service` 是编导中台外置链接解析服务。当前默认使用公开接口与 `yt-dlp` 的公开解析能力处理抖音链接和评论，不默认读取 Chrome Cookie，避免触发 macOS 钥匙串弹窗。

## 启动

```bash
cd "<项目目录>/crawler-service"
npm start
```

也可以在主项目根目录运行：

```bash
npm run crawler:dev
```

默认地址：

```text
http://127.0.0.1:8787
```

## 接口

- `GET /health`
- `POST /resolve-douyin`
- `POST /resolve-comments`

请求：

```json
{
  "url": "https://v.douyin.com/oRwZUNqvDr8/",
  "useBrowserCookies": false
}
```

默认不使用浏览器登录态。如果公开解析失败，可以在编导中台页面手动开启“使用浏览器登录态解析”，或改用上传视频模式。

## 抖音评论抓取

请求：

```json
{
  "url": "https://www.douyin.com/video/7649234254945144074",
  "platform": "douyin",
  "limit": 10,
  "sortBy": "likeCount"
}
```

默认策略：

1. 提取纯链接和 `aweme_id`。
2. 如果配置了 `DOUYIN_COOKIE` 或 `DOUYIN_COMMENT_COOKIE`，尝试 DouyinComments 签名接口。
3. 未配置 Cookie 时，尝试公开评论接口。
4. 再尝试 `yt-dlp --write-comments`。
5. 全部失败时返回清晰失败原因，前端进入“手动粘贴评论”兜底。

高级 Cookie 模式只在 `.env.local` 手动配置后启用：

```bash
DOUYIN_COOKIE=
DOUYIN_COMMENT_COOKIE=
```

不要提交 Cookie，不要打印 Cookie，也不要默认读取浏览器 Cookie。抖音评论接口可能因为登录、权限、验证码或平台风控失败；这时使用手动粘贴评论仍然可以生成评论洞察。
