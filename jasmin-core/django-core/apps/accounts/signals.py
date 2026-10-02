"""Signal handlers for security/audit events on the accounts app."""

from __future__ import annotations

import logging

from axes.signals import user_locked_out
from django.dispatch import receiver

from apps.shared.ops_alerts import alert_operator
from apps.shared.request_utils import client_ip

logger = logging.getLogger("axes")


@receiver(user_locked_out)
def on_user_locked_out(sender, request, username=None, ip_address=None, **kwargs):
    ip = ip_address or client_ip(request)
    logger.warning("account.locked user=%s ip=%s", username or "-", ip)
    alert_operator(
        "Account locked after failed logins",
        f"django-axes locked out {username or 'an unknown user'} from {ip} after "
        "repeated failed logins. Further lockouts within the hour are only "
        "logged (account.locked).",
        throttle_key="account.locked",
        throttle_seconds=3600,
    )
