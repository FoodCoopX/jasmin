"""The packing mode and each share size's packing.

The office chooses for each size whether it is pre-packed or loose, and the
farm's mode follows from its running and upcoming physical sizes: "boxes" while
every one is pre-packed, "bulk" while every one is loose, "mixed" while they
differ, and the stored mode while there are none. A new size saved without a
choice is packed like the farm's other sizes. A stored switch to a mode that
contradicts a running or upcoming size is refused; a switch to "mixed" never
is. A data migration gives every size the packing its farm's stored pure mode
gave it.
"""

from __future__ import annotations

import datetime
import importlib
from types import SimpleNamespace

import pytest
import time_machine
from django.apps import apps as django_apps
from django.urls import reverse
from rest_framework import status

from apps.commissioning.models import ShareTypeVariation
from apps.commissioning.services.packing_mode import (
    current_packing_mode,
    packing_mode_of_tenant,
)
from apps.commissioning.tests.factories import (
    ShareTypeFactory,
    ShareTypeVariationFactory,
)
from apps.commissioning.tests.factories.settings import use_packing_mode
from apps.shared.tenants.models import TenantSettings
from core.tenant_db import connection

VARIATIONS_URL = reverse("share_type_variation-list")

packing_migration = importlib.import_module(
    "apps.commissioning.migrations.0039_align_size_packing_with_stored_mode"
)


@pytest.fixture(autouse=True)
def _frozen_clock():
    with time_machine.travel(datetime.datetime(2026, 11, 4, 12, 0), tick=False):
        yield


@pytest.fixture(autouse=True)
def _only_this_tests_sizes(tenant):
    """Sizes committed by other tests would count in the farm's mode; within
    this test's transaction they turn virtual, which the mode leaves out."""
    ShareTypeVariation.objects.update(
        variation_type=ShareTypeVariation.VariationType.VIRTUAL
    )


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


def _sizes(*flags):
    for flag in flags:
        ShareTypeVariationFactory(is_packed_bulk=flag)


