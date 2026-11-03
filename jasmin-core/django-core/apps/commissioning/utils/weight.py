from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

WEIGHT_QUANTIZE = Decimal("0.001")


def quantize_weight(value: Decimal | float) -> Decimal:
    """3dp Decimal for share / packing weights — the single home for
    3-decimal weight rounding. Coerces float via ``str`` to dodge binary-fp
    drift (the money/quantity rule)."""
    if isinstance(value, float):
        value = str(value)
    return Decimal(value).quantize(WEIGHT_QUANTIZE, rounding=ROUND_HALF_UP)


def mean_weight(weights: Iterable[Decimal | None]) -> Decimal | None:
    """The mean of the weights that were taken, unrounded: an empty or zero
    weight wasn't taken and doesn't count. ``None`` when none was. A share's
    weight is the mean of its up to four weighings, and a week's average the
    mean of its shares' weights."""
    taken = [weight for weight in weights if weight is not None and weight > 0]
    return sum(taken, Decimal(0)) / len(taken) if taken else None
