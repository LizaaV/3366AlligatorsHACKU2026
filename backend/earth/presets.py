"""Demo preset areas (HANDOFF B12.2)."""

from earth.types import Area

# Hoo Hok Wai fish ponds, North District, HK. Centre from Nominatim; a 350 m circle ≈ 38 ha.
# Approximate: replace with the drawn pond outline once the frontend preset has one.
HOO_HOK_WAI = Area.from_point(22.5340, 114.0906, radius_m=350, name="Hoo Hok Wai ponds")
