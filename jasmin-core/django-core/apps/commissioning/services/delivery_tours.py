"""The tour plan of a delivery day: which tour stops at which station, and in
which order.

The plan is edited from next week on. This week's lists are printed or packed
already and past weeks keep the tours they ran on, so a placement that changes
hands its station-day over to a successor from next week, as a change in the
station's dialog does. Rows starting next week or later change in place.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import date, timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from ..errors import TourStationWithoutStationDay
from ..models import DeliveryStation, DeliveryStationDay, SharesDeliveryDay
from ..utils.iso_week_utils import previous_monday, saturday_of_iso_week
from .recompute import recompute_shares
from .station_day_succession import repoint_succession_children


def tour_plan_start() -> date:
    """The Monday from which a tour edit applies: next week's."""
    return previous_monday(timezone.localdate()) + timedelta(weeks=1)


def tour_numbers_by_week(
    keys: Iterable[tuple[str, str, int, int]],
) -> dict[tuple[str, str, int, int], int | None]:
    """The tour of each ``(delivery_station_id, delivery_day_id, year, week)``:
    that of the station's station-day on the day active on the week's
    Saturday, the one the planning saves by; None without one. A station's
    tour changes from a week on, so each week reads its own. One query."""
    keys = set(keys)
    station_days_by_pair: dict[tuple[str, str], list[DeliveryStationDay]] = defaultdict(
        list
    )
    if keys:
        for station_day in DeliveryStationDay.objects.filter(
            delivery_station_id__in={key[0] for key in keys},
            delivery_day_id__in={key[1] for key in keys},
        ):
            station_days_by_pair[
                (station_day.delivery_station_id, station_day.delivery_day_id)
            ].append(station_day)
    tour_numbers: dict[tuple[str, str, int, int], int | None] = {}
    for station_id, day_id, year, week in keys:
        saturday = saturday_of_iso_week(year, week)
        tour_numbers[(station_id, day_id, year, week)] = next(
            (
                station_day.tour_number
                for station_day in station_days_by_pair[(station_id, day_id)]
                if station_day.is_active_at(saturday)
            ),
            None,
        )
    return tour_numbers


def _station_days_from(
    delivery_day_id: str, start: date
) -> dict[str, list[DeliveryStationDay]]:
    """Each station's rows on the delivery day that run in the week of
    ``start`` or later, earliest first."""
    by_station: dict[str, list[DeliveryStationDay]] = {}
    for station_day in (
        DeliveryStationDay.current.active_at_date_or_future(start)
        .filter(delivery_day_id=delivery_day_id)
        .select_related("delivery_station__contact")
        .order_by("valid_from")
    ):
        by_station.setdefault(station_day.delivery_station_id, []).append(station_day)
    return by_station


def _station_name(station: DeliveryStation) -> str:
    contact_name = station.contact.name if station.contact else None
    return contact_name or f"Station {station.id}"


def tour_plan(delivery_day_id: str) -> list[dict[str, Any]]:
    """The tours from next week on, each with its stops in order. A station's
    placement is that of its first row from then."""
    tours: dict[int, dict[str, Any]] = {}
    station_days = [
        rows[0]
        for rows in _station_days_from(delivery_day_id, tour_plan_start()).values()
        if rows[0].stop_order is not None
    ]
    for station_day in sorted(
        station_days, key=lambda row: (row.tour_number, row.stop_order)
    ):
        tour = tours.setdefault(
            station_day.tour_number,
            {"tour_number": station_day.tour_number, "positions": []},
        )
        tour["positions"].append(
            {
                "position": station_day.stop_order,
                "delivery_station_id": str(station_day.delivery_station_id),
                "delivery_station_name": _station_name(station_day.delivery_station),
                "delivery_station_day_id": str(station_day.id),
            }
        )
    return list(tours.values())


def _hand_over(
    station_day: DeliveryStationDay, start: date, placement: dict[str, Any]
) -> DeliveryStationDay:
    """Close ``station_day`` the day before ``start`` and continue it from
    ``start`` on its new tour stop, to the end it had."""
    copied = {
        field.attname: getattr(station_day, field.attname)
        for field in DeliveryStationDay._meta.fields
        if field.name != "id"
    }
    successor = DeliveryStationDay(**{**copied, **placement, "valid_from": start})
    station_day.valid_until = start - timedelta(days=1)
    station_day.save(update_fields=["valid_until"])
    successor.full_clean()
    # Inserted without save(): its succession step looks for the pair's OPEN
    # row, which may be a later one, and would refuse a start before it.
    DeliveryStationDay.objects.bulk_create([successor])
    return successor


@transaction.atomic
def update_tours(delivery_day: SharesDeliveryDay, tours: list[dict[str, Any]]) -> None:
    """Place the stations as ``tours`` lists them from next week on; a
    station the plan leaves out is on no tour from then.

    Refuses a station without a station-day on the day from next week:
    station-days are created in the station's dialog, never by a tour edit.
    """
    start = tour_plan_start()
    placements: dict[str, dict[str, Any]] = {
        position["delivery_station_id"]: {
            "tour_number": tour["tour_number"],
            "stop_order": position["position"],
        }
        for tour in tours
        for position in tour["positions"]
    }
    # Every save rewrites the day's whole plan, so two at once wait in turn.
    # In id order, as every other locker of station-days takes them, so none
    # of them can deadlock with it.
    list(
        DeliveryStationDay.objects.filter(delivery_day=delivery_day)
        .order_by("pk")
        .select_for_update()
        .values_list("pk", flat=True)
    )
    by_station = _station_days_from(delivery_day.id, start)

    unserved = sorted(placements.keys() - by_station.keys())
    if unserved:
        raise TourStationWithoutStationDay(
            delivery_station=_station_name(
                DeliveryStation.objects.select_related("contact").get(pk=unserved[0])
            ),
            delivery_day=str(delivery_day),
            valid_from=start,
        )

    affected_share_ids: set[str] = set()
    for station_id, rows in by_station.items():
        placement = placements.get(station_id, {"tour_number": 1, "stop_order": None})
        for row in rows:
            # Without a stop a row is on no tour, whatever its tour number.
            if row.stop_order == placement["stop_order"] and (
                row.stop_order is None or row.tour_number == placement["tour_number"]
            ):
                continue
            # A row on the tour 0 written before tours started at 1 is on no
            # tour the page shows in any week, and the table's check refuses
            # closing it as it is, so it moves in place.
            if row.valid_from < start and row.tour_number >= 1:
                successor = _hand_over(row, start, placement)
                affected_share_ids |= repoint_succession_children(successor, start)
            else:
                for field, value in placement.items():
                    setattr(row, field, value)
                row.save(update_fields=list(placement))
    if affected_share_ids:
        recompute_shares(affected_share_ids)
