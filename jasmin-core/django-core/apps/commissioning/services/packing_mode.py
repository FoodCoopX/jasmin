"""The farm's packing mode, and whether it packs a share size loose.

``TenantSettings.packing_mode`` packs every share in a box (``BOXES``), every
share loose (``BULK``) or each size as its ``ShareTypeVariation.is_packed_bulk``
says (``MIXED``). A size saved in ``BOXES`` or ``BULK`` takes the flag that
matches the mode; in ``MIXED`` the office chooses it, and a new size saved
without a choice — as Tapir's sync creates them — is boxed. A size saved before may
still hold a flag from an earlier mode, so the readers here go by the mode, not
the flag alone.

A switch that would change how a running or upcoming size is packed is
refused. A switch to ``MIXED`` never is: there each size is packed as its flag
says, and a flag need not match how a pure mode packed the size.
"""

from __future__ import annotations

from typing import Any

from django.utils import timezone

from apps.shared.tenants.models import PackingMode, TenantSettings
from core.tenant_db import connection

from ..errors import PackingModeSwitchChangesPacking
from ..models import ShareTypeVariation


def current_packing_mode() -> str:
    """The current tenant's mode; ``BOXES`` before it has settings."""
    settings = TenantSettings.get_current_settings(connection.tenant)
    return settings.packing_mode if settings is not None else PackingMode.BOXES


def flag_for_mode(mode: str) -> bool | None:
    """The ``is_packed_bulk`` a size takes in ``mode``; None in ``MIXED``,
    where the office chooses."""
    if mode == PackingMode.MIXED:
        return None
    return mode == PackingMode.BULK


def apply_packing_mode(attrs: dict[str, Any], *, creating: bool) -> dict[str, Any]:
    """A share size's validated fields with its packing settled: in "boxes" or
    "bulk" the flag that matches the mode; in "mixed" the office's choice, a
    new size boxed without one, and a saved one keeps its own."""
    flag = flag_for_mode(current_packing_mode())
    if flag is not None:
        attrs["is_packed_bulk"] = flag
    elif creating:
        attrs.setdefault("is_packed_bulk", False)
    return attrs


def packed_loose(variation: ShareTypeVariation, mode: str) -> bool:
    """Whether ``mode`` packs ``variation`` loose."""
    flag = flag_for_mode(mode)
    return variation.is_packed_bulk if flag is None else flag


def refuse_packing_mode_switch(current_mode: str, new_mode: str) -> None:
    """Refuse a switch that would change how a running or upcoming physical
    size is packed."""
    # A value that is no mode is the settings' own validation's to refuse.
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
        if packed_loose(variation, current_mode) != loose_after
    ]
    if changing:
        raise PackingModeSwitchChangesPacking(
            new_mode=new_mode,
            sizes=", ".join(
                f"{variation.share_type.name} - {variation.size}"
                for variation in changing
            ),
        )
