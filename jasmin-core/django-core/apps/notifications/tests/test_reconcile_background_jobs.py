"""Tests for ``apps.notifications.tasks.reconcile_stale_background_jobs``.

A SIGKILL/OOM of the Huey worker mid-task never runs ``mark_done`` /
``mark_failed``, so the ``BackgroundJob`` row is stranded at ``running`` (or
``queued`` when the on_commit dispatch failed) forever. The sweep marks such
rows failed once their last liveness signal — ``heartbeat_at``, falling back to
``created_at`` for a never-started queued row — predates ``STALE_JOB_TIMEOUT``.
A live task heartbeats per item, so a fresh heartbeat must protect even a
long-running job from the sweep.
"""

from __future__ import annotations

import datetime
import logging

import pytest
from django.utils import timezone

from apps.notifications import tasks as notification_tasks
from apps.notifications.models import BackgroundJob

# Comfortably past / short of the 1h timeout so the tests are boundary-agnostic.
STALE = notification_tasks.STALE_JOB_TIMEOUT + datetime.timedelta(hours=1)
FRESH = datetime.timedelta(minutes=2)


def _job(
    *,
    status: str,
    heartbeat_age: datetime.timedelta | None = None,
    created_age: datetime.timedelta = datetime.timedelta(minutes=1),
) -> BackgroundJob:
    """Create a BackgroundJob with deterministic timestamps.

    ``created_at`` is ``auto_now_add`` and ``heartbeat_at`` is normally stamped
    by the writers, so both are forced via ``.update()`` after insert to control
    staleness precisely.
    """
    job = BackgroundJob.objects.create(kind="offer.bulk_send", status=status)
    now = timezone.now()
    fields: dict = {"created_at": now - created_age}
    if heartbeat_age is not None:
        fields["heartbeat_at"] = now - heartbeat_age
    BackgroundJob.objects.filter(pk=job.pk).update(**fields)
    job.refresh_from_db()
    return job


@pytest.mark.django_db
class TestReconcileStaleBackgroundJobs:
    def test_stale_running_job_marked_failed(self, tenant):
        job = _job(status=BackgroundJob.STATUS_RUNNING, heartbeat_age=STALE)

        notification_tasks.reconcile_stale_background_jobs.call_local()

        job.refresh_from_db()
        assert job.status == BackgroundJob.STATUS_FAILED
        assert "worker lost" in job.error
        assert job.completed_at is not None

    def test_stale_queued_job_with_no_heartbeat_marked_failed(self, tenant):
        # A queued row never started, so heartbeat_at is NULL and staleness is
        # measured from created_at.
        job = _job(status=BackgroundJob.STATUS_QUEUED, created_age=STALE)
        assert job.heartbeat_at is None

        notification_tasks.reconcile_stale_background_jobs.call_local()

        job.refresh_from_db()
        assert job.status == BackgroundJob.STATUS_FAILED

    def test_fresh_running_job_untouched(self, tenant):
        # A recent heartbeat proves the worker is alive — the job must survive
        # the sweep even though it was created long before the timeout (a legit
        # long bulk send). This is the property the per-item heartbeat buys us.
        job = _job(
            status=BackgroundJob.STATUS_RUNNING,
            heartbeat_age=FRESH,
            created_age=STALE,
        )

        notification_tasks.reconcile_stale_background_jobs.call_local()

        job.refresh_from_db()
        assert job.status == BackgroundJob.STATUS_RUNNING

    def test_fresh_queued_job_untouched(self, tenant):
        # Just-enqueued queued row waiting for a worker — not yet stale.
        job = _job(status=BackgroundJob.STATUS_QUEUED, created_age=FRESH)

        notification_tasks.reconcile_stale_background_jobs.call_local()

        job.refresh_from_db()
        assert job.status == BackgroundJob.STATUS_QUEUED

    def test_terminal_jobs_out_of_scope(self, tenant):
        # done / failed rows are terminal — never re-touched regardless of age.
        done = _job(status=BackgroundJob.STATUS_DONE, heartbeat_age=STALE)
        failed = _job(status=BackgroundJob.STATUS_FAILED, heartbeat_age=STALE)

        notification_tasks.reconcile_stale_background_jobs.call_local()

        done.refresh_from_db()
        failed.refresh_from_db()
        assert done.status == BackgroundJob.STATUS_DONE
        assert failed.status == BackgroundJob.STATUS_FAILED


@pytest.mark.django_db
class TestReconcileAlertsAdmins:
    """A reconciled (worker-lost) job must surface to admins, not just the log."""

    def test_alerts_when_jobs_reconciled(self, tenant):
        from unittest.mock import patch

        _job(status=BackgroundJob.STATUS_RUNNING, heartbeat_age=STALE)

        with patch.object(notification_tasks, "mail_admins") as mock_mail:
            notification_tasks.reconcile_stale_background_jobs.call_local()

        mock_mail.assert_called_once()
        # Subject names the count; body carries the per-tenant breakdown.
        kwargs = mock_mail.call_args.kwargs
        assert "background job" in kwargs["subject"].lower()
        assert "test_pytest" in kwargs["message"]

    def test_no_alert_when_nothing_reconciled(self, tenant):
        from unittest.mock import patch

        _job(status=BackgroundJob.STATUS_RUNNING, heartbeat_age=FRESH)

        with patch.object(notification_tasks, "mail_admins") as mock_mail:
            notification_tasks.reconcile_stale_background_jobs.call_local()

        mock_mail.assert_not_called()


