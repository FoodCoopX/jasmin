"""``createsuperadmin``: creates — or, with ``--update-if-exists``, resets — a
platform super-admin login in the public schema. Django's ``createsuperuser``
can't: it targets the tenant user model.
"""

from __future__ import annotations

import io
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django_tenants.utils import schema_context

from apps.shared.super_admin.models import SuperAdmin

EMAIL = "ops.admin@example.com"
PASSWORD = "a-long-enough-password"
NEW_PASSWORD = "another-long-password"


def _run(**options) -> str:
    out = StringIO()
    with schema_context("public"):
        call_command("createsuperadmin", stdout=out, **options)
    return out.getvalue()


def _admin() -> SuperAdmin:
    with schema_context("public"):
        return SuperAdmin.objects.get(email=EMAIL)


@pytest.mark.django_db
class TestCreateSuperAdmin:
    def test_creates_an_active_login(self, _tenant_schema):
        output = _run(
            email="  Ops.Admin@Example.com ",
            password=PASSWORD,
            first_name="Ops",
            last_name="Admin",
        )

        admin = _admin()
        assert admin.is_active
        assert admin.check_password(PASSWORD)
        assert (admin.first_name, admin.last_name) == ("Ops", "Admin")
        assert f"Created SuperAdmin {EMAIL}" in output

    def test_an_existing_email_is_refused(self, _tenant_schema):
        _run(email=EMAIL, password=PASSWORD)

        with pytest.raises(CommandError, match="already exists"):
            _run(email=EMAIL, password=NEW_PASSWORD)

        assert _admin().check_password(PASSWORD)

    def test_update_if_exists_resets_the_password_and_reactivates(self, _tenant_schema):
        _run(email=EMAIL, password=PASSWORD, first_name="Ops", last_name="Admin")
        with schema_context("public"):
            SuperAdmin.objects.filter(email=EMAIL).update(is_active=False)

        output = _run(email=EMAIL, password=NEW_PASSWORD, update_if_exists=True)

        admin = _admin()
        assert admin.is_active
        assert admin.check_password(NEW_PASSWORD)
        # Names left out keep their stored values.
        assert (admin.first_name, admin.last_name) == ("Ops", "Admin")
        assert f"Updated existing SuperAdmin {EMAIL}" in output

    @pytest.mark.parametrize(
        "email, password, message",
        [
            ("not-an-email", PASSWORD, "Invalid email"),
            (EMAIL, "too-short", "at least 10 characters"),
            (EMAIL, "12345678901", "entirely numeric"),
        ],
    )
    def test_invalid_input_creates_nothing(
        self, _tenant_schema, email, password, message
    ):
        with pytest.raises(CommandError, match=message):
            _run(email=email, password=password)

        with schema_context("public"):
            assert not SuperAdmin.objects.filter(email=email).exists()

    def test_no_password_and_no_terminal_is_refused(self, _tenant_schema, monkeypatch):
        monkeypatch.setattr("sys.stdin", io.StringIO())

        with pytest.raises(CommandError, match="stdin is not a TTY"):
            _run(email=EMAIL)

        with schema_context("public"):
            assert not SuperAdmin.objects.filter(email=EMAIL).exists()
