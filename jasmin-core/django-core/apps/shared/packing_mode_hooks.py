"""Cross-app check of a packing mode switch (commissioning extraction seam).

The packing mode is a tenant setting (``apps.shared.tenants``), but the share
sizes whose packing a switch would change belong to commissioning, which the
shared layer must not import. Commissioning registers its check in its
``AppConfig.ready()``; the settings endpoint calls
``check_packing_mode_switch`` before it saves a new mode. Without commissioning
the check does nothing.

Single slot on purpose: there is exactly one check, and re-registering it is
harmless.
"""

from __future__ import annotations

from collections.abc import Callable

_guard: Callable[[str, str], None] | None = None


def set_packing_mode_switch_guard(guard: Callable[[str, str], None]) -> None:
    """Register the check run before the packing mode changes. Called once
    from ``apps.commissioning.apps.CommissioningConfig.ready()``."""
    global _guard
    _guard = guard


def check_packing_mode_switch(current_mode: str, new_mode: str) -> None:
    """Run the registered check; it raises to refuse the switch."""
    if _guard is not None:
        _guard(current_mode, new_mode)
