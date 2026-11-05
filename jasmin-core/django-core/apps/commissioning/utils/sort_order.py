from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any

from django.db.models import Case, IntegerField, TextChoices, Value, When

from ..models import ShareType
from ..models.choices import (
    ShareTypeVariationSizeOptions,
    UnitOptions,
    VegetableSizeOptions,
)

# Units and sizes outside the known choices sort after every known one.
UNKNOWN_SORT_ORDER = 999


def share_type_ranks(
    variations: Iterable[tuple[ShareType, int, int]],
) -> dict[str, int]:
    """Each share type's position among the share types of ``variations``,
    given as ``(share_type, sort_order, size_order)`` per variation: the base
    (non-additional) share types first, then the additional ones, each by its
    lightest variation, then by name and id."""
    rank_keys: dict[str, tuple[Any, ...]] = {}
    for share_type, sort_order, size_order in variations:
        candidate = (
            share_type.is_additional_share_type,
            sort_order,
            size_order,
            share_type.name or "",
            str(share_type.id),
        )
        existing = rank_keys.get(share_type.id)
        if existing is None or candidate < existing:
            rank_keys[share_type.id] = candidate
    ranked = sorted(rank_keys, key=lambda share_type_id: rank_keys[share_type_id])
    return {share_type_id: index for index, share_type_id in enumerate(ranked)}


def size_order_annotation():
    """Build a Case/When annotation that maps ShareTypeVariationSizeOptions to their enum index."""
    whens = [
        When(size=choice[0], then=Value(idx))
        for idx, choice in enumerate(ShareTypeVariationSizeOptions.choices)
    ]
    return Case(*whens, default=Value(UNKNOWN_SORT_ORDER), output_field=IntegerField())


def create_share_article_sorter(
    unit_choices: type[TextChoices] | None = None,
    size_choices: type[TextChoices] | None = None,
) -> Callable[[dict[str, Any]], tuple[str, int, int]]:
    """
    Create a sorting function for share articles.

    Args:
        unit_choices: Django TextChoices class for units (defaults to UnitOptions)
        size_choices: Django TextChoices class for sizes (defaults to VegetableSizeOptions)

    Returns:
        A function that can be used as a key for sorting

    Example:
        >>> sorter = create_share_article_sorter()
        >>> data = [{'share_article_name': 'Tomato', 'unit': 'kg', 'size': 'L'}]
        >>> sorted(data, key=sorter)
    """
    # Use defaults if not provided
    unit_choices = unit_choices or UnitOptions
    size_choices = size_choices or VegetableSizeOptions

    # Create ordering mappings (1-indexed for clarity)
    unit_order = {choice[0]: idx for idx, choice in enumerate(unit_choices.choices, 1)}
    size_order = {choice[0]: idx for idx, choice in enumerate(size_choices.choices, 1)}

    def get_sort_key(item: dict[str, Any]) -> tuple[str, int, int]:
        """
        Custom sorting function for share articles.

        Sorts by: share_article_name -> unit -> size
        """
        share_article_name = item.get("share_article_name") or ""
        unit = item.get("unit") or ""
        size = item.get("size") or ""

        # Get numeric order for unit and size
        unit_order_value = unit_order.get(unit, UNKNOWN_SORT_ORDER)
        size_order_value = size_order.get(size, UNKNOWN_SORT_ORDER)

        return (share_article_name, unit_order_value, size_order_value)

    return get_sort_key


def sort_share_articles(
    data: list[dict[str, Any]],
    unit_choices: type[TextChoices] | None = None,
    size_choices: type[TextChoices] | None = None,
) -> list[dict[str, Any]]:
    """
    Sort a list of share article data.

    Args:
        data: List of dictionaries containing share article data
        unit_choices: Django TextChoices class for units (defaults to UnitOptions)
        size_choices: Django TextChoices class for sizes (defaults to VegetableSizeOptions)

    Returns:
        Sorted list of share articles

    Example:
        >>> articles = [
        ...     {'share_article_name': 'Tomato', 'unit': 'kg', 'size': 'L'},
        ...     {'share_article_name': 'Apple', 'unit': 'pieces', 'size': 'M'}
        ... ]
        >>> sorted_articles = sort_share_articles(articles)
    """
    sorter = create_share_article_sorter(unit_choices, size_choices)
    return sorted(data, key=sorter)
