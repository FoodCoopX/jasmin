"""The Sentry/GlitchTip hooks scrub email/IP/IBAN substrings from breadcrumbs,
the event's log entry and its exception values, and request bodies are never
attached, so app-authored PII doesn't accumulate in the monitoring store
(beyond the reach of the Art. 17 erasure pipeline). The token of a mailed link
goes from those texts, from breadcrumb data and ``extra``, and from the
request's URL and header values on error events and transactions, for every URL
that takes one; the query string goes whole and frame locals are never sent."""

from __future__ import annotations

import pytest
from django.urls import get_resolver

from core.sentry_scrub import (
    before_breadcrumb,
    before_send,
    before_send_transaction,
    scrub_pii,
    scrub_secret_paths,
)

# The URL parameters reviewed as no secret; any other one must be scrubbed.
NON_SECRET_PARAMS = {
    "pk",
    "format",
    "slug",
    "path",
    "composite_id",
    "request_id",
    "user_id",
    "member_id",
    "reseller_id",
}


def _url_formats(resolver, prefix=""):
    """Every URL the resolver reverses, as a format string and its params."""
    for key in list(resolver.reverse_dict):
        for possibilities, *_ in resolver.reverse_dict.getlist(key):
            for url_format, params in possibilities:
                yield prefix + url_format, params
    for namespace_prefix, namespaced in resolver.namespace_dict.values():
        yield from _url_formats(namespaced, prefix + namespace_prefix)


class TestScrubPii:
    def test_scrubs_email(self):
        assert (
            scrub_pii("2fa.verified user=alice@example.com method=totp")
            == "2fa.verified user=<email> method=totp"
        )

    def test_scrubs_ipv4(self):
        assert scrub_pii("logout.success ip=203.0.113.42") == "logout.success ip=<ip>"

    def test_scrubs_both(self):
        assert scrub_pii("u=bob@x.co ip=10.0.0.1") == "u=<email> ip=<ip>"

    def test_non_string_passthrough(self):
        assert scrub_pii(None) is None
        assert scrub_pii(42) == 42

    def test_no_pii_unchanged(self):
        assert (
            scrub_pii("password_reset.request unknown")
            == "password_reset.request unknown"
        )


class TestBeforeBreadcrumb:
    def test_scrubs_breadcrumb_message(self):
        crumb = {"message": "login user=alice@example.com from 198.51.100.7"}
        assert before_breadcrumb(crumb, None)["message"] == (
            "login user=<email> from <ip>"
        )

    def test_no_message_key_passthrough(self):
        assert before_breadcrumb({"category": "x"}, None) == {"category": "x"}


class TestBeforeSend:
    def test_scrubs_logentry_and_breadcrumbs(self):
        event = {
            "logentry": {"message": "boom for carol@example.org"},
            "breadcrumbs": {"values": [{"message": "seen dave@example.net"}]},
        }
        out = before_send(event, None)
        assert out["logentry"]["message"] == "boom for <email>"
        assert out["breadcrumbs"]["values"][0]["message"] == "seen <email>"

    def test_breadcrumbs_as_bare_list(self):
        event = {"breadcrumbs": [{"message": "from ip 172.16.0.9"}]}
        assert before_send(event, None)["breadcrumbs"][0]["message"] == "from ip <ip>"

    def test_empty_event_passthrough(self):
        assert before_send({}, None) == {}

    def test_drops_the_origin_secret_header(self):
        event = {
            "request": {
                "headers": {
                    "x-origin-secret": "the-secret",
                    "X-Origin-Secret": "the-secret",
                    "Host": "farm.example.org",
                }
            }
        }
        assert before_send(event, None)["request"]["headers"] == {
            "Host": "farm.example.org"
        }

    def test_request_without_headers_passthrough(self):
        for event in [{"request": "not a dict"}, {"request": {"headers": ["x"]}}]:
            assert before_send(event, None) is event


class TestScrubIban:
    def test_scrubs_compact_iban(self):
        assert scrub_pii("iban=DE89370400440532013000 ok") == "iban=<iban> ok"

    def test_scrubs_spaced_iban(self):
        assert scrub_pii("iban DE89 3704 0044 0532 0130 00.") == "iban <iban>."

    def test_leaves_a_record_id_alone(self):
        assert scrub_pii("member=AB12cdEFgh34") == "member=AB12cdEFgh34"


