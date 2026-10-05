"""``JasminUser.theme``: the user's light, dark or follow-the-device choice. The
profile endpoint saves it and the login hands it to the app, which applies it
in every browser the user signs in on.
"""

from __future__ import annotations

import importlib

import pytest
from django.apps import apps as django_apps
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import JasminUser, ThemeChoices
from apps.authz.roles import Role
from apps.commissioning.tests.factories import JasminUserFactory

pytestmark = pytest.mark.django_db

PASSWORD = "Z3rgRushIsScary!42"


def _profile_patch(user, data):
    client = APIClient()
    client.force_authenticate(user=user)
    return client.patch(f"/api/auth/{user.id}/", data=data, format="json")


class TestThemePreference:
    def test_a_new_user_follows_the_device(self, tenant):
        assert JasminUserFactory().theme == ThemeChoices.SYSTEM

    @pytest.mark.parametrize("theme", ["dark", "light", "system"])
    def test_the_profile_saves_and_returns_it(self, tenant, theme):
        user = JasminUserFactory(roles=[Role.MEMBER])

        resp = _profile_patch(user, {"theme": theme})

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data["theme"] == theme
        user.refresh_from_db()
        assert user.theme == theme

    def test_an_unknown_theme_is_refused(self, tenant):
        user = JasminUserFactory(roles=[Role.MEMBER])

        resp = _profile_patch(user, {"theme": "purple"})

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "theme" in resp.data["details"]
        user.refresh_from_db()
        assert user.theme == ThemeChoices.SYSTEM

    def test_the_login_hands_it_to_the_app(self, tenant):
        user = JasminUserFactory(email="theme@example.com", theme=ThemeChoices.DARK)
        user.set_password(PASSWORD)
        user.save(update_fields=["password"])

        resp = APIClient().post(
            "/api/auth/login/",
            data={"email": "theme@example.com", "password": PASSWORD},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data["user"]["theme"] == "dark"


class TestStoredLightBecomesSystem:
    """The migration that adds ``system``: a stored ``light`` was never chosen,
    so it becomes ``system``; a ``dark`` stays."""

    def test_light_follows_the_device_and_dark_stays(self, tenant):
        migration = importlib.import_module(
            "apps.accounts.migrations.0005_jasminuser_theme_system"
        )
        light = JasminUserFactory(theme=ThemeChoices.LIGHT)
        dark = JasminUserFactory(theme=ThemeChoices.DARK)

        migration.stored_light_to_system(django_apps, None)

        assert JasminUser.objects.get(pk=light.pk).theme == ThemeChoices.SYSTEM
        assert JasminUser.objects.get(pk=dark.pk).theme == ThemeChoices.DARK
