"""Phase 2 acceptance checks (spec section 48) against a running real-engine server.

Unlike ``smoke_check.py`` this drives ``engine = "faster-whisper"`` and needs one
real audio file:

    .venv\\Scripts\\python scripts\\phase2_check.py --file "D:\\ASMR\\test.flac"

Add ``--expect-device cuda`` to assert the GPU run, and force
``device = "cpu"`` in ``config.toml`` to assert the CPU-fallback run.
Nothing here can pass without a genuine model and genuine media.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_check import Checker  # noqa: E402

SRT_LINE = re.compile(r"\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}")


def media_stem(path: str) -> str:
    parts = [part for part in re.split(r"[\\/]+", path.strip()) if part]
    return Path(parts[-1]).stem if parts else ""


def run(checks: Checker, args) -> dict:
    summary: dict = {}

    status, payload = checks.json_call("GET", "/api/health")
    checks.check("GET /api/health", status == 200 and payload == {"status": "ok"}, str(payload))
    if status == 0:
        print(f"\nABORT: {checks.base} is not reachable. Start it with run.bat.")
        return summary

    status, payload = checks.json_call("GET", "/api/status")
    checks.check(
        "GET /api/status serves the real engine",
        status == 200
        and payload.get("engine") == "faster-whisper"
        and payload.get("mock") is False,
        str(payload),
    )
    device = payload.get("device")
    summary["device"] = device
    if args.expect_device:
        checks.check(
            f"device is {args.expect_device}",
            device == args.expect_device,
            f"got {device!r}; force [faster_whisper] device in config.toml to change it",
        )
    else:
        checks.check("device reported", device in {"cpu", "cuda"}, str(device))

    status, payload = checks.json_call("GET", "/api/models")
    models = {model["id"]: model for model in payload.get("models", [])}
    target = models.get(args.model)
    checks.check(
        f"model {args.model} is installed",
        status == 200 and target is not None and target["installed"] is True,
        "missing -> run scripts/download_models.py --model "
        f"{args.model}; got {json.dumps(target, ensure_ascii=False) if target else None}",
    )
    if target is None or not target.get("installed"):
        print("\nABORT: the model is not installed, nothing else can be verified.")
        return summary

    started = time.perf_counter()
    status, payload = checks.json_call("POST", "/api/models/load", {"model": args.model})
    load_seconds = round(time.perf_counter() - started, 2)
    summary["load_seconds"] = load_seconds
    checks.check(
        "POST /api/models/load succeeds",
        status == 200 and payload.get("loaded_model") == args.model,
        f"{load_seconds}s {str(payload)[:120]}",
    )

    status, payload = checks.json_call("POST", "/api/transcribe", {"path": args.file})
    checks.check(
        "POST /api/transcribe returns 200 on real media",
        status == 200 and payload.get("success") is True and payload.get("mock") is False,
        str(payload)[:160] if isinstance(payload, dict) else str(payload),
    )
    if status != 200:
        print("\nABORT: real inference failed, remaining checks are meaningless.")
        return summary

    checks.check(
        "payload identifies model and language",
        payload.get("model") == args.model and payload.get("language") == args.language,
        f"model={payload.get('model')} language={payload.get('language')}",
    )
    checks.check(
        "schema is the mock schema",
        sorted(payload)
        == sorted(
            [
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
                "language",
            ]
        ),
        str(sorted(payload)),
    )

    segments = payload.get("segments", [])
    checks.check("real segments returned", len(segments) > 0, f"{len(segments)} segments")
    checks.check(
        "segment timeline is ordered and within audio",
        bool(segments)
        and all(
            isinstance(s["start"], (int, float))
            and isinstance(s["end"], (int, float))
            and s["end"] > s["start"] >= 0
            for s in segments
        )
        and segments == sorted(segments, key=lambda s: s["start"]),
        str(segments[:2])[:160],
    )
    checks.check(
        "text equals concatenated segments",
        payload.get("text", "").replace(" ", "")
        == "".join(s["text"] for s in segments).replace(" ", ""),
        f"text={str(payload.get('text'))[:60]!r}",
    )

    duration = payload.get("duration") or 0
    processing = payload.get("processing_time") or 0
    checks.check("audio duration is real", duration > 0, str(duration))
    checks.check(
        "metrics match their formulas",
        processing > 0
        and abs(payload["realtime_factor"] - round(processing / duration, 4)) < 1e-3
        and abs(payload["speed"] - round(duration / processing, 2)) < 1,
        f"duration={duration} processing={processing} "
        f"rtf={payload['realtime_factor']} speed={payload['speed']}",
    )
    summary.update(
        duration=duration,
        processing_time=processing,
        speed=payload.get("speed"),
        segments=len(segments),
        first_text=(segments[0]["text"] if segments else ""),
    )

    stem = media_stem(args.file)
    json_path = checks.output_dir / f"{stem}.transcribe.json"
    srt_path = checks.output_dir / f"{stem}.transcribe.srt"
    checks.check("output JSON written", json_path.is_file(), str(json_path.name))
    checks.check("output SRT written", srt_path.is_file(), str(srt_path.name))
    if srt_path.is_file():
        srt = srt_path.read_text(encoding="utf-8")
        blocks = SRT_LINE.findall(srt)
        checks.check(
            "SRT uses standard timestamps",
            len(blocks) == len(segments),
            f"{len(blocks)} blocks for {len(segments)} segments",
        )
    if json_path.is_file():
        stored = json.loads(json_path.read_text(encoding="utf-8"))
        checks.check(
            "output JSON mirrors the response",
            stored.get("text") == payload.get("text")
            and len(stored.get("segments", [])) == len(segments),
        )

    status, payload = checks.json_call(
        "POST", "/api/transcribe", {"path": str(Path(args.file).parent / "definitely-missing.flac")}
    )
    checks.check("missing file rejected with 422", status == 422, str(payload)[:100])

    bogus = Path.cwd() / "phase2_check_not_audio.txt"
    bogus.write_text("not audio", encoding="utf-8")
    try:
        status, payload = checks.json_call("POST", "/api/transcribe", {"path": str(bogus)})
        checks.check("unsupported type rejected with 400", status == 400, str(payload)[:100])
    finally:
        bogus.unlink()

    holder: dict = {}

    def busy_request() -> None:
        holder["status"], holder["payload"] = checks.json_call(
            "POST", "/api/transcribe", {"path": args.file}
        )

    thread = threading.Thread(target=busy_request)
    thread.start()
    time.sleep(0.2)
    status, payload = checks.json_call("POST", "/api/transcribe", {"path": args.file})
    thread.join()
    if status == 409:
        checks.check(
            "second concurrent request gets 409",
            payload == {"detail": "Inference engine is busy"},
            str(payload)[:80],
        )
        checks.check("first request still succeeds", holder.get("status") == 200)
    else:
        checks.check(
            "busy lock observed",
            False,
            "INCONCLUSIVE: the first inference finished in under a second. Re-run with a "
            "longer file (5 minutes of audio is the Phase 5 target) to exercise the lock.",
        )

    for path, needle in (("/", "local trans api demo"), ("/docs", "swagger")):
        status, raw = checks.text_call("GET", path)
        checks.check(
            f"GET {path} serves the page",
            status == 200 and needle in raw.lower(),
            str(status),
        )

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, help="real audio file the server can read")
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    parser.add_argument("--model", default="whisper-ja-1.5b")
    parser.add_argument("--language", default="ja", help="expected payload language")
    parser.add_argument("--expect-device", choices=("cpu", "cuda"), default=None)
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parents[1] / "output"),
    )
    args = parser.parse_args()

    checks = Checker(args.base_url, Path(args.output_dir))
    summary = run(checks, args)
    print("\n--- Phase 2 summary ---")
    for key, value in summary.items():
        print(f"{key:16s} {value}")
    print(f"\n{checks.failed} check(s) failed")
    return 1 if checks.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
