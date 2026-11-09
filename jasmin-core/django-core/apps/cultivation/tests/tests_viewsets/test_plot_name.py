"""A plot needs a name: the server refuses a create without one, and an update
that clears it. An update that leaves ``name`` out keeps the stored one."""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status

from apps.cultivation.models import Plot

CODE = "cultivation.plot_name_required"
LIST_URL = reverse("cultivation_plots-list")


@pytest.mark.django_db
class TestPlotName:
    @pytest.mark.parametrize("payload", [{}, {"name": ""}, {"name": "  "}])
    def test_a_new_plot_without_a_name_is_refused(self, api_client, tenant, payload):
        before = Plot.objects.count()

        resp = api_client.post(LIST_URL, payload, format="json")

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.json()["code"] == CODE
        assert resp.json()["field"] == "name"
        assert Plot.objects.count() == before

    def test_a_named_plot_is_saved(self, api_client, tenant):
        resp = api_client.post(LIST_URL, {"name": "Field 1"}, format="json")

        assert resp.status_code == status.HTTP_201_CREATED, resp.content

    def test_clearing_the_name_is_refused(self, api_client, tenant):
        plot = Plot.objects.create(name="Field 1")

        resp = api_client.patch(
            reverse("cultivation_plots-detail", kwargs={"pk": plot.pk}),
            {"name": None},
            format="json",
        )

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.json()["code"] == CODE

    def test_an_update_without_the_name_keeps_it(self, api_client, tenant):
        plot = Plot.objects.create(name="Field 1")

        resp = api_client.patch(
            reverse("cultivation_plots-detail", kwargs={"pk": plot.pk}),
            {"is_greenhouse": True},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.content
        plot.refresh_from_db()
        assert plot.name == "Field 1"
        assert plot.is_greenhouse is True
