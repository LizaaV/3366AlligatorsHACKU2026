"""Extra checks on agent-written scripts, on top of the sandbox's AST scan (HANDOFF B2, B8).

The sandbox scan (`app.services.sandbox.scan_script`) allows public attributes of the earth
types. Some of those are pydantic helpers that read files or raw input, e.g.
`earth.Area.parse_file(".env")`, whose `JSONDecodeError.doc` then carries the file text;
others reach files through a `Path`. The agent only needs the documented earth API, so these
names are refused before a script runs (`scan_agent_script`). Skills are reviewed code and
are not checked here.

Results are also redacted (`agent.validate.redact_secrets`) before they reach the model, the
store or a block, as a second wall.
"""

from __future__ import annotations

import ast

__all__ = ["BANNED_ATTRS", "scan_agent_script"]

#: Attribute names an agent script may not use: pydantic loaders and constructors that read
#: files or skip validation, exception fields that carry raw input, and file-system methods.
BANNED_ATTRS: frozenset[str] = frozenset(
    {
        # pydantic (v1 compatibility API and v2) loaders, raw constructors, schema helpers
        "parse_file",
        "parse_raw",
        "parse_obj",
        "from_orm",
        "construct",
        "model_construct",
        "schema",
        "schema_json",
        "validate",
        "update_forward_refs",
        "model_rebuild",
        "model_post_init",
        "model_fields",
        "model_config",
        # exception fields holding the raw input (JSONDecodeError.doc, OSError args, ...)
        "doc",
        "args",
        "with_traceback",
        "filename",
        "filename2",
        # file-system access through any Path-like object
        "read_text",
        "read_bytes",
        "write_text",
        "write_bytes",
        "open",
        "unlink",
        "iterdir",
        "glob",
        "rglob",
        "mkdir",
        "rmdir",
        "touch",
        "chmod",
        "symlink_to",
        "hardlink_to",
        "expanduser",
        "home",
        "cwd",
        "readlink",
    }
)


def scan_agent_script(script: str) -> str | None:
    """Why the agent's script may not run (names and lines), or None when it may.

    A syntax error is left to the sandbox scan, which explains it to the model.
    """
    try:
        tree = ast.parse(script)
    except SyntaxError:
        return None
    hits: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr in BANNED_ATTRS:
            hits.append((node.lineno, node.attr))
    if not hits:
        return None
    hits.sort()
    shown = "; ".join(f"line {ln}: '.{name}' is not allowed" for ln, name in hits[:3])
    more = f" (+{len(hits) - 3} more)" if len(hits) > 3 else ""
    return f"Script rejected before running: {shown}{more}"
