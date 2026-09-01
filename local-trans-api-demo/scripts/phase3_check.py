"""Run the Phase 3 CUDA-only Japanese-to-Chinese acceptance checks.

Run this from ``local-trans-api-demo`` after starting the real-engine server:

    .venv\\Scripts\\python scripts\\phase3_check.py --file "D:\\ASMR\\test.wav"

The checker validates the stable API response and generated JSON/SRT files. It
does not attempt to judge translation quality automatically; that remains a
manual review documented in ``docs/phase3-translation-quality.md``.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_check import Checker

CHINESE_TEXT = re.compile(r"[\u4e00-\u9fff]")
SRT_TIMESTAMP = re.compile(
    r"^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$",
    re.MULTILINE,
)
TRANSLATION_FIELDS = {
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
    "source_language",
    "target_language",
}
SEGMENT_END_TOLERANCE = 0.05


def media_stem(path: str) -> str:
    parts = [part for part in re.split(r"[\\/]+", path.strip()) if part]
    return Path(parts[-1]).stem or "untitled" if parts else "untitled"


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def normalize_text(value: str) -> str:
    """Ignore whitespace differences while comparing API and segment text."""
    return re.sub(r"\s+", "", value)


def valid_segment_items(segments: object) -> bool:
    return isinstance(segments, list) and all(
        isinstance(segment, dict)
        and is_number(segment.get("start"))
        and is_number(segment.get("end"))
        and isinstance(segment.get("text"), str)
        for segment in segments
    )


def check_output_json(
    checks: Checker,
    json_path: Path,
    payload: dict,
    segments: list[dict],
    expected_model: str,
) -> None:
    checks.check("translation JSON exists", json_path.is_file(), json_path.name)
    if not json_path.is_file():
        return

    try:
        stored = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        checks.check("translation JSON is valid UTF-8", False, str(error))
        return

    checks.check("translation JSON is valid UTF-8", True)
    checks.check(
        "translation JSON keeps API metadata",
        isinstance(stored, dict)
        and stored.get("model") == expected_model
        and stored.get("profile") == "ja-zh"
        and stored.get("source_language") == "ja"
        and stored.get("target_language") == "zh-CN",
        str(stored)[:220],
    )
    checks.check(
        "translation JSON mirrors API result",
        isinstance(stored, dict)
        and stored.get("text") == payload.get("text")
        and isinstance(stored.get("segments"), list)
        and len(stored["segments"]) == len(segments),
        str(stored)[:220],
    )


def check_output_srt(
    checks: Checker,
    srt_path: Path,
    segments: list[dict],
) -> None:
    checks.check("translation SRT exists", srt_path.is_file(), srt_path.name)
    if not srt_path.is_file():
        return

    try:
        srt = srt_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        checks.check("translation SRT is readable as UTF-8", False, str(error))
        return

    checks.check("translation SRT is readable as UTF-8", True)
    timestamp_count = len(SRT_TIMESTAMP.findall(srt))
    checks.check(
        "translation SRT has one standard block per segment",
        timestamp_count == len(segments),
        f"{timestamp_count} blocks for {len(segments)} segments",
    )
    checks.check(
        "translation SRT contains Chinese characters",
        bool(CHINESE_TEXT.search(srt)),
    )


def run(checks: Checker, args: argparse.Namespace) -> dict[str, object]:
    summary: dict[str, object] = {
        "device": None,
        "model": args.model,
        "load_seconds": None,
        "duration": None,
        "processing_time": None,
        "realtime_factor": None,
        "speed": None,
        "segments": None,
        "first_text": None,
    }

    status, payload = checks.json_call("GET", "/health")
    checks.check(
        "GET /health",
        status == 200
        and isinstance(payload, dict)
        and payload.get("status") == "ok"
        and payload.get("service") == "transferhub"
        and isinstance(payload.get("version"), str)
        and bool(payload.get("version")),
        str(payload),
    )
    if status == 0 or status != 200:
        print(f"\nABORT: {checks.base} is not reachable or failed health check.")
        return summary

    status, payload = checks.json_call("GET", "/api/status")
    device = payload.get("device") if isinstance(payload, dict) else None
    summary["device"] = device
    checks.check(
        "GET /api/status reports the CUDA real engine",
        status == 200
        and isinstance(payload, dict)
        and payload.get("engine") == "faster-whisper"
        and payload.get("mock") is False
        and payload.get("device") == "cuda",
        str(payload),
    )
    if status != 200 or not isinstance(payload, dict):
        print("\nABORT: runtime status is unavailable.")
        return summary

    status, payload = checks.json_call("GET", "/api/models")
    models = payload.get("models") if isinstance(payload, dict) else None
    target = (
        next(
            (
                model
                for model in models
                if isinstance(model, dict) and model.get("id") == args.model
            ),
            None,
        )
        if isinstance(models, list)
        else None
    )
    installed = isinstance(target, dict) and target.get("installed") is True
    checks.check(
        f"model {args.model} is installed",
        status == 200 and installed,
        json.dumps(target, ensure_ascii=False) if target else str(payload),
    )
    if not installed:
        print(
            "\nABORT: ChickenRice v2 is not installed. Install it with:\n"
            ".venv\\Scripts\\python scripts\\download_models.py "
            f"--model {args.model}"
        )
        return summary

    started = time.perf_counter()
    status, payload = checks.json_call(
        "POST", "/api/models/load", {"model": args.model}
    )
    load_seconds = round(time.perf_counter() - started, 2)
    summary["load_seconds"] = load_seconds
    checks.check(
        "POST /api/models/load",
        status == 200
        and isinstance(payload, dict)
        and payload.get("loaded_model") == args.model,
        f"{load_seconds}s {str(payload)[:160]}",
    )
    if status != 200 or not isinstance(payload, dict) or payload.get("loaded_model") != args.model:
        print("\nABORT: ChickenRice v2 could not be loaded.")
        return summary

    status, payload = checks.json_call(
        "POST", "/api/translate-audio", {"path": args.file}
    )
    checks.check(
        "POST /api/translate-audio returns a real translation",
        status == 200
        and isinstance(payload, dict)
        and payload.get("success") is True
        and payload.get("mock") is False
        and payload.get("profile") == "ja-zh"
        and payload.get("model") == args.model
        and payload.get("source_language") == "ja"
        and payload.get("target_language") == "zh-CN",
        str(payload)[:240],
    )
    if status != 200 or not isinstance(payload, dict) or payload.get("success") is not True:
        print("\nABORT: real translation failed, remaining checks are meaningless.")
        return summary

    checks.check(
        "translation response keeps the stable schema",
        set(payload) == TRANSLATION_FIELDS,
        str(sorted(payload)),
    )

    text = payload.get("text")
    segments = payload.get("segments")
    checks.check(
        "translated text is non-empty",
        isinstance(text, str) and bool(text.strip()),
        repr(text)[:160],
    )
    checks.check(
        "translated segments are non-empty",
        isinstance(segments, list) and bool(segments),
        f"{len(segments) if isinstance(segments, list) else 0} segments",
    )
    checks.check(
        "translated text contains Chinese characters",
        isinstance(text, str) and bool(CHINESE_TEXT.search(text)),
        repr(text)[:160],
    )

    duration = payload.get("duration")
    processing_time = payload.get("processing_time")
    duration_is_positive = is_number(duration) and duration > 0
    processing_is_positive = is_number(processing_time) and processing_time > 0
    checks.check("audio duration is positive", duration_is_positive, str(duration))
    checks.check(
        "processing time is positive", processing_is_positive, str(processing_time)
    )

    valid_items = valid_segment_items(segments)
    checks.check(
        "segments have valid ranges",
        valid_items
        and all(
            segment["start"] >= 0 and segment["end"] > segment["start"]
            for segment in segments
        ),
        str(segments[:2])[:220] if isinstance(segments, list) else str(segments),
    )
    starts = [segment["start"] for segment in segments] if valid_items else []
    checks.check(
        "segments are ordered by start time",
        bool(starts) and starts == sorted(starts),
        str(starts[:8]),
    )
    ends_within_duration = (
        valid_items
        and duration_is_positive
        and bool(segments)
        and segments[-1]["end"] <= duration + SEGMENT_END_TOLERANCE
    )
    checks.check(
        "last segment does not exceed audio duration",
        ends_within_duration,
        f"last_end={segments[-1]['end'] if valid_items and segments else None} duration={duration}",
    )
    checks.check(
        "text matches concatenated segment text",
        isinstance(text, str)
        and valid_items
        and normalize_text(text)
        == normalize_text("".join(segment["text"] for segment in segments)),
        repr(text)[:160],
    )

    expected_realtime_factor = (
        round(processing_time / duration, 4)
        if duration_is_positive and processing_is_positive
        else None
    )
    expected_speed = (
        round(duration / processing_time, 2)
        if duration_is_positive and processing_is_positive
        else None
    )
    metrics_match = (
        expected_realtime_factor is not None
        and expected_speed is not None
        and is_number(payload.get("realtime_factor"))
        and is_number(payload.get("speed"))
        and abs(payload["realtime_factor"] - expected_realtime_factor) < 1e-3
        and abs(payload["speed"] - expected_speed) < 1
    )
    checks.check(
        "performance metrics match the stable formulas",
        metrics_match,
        f"duration={duration} processing={processing_time} "
        f"rtf={payload.get('realtime_factor')} speed={payload.get('speed')}",
    )

    if duration_is_positive:
        summary["duration"] = duration
    if processing_is_positive:
        summary["processing_time"] = processing_time
    summary["realtime_factor"] = payload.get("realtime_factor")
    summary["speed"] = payload.get("speed")
    summary["segments"] = len(segments) if isinstance(segments, list) else 0
    summary["first_text"] = (
        segments[0].get("text")
        if valid_items and segments
        else ""
    )

    stem = media_stem(args.file)
    check_output_json(
        checks,
        checks.output_dir / f"{stem}.zh.json",
        payload,
        segments if isinstance(segments, list) else [],
        args.model,
    )
    check_output_srt(
        checks,
        checks.output_dir / f"{stem}.zh.srt",
        segments if isinstance(segments, list) else [],
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, help="real Japanese ASMR audio file")
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    parser.add_argument("--model", default="chickenrice-v2")
    parser.add_argument(
        "--timeout",
        type=float,
        default=900.0,
        help="seconds to wait for each HTTP request",
    )
    parser.add_argument("--output-dir", default="./output")
    args = parser.parse_args()

    checks = Checker(args.base_url, Path(args.output_dir), timeout=args.timeout)
    summary = run(checks, args)
    print("\n--- Phase 3 summary ---")
    for key, value in summary.items():
        print(f"{key:16s} {value}")
    print(f"\n{checks.failed} check(s) failed")
    return 1 if checks.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
