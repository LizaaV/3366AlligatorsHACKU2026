"""Write the API schema to contracts/openapi.json — the frontend/backend contract.

Run after any change to routes or schemas:  uv run python -m app.export_openapi
"""

import json
from pathlib import Path

from app.main import app

OUT = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"

if __name__ == "__main__":
    OUT.write_text(json.dumps(app.openapi(), indent=2) + "\n")
    print(f"wrote {OUT}")
