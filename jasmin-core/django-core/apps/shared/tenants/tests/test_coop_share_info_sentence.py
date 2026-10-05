"""``TenantSettings.info_sentence_about_coop_shares``: the tenant's own
explanation of its cooperative shares. The office writes it with the other
settings; the public registration wizard shows it in its coop-share step, so
the anonymous tenant payload carries it.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.shared.tenants.models import TenantSettings

SENTENCE = "Each share is paid back at its nominal value when you leave."


def _update(api_client, tenant, **settings_kwargs):
    return api_client.put(
        f"/api/tenants/settings/update_current_settings/?tenant_id={tenant.id}",
        {"settings": settings_kwargs},
        format="json",
    )


@pytest.fixture
def anon_client(tenant_host):
    return APIClient(HTTP_HOST=tenant_host)


@pytest.fixture
def restore_sentence(tenant):
    # The tenant is session-scoped, so settings writes persist across tests;
    # put the previous value back.
    current = TenantSettings.get_current_settings(tenant=tenant)
    previous = current.info_sentence_about_coop_shares if current else None
    yield
    current = TenantSettings.get_current_settings(tenant=tenant)
    if current is not None:
        current.info_sentence_about_coop_shares = previous
        current.save(update_fields=["info_sentence_about_coop_shares"])


@pytest.mark.django_db
class TestCoopShareInfoSentence:
    def test_the_office_sets_it_and_applicants_see_it(
        self, api_client, anon_client, tenant, restore_sentence
    ):
        resp = _update(api_client, tenant, info_sentence_about_coop_shares=SENTENCE)

        assert resp.status_code == 200, resp.data
        assert resp.data["settings"]["info_sentence_about_coop_shares"] == SENTENCE
        public = anon_client.get("/api/tenants/current/")
        assert public.status_code == 200
        assert public.data["info_sentence_about_coop_shares"] == SENTENCE

    def test_an_unset_sentence_reads_as_empty(
        self, api_client, anon_client, tenant, restore_sentence
    ):
        resp = _update(api_client, tenant, info_sentence_about_coop_shares=None)
        assert resp.status_code == 200, resp.data

        public = anon_client.get("/api/tenants/current/")

        assert public.data["info_sentence_about_coop_shares"] == ""
