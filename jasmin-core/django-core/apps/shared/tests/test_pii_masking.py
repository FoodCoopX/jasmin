"""Unit tests for the shared PII masking helpers."""

from __future__ import annotations

import pytest
from auditlog.diff import get_mask_function

from apps.shared.pii_masking import (
    AUDIT_LOG_MASK,
    mask_account_holder,
    mask_for_audit_log,
    mask_iban,
)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("DE89370400440532013000", "DE •••• 3000"),
        ("DE89 3704 0044 0532 0130 00", "DE •••• 3000"),  # spaces ignored
        ("AT611904300234573201", "AT •••• 3201"),
        ("", ""),
        (None, ""),
        ("AB12", "••••"),  # too short to reveal a tail
    ],
)
def test_mask_iban(value, expected):
    assert mask_iban(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("Ada Lovelace", "A•• L•••••••"),
        ("Maria Muster", "M•••• M•••••"),
        ("X", "X"),  # single char keeps nothing to hide
        ("Acme GmbH & Co", "A••• G••• & C•"),
        ("", ""),
        (None, ""),
    ],
)
def test_mask_account_holder(value, expected):
    assert mask_account_holder(value) == expected


@pytest.mark.parametrize(
    "value",
    ["DE89370400440532013000", "x", "1985-03-14", "anna.muster@example.com"],
)
def test_mask_for_audit_log_keeps_nothing_of_a_value(value):
    assert mask_for_audit_log(value) == AUDIT_LOG_MASK


@pytest.mark.parametrize("empty", ["None", ""])
def test_mask_for_audit_log_leaves_an_empty_value_empty(empty):
    assert mask_for_audit_log(empty) == empty


def test_auditlog_masks_with_mask_for_audit_log():
    assert get_mask_function() is mask_for_audit_log
