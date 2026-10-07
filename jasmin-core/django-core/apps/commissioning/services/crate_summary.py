"""Helpers to build crate summary rows shared by viewsets and serializers.

The shape returned by ``build_crate_summary_row`` matches the
``CrateItemSummarySerializer`` schema: decimal-shaped fields are rendered
as strings, ``rabatt`` and ``tax_rate`` as floats. Per-scope extras
(``order_*`` / ``delivery_note_*`` / ``invoice_*``) are merged via the
``extras`` argument so the dict keeps a stable layout across callers.
Each summary row is one crate line, named as ``crate_lines`` describes.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from decimal import Decimal
from typing import Any

from apps.shared.money import CENT

from ..models.mixin import line_netto
from .crate_lines import crate_line_id, crate_line_key, resolve_crate_line


def build_crate_summary_row(
    *,
    crate_type_id: Any,
    crate_type_name: str | None,
    amount: int | Decimal,
    price: Any,
    rabatt: Any,
    tax_rate: Any,
    line_netto_value: Any = None,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compose the canonical crate summary dict for a single crate line. Its
    ``id`` is the crate type id; ``summarize_crate_items`` names each line it
    builds by the line's rows instead.

    ``line_netto_value`` — when given (e.g. the SUM of the grouped rows'
    per-row ``line_netto``) it is used verbatim so the displayed per-line
    figure equals what the document footer sums. When ``None`` the net is
    computed from ``amount`` / ``price`` / ``rabatt`` — right for the empty
    placeholder row.
    """
    price_d = Decimal(str(price or 0))
    rabatt_d = Decimal(str(rabatt or 0))
    if line_netto_value is not None:
        line = Decimal(str(line_netto_value))
    else:
        line = line_netto(amount=amount, price_per_unit=price_d, rabatt=rabatt_d)

    row: dict[str, Any] = {
        "id": crate_type_id,
        "crate_type": crate_type_id,
        "crate_type_name": crate_type_name,
        "amount": amount,
        "price_per_unit": str(price_d),
        "rabatt": float(rabatt_d),
        "line_netto": str(line.quantize(CENT)),
        "tax_rate": float(tax_rate),
    }
    if extras:
        row.update(extras)
    return row


def summarize_crate_items(
    crate_items: Iterable[Any],
    *,
    extras: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Group crate line items into display summary rows.

    One row per crate line — distinct ``(crate_type, price_per_unit, rabatt,
    tax_rate)`` — so the displayed price / rabatt / tax_rate are exact rather
    than lossy ``max()`` aggregates, and ``line_netto`` is the SUM of the
    grouped rows' per-row ``line_netto`` — the same value the document footer
    (``sum_netto`` / ``tax_breakdown``) uses, so the per-line display and the
    totals never diverge. Homogeneous groups also avoid the
    ``max(None, Decimal)`` TypeError that a NULL ``price_per_unit`` mixed with
    a non-null one would raise. Each row's ``id`` is its line's id, while
    ``crate_type`` stays the crate type id.
    """
    groups: dict[tuple, list] = defaultdict(list)
    for crate_item in crate_items:
        groups[crate_line_key(crate_item)].append(crate_item)

    def _sort_key(entry: tuple) -> tuple:
        items = entry[1]
        name = items[0].crate_type.name
        price = items[0].price_per_unit
        return (name, price if price is not None else Decimal("0"))

    rows: list[dict[str, Any]] = []
    for _key, items in sorted(groups.items(), key=_sort_key):
        first = items[0]
        row = build_crate_summary_row(
            crate_type_id=first.crate_type_id,
            crate_type_name=first.crate_type.name,
            amount=sum((item.amount for item in items), Decimal("0")),
            price=first.price_per_unit,
            rabatt=first.rabatt or 0,
            tax_rate=first.tax_rate,
            line_netto_value=sum((item.line_netto for item in items), Decimal("0")),
            extras=extras,
        )
        row["id"] = crate_line_id(items)
        rows.append(row)
    return rows


def summarize_crate_line(
    type_rows: Iterable[Any],
    row_pk: str | None,
    *,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """The summary row of the line that holds the row ``row_pk`` among
    ``type_rows`` (the rows of one crate type on one document), or of the
    type's first line when ``row_pk`` is None. None when there is no such
    line."""
    rows = list(type_rows)
    line = rows if row_pk is None else resolve_crate_line(rows, row_pk)
    summary = summarize_crate_items(line or [], extras=extras)
    return summary[0] if summary else None
