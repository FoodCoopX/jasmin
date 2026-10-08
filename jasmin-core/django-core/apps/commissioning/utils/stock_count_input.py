"""Reading a stock count request: the entry its composite id names and the
counted amount its body carries."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from rest_framework.request import Request

from apps.shared.request_utils import body

from ..errors import CommissioningError
from .composite_id_utils import parse_composite_id
from .read_only_week import refuse_read_only_week


def writable_composite_id(composite_id: str) -> dict:
    """Parse a stock count's composite id, refusing a week the stock count page
    shows read-only (``PastWeekError``, 409).

    ``CompositeIdInvalid`` (a canonical 400) propagates, no re-wrap.
    """
    parsed = parse_composite_id(composite_id, code="stock.invalid_composite_id")
    refuse_read_only_week(parsed["year"], parsed["delivery_week"])
    return parsed


def parse_counted_amount(request: Request) -> Decimal | None:
    """Parse the absolute counted value out of an INVENTORY PATCH body.

    ``None`` means the body carries no ``amount`` at all — a metadata-only
    PATCH, which leaves the stored count alone.
    """
    raw = body(request).get("amount")
    if raw is None:
        return None
    try:
        amount = Decimal(str(raw))
    except (ValueError, TypeError, InvalidOperation) as exc:
        raise CommissioningError(
            "Amount must be a number",
            field="amount",
            code="stock.amount_not_number",
        ) from exc
    # ``Decimal("NaN")`` and ``Decimal("Infinity")`` construct without
    # raising, so the parse above lets them through. Neither is a countable
    # quantity, and comparing a NaN raises InvalidOperation — reject both as
    # "not a number".
    if not amount.is_finite():
        raise CommissioningError(
            "Amount must be a number",
            field="amount",
            code="stock.amount_not_number",
        )
    if amount < 0:
        raise CommissioningError(
            "Amount must be non-negative",
            field="amount",
            code="stock.amount_negative",
        )
    return amount
