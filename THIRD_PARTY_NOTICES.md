# Third-party notices

## yt-dlp

The Douyin import feature uses the locally installed `yt-dlp` executable as a
runtime tool. This project does not bundle or redistribute the yt-dlp source or
binary in its repository.

- Project: https://github.com/yt-dlp/yt-dlp
- License: The Unlicense

## Implementation references

The Douyin import implementation was designed after reviewing the public
`jiji262/douyin-downloader` project and the packaged Douzy application. No
source code from either project was copied into director-platform.

- Reference project: https://github.com/jiji262/douyin-downloader
- Reference license: MIT
- Copyright: Copyright (c) 2026 jiji262

## Douyin comments (script module, 2026-09-24)

The comment capability added to the 脚本 module reuses the existing local
`crawler-service` and the vendored, unmodified third-party sources already
present under `external-tools/`. **No third-party source was copied into
`src/` and no upstream file was modified.**

| Upstream | Where it lives here | How it is used | License |
| --- | --- | --- | --- |
| `jiji262/douyin-downloader` (https://github.com/jiji262/douyin-downloader) | `external-tools/douyin-downloader/` | Read-only reference for the comment collector's field layout and pagination flow (`core/comments_collector.py`, `tests/test_comments_collector.py`). Not executed. | MIT, Copyright (c) 2026 jiji262 |
| DouyinComments (https://github.com/station1926/DouyinComments) | `external-tools/DouyinComments/` | Its unmodified `douyin.js` `a_bogus` signer is executed inside a sandboxed Node context by `crawler-service/server.mjs`; `fetch_comments.py` / `fetch_replies.py` were read for the request parameter shape (cursor / count / cookie). | MIT |
| yt-dlp | runtime executable | Fallback strategy for comment retrieval (unchanged). | The Unlicense |

Reused ideas (not code): cursor / `has_more` pagination, page size limits, cookie
injection, and a separate reply endpoint. The only files changed by this feature
are listed in `docs/DOUYIN_COMMENT_INTEGRATION.md` §2 and in the CHANGELOG entry
for 2026-09-24.
