from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import date
from decimal import Decimal
from statistics import stdev
from typing import Any

from django.db.models import Count, QuerySet
from django.db.models.functions import TruncMonth, TruncWeek, TruncYear
from django.utils import timezone

from apps.shared.iso_week_filters import iso_week_bound, iso_week_window_for_dates
from apps.shared.money import round_money

from ..models import (
    DeliveryStationDay,
    Member,
    Share,
    ShareContent,
    ShareTypeVariation,
)
from ..models.choices import UnitOptions, VegetableSizeOptions
from ..utils.sort_order import share_type_ranks, size_order_annotation
from ..utils.weight import mean_weight, quantize_weight, taken_weights

# The ShareArticle factor that turns a piece or a bunch of each size into kg,
# named as the ``.values()`` key the averages' scan reads.
_KG_PER_FIELD = {
    (UnitOptions.PCS, VegetableSizeOptions.S): "share_article__kg_per_piece_S",
    (UnitOptions.PCS, VegetableSizeOptions.M): "share_article__kg_per_piece_M",
    (UnitOptions.PCS, VegetableSizeOptions.L): "share_article__kg_per_piece_L",
    (UnitOptions.BUNCH, VegetableSizeOptions.S): "share_article__kg_per_bunch_S",
    (UnitOptions.BUNCH, VegetableSizeOptions.M): "share_article__kg_per_bunch_M",
    (UnitOptions.BUNCH, VegetableSizeOptions.L): "share_article__kg_per_bunch_L",
}

# A station's place in the averages: (delivery day, variation, delivery station).
_StationKey = tuple[str, str, str]


def _kg_of(record: dict[str, Any]) -> Decimal:
    """A ShareContent row's amount in kg; 0 for a unit without a factor.
    ``amount`` and the ``kg_per_*`` columns are DecimalFields — coerced via
    ``Decimal(str(...))`` (never ``Decimal(float)``) and multiplied in Decimal."""
    amount = Decimal(str(record["amount"] or 0))
    if record["unit"] == UnitOptions.KG:
        return amount
    factor_field = _KG_PER_FIELD.get((record["unit"], record["size"]))
    if factor_field is None:
        return Decimal("0")
    return amount * Decimal(str(record[factor_field] or 0))


def _station_averages(records) -> dict[_StationKey, Decimal]:
    """Per station, the mean over the weeks it received the variation of that
    week's kilos, rounded to two decimals."""
    weekly: dict[_StationKey, dict[tuple[int, int], Decimal]] = defaultdict(
        lambda: defaultdict(Decimal)
    )
    for record in records:
        station = (
            record["share__delivery_day__id"],
            record["share__share_type_variation_id"],
            record["delivery_station__id"],
        )
        week = (record["share__year"], record["share__delivery_week"])
        weekly[station][week] += _kg_of(record)
    return {
        station: round_money(sum(weeks.values(), Decimal("0")) / len(weeks))
        for station, weeks in weekly.items()
    }


def _tour_numbers(stations) -> dict[tuple[str, str], int]:
    """The tour of each (delivery station, delivery day) of ``stations``, in one
    query."""
    station_days = {(station_id, day_id) for day_id, _, station_id in stations}
    rows = DeliveryStationDay.objects.filter(
        delivery_station_id__in=[station_id for station_id, _ in station_days],
        delivery_day_id__in=[day_id for _, day_id in station_days],
    ).values("delivery_station_id", "delivery_day_id", "tour_number")
    return {
        (row["delivery_station_id"], row["delivery_day_id"]): row["tour_number"]
        for row in rows
    }


