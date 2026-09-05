"""Client Integration Acceptance Checker for TransHub (Productization item 4).

End-to-end verification of Stable API v1 from the perspective of a real caller:
1. Readiness sequence (4 endpoints: health -> preflight -> status -> models)
2. Warm-up (POST /api/models/load)
3. Upload & Transcribe pipeline (POST /api/upload -> POST /api/transcribe)
4. Translate Audio pipeline (POST /api/translate-audio)
5. Concurrency protection (409 ENGINE_BUSY) and exponential backoff retry
6. Local SRT reconstruction from response segments and server artifact consistency
7. Stable error contracts

Usage:
    # Real engine (Windows + CUDA):
    python scripts/client_integration_check.py --file "D:\\ASMR\\test.flac"

    # Mock engine (Mac / CI dev self-check):
    python scripts/client_integration_check.py --allow-mock --file samples/1.flac
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_check import (  # noqa: E402
    Checker,
    check_error,
    check_inference_payload,
    valid_segments,
)

CHINESE_TEXT_RE = re.compile(r"[\u4e00-\u9fff]")
SRT_BLOCK_RE = re.compile(
    r"(?P<index>\d+)\r?\n(?P<start>\d{2}:\d{2}:\d{2},\d{3}) --> (?P<end>\d{2}:\d{2}:\d{2},\d{3})\r?\n(?P<text>.+?)(?=\r?\n\r?\n|\Z)",
    re.DOTALL,
)


def format_srt_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def build_local_srt(segments: list[dict]) -> str:
    blocks = []
    for idx, seg in enumerate(segments, start=1):
        start_ts = format_srt_timestamp(float(seg["start"]))
        end_ts = format_srt_timestamp(float(seg["end"]))
        text = str(seg.get("text", "")).strip()
        blocks.append(f"{idx}\n{start_ts} --> {end_ts}\n{text}")
    return "\n\n".join(blocks) + "\n" if blocks else ""


class ClientIntegrationChecker(Checker):
    """Extends smoke_check.Checker with multipart file upload and client helpers."""

    def upload_file(self, file_path: Path) -> tuple[int, dict | str]:
        boundary = f"----ClientCheckBoundary{uuid.uuid4().hex}"
        filename = file_path.name
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        file_bytes = file_path.read_bytes()

        header_part = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        footer_part = f"\r\n--{boundary}--\r\n".encode("utf-8")

        body = header_part + file_bytes + footer_part
        req = urllib.request.Request(
            f"{self.base}/api/upload",
            data=body,
            method="POST",
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(body)),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8", "replace")
                return response.status, json.loads(raw)
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", "replace")
            try:
                return error.code, json.loads(raw)
            except json.JSONDecodeError:
                return error.code, raw
        except (urllib.error.URLError, OSError) as error:
            return 0, str(error)

    def raw_get(self, path: str) -> tuple[int, str]:
        return self.request("GET", path)


def run_client_lifecycle(checks: ClientIntegrationChecker, args: argparse.Namespace) -> dict[str, object]:
    summary: dict[str, object] = {
        "transcribe_model": args.transcribe_model,
        "translate_model": args.translate_model,
        "audio_file": str(args.file),
        "engine": None,
        "device": None,
        "warmup_seconds": None,
        "transcribe_duration": None,
        "transcribe_processing_time": None,
        "transcribe_speed": None,
        "concurrency_retry_ok": False,
        "srt_consistency_ok": False,
    }

    print("\n=== [1/7] Readiness Four-Step Assertion ===")
    # Step 1: Health
    status, health = checks.json_call("GET", "/health")
    checks.check(
        "1.1 GET /health alive",
        status == 200
        and isinstance(health, dict)
        and health.get("status") == "ok"
        and health.get("service") == "transferhub"
        and isinstance(health.get("version"), str)
        and bool(health.get("version")),
        str(health),
    )
    if status != 200:
        print(f"ABORT: Server at {checks.base} is unreachable or unhealthy.")
        return summary

    # Step 2: Setup Preflight
    status, preflight = checks.json_call("GET", "/api/setup/preflight")
    if args.allow_mock:
        checks.check(
            "1.2 GET /api/setup/preflight (mock/dev allowance)",
            status == 200 and isinstance(preflight, dict) and "ok" in preflight,
            str(preflight)[:160],
        )
    else:
        checks.check(
            "1.2 GET /api/setup/preflight passed (real CUDA & DLLs)",
            status == 200
            and isinstance(preflight, dict)
            and preflight.get("ok") is True
            and bool(preflight.get("gpu", {}).get("devices"))
            and preflight.get("cuda", {}).get("runtime_ok") is True
            and preflight.get("dlls", {}).get("all_ok") is True,
            f"ok={preflight.get('ok')} problems={preflight.get('problems')} hints={preflight.get('hints')}",
        )
        if not (isinstance(preflight, dict) and preflight.get("ok")):
            print("ABORT: Hardware/CUDA preflight check failed.")
            return summary

    # Step 3: Status
    status, state = checks.json_call("GET", "/api/status")
    engine = state.get("engine") if isinstance(state, dict) else None
    mock = state.get("mock") if isinstance(state, dict) else None
    device = state.get("device") if isinstance(state, dict) else None
    summary["engine"] = engine
    summary["device"] = device
    if args.allow_mock:
        checks.check(
            "1.3 GET /api/status runtime state",
            status == 200 and isinstance(state, dict) and state.get("status") in {"idle", "running"},
            str(state),
        )
    else:
        checks.check(
            "1.3 GET /api/status serves real faster-whisper on CUDA",
            status == 200 and engine == "faster-whisper" and mock is False and device == "cuda",
            f"engine={engine} mock={mock} device={device}",
        )
        if engine != "faster-whisper" or device != "cuda":
            print("ABORT: Server is not running faster-whisper on CUDA.")
            return summary

    # Step 4: Models
    status, models_resp = checks.json_call("GET", "/api/models")
    models_list = models_resp.get("models") if isinstance(models_resp, dict) else []
    models_map = {m["id"]: m for m in models_list if isinstance(m, dict) and "id" in m}
    checks.check(
        f"1.4 GET /api/models contains transcribe model '{args.transcribe_model}'",
        args.transcribe_model in models_map,
        str(list(models_map.keys())),
    )
    if not args.allow_mock:
        target_model = models_map.get(args.transcribe_model, {})
        checks.check(
            f"1.4 transcribe model '{args.transcribe_model}' is installed",
            target_model.get("installed") is True,
            str(target_model),
        )
        if not target_model.get("installed"):
            print(f"ABORT: Model {args.transcribe_model} is not installed.")
            return summary

    print("\n=== [2/7] Model Warm-up (POST /api/models/load) ===")
    started = time.perf_counter()
    status, load_resp = checks.json_call(
        "POST", "/api/models/load", {"model": args.transcribe_model}
    )
    load_elapsed = round(time.perf_counter() - started, 3)
    summary["warmup_seconds"] = load_elapsed
    checks.check(
        f"2.1 Warm up model '{args.transcribe_model}' succeeds",
        status == 200
        and isinstance(load_resp, dict)
        and load_resp.get("success") is True
        and load_resp.get("loaded_model") == args.transcribe_model,
        f"status={status} elapsed={load_elapsed}s",
    )

    print("\n=== [3/7] Upload & Transcribe Pipeline ===")
    media_file = Path(args.file).resolve()
    if not media_file.is_file():
        checks.check(f"Audio file '{media_file}' exists", False, "File not found")
        print(f"ABORT: Specified audio file {media_file} does not exist.")
        return summary

    # 3.1 Upload
    upload_status, upload_body = checks.upload_file(media_file)
    checks.check(
        "3.1 POST /api/upload saves audio file and returns server path",
        upload_status == 200
        and isinstance(upload_body, dict)
        and "path" in upload_body
        and "name" in upload_body
        and upload_body["name"].endswith(media_file.suffix),
        f"status={upload_status} body={upload_body}",
    )
    if upload_status != 200 or not isinstance(upload_body, dict) or "path" not in upload_body:
        print("ABORT: Audio upload failed.")
        return summary

    uploaded_server_path = upload_body["path"]
    uploaded_name = upload_body["name"]
    uploaded_stem = Path(uploaded_name).stem

    # 3.2 Transcribe
    status, transcribe_resp = checks.json_call(
        "POST", "/api/transcribe", {"path": uploaded_server_path}
    )
    check_inference_payload(
        checks, "3.2 POST /api/transcribe", status, transcribe_resp, {"language"}
    )
    if status != 200 or not isinstance(transcribe_resp, dict) or not transcribe_resp.get("success"):
        print("ABORT: Transcription failed.")
        return summary

    segments = transcribe_resp.get("segments", [])
    checks.check(
        "3.3 Segments are non-empty and temporally ordered",
        valid_segments(segments)
        and len(segments) > 0
        and all(
            seg["start"] >= 0 and seg["end"] > seg["start"]
            for seg in segments
        )
        and segments == sorted(segments, key=lambda s: s["start"]),
        f"count={len(segments)} first={segments[0] if segments else None}",
    )
    duration = transcribe_resp.get("duration", 0)
    proc_time = transcribe_resp.get("processing_time", 0)
    summary["transcribe_duration"] = duration
    summary["transcribe_processing_time"] = proc_time
    summary["transcribe_speed"] = transcribe_resp.get("speed")
    checks.check(
        "3.4 Performance metrics are consistent",
        duration > 0
        and proc_time > 0
        and abs(transcribe_resp["realtime_factor"] - round(proc_time / duration, 4)) < 1e-3
        and abs(transcribe_resp["speed"] - round(duration / proc_time, 2)) < 1,
        f"duration={duration}s proc={proc_time}s speed={transcribe_resp.get('speed')}",
    )

    print("\n=== [4/7] Translate Audio Pipeline ===")
    translate_resp = None
    if args.skip_translate:
        print("SKIP: --skip-translate set, skipping translation pipeline.")
    else:
        tr_model = models_map.get(args.translate_model)
        tr_installed = tr_model.get("installed") if tr_model else False
        if not args.allow_mock and not tr_installed:
            print(f"SKIP: Translation model '{args.translate_model}' not installed.")
        else:
            status, translate_resp = checks.json_call(
                "POST", "/api/translate-audio", {"path": uploaded_server_path}
            )
            check_inference_payload(
                checks,
                "4.1 POST /api/translate-audio",
                status,
                translate_resp,
                {"source_language", "target_language"},
            )
            if status == 200 and isinstance(translate_resp, dict):
                checks.check(
                    "4.2 Translation specifies ja -> zh-CN",
                    translate_resp.get("source_language") == "ja"
                    and translate_resp.get("target_language") == "zh-CN",
                    f"source={translate_resp.get('source_language')} target={translate_resp.get('target_language')}",
                )
                if not args.allow_mock:
                    checks.check(
                        "4.3 Translated text contains Chinese characters",
                        bool(CHINESE_TEXT_RE.search(translate_resp.get("text", ""))),
                        f"text={str(translate_resp.get('text'))[:60]}",
                    )

    print("\n=== [5/7] Concurrency & 409 Exponential Backoff Retry ===")
    bg_result: dict[str, object] = {}

    def background_infer():
        bg_status, bg_body = checks.json_call(
            "POST", "/api/transcribe", {"path": uploaded_server_path}
        )
        bg_result["status"] = bg_status
        bg_result["body"] = bg_body

    bg_thread = threading.Thread(target=background_infer)
    bg_thread.start()

    # Allow thread to start and occupy the single inference slot
    time.sleep(0.05)

    # Concurrently launch second request with backoff retry
    retry_attempts = 0
    max_retries = 15
    base_backoff = 0.2
    max_backoff = 3.0
    got_409_busy = False
    final_retry_status = None
    final_retry_body = None

    for attempt in range(1, max_retries + 1):
        retry_status, retry_body = checks.json_call(
            "POST", "/api/transcribe", {"path": uploaded_server_path}
        )
        if retry_status == 409:
            got_409_busy = True
            retry_attempts += 1
            backoff = min(max_backoff, base_backoff * (1.6 ** (attempt - 1)))
            time.sleep(backoff)
            continue
        final_retry_status = retry_status
        final_retry_body = retry_body
        break

    bg_thread.join()

    checks.check(
        "5.1 Concurrent second request encountered 409 ENGINE_BUSY",
        got_409_busy,
        f"got_409={got_409_busy} retries_needed={retry_attempts}",
    )
    checks.check(
        "5.2 Retry request eventually succeeded with HTTP 200",
        final_retry_status == 200
        and isinstance(final_retry_body, dict)
        and final_retry_body.get("success") is True,
        f"final_status={final_retry_status}",
    )
    checks.check(
        "5.3 Background request completed with HTTP 200",
        bg_result.get("status") == 200,
        f"bg_status={bg_result.get('status')}",
    )
    summary["concurrency_retry_ok"] = bool(got_409_busy and final_retry_status == 200)

    print("\n=== [6/7] SRT Local Reconstruction vs Server Output Artifact ===")
    # 6.1 Reconstruct SRT locally from transcribe response segments
    local_srt = build_local_srt(segments)
    local_blocks = SRT_BLOCK_RE.findall(local_srt)
    checks.check(
        "6.1 Locally reconstructed SRT has valid subtitle blocks matching segments",
        len(local_blocks) == len(segments),
        f"reconstructed_blocks={len(local_blocks)} segments={len(segments)}",
    )

    # 6.2 Fetch server-side output via GET /api/output/{uploaded_stem}.transcribe.srt
    server_srt_name = f"{uploaded_stem}.transcribe.srt"
    srt_status, server_srt_raw = checks.raw_get(f"/api/output/{server_srt_name}")
    checks.check(
        f"6.2 GET /api/output/{server_srt_name} returns 200",
        srt_status == 200 and len(server_srt_raw.strip()) > 0,
        f"status={srt_status} len={len(server_srt_raw)}",
    )

    if srt_status == 200:
        server_blocks = SRT_BLOCK_RE.findall(server_srt_raw)
        checks.check(
            "6.3 Server SRT block count equals local reconstructed block count",
            len(server_blocks) == len(local_blocks),
            f"server={len(server_blocks)} local={len(local_blocks)}",
        )
        # Verify first and last block timestamps and text
        if local_blocks and server_blocks:
            first_match = (
                local_blocks[0][1] == server_blocks[0][1]  # start
                and local_blocks[0][2] == server_blocks[0][2]  # end
                and local_blocks[0][3].strip() == server_blocks[0][3].strip()  # text
            )
            checks.check("6.4 First subtitle block timestamps and text match exactly", first_match)
            summary["srt_consistency_ok"] = (len(server_blocks) == len(local_blocks) and first_match)

    # 6.3 Fetch server-side JSON output
    server_json_name = f"{uploaded_stem}.transcribe.json"
    json_status, server_json_body = checks.json_call("GET", f"/api/output/{server_json_name}")
    checks.check(
        f"6.5 GET /api/output/{server_json_name} matches response text and segment count",
        json_status == 200
        and isinstance(server_json_body, dict)
        and server_json_body.get("text") == transcribe_resp.get("text")
        and len(server_json_body.get("segments", [])) == len(segments),
        f"status={json_status}",
    )

    print("\n=== [7/7] Error Contract Conformance ===")
    # 7.1 Unsupported upload suffix -> 400 UNSUPPORTED_FILE
    dummy_txt = Path(checks.output_dir) / "dummy_test.txt"
    dummy_txt.write_text("plain text file", encoding="utf-8")
    try:
        err_status, err_body = checks.upload_file(dummy_txt)
        check_error(
            checks,
            "7.1 Upload unsupported suffix returns 400 UNSUPPORTED_FILE",
            err_status,
            err_body,
            400,
            "UNSUPPORTED_FILE",
        )
    finally:
        dummy_txt.unlink(missing_ok=True)

    # 7.2 Transcribe missing path -> 422 INVALID_PATH (Real engine only)
    if not args.allow_mock and not mock:
        status, payload = checks.json_call(
            "POST", "/api/transcribe", {"path": "C:\\non_existent_audio_path.flac"}
        )
        check_error(
            checks,
            "7.2 Transcribe non-existent path returns 422 INVALID_PATH",
            status,
            payload,
            422,
            "INVALID_PATH",
        )
    else:
        print("SKIP: 7.2 Transcribe non-existent path check skipped on MockEngine (MockEngine permits dummy paths for CI)")

    # 7.3 Load unknown model -> 404 UNKNOWN_MODEL
    status, payload = checks.json_call(
        "POST", "/api/models/load", {"model": "non_existent_model_id"}
    )
    check_error(
        checks,
        "7.3 Load unknown model returns 404 UNKNOWN_MODEL",
        status,
        payload,
        404,
        "UNKNOWN_MODEL",
    )

    # 7.4 Non-existent output artifact -> 404 OUTPUT_NOT_FOUND
    status, payload = checks.json_call("GET", "/api/output/non_existent.json")
    check_error(
        checks,
        "7.4 Read non-existent output returns 404 OUTPUT_NOT_FOUND",
        status,
        payload,
        404,
        "OUTPUT_NOT_FOUND",
    )

    # 7.5 Directory traversal / invalid output name -> 422 INVALID_PATH
    status, payload = checks.json_call("GET", "/api/output/invalid_name.txt")
    check_error(
        checks,
        "7.5 Read invalid output name returns 422 INVALID_PATH",
        status,
        payload,
        422,
        "INVALID_PATH",
    )

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8765", help="TransHub base URL")
    parser.add_argument("--file", required=True, help="Path to audio file for acceptance testing")
    parser.add_argument("--transcribe-model", default="whisper-ja-1.5b", help="Model for transcription")
    parser.add_argument("--translate-model", default="chickenrice-v2", help="Model for audio translation")
    parser.add_argument("--timeout", type=float, default=900.0, help="Per-request timeout in seconds")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    parser.add_argument(
        "--allow-mock",
        action="store_true",
        help="Allow running against Mock engine (for Mac / CI self-testing)",
    )
    parser.add_argument(
        "--skip-translate",
        action="store_true",
        help="Skip translation checks if translation model is not yet installed",
    )
    args = parser.parse_args()

    output_path = Path(args.output_dir).resolve()
    output_path.mkdir(parents=True, exist_ok=True)
    checks = ClientIntegrationChecker(args.base_url, output_path, timeout=args.timeout)

    print(f"Starting Client Integration Acceptance Check...")
    print(f"Target: {args.base_url}")
    print(f"File:   {args.file}")
    print(f"Mode:   {'Mock Allowance (Dev/CI)' if args.allow_mock else 'Strict CUDA Real Engine'}")

    summary = run_client_lifecycle(checks, args)

    print("\n--- Client Integration Summary ---")
    for k, v in summary.items():
        print(f"{k:28s}: {v}")

    print(f"\nResult: {'ALL CHECKS PASSED (0 failed)' if checks.failed == 0 else f'{checks.failed} CHECK(S) FAILED'}")
    return 1 if checks.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
