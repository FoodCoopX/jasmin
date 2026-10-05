"""``regenerate_charge_schedules``: re-plans every billable subscription's
charges, in every active tenant or in the one ``--tenant`` names.
"""

from __future__ import annotations

import datetime
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.payments.constants import ChargeStatus
from apps.payments.models import ChargeSchedule
from apps.payments.tests.test_regenerate_all import _make_subscription
from apps.shared.tenants.models import Tenant


def _subscription_for_2025():
    # A MONTHLY subscription over a whole year: twelve planned charges.
    return _make_subscription(
        valid_from=datetime.date(2025, 1, 6),
        valid_until=datetime.date(2025, 12, 28),
    )


def _planned_charges(subscription) -> int:
    return ChargeSchedule.objects.filter(
        subscription=subscription, status=ChargeStatus.PLANNED
    ).count()


def _run(**options) -> str:
    out = StringIO()
    call_command("regenerate_charge_schedules", stdout=out, **options)
    return out.getvalue()


@pytest.mark.django_db
class TestRegenerateChargeSchedules:
    def test_one_tenant(self, tenant, tenant_settings):
        subscription = _subscription_for_2025()

        output = _run(tenant=tenant.schema_name)

        assert _planned_charges(subscription) == 12
        assert f"Tenant {tenant.schema_name}: regenerating..." in output
        assert "subscriptions processed." in output

    def test_every_active_tenant(self, tenant, tenant_settings):
        subscription = _subscription_for_2025()

        output = _run()

        assert _planned_charges(subscription) == 12
        assert f"Tenant {tenant.schema_name}: regenerating..." in output

    def test_an_inactive_tenant_is_skipped(self, tenant, tenant_settings):
        subscription = _subscription_for_2025()
        Tenant.objects.filter(pk=tenant.pk).update(is_active=False)

        output = _run()

        assert _planned_charges(subscription) == 0
        assert f"Tenant {tenant.schema_name}:" not in output

    def test_an_unknown_tenant_is_refused(self, tenant):
        with pytest.raises(CommandError, match="No tenant with schema 'no_such'"):
            _run(tenant="no_such")
