"""Check the stable local API contract against a running server.

This checker intentionally validates response shape and machine-readable error
codes instead of tying the suite to every mock transcription sentence.
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

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REQUIRED_INFERENCE_FIELDS = {
    "success",
    "mock",
    "profile",
    "model",
    "duration",
    "processing_time",
    "realtime_factor",
    "speed",
    "text",
    "segments",
}
REQUIRED_MODEL_FIELDS = {"id", "name", "type", "installed", "loaded", "mock"}
FORBIDDEN_INFERENCE_FIELDS = {
    "gpu_name",
    "cuda_version",
    "compute_type",
    "model_path",
    "engine_debug",
    "memory_usage",
}


class Checker:
    def __init__(self, base_url: str, output_dir: Path, timeout: float = 60.0):
        self.base = base_url.rstrip("/")
        self.output_dir = output_dir
        self.timeout = timeout
        self.failed = 0

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        if not ok:
            self.failed += 1
        suffix = f"  {detail}" if detail else ""
        print(f"{'PASS' if ok else 'FAIL'}  {name}{suffix}")

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[int, str]:
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
                return response.status, response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8", "replace")
        except (urllib.error.URLError, OSError) as error:
            return 0, str(error)

    def json_call(self, method: str, path: str, body: dict | None = None):
        status, raw = self.request(method, path, body)
        try:
            return status, json.loads(raw)
        except json.JSONDecodeError:
            return status, raw


def valid_segments(payload: object) -> bool:
    if not isinstance(payload, list):
        return False
    return all(
        isinstance(segment, dict)
        and isinstance(segment.get("start"), (int, float))
        and isinstance(segment.get("end"), (int, float))
        and isinstance(segment.get("text"), str)
        for segment in payload
    )


def check_inference_payload(
    checks: Checker, name: str, status: int, payload: object, language_fields: set[str]
) -> None:
    ok = isinstance(payload, dict)
    if not ok:
        checks.check(name, False, repr(payload)[:160])
        return
    expected = REQUIRED_INFERENCE_FIELDS | language_fields
    checks.check(
        f"{name} has frozen fields",
        status == 200 and set(payload) == expected,
        f"status={status} fields={sorted(payload)}",
    )
    checks.check(
        f"{name} has valid segments",
        valid_segments(payload.get("segments")),
        repr(payload.get("segments"))[:160],
    )
    checks.check(
        f"{name} exposes no diagnostics fields",
        not FORBIDDEN_INFERENCE_FIELDS.intersection(payload),
        str(sorted(FORBIDDEN_INFERENCE_FIELDS.intersection(payload))),
    )


def check_error(
    checks: Checker,
    name: str,
    status: int,
    payload: object,
    expected_status: int,
    expected_code: str,
) -> None:
    ok = (
        isinstance(payload, dict)
        and payload.get("code") == expected_code
        and isinstance(payload.get("detail"), str)
    )
    checks.check(
        name,
        status == expected_status and ok,
        f"status={status} payload={payload}",
    )


def run(checks: Checker) -> None:
    status, payload = checks.json_call("GET", "/health")
    checks.check(
        "GET /health stable contract",
        status == 200
        and isinstance(payload, dict)
        and payload.get("status") == "ok"
        and payload.get("service") == "transferhub"
        and isinstance(payload.get("version"), str)
        and bool(payload.get("version")),
        str(payload),
    )
    if status == 0:
        print(f"\nABORT: {checks.base} is not reachable, is the server up?")
        return

    status, payload = checks.json_call("GET", "/api/health")
    checks.check(
        "GET /api/health legacy compatibility",
        status == 200 and payload == {"status": "ok"},
        str(payload),
    )

    status, payload = checks.json_call("GET", "/api/status")
    checks.check(
        "GET /api/status runtime status",
        status == 200
        and isinstance(payload, dict)
        and set(payload) == {"status", "engine", "mock", "loaded_model", "device"}
        and payload["status"] in {"idle", "running"},
        str(payload),
    )

    status, payload = checks.json_call("GET", "/api/models")
    models = payload.get("models") if isinstance(payload, dict) else None
    checks.check(
        "GET /api/models has a model list",
        status == 200 and isinstance(models, list),
        str(payload),
    )
    if isinstance(models, list):
        checks.check(
            "ModelInfo fields are stable",
            all(isinstance(model, dict) and REQUIRED_MODEL_FIELDS <= set(model) for model in models),
            str(models),
        )

    status, payload = checks.json_call(
        "POST", "/api/models/load", {"model": "not-a-real-model"}
    )
    check_error(checks, "unknown model has a stable error code", status, payload, 404, "UNKNOWN_MODEL")

    status, payload = checks.json_call("POST", "/api/models/load", {"model": "chickenrice-v2"})
    checks.check(
        "POST /api/models/load",
        status == 200
        and isinstance(payload, dict)
        and payload.get("success") is True
        and payload.get("loaded_model") == "chickenrice-v2",
        str(payload),
    )
    status, payload = checks.json_call("POST", "/api/models/unload")
    checks.check(
        "POST /api/models/unload",
        status == 200
        and isinstance(payload, dict)
        and payload.get("success") is True
        and payload.get("loaded_model") is None,
        str(payload),
    )

    status, transcribe = checks.json_call("POST", "/api/transcribe", {"path": "D:\\ASMR\\test.flac"})
    check_inference_payload(checks, "POST /api/transcribe", status, transcribe, {"language"})
    status, translate = checks.json_call(
        "POST", "/api/translate-audio", {"path": "D:\\ASMR\\test.flac"}
    )
    check_inference_payload(
        checks,
        "POST /api/translate-audio",
        status,
        translate,
        {"source_language", "target_language"},
    )

    checks.check(
        "transcribe and translate use one base result schema",
        isinstance(transcribe, dict)
        and isinstance(translate, dict)
        and (set(transcribe) - {"language"}) == (set(translate) - {"source_language", "target_language"}),
        f"transcribe={sorted(transcribe) if isinstance(transcribe, dict) else transcribe} "
        f"translate={sorted(translate) if isinstance(translate, dict) else translate}",
    )

    status, payload = checks.json_call("GET", "/api/output/not-exists.json")
    check_error(checks, "missing output has a stable error code", status, payload, 404, "OUTPUT_NOT_FOUND")
    status, payload = checks.json_call("GET", "/api/output/config.toml")
    check_error(checks, "invalid output name has a stable error code", status, payload, 422, "INVALID_PATH")

    for filename in ("test.transcribe.json", "test.transcribe.srt", "test.zh.json", "test.zh.srt"):
        checks.check(f"output/{filename} exists", (checks.output_dir / filename).is_file())

    holder: dict[str, object] = {}

    def slow_request() -> None:
        holder["status"], holder["payload"] = checks.json_call(
            "POST", "/api/transcribe", {"path": "D:\\ASMR\\busy.flac"}
        )

    thread = threading.Thread(target=slow_request)
    thread.start()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        status, payload = checks.json_call("GET", "/api/status")
        if status == 200 and isinstance(payload, dict) and payload.get("status") == "running":
            break
        time.sleep(0.05)
    status, payload = checks.json_call(
        "POST", "/api/translate-audio", {"path": "D:\\ASMR\\test.flac"}
    )
    thread.join()
    check_error(checks, "busy engine has a stable error code", status, payload, 409, "ENGINE_BUSY")
    checks.check("busy request eventually succeeds", holder.get("status") == 200, str(holder))

    for path, needle in (("/diagnostics.html", "acceptance runner"), ("/docs", "swagger")):
        status, raw = checks.request("GET", path)
        checks.check(f"GET {path} is available", status == 200 and needle in raw.lower(), str(status))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parents[1] / "output"),
    )
    args = parser.parse_args()
    checks = Checker(args.base_url, Path(args.output_dir))
    run(checks)
    result = "ALL CHECKS PASSED" if not checks.failed else f"{checks.failed} CHECK(S) FAILED"
    print(f"\n{result} (base={args.base_url})")
    return 1 if checks.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
