"""TransHub GPU Preflight diagnostic CLI.

Run standalone or as a pre-launch gate:
    python scripts/preflight.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.preflight import run_preflight


def _format_bytes(bytes_val: int) -> str:
    mb = bytes_val / (1024 * 1024)
    gb = mb / 1024
    if gb >= 1.0:
        return f"{gb:.2f} GB ({mb:.0f} MB)"
    return f"{mb:.0f} MB"


def main() -> int:
    report = run_preflight()

    print("=" * 68)
    print("                TransHub GPU Preflight Report")
    print("=" * 68)
    print(f"Platform: {report['platform']}")

    gpu = report.get("gpu", {})
    print("\n[1. NVIDIA GPU & Driver]")
    if gpu.get("available"):
        print(f"  Driver Version:      {gpu.get('driver_version') or 'Unknown'}")
        print(f"  CUDA Driver Support: {gpu.get('cuda_driver_version') or 'Unknown'}")
        devices = gpu.get("devices", [])
        print(f"  Detected Devices:    {len(devices)}")
        for dev in devices:
            total_str = _format_bytes(dev['total_memory_bytes'])
            free_str = _format_bytes(dev['free_memory_bytes'])
            print(f"    [{dev['index']}] {dev['name']}")
            print(f"        VRAM: {free_str} free / {total_str} total")
    else:
        print(f"  Status: NOT AVAILABLE ({gpu.get('error') or 'Driver not detected'})")

    cuda = report.get("cuda", {})
    print("\n[2. CUDA Runtime (ctranslate2)]")
    print(f"  Available:           {'Yes' if cuda.get('available') else 'No'}")
    print(f"  CUDA Device Count:   {cuda.get('device_count', 0)}")
    if cuda.get("error"):
        print(f"  Query Error:         {cuda.get('error')}")

    dlls = report.get("dlls", {})
    print("\n[3. Windows Runtime DLLs (CUDA 12.x / cuDNN 9)]")
    if dlls.get("status") == "skipped":
        print(f"  Status: SKIPPED (non-Windows platform: {report['platform']})")
    else:
        dll_dict = dlls.get("dlls", {})
        for name, info in dll_dict.items():
            if info.get("found"):
                print(f"  [OK]   {name:<18} -> {info.get('path')}")
            else:
                print(f"  [MISS] {name:<18} -> NOT FOUND")

    print("\n" + "=" * 68)
    if report["ok"]:
        print("Status: PASSED - All GPU & CUDA requirements satisfied.")
        print("=" * 68)
        return 0

    print("Status: FAILED - GPU Preflight detected issues:")
    print("-" * 68)
    for i, problem in enumerate(report.get("problems", []), start=1):
        print(f"  {i}. {problem}")

    hints = report.get("hints", [])
    if hints:
        print("\nActionable Remediation Hints:")
        print("-" * 68)
        for i, hint in enumerate(hints, start=1):
            print(f"  * {hint}")
    print("=" * 68)
    return 1


if __name__ == "__main__":
    sys.exit(main())
