from __future__ import annotations

from app.providers.translation import TranslationProvider


class MockTranslationProvider(TranslationProvider):
    """Placeholder provider; SAK-31 will define the request/result contract."""

    async def translate(self, *args: object, **kwargs: object) -> None:
        return None
