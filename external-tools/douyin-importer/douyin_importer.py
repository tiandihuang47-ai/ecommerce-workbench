#!/usr/bin/env python3
"""One-shot Douyin video importer used by director-platform.

Responsibilities end at "real MP4 on local disk". Task creation, Video DNA,
asset identity and prompt generation remain in director-platform.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from http.cookiejar import MozillaCookieJar
from pathlib import Path
from http.cookies import SimpleCookie
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

UPSTREAM_ROOT = Path(__file__).resolve().parent.parent / "douyin-downloader"
if UPSTREAM_ROOT.exists():
    sys.path.insert(0, str(UPSTREAM_ROOT))

from importlib.machinery import SourceFileLoader  # noqa: E402

try:
    from aiohttp import ClientSession, ClientTimeout  # noqa: E402
except ImportError:
    ClientSession = None
    ClientTimeout = None

try:
    api_client_module = SourceFileLoader(
        "douyin_downloader_api_client",
        str(UPSTREAM_ROOT / "core" / "api_client.py"),
    ).load_module()
    url_parser_module = SourceFileLoader(
        "douyin_downloader_url_parser",
        str(UPSTREAM_ROOT / "core" / "url_parser.py"),
    ).load_module()
    validators_module = SourceFileLoader(
        "douyin_downloader_validators",
        str(UPSTREAM_ROOT / "utils" / "validators.py"),
    ).load_module()
    DouyinAPIClient = api_client_module.DouyinAPIClient
    URLParser = url_parser_module.URLParser
    is_short_url = validators_module.is_short_url
    normalize_short_url = validators_module.normalize_short_url
    UPSTREAM_AVAILABLE = True
except Exception:
    DouyinAPIClient = None
    URLParser = None
    is_short_url = None
    normalize_short_url = None
    UPSTREAM_AVAILABLE = False

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
)
URL_PATTERN = re.compile(r"https?://[^\s\"'<>，。；、！？（）【】《》]+", re.I)
MAX_VIDEO_BYTES = 1024 * 1024 * 1024


class ImportFailure(Exception):
    def __init__(self, stage: str, code: str, message: str):
        super().__init__(message)
        self.stage = stage
        self.code = code
        self.message = message


def log(stage: str, status: str, detail: str = "") -> None:
    suffix = f" {detail}" if detail else ""
    print(f"[DOUYIN_IMPORT] {stage} {status}{suffix}", file=sys.stderr, flush=True)


def emit(payload: Dict[str, Any], result_path: Optional[str] = None) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"), default=str)
    sys.stdout.write("\n")
    sys.stdout.flush()
    if result_path:
        try:
            log("SIDECAR_RESULT_PATH_WRITE", "SUCCESS", result_path)
            Path(result_path).write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str),
                encoding="utf-8"
            )
        except Exception as exc:
            log("RESULT_FILE", "FAILED", type(exc).__name__)


def clean_url(value: str) -> str:
    return value.rstrip(".,;:!?)\\]}>")


def extract_url(text: str) -> str:
    matches = [clean_url(item) for item in URL_PATTERN.findall(text or "")]
    for candidate in matches:
        host = (urlparse(candidate).hostname or "").lower()
        if host == "douyin.com" or host == "iesdouyin.com" or host.endswith(".douyin.com") or host.endswith(".iesdouyin.com"):
            log("URL_EXTRACTED", "SUCCESS", f"host={host}")
            return candidate
    log("URL_EXTRACTED", "FAILED")
    raise ImportFailure("input", "INVALID_URL", "没有识别到有效的抖音视频链接。")


def video_id_from_url(url: str) -> str:
    parsed = URLParser.parse(url)
    if parsed and parsed.get("type") == "video" and parsed.get("aweme_id"):
        return str(parsed["aweme_id"])
    match = re.search(r"(?:video|share/video|modal_id|aweme_id|item_id)[=/](\d{10,})", url)
    return match.group(1) if match else ""


async def fetch_public_cookies() -> Dict[str, str]:
    """Collect fresh public anti-bot cookies from the Douyin homepage."""
    cookies: Dict[str, str] = {}
    try:
        async with ClientSession(
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.7",
                "Sec-Fetch-Dest": "document",
            }
        ) as session:
            async with session.get(
                "https://www.douyin.com/?recommend=1",
                timeout=ClientTimeout(total=15),
                allow_redirects=True,
            ) as response:
                await response.text()
                for raw_cookie in response.headers.getall("Set-Cookie", []):
                    parsed_cookie = SimpleCookie()
                    try:
                        parsed_cookie.load(raw_cookie.split(";", 1)[0])
                    except Exception:
                        continue
                    for key, morsel in parsed_cookie.items():
                        if key and morsel.value:
                            cookies[key] = morsel.value
    except Exception as exc:
        log("PUBLIC_COOKIE", "FAILED", type(exc).__name__)
    else:
        log("PUBLIC_COOKIE", "SUCCESS", f"cookie_count={len(cookies)}")
    return cookies



async def resolve_and_parse(api_client: DouyinAPIClient, raw_input: str) -> Tuple[str, str, str]:
    source_url = extract_url(raw_input)
    resolved_url = source_url
    if is_short_url(source_url):
        resolved = await api_client.resolve_short_url(normalize_short_url(source_url))
        if not resolved:
            log("URL_RESOLVED", "FAILED", "short_url")
            raise ImportFailure("resolve", "URL_RESOLVE_FAILED", "抖音链接解析失败，请重试。")
        resolved_url = resolved
    log("URL_RESOLVED", "SUCCESS", urlparse(resolved_url).hostname or "")
    video_id = video_id_from_url(resolved_url) or video_id_from_url(source_url)
    if not video_id:
        log("VIDEO_ID", "FAILED")
        raise ImportFailure("parse", "VIDEO_ID_NOT_FOUND", "抖音链接解析失败，请重试。")
    log("VIDEO_ID", "SUCCESS", video_id)
    return source_url, resolved_url, video_id


def first_url(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    candidates = value.get("url_list")
    if not isinstance(candidates, list):
        return ""
    return next((item for item in candidates if isinstance(item, str) and item), "")


def select_video_urls(detail: Dict[str, Any]) -> List[str]:
    video = detail.get("video") if isinstance(detail.get("video"), dict) else {}
    entries: List[Tuple[int, int, List[str]]] = []
    bit_rates = video.get("bit_rate") if isinstance(video.get("bit_rate"), list) else []
    for item in bit_rates:
        if not isinstance(item, dict):
            continue
        play_addr = item.get("play_addr")
        urls = [first_url(play_addr)] if first_url(play_addr) else []
        if not urls:
            continue
        entries.append((int(item.get("bit_rate") or 0), int(item.get("is_h265") or 0), urls))
    h264 = sorted((item for item in entries if item[1] == 0), key=lambda item: (-item[0], -len(item[2])))
    any_quality = sorted(entries, key=lambda item: (-item[0], -len(item[2])))
    ordered: List[str] = []
    for group in (h264, any_quality):
        for entry in group:
            ordered.extend(entry[2])
    for key in ("play_addr_h264", "play_addr", "play_addr_265", "download_addr"):
        url = first_url(video.get(key))
        if url:
            ordered.append(url)
    unique: List[str] = []
    for url in ordered:
        if url and url not in unique:
            unique.append(url)
    return unique


def download_headers(url: str, api_client: DouyinAPIClient) -> Tuple[str, Dict[str, str]]:
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.douyin.com/",
        "Origin": "https://www.douyin.com",
        "Accept": "*/*",
    }
    host = (urlparse(url).hostname or "").lower()
    if host.endswith("douyin.com") and "X-Bogus=" not in url:
        try:
            signed_url, signed_ua = api_client.sign_url(url)
            if signed_ua:
                headers["User-Agent"] = signed_ua
            return signed_url, headers
        except Exception:
            return url, headers
    return url, headers


async def download_with_aiohttp(
    api_client: DouyinAPIClient,
    candidates: List[str],
    output_dir: Path,
) -> Path:
    target = output_dir / "source.mp4"
    last_status = 0
    for index, candidate in enumerate(candidates, start=1):
        request_url, headers = download_headers(candidate, api_client)
        try:
            async with ClientSession(headers=headers) as session:
                async with session.get(request_url, timeout=ClientTimeout(total=300)) as response:
                    last_status = response.status
                    log("DOWNLOAD", "SUCCESS" if response.ok else "FAILED", f"candidate={index} http={response.status}")
                    if response.status != 200:
                        continue
                    tmp_target = target.with_suffix(".part")
                    with tmp_target.open("wb") as output:
                        async for chunk in response.content.iter_chunked(256 * 1024):
                            output.write(chunk)
                    size = tmp_target.stat().st_size
                    if size < 16 * 1024:
                        log("DOWNLOAD", "FAILED", f"candidate={index} too_small={size}")
                        continue
                    if size > MAX_VIDEO_BYTES:
                        raise ImportFailure("download", "VIDEO_VALIDATION_FAILED", "视频文件超过 1GB。")
                    tmp_target.replace(target)
                    return target
        except ImportFailure:
            raise
        except Exception as exc:
            log("DOWNLOAD", "FAILED", f"candidate={index} {type(exc).__name__}")
    raise ImportFailure("download", "DOWNLOAD_FAILED", f"视频已识别，但下载失败，请重试。 HTTP {last_status}")


async def run_upstream(input_text: str, output_dir: Path) -> Dict[str, Any]:
    if not UPSTREAM_AVAILABLE:
        raise ImportFailure("sidecar", "SIDECAR_START_FAILED", "抖音导入组件依赖不完整。")
    public_cookies = await fetch_public_cookies()
    async with DouyinAPIClient(public_cookies) as api_client:
        source_url, resolved_url, video_id = await resolve_and_parse(api_client, input_text)
        detail = await api_client.get_video_detail(video_id)
        if not detail:
            log("METADATA", "FAILED", "empty_detail")
            raise ImportFailure("metadata", "METADATA_FAILED", "视频信息获取失败，请稍后重试。")
        log("METADATA", "SUCCESS", video_id)
        candidates = select_video_urls(detail)
        if not candidates:
            log("VIDEO_RESOURCE", "FAILED", "empty")
            raise ImportFailure("metadata", "DOWNLOAD_URL_NOT_FOUND", "视频已识别，但下载资源缺失，请重试。")
        log("VIDEO_RESOURCE", "SUCCESS", f"candidates={len(candidates)}")
        video_path = await download_with_aiohttp(api_client, candidates, output_dir)
        return {
            "ok": True,
            "sourceUrl": source_url,
            "resolvedUrl": resolved_url,
            "awemeId": str(detail.get("aweme_id") or video_id),
            "title": str(detail.get("desc") or detail.get("item_title") or f"抖音视频 {video_id}").strip(),
            "author": str((detail.get("author") or {}).get("nickname") or "").strip(),
            "durationMs": int((detail.get("video") or {}).get("duration") or detail.get("duration") or 0),
            "width": int((detail.get("video") or {}).get("width") or 0),
            "height": int((detail.get("video") or {}).get("height") or 0),
            "coverUrl": first_url((detail.get("video") or {}).get("cover")),
            "localVideoPath": str(video_path),
        }


def candidate_urls_from_metadata(raw: Dict[str, Any]) -> List[str]:
    urls: List[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.startswith("http") and value not in urls:
            urls.append(value)

    add(raw.get("url"))
    add(raw.get("manifest_url"))
    formats = raw.get("formats")
    if isinstance(formats, list):
        scored = []
        for item in formats:
            if not isinstance(item, dict) or not item.get("url"):
                continue
            protocol = str(item.get("protocol") or "").lower()
            ext = str(item.get("ext") or "").lower()
            if protocol in {"m3u8", "dash"} or ext in {"m3u8", "mpd"}:
                continue
            score = float(item.get("tbr") or 0) * 1000 + float(item.get("height") or 0)
            if ext == "mp4":
                score += 100000
            if str(item.get("vcodec") or "").startswith("avc"):
                score += 50000
            scored.append((score, str(item.get("url"))))
        for _, url in sorted(scored, key=lambda pair: -pair[0]):
            add(url)
    requested = raw.get("requested_formats")
    if isinstance(requested, list):
        for item in requested:
            if isinstance(item, dict):
                add(item.get("url"))
                for fmt in item.get("formats", []) if isinstance(item.get("formats"), list) else []:
                    add(fmt.get("url") if isinstance(fmt, dict) else None)
    return urls


def download_with_urllib(raw: Dict[str, Any], output_dir: Path) -> Path:
    candidate_urls = candidate_urls_from_metadata(raw)
    if not candidate_urls:
        log("VIDEO_RESOURCE", "FAILED", "urllib_no_candidates")
        raise ImportFailure("download", "DOWNLOAD_URL_NOT_FOUND", "视频已识别，但下载资源缺失，请重试。")
    log("VIDEO_RESOURCE", "SUCCESS", f"urllib_candidates={len(candidate_urls)}")

    cookie_jar_path = os.environ.get("DOUYIN_COOKIE_JAR", "")
    opener = urllib.request.build_opener()
    if cookie_jar_path and Path(cookie_jar_path).exists():
        jar = MozillaCookieJar(cookie_jar_path)
        jar.load(ignore_discard=True, ignore_expires=True)
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    target = output_dir / "source.mp4"
    last_error = ""
    for index, url in enumerate(candidate_urls, start=1):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Referer": "https://www.douyin.com/",
                "Origin": "https://www.douyin.com",
                "Accept": "*/*",
                "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.7",
            })
            with opener.open(request, timeout=45) as response:
                log("DOWNLOAD", "SUCCESS" if response.status == 200 else "FAILED", f"urllib_candidate={index} http={response.status}")
                if response.status != 200:
                    continue
                tmp_target = target.with_suffix(".part")
                with tmp_target.open("wb") as output:
                    while True:
                        chunk = response.read(256 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
                size = tmp_target.stat().st_size
                if size < 16 * 1024:
                    log("DOWNLOAD", "FAILED", f"urllib_candidate={index} too_small={size}")
                    continue
                tmp_target.replace(target)
                return target
        except Exception as exc:
            last_error = type(exc).__name__
            log("DOWNLOAD", "FAILED", f"urllib_candidate={index} {last_error}")
    raise ImportFailure("download", "DOWNLOAD_FAILED", f"视频已识别，但下载失败，请重试。 {last_error}")


def run_yt_dlp(input_text: str, output_dir: Path) -> Dict[str, Any]:
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        raise ImportFailure("sidecar", "SIDECAR_START_FAILED", "抖音导入组件不可用。")
    source_url = extract_url(input_text)
    metadata_args = [
        yt_dlp,
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout", "20",
        "--retries", "2",
        "--user-agent", USER_AGENT,
        "--referer", "https://www.douyin.com/",
    ]
    cookie_jar = os.environ.get("DOUYIN_COOKIE_JAR", "")
    if cookie_jar and Path(cookie_jar).exists():
        metadata_args.extend(["--cookies", cookie_jar])
    metadata_args.append(source_url)
    log("METADATA", "SUCCESS", "yt_dlp_fallback")
    try:
        result = subprocess.run(metadata_args, capture_output=True, text=True, timeout=45, check=True)
    except subprocess.TimeoutExpired as exc:
        raise ImportFailure("metadata", "TIMEOUT", "视频信息获取超时，请稍后重试。") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").replace("\n", " ")[:240]
        log("METADATA", "FAILED", f"yt_dlp_exit={exc.returncode} {detail}")
        raise ImportFailure("metadata", "METADATA_FAILED", "视频信息获取失败，请稍后重试。") from exc
    raw = json.loads(result.stdout)

    def build_payload(local_video_path: Path) -> Dict[str, Any]:
        return {
            "ok": True,
            "sourceUrl": source_url,
            "resolvedUrl": str(raw.get("webpage_url") or source_url),
            "awemeId": str(raw.get("id") or ""),
            "title": str(raw.get("title") or "抖音视频"),
            "author": str(raw.get("uploader") or raw.get("channel") or ""),
            "durationMs": int(float(raw.get("duration") or 0) * 1000),
            "width": int(raw.get("width") or 0),
            "height": int(raw.get("height") or 0),
            "coverUrl": str(raw.get("thumbnail") or ""),
            "localVideoPath": str(local_video_path),
        }

    download_args = [
        yt_dlp,
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--newline",
        "--socket-timeout", "20",
        "--retries", "3",
        "--no-part",
        "--no-cache-dir",
        "--force-ipv4",
        "-f", "b/bv*+ba/b",
        "--merge-output-format", "mp4",
        "--no-simulate",
        "--print", "after_move:filepath",
        "-o", str(output_dir / "source.%(ext)s"),
    ]
    if cookie_jar and Path(cookie_jar).exists():
        download_args.extend(["--cookies", cookie_jar])
    download_args.append(source_url)
    try:
        download_result = subprocess.run(download_args, capture_output=True, text=True, timeout=300, check=True)
        printed_paths = [line.strip() for line in download_result.stdout.splitlines() if line.strip().startswith("/")]
        candidates = printed_paths + [str(item) for item in sorted(output_dir.glob("source.*"))]
        downloaded = [item for item in candidates if Path(item).exists() and item.lower().endswith((".mp4", ".mov", ".m4v", ".webm", ".mkv"))]
        downloaded = sorted(set(downloaded), key=lambda item: Path(item).stat().st_mtime, reverse=True)
        log("DOWNLOAD", "SUCCESS" if downloaded else "FAILED", f"files={[Path(item).name for item in downloaded]}")
        if not downloaded:
            return build_payload(download_with_urllib(raw, output_dir))
        return build_payload(Path(downloaded[0]))
    except subprocess.TimeoutExpired as exc:
        raise ImportFailure("download", "TIMEOUT", "视频下载超时，请重试。") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").replace("\n", " ")[:300]
        log("DOWNLOAD", "FAILED", f"yt_dlp_exit={exc.returncode} {detail}")
        return build_payload(download_with_urllib(raw, output_dir))


async def main_async() -> int:
    parser = argparse.ArgumentParser(description="director-platform Douyin one-shot importer")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output_dir = Path(args.output).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    log("SIDECAR_VERSION", "SUCCESS", "2026-08-30.4")
    log("INPUT_RECEIVED", "SUCCESS", f"input_length={len(args.input or '')}")
    try:
        try:
            payload = await run_upstream(args.input, output_dir)
        except ImportError as exc:
            log("SIDECAR", "FAILED", f"upstream_import_error={type(exc).__name__}")
            payload = await asyncio.to_thread(run_yt_dlp, args.input, output_dir)
        except ImportFailure as exc:
            if exc.stage in {"sidecar", "metadata", "download"}:
                log("SIDECAR", "FAILED", f"upstream_fallback={exc.code}")
                payload = await asyncio.to_thread(run_yt_dlp, args.input, output_dir)
            else:
                raise
        emit(payload, str(Path(args.output) / "result.json"))
        return 0
    except ImportFailure as exc:
        log("FAILED", "TRUE", f"stage={exc.stage} code={exc.code} message={exc.message}")
        emit({"ok": False, "stage": exc.stage, "code": exc.code, "message": exc.message}, str(Path(args.output) / "result.json"))
        return 1
    except Exception as exc:
        import traceback
        detail = traceback.format_exc(limit=3).replace("\n", " | ")[:600]
        log("FAILED", "TRUE", f"stage=sidecar code=SIDECAR_START_FAILED type={type(exc).__name__} detail={detail}")
        emit({"ok": False, "stage": "sidecar", "code": "SIDECAR_START_FAILED", "message": "抖音导入组件启动失败，请重新启动应用。"}, str(Path(args.output) / "result.json"))
        return 1


def main() -> None:
    raise SystemExit(asyncio.run(main_async()))


if __name__ == "__main__":
    main()
