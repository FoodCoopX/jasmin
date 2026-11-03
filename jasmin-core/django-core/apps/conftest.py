"""Suite-wide pytest fixtures, loaded for every test under ``apps/``.

The app fixtures live in each app's ``tests/conftest.py``, most of them
re-exported from the commissioning one. Only what has to hold for every test,
whichever conftest it sits under, goes here.
"""

from __future__ import annotations

import pytest
from django.db import connection


@pytest.fixture(autouse=True)
def _end_on_public_schema():
    """Switch the connection back to the public schema after every test.

    ``TenantMainMiddleware`` switches it to the schema a request resolves and
    never switches back, so a routed request made without the ``tenant``
    fixture (``anon_client``, a bare ``APIClient()``) would leave the next test
    on ``test_pytest``. That test would then find tenant data it never asked
    for, and a session fixture it sets up could not create its Tenant, which
    django-tenants allows only on the public schema. ``set_schema_to_public``
    runs no query, so this holds for tests without database access too.
    """
    yield
    connection.set_schema_to_public()


@pytest.fixture(autouse=True)
def _no_jasmin_host_from_the_environment(monkeypatch):
    """Run every test as standalone jasmin, whatever the shell exports.

    Without a ``JASMIN_HOST`` setting, ``apps.shared.host_capabilities`` reads
    the environment variable, which a dev stack sets to preview Tapir mode. A
    suite started from such a shell would otherwise run in Tapir mode, and every
    commissioning test would plan from imported demand. Tests that need a host
    name set it themselves.
    """
    monkeypatch.delenv("JASMIN_HOST", raising=False)
