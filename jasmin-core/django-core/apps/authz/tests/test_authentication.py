"""Tests for `apps.authz.authentication.TenantBoundJWTAuthentication`.

This is the cross-tenant defense — a JWT minted on tenant A must be
rejected when presented to tenant B even if both tenants have a user
with the same id. Failures here would silently break tenant isolation.
"""

from __future__ import annotations

import datetime

import pytest
import time_machine
from django.db import DEFAULT_DB_ALIAS, connections
from rest_framework.test import APIRequestFactory
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.tokens import AccessToken

from apps.authz.authentication import TenantBoundJWTAuthentication
from apps.commissioning.tests.factories import JasminUserFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def auth():
    return TenantBoundJWTAuthentication()


@pytest.fixture
def rf():
    return APIRequestFactory()


def _bearer(rf, token: str):
    return rf.get("/", HTTP_AUTHORIZATION=f"Bearer {token}")


def _mint(user, *, tenant_id):
    """Mint an access token, optionally stamping a tenant_id claim."""
    token = AccessToken.for_user(user)
    if tenant_id is not None:
        token["tenant_id"] = tenant_id
    return str(token)


class TestTenantBinding:
    def test_token_with_matching_tenant_passes(self, tenant, rf, auth):
        u = JasminUserFactory()
        raw = _mint(u, tenant_id=tenant.schema_name)
        validated = auth.get_validated_token(raw)
        assert validated.get("tenant_id") == tenant.schema_name

    def test_token_without_tenant_claim_is_rejected(self, tenant, rf, auth):
        u = JasminUserFactory()
        raw = _mint(u, tenant_id=None)
        with pytest.raises(InvalidToken) as exc:
            auth.get_validated_token(raw)
        assert "tenant_id" in str(exc.value)

    def test_token_for_other_tenant_is_rejected(self, tenant, rf, auth):
        u = JasminUserFactory()
        raw = _mint(u, tenant_id="some-other-schema")
        with pytest.raises(InvalidToken) as exc:
            auth.get_validated_token(raw)
        assert "tenant" in str(exc.value).lower()

    def test_unresolvable_schema_fails_closed(self, tenant, rf, auth, monkeypatch):
        """When the connection schema is falsy (unresolved), the binding check
        must FAIL CLOSED — reject the token rather than silently skip the check
        (an ``if current_schema and ...`` guard would let a falsy schema
        through). Matches the refresh path, which also raises here."""
        u = JasminUserFactory()
        raw = _mint(u, tenant_id=tenant.schema_name)
        # Force an unresolvable (falsy) schema for the duration of the call.
        # On the database wrapper itself: ``django.db.connection`` is a proxy
        # whose own ``__dict__`` lacks the attribute, so pytest (9.2 on) would
        # undo the patch by deleting ``schema_name`` from the wrapper.
        monkeypatch.setattr(connections[DEFAULT_DB_ALIAS], "schema_name", "")
        with pytest.raises(InvalidToken) as exc:
            auth.get_validated_token(raw)
        assert "resolved" in str(exc.value).lower()

    def test_authenticate_full_flow_returns_user(self, tenant, rf, auth):
        u = JasminUserFactory()
        raw = _mint(u, tenant_id=tenant.schema_name)
        # Drive the full DRF entrypoint, not just `get_validated_token`.
        result = auth.authenticate(_bearer(rf, raw))
        assert result is not None
        user, validated = result
        assert user.id == u.id
        assert validated.get("tenant_id") == tenant.schema_name

    def test_authenticate_full_flow_rejects_cross_tenant(self, tenant, rf, auth):
        u = JasminUserFactory()
        raw = _mint(u, tenant_id="bogus")
        with pytest.raises(InvalidToken):
            auth.authenticate(_bearer(rf, raw))

    def test_no_authorization_header_returns_none(self, tenant, rf, auth):
        # DRF contract: no header → no authentication attempt (returns None).
        assert auth.authenticate(rf.get("/")) is None

    def test_garbage_token_raises(self, tenant, rf, auth):
        # `InvalidToken` is what simplejwt raises for malformed payloads — same
        # as the cross-tenant case above. Asserting the exact class catches
        # accidental broadening (e.g. swallowing the parse error and returning
        # None) that a bare `Exception` match would mask.
        with pytest.raises(InvalidToken):
            auth.authenticate(_bearer(rf, "not.a.real.jwt"))


class TestRevokedSessions:
    """A logout-all, password reset or deactivation stamps
    ``sessions_revoked_at``; an access token minted before it is refused, at
    the whole-second cut-off the refresh path uses. The clock stays frozen so
    the token can't fail on its own expiry instead."""

    MINTED = datetime.datetime(2026, 7, 13, 12, 0, 0, tzinfo=datetime.UTC)

    def test_a_token_minted_before_the_revoke_is_rejected(self, tenant, rf, auth):
        u = JasminUserFactory()
        with time_machine.travel(self.MINTED, tick=False) as traveller:
            raw = _mint(u, tenant_id=tenant.schema_name)
            traveller.shift(5)
            u.sessions_revoked_at = datetime.datetime.now(datetime.UTC)
            u.save(update_fields=["sessions_revoked_at"])
            with pytest.raises(InvalidToken):
                auth.authenticate(_bearer(rf, raw))

    def test_a_token_minted_in_the_revoke_second_still_works(self, tenant, rf, auth):
        u = JasminUserFactory()
        with time_machine.travel(self.MINTED, tick=False):
            u.sessions_revoked_at = datetime.datetime.now(datetime.UTC)
            u.save(update_fields=["sessions_revoked_at"])
            raw = _mint(u, tenant_id=tenant.schema_name)
            user, _validated = auth.authenticate(_bearer(rf, raw))
        assert user.id == u.id
