"""The tours page edits a delivery day's tour plan from next week on.

This week's lists are printed and packed already and past weeks keep the tours
they ran on, so a changed placement hands the station-day over to a successor
from next week, and the deliveries, reservations and imported demand of the
later weeks move onto it. A station takes a stop only where it has a
station-day; the tours page never creates one.
"""

from __future__ import annotations

import datetime

import pytest
import time_machine
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from apps.commissioning.models import (
    CapacityReservation,
    DeliveryStationDay,
    ExternalShareDemand,
    ShareImportBatch,
)
from apps.commissioning.tests.factories import (
    DeliveryStationDayFactory,
    DeliveryStationFactory,
    ShareDeliveryFactory,
    ShareFactory,
    SharesDeliveryDayFactory,
    ShareTypeVariationFactory,
    SubscriptionFactory,
)
from apps.commissioning.tests.factories.days import store_legacy_tour_number_zero

THIS_MONDAY = datetime.date(2026, 11, 2)
NEXT_MONDAY = datetime.date(2026, 11, 9)
THIS_SUNDAY = datetime.date(2026, 11, 8)


@pytest.fixture(autouse=True)
def _frozen_clock():
    # Wednesday of ISO week 45 of 2026.
    with time_machine.travel(datetime.datetime(2026, 11, 4, 12, 0), tick=False):
        yield


@pytest.fixture
def day(tenant):
    return SharesDeliveryDayFactory(day_number=3)


def _save(api_client, day, *tours):
    """Post the plan: one ``(tour_number, [station, ...])`` per tour, the
    stations in stop order."""
    return api_client.post(
        reverse("delivery_tours-update-tours"),
        {
            "delivery_day": str(day.id),
            "tours": [
                {
                    "tour_number": tour_number,
                    "positions": [
                        {"position": stop, "delivery_station_id": str(station.id)}
                        for stop, station in enumerate(stations, start=1)
                    ],
                }
                for tour_number, stations in tours
            ],
        },
        format="json",
    )


def _rows(station, day):
    return list(
        DeliveryStationDay.objects.filter(
            delivery_station=station, delivery_day=day
        ).order_by("valid_from")
    )


def _placements(station, day):
    return [
        (row.valid_from, row.valid_until, row.tour_number, row.stop_order)
        for row in _rows(station, day)
    ]


