"""A (station, delivery day) pair handing over from one station-day to the next.

Deliveries, capacity reservations and imported demand point at a station-day
row, and occupancy, tours and the lists read them through that row. Each week's
rows therefore have to sit on the row active that week: one left on a closed
predecessor counts under an id the week no longer reads, so the successor shows
its slot free and its tour without them.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import date, timedelta
from typing import Any, TypeVar

from django.db.models import Q
from django.utils import timezone
from isoweek import Week

from apps.shared.iso_week_filters import iso_week_bound

from ..models import (
    CapacityReservation,
    DeliveryStationDay,
    ExternalShareDemand,
    ShareDelivery,
)
from .recompute import recompute_shares

_StationDayRow = TypeVar(
    "_StationDayRow", ShareDelivery, CapacityReservation, ExternalShareDemand
)


def _station_day_of_week(
    station_day: DeliveryStationDay, valid_from: date
) -> Callable[[date], DeliveryStationDay | None]:
    """The pair's row active in the week of a Monday, among the rows that run
    from ``valid_from`` on — the new row and any that start after it."""
    successors = list(
        DeliveryStationDay.objects.filter(
            delivery_station_id=station_day.delivery_station_id,
            delivery_day_id=station_day.delivery_day_id,
        ).filter(Q(valid_until__isnull=True) | Q(valid_until__gte=valid_from))
    )

    def resolve(monday: date) -> DeliveryStationDay | None:
        for delivery_station_day in successors:
            if delivery_station_day.is_active_at(monday):
                return delivery_station_day
        return None

    return resolve


def _repoint(
    model: type[_StationDayRow],
    rows: Iterable[_StationDayRow],
    monday_of: Callable[[Any], date],
    first_monday: date,
    resolve: Callable[[date], DeliveryStationDay | None],
) -> list[_StationDayRow]:
    """Move the ``rows`` of the weeks from ``first_monday`` on onto the row
    ``resolve`` gives their week; returns the moved ones."""
    moved = []
    for row in rows:
        monday = monday_of(row)
        if monday < first_monday:
            continue
        resolved = resolve(monday)
        if resolved is not None and resolved.id != row.delivery_station_day_id:
            row.delivery_station_day = resolved
            moved.append(row)
    if moved:
        model.objects.bulk_update(moved, fields=["delivery_station_day"])
    return moved


def repoint_succession_children(
    station_day: DeliveryStationDay, valid_from: date
) -> set[str]:
    """Move the rows of the weeks from ``valid_from`` on from the predecessor
    that closed the day before onto the row of the pair active in their week.

    Deliveries and imported demand move only for weeks after today; a
    reservation holds a slot and moves for every week from ``valid_from``.
    Returns the Shares whose deliveries moved, for the caller to recompute.
    """
    predecessor = (
        DeliveryStationDay.objects.filter(
            delivery_station_id=station_day.delivery_station_id,
            delivery_day_id=station_day.delivery_day_id,
            valid_until=valid_from - timedelta(days=1),
        )
        .exclude(pk=station_day.pk)
        .order_by("-valid_until")
        .first()
    )
    if predecessor is None:
        return set()

    resolve = _station_day_of_week(station_day, valid_from)
    future_from = max(valid_from, timezone.localdate() + timedelta(days=1))

    moved_deliveries = _repoint(
        ShareDelivery,
        ShareDelivery.objects.filter(delivery_station_day=predecessor).select_related(
            "share"
        ),
        lambda delivery: Week(
            delivery.share.year, delivery.share.delivery_week
        ).monday(),
        future_from,
        resolve,
    )
    _repoint(
        CapacityReservation,
        CapacityReservation.objects.filter(delivery_station_day=predecessor),
        lambda reservation: Week(reservation.year, reservation.week).monday(),
        valid_from,
        resolve,
    )
    first_week = Week.withdate(valid_from)
    _repoint(
        ExternalShareDemand,
        ExternalShareDemand.objects.filter(
            iso_week_bound((first_week.year, first_week.week), "gte"),
            delivery_station_day=predecessor,
        ),
        lambda demand: Week(demand.year, demand.delivery_week).monday(),
        future_from,
        resolve,
    )
    return {delivery.share_id for delivery in moved_deliveries}


def migrate_succession_children(
    station_day: DeliveryStationDay, valid_from: date
) -> None:
    """``repoint_succession_children``, then recompute the Shares it moved
    deliveries of."""
    affected_share_ids = repoint_succession_children(station_day, valid_from)
    if affected_share_ids:
        recompute_shares(affected_share_ids)


def inherited_tour_placement(
    delivery_station_id: str, delivery_day_id: str, valid_from: date
) -> dict[str, int | None]:
    """The tour and stop of the row a new station-day starting on
    ``valid_from`` succeeds — the pair's row running the day before — so the
    station keeps its place on the tour. Empty when none runs then: after a
    gap the old stop may have gone to another station. Empty too for a row
    still on the tour 0 rows written before tours started at 1 may hold."""
    previous = (
        DeliveryStationDay.current.active_at_date(valid_from - timedelta(days=1))
        .filter(
            delivery_station_id=delivery_station_id, delivery_day_id=delivery_day_id
        )
        .values("tour_number", "stop_order")
        .first()
    )
    if previous is None or previous["tour_number"] < 1:
        return {}
    return {
        "tour_number": previous["tour_number"],
        "stop_order": previous["stop_order"],
    }