def _compute_variation_averages(
    share_type_variation_ids, year, delivery_week, years_back=2
):
    """
    Calculate statistical averages of share content (in kg) for one or more
    variations in a single ShareContent scan. Every result key embeds its
    ``variation_{id}`` so multiple variations never collide.
    Returns averages at three levels:
    1. Station level: day_X_variation_Y_station_ABC (most granular)
    2. Tour level: day_X_variation_Y_tour_Z (aggregated from stations)
    3. Day level: day_X_variation_Y (aggregated from stations)

    Args:
        share_type_variation_ids: ShareTypeVariation IDs
        year: Current year
        delivery_week: Current week number
        years_back: Number of years to look back (default: 2)

    Returns:
        Dictionary with structure:
        {
            'day_abc_variation_xyz_station_123': 4.2,  # Station level average
            'day_abc_variation_xyz_tour_1': 8.3,  # Tour level average (sum of stations)
            'day_abc_variation_xyz': 12.5,  # Day level average (sum of stations)
        }
    """
    # The weeks before the current one, back to the start of ``years_back``
    # years ago.
    records = ShareContent.objects.filter(
        iso_week_bound((year, delivery_week), "lt", prefix="share__"),
        share__share_type_variation_id__in=share_type_variation_ids,
        share__year__gte=year - years_back,
    ).values(
        "amount",
        "unit",
        "size",
        *_KG_PER_FIELD.values(),
        "share__delivery_day__id",
        "share__delivery_week",
        "share__year",
        "share__share_type_variation_id",
        "delivery_station__id",
    )
    station_averages = _station_averages(records)
    tours = _tour_numbers(station_averages)

    # Quantities stay Decimal until the response; tours and days add up their
    # stations' rounded averages.
    averages: dict[str, Decimal] = {}
    tour_totals: dict[str, Decimal] = defaultdict(Decimal)
    day_totals: dict[str, Decimal] = defaultdict(Decimal)
    for (day_id, variation_id, station_id), average in station_averages.items():
        day_key = f"day_{day_id}_variation_{variation_id}"
        averages[f"{day_key}_station_{station_id}"] = average
        day_totals[day_key] += average
        if (station_id, day_id) in tours:
            tour_totals[f"{day_key}_tour_{tours[(station_id, day_id)]}"] += average
    averages.update({key: round_money(total) for key, total in tour_totals.items()})
    averages.update({key: round_money(total) for key, total in day_totals.items()})

    # Float only at the response boundary — the values were accumulated in
    # Decimal above; ``float`` here keeps the wire contract (JSON numbers)
    # without re-introducing intermediate drift.
    return {key: float(value) for key, value in averages.items()}


def calculate_historical_share_type_variation_averages(
    share_type_variation_ids, year, delivery_week, years_back=2
):
    """
    Calculate statistical averages for multiple variations at once.

    Args:
        share_type_variation_ids: List of ShareTypeVariation IDs
        year: Current year
        delivery_week: Current week number
        years_back: Number of years to look back (default: 2)

    Returns:
        Merged dictionary with all variation averages at all levels
    """
    # One ShareContent scan for every variation (no per-id point-lookup, no
    # per-variation scan). Unknown ids simply contribute no records.
    return _compute_variation_averages(
        list(share_type_variation_ids), year, delivery_week, years_back
    )


