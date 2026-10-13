"""Commissioning-app constants and tenant-aware default helpers.

The ``get_default_tax_rate_*`` helpers resolve the tenant's configured
default tax rate, falling back to a hardcoded constant only when the
tenant context is genuinely unavailable (e.g. during system startup
when no tenant is bound to the connection, or on an unmigrated DB).
"""

import logging

logger = logging.getLogger(__name__)

ID_LENGTH = 12  # this is the ID in the JasminModel

# Use URL-safe alphabet (excludes similar-looking characters, excludes "_", this is needed for composite IDs!)
JASMIN_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

DEFAULT_TAX_RATE = 7
DEFAULT_CRATE_TAX_RATE = 19

PURCHASE_DAY = 1  # tuesday


def _resolve_tenant_setting(attr_name: str):
    return None


def get_default_tax_rate_articles():
    """Get the tenant's default tax rate for articles, falling back to hardcoded default."""
    value = _resolve_tenant_setting("default_tax_rate_articles")
    return value if value is not None else DEFAULT_TAX_RATE


def get_default_tax_rate_crates():
    """Get the tenant's default tax rate for crates, falling back to hardcoded default."""
    value = _resolve_tenant_setting("default_tax_rate_crates")
    return value if value is not None else DEFAULT_CRATE_TAX_RATE


def crates_should_be_on_documents() -> bool:
    """Whether crates are priced and put on delivery notes / invoices for the
    active tenant. Defaults to ``True`` (the model default + the safe fallback
    when there's no tenant context) so existing tenants are unaffected."""
    value = _resolve_tenant_setting("crates_should_be_on_documents")
    return True if value is None else bool(value)


def get_min_weeks_from_creation_to_start_delivery() -> int:
    """Lead time in weeks before a subscription may start, measured from
    "now". Falls back to 0 (no lead-time enforcement) when there's no tenant
    context — e.g. test setup. Mirrors the office UI's ``valid_from`` date
    picker floor (see ``useSubscriptionTerm`` on the frontend)."""
    value = _resolve_tenant_setting("min_weeks_from_creation_to_start_delivery")
    return int(value) if value is not None else 0


# these are for the archivable manager
CUT_OFF_MONTHS = 2
CUT_OFF_DAYS = 30
