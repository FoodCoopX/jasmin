"""Subscription changes written with ``update()`` reach the audit log.

A rejection, a waiting-list withdrawal and a member exit write their stamps
with ``QuerySet.update()``, which sends none of the signals auditlog records
from, so each writes its entries itself (``apps.shared.audit_log``).
"""

from __future__ import annotations

import datetime

import pytest
from auditlog.models import LogEntry
from django.utils import timezone

from apps.commissioning.models import Subscription
from apps.commissioning.services.member_cancellation import (
    _cancel_draft_subscriptions,
    _force_end_subscription,
)
from apps.commissioning.services.member_service import MemberService
from apps.commissioning.services.waiting_list_offer_service import (
    withdraw_from_waiting_list,
)
from apps.commissioning.tests.factories import (
    JasminUserFactory,
    MemberFactory,
    SubscriptionFactory,
)


def _changes(subscription: Subscription) -> dict:
    """The fields the subscription's audit-log UPDATE entries changed."""
    changed: dict = {}
    for entry in LogEntry.objects.get_for_object(subscription).filter(
        action=LogEntry.Action.UPDATE
    ):
        changed.update(entry.changes_dict)
    return changed


@pytest.mark.django_db
class TestUpdatesReachTheAuditLog:
    def test_a_waiting_list_withdrawal_keeps_the_position_it_left(self, tenant):
        subscription = SubscriptionFactory(
            on_waiting_list=True,
            waiting_list_status=Subscription.WaitingListStatus.PENDING,
            waiting_list_position=3,
        )

        withdraw_from_waiting_list(Subscription.objects.filter(pk=subscription.pk))

        changes = _changes(subscription)
        assert changes["waiting_list_position"][0] == "3"
        assert "on_waiting_list" in changes

    def test_a_member_rejection_logs_its_open_subscriptions(self, tenant):
        member = MemberFactory(email="", admin_confirmed=False)
        subscription = SubscriptionFactory(member=member, admin_confirmed=False)

        MemberService().reject_and_notify(
            member, admin_user=JasminUserFactory(), reason="No room"
        )

        changes = _changes(subscription)
        assert "admin_rejected_at" in changes
        assert changes["admin_rejection_reason"][1] == "No room"

    def test_an_exit_logs_the_drafts_it_cancels(self, tenant):
        member = MemberFactory()
        draft = SubscriptionFactory(member=member, admin_confirmed=False)

        _cancel_draft_subscriptions(
            member,
            now=timezone.now(),
            effective=datetime.date(2026, 6, 28),
            cancelled_by=None,
        )

        changes = _changes(draft)
        assert "cancelled_at" in changes
        assert changes["cancelled_effective_at"][1] == "2026-06-28"

    def test_a_force_end_is_logged(self, tenant):
        subscription = SubscriptionFactory(admin_confirmed=True)

        _force_end_subscription(
            subscription,
            effective=datetime.date(2026, 6, 28),
            now=timezone.now(),
            cancelled_by=None,
        )

        assert "cancelled_effective_at" in _changes(subscription)