def calculate_member_dashboard_statistics() -> dict:
    """Snapshot ("today") of member + cooperative-share statistics.

    Cooperative-share figures are SUMS of ``amount_of_coop_shares`` (the number
    of shares), not row counts, each with its value: every share counted at the
    value it was subscribed at. "Live" excludes cancelled shares; the payback
    figure is the opposite — shares owed back to exited members.
    """
    from django.db.models import DecimalField, F, Sum
    from django.utils import timezone

    from ..models import CoopShare, Member

    members = Member.objects.all()
    total_members = members.count()
    trial_members = members.filter(is_trial=True).count()
    confirmed_members = members.filter(admin_confirmed=True).count()
    pending_members = members.filter(
        admin_confirmed=False, cancelled_at__isnull=True
    ).count()
    cancelled_members = members.filter(cancelled_at__isnull=False).count()

    # Average age of current (non-cancelled) members with a known birth date.
    today = timezone.localdate()
    birth_dates = members.filter(
        cancelled_at__isnull=True, birth_date__isnull=False
    ).values_list("birth_date", flat=True)
    ages = [(today - bd).days / 365.25 for bd in birth_dates]
    average_age = round(sum(ages) / len(ages), 1) if ages else 0.0

    worth = Sum(
        F("amount_of_coop_shares") * F("value_one_coop_share"),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )

    def _shares(qs) -> tuple[float, Decimal]:
        totals = qs.aggregate(shares=Sum("amount_of_coop_shares"), value=worth)
        return float(totals["shares"] or 0), round_money(totals["value"])

    def _payback_due() -> tuple[float, Decimal]:
        # Per member: a negative transfer row nets against the rows its shares
        # came from, and a member whose due rows sum to zero or below owes nothing.
        due_by_member = list(
            CoopShare.objects.filter(
                payback_due_date__isnull=False, paid_back_date__isnull=True
            )
            .values("member_id")
            .annotate(shares=Sum("amount_of_coop_shares"), value=worth)
        )
        shares = sum(max(row["shares"], 0) for row in due_by_member)
        value = sum(
            (max(row["value"], Decimal(0)) for row in due_by_member), Decimal(0)
        )
        return float(shares), round_money(value)

    live = CoopShare.objects.filter(cancelled_at__isnull=True)
    coop_share_figures = {
        "total_coop_shares": _shares(live),
        "confirmed_coop_shares": _shares(live.filter(admin_confirmed=True)),
        "pending_coop_shares": _shares(live.filter(admin_confirmed=False)),
        "paid_coop_shares": _shares(live.filter(paid_at__isnull=False)),
        "unpaid_coop_shares": _shares(live.filter(paid_at__isnull=True)),
        "payback_due_coop_shares": _payback_due(),
    }
    return {
        "total_members": total_members,
        "trial_members": trial_members,
        "confirmed_members": confirmed_members,
        "pending_members": pending_members,
        "cancelled_members": cancelled_members,
        "average_age": average_age,
        **{key: shares for key, (shares, _value) in coop_share_figures.items()},
        **{
            f"{key}_value": value
            for key, (_shares, value) in coop_share_figures.items()
        },
    }


def calculate_member_growth_statistics(
    *, period: str, year: int | None = None, start_date: date | None = None
) -> list[dict]:
    """Confirmed members per period: entries, exits and the member count at the
    end of each period.

    A member counts from their ``entry_date`` once admin-confirmed until their
    exit date (``cancelled_effective_at``). Trial members aren't members of the
    cooperative yet and are left out. An exit dated after today isn't counted
    yet, because the member still belongs to the cooperative.

    ``year`` (which wins over ``start_date``) or ``start_date`` limit the
    periods returned; ``total_members`` still starts from everyone who joined
    before the window and hadn't left before it.
    """
    # One entry per catalogued ``period`` value (MEMBER_GROWTH_PERIODS); the
    # query-param catalogue refuses anything else before it reaches here.
    trunc = {"month": TruncMonth, "week": TruncWeek, "year": TruncYear}[period]
    members = Member.objects.filter(
        admin_confirmed=True, is_trial=False, entry_date__isnull=False
    )
    exited = members.filter(
        cancelled_effective_at__isnull=False,
        cancelled_effective_at__lte=timezone.localdate(),
    )

    window_start: date | None = start_date
    window_end: date | None = None
    if year is not None:
        window_start, window_end = date(year, 1, 1), date(year, 12, 31)

    def count_per_period(queryset: QuerySet[Member], field: str) -> dict[date, int]:
        if window_start is not None:
            queryset = queryset.filter(**{f"{field}__gte": window_start})
        if window_end is not None:
            queryset = queryset.filter(**{f"{field}__lte": window_end})
        rows = (
            queryset.annotate(period=trunc(field))
            .values("period")
            .annotate(count=Count("id"))
            .order_by("period")
        )
        return {row["period"]: row["count"] for row in rows}

    entries_by_period = count_per_period(members, "entry_date")
    exits_by_period = count_per_period(exited, "cancelled_effective_at")

    total = 0
    if window_start is not None:
        total = (
            members.filter(entry_date__lt=window_start).count()
            - exited.filter(cancelled_effective_at__lt=window_start).count()
        )

    result: list[dict] = []
    for period_start in sorted(entries_by_period.keys() | exits_by_period.keys()):
        new_members = entries_by_period.get(period_start, 0)
        exited_members = exits_by_period.get(period_start, 0)
        total += new_members - exited_members
        result.append(
            {
                "period": period_start,
                "new_members": new_members,
                "exited_members": exited_members,
                "total_members": total,
            }
        )
    return result


