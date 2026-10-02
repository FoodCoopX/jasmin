"""What a waiting-list offer tells the member: the offer email and the public
accept page name the pick-up station the same way, and the email is written in
the member's language."""

from __future__ import annotations

import datetime
import uuid
from unittest import mock

import pytest
from django.utils import timezone

from apps.commissioning.services.waiting_list_offer_service import (
    WaitingListOfferService,
)
from apps.commissioning.tests.factories import (
    ContactEntityFactory,
    DeliveryStationDayFactory,
    DeliveryStationFactory,
    JasminUserFactory,
    MemberFactory,
    SubscriptionFactory,
)
from apps.commissioning.views.waiting_list_offer_views import _offer_payload


def _offer(station, **member_kwargs):
    member = MemberFactory(email="anna@example.com", **member_kwargs)
    return SubscriptionFactory(
        member=member,
        default_delivery_station_day=DeliveryStationDayFactory(
            delivery_station=station
        ),
        notification_token=uuid.uuid4(),
        notification_expires_at=timezone.now() + datetime.timedelta(days=7),
    )


def _scheduled(subscription) -> dict:
    with mock.patch("apps.shared.deferred_email.schedule_deferred_email") as schedule:
        WaitingListOfferService._send_offer_email(subscription)
    return schedule.call_args.kwargs


@pytest.mark.django_db
class TestOfferStationName:
    def test_named_by_its_contact(self, tenant):
        station = DeliveryStationFactory(
            contact=ContactEntityFactory(company_name="Hofladen Müller"),
            short_name="HM",
        )
        subscription = _offer(station)

        email = _scheduled(subscription)

        assert email["context"]["delivery_station_name"] == "Hofladen Müller"
        assert _offer_payload(subscription)["delivery_station_name"] == (
            "Hofladen Müller"
        )

    def test_without_a_contact_named_by_its_short_name(self, tenant):
        subscription = _offer(DeliveryStationFactory(contact=None, short_name="HM"))

        email = _scheduled(subscription)

        assert email["context"]["delivery_station_name"] == "HM"
        assert _offer_payload(subscription)["delivery_station_name"] == "HM"


@pytest.mark.django_db
class TestOfferEmailLanguage:
    def test_in_the_member_s_language(self, tenant):
        subscription = _offer(
            DeliveryStationFactory(), user=JasminUserFactory(user_language="en")
        )

        assert _scheduled(subscription)["language"] == "en"

    def test_without_a_login_in_the_tenant_s_language(self, tenant):
        subscription = _offer(DeliveryStationFactory(), user=None)

        assert _scheduled(subscription)["language"] is None