@pytest.mark.django_db
class TestUpdateTours:
    def test_a_moved_station_keeps_its_stop_until_this_week(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day,
            tour_number=1,
            stop_order=1,
            capacity=17,
            pickup_time_begin=datetime.time(15, 0),
        )
        station = station_day.delivery_station
        other = DeliveryStationDayFactory(delivery_day=day, tour_number=2, stop_order=1)

        resp = _save(api_client, day, (2, [other.delivery_station, station]))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _placements(station, day) == [
            (datetime.date(2026, 1, 5), THIS_SUNDAY, 1, 1),
            (NEXT_MONDAY, None, 2, 2),
        ]
        successor = _rows(station, day)[1]
        assert successor.capacity == 17
        assert successor.pickup_time_begin == datetime.time(15, 0)

    def test_the_successor_keeps_a_scheduled_end(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day,
            tour_number=1,
            stop_order=1,
            valid_until=datetime.date(2026, 12, 27),
        )
        station = station_day.delivery_station

        resp = _save(api_client, day, (3, [station]))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _placements(station, day) == [
            (datetime.date(2026, 1, 5), THIS_SUNDAY, 1, 1),
            (NEXT_MONDAY, datetime.date(2026, 12, 27), 3, 1),
        ]

    def test_a_later_row_of_the_station_takes_the_stop_too(self, api_client, day):
        station = DeliveryStationFactory()
        DeliveryStationDayFactory(
            delivery_station=station, delivery_day=day, tour_number=1, stop_order=1
        )
        # Created in the station's dialog: it closes the first row on 27 Dec.
        DeliveryStationDayFactory(
            delivery_station=station,
            delivery_day=day,
            valid_from=datetime.date(2026, 12, 28),
            tour_number=1,
            stop_order=None,
        )

        resp = _save(api_client, day, (2, [station]))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _placements(station, day) == [
            (datetime.date(2026, 1, 5), THIS_SUNDAY, 1, 1),
            (NEXT_MONDAY, datetime.date(2026, 12, 27), 2, 1),
            (datetime.date(2026, 12, 28), None, 2, 1),
        ]

    def test_a_row_starting_next_week_or_later_moves_in_place(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day, valid_from=NEXT_MONDAY, tour_number=1, stop_order=None
        )
        station = station_day.delivery_station

        resp = _save(api_client, day, (2, [station]))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _placements(station, day) == [(NEXT_MONDAY, None, 2, 1)]

    def test_an_unchanged_station_keeps_its_row(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day, tour_number=1, stop_order=1
        )
        station = station_day.delivery_station

        resp = _save(api_client, day, (1, [station]))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _placements(station, day) == [(datetime.date(2026, 1, 5), None, 1, 1)]

    def test_a_station_left_off_the_plan_is_on_no_tour_from_next_week(
        self, api_client, day
    ):
        kept = DeliveryStationDayFactory(delivery_day=day, tour_number=1, stop_order=1)
        dropped = DeliveryStationDayFactory(
            delivery_day=day, tour_number=1, stop_order=2
        )

        resp = _save(api_client, day, (1, [kept.delivery_station]))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _placements(dropped.delivery_station, day) == [
            (datetime.date(2026, 1, 5), THIS_SUNDAY, 1, 2),
            (NEXT_MONDAY, None, 1, None),
        ]

    def test_a_row_still_on_tour_zero_moves_in_place(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day, tour_number=1, stop_order=1
        )
        store_legacy_tour_number_zero(station_day)
        station = station_day.delivery_station

        resp = _save(api_client, day, (2, [station]))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _placements(station, day) == [(datetime.date(2026, 1, 5), None, 2, 1)]

    def test_refuses_a_station_without_a_station_day(self, api_client, day):
        station = DeliveryStationFactory()

        resp = _save(api_client, day, (1, [station]))

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "delivery_station_day.missing_for_tour"
        assert _rows(station, day) == []

    def test_refuses_a_station_whose_station_day_has_ended(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day,
            tour_number=1,
            stop_order=1,
            valid_until=datetime.date(2026, 10, 25),
        )
        station = station_day.delivery_station

        resp = _save(api_client, day, (2, [station]))

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "delivery_station_day.missing_for_tour"
        assert _placements(station, day) == [
            (datetime.date(2026, 1, 5), datetime.date(2026, 10, 25), 1, 1)
        ]

    def test_later_weeks_follow_the_station_onto_its_new_stop(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day, tour_number=1, stop_order=1
        )
        station = station_day.delivery_station
        variation = ShareTypeVariationFactory()
        subscription = SubscriptionFactory(
            share_type_variation=variation,
            valid_from=datetime.date(2026, 1, 5),
            default_delivery_station_day=station_day,
        )
        deliveries = {
            week: ShareDeliveryFactory(
                share=ShareFactory(
                    year=2026,
                    delivery_week=week,
                    delivery_day=day,
                    share_type_variation=variation,
                ),
                delivery_station_day=station_day,
                subscription=subscription,
            )
            for week in (45, 46)
        }
        reservation = CapacityReservation.objects.create(
            delivery_station_day=station_day,
            subscription=subscription,
            year=2026,
            week=46,
            expires_at=timezone.now() + datetime.timedelta(days=14),
        )
        batch = ShareImportBatch.objects.create(
            year=2026,
            delivery_week=45,
            file_checksum="0" * 64,
            original_filename="tapir.csv",
            status=ShareImportBatch.STATUS_APPLIED,
        )
        demand = {
            week: ExternalShareDemand.objects.create(
                batch=batch,
                year=2026,
                delivery_week=week,
                delivery_station_day=station_day,
                share_type_variation=variation,
                quantity=5,
            )
            for week in (45, 46)
        }

        resp = _save(api_client, day, (2, [station]))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        successor = _rows(station, day)[1]
        for row in [*deliveries.values(), reservation, *demand.values()]:
            row.refresh_from_db()
        assert deliveries[45].delivery_station_day_id == station_day.id
        assert deliveries[46].delivery_station_day_id == successor.id
        assert reservation.delivery_station_day_id == successor.id
        assert demand[45].delivery_station_day_id == station_day.id
        assert demand[46].delivery_station_day_id == successor.id


@pytest.mark.django_db
class TestTourList:
    URL = reverse("delivery_tours-list")

    def test_lists_the_plan_from_next_week(self, api_client, day):
        ended = DeliveryStationDayFactory(
            delivery_day=day,
            tour_number=1,
            stop_order=1,
            valid_until=datetime.date(2026, 10, 25),
        )
        running = DeliveryStationDayFactory(
            delivery_day=day, tour_number=1, stop_order=2
        )
        starting = DeliveryStationDayFactory(
            delivery_day=day,
            valid_from=datetime.date(2026, 12, 28),
            tour_number=2,
            stop_order=1,
        )
        DeliveryStationDayFactory(delivery_day=day, stop_order=None)

        resp = api_client.get(self.URL, {"delivery_day": str(day.id)})

        assert resp.status_code == status.HTTP_200_OK
        placed = {
            position["delivery_station_id"]: (tour["tour_number"], position["position"])
            for tour in resp.data
            for position in tour["positions"]
        }
        assert placed == {
            str(running.delivery_station_id): (1, 2),
            str(starting.delivery_station_id): (2, 1),
        }
        assert str(ended.delivery_station_id) not in placed

    def test_lists_a_saved_move_though_this_week_keeps_the_old_stop(
        self, api_client, day
    ):
        station_day = DeliveryStationDayFactory(
            delivery_day=day, tour_number=1, stop_order=1
        )
        _save(api_client, day, (3, [station_day.delivery_station]))

        resp = api_client.get(self.URL, {"delivery_day": str(day.id)})

        assert [tour["tour_number"] for tour in resp.data] == [3]


