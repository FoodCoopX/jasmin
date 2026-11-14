"""SMTP host SSRF guard.

A tenant admin can point ``TenantEmailConfig.smtp_host`` at an
arbitrary host that the backend then opens an SMTP connection to (see
``apps.shared.tenants.email_service.EmailService``). Left unchecked, that
host could be an internal / loopback / link-local address — letting a
compromised admin account probe internal reachability or reach a cloud
metadata endpoint (``169.254.169.254``) from the backend host (SSRF).

``smtp_host_is_blocked(host)`` resolves a candidate host and returns True
when ANY resolved IP falls in a private / loopback / link-local / reserved
/ multicast / unspecified range (``apps.shared.outbound_hosts``). It is used
in two places:

  * write-time, in ``TenantEmailConfigSerializer.validate_smtp_host``, so
    the save is rejected with a clean field error before the host is
    persisted, and
  * send-time, in ``EmailService._get_connection`` — the authoritative
    guard that defends the live production send paths and any
    already-persisted config. (Re-checking at send time also narrows the
    validate-then-resolve-differently / DNS-rebinding window; the residual
    TOCTOU between this check and ``smtplib``'s own resolution can't be
    fully closed without pinning the IP, which would break TLS hostname
    verification — disproportionate for this surface.)

Empty / ``None`` hosts are never blocked: ``smtp_host`` is ``blank=True``,
and an unset host is no connection target — ``EmailService`` refuses to
send without one rather than fall back to the platform account.

The block is gated on ``settings.SMTP_ALLOW_PRIVATE_HOSTS`` (defaults to
``DEBUG``) so local development and tests — which legitimately send through
``localhost`` / MailHog on a private container IP — are unaffected, while
production (``DEBUG=False``) is strict. BYO-SMTP targets are therefore
restricted to public hosts in production; an operator running a legitimate
internal relay can opt back in with ``SMTP_ALLOW_PRIVATE_HOSTS=true``.

A host that fails to resolve is NOT reported as blocked — it can't be an
SSRF target if it doesn't resolve, and the real SMTP connection (with its
timeout) surfaces the DNS error. This avoids rejecting a legitimate public
host over a transient DNS hiccup.
"""

from __future__ import annotations

from django.conf import settings

from apps.shared.outbound_hosts import resolves_to_internal_address


def smtp_host_is_blocked(host) -> bool:
    """Return True when *host* must NOT be used as an SMTP target.

    Empty / ``None`` -> False (no target; nothing is sent). When
    ``settings.SMTP_ALLOW_PRIVATE_HOSTS`` is set -> always False
    (dev/test escape hatch). A host that resolves to at least one
    private/loopback/link-local/reserved/multicast/unspecified address
    -> True. An unresolvable host -> False (the real connection will fail).
    """
    if getattr(settings, "SMTP_ALLOW_PRIVATE_HOSTS", False):
        return False
    return resolves_to_internal_address(host)