def _box_shares(start_date: date, end_date: date) -> QuerySet[Share]:
    """The shares of the ISO weeks the dates touch, a mid-week start's whole
    week included, that are packed in boxes. Only a box is weighed: a virtual
    variation is made of physical ones, and a variation packed in bulk is never
    a box."""
    return Share.objects.filter(
        iso_week_window_for_dates(start_date, end_date),
        share_type_variation__variation_type=ShareTypeVariation.VariationType.PHYSICAL,
        share_type_variation__is_packed_bulk=False,
    )


def _ranked_variations(
    variation_ids: Iterable[str],
) -> tuple[Sequence[ShareTypeVariation], dict[str, int], dict[str, int]]:
    """The variations of ``variation_ids`` in order, by their share type's
    rank (``share_type_ranks``), ``sort_order``, size and id; with the share
    types' ranks and the variations' own."""
    variations = list(
        ShareTypeVariation.objects.filter(pk__in=set(variation_ids))
        .select_related("share_type")
        .annotate(size_order=size_order_annotation())
    )
    share_type_rank = share_type_ranks(
        (variation.share_type, variation.sort_order, variation.size_order)
        for variation in variations
    )
    variations.sort(
        key=lambda variation: (
            share_type_rank[variation.share_type_id],
            variation.sort_order,
            variation.size_order,
            variation.pk,
        )
    )
    variation_rank = {variation.pk: index for index, variation in enumerate(variations)}
    return variations, share_type_rank, variation_rank


def _target_of(variation: ShareTypeVariation) -> Decimal | None:
    """A variation's target weight; none where it is empty or zero."""
    return variation.average_weight or None


def calculate_share_weights_by_week(
    start_date: date, end_date: date
) -> list[dict[str, Any]]:
    """One row per ISO week in ``[start_date, end_date]`` and share type
    variation packed in boxes delivered that week: the variation's target
    weight, how many of its shares (one per delivery day) were weighed, and
    their average weight. Each row also places its variation: the share type's
    rank (``share_type_ranks``), and the variation's rank by share type,
    ``sort_order`` and size; the rows of a week follow that order.

    A share's weight and the week's average are both ``mean_weight``s, as in
    the share-weights CSV export. ``average_weight`` is ``None`` for a week in
    which no share of the variation was weighed. Weights stay Decimal and are
    quantized to 3dp.
    """
    if start_date > end_date:
        return []

    share_weights = (
        _box_shares(start_date, end_date)
        .values_list(
            "year",
            "delivery_week",
            "share_type_variation_id",
            "weight1",
            "weight2",
            "weight3",
            "weight4",
        )
        .order_by()
    )
    # Every delivered (week, variation) gets a row, weighed or not.
    averages: dict[tuple[int, int, str], list[Decimal]] = defaultdict(list)
    for year, week, variation_id, *weights in share_weights:
        share_weight = mean_weight(weights)
        shares_of_week = averages[(year, week, variation_id)]
        if share_weight is not None:
            shares_of_week.append(share_weight)

    variations, share_type_rank, variation_rank = _ranked_variations(
        variation_id for _, _, variation_id in averages
    )
    by_id = {variation.pk: variation for variation in variations}

    rows = []
    for (year, week, variation_id), share_averages in sorted(
        averages.items(),
        key=lambda item: (item[0][0], item[0][1], variation_rank[item[0][2]]),
    ):
        variation = by_id[variation_id]
        week_average = mean_weight(share_averages)
        target = _target_of(variation)
        rows.append(
            {
                "year": year,
                "week": week,
                "share_type_variation": variation_id,
                "share_type": variation.share_type_id,
                "share_type_name": variation.share_type.name or "",
                "share_type_rank": share_type_rank[variation.share_type_id],
                "size": variation.size,
                "variation_rank": variation_rank[variation_id],
                "target_weight": quantize_weight(target) if target else None,
                "weighed_shares": len(share_averages),
                "average_weight": (
                    quantize_weight(week_average) if week_average is not None else None
                ),
            }
        )
    return rows


