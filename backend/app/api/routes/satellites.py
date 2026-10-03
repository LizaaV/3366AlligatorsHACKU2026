from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.schemas.satellites import SatelliteDto
from app.services import satellites as svc

router = APIRouter(tags=["satellites"])


@router.get("/satellites", response_model=list[SatelliteDto])
def list_satellites(
    at: Annotated[
        datetime | None, Query(description="ISO instant to propagate to; default now.")
    ] = None,
) -> list[SatelliteDto]:
    """Current positions of the free Earth-observation satellites, each with a ~90 min
    ground track (2-min steps) starting at `at`."""
    return svc.list_satellites(at)
