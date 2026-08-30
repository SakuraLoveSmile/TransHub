"""Assert the Phase 0 acceptance list against a running server (stdlib only).

Used by CI on Windows and runnable by hand after ``run.bat``:

    .venv\\Scripts\\python scripts\\smoke_check.py
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# Windows consoles default to a non-UTF-8 code page; the assertions print
# Japanese and Chinese payloads, so stdout must not depend on that code page.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

WINDOWS_PATH = "D:\\ASMR\\test.flac"
EXPECTED_MODELS = {"whisper-ja-1.5b", "chickenrice-v2"}
SRT_BLOCK = "1\n00:00:00,800 --> 00:00:03,400\nこんばんは。"


class Checker:
    def __init__(self, base_url: str, output_dir: Path, timeout: float = 60.0):
        self.base = base_url.rstrip("/")
        self.output_dir = output_dir
        self.timeout = timeout
        self.failed = 0

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        if not ok:
            self.failed += 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")

    def request(self, method: str, path: str, body: dict | None = None):
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base + path, data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8", "replace")
                return response.status, raw
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8", "replace")
        except urllib.error.URLError as error:
            return 0, f"connection error: {error.reason}"
        except OSError as error:  # e.g. a socket timeout on slow real inference
            return 0, f"request error after {self.timeout}s: {error}"

    def json_call(self, method: str, path: str, body: dict | None = None):
        status, raw = self.request(method, path, body)
        try:
            return status, json.loads(raw)
        except json.JSONDecodeError:
            return status, raw

    def text_call(self, method: str, path: str):
        return self.request(method, path)


def run(checks: Checker) -> None:
    status, payload = checks.json_call("GET", "/api/health")
    checks.check("GET /api/health", status == 200 and payload == {"status": "ok"}, str(payload))
    if status == 0:
        print(f"\nABORT: {checks.base} is not reachable, is run.bat up?")
        return

    status, payload = checks.json_call("GET", "/api/status")
    checks.check(
        "GET /api/status is mock engine",
        status == 200 and payload.get("engine") == "mock" and payload.get("mock") is True,
        str(payload),
    )

    status, payload = checks.json_call("GET", "/api/models")
    models = {model["id"]: model for model in payload.get("models", [])}
    checks.check(
        "GET /api/models lists both models",
        status == 200 and set(models) == EXPECTED_MODELS,
        str(sorted(models)),
    )
    checks.check(
        "mock models report installed=true",
        all(m["installed"] and m["mock"] for m in models.values()),
    )

    status, payload = checks.json_call("POST", "/api/models/load", {"model": "chickenrice-v2"})
    checks.check(
        "POST /api/models/load",
        status == 200 and payload.get("loaded_model") == "chickenrice-v2" and payload.get("mock") is True,
        str(payload),
    )

    status, payload = checks.json_call("GET", "/api/models")
    loaded = [m["id"] for m in payload.get("models", []) if m["loaded"]]
    checks.check("loaded flag follows load", loaded == ["chickenrice-v2"], str(loaded))

    status, payload = checks.json_call("POST", "/api/models/unload")
    checks.check(
        "POST /api/models/unload",
        status == 200 and payload.get("success") is True and payload.get("loaded_model") is None,
        str(payload),
    )

    status, payload = checks.json_call("POST", "/api/transcribe", {"path": WINDOWS_PATH})
    checks.check(
        "POST /api/transcribe returns japanese",
        status == 200
        and payload.get("model") == "whisper-ja-1.5b"
        and payload.get("text") == "こんばんは。今日はよろしくお願いします。"
        and len(payload.get("segments", [])) == 2,
        str(payload)[:120],
    )
    checks.check(
        "transcribe payload has language only",
        payload.get("language") == "ja"
        and "source_language" not in payload
        and "target_language" not in payload,
        str(sorted(payload)) if isinstance(payload, dict) else "",
    )

    status, payload = checks.json_call("POST", "/api/translate-audio", {"path": WINDOWS_PATH})
    checks.check(
        "POST /api/translate-audio returns chinese",
        status == 200
        and payload.get("model") == "chickenrice-v2"
        and payload.get("text") == "晚上好。今天请多关照。"
        and payload.get("source_language") == "ja"
        and payload.get("target_language") == "zh-CN",
        str(payload)[:120],
    )

    for name in (
        "test.transcribe.json",
        "test.transcribe.srt",
        "test.zh.json",
        "test.zh.srt",
    ):
        path = checks.output_dir / name
        checks.check(f"output/{name} written", path.is_file())

    srt = (checks.output_dir / "test.transcribe.srt").read_text(encoding="utf-8")
    checks.check("srt matches spec block format", SRT_BLOCK in srt, repr(srt[:40]))

    doc = json.loads((checks.output_dir / "test.transcribe.json").read_text(encoding="utf-8"))
    checks.check(
        "json output mirrors api payload",
        doc.get("profile") == "ja-transcribe" and len(doc.get("segments", [])) == 2,
    )

    status, raw = checks.text_call("GET", "/api/output/test.transcribe.srt")
    checks.check(
        "GET /api/output serves the written SRT",
        status == 200 and SRT_BLOCK in raw,
        f"{status} {raw[:40]!r}",
    )
    status, _ = checks.text_call("GET", "/api/output/never-written.json")
    checks.check("missing artifact is 404", status == 404, str(status))
    status, _ = checks.text_call("GET", "/api/output/config.toml")
    checks.check("non-artifact name rejected with 422", status == 422, str(status))

    status, payload = checks.json_call("POST", "/api/transcribe", {"path": ""})
    checks.check("empty path rejected with 422", status == 422, str(payload)[:80])

    holder = {}

    def slow_request() -> None:
        holder["status"], holder["payload"] = checks.json_call(
            "POST", "/api/transcribe", {"path": "D:\\ASMR\\busy.flac"}
        )

    thread = threading.Thread(target=slow_request)
    thread.start()
    time.sleep(0.3)
    status, payload = checks.json_call("POST", "/api/translate-audio", {"path": WINDOWS_PATH})
    thread.join()
    checks.check(
        "second concurrent request gets 409",
        status == 409 and payload == {"detail": "Inference engine is busy"},
        f"{status} {str(payload)[:60]}",
    )
    checks.check("first request still succeeds", holder.get("status") == 200)

    for path, needle in (("/", "local trans api demo"), ("/docs", "swagger")):
        status, raw = checks.text_call("GET", path)
        checks.check(
            f"GET {path} serves the page",
            status == 200 and needle in raw.lower(),
            str(status),
        )

    status, raw = checks.text_call("GET", "/app.js")
    checks.check("static assets served", status == 200 and len(raw) > 200, str(status))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    parser.add_argument("--output-dir", default=str(Path(__file__).resolve().parents[1] / "output"))
    args = parser.parse_args()

    checks = Checker(args.base_url, Path(args.output_dir))
    run(checks)
    print(
        f"\n{'ALL CHECKS PASSED' if not checks.failed else str(checks.failed) + ' CHECK(S) FAILED'}"
        f" (base={args.base_url})"
    )
    return 1 if checks.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