@pytest.mark.django_db
class TestPruneOldBackgroundJobs:
    """Terminal rows past the retention window are deleted; queued/
    running rows and recent terminal rows are kept."""

    OLD = datetime.timedelta(
        days=notification_tasks.NOTIFICATION_LOG_RETENTION_DAYS + 5
    )
    RECENT = datetime.timedelta(
        days=notification_tasks.NOTIFICATION_LOG_RETENTION_DAYS - 5
    )

    def test_prunes_old_terminal_jobs_only(self, tenant):
        old_done = _job(status=BackgroundJob.STATUS_DONE, created_age=self.OLD)
        old_failed = _job(status=BackgroundJob.STATUS_FAILED, created_age=self.OLD)
        recent_done = _job(status=BackgroundJob.STATUS_DONE, created_age=self.RECENT)
        # Non-terminal rows must never be pruned here (the watchdog owns them),
        # even when old.
        old_queued = _job(status=BackgroundJob.STATUS_QUEUED, created_age=self.OLD)
        old_running = _job(status=BackgroundJob.STATUS_RUNNING, created_age=self.OLD)

        notification_tasks.prune_old_background_jobs.call_local()

        surviving = set(BackgroundJob.objects.values_list("pk", flat=True))
        assert old_done.pk not in surviving
        assert old_failed.pk not in surviving
        assert recent_done.pk in surviving
        assert old_queued.pk in surviving
        assert old_running.pk in surviving


@pytest.mark.django_db
class TestAJobAfterTheSweep:
    """The sweep and a job's own task can meet: its queue message can wait past
    the timeout, or a long step can go without a heartbeat."""

    def test_a_job_the_sweep_failed_does_not_run_when_its_message_comes(self, tenant):
        from apps.notifications.jobs import JobNotQueued, run_job

        job = _job(status=BackgroundJob.STATUS_QUEUED, created_age=STALE)
        notification_tasks.reconcile_stale_background_jobs.call_local()
        ran = []

        with pytest.raises(JobNotQueued):
            with run_job(tenant.schema_name, job.pk):
                ran.append(True)

        job.refresh_from_db()
        assert ran == []
        assert job.status == BackgroundJob.STATUS_FAILED
        assert "worker lost" in job.error

    def test_huey_logs_the_skipped_job_as_a_cancelled_task(self, tenant, caplog):
        """Huey logs the skip as a one-line warning instead of an error with its
        traceback, and doesn't retry it even for a task that allows retries.
        The ``tasks`` logger doesn't propagate to the root logger caplog listens
        on, so caplog's handler is attached to it."""
        from huey import MemoryHuey

        from apps.notifications.jobs import run_job

        huey = MemoryHuey(immediate=True)
        ran = []

        @huey.task(retries=1)
        def job_task(schema_name, job_id):
            with run_job(schema_name, job_id):
                ran.append(True)

        job = _job(status=BackgroundJob.STATUS_FAILED)
        tasks_logger = logging.getLogger("tasks")
        tasks_logger.addHandler(caplog.handler)
        try:
            with caplog.at_level(logging.WARNING, logger="huey"):
                job_task(tenant.schema_name, job.pk)
        finally:
            tasks_logger.removeHandler(caplog.handler)

        records = [r for r in caplog.records if r.name in ("tasks", "huey")]
        assert ran == []
        assert [(r.name, r.levelname) for r in records] == [
            ("tasks", "WARNING"),
            ("huey", "WARNING"),
        ]
        assert records[0].getMessage() == (
            f"background_job.not_queued schema={tenant.schema_name} job={job.pk}"
        )
        assert "aborted, will not be retried" in records[1].getMessage()

    def test_a_job_that_finishes_after_all_is_done_without_the_sweeps_error(
        self, tenant
    ):
        from apps.notifications.jobs import run_job

        job = _job(status=BackgroundJob.STATUS_QUEUED)

        with run_job(tenant.schema_name, job.pk) as handle:
            BackgroundJob.objects.filter(pk=job.pk).update(
                status=BackgroundJob.STATUS_FAILED,
                error="worker lost — no heartbeat within timeout",
            )
            handle.result = {"sent": 3}

        job.refresh_from_db()
        assert job.status == BackgroundJob.STATUS_DONE
        assert job.error == ""
        assert job.result == {"sent": 3}

    def test_a_queued_job_runs(self, tenant):
        from apps.notifications.jobs import run_job

        job = _job(status=BackgroundJob.STATUS_QUEUED)

        with run_job(tenant.schema_name, job.pk) as handle:
            handle.result = {"sent": 1}

        job.refresh_from_db()
        assert job.status == BackgroundJob.STATUS_DONE
