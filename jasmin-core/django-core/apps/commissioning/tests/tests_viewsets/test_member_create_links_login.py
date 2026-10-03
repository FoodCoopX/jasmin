"""Office member create with an email that already has an active login.

The member and the link to the login are saved in one transaction, so a
failing link leaves no member behind for a retry to duplicate. The member is
confirmed at once only when it can be admitted already — its coop shares fit
the tenant's window (a trial member, or no minimum); otherwise it stays linked
and pending until the office confirms it. In onboarding mode the member is
only linked: the office confirms it later with its historical date.
"""

from __future__ import annotations

import datetime
from unittest import mock

import pytest
from django.db import DatabaseError
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from apps.commissioning.models import Member
from apps.commissioning.tests.factories import JasminUserFactory
from apps.shared.tenants.models import TenantSettings

URL = reverse("member-list")
EMAIL = "existing.login@example.com"


def _settings(tenant, *, min_number_coop_shares: int, onboarding_mode: bool = False):
    row = TenantSettings.objects.filter(tenant=tenant, valid_until__isnull=True).first()
    if row is None:
        row = TenantSettings.objects.create(
            tenant=tenant, valid_from=timezone.now() - datetime.timedelta(days=365)
        )
    row.min_number_coop_shares = min_number_coop_shares
    row.onboarding_mode = onboarding_mode
    row.save()


def _create(api_client, **fields):
    return api_client.post(
        URL,
        {"first_name": "Ada", "last_name": "Lovelace", "email": EMAIL, **fields},
        format="json",
    )


@pytest.mark.django_db
class TestMemberCreateLinksAnExistingLogin:
    @pytest.fixture(autouse=True)
    def _login(self, tenant):
        self.login = JasminUserFactory(email=EMAIL, account_status="active")

    def test_a_member_below_the_minimum_is_linked_and_stays_pending(
        self, api_client, tenant
    ):
        _settings(tenant, min_number_coop_shares=3)

        resp = _create(api_client)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        member = Member.objects.get(email=EMAIL)
        assert member.user_id == self.login.pk
        assert member.admin_confirmed is False

    def test_a_member_that_can_be_admitted_is_confirmed(self, api_client, tenant):
        _settings(tenant, min_number_coop_shares=3)

        resp = _create(api_client, is_trial=True)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        member = Member.objects.get(email=EMAIL)
        assert member.user_id == self.login.pk
        assert member.admin_confirmed is True

    def test_onboarding_mode_only_links(self, api_client, tenant):
        _settings(tenant, min_number_coop_shares=3, onboarding_mode=True)

        resp = _create(api_client, is_trial=True)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        member = Member.objects.get(email=EMAIL)
        assert member.user_id == self.login.pk
        assert member.admin_confirmed is False

    def test_a_failing_link_leaves_no_member_behind(self, api_client, tenant):
        _settings(tenant, min_number_coop_shares=3)

        with mock.patch(
            "apps.commissioning.services.member_service.MemberService.link_to_user",
            side_effect=DatabaseError("simulated link failure"),
        ):
            resp = _create(api_client)

        assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert not Member.objects.filter(email=EMAIL).exists()
