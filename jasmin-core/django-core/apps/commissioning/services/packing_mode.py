"""The farm's packing mode, and whether it packs a share size loose.

The office chooses for each share size whether it is pre-packed or packed
loose (``ShareTypeVariation.is_packed_bulk``), and the farm's packing mode
follows from its running and upcoming physical sizes: ``BOXES`` while every one
is pre-packed, ``BULK`` while every one is loose, ``MIXED`` while they differ.
``TenantSettings.packing_mode`` stays as the mode of a farm without such sizes.
A new size saved without a choice — as Tapir's sync creates them — is packed
like the farm's other sizes, pre-packed where they differ.

Whether a share is packed loose is its own size's flag, a past week's too; the
mode only says which lists and marks the farm needs. The stored mode is
refused a switch to a pure mode that a running or upcoming size contradicts; a
switch to ``MIXED``, or the stored mode sent back unchanged, never is.
"""

from __future__ import annotations

from typing import Any

from django.utils import timezone

from apps.shared.tenants.models import PackingMode, TenantSettings
from core.tenant_db import connection

from ..errors import PackingModeSwitchChangesPacking
from ..models import ShareTypeVariation


def packing_mode_of_sizes(stored_mode: str) -> str:
    """The mode the current tenant's running and upcoming physical sizes are
    packed in; ``stored_mode`` while it has none."""
    flags = set(
        ShareTypeVariation.current.active_at_date_or_future(timezone.localdate())
        .filter(variation_type=ShareTypeVariation.VariationType.PHYSICAL)
        .order_by()
        .values_list("is_packed_bulk", flat=True)
        .distinct()
    )
    if not flags:
        return stored_mode
    if len(flags) > 1:
        return PackingMode.MIXED
    return PackingMode.BULK if flags.pop() else PackingMode.BOXES


def packing_mode_of_tenant(tenant: Any, stored_mode: str) -> str:
    """``packing_mode_of_sizes`` for ``tenant``, whose sizes are at hand only
    while the connection is on its schema."""
    if connection.schema_name != getattr(tenant, "schema_name", None):
        return stored_mode
    return packing_mode_of_sizes(stored_mode)


def current_packing_mode() -> str:
    """The current tenant's mode."""
    settings = TenantSettings.get_current_settings(connection.tenant)
    stored_mode = settings.packing_mode if settings is not None else PackingMode.BOXES
    return packing_mode_of_sizes(stored_mode)


def apply_packing_mode(attrs: dict[str, Any], *, creating: bool) -> dict[str, Any]:
    """A share size's validated fields with its packing settled: the office's
    choice, and for a new size without one the packing of the farm's other
    sizes, pre-packed where they differ."""
    if creating and "is_packed_bulk" not in attrs:
        attrs["is_packed_bulk"] = current_packing_mode() == PackingMode.BULK
    return attrs


def refuse_packing_mode_switch(current_mode: str, new_mode: str) -> None:
    """Refuse a stored switch to a mode that would pack a running or upcoming
    physical size otherwise than it says."""
    # A value that is no mode is the settings' own validation's to refuse; the
    # stored mode sent back unchanged is no switch.
    if new_mode not in PackingMode.values or new_mode in (
        current_mode,
        PackingMode.MIXED,
    ):
        return
    loose_after = new_mode == PackingMode.BULK
    changing = [
        variation
        for variation in ShareTypeVariation.current.active_at_date_or_future(
            timezone.localdate()
        )
        .filter(variation_type=ShareTypeVariation.VariationType.PHYSICAL)
        .select_related("share_type")
        if variation.is_packed_bulk != loose_after
    ]
    if changing:
        raise PackingModeSwitchChangesPacking(
            new_mode=new_mode,
            sizes=", ".join(
                f"{variation.share_type.name} - {variation.size}"
                for variation in changing
            ),
        )
