from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.shared.audit_log import update_and_log


class WaitingListMixin(models.Model):
    """
    Mixin that adds waiting list functionality to models.
    """

    class WaitingListStatus(models.TextChoices):
        NOT_ON_LIST = "not_on_list", "Not on Waiting List"
        PENDING = "pending", "Pending - Waiting for Spot"
        SPOT_AVAILABLE = "spot_available", "Spot Available - Awaiting Confirmation"
        CONFIRMED = "confirmed", "Confirmed - Will Take Spot"
        DECLINED = "declined", "Declined - No Longer Interested"
        EXPIRED = "expired", "Expired - Did Not Respond"

    on_waiting_list = models.BooleanField(default=False)
    waiting_list_status = models.CharField(
        max_length=20,
        choices=WaitingListStatus.choices,
        default=WaitingListStatus.NOT_ON_LIST,
    )
    waiting_list_position = models.PositiveIntegerField(
        blank=True, null=True, editable=False
    )
    notification_sent_at = models.DateTimeField(blank=True, null=True)
    notification_expires_at = models.DateTimeField(blank=True, null=True)
    response_received_at = models.DateTimeField(blank=True, null=True)
    # Single-use magic-link token for the "a spot is available" email — the
    # member accepts/declines their offer WITHOUT logging in (mirrors the
    # invitation flow). Set when the offer is made; cleared on accept / decline /
    # expiry so a stale link can't be replayed.
    notification_token = models.UUIDField(
        blank=True, null=True, db_index=True, editable=False
    )

    class Meta:
        abstract = True

    def clean(self) -> None:
        super().clean()
        # The spot-available notification cannot expire, nor can a response
        # arrive, before the notification was sent. All three are DateTimeFields
        # so the comparison is direct. NULL-tolerant: each pair is only enforced
        # when both members are set. No DB CheckConstraint here — this is an
        # abstract mixin (its Meta.constraints would not propagate to concrete
        # subclasses).
        if (
            self.notification_sent_at is not None
            and self.notification_expires_at is not None
            and self.notification_expires_at < self.notification_sent_at
        ):
            raise ValidationError(
                {
                    "notification_expires_at": (
                        "Notification expiry must be on or after the date the "
                        "notification was sent."
                    )
                }
            )
        if (
            self.notification_sent_at is not None
            and self.response_received_at is not None
            and self.response_received_at < self.notification_sent_at
        ):
            raise ValidationError(
                {
                    "response_received_at": (
                        "Response date must be on or after the date the "
                        "notification was sent."
                    )
                }
            )

    def add_to_waiting_list(self) -> None:
        self.on_waiting_list = True
        self.waiting_list_status = self.WaitingListStatus.PENDING
        self.save()

    def notify_spot_available(self, expiry_days: int = 7) -> None:
        self.waiting_list_status = self.WaitingListStatus.SPOT_AVAILABLE
        self.notification_sent_at = timezone.now()
        self.notification_expires_at = timezone.now() + timedelta(days=expiry_days)
        # Fresh single-use token per offer — a re-offer invalidates any old link.
        self.notification_token = uuid.uuid4()
        self.save()

    def confirm_spot(self) -> None:
        self._write_waiting_list_answer(
            waiting_list_status=self.WaitingListStatus.CONFIRMED,
            response_received_at=timezone.now(),
            on_waiting_list=False,
            notification_token=None,  # link consumed
        )

    def decline_spot(self) -> None:
        self._write_waiting_list_answer(
            waiting_list_status=self.WaitingListStatus.DECLINED,
            response_received_at=timezone.now(),
            on_waiting_list=False,
            notification_token=None,  # link consumed
        )

    def mark_as_expired(self) -> None:
        self._write_waiting_list_answer(
            waiting_list_status=self.WaitingListStatus.EXPIRED,
            on_waiting_list=False,
            notification_token=None,  # link dead
        )

    def _write_waiting_list_answer(self, **values: Any) -> None:
        """Write the answer to an offer, or its expiry, with ``update()`` and an
        audit-log entry rather than a full save: the save validates the whole
        term, and an offer whose station day closed while it was open must
        still be accepted, declined or expired."""
        update_and_log([self], **values)
        for field, value in values.items():
            setattr(self, field, value)

    @property
    def is_awaiting_confirmation(self) -> bool:
        return self.waiting_list_status == self.WaitingListStatus.SPOT_AVAILABLE

    @property
    def has_expired_notification(self) -> bool:
        return (
            self.notification_expires_at is not None
            and timezone.now() > self.notification_expires_at
            and self.waiting_list_status == self.WaitingListStatus.SPOT_AVAILABLE
        )
