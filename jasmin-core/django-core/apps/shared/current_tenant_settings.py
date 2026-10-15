"""The tenant settings currently in force, as provided by the host application.

Jasmin runs embedded in a host application that owns the tenant settings. The
host names a function in the Django setting
``JASMIN_CURRENT_TENANT_SETTINGS_PROVIDER`` (a dotted path); that function takes
no argument and returns the settings object currently in force, or ``None``.
The returned object must expose the same fields as ``TenantSettings``.

Without the setting, there are no settings: every caller falls back to its
defaults, as for a tenant without a settings row.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.utils.module_loading import import_string


def get_current_tenant_settings() -> Any | None:
    provider_path = getattr(settings, "JASMIN_CURRENT_TENANT_SETTINGS_PROVIDER", None)
    if not provider_path:
        return None
    return import_string(provider_path)()
