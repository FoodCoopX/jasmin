"""django-auditlog's middleware, with the actor and the address this deployment
records."""

from __future__ import annotations

import ipaddress

from auditlog.middleware import AuditlogMiddleware
from django.conf import settings
from django.utils.functional import SimpleLazyObject

from apps.shared.request_utils import client_ip


class JasminAuditlogMiddleware(AuditlogMiddleware):
    """The parent reads ``request.user`` when the request arrives, before DRF
    authenticates the JWT, so an API change would be logged without an actor.
    Here the actor is looked up when the log entry is written, by which time
    DRF has set ``request.user`` on the request.

    The address is the one ``client_ip`` trusts (the gateway's entry in
    ``X-Forwarded-For``, not the leftmost one the client controls), and it is
    left out unless it is an IP: the column is ``inet``, so anything else would
    fail the audited write.
    """

    @staticmethod
    def _get_actor(request):
        return SimpleLazyObject(lambda: AuditlogMiddleware._get_actor(request))

    @staticmethod
    def _get_remote_addr(request):
        if settings.AUDITLOG_DISABLE_REMOTE_ADDR:
            return None
        try:
            return str(ipaddress.ip_address(client_ip(request)))
        except ValueError:
            return None
