"""Unified API error types.

Handlers in ``app.main`` turn these into ``{"detail": "..."}`` responses, so no
traceback ever reaches the client.
"""

from __future__ import annotations


class AppError(Exception):
    status_code: int = 500

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class UnknownProfileError(AppError):
    status_code = 404


class UnknownModelError(AppError):
    status_code = 404


class ModelNotInstalledError(AppError):
    status_code = 404


class EngineBusyError(AppError):
    status_code = 409


class InvalidPathError(AppError):
    status_code = 422


class UnsupportedFileError(AppError):
    status_code = 400


class OutputNotFoundError(AppError):
    status_code = 404


class ModelLoadError(AppError):
    status_code = 503


class InferenceError(AppError):
    status_code = 500
