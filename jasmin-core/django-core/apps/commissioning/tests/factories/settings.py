"""Tenant settings the commissioning tests switch."""

from __future__ import annotations

import datetime

from django.utils import timezone

from apps.shared.tenants.models import TenantSettings


def use_packing_mode(tenant, mode: str) -> None:
    """Give ``tenant`` the packing mode ``mode`` from now on."""
    row = TenantSettings.objects.filter(tenant=tenant, valid_until__isnull=True).first()
    if row is None:
        row = TenantSettings.objects.create(
            tenant=tenant, valid_from=timezone.now() - datetime.timedelta(days=365)
        )
    elif row.valid_from > timezone.now():
        # The frozen clock sits before a row opened in real time; move its start
        # back so ``get_current_settings`` sees it.
        row.valid_from = timezone.now() - datetime.timedelta(days=365)
    row.packing_mode = mode
    row.save()