class TestBeforeSendFormattedParamsAndExceptions:
    def test_scrubs_formatted_message(self):
        event = {
            "logentry": {
                "message": "tenant.create_failed ip=%s user=%s iban=%s",
                "formatted": (
                    "tenant.create_failed ip=203.0.113.42 user=eve@example.com "
                    "iban=DE89370400440532013000"
                ),
            }
        }
        out = before_send(event, None)
        assert out["logentry"]["formatted"] == (
            "tenant.create_failed ip=<ip> user=<email> iban=<iban>"
        )

    def test_scrubs_every_string_param(self):
        event = {
            "logentry": {
                "message": "%s %s %s %s",
                "params": [
                    "203.0.113.42",
                    "eve@example.com",
                    "DE89370400440532013000",
                    7,
                ],
            }
        }
        out = before_send(event, None)
        assert out["logentry"]["params"] == ["<ip>", "<email>", "<iban>", 7]

    def test_scrubs_named_params(self):
        event = {"logentry": {"params": {"who": "eve@example.com", "n": 3}}}
        out = before_send(event, None)
        assert out["logentry"]["params"] == {"who": "<email>", "n": 3}

    def test_scrubs_exception_values(self):
        event = {
            "exception": {
                "values": [
                    {"type": "ValueError", "value": "bad iban DE89370400440532013000"},
                    {"type": "KeyError", "value": "eve@example.com from 10.0.0.1"},
                ]
            }
        }
        out = before_send(event, None)
        values = out["exception"]["values"]
        assert values[0]["value"] == "bad iban <iban>"
        assert values[1]["value"] == "<email> from <ip>"
        assert values[0]["type"] == "ValueError"

    def test_survives_unexpected_shapes(self):
        odd_events = [
            {"logentry": "not a dict"},
            {"logentry": {"params": "a string", "formatted": None}},
            {"logentry": {"params": None}},
            {"exception": "not a dict"},
            {"exception": {"values": None}},
            {"exception": {"values": ["not a dict", {"value": None}, {}]}},
            {"exception": [{"value": "eve@example.com"}]},
            {"breadcrumbs": "not a list"},
            {"breadcrumbs": [{"data": "not a dict"}]},
            {"extra": "not a dict"},
        ]
        for event in odd_events:
            assert before_send(event, None) is event


class TestInitSentry:
    def test_never_attaches_request_bodies(self, monkeypatch):
        from core import sentry_setup

        captured: dict = {}
        monkeypatch.setattr(
            sentry_setup.sentry_sdk, "init", lambda **kwargs: captured.update(kwargs)
        )
        sentry_setup.init_sentry("https://key@example.invalid/1", debug=False)

        assert captured["max_request_body_size"] == "never"
        assert captured["send_default_pii"] is False
        assert captured["before_send"] is before_send
        assert captured["before_breadcrumb"] is before_breadcrumb
        assert captured["before_send_transaction"] is before_send_transaction
        assert captured["include_local_variables"] is False
        assert captured["environment"] == "production"


