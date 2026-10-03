"""Rendered map layers: serves the PNGs `earth.render()` wrote for a run (BUILD-PLAN I5)."""

from __future__ import annotations

import typing

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import earth
from earth import settings
from earth.render import layer_path

router = APIRouter(tags=["layers"])

_MEASURES = frozenset(typing.get_args(earth.Measure)) | {"rgb"}


@router.get(
    "/layers/{run_id}/{measure}/{scene}.png",
    response_class=FileResponse,
    summary="A rendered layer image",
    responses={
        200: {"content": {"image/png": {}}, "description": "The layer as a PNG."},
        400: {"description": "Invalid run id, measure or scene id."},
        404: {"description": "No such layer."},
    },
)
def get_layer(run_id: str, measure: str, scene: str) -> FileResponse:
    """The PNG at the `url` of a `RenderedLayer` / block image."""
    if measure not in _MEASURES:
        raise HTTPException(status_code=400, detail="Unknown measure.")
    try:
        path = layer_path(run_id, measure, scene)  # validates run id and scene id
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid run id or scene id.") from exc
    root = (settings.data_dir() / "layers").resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Layer not found.")
    return FileResponse(resolved, media_type="image/png")
