"""Washing and cleaning amounts are the office's to plan.

Every staff role reads both lists, but only office and admin add or change an
amount on them. Harvest and purchase amounts, which go through the same two actions, stay
open to the crew. A body with only the model is refused by validation once the
role passes, so a 400 shows the role got through.
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.authz.roles import Role
from apps.commissioning.tests.factories import JasminUserFactory

CODE = "authz.privilege_required"
ADD_URL = reverse("documentation_summary-add-additional-theoretical-amount")
UPDATE_URL = reverse(
    "documentation_summary-update-additional-theoretical-amount",
    kwargs={"pk": "unknown"},
)


def _client(role):
    client = APIClient()
    client.force_authenticate(user=JasminUserFactory(roles=[role]))
    return client


@pytest.mark.django_db
class TestWashCleanAmountsOfficeOnly:
    @pytest.mark.parametrize("model", ["washamount", "cleanamount"])
    @pytest.mark.parametrize("role", [Role.STAFF, Role.GARDENER, Role.MANAGEMENT])
    def test_other_staff_roles_may_not_add_or_change_an_amount(
        self, tenant, role, model
    ):
        client = _client(role)

        added = client.post(ADD_URL, {"model": model}, format="json")
        changed = client.patch(UPDATE_URL, {"model": model}, format="json")

        for response in (added, changed):
            assert response.status_code == status.HTTP_403_FORBIDDEN
            assert response.json()["code"] == CODE

    @pytest.mark.parametrize("model", ["washamount", "cleanamount"])
    @pytest.mark.parametrize("role", [Role.OFFICE, Role.ADMIN])
    def test_office_and_admin_get_past_the_role_check(self, tenant, role, model):
        response = _client(role).post(ADD_URL, {"model": model}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize("model", ["harvest", "purchase"])
    def test_harvest_and_purchase_amounts_stay_open_to_the_crew(self, tenant, model):
        response = _client(Role.GARDENER).post(ADD_URL, {"model": model}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
