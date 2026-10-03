"""Errors with hints (HANDOFF B1.7). The hint tells the agent what to try next."""


class EarthError(Exception):
    """Base error. `hint` is a short, actionable next step for the agent's fix loop."""

    kind = "earth_error"

    def __init__(self, message: str, hint: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint

    def to_dict(self) -> dict[str, str | None]:
        return {"kind": self.kind, "message": self.message, "hint": self.hint}

    def __str__(self) -> str:
        return f"{self.message}\n  Try: {self.hint}" if self.hint else self.message


class NoClearScenes(EarthError):
    kind = "no_clear_scenes"


class AreaTooSmall(EarthError):
    kind = "area_too_small"


class BudgetExceeded(EarthError):
    kind = "budget_exceeded"


class InvalidArea(EarthError):
    kind = "invalid_area"


class WrongSceneKind(EarthError):
    kind = "wrong_scene_kind"
