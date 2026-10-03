"""Validate the knowledge base from the command line.

    uv run --with pyyaml python -m knowledge.validate [--root PATH]

Prints warnings and errors, then a summary. Exits 1 when there is any error.
"""

import argparse
import sys
from pathlib import Path

from .loader import check_knowledge


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m knowledge.validate")
    parser.add_argument("--root", type=Path, default=None, help="knowledge folder to check")
    args = parser.parse_args(argv)

    result = check_knowledge(args.root)
    for w in result.warnings:
        print(f"WARNING {w}")
    for e in result.errors:
        print(f"ERROR   {e}")

    c = result.counts
    print(
        f"\nknowledge ({'valid' if result.ok else 'INVALID'}): "
        f"{c['events']} events, {c['settings']} settings, {c['rules']} rules, "
        f"{c['templates']} templates, {c['tests']} policy tests; "
        f"{len(result.warnings)} warnings, {len(result.errors)} errors"
    )
    return 1 if result.errors else 0


if __name__ == "__main__":
    sys.exit(main())