class TestScrubSecretPaths:
    @pytest.mark.parametrize(
        ("url", "scrubbed"),
        [
            ("/api/auth/invitations/tok3n/", "/api/auth/invitations/<token>/"),
            (
                "/api/commissioning/waiting_list_offers/tok3n/accept/",
                "/api/commissioning/waiting_list_offers/<token>/accept/",
            ),
            (
                "/api/gdpr/confirm-deletion/tok3n/",
                "/api/gdpr/confirm-deletion/<token>/",
            ),
            ("/waiting-list-offer/tok3n", "/waiting-list-offer/<token>"),
            (
                "https://farm.example.org/set-password/tok3n",
                "https://farm.example.org/set-password/<token>",
            ),
            (
                "https://farm.example.org/reset-password/MQ/tok3n",
                "https://farm.example.org/reset-password/<token>",
            ),
        ],
    )
    def test_blanks_the_token(self, url, scrubbed):
        assert scrub_secret_paths(url) == scrubbed

    def test_leaves_other_urls_alone(self):
        for url in [
            "/api/commissioning/resellers/ReSeLlEr0001/",
            "https://farm.example.org/login",
            None,
        ]:
            assert scrub_secret_paths(url) == url

    def test_leaves_the_invitation_accept_path_alone(self):
        assert (
            scrub_secret_paths("/api/auth/invitations/accept/")
            == "/api/auth/invitations/accept/"
        )

    def test_before_send_scrubs_the_request_and_the_log_line(self):
        event = {
            "transaction": "/api/gdpr/confirm-deletion/tok3n",
            "request": {
                "url": "https://farm.example.org/api/auth/invitations/tok3n/",
                "query_string": "st=signed-media-token",
                "headers": {
                    "Referer": "https://farm.example.org/waiting-list-offer/tok3n",
                    "User-Agent": "Firefox",
                },
            },
            "logentry": {
                "message": "Unhandled exception in %s: %s",
                "params": ["/api/auth/invitations/tok3n/", "boom"],
            },
        }
        out = before_send(event, None)
        assert out["transaction"] == "/api/gdpr/confirm-deletion/<token>"
        assert out["request"] == {
            "url": "https://farm.example.org/api/auth/invitations/<token>/",
            "headers": {
                "Referer": "https://farm.example.org/waiting-list-offer/<token>",
                "User-Agent": "Firefox",
            },
        }
        assert out["logentry"]["params"] == ["/api/auth/invitations/<token>/", "boom"]

    def test_before_send_scrubs_extra_and_breadcrumb_data(self):
        # Serialized, as before_send gets them: a logged request is its repr.
        event = {
            "extra": {
                "status_code": 400,
                "request": "<WSGIRequest: GET '/api/gdpr/confirm-deletion/tok3n/'>",
                "who": ["eve@example.org"],
            },
            "breadcrumbs": {
                "values": [
                    {"data": {"url": "/api/commissioning/waiting_list_offers/tok3n/"}}
                ]
            },
        }
        out = before_send(event, None)
        assert out["extra"] == {
            "status_code": 400,
            "request": "<WSGIRequest: GET '/api/gdpr/confirm-deletion/<token>/'>",
            "who": ["<email>"],
        }
        assert out["breadcrumbs"]["values"][0]["data"] == {
            "url": "/api/commissioning/waiting_list_offers/<token>/"
        }

    def test_before_send_transaction_scrubs_the_request_and_the_name(self):
        event = {
            "transaction": "/api/commissioning/waiting_list_offers/tok3n/",
            "request": {
                "url": "https://farm.example.org/api/auth/invitations/tok3n/",
                "query_string": "st=signed-media-token",
                "headers": {"Referer": "https://farm.example.org/set-password/tok3n"},
            },
        }
        out = before_send_transaction(event, None)
        assert out == {
            "transaction": "/api/commissioning/waiting_list_offers/<token>/",
            "request": {
                "url": "https://farm.example.org/api/auth/invitations/<token>/",
                "headers": {"Referer": "https://farm.example.org/set-password/<token>"},
            },
        }

    def test_keeps_a_route_pattern_name(self):
        event = {"transaction": "/api/auth/invitations/{token}/"}
        assert before_send_transaction(event, None)["transaction"] == (
            "/api/auth/invitations/{token}/"
        )

    def test_before_send_transaction_survives_unexpected_shapes(self):
        for event in [{}, {"request": "not a dict"}, {"transaction": None}]:
            assert before_send_transaction(event, None) is event

    @pytest.mark.parametrize("urlconf", ["config.tenant_urls", "config.public_urls"])
    def test_covers_every_url_that_takes_a_secret(self, urlconf):
        for url_format, params in _url_formats(get_resolver(urlconf)):
            secret_params = set(params) - NON_SECRET_PARAMS
            if not secret_params:
                continue
            url = "/" + url_format.lstrip("^") % {
                param: "s3cret" if param in secret_params else "1" for param in params
            }
            assert "s3cret" not in scrub_secret_paths(url), url_format
