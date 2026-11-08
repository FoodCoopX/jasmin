"""The packing mode and each share size's packing.

In the "boxes" or "bulk" mode a saved size takes the flag that matches it; in
"mixed" the office chooses it, and a new size without a choice is boxed. A
switch that would change how a running or upcoming size is packed is refused;
a switch to "mixed" never is.
"""

from __future__ import annotations

import datetime

import pytest
import time_machine
from django.urls import reverse
from rest_framework import status

from apps.commissioning.models import ShareTypeVariation
from apps.commissioning.tests.factories import (
    ShareTypeFactory,
    ShareTypeVariationFactory,
)
from apps.commissioning.tests.factories.settings import use_packing_mode
from apps.shared.tenants.models import TenantSettings

VARIATIONS_URL = reverse("share_type_variation-list")


@pytest.fixture(autouse=True)
def _frozen_clock():
    with time_machine.travel(datetime.datetime(2026, 11, 4, 12, 0), tick=False):
        yield


def _create(api_client, share_type=None, **fields):
    share_type = share_type or ShareTypeFactory()
    return api_client.post(
        VARIATIONS_URL,
        {
            "share_type": share_type.pk,
            "size": "M",
            "valid_from": share_type.valid_from.isoformat(),
            **fields,
        },
        format="json",
    )


def _switch(api_client, tenant, mode):
    return api_client.put(
        f"/api/tenants/settings/update_current_settings/?tenant_id={tenant.id}",
        {"settings": {"packing_mode": mode}},
        format="json",
    )


def _mode(tenant):
    return TenantSettings.get_current_settings(tenant).packing_mode


@pytest.mark.django_db
class TestSizePacking:
    @pytest.mark.parametrize(("mode", "flag"), [("BOXES", False), ("BULK", True)])
    def test_a_size_saved_in_a_pure_mode_takes_its_packing(
        self, api_client, tenant, mode, flag
    ):
        use_packing_mode(tenant, mode)

        resp = _create(api_client, is_packed_bulk=not flag)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert ShareTypeVariation.objects.get(pk=resp.data["id"]).is_packed_bulk is flag

    def test_saving_a_size_in_a_pure_mode_corrects_an_old_flag(
        self, api_client, tenant
    ):
        use_packing_mode(tenant, "BOXES")
        variation = ShareTypeVariationFactory(is_packed_bulk=True)

        resp = api_client.patch(
            reverse("share_type_variation-detail", args=[variation.pk]),
            {"sort_order": 3},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        variation.refresh_from_db()
        assert variation.is_packed_bulk is False

    def test_a_new_size_in_mixed_mode_is_boxed_without_a_choice(
        self, api_client, tenant
    ):
        use_packing_mode(tenant, "MIXED")

        share_type = ShareTypeFactory()
        unchosen = _create(api_client, share_type)
        loose = _create(api_client, share_type, size="L", is_packed_bulk=True)

        assert unchosen.status_code == status.HTTP_201_CREATED, unchosen.data
        assert loose.status_code == status.HTTP_201_CREATED, loose.data
        assert not ShareTypeVariation.objects.get(pk=unchosen.data["id"]).is_packed_bulk
        assert ShareTypeVariation.objects.get(pk=loose.data["id"]).is_packed_bulk

    def test_a_size_in_mixed_mode_keeps_its_choice(self, api_client, tenant):
        use_packing_mode(tenant, "MIXED")
        variation = ShareTypeVariationFactory(is_packed_bulk=True)

        resp = api_client.patch(
            reverse("share_type_variation-detail", args=[variation.pk]),
            {"sort_order": 3},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        variation.refresh_from_db()
        assert variation.is_packed_bulk is True


@pytest.mark.django_db
class TestModeSwitch:
    @pytest.mark.parametrize(("current", "new"), [("BOXES", "BULK"), ("BULK", "BOXES")])
    def test_refuses_switching_between_pure_modes_while_sizes_run(
        self, api_client, tenant, current, new
    ):
        use_packing_mode(tenant, current)
        ShareTypeVariationFactory()

        resp = _switch(api_client, tenant, new)

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "packing_mode.switch_changes_packing"
        assert _mode(tenant) == current

    @pytest.mark.parametrize("current", ["BOXES", "BULK"])
    def test_always_switches_to_mixed(self, api_client, tenant, current):
        use_packing_mode(tenant, current)
        ShareTypeVariationFactory()

        resp = _switch(api_client, tenant, "MIXED")

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _mode(tenant) == "MIXED"

    @pytest.mark.parametrize(
        ("new", "refusing_flag"), [("BOXES", True), ("BULK", False)]
    )
    def test_leaves_mixed_only_when_no_size_changes_packing(
        self, api_client, tenant, new, refusing_flag
    ):
        use_packing_mode(tenant, "MIXED")
        ShareTypeVariationFactory(is_packed_bulk=not refusing_flag)
        changing = ShareTypeVariationFactory(is_packed_bulk=refusing_flag)

        refused = _switch(api_client, tenant, new)
        changing.is_packed_bulk = not refusing_flag
        changing.save()
        allowed = _switch(api_client, tenant, new)

        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert allowed.status_code == status.HTTP_200_OK, allowed.data
        assert _mode(tenant) == new

    def test_a_farm_without_settings_yet_switches_from_boxes(self, api_client, tenant):
        TenantSettings.objects.filter(tenant=tenant).delete()
        ShareTypeVariationFactory()

        resp = _switch(api_client, tenant, "BULK")

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "packing_mode.switch_changes_packing"

    def test_an_ended_size_does_not_hold_the_mode(self, api_client, tenant):
        use_packing_mode(tenant, "MIXED")
        ShareTypeVariationFactory(
            is_packed_bulk=True, valid_until=datetime.date(2026, 6, 28)
        )

        resp = _switch(api_client, tenant, "BOXES")

        assert resp.status_code == status.HTTP_200_OK, resp.data
