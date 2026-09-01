from __future__ import annotations

import math
import os
from dataclasses import dataclass

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_LOG_LEVEL = "INFO"
DEFAULT_MOCK_TRANSCRIPTION_DELAY = 0.2
LOG_LEVELS = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}
TRUE_VALUES = {"1", "true", "yes", "on"}
FALSE_VALUES = {"0", "false", "no", "off"}


@dataclass(frozen=True)
class Settings:
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    log_level: str = DEFAULT_LOG_LEVEL
    mock_transcription_delay: float = DEFAULT_MOCK_TRANSCRIPTION_DELAY
    mock_transcription_fail: bool = False

    @classmethod
    def from_environment(cls) -> Settings:
        host = os.environ.get("TRANSFERHUB_HOST", DEFAULT_HOST).strip()
        if not host:
            raise ValueError("TRANSFERHUB_HOST must not be empty")

        port_value = os.environ.get("TRANSFERHUB_PORT", str(DEFAULT_PORT))
        try:
            port = int(port_value)
        except ValueError as exc:
            raise ValueError("TRANSFERHUB_PORT must be an integer") from exc
        if not 1 <= port <= 65535:
            raise ValueError("TRANSFERHUB_PORT must be between 1 and 65535")

        log_level = os.environ.get("TRANSFERHUB_LOG_LEVEL", DEFAULT_LOG_LEVEL)
        log_level = log_level.strip().upper()
        if log_level not in LOG_LEVELS:
            allowed = ", ".join(sorted(LOG_LEVELS))
            raise ValueError(f"TRANSFERHUB_LOG_LEVEL must be one of: {allowed}")

        delay_value = os.environ.get(
            "TRANSFERHUB_MOCK_TRANSCRIPTION_DELAY",
            str(DEFAULT_MOCK_TRANSCRIPTION_DELAY),
        )
        try:
            mock_transcription_delay = float(delay_value)
        except ValueError as exc:
            raise ValueError(
                "TRANSFERHUB_MOCK_TRANSCRIPTION_DELAY must be a number"
            ) from exc
        if not math.isfinite(mock_transcription_delay) or mock_transcription_delay < 0:
            raise ValueError(
                "TRANSFERHUB_MOCK_TRANSCRIPTION_DELAY must be a finite number "
                "greater than or equal to 0"
            )

        failure_value = (
            os.environ.get("TRANSFERHUB_MOCK_TRANSCRIPTION_FAIL", "false")
            .strip()
            .lower()
        )
        if failure_value in TRUE_VALUES:
            mock_transcription_fail = True
        elif failure_value in FALSE_VALUES:
            mock_transcription_fail = False
        else:
            allowed = ", ".join(sorted(TRUE_VALUES | FALSE_VALUES))
            raise ValueError(
                f"TRANSFERHUB_MOCK_TRANSCRIPTION_FAIL must be one of: {allowed}"
            )

        return cls(
            host=host,
            port=port,
            log_level=log_level,
            mock_transcription_delay=mock_transcription_delay,
            mock_transcription_fail=mock_transcription_fail,
        )
