"""Friendly Captcha verification service — unit tests.

Covers the behaviours documented in the service module docstring: dormant
(flag off), missing token, FC ack, FC reject, and every way FC can't verify
(the fail-closed contract, which also emails the operator).
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
import requests
from django.test import override_settings

from apps.accounts.errors import CaptchaVerificationFailed
from apps.accounts.services import verify_captcha

_POST = "apps.accounts.services.friendly_captcha_service.requests.post"


@pytest.fixture(autouse=True)
def alert_operator():
    with patch(
        "apps.accounts.services.friendly_captcha_service.alert_operator"
    ) as mock_alert:
        yield mock_alert


# --------------------------------------------------------------------- #
# Flag off (default)                                                    #
# --------------------------------------------------------------------- #


@override_settings(FRIENDLY_CAPTCHA_ENABLED=False)
def test_disabled_is_noop_even_with_no_solution():
    """When the feature flag is off, the service must NEVER raise —
    we ship dormant and current callers don't send a token yet."""
    with patch(_POST) as mock_post:
        verify_captcha(None, scope="login")
        verify_captcha("", scope="login")
        verify_captcha("anything", scope="login")
    mock_post.assert_not_called()


# --------------------------------------------------------------------- #
# Flag on, common paths                                                 #
# --------------------------------------------------------------------- #


_FC_SETTINGS = {
    "FRIENDLY_CAPTCHA_ENABLED": True,
    "FRIENDLY_CAPTCHA_SITEKEY": "FCMSITEKEYTEST",
    "FRIENDLY_CAPTCHA_SECRET": "FCMAPIKEYTEST",
    "FRIENDLY_CAPTCHA_VERIFY_URL": "https://fc.test/api/v2/captcha/siteverify",
    "FRIENDLY_CAPTCHA_TIMEOUT_SECONDS": 2.0,
}


@override_settings(**_FC_SETTINGS)
def test_missing_solution_raises(alert_operator):
    """A flag-on endpoint that receives no token must reject."""
    with pytest.raises(CaptchaVerificationFailed):
        verify_captcha(None, scope="login")
    with pytest.raises(CaptchaVerificationFailed):
        verify_captcha("", scope="login")
    alert_operator.assert_not_called()


@override_settings(**_FC_SETTINGS)
def test_valid_solution_passes_silently(alert_operator):
    """FC says ``success: true`` -> verify_captcha returns None."""
    with patch(_POST) as mock_post:
        mock_post.return_value.status_code = 200
        mock_post.return_value.json.return_value = {
            "success": True,
            "data": {"event_id": "ev_test"},
        }
        verify_captcha("a-valid-token", scope="login")

    # The v2 siteverify contract: API key in a header, token + sitekey in
    # the JSON body.
    args, kwargs = mock_post.call_args
    assert args[0] == _FC_SETTINGS["FRIENDLY_CAPTCHA_VERIFY_URL"]
    assert kwargs["headers"] == {"X-API-Key": _FC_SETTINGS["FRIENDLY_CAPTCHA_SECRET"]}
    assert kwargs["json"] == {
        "response": "a-valid-token",
        "sitekey": _FC_SETTINGS["FRIENDLY_CAPTCHA_SITEKEY"],
    }
    assert kwargs["timeout"] == _FC_SETTINGS["FRIENDLY_CAPTCHA_TIMEOUT_SECONDS"]
    alert_operator.assert_not_called()


@pytest.mark.parametrize(
    "error_code", ["response_invalid", "response_timeout", "response_duplicate"]
)
@override_settings(**_FC_SETTINGS)
def test_rejected_solution_raises(alert_operator, error_code):
    """FC judged the token and said no: an invalid, expired or reused token is
    the client's problem, not an outage."""
    with patch(_POST) as mock_post:
        mock_post.return_value.status_code = 200
        mock_post.return_value.json.return_value = {
            "success": False,
            "error": {"error_code": error_code, "detail": "..."},
        }
        with pytest.raises(CaptchaVerificationFailed):
            verify_captcha("a-bad-token", scope="login")
    alert_operator.assert_not_called()


@override_settings(**_FC_SETTINGS)
def test_unparseable_answer_raises(alert_operator):
    with patch(_POST) as mock_post:
        mock_post.return_value.status_code = 200
        mock_post.return_value.json.side_effect = ValueError("not JSON")
        with pytest.raises(CaptchaVerificationFailed):
            verify_captcha("anything", scope="login")


# --------------------------------------------------------------------- #
# Fail-closed contract                                                  #
# --------------------------------------------------------------------- #


@override_settings(**_FC_SETTINGS)
def test_network_error_fails_closed(alert_operator):
    """If FC is unreachable the service raises, never silently passes.

    This is the contract guarantee the module docstring promises;
    keeping it as an explicit test prevents a well-meaning future
    change to "fail open on FC outage" from sliding in unnoticed.
    """
    with patch(_POST, side_effect=requests.Timeout("FC timed out")):
        with pytest.raises(CaptchaVerificationFailed):
            verify_captcha("anything", scope="login")
    alert_operator.assert_called_once()
    assert alert_operator.call_args.kwargs["throttle_key"] == "captcha.unverifiable"


@pytest.mark.parametrize(
    ("status", "error_code"),
    [(401, "auth_invalid"), (400, "sitekey_invalid"), (503, None)],
)
@override_settings(**_FC_SETTINGS)
def test_non_200_answer_fails_closed_and_alerts(alert_operator, status, error_code):
    """A wrong API key or sitekey, or an FC outage: no token can pass until
    an operator acts, so the operator hears about it."""
    with patch(_POST) as mock_post:
        mock_post.return_value.status_code = status
        if error_code is None:
            mock_post.return_value.json.side_effect = ValueError("not JSON")
        else:
            mock_post.return_value.json.return_value = {
                "success": False,
                "error": {"error_code": error_code, "detail": "..."},
            }
        with pytest.raises(CaptchaVerificationFailed):
            verify_captcha("anything", scope="login")
    alert_operator.assert_called_once()
    message = alert_operator.call_args.args[1]
    assert f"HTTP {status}" in message
    assert (error_code or "none") in message


# --------------------------------------------------------------------- #
# Operator misconfiguration                                             #
# --------------------------------------------------------------------- #


@override_settings(
    FRIENDLY_CAPTCHA_ENABLED=True,
    FRIENDLY_CAPTCHA_SITEKEY="",
    FRIENDLY_CAPTCHA_SECRET="",
    FRIENDLY_CAPTCHA_VERIFY_URL=_FC_SETTINGS["FRIENDLY_CAPTCHA_VERIFY_URL"],
    FRIENDLY_CAPTCHA_TIMEOUT_SECONDS=2.0,
)
def test_flag_on_but_creds_missing_fails_closed(alert_operator):
    """Operator turned the flag on without populating creds — fail
    closed so we don't silently accept every request, and say so."""
    with patch(_POST) as mock_post:
        with pytest.raises(CaptchaVerificationFailed):
            verify_captcha("anything", scope="login")
    mock_post.assert_not_called()
    alert_operator.assert_called_once()
