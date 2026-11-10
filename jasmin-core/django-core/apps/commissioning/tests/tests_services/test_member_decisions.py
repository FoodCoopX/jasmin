"""Rejecting a member or subscription, and the lock order of a member exit.

A reject decides once: a second one, from a stale session or a scripted call,
keeps the first decision, its date, author and reason, and sends no second
mail. A subscription reject writes its stamps without validating the term
again, so a pending subscription whose station day has closed since can still
be rejected on its own, as the member reject already could.

A reject locks the open subscriptions and then the member, and a subscription
confirm locks its subscription and then writes the member. A member exit, from
the office's cancel, a self-exit or a GDPR erasure, takes the member's
subscriptions before the member's row too, so none of them deadlocks with a
reject or a confirm of the same member.
"""

from __future__ import annotations

import datetime
from unittest import mock

import pytest
import time_machine
from auditlog.models import LogEntry
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.commissioning.models import DeliveryStationDay, Member, Subscription
from apps.commissioning.services.member_cancellation import (
    cancel_member_with_coop_shares,
)
from apps.commissioning.services.member_service import MemberService
from apps.commissioning.services.subscription_rejection import reject_subscription
from apps.commissioning.tests.factories import (
    JasminUserFactory,
    MemberFactory,
    SubscriptionFactory,
)
from apps.gdpr.services import GDPRService
from apps.gdpr.services.subjects import ErasureSubject


@pytest.fixture(autouse=True)
def _frozen_clock():
    with time_machine.travel(datetime.datetime(2026, 7, 20, 12, 0), tick=False):
        yield


def _pending_member(**fields) -> Member:
    return MemberFactory(
        admin_confirmed=False, member_number=None, entry_date=None, **fields
    )


def _first_lock(queries, table: str) -> int:
    locks = [query["sql"] for query in queries if "FOR UPDATE" in query["sql"]]
    return next(i for i, sql in enumerate(locks) if f'FROM "{table}"' in sql)


@pytest.mark.django_db
class TestARejectDecidesOnce:
    def test_a_second_subscription_reject_keeps_the_first(self, tenant):
        first_office, second_office = JasminUserFactory(), JasminUserFactory()
        subscription = SubscriptionFactory(admin_confirmed=False)
        stale = Subscription.objects.get(pk=subscription.pk)
        reject_subscription(subscription, admin_user=first_office, reason="Full")

        with time_machine.travel(datetime.datetime(2026, 7, 21, 12, 0), tick=False):
            reject_subscription(stale, admin_user=second_office, reason="Other")

        subscription.refresh_from_db()
        assert subscription.admin_rejection_reason == "Full"
        assert subscription.admin_confirmed_by == first_office
        assert subscription.admin_rejected_at.date() == datetime.date(2026, 7, 20)

    def test_a_second_member_reject_sends_no_second_mail(self, tenant):
        first_office, second_office = JasminUserFactory(), JasminUserFactory()
        member = _pending_member(email="applicant@example.com")
        stale = Member.objects.get(pk=member.pk)

        with mock.patch.object(MemberService, "_send_email") as send_email:
            MemberService().reject_and_notify(
                member, admin_user=first_office, reason="Full"
            )
            MemberService().reject_and_notify(
                stale, admin_user=second_office, reason="Other"
            )

        assert send_email.call_count == 1
        member.refresh_from_db()
        assert member.admin_rejection_reason == "Full"
        assert member.admin_confirmed_by == first_office


@pytest.mark.django_db
class TestARejectOnAClosedStationDay:
    def test_the_subscription_is_rejected_and_logged(self, tenant):
        subscription = SubscriptionFactory(admin_confirmed=False)
        # The station day closes before the term ends, which the subscription's
        # own validation refuses on a full save.
        DeliveryStationDay.objects.filter(
            pk=subscription.default_delivery_station_day_id
        ).update(valid_until=datetime.date(2026, 8, 30))

        reject_subscription(
            subscription, admin_user=JasminUserFactory(), reason="Station closed"
        )

        subscription.refresh_from_db()
        assert subscription.admin_rejected_at is not None
        entry = LogEntry.objects.get_for_object(subscription).get(
            action=LogEntry.Action.UPDATE
        )
        assert entry.changes_dict["admin_rejection_reason"][1] == "Station closed"


@pytest.mark.django_db
class TestAnExitLocksTheSubscriptionsFirst:
    def test_the_cancellation(self, tenant):
        member = MemberFactory()
        SubscriptionFactory(member=member, admin_confirmed=False)

        with CaptureQueriesContext(connection) as queries:
            cancel_member_with_coop_shares(member, notify=False)

        assert _first_lock(queries, "commissioning_subscription") < _first_lock(
            queries, "commissioning_member"
        )

    def test_the_gdpr_erasure(self, tenant):
        member = MemberFactory(user=None)
        SubscriptionFactory(member=member, admin_confirmed=False)

        with CaptureQueriesContext(connection) as queries:
            GDPRService.anonymize_subject(ErasureSubject.of_member(member))

        assert _first_lock(queries, "commissioning_subscription") < _first_lock(
            queries, "commissioning_member"
        )
