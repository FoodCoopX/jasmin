from django.apps import AppConfig



class AccountConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    verbose_name = "Accounts App"
    label = "jasmin_accounts"

    def ready(self) -> None:
        from auditlog.registry import auditlog
        from django.contrib.auth import get_user_model

        # Wire up signal handlers (e.g. an axes lockout -> the security log)
        from . import signals  # noqa: F401

        # Role grants, demotions and deactivations are the first thing an
        # auditor asks about, and the service layer's one event-log line about
        # each is no durable record: the log rotates, or in a container ages
        # out of the host's journal.
        #
        # ``password`` and ``last_login`` are EXCLUDED rather than masked — a
        # hash has no audit value, and a login timestamp would bury the role
        # changes in noise, as would ``updated_at`` on every save. The PII
        # columns are masked on the same bias as ``Member`` and
        # ``BillingProfile``: raw values must not land in diffs retained
        # indefinitely. What masking misses, erasure still reaches —
        # ``GDPRService._scrub_auditlog_entries`` takes the user directly.
        auditlog.register(
            get_user_model(),
            exclude_fields=["password", "last_login", "updated_at"],
            mask_fields=[
                "email",
                "username",
                "first_name",
                "last_name",
                "last_login_ip",
            ],
        )
