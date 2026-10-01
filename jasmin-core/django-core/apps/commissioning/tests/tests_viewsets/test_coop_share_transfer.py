"""``POST /api/commissioning/coop_shares/transfer/`` — moving paid coop shares from
one member to another as ledger rows, and what those rows mean for the GDPR
retention check, the payback statistics and the GenG §30 member register.

The clock is frozen because the endpoint refuses transfer dates in the future.
"""

from __future__ import annotations

import csv
import datetime
import importlib
import io
from decimal import Decimal
from unittest import mock

import pytest
import time_machine
from django.apps import apps as django_apps
from django.db.models import F, Sum
from django.urls import reverse
from django.utils import timezone

from apps.commissioning.errors import MemberHasActiveSubscriptions
from apps.commissioning.models import CoopShare, CoopShareTransfer, Member
from apps.commissioning.services.coop_share_service import CoopShareService
from apps.commissioning.services.member_cancellation import (
    cancel_member_with_coop_shares,
)
from apps.commissioning.services.member_register_export import get_csv_dialect
from apps.commissioning.services.statistics import (
    calculate_member_dashboard_statistics,
)
from apps.commissioning.tests.factories import (
    CoopShareFactory,
    JasminUserFactory,
    MemberFactory,
)
from apps.gdpr.services import GDPRService
from apps.shared.tenants.models import TenantSettings

URL = reverse("coop_shares-transfer")
FROZEN_NOW = datetime.datetime(2026, 9, 14, 12, 0)
TODAY = datetime.date(2026, 9, 14)
ENTRY_DATE = datetime.date(2024, 1, 8)
GIVEN_NOTE = "Transfer to #9 on 14.09.2026: 2 share(s)"
RECEIVED_NOTE = "Transfer from #7 on 14.09.2026: 2 share(s)"

exit_date_migration = importlib.import_module(
    "apps.commissioning.migrations.0030_date_transfer_exits_by_the_latest_transfer"
)


@pytest.fixture(autouse=True)
def _frozen_clock():
    with time_machine.travel(FROZEN_NOW, tick=False):
        yield


def _settings(tenant, **kwargs) -> TenantSettings:
    return TenantSettings.objects.create(
        tenant=tenant,
        valid_from=timezone.now() - datetime.timedelta(seconds=1),
        **kwargs,
    )


def _member_with_shares(
    *amounts: int, member_kwargs: dict | None = None, **share_kwargs
) -> tuple[Member, list[CoopShare]]:
    """An admitted member holding one confirmed row per amount, paid 60 days ago.
    Shares are created while the member is still pending so the per-row bounds
    check doesn't apply."""
    member = MemberFactory(
        admin_confirmed=False, entry_date=ENTRY_DATE, **(member_kwargs or {})
    )
    share_kwargs.setdefault("paid_at", timezone.now() - datetime.timedelta(days=60))
    shares = [
        CoopShareFactory(
            member=member,
            amount_of_coop_shares=amount,
            admin_confirmed=True,
            **share_kwargs,
        )
        for amount in amounts
    ]
    Member.objects.filter(pk=member.pk).update(admin_confirmed=True)
    member.refresh_from_db()
    return member, shares


def _post(api_client, from_member, to_member, amount, transfer_date=TODAY, **extra):
    return api_client.post(
        URL,
        {
            "from_member": str(from_member.pk),
            "to_member": str(to_member.pk),
            "amount_of_coop_shares": amount,
            "transfer_date": transfer_date.isoformat(),
            **extra,
        },
        format="json",
    )


def _net_by_value(member: Member) -> dict[int, Decimal]:
    rows = (
        CoopShare.objects.filter(member=member, cancelled_at__isnull=True)
        .values("value_one_coop_share")
        .annotate(total=Sum("amount_of_coop_shares"))
    )
    return {row["value_one_coop_share"]: row["total"] for row in rows}


def _register_counts(api_client, date_to: datetime.date) -> dict[str, str]:
    """Share count per member number in the member register ending ``date_to``."""
    resp = api_client.get(
        reverse("member-export-csv"),
        {"date_from": "2024-01-01", "date_to": date_to.isoformat()},
    )
    assert resp.status_code == 200
    content = b"".join(resp.streaming_content).decode("utf-8").lstrip("﻿")
    rows = list(csv.reader(io.StringIO(content), delimiter=get_csv_dialect().delimiter))
    return {row[0]: row[7] for row in rows[1:] if row}


