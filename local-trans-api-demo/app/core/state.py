import asyncio
from dataclasses import dataclass, field

from app.core.config import AppConfig
from app.engines.base import BaseInferenceEngine


@dataclass
class AppState:
    """Single-process demo state: one engine, one inference slot."""

    config: AppConfig
    engine: BaseInferenceEngine
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def busy(self) -> bool:
        return self.engine.busy

    @property
    def loaded_model(self) -> str | None:
        return self.engine.loaded_model
