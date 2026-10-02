from __future__ import annotations

import logging

from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import BasePermission
from rest_framework.request import Request

from .models import SuperAdmin

logger = logging.getLogger("super_admin")


class IsSuperAdmin(BasePermission):
    """
    Permission class to check if user is a super admin.
    Checks the is_super_admin flag in the JWT token payload.

    NOTE: DRF calls has_permission() multiple times per request (once per
    permission class, plus during schema introspection). We therefore log
    only DENIES, not grants — grants are implicit in the request log line.
    """

    def has_permission(self, request, view):
        # Check if user is authenticated
        if not request.user or not request.user.is_authenticated:
            logger.warning(
                "superadmin.permission.denied path=%s reason=not_authenticated",
                request.path,
            )
            return False

        # Check if user has super admin flag from JWT token
        if not getattr(request.user, "is_super_admin", False):
            logger.warning(
                "superadmin.permission.denied user=%s path=%s reason=not_superadmin",
                request.user.email,
                request.path,
            )
            return False

        return True


def super_admin_user(request: Request) -> SuperAdmin:
    """Return the super-admin behind an ``IsSuperAdmin``-gated endpoint.

    The stubs declare ``request.user`` as the tenant ``AUTH_USER_MODEL`` or
    ``AnonymousUser``. Behind ``SuperAdminJWTAuthentication`` it is the
    ``SuperAdmin`` row loaded from the public schema, and ``IsSuperAdmin`` has
    turned every other caller away before the view runs — a fact the declared
    union cannot express, so the ``isinstance`` check proves it instead. An
    endpoint moved off that authentication answers ``401`` rather than reading
    the wrong user.
    """
    user: object = request.user
    if not isinstance(user, SuperAdmin):
        raise NotAuthenticated
    return user
