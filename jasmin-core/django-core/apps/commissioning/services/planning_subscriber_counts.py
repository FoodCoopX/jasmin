"""The subscriber count the long-term planning multiplies its per-share amounts
by: one snapshot per physical variation, direct and virtual subscriptions
together."""

from __future__ import annotations

import datetime
from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from ..models import ShareTypeVariation, Subscription
from ..utils.share_type_variation_amounts import virtual_components_of


def subscriber_counts_by_variation(
    variation_ids: set[str],
    snapshot_date: datetime.date,
) -> dict[str, Decimal]:
    """Active-subscriber count (direct + virtual) per physical variation.

    Counts subscriptions active at ``snapshot_date``. For a variation with
    NO subscriptions active then, falls back to its next future cohort — the
    subscribers starting on the earliest ``valid_from`` after
    ``snapshot_date`` — so planning a season before it starts doesn't read 0
    (``active_at_date`` otherwise excludes future-dated subscriptions).

    Virtual variations are covered too: those can be subscribed to directly,
    and a physical variation's count adds its virtual components' counts.
    """
    active_subs = Subscription.current.active_at_date(snapshot_date)

    # ``order_by()`` clears the model's default ``-valid_from`` ordering:
    # without it Django folds valid_from into the GROUP BY, splitting a
    # variation into one row per valid_from and undercounting the sum.
    direct_by_variation: dict[str, Decimal] = {}
    for row in (
        active_subs.values("share_type_variation_id")
        .annotate(total=Sum("quantity"))
        .order_by()
    ):
        var_id = row["share_type_variation_id"]
        direct_by_variation[str(var_id)] = Decimal(row["total"])

    components = virtual_components_of(variation_ids)
    virtual_ids = {str(virtual_id) for virtual_id in components}

    # Forward fallback: for relevant variations with no subscribers active at
    # snapshot_date, use the next future cohort's count — the subscriptions
    # starting on the earliest valid_from after snapshot_date.
    relevant = set(variation_ids) | virtual_ids
    zero_vars = {v for v in relevant if direct_by_variation.get(v, Decimal(0)) == 0}
    if zero_vars:
        future_by_var: dict[str, list[tuple[datetime.date, int]]] = defaultdict(list)
        for var_id, valid_from, subscribed_quantity in Subscription.current.filter(
            share_type_variation_id__in=zero_vars,
            valid_from__gt=snapshot_date,
        ).values_list(
            "share_type_variation_id",
            "valid_from",
            "quantity",
        ):
            future_by_var[str(var_id)].append((valid_from, subscribed_quantity))
        for var_id, rows in future_by_var.items():
            earliest = min(valid_from for valid_from, _ in rows)
            direct_by_variation[var_id] = Decimal(
                sum(q for valid_from, q in rows if valid_from == earliest)
            )

    counts = {
        var_id: direct_by_variation.get(var_id, Decimal(0)) for var_id in variation_ids
    }
    for virtual_id, parts in components.items():
        for physical_id, quantity in parts:
            counts[str(physical_id)] += (
                direct_by_variation.get(str(virtual_id), Decimal(0)) * quantity
            )
    return counts


def subscriber_counts_for_planning(share_option: str) -> dict[str, str]:
    """Active-subscriber snapshot per physical variation of ``share_option``,
    keyed by variation id — the exact multiplier the forward
    ``needed_amount`` uses (``count × amount``, summed over the weeks a size
    runs in).

    Powers the reverse "total → per-share" planning suggestion: the frontend
    splits the target total across sizes by ``average_weight × count ×
    weeks`` (mirroring ``split_forecast_amount_by_weight``). Returned as
    ``{variation_id: str}``.

    The count is a single snapshot at **today's** date (direct + virtual
    subscriptions resolved onto the physical variation, with a next-cohort
    fallback when none are active yet) — constant across the planned weeks,
    as the long-term list treats it. Like that list, the snapshot date is
    today regardless of the planned year, so the suggestion reproduces the
    forward total.
    """
    variation_ids = {
        str(variation_id)
        for variation_id in ShareTypeVariation.objects.filter(
            variation_type=ShareTypeVariation.VariationType.PHYSICAL,
            share_type__share_option=share_option,
        ).values_list("id", flat=True)
    }
    counts = subscriber_counts_by_variation(variation_ids, timezone.localdate())
    return {var_id: str(count) for var_id, count in counts.items()}