def _size_summary(
    variations: list[ShareTypeVariation],
    boxes_by_variation: dict[str, list[Decimal]],
) -> dict[str, Any]:
    """The summary row of one share type size, ``variations`` its variations
    in order; see ``calculate_share_weights_summary``."""
    first = variations[0]
    boxes = [
        box for variation in variations for box in boxes_by_variation[variation.pk]
    ]
    differences = [
        box - target
        for variation in variations
        if (target := _target_of(variation)) is not None
        for box in boxes_by_variation[variation.pk]
    ]
    average = mean_weight(boxes)
    current_target = _target_of(max(variations, key=lambda each: each.valid_from))
    return {
        "share_type_variation": first.pk,
        "share_type_name": first.share_type.name or "",
        "size": first.size,
        "target_weight": (
            quantize_weight(current_target) if current_target is not None else None
        ),
        "weighed_boxes": len(boxes),
        "average_weight": quantize_weight(average) if average is not None else None,
        "standard_deviation": quantize_weight(stdev(boxes)) if len(boxes) > 1 else None,
        "total_difference_from_target": (
            quantize_weight(sum(differences, Decimal(0))) if differences else None
        ),
    }


def calculate_share_weights_summary(
    start_date: date, end_date: date
) -> list[dict[str, Any]]:
    """One row per share type size packed in boxes and delivered in
    ``[start_date, end_date]``, in the order of its first variation (as in
    ``calculate_share_weights_by_week``), whose id the row carries.

    A size is a share type's size, the share type told apart by name (by id
    where it has none), as the weight chart tells them apart: a variation
    succeeding another of the same size within the range adds to its row. Over
    the size's weighed boxes, each weight taken of a share one box
    (``taken_weights``): how many, their average, the (sample) standard
    deviation between them, and the sum of each box's difference from its own
    variation's target, negative where they weighed too little. The average is
    the boxes' own, not the chart's mean of the shares' means.
    ``target_weight`` is the target of the size's variation that starts
    latest. A size delivered but never weighed keeps a row with no figures;
    the deviation needs two boxes, the sum a target. Weights stay Decimal and
    are quantized to 3dp.
    """
    if start_date > end_date:
        return []

    share_weights = (
        _box_shares(start_date, end_date)
        .values_list(
            "share_type_variation_id", "weight1", "weight2", "weight3", "weight4"
        )
        .order_by()
    )
    # Every delivered variation gets its list, weighed or not.
    boxes_by_variation: dict[str, list[Decimal]] = defaultdict(list)
    for variation_id, *weights in share_weights:
        boxes_by_variation[variation_id].extend(taken_weights(weights))

    variations, _, _ = _ranked_variations(boxes_by_variation)
    variations_by_size: dict[tuple[str, str], list[ShareTypeVariation]] = {}
    for variation in variations:
        size = (variation.share_type.name or variation.share_type_id, variation.size)
        variations_by_size.setdefault(size, []).append(variation)
    return [
        _size_summary(size_variations, boxes_by_variation)
        for size_variations in variations_by_size.values()
    ]
