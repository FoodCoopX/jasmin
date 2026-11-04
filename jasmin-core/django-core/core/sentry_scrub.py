"""PII scrubbing for the Sentry/GlitchTip error-monitoring pipeline.

``send_default_pii=False`` stops Sentry auto-attaching ``user.email`` / IP, but
NOT PII the application itself put into a log message or an exception. INFO/
WARNING log lines become breadcrumbs on the next ERROR event (and the event's
own message), which land in the monitoring store beyond the reach of the GDPR
erasure pipeline. These hooks scrub email-, IPv4- and IBAN-shaped substrings
from breadcrumbs (their message and data), the event's log entry (the
template, the formatted text and every string argument), its exception values
and its ``extra`` — defence-in-depth on top of logging stable PKs (not emails)
at the call sites. The secret token of a mailed link (an invitation, a password
reset, a waiting-list offer, a deletion confirmation) sits in the URL path, so
the same texts lose it too, and so do the request's URL and header values (the
Referer carries the page's address) and the transaction name (the raw path when
it resolves to no route), on error events and transactions alike. The request's query string goes whole: a media URL's
``st`` token travels there. The request headers that carry a secret of the
platform's own, which Sentry's filter of the standard ones (Authorization,
Cookie, …) doesn't know, are dropped.

Sentry's event shape is not a contract this code controls, so every hook skips
a part whose shape it does not recognise instead of raising: an exception in
``before_send`` would drop the whole event.
"""

from __future__ import annotations

import re

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_IPV4_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
# Country code, check digits, then the account part either compact or in the
# printed groups of four. Upper case only: an IBAN is written that way, and the
# mixed-case record IDs must stay readable in the events.
_IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b")

# The URL paths that carry a mailed link's token: the pages the link opens and
# the API calls they make. The prefix stays; ``/gdpr/confirm-deletion/`` matches
# its API path too, the invitation's ``accept/`` takes its token in the body, and
# a route pattern's ``{token}`` stays.
_SECRET_PATH_RE = re.compile(
    r"(/(?:set-password|gdpr/confirm-deletion|waiting-list-offer"
    r"|api/auth/invitations|api/commissioning/waiting_list_offers)/)"
    r"(?!accept/|\{)[^/?#\s]+"
)
_RESET_PASSWORD_PATH_RE = re.compile(r"(/reset-password/)[^/?#\s]+/[^/?#\s]+")

# Matched in lower case. The gateway drops X-Origin-Secret before proxying (the
# origin gate, nginx/render_config.sh), so this only matters should a location
# miss it.
_SECRET_HEADERS = frozenset({"x-origin-secret"})


def scrub_secret_paths(text):
    """Replace the token in a mailed link's URL path with ``<token>``.
    Non-strings pass through unchanged."""
    if not isinstance(text, str):
        return text
    text = _SECRET_PATH_RE.sub(r"\1<token>", text)
    return _RESET_PASSWORD_PATH_RE.sub(r"\1<token>", text)


def scrub_pii(text):
    """Replace email-, IPv4- and IBAN-shaped substrings and the token in a
    mailed link's URL path with placeholders. Non-strings pass through
    unchanged."""
    if not isinstance(text, str):
        return text
    text = scrub_secret_paths(text)
    text = _EMAIL_RE.sub("<email>", text)
    text = _IBAN_RE.sub("<iban>", text)
    return _IPV4_RE.sub("<ip>", text)


def _scrub_data(value):
    """``value`` with every string in it scrubbed, through dicts and lists.
    ``before_send`` gets the event serialized, so an object such as a request
    in a log record's extras arrives as its repr, path included."""
    if isinstance(value, str):
        return scrub_pii(value)
    if isinstance(value, dict):
        return {key: _scrub_data(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_scrub_data(item) for item in value]
    return value


def before_breadcrumb(crumb, _hint):
    """Sentry ``before_breadcrumb`` hook — scrub the breadcrumb message. Its
    data is scrubbed in ``before_send``, once serialized, so the breadcrumbs of
    an event that is never sent cost nothing."""
    if crumb.get("message"):
        crumb["message"] = scrub_pii(crumb["message"])
    return crumb


def _scrub_logentry(logentry) -> None:
    if not isinstance(logentry, dict):
        return
    for key in ("message", "formatted"):
        if logentry.get(key):
            logentry[key] = scrub_pii(logentry[key])
    params = logentry.get("params")
    if isinstance(params, list | tuple):
        logentry["params"] = [scrub_pii(param) for param in params]
    elif isinstance(params, dict):
        logentry["params"] = {name: scrub_pii(param) for name, param in params.items()}


def _entries(container) -> list:
    """The ``values`` list of a Sentry interface that may arrive either as
    ``{"values": [...]}`` or as the bare list."""
    entries = container.get("values") if isinstance(container, dict) else container
    return entries if isinstance(entries, list) else []


def _scrub_request(request) -> None:
    """Drop the secret headers and the query string, and the token in the URL
    and in the other header values."""
    if not isinstance(request, dict):
        return
    if "url" in request:
        request["url"] = scrub_secret_paths(request["url"])
    request.pop("query_string", None)
    headers = request.get("headers")
    if isinstance(headers, dict):
        request["headers"] = {
            name: scrub_secret_paths(value)
            for name, value in headers.items()
            if not (isinstance(name, str) and name.lower() in _SECRET_HEADERS)
        }


def _scrub_request_and_transaction(event) -> None:
    _scrub_request(event.get("request"))
    if event.get("transaction"):
        event["transaction"] = scrub_secret_paths(event["transaction"])


def _scrub_crumb(crumb) -> None:
    if not isinstance(crumb, dict):
        return
    if crumb.get("message"):
        crumb["message"] = scrub_pii(crumb["message"])
    if isinstance(crumb.get("data"), dict):
        crumb["data"] = _scrub_data(crumb["data"])


def before_send(event, _hint):
    """Sentry ``before_send`` hook — scrub the event's log entry, its exception
    values, its ``extra``, any breadcrumbs already attached to it, its request
    and its transaction name."""
    _scrub_request_and_transaction(event)
    _scrub_logentry(event.get("logentry"))
    for exception in _entries(event.get("exception")):
        if isinstance(exception, dict) and exception.get("value"):
            exception["value"] = scrub_pii(exception["value"])
    if isinstance(event.get("extra"), dict):
        event["extra"] = _scrub_data(event["extra"])
    for crumb in _entries(event.get("breadcrumbs")):
        _scrub_crumb(crumb)
    return event


def before_send_transaction(event, _hint):
    """Sentry ``before_send_transaction`` hook — ``before_send`` skips
    transactions, which carry the request and the transaction name too."""
    _scrub_request_and_transaction(event)
    return event
