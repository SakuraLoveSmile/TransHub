"""其他软件调用统一字幕任务 API 的标准库示例（上传用 curl，查询/下载用本脚本）.

用法:
    python scripts/subtitle_task_client_example.py <task-id> <output-path> [--format srt|lrc]

查询超时后继续查询原编号，不自动重新上传；QUEUE_FULL 表示本次没有创建任务。
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.request import ProxyHandler, build_opener

BASE_URL = "http://127.0.0.1:8765"
HTTP = build_opener(ProxyHandler({}))


def query_task(task_id: str, timeout: float = 10.0) -> dict:
    try:
        with HTTP.open(f"{BASE_URL}/api/subtitle-tasks/{task_id}", timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            body = {"code": f"HTTP_{error.code}", "detail": error.reason}
        raise RuntimeError(f'{body.get("code")}: {body.get("detail")}') from error
    except OSError as error:
        raise RuntimeError(f"无法连接 TransHub 服务: {error}") from error


def wait_and_download(
    task_id: str,
    output_path: Path,
    subtitle_format: str = "srt",
    wait_seconds: float = 1800,
) -> Path:
    if subtitle_format not in {"srt", "lrc"}:
        raise ValueError("subtitle_format must be srt or lrc")
    if len(task_id) != 32 or any(c not in "0123456789abcdef" for c in task_id):
        raise ValueError("Invalid task ID")

    deadline = time.monotonic() + wait_seconds
    task_url = f"{BASE_URL}/api/subtitle-tasks/{task_id}"

    while time.monotonic() < deadline:
        try:
            with HTTP.open(task_url, timeout=10) as response:
                task = json.load(response)
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read().decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                body = {}
            raise RuntimeError(
                f'查询失败: {body.get("code", error.code)}: '
                f'{body.get("detail", error.reason)}'
            ) from error
        except OSError as error:
            # 网络抖动：保留任务编号，等待后继续查询原编号。
            time.sleep(2)
            if time.monotonic() >= deadline:
                raise TimeoutError(f"网络不可用且等待超时: {error}") from error
            continue

        if task["mock"]:
            raise RuntimeError("TransHub is running in Mock mode")

        if task["status"] == "failed":
            error = task["error"] or {}
            raise RuntimeError(f'{error.get("code")}: {error.get("detail")}')

        if task["status"] == "succeeded":
            download_url = f"{task_url}/file?format={subtitle_format}"
            try:
                with HTTP.open(download_url, timeout=30) as response:
                    content = response.read()
            except urllib.error.HTTPError as error:
                raise RuntimeError(f"下载失败（HTTP {error.code}）") from error
            # 独占创建，避免覆盖调用方已有字幕。
            with output_path.open("xb") as output:
                output.write(content)
            return output_path

        time.sleep(2)

    raise TimeoutError(
        f"Stopped waiting; task {task_id} may still be running. "
        "Query the same task ID later."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="查询字幕任务并下载字幕文件")
    parser.add_argument("task_id", help="POST /api/subtitle-tasks 返回的 id")
    parser.add_argument("output", help="保存字幕的本地路径")
    parser.add_argument("--format", default="srt", choices=("srt", "lrc"))
    parser.add_argument("--wait-seconds", type=float, default=1800)
    args = parser.parse_args()
    path = wait_and_download(
        args.task_id, Path(args.output), args.format, args.wait_seconds
    )
    print(f"saved: {path}")


if __name__ == "__main__":
    main()