@pytest.mark.django_db
class TestCoopShareTransfer:
    def test_transfer_adds_a_negative_and_a_positive_row(
        self, api_client, tenant, user
    ):
        giver, (row,) = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        _settings(tenant, min_number_coop_shares=3, max_number_coop_shares=10)

        resp = _post(
            api_client,
            giver,
            receiver,
            2,
            note="sold to a neighbour",
            from_member_note=GIVEN_NOTE,
            to_member_note=RECEIVED_NOTE,
        )

        assert resp.status_code == 201, resp.data
        assert resp.data["from_member_cancelled"] is False
        transfer = CoopShareTransfer.objects.get(pk=resp.data["id"])
        assert transfer.amount_of_coop_shares == 2
        assert transfer.transfer_date == TODAY
        assert transfer.note == "sold to a neighbour"
        assert transfer.created_by == user

        row.refresh_from_db()
        assert row.amount_of_coop_shares == Decimal("5")
        assert row.cancelled_at is None
        assert row.note is None

        given = CoopShare.objects.get(member=giver, transfer=transfer)
        assert given.amount_of_coop_shares == Decimal("-2")
        assert given.admin_confirmed
        assert given.admin_confirmed_by == user
        assert given.value_one_coop_share == row.value_one_coop_share
        assert timezone.localtime(given.paid_at).date() == TODAY
        assert given.note == GIVEN_NOTE

        received = CoopShare.objects.get(member=receiver, transfer=transfer)
        assert received.amount_of_coop_shares == Decimal("2")
        assert received.admin_confirmed
        assert timezone.localtime(received.paid_at).date() == TODAY
        assert received.note == RECEIVED_NOTE
        assert received.is_increase is True

        giver.refresh_from_db()
        assert giver.cancelled_at is None
        assert CoopShareService.member_total_shares(giver) == 3
        assert CoopShareService.member_total_shares(receiver) == 5

    def test_share_value_with_the_most_recent_payment_goes_first(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(2, value_one_coop_share=100)
        CoopShareFactory(
            member=giver,
            amount_of_coop_shares=2,
            value_one_coop_share=50,
            admin_confirmed=True,
            paid_at=timezone.now() - datetime.timedelta(days=10),
        )
        receiver, _ = _member_with_shares(3)

        resp = _post(api_client, giver, receiver, 3)

        assert resp.status_code == 201, resp.data
        given = CoopShare.objects.filter(member=giver, transfer__isnull=False)
        received = CoopShare.objects.filter(member=receiver, transfer__isnull=False)
        assert sorted(
            given.values_list("value_one_coop_share", "amount_of_coop_shares")
        ) == [
            (50, Decimal("-2")),
            (100, Decimal("-1")),
        ]
        assert sorted(
            received.values_list("value_one_coop_share", "amount_of_coop_shares")
        ) == [(50, Decimal("2")), (100, Decimal("1"))]

    def test_a_later_transfer_can_only_give_what_is_left(self, api_client, tenant):
        giver, _ = _member_with_shares(6)
        receiver, _ = _member_with_shares(3)

        assert _post(api_client, giver, receiver, 2).status_code == 201
        assert _post(api_client, giver, receiver, 1).status_code == 201
        resp = _post(api_client, giver, receiver, 4)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.exceeds_held"
        assert resp.data["details"] == {"available": 3}
        assert CoopShareService.member_total_shares(giver) == 3

    def test_backdated_transfer_is_capped_by_what_each_share_value_holds_today(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(3, value_one_coop_share=100)
        CoopShareFactory(
            member=giver,
            amount_of_coop_shares=2,
            value_one_coop_share=50,
            admin_confirmed=True,
            paid_at=timezone.now() - datetime.timedelta(days=40),
        )
        receiver, _ = _member_with_shares(3)

        # Dated today: the more recently paid share value (50) goes first.
        assert _post(api_client, giver, receiver, 2).status_code == 201
        resp = _post(
            api_client,
            giver,
            receiver,
            2,
            transfer_date=TODAY - datetime.timedelta(days=30),
        )

        assert resp.status_code == 201, resp.data
        assert _net_by_value(giver) == {50: Decimal("0"), 100: Decimal("1")}

    def test_giving_every_share_needs_the_cancellation_confirmed(
        self, api_client, tenant
    ):
        giver, (row,) = _member_with_shares(3)
        receiver, _ = _member_with_shares(3)

        resp = _post(api_client, giver, receiver, 3)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.cancellation_not_confirmed"
        assert not CoopShareTransfer.objects.exists()
        giver.refresh_from_db()
        assert giver.cancelled_at is None
        assert CoopShareService.member_total_shares(giver) == 3

    def test_giving_every_share_settles_the_rows_and_cancels_the_giver(
        self, api_client, tenant, user
    ):
        giver, _ = _member_with_shares(2, 3)
        receiver, _ = _member_with_shares(3)
        _settings(tenant, min_number_coop_shares=3, max_number_coop_shares=10)
        transfer_date = datetime.date(2026, 9, 1)

        resp = _post(
            api_client,
            giver,
            receiver,
            5,
            transfer_date=transfer_date,
            confirm_member_cancellation=True,
        )

        assert resp.status_code == 201, resp.data
        assert resp.data["from_member_cancelled"] is True
        transfer = CoopShareTransfer.objects.get(pk=resp.data["id"])
        giver.refresh_from_db()
        assert giver.cancelled_effective_at == transfer_date
        assert giver.cancelled_by == user
        giver_rows = CoopShare.objects.filter(member=giver)
        assert giver_rows.count() == 3
        for row in giver_rows:
            assert row.cancelled_effective_at == transfer_date
            assert row.payback_due_date is None
            assert row.settled_by_transfer_id == transfer.pk
        assert CoopShareService.member_total_shares(receiver) == 8

    def test_a_giver_cancelled_by_the_transfer_is_told_no_settlement_follows(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(3, member_kwargs={"email": "giver@example.com"})
        receiver, _ = _member_with_shares(3)

        with mock.patch(
            "apps.commissioning.services.member_email.schedule_member_email"
        ) as schedule:
            resp = _post(
                api_client, giver, receiver, 3, confirm_member_cancellation=True
            )

        assert resp.status_code == 201, resp.data
        assert schedule.call_args.kwargs["slug"] == "commissioning.member_cancelled"
        assert schedule.call_args.kwargs["context"]["shares_transferred"] is True

    def test_pending_shares_do_not_keep_a_giver_who_gave_every_confirmed_share(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(3)
        pending = CoopShareFactory(
            member=giver, amount_of_coop_shares=1, admin_confirmed=False
        )
        receiver, _ = _member_with_shares(3)

        resp = _post(api_client, giver, receiver, 3, confirm_member_cancellation=True)

        assert resp.status_code == 201, resp.data
        assert resp.data["from_member_cancelled"] is True
        pending.refresh_from_db()
        assert pending.cancelled_at is not None
        assert pending.settled_by_transfer is None

    def test_full_transfer_leaves_no_coop_share_retention_block(
        self, api_client, tenant
    ):
        member_user = JasminUserFactory()
        giver, _ = _member_with_shares(3, member_kwargs={"user": member_user})
        receiver, _ = _member_with_shares(3)

        resp = _post(api_client, giver, receiver, 3, confirm_member_cancellation=True)

        assert resp.status_code == 201, resp.data
        reasons = GDPRService.check_retention_blocks(member_user)
        assert not any("CoopShare" in reason for reason in reasons), reasons

    def test_a_partial_giver_who_leaves_later_owes_only_the_rest(
        self, api_client, tenant
    ):
        member_user = JasminUserFactory()
        giver, _ = _member_with_shares(5, member_kwargs={"user": member_user})
        receiver, _ = _member_with_shares(3)
        payback_due_before = calculate_member_dashboard_statistics()[
            "payback_due_coop_shares"
        ]

        assert _post(api_client, giver, receiver, 2).status_code == 201
        cancel_member_with_coop_shares(giver)

        stats = calculate_member_dashboard_statistics()
        assert stats["payback_due_coop_shares"] == payback_due_before + 3
        reasons = GDPRService.check_retention_blocks(member_user)
        assert any("CoopShare" in reason for reason in reasons), reasons

        # The office pays back the remaining 3 shares on the original row only.
        CoopShare.objects.filter(member=giver, amount_of_coop_shares__gt=0).update(
            paid_back_date=F("payback_due_date")
        )

        stats = calculate_member_dashboard_statistics()
        assert stats["payback_due_coop_shares"] == payback_due_before
        reasons = GDPRService.check_retention_blocks(member_user)
        assert not any("CoopShare" in reason for reason in reasons), reasons

    def test_member_register_counts_transfer_rows_from_the_transfer_date(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(5, member_kwargs={"member_number": 7101})
        receiver, _ = _member_with_shares(3, member_kwargs={"member_number": 7102})
        dialect = get_csv_dialect()

        resp = _post(
            api_client, giver, receiver, 2, transfer_date=datetime.date(2026, 9, 1)
        )
        assert resp.status_code == 201, resp.data

        before = _register_counts(api_client, datetime.date(2026, 8, 31))
        assert before["7101"] == dialect.format(Decimal("5.00"))
        assert before["7102"] == dialect.format(Decimal("3.00"))
        after = _register_counts(api_client, TODAY)
        assert after["7101"] == dialect.format(Decimal("3.00"))
        assert after["7102"] == dialect.format(Decimal("5.00"))

    def test_member_register_moves_every_share_of_an_emptying_transfer_once(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(5, member_kwargs={"member_number": 7201})
        receiver, _ = _member_with_shares(3, member_kwargs={"member_number": 7202})
        dialect = get_csv_dialect()

        resp = _post(
            api_client,
            giver,
            receiver,
            5,
            transfer_date=datetime.date(2026, 9, 1),
            confirm_member_cancellation=True,
        )
        assert resp.status_code == 201, resp.data

        before = _register_counts(api_client, datetime.date(2026, 8, 31))
        assert before["7201"] == dialect.format(Decimal("5.00"))
        assert before["7202"] == dialect.format(Decimal("3.00"))
        # The giver's exit takes effect on the transfer date, so none of their
        # rows counts any more: "0", where rows netting out would read "0,00".
        on_the_day = _register_counts(api_client, datetime.date(2026, 9, 1))
        assert on_the_day["7201"] == dialect.format(Decimal("0"))
        assert on_the_day["7202"] == dialect.format(Decimal("8.00"))
        after = _register_counts(api_client, TODAY)
        assert after["7201"] == dialect.format(Decimal("0"))
        assert after["7202"] == dialect.format(Decimal("8.00"))

    def test_member_register_keeps_a_future_exit_s_shares_until_the_exit(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(5, member_kwargs={"member_number": 7301})
        receiver, _ = _member_with_shares(3, member_kwargs={"member_number": 7302})
        dialect = get_csv_dialect()
        resp = _post(
            api_client, giver, receiver, 2, transfer_date=datetime.date(2026, 9, 1)
        )
        assert resp.status_code == 201, resp.data

        # Notice given today for the end of the year.
        cancel_member_with_coop_shares(
            giver, cancelled_effective_at=datetime.date(2026, 12, 31), notify=False
        )

        october = _register_counts(api_client, datetime.date(2026, 10, 31))
        assert october["7301"] == dialect.format(Decimal("3.00"))
        assert october["7302"] == dialect.format(Decimal("5.00"))
        on_exit = _register_counts(api_client, datetime.date(2026, 12, 31))
        assert on_exit["7301"] == dialect.format(Decimal("0"))

    def test_emptying_transfer_backdated_before_another_dates_the_exit_by_the_last(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(10, member_kwargs={"member_number": 7401})
        first, _ = _member_with_shares(3, member_kwargs={"member_number": 7402})
        second, _ = _member_with_shares(3, member_kwargs={"member_number": 7403})
        dialect = get_csv_dialect()
        resp = _post(
            api_client, giver, first, 3, transfer_date=datetime.date(2026, 9, 1)
        )
        assert resp.status_code == 201, resp.data
        # Recorded afterwards, dated earlier, and it empties the giver.
        resp = _post(
            api_client,
            giver,
            second,
            7,
            transfer_date=datetime.date(2026, 8, 15),
            confirm_member_cancellation=True,
        )
        assert resp.status_code == 201, resp.data

        giver.refresh_from_db()
        assert giver.cancelled_effective_at == datetime.date(2026, 9, 1)
        # Between the two transfers the giver still holds the 3 shares the
        # later one takes.
        between = _register_counts(api_client, datetime.date(2026, 8, 20))
        assert between["7401"] == dialect.format(Decimal("3.00"))
        assert between["7402"] == dialect.format(Decimal("3.00"))
        assert between["7403"] == dialect.format(Decimal("10.00"))
        after = _register_counts(api_client, datetime.date(2026, 9, 1))
        assert after["7401"] == dialect.format(Decimal("0"))
        assert after["7402"] == dialect.format(Decimal("6.00"))
        assert after["7403"] == dialect.format(Decimal("10.00"))

    def test_a_backdated_transfer_can_t_give_shares_that_come_in_after_its_date(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(5)
        sender, _ = _member_with_shares(8)
        first, _ = _member_with_shares(3)
        second, _ = _member_with_shares(3)
        received = _post(
            api_client, sender, giver, 3, transfer_date=datetime.date(2026, 9, 10)
        )
        assert received.status_code == 201, received.data
        given = _post(
            api_client, giver, first, 5, transfer_date=datetime.date(2026, 9, 5)
        )
        assert given.status_code == 201, given.data

        # On 2026-09-01 the giver held 5, but the transfer dated 2026-09-05 takes
        # all of them, and the 3 coming in on 2026-09-10 aren't there yet.
        refused = _post(
            api_client,
            giver,
            second,
            3,
            transfer_date=datetime.date(2026, 9, 1),
            confirm_member_cancellation=True,
        )
        assert refused.status_code == 400, refused.data
        assert refused.data["code"] == "coop_share_transfer.exceeds_held"
        assert refused.data["details"] == {"available": 0}

        accepted = _post(
            api_client,
            giver,
            second,
            3,
            transfer_date=datetime.date(2026, 9, 10),
            confirm_member_cancellation=True,
        )
        assert accepted.status_code == 201, accepted.data
        giver.refresh_from_db()
        assert giver.cancelled_effective_at == datetime.date(2026, 9, 10)

    def test_a_received_transfer_counts_from_its_transfer_date_whatever_its_paid_at(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(3)
        sender, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        received = _post(
            api_client, sender, giver, 2, transfer_date=datetime.date(2026, 9, 10)
        )
        assert received.status_code == 201, received.data
        # Onboarding mode lets the office edit paid_at on a confirmed row.
        CoopShare.objects.filter(member=giver, transfer__isnull=False).update(
            paid_at=timezone.make_aware(datetime.datetime(2026, 8, 1))
        )

        refused = _post(
            api_client,
            giver,
            receiver,
            5,
            transfer_date=datetime.date(2026, 8, 15),
            confirm_member_cancellation=True,
        )

        assert refused.status_code == 400, refused.data
        assert refused.data["code"] == "coop_share_transfer.exceeds_held"
        assert refused.data["details"] == {"available": 3}

    @pytest.mark.parametrize("side", ["giver", "receiver"])
    def test_an_exit_before_the_member_s_own_transfer_is_refused(
        self, api_client, tenant, side
    ):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        resp = _post(
            api_client, giver, receiver, 2, transfer_date=datetime.date(2026, 9, 1)
        )
        assert resp.status_code == 201, resp.data
        member = giver if side == "giver" else receiver

        refused = api_client.post(
            reverse("member-cancel", kwargs={"pk": member.pk}),
            {"effective_at": "2026-08-31"},
            format="json",
        )
        assert refused.status_code == 400
        assert refused.data["code"] == "member.exit_before_transfer"
        assert refused.data["field"] == "effective_at"
        # The de/en messages interpolate it.
        assert refused.data["details"] == {"transfer_date": "2026-09-01"}
        member.refresh_from_db()
        assert member.cancelled_at is None

        accepted = api_client.post(
            reverse("member-cancel", kwargs={"pk": member.pk}),
            {"effective_at": "2026-09-01"},
            format="json",
        )
        assert accepted.status_code == 200, accepted.data

    def test_leaving_the_giver_between_zero_and_the_minimum_is_refused(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        _settings(tenant, min_number_coop_shares=3, max_number_coop_shares=10)

        resp = _post(api_client, giver, receiver, 3, from_member_note=GIVEN_NOTE)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "member.coop_shares_out_of_range"
        assert not CoopShareTransfer.objects.exists()
        assert not CoopShare.objects.filter(transfer__isnull=False).exists()
        assert CoopShareService.member_total_shares(giver) == 5
        assert CoopShareService.member_total_shares(receiver) == 3

    def test_receiver_above_the_maximum_is_refused(self, api_client, tenant):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(9)
        _settings(tenant, min_number_coop_shares=3, max_number_coop_shares=10)

        resp = _post(api_client, giver, receiver, 2)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "member.coop_shares_out_of_range"
        assert not CoopShareTransfer.objects.exists()
        assert CoopShareService.member_total_shares(receiver) == 9

    def test_giver_with_active_subscriptions_keeps_everything(self, api_client, tenant):
        giver, (row,) = _member_with_shares(3)
        receiver, _ = _member_with_shares(3)

        with mock.patch(
            "apps.commissioning.services.member_cancellation."
            "_assert_no_active_subscription",
            side_effect=MemberHasActiveSubscriptions("active subscriptions"),
        ):
            resp = _post(
                api_client, giver, receiver, 3, confirm_member_cancellation=True
            )

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "member.has_active_subscriptions"
        assert not CoopShareTransfer.objects.exists()
        row.refresh_from_db()
        assert row.cancelled_at is None
        assert row.settled_by_transfer is None
        giver.refresh_from_db()
        assert giver.cancelled_at is None

    def test_backdated_transfer_to_a_trial_member_uses_the_transfer_date_as_entry_date(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(6)
        receiver = MemberFactory(is_trial=True, admin_confirmed=True, entry_date=None)
        _settings(tenant, min_number_coop_shares=3, max_number_coop_shares=10)
        transfer_date = TODAY - datetime.timedelta(days=10)

        resp = _post(api_client, giver, receiver, 3, transfer_date=transfer_date)

        assert resp.status_code == 201, resp.data
        receiver.refresh_from_db()
        assert receiver.is_trial is False
        assert receiver.entry_date == transfer_date


@pytest.mark.django_db
class TestCoopShareTransferValidation:
    def test_more_than_the_confirmed_paid_shares_is_refused(self, api_client, tenant):
        giver, _ = _member_with_shares(3)
        CoopShareFactory(member=giver, amount_of_coop_shares=4, admin_confirmed=False)
        CoopShareFactory(
            member=giver, amount_of_coop_shares=2, admin_confirmed=True, paid_at=None
        )
        receiver, _ = _member_with_shares(3)

        resp = _post(api_client, giver, receiver, 5)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.exceeds_held"
        assert resp.data["field"] == "amount_of_coop_shares"
        assert resp.data["details"] == {"available": 3}

    def test_shares_paid_after_the_transfer_date_are_not_transferable(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(3)
        CoopShareFactory(
            member=giver,
            amount_of_coop_shares=2,
            admin_confirmed=True,
            paid_at=timezone.now() - datetime.timedelta(days=1),
        )
        receiver, _ = _member_with_shares(3)

        resp = _post(
            api_client,
            giver,
            receiver,
            4,
            transfer_date=TODAY - datetime.timedelta(days=10),
        )

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.exceeds_held"
        assert resp.data["details"] == {"available": 3}

    def test_same_member_is_refused(self, api_client, tenant):
        giver, _ = _member_with_shares(3)

        resp = _post(api_client, giver, giver, 1)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.same_member"
        assert resp.data["field"] == "to_member"

    def test_giver_who_is_not_admitted_is_refused(self, api_client, tenant):
        giver, _ = _member_with_shares(5)
        Member.objects.filter(pk=giver.pk).update(admin_confirmed=False)
        receiver, _ = _member_with_shares(3)

        resp = _post(api_client, giver, receiver, 1)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.giver_not_admitted"

    @pytest.mark.parametrize(
        "update",
        [
            {"admin_confirmed": False},
            {"admin_rejected_at": datetime.datetime(2026, 1, 5, tzinfo=datetime.UTC)},
        ],
        ids=["pending", "rejected"],
    )
    def test_receiver_who_is_not_admitted_is_refused(self, api_client, tenant, update):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        Member.objects.filter(pk=receiver.pk).update(**update)

        resp = _post(api_client, giver, receiver, 1)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.receiver_not_admitted"

    def test_cancelled_receiver_is_refused(self, api_client, tenant):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        Member.objects.filter(pk=receiver.pk).update(
            cancelled_at=timezone.now(), cancelled_effective_at=TODAY
        )

        resp = _post(api_client, giver, receiver, 1)

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.receiver_cancelled"

    def test_cancelled_giver_is_refused(self, api_client, tenant):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        Member.objects.filter(pk=giver.pk).update(
            cancelled_at=timezone.now(), cancelled_effective_at=TODAY
        )

        resp = _post(api_client, giver, receiver, 1)

        assert resp.status_code == 409, resp.data
        assert resp.data["code"] == "member.already_cancelled"

    def test_future_transfer_date_is_refused(self, api_client, tenant):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)

        resp = _post(
            api_client,
            giver,
            receiver,
            1,
            transfer_date=TODAY + datetime.timedelta(days=1),
        )

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.date_in_future"

    def test_transfer_date_before_the_givers_entry_is_refused(self, api_client, tenant):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)

        resp = _post(
            api_client,
            giver,
            receiver,
            1,
            transfer_date=ENTRY_DATE - datetime.timedelta(days=1),
        )

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.date_before_entry"
        assert resp.data["details"] == {
            "entry_date": ENTRY_DATE.isoformat(),
            "context": "from_member",
        }

    def test_transfer_date_before_the_receivers_entry_is_refused(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        receiver_entry = TODAY - datetime.timedelta(days=5)
        Member.objects.filter(pk=receiver.pk).update(entry_date=receiver_entry)

        resp = _post(
            api_client,
            giver,
            receiver,
            1,
            transfer_date=TODAY - datetime.timedelta(days=10),
        )

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "coop_share_transfer.date_before_entry"
        assert resp.data["details"] == {
            "entry_date": receiver_entry.isoformat(),
            "context": "to_member",
        }

    @pytest.mark.parametrize("amount", [0, -1, "2.5"])
    def test_amount_that_is_not_a_whole_positive_number_is_refused(
        self, api_client, tenant, amount
    ):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)

        resp = _post(api_client, giver, receiver, amount)

        assert resp.status_code == 400, resp.data
        assert not CoopShareTransfer.objects.exists()

    def test_anonymous_request_is_refused(self, anon_client, tenant):
        resp = anon_client.post(URL, {}, format="json")

        assert resp.status_code in (401, 403)


@pytest.mark.django_db
class TestDateTransferExitsByTheLatestTransfer:
    """Migration 0030 moves the exit an emptying transfer dated by its own date,
    before another transfer of the giver, to the giver's latest transfer."""

    def test_moves_an_emptied_giver_s_exit_to_their_latest_transfer(
        self, api_client, tenant
    ):
        giver, _ = _member_with_shares(10, member_kwargs={"member_number": 7501})
        first, _ = _member_with_shares(3)
        second, _ = _member_with_shares(3)
        resp = _post(
            api_client, giver, first, 3, transfer_date=datetime.date(2026, 9, 1)
        )
        assert resp.status_code == 201, resp.data
        resp = _post(
            api_client,
            giver,
            second,
            7,
            transfer_date=datetime.date(2026, 8, 15),
            confirm_member_cancellation=True,
        )
        assert resp.status_code == 201, resp.data
        # The exit as an emptying transfer used to store it: its own date.
        too_early = datetime.date(2026, 8, 15)
        Member.objects.filter(pk=giver.pk).update(cancelled_effective_at=too_early)
        settled = CoopShare.objects.filter(
            member=giver, settled_by_transfer__isnull=False
        )
        settled.update(cancelled_effective_at=too_early)

        exit_date_migration.date_exits_by_the_latest_transfer(django_apps, None)
        exit_date_migration.date_exits_by_the_latest_transfer(django_apps, None)

        giver.refresh_from_db()
        assert giver.cancelled_effective_at == datetime.date(2026, 9, 1)
        assert {row.cancelled_effective_at for row in settled} == {
            datetime.date(2026, 9, 1)
        }
        between = _register_counts(api_client, datetime.date(2026, 8, 20))
        assert between["7501"] == get_csv_dialect().format(Decimal("3.00"))

    def test_leaves_an_exit_the_office_recorded_alone(self, api_client, tenant):
        giver, _ = _member_with_shares(5)
        receiver, _ = _member_with_shares(3)
        resp = _post(
            api_client, giver, receiver, 2, transfer_date=datetime.date(2026, 9, 1)
        )
        assert resp.status_code == 201, resp.data
        cancel_member_with_coop_shares(
            giver, cancelled_effective_at=datetime.date(2026, 9, 1), notify=False
        )
        # Before one of the member's transfers, as the office could record it.
        Member.objects.filter(pk=giver.pk).update(
            cancelled_effective_at=datetime.date(2026, 8, 31)
        )

        exit_date_migration.date_exits_by_the_latest_transfer(django_apps, None)

        giver.refresh_from_db()
        assert giver.cancelled_effective_at == datetime.date(2026, 8, 31)
