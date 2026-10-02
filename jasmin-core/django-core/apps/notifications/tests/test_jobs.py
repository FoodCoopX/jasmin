"""``enqueue_job``: a background job belongs to a tenant schema."""

from __future__ import annotations

import pytest
from django_tenants.utils import get_public_schema_name, schema_context

from apps.notifications.jobs import enqueue_job
from apps.notifications.models import BackgroundJob


def _task(**kwargs) -> None:
    """Stands in for a Huey task; enqueue_job runs it only on commit."""


@pytest.mark.django_db
class TestEnqueueJob:
    def test_in_a_tenant_schema_queues_the_job(self, tenant):
        job = enqueue_job(kind="test.job", task=_task, task_kwargs={})

        assert BackgroundJob.objects.get(pk=job.pk).status == (
            BackgroundJob.STATUS_QUEUED
        )

    def test_outside_a_tenant_schema_is_refused(self, tenant):
        with (
            schema_context(get_public_schema_name()),
            pytest.raises(RuntimeError, match="outside a tenant schema"),
        ):
            enqueue_job(kind="test.job", task=_task, task_kwargs={})
