"""Hosts the backend must not call on a tenant's behalf.

A tenant admin can name hosts the backend then connects to — an SMTP relay
(``apps.shared.smtp_host_validator``), the HR system's addresses
(``apps.staff.services.hr_system``). Left unchecked, such a host could be an
internal / loopback / link-local address, letting a compromised admin account
probe internal reachability or reach a cloud metadata endpoint
(``169.254.169.254``) from the backend host (SSRF).

``resolves_to_internal_address(host)`` resolves a host and is True when ANY
resolved IP falls in a private / loopback / link-local / reserved / multicast /
unspecified range. A host that fails to resolve is not reported — it can't be
an SSRF target if it doesn't resolve, and the real connection surfaces the DNS
error.

Accepted residual: name resolution itself (``socket.getaddrinfo``) is not
time-bounded. An admin could save a host whose nameserver stalls and tie up a
worker for the OS resolver timeout. The admin-only permission gate keeps this
low-risk; bounding DNS would need a global ``setdefaulttimeout`` or a threaded
resolver, disproportionate here.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

_IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

_DEFAULT_PORTS = {"https": 443, "http": 80}


def address_origin(address: str | None) -> tuple[str, str, int] | None:
    """The server an address leads to: scheme, host and port, with the
    default port spelled out, so ``https://h/`` and ``https://h:443/`` are one
    server. None for a blank address."""
    if not address:
        return None
    parts = urlsplit(address.strip())
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    return scheme, host, parts.port or _DEFAULT_PORTS.get(scheme, 0)


def resolves_to_internal_address(host: str | None) -> bool:
    if not host:
        return False
    candidate = str(host).strip()
    # A bracketed IPv6 literal ("[::1]") — strip the brackets before parsing.
    if candidate.startswith("[") and candidate.endswith("]"):
        candidate = candidate[1:-1]
    if not candidate:
        return False

    try:
        resolved = _resolve_ips(candidate)
    except (socket.gaierror, UnicodeError, ValueError):
        return False
    return any(_is_internal_ip(ip) for ip in resolved)


def _is_internal_ip(ip: _IpAddress) -> bool:
    # An IPv4-mapped IPv6 address (``::ffff:127.0.0.1``) can slip past the
    # IPv6 predicates on some Python versions — unwrap and re-check the
    # embedded IPv4 address.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private  # RFC1918 (10/8, 172.16/12, 192.168/16) + IPv6 ULA
        or ip.is_loopback  # 127.0.0.0/8, ::1
        or ip.is_link_local  # 169.254.0.0/16 (incl. cloud metadata), fe80::/10
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified  # 0.0.0.0, ::
    )


def _resolve_ips(host: str) -> list[_IpAddress]:
    """Every IP *host* resolves to (a single-element list when it is already an
    IP literal). Raises ``socket.gaierror`` on DNS failure.

    Resolving via ``getaddrinfo`` also normalises sneaky IPv4 encodings
    (decimal ``2130706433``, octal, hex, short ``127.1``) to their canonical
    dotted-quad, so the resolved-IP check catches them.
    """
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass

    addresses: list[_IpAddress] = []
    # Resolve every A / AAAA record so a multi-record round-robin can't
    # sneak a single private address past the check.
    for info in socket.getaddrinfo(host, None):
        sockaddr = info[4]
        addresses.append(ipaddress.ip_address(sockaddr[0]))
    return addresses
