"""Earth Agent knowledge base: event cards, setting cards and policy rules.

Typical use::

    from knowledge import load_knowledge

    kb = load_knowledge()  # raises KnowledgeError listing every problem
    prompt_index = kb.index_text()
"""

from .loader import (
    CardParseError,
    CheckResult,
    IndexEntry,
    KnowledgeBase,
    KnowledgeError,
    check_knowledge,
    load_knowledge,
    parse_card,
)
from .schema import (
    ALL_MEASURES,
    BLOCK_TYPES,
    CATEGORIES,
    MEASURES_CONTEXT,
    MEASURES_PLANNED,
    MEASURES_V1,
    WORLDCOVER_CODES,
    EventCard,
    Policy,
    PolicyRule,
    PolicyTestCase,
    SettingCard,
    Template,
)

__all__ = [
    "ALL_MEASURES",
    "BLOCK_TYPES",
    "CATEGORIES",
    "MEASURES_CONTEXT",
    "MEASURES_PLANNED",
    "MEASURES_V1",
    "WORLDCOVER_CODES",
    "CardParseError",
    "CheckResult",
    "EventCard",
    "IndexEntry",
    "KnowledgeBase",
    "KnowledgeError",
    "Policy",
    "PolicyRule",
    "PolicyTestCase",
    "SettingCard",
    "Template",
    "check_knowledge",
    "load_knowledge",
    "parse_card",
]
