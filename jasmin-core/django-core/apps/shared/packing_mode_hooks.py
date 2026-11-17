"""Cross-app view of the packing mode (commissioning extraction seam).

The packing mode is a tenant setting (``apps.shared.tenants``), but the share
sizes it follows from belong to commissioning, which the shared layer must not
import. Commissioning registers two functions in its ``AppConfig.ready()``:
the mode the farm's sizes are packed in, which the tenant payload reports in
place of the stored one, and the check the settings endpoint runs before it
saves a new stored mode. Without commissioning the stored mode stands and the
check does nothing.

Single slots on purpose: there is exactly one of each, and re-registering is
harmless.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

_guard: Callable[[str, str], None] | None = None
_source: Callable[[Any, str], str] | None = None


def set_packing_mode_switch_guard(guard: Callable[[str, str], None]) -> None:
    """Register the check run before the packing mode changes. Called once
    from ``apps.commissioning.apps.CommissioningConfig.ready()``."""
    global _guard
    _guard = guard


def check_packing_mode_switch(current_mode: str, new_mode: str) -> None:
    """Run the registered check; it raises to refuse the switch."""
    if _guard is not None:
        _guard(current_mode, new_mode)


def set_packing_mode_source(source: Callable[[Any, str], str]) -> None:
    """Register what tells the packing mode in effect. Called once from
    ``apps.commissioning.apps.CommissioningConfig.ready()``."""
    global _source
    _source = source


def packing_mode_in_effect(tenant: Any, stored_mode: str) -> str:
    """The mode ``tenant``'s share sizes are packed in; ``stored_mode`` where
    nothing tells it."""
    if _source is None:
        return stored_mode
    return _source(tenant, stored_mode)
