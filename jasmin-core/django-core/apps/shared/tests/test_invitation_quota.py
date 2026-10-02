"""``resend_invitation`` draws on the ``USER_CREATION`` budget.

A resend sends another invitation email, so it consumes a ``USER_CREATION``
ledger row like the first invitation does; otherwise a compromised office
account could loop it as an uncapped email bomb.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from apps.authz.roles import Role
from apps.commissioning.models import UserInvitation
from apps.commissioning.models.choices import InvitationStatus
from apps.shared.invitations import create_user_with_invitation, resend_invitation
from apps.shared.tenants.errors import ActionRateLimitExceeded
from apps.shared.tenants.models import ActionRateLog, RateLimitedAction

pytestmark = pytest.mark.django_db

USER_CREATION = RateLimitedAction.USER_CREATION


def _ledger(tenant):
    return ActionRateLog.objects.filter(
        tenant_schema=tenant.schema_name, action=USER_CREATION
    )


@pytest.fixture
def invited_user(tenant):
    with patch("apps.shared.invitations._send_invitation_email"):
        user, _invitation = create_user_with_invitation(
            email="pending@example.com",
            first_name="Pat",
            last_name="Pending",
            roles=[Role.OFFICE],
            user_language="en",
        )
    return user


@pytest.fixture
def restore_overrides(tenant):
    # ``tenant`` is one object for the whole session.
    original = tenant.action_rate_limit_overrides
    yield
    tenant.action_rate_limit_overrides = original


def test_a_resend_draws_one_user_creation_row(tenant, user, invited_user):
    before = _ledger(tenant).count()

    with patch("apps.shared.invitations._send_invitation_email"):
        resend_invitation(user=invited_user, created_by=user)

    assert _ledger(tenant).count() == before + 1
    assert _ledger(tenant).latest("created_at").actor_id == str(user.pk)


def test_a_resend_over_the_cap_is_refused_before_anything_changes(
    tenant, user, invited_user, restore_overrides
):
    open_invitation = UserInvitation.objects.get(
        user=invited_user, status=InvitationStatus.SENT
    )
    # Cap the week at what is already used; the invitation itself drew a row,
    # so the cap is positive (a non-positive one falls back to the default).
    used = _ledger(tenant).count()
    assert used >= 1
    tenant.action_rate_limit_overrides = {str(USER_CREATION): {"weekly": used}}

    with patch("apps.shared.invitations._send_invitation_email") as send:
        with pytest.raises(ActionRateLimitExceeded):
            resend_invitation(user=invited_user, created_by=user)

    send.assert_not_called()
    open_invitation.refresh_from_db()
    assert open_invitation.status == InvitationStatus.SENT
