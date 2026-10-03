"""Read-only knowledge endpoints: card index, card detail and text lookup.

Only event and setting cards are exposed; the policy files (rules, tests) stay private.
"""

from __future__ import annotations

import re
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Path, Query

from app.schemas.knowledge import CardDetail, CardIndexEntry
from knowledge import IndexEntry, KnowledgeBase, load_knowledge

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

CARD_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")


@lru_cache(maxsize=1)
def get_kb() -> KnowledgeBase:
    """Load and validate the knowledge base once per process."""
    return load_knowledge()


def _entry(e: IndexEntry) -> CardIndexEntry:
    return CardIndexEntry(
        id=e.id,
        type=e.type,  # type: ignore[arg-type]
        name=e.name,
        summary=e.summary,
        status=e.status,  # type: ignore[arg-type]
        version=e.version,
        aliases=list(e.aliases),
    )


def _index_by_id() -> dict[str, CardIndexEntry]:
    return {e.id: _entry(e) for e in get_kb().index()}


@router.get("/index", response_model=list[CardIndexEntry])
def knowledge_index() -> list[CardIndexEntry]:
    """Every event card then every setting card, each sorted by id."""
    return [_entry(e) for e in get_kb().index()]


@router.get("/cards/{card_id}", response_model=CardDetail)
def knowledge_card(card_id: str = Path(max_length=64)) -> CardDetail:
    """One card with its header and Markdown body. 400 for a malformed id, 404 if unknown."""
    if not CARD_ID_RE.fullmatch(card_id):
        raise HTTPException(status_code=400, detail="card_id must match ^[a-z0-9_]{1,64}$")
    kb = get_kb()
    try:
        card = kb.get(card_id)
        body = kb.body(card_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown card id: {card_id}") from None
    return CardDetail(
        entry=_index_by_id()[card_id],
        header=card.model_dump(mode="json"),
        body_markdown=body,
    )


@router.get("/find", response_model=list[CardIndexEntry])
def knowledge_find(q: str = Query(min_length=1, max_length=500)) -> list[CardIndexEntry]:
    """Cards whose id, name or alias appears in ``q``, in order of first appearance."""
    by_id = _index_by_id()
    return [by_id[cid] for cid in get_kb().find(q) if cid in by_id]
