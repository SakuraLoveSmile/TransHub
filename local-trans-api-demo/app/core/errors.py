"""Errors used by the stable and legacy-compatible API contracts."""

from __future__ import annotations


class V1APIError(Exception):
    """An expected v1 API failure with a stable public error shape."""

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: object | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


class AppError(Exception):
    """Expected failure for the original ``/api/*`` contract."""

    status_code: int = 500
    code: str = "INTERNAL_ERROR"

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class UnknownProfileError(AppError):
    status_code = 404
    code = "UNKNOWN_PROFILE"


class UnknownModelError(AppError):
    status_code = 404
    code = "UNKNOWN_MODEL"


class ModelNotInstalledError(AppError):
    status_code = 404
    code = "MODEL_NOT_INSTALLED"


class EngineBusyError(AppError):
    status_code = 409
    code = "ENGINE_BUSY"


class DownloadBusyError(AppError):
    status_code = 409
    code = "DOWNLOAD_BUSY"


class InvalidPathError(AppError):
    status_code = 422
    code = "INVALID_PATH"


class UnsupportedFileError(AppError):
    status_code = 400
    code = "UNSUPPORTED_FILE"


class OutputNotFoundError(AppError):
    status_code = 404
    code = "OUTPUT_NOT_FOUND"


class ModelLoadError(AppError):
    status_code = 503
    code = "MODEL_LOAD_FAILED"


class InferenceError(AppError):
    status_code = 500
    code = "INFERENCE_FAILED"


class EmptyFileError(AppError):
    status_code = 400
    code = "EMPTY_FILE"


class FileTooLargeError(AppError):
    status_code = 413
    code = "FILE_TOO_LARGE"


class InvalidRequestError(AppError):
    status_code = 422
    code = "INVALID_REQUEST"


class QueueFullError(AppError):
    status_code = 409
    code = "QUEUE_FULL"


class TaskNotFoundError(AppError):
    status_code = 404
    code = "TASK_NOT_FOUND"


class ResultNotReadyError(AppError):
    status_code = 409
    code = "RESULT_NOT_READY"


class ResultMissingError(AppError):
    status_code = 410
    code = "RESULT_MISSING"


class OutputWriteError(AppError):
    status_code = 500
    code = "OUTPUT_WRITE_FAILED"