@pytest.mark.django_db
class TestSizePacking:
    @pytest.mark.parametrize(("stored", "flag"), [("BOXES", True), ("BULK", False)])
    def test_a_size_keeps_the_offices_choice_whatever_the_stored_mode(
        self, api_client, tenant, stored, flag
    ):
        use_packing_mode(tenant, stored)

        resp = _create(api_client, is_packed_bulk=flag)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert ShareTypeVariation.objects.get(pk=resp.data["id"]).is_packed_bulk is flag

    def test_saving_a_size_keeps_its_packing(self, api_client, tenant):
        use_packing_mode(tenant, "BOXES")
        variation = ShareTypeVariationFactory(is_packed_bulk=True)

        resp = api_client.patch(
            reverse("share_type_variation-detail", args=[variation.pk]),
            {"sort_order": 3},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        variation.refresh_from_db()
        assert variation.is_packed_bulk is True

    @pytest.mark.parametrize(
        ("flags", "loose"),
        [((True,), True), ((False,), False), ((True, False), False)],
    )
    def test_a_new_size_without_a_choice_is_packed_like_the_others(
        self, api_client, tenant, flags, loose
    ):
        use_packing_mode(tenant, "BOXES")
        _sizes(*flags)

        resp = _create(api_client)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert (
            ShareTypeVariation.objects.get(pk=resp.data["id"]).is_packed_bulk is loose
        )

    def test_the_first_size_without_a_choice_follows_the_stored_mode(
        self, api_client, tenant
    ):
        use_packing_mode(tenant, "BULK")

        resp = _create(api_client)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert ShareTypeVariation.objects.get(pk=resp.data["id"]).is_packed_bulk is True


@pytest.mark.django_db
class TestModeInEffect:
    @pytest.mark.parametrize(
        ("flags", "mode"),
        [((False, False), "BOXES"), ((True,), "BULK"), ((False, True), "MIXED")],
    )
    def test_follows_the_running_sizes_not_the_stored_mode(
        self, api_client, tenant, flags, mode
    ):
        use_packing_mode(tenant, "MIXED" if mode != "MIXED" else "BOXES")
        _sizes(*flags)

        resp = api_client.get(f"/api/tenants/tenants/{tenant.id}/")

        assert current_packing_mode() == mode
        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data["settings"]["packing_mode"] == mode
        # The stored setting stays as it was.
        assert resp.data["current_settings"]["packing_mode"] != mode

    def test_counts_an_upcoming_size(self, tenant):
        use_packing_mode(tenant, "BOXES")
        ShareTypeVariationFactory(
            is_packed_bulk=True, valid_from=datetime.date(2027, 1, 4)
        )

        assert current_packing_mode() == "BULK"

    def test_reports_the_stored_mode_where_the_tenants_sizes_are_not_at_hand(
        self, tenant
    ):
        """Serialized from another schema, as a super admin's list would."""
        _sizes(False)

        assert packing_mode_of_tenant(tenant, "BULK") == "BOXES"
        assert packing_mode_of_tenant(SimpleNamespace(schema_name="other"), "BULK") == (
            "BULK"
        )

    def test_without_running_physical_sizes_the_stored_mode_stands(self, tenant):
        use_packing_mode(tenant, "BULK")
        ShareTypeVariationFactory(valid_until=datetime.date(2026, 6, 28))
        ShareTypeVariationFactory(variation_type="virtual")

        assert current_packing_mode() == "BULK"


@pytest.mark.django_db
class TestModeSwitch:
    @pytest.mark.parametrize(("current", "new"), [("BOXES", "BULK"), ("BULK", "BOXES")])
    def test_refuses_switching_between_pure_modes_while_sizes_run(
        self, api_client, tenant, current, new
    ):
        use_packing_mode(tenant, current)
        ShareTypeVariationFactory(is_packed_bulk=current == "BULK")

        resp = _switch(api_client, tenant, new)

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "packing_mode.switch_changes_packing"
        assert _mode(tenant) == current

    @pytest.mark.parametrize("current", ["BOXES", "BULK"])
    def test_always_switches_to_mixed(self, api_client, tenant, current):
        use_packing_mode(tenant, current)
        ShareTypeVariationFactory(is_packed_bulk=current == "BULK")

        resp = _switch(api_client, tenant, "MIXED")

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _mode(tenant) == "MIXED"

    def test_takes_the_stored_mode_sent_back_unchanged(self, api_client, tenant):
        """The settings page saves the stored mode along with the others, also
        where the sizes are now packed otherwise."""
        use_packing_mode(tenant, "BOXES")
        ShareTypeVariationFactory(is_packed_bulk=True)

        resp = _switch(api_client, tenant, "BOXES")

        assert resp.status_code == status.HTTP_200_OK, resp.data

    @pytest.mark.parametrize(
        ("new", "refusing_flag"), [("BOXES", True), ("BULK", False)]
    )
    def test_leaves_mixed_only_when_no_size_is_packed_otherwise(
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


def _align_with_stored_mode():
    packing_migration.align_size_packing_with_stored_mode(
        django_apps, SimpleNamespace(connection=connection)
    )


@pytest.mark.django_db
class TestAligningSizesWithTheStoredMode:
    """The data migration that keeps every farm packed as its stored mode
    packed it when the sizes start to decide."""

    @pytest.mark.parametrize(("stored", "loose"), [("BOXES", False), ("BULK", True)])
    def test_gives_every_size_the_packing_of_a_stored_pure_mode(
        self, tenant, stored, loose
    ):
        use_packing_mode(tenant, stored)
        running = ShareTypeVariationFactory(is_packed_bulk=not loose)
        ended = ShareTypeVariationFactory(
            is_packed_bulk=not loose, valid_until=datetime.date(2026, 6, 28)
        )

        _align_with_stored_mode()

        for size in (running, ended):
            size.refresh_from_db()
            assert size.is_packed_bulk is loose
        assert current_packing_mode() == stored

    def test_leaves_the_sizes_of_a_mixed_farm_as_they_are(self, tenant):
        use_packing_mode(tenant, "MIXED")
        loose = ShareTypeVariationFactory(is_packed_bulk=True)
        boxed = ShareTypeVariationFactory(is_packed_bulk=False)

        _align_with_stored_mode()

        loose.refresh_from_db()
        boxed.refresh_from_db()
        assert (loose.is_packed_bulk, boxed.is_packed_bulk) == (True, False)

    def test_counts_a_farm_without_settings_as_boxes(self, tenant):
        TenantSettings.objects.filter(tenant=tenant).delete()
        size = ShareTypeVariationFactory(is_packed_bulk=True)

        _align_with_stored_mode()

        size.refresh_from_db()
        assert size.is_packed_bulk is False
