"""Friendly Captcha verification service.

Verifies a frontend-issued FC response token against Friendly Captcha's v2
siteverify API — the version the frontend's ``@friendlycaptcha/sdk`` widget
speaks. Used by the four anonymous auth endpoints (login, register send-code,
password-reset-request, password-reset-confirm) to block credential-stuffing,
reset-email-spam, and registration-spam before any business logic runs.

Behaviour matrix
----------------

================================  ============================  =====================================
``FRIENDLY_CAPTCHA_ENABLED``      Caller supplies a token?      Result
================================  ============================  =====================================
``False`` (default, dormant)      —                             No-op. Endpoint runs as before.
``True``                          missing / empty               Raises ``CaptchaVerificationFailed``.
``True``                          present, FC says ``success``  Returns silently.
``True``                          present, FC says NOT success  Raises ``CaptchaVerificationFailed``.
``True``                          present, FC can't verify      **Fail closed** — raises (see below).
================================  ============================  =====================================

FC answers HTTP 200 for every token it judged, with ``success: false`` for an
invalid, expired or reused one. Anything else — no answer, a non-200 answer
(a wrong API key or sitekey, or an FC outage), or credentials missing from the
settings — means no token can be verified.

Fail-closed in that case is deliberate. We treat FC's availability as part of
the auth-flow contract once the flag is on; falling back to "let everything
through" turns an outage into an open door for bots. Because it also locks out
every login, registration and password reset, the operator gets an email
(throttled to one per hour) so it doesn't wait for users to complain. If you'd
rather degrade differently, write the open-failure branch explicitly at the
call site — don't change this service.

A token is single-use: FC rejects a second verification of the same one, so
the frontend resets its widget after every submission.

Privacy
-------

We send only the token and our sitekey, with the API key in a header — never
the user-typed email or password.
"""

from __future__ import annotations

import logging
from typing import Any

import requests
from django.conf import settings

from apps.accounts.errors import CaptchaVerificationFailed
from apps.shared.ops_alerts import alert_operator

logger = logging.getLogger("authentication")


def verify_captcha(solution: str | None, *, scope: str) -> None:
    """Verify ``solution`` against the Friendly Captcha siteverify API.

    Parameters
    ----------
    solution:
        The response token the FC widget produced (its ``frc-captcha-response``
        value), which the frontend sends as ``frc_captcha_solution``. May be
        ``None`` or empty when the feature flag is off — the caller should not
        pre-validate this, the service handles it.
    scope:
        Free-form label for log lines (e.g. ``"login"``, ``"register"``,
        ``"password_reset_request"``). Lets ops correlate FC rejections
        to which endpoint was hit without inspecting URLs.

    Returns
    -------
    None on success. Raises ``CaptchaVerificationFailed`` on any
    failure path (missing token, FC says invalid, FC can't verify).
    """
    if not settings.FRIENDLY_CAPTCHA_ENABLED:
        return

    api_key = settings.FRIENDLY_CAPTCHA_SECRET
    sitekey = settings.FRIENDLY_CAPTCHA_SITEKEY
    if not api_key or not sitekey:
        # Misconfiguration — flag on but creds empty. This is an
        # operator mistake, not a client one. Fail closed so we don't
        # silently accept everything.
        logger.error(
            "captcha.misconfigured scope=%s reason=%s",
            scope,
            "FRIENDLY_CAPTCHA_ENABLED=True but sitekey/secret missing",
        )
        _alert_unverifiable(
            "FRIENDLY_CAPTCHA_ENABLED is on, but FRIENDLY_CAPTCHA_SITEKEY or "
            "FRIENDLY_CAPTCHA_SECRET is empty."
        )
        raise CaptchaVerificationFailed(
            "Captcha verification is misconfigured. Please contact support."
        )

    if not solution:
        logger.info("captcha.missing scope=%s", scope)
        raise CaptchaVerificationFailed("Captcha solution is required.")

    try:
        resp = requests.post(
            settings.FRIENDLY_CAPTCHA_VERIFY_URL,
            headers={"X-API-Key": api_key},
            json={"response": solution, "sitekey": sitekey},
            timeout=settings.FRIENDLY_CAPTCHA_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning(
            "captcha.unreachable scope=%s error=%s",
            scope,
            exc.__class__.__name__,
        )
        _alert_unverifiable(
            f"The Friendly Captcha API could not be reached "
            f"({exc.__class__.__name__})."
        )
        raise CaptchaVerificationFailed(
            "Captcha verification is temporarily unavailable. Please try again."
        ) from exc

    try:
        payload = resp.json()
    except ValueError:
        payload = None

    if resp.status_code != 200:
        code = _error_code(payload)
        logger.error(
            "captcha.bad_status scope=%s status=%s code=%s",
            scope,
            resp.status_code,
            code,
        )
        _alert_unverifiable(
            f"Friendly Captcha answered HTTP {resp.status_code} "
            f"(error code: {code or 'none'}). A 401 means the API key in "
            "FRIENDLY_CAPTCHA_SECRET is wrong, a 400 with sitekey_invalid the "
            "sitekey."
        )
        raise CaptchaVerificationFailed("Captcha could not be verified.")

    if not isinstance(payload, dict):
        logger.warning("captcha.bad_response scope=%s", scope)
        raise CaptchaVerificationFailed("Captcha could not be verified.")

    if not payload.get("success"):
        # An invalid, expired or reused token. Log FC's reason, but DO NOT
        # echo it to the client.
        logger.info("captcha.rejected scope=%s code=%s", scope, _error_code(payload))
        raise CaptchaVerificationFailed("Captcha verification failed.")


def _error_code(payload: Any) -> str | None:
    """FC's ``error.error_code`` from a siteverify answer, when it has one."""
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        return payload["error"].get("error_code")
    return None


def _alert_unverifiable(reason: str) -> None:
    alert_operator(
        "Friendly Captcha verification is failing",
        f"{reason}\n\nWhile FRIENDLY_CAPTCHA_ENABLED is on, every login, "
        "registration and password reset is refused until this is fixed. "
        "Further failures within the hour are only logged (captcha.*).",
        throttle_key="captcha.unverifiable",
        throttle_seconds=3600,
    )
