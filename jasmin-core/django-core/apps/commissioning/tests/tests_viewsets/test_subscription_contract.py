"""SubscriptionViewSet (office abos) — the subscription contract.

While the tenant has a subscription contract ("Abo-Vertrag") in force, the
office create must name the version the member accepted, and the member's
consent is recorded in the same transaction as the subscription.

The clock is frozen to 2026-07-20 (a Monday) so ``VALID_FROM`` (2026-09-07)
stays beyond the subscription lead time forever.
"""

from __future__ import annotations

import datetime
from unittest import mock

import pytest
import time_machine
from django.urls import reverse
from rest_framework import status

from apps.commissioning.models import (
    ConsentDocument,
    ConsentKind,
    ConsentRecord,
    Subscription,
)
from apps.commissioning.tests.factories import (
    DeliveryStationDayFactory,
    MemberFactory,
    SharesDeliveryDayFactory,
    ShareTypeFactory,
    ShareTypeVariationFactory,
)
from apps.commissioning.tests.factories.members import PaymentCycleFactory
from apps.commissioning.tests.factories.shares import (
    ShareTypeVariationGrossPriceFactory,
)

ABOS_URL = reverse("abos-list")
VALID_FROM = datetime.date(2026, 9, 7)  # Monday
VALID_UNTIL = datetime.date(2026, 10, 4)  # Sunday


@pytest.fixture(autouse=True)
def _frozen_today():
    with time_machine.travel(datetime.datetime(2026, 7, 20, 12, 0), tick=False):
        yield


def _payload(member, **overrides):
    variation = ShareTypeVariationFactory(
        share_type=ShareTypeFactory(share_option="HARVEST_SHARE")
    )
    ShareTypeVariationGrossPriceFactory(share_type_variation=variation)
    data = {
        "member": str(member.id),
        "share_type_variation": str(variation.id),
        "valid_from": VALID_FROM.isoformat(),
        "valid_until": VALID_UNTIL.isoformat(),
        "quantity": 1,
        "price_per_delivery": "10.00",
        "payment_cycle": str(PaymentCycleFactory().id),
        "default_delivery_station_day": str(
            DeliveryStationDayFactory(
                delivery_day=SharesDeliveryDayFactory(day_number=2)
            ).id
        ),
        "is_trial": False,
    }
    data.update(overrides)
    return data


def _contract() -> ConsentDocument:
    return ConsentDocument.objects.create(
        kind=ConsentKind.SUBSCRIPTION_CONTRACT,
        locale="de",
        version="v1",
        valid_from=datetime.date(2026, 7, 6),
        body="Abo-Vertrag — Bedingungen …",
    )


@pytest.mark.django_db
class TestOfficeSubscriptionContract:
    def test_no_contract_in_force_needs_no_acceptance(self, api_client, tenant):
        member = MemberFactory()

        resp = api_client.post(ABOS_URL, _payload(member), format="json")

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert not ConsentRecord.objects.filter(member=member).exists()

    def test_contract_in_force_must_be_accepted(self, api_client, tenant):
        member = MemberFactory()
        _contract()

        resp = api_client.post(ABOS_URL, _payload(member), format="json")

        assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.data
        assert resp.data["code"] == "subscription.contract_agreement_required"
        assert not Subscription.objects.filter(member=member).exists()

    def test_accepted_contract_is_recorded_for_the_member(self, api_client, tenant):
        member = MemberFactory()
        contract = _contract()

        resp = api_client.post(
            ABOS_URL,
            _payload(member, subscription_contract_document=str(contract.pk)),
            format="json",
        )

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert "subscription_contract_document" not in resp.data
        assert ConsentRecord.objects.filter(
            member=member, document=contract, revoked_at__isnull=True
        ).exists()

    def test_another_kind_of_document_does_not_count(self, api_client, tenant):
        member = MemberFactory()
        _contract()
        privacy = ConsentDocument.objects.create(
            kind=ConsentKind.PRIVACY,
            locale="de",
            version="v1",
            valid_from=datetime.date(2026, 7, 6),
            body="Datenschutz",
        )

        resp = api_client.post(
            ABOS_URL,
            _payload(member, subscription_contract_document=str(privacy.pk)),
            format="json",
        )

        assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.data
        assert resp.data["code"] == "subscription.contract_agreement_required"

    def test_a_failed_consent_write_leaves_no_subscription(self, api_client, tenant):
        """The consent and the subscription are one unit: when recording the
        consent fails, the subscription is rolled back with it."""
        from apps.commissioning.services import ConsentService

        member = MemberFactory()
        contract = _contract()

        with mock.patch.object(
            ConsentService, "record", side_effect=RuntimeError("disk full")
        ):
            resp = api_client.post(
                ABOS_URL,
                _payload(member, subscription_contract_document=str(contract.pk)),
                format="json",
            )

        assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert not Subscription.objects.filter(member=member).exists()
