from __future__ import annotations


class TranslationProvider:
    """Boundary for a future translation implementation."""

    async def translate(self, *args: object, **kwargs: object) -> None:
        raise NotImplementedError