@pytest.mark.django_db
class TestStationPalette:
    URL = reverse("delivery_station-list")

    def test_offers_the_stations_served_on_the_day_from_next_week(
        self, api_client, day
    ):
        running = DeliveryStationDayFactory(delivery_day=day)
        starting = DeliveryStationDayFactory(
            delivery_day=day, valid_from=datetime.date(2026, 12, 28)
        )
        ending_this_week = DeliveryStationDayFactory(
            delivery_day=day, valid_until=THIS_SUNDAY
        )
        elsewhere = DeliveryStationDayFactory(
            delivery_day=SharesDeliveryDayFactory(day_number=4)
        )

        resp = api_client.get(
            self.URL,
            {
                "delivery_day": str(day.id),
                "active_at_date_or_future": NEXT_MONDAY.isoformat(),
            },
        )

        assert resp.status_code == status.HTTP_200_OK
        listed = {row["id"] for row in resp.data}
        assert listed == {
            str(running.delivery_station_id),
            str(starting.delivery_station_id),
        }
        assert str(ending_this_week.delivery_station_id) not in listed
        assert str(elsewhere.delivery_station_id) not in listed

    def test_without_a_day_offers_the_stations_served_on_any_day(self, api_client, day):
        running = DeliveryStationDayFactory(delivery_day=day)
        ended = DeliveryStationDayFactory(delivery_day=day, valid_until=THIS_SUNDAY)

        resp = api_client.get(
            self.URL, {"active_at_date_or_future": NEXT_MONDAY.isoformat()}
        )

        assert resp.status_code == status.HTTP_200_OK
        listed = {row["id"] for row in resp.data}
        assert str(running.delivery_station_id) in listed
        assert str(ended.delivery_station_id) not in listed


@pytest.mark.django_db
class TestStationDialogSuccessor:
    """A station-day created in the station's dialog for a station and day that
    already have one keeps the station's tour stop."""

    URL = reverse("delivery_station_day-list")

    def _create(self, api_client, station_day, **extra):
        return api_client.post(
            self.URL,
            {
                "delivery_station": str(station_day.delivery_station_id),
                "delivery_day": str(station_day.delivery_day_id),
                "valid_from": datetime.date(2026, 12, 28).isoformat(),
                "capacity": 30,
                **extra,
            },
            format="json",
        )

    def test_keeps_the_stop_of_the_row_it_succeeds(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day, tour_number=2, stop_order=4
        )

        resp = self._create(api_client, station_day)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert _placements(station_day.delivery_station, day) == [
            (datetime.date(2026, 1, 5), datetime.date(2026, 12, 27), 2, 4),
            (datetime.date(2026, 12, 28), None, 2, 4),
        ]

    def test_a_station_back_after_a_gap_starts_off_the_tour(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day,
            tour_number=2,
            stop_order=4,
            valid_until=datetime.date(2026, 11, 29),
        )

        resp = self._create(api_client, station_day)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert _rows(station_day.delivery_station, day)[1].stop_order is None

    def test_a_row_still_on_tour_zero_passes_no_stop_on(self, api_client, day):
        # Ending the day before, it needs no closing, which the table's check
        # would refuse for a row still on tour 0.
        station_day = DeliveryStationDayFactory(
            delivery_day=day,
            tour_number=1,
            stop_order=4,
            valid_until=datetime.date(2026, 12, 27),
        )
        store_legacy_tour_number_zero(station_day)

        resp = self._create(api_client, station_day)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        successor = _rows(station_day.delivery_station, day)[1]
        assert (successor.tour_number, successor.stop_order) == (1, None)

    def test_a_stop_in_the_request_wins(self, api_client, day):
        station_day = DeliveryStationDayFactory(
            delivery_day=day, tour_number=2, stop_order=4
        )

        resp = self._create(api_client, station_day, tour_number=1, stop_order=None)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert _rows(station_day.delivery_station, day)[1].stop_order is None
        assert _rows(station_day.delivery_station, day)[1].tour_number == 1
