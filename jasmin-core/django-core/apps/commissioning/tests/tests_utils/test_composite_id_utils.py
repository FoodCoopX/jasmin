"""Tests for apps.commissioning.utils.composite_id_utils."""

from __future__ import annotations

import pytest

from apps.commissioning.errors import CompositeIdInvalid
from apps.commissioning.utils.composite_id_utils import (
    build_composite_id,
    compose_slot_id,
    parse_composite_id,
    parse_slot_id,
)

CODE = "stock.invalid_composite_id"


# ---------------------------------------------------------------------------
# parse_composite_id  (pure function — no DB needed)
# ---------------------------------------------------------------------------
class TestParseCompositeId:
    def test_valid_id(self):
        result = parse_composite_id("abc123_KG_M_store1_2024_10_3", code=CODE)
        assert result == {
            "share_article_id": "abc123",
            "unit": "KG",
            "size": "M",
            "storage_id": "store1",
            "year": 2024,
            "delivery_week": 10,
            "day_number": 3,
        }

    def test_none_values_parsed(self):
        result = parse_composite_id("abc123_KG_None_None_2024_10_3", code=CODE)
        assert result["size"] is None
        assert result["storage_id"] is None
        assert result["share_article_id"] == "abc123"

    def test_all_none_optional_fields(self):
        result = parse_composite_id("None_None_None_None_2026_1_0", code=CODE)
        assert result["share_article_id"] is None
        assert result["unit"] is None
        assert result["size"] is None
        assert result["storage_id"] is None
        assert result["year"] == 2026
        assert result["delivery_week"] == 1
        assert result["day_number"] == 0

    def test_too_few_parts_raises_invalid(self):
        with pytest.raises(CompositeIdInvalid, match="expected 7 parts"):
            parse_composite_id("abc_KG_M", code=CODE)

    def test_too_many_parts_raises_invalid(self):
        with pytest.raises(CompositeIdInvalid, match="expected 7 parts"):
            parse_composite_id("a_b_c_d_1_2_3_extra", code=CODE)

    def test_non_integer_year_raises_invalid(self):
        with pytest.raises(CompositeIdInvalid):
            parse_composite_id("abc_KG_M_store_notint_10_3", code=CODE)

    @pytest.mark.parametrize("composite_id", ["abc_KG_M", "abc_KG_M_store_notint_10_3"])
    def test_error_carries_the_given_code(self, composite_id):
        with pytest.raises(CompositeIdInvalid) as excinfo:
            parse_composite_id(composite_id, code="some.code")
        assert excinfo.value.code == "some.code"


# ---------------------------------------------------------------------------
# build_composite_id  (pure function — no DB needed)
# ---------------------------------------------------------------------------
class TestBuildCompositeId:
    def test_basic_build(self):
        result = build_composite_id("abc123", "KG", "M", "store1", 2024, 10, 3)
        assert result == "abc123_KG_M_store1_2024_10_3"

    def test_none_values_become_string_none(self):
        result = build_composite_id("abc", "KG", None, None, 2026, 1, 0)
        assert result == "abc_KG_None_None_2026_1_0"

    def test_roundtrip(self):
        """build → parse should reconstruct the original values."""
        original = {
            "share_article_id": "abc123",
            "unit": "KG",
            "size": "M",
            "storage_id": "store1",
            "year": 2024,
            "delivery_week": 10,
            "day_number": 3,
        }
        composite = build_composite_id(
            original["share_article_id"],
            original["unit"],
            original["size"],
            original["storage_id"],
            original["year"],
            original["delivery_week"],
            original["day_number"],
        )
        parsed = parse_composite_id(composite, code=CODE)
        assert parsed == original

    def test_roundtrip_with_nones(self):
        composite = build_composite_id("x", None, None, None, 2026, 52, 4)
        parsed = parse_composite_id(composite, code=CODE)
        assert parsed["share_article_id"] == "x"
        assert parsed["unit"] is None
        assert parsed["size"] is None
        assert parsed["storage_id"] is None
        assert parsed["year"] == 2026
        assert parsed["delivery_week"] == 52
        assert parsed["day_number"] == 4


# ---------------------------------------------------------------------------
# compose_slot_id / parse_slot_id  (pure functions — no DB needed)
# ---------------------------------------------------------------------------
SLOT_FIELDS = [
    ("year", int),
    ("delivery_week", int),
    ("share_article", str),
    ("unit", str),
    ("size", str),
]
SLOT_CODE = "share_content.invalid_pk"


class TestSlotId:
    def test_the_share_option_comes_last(self):
        assert (
            compose_slot_id(2026, 20, "abc", "KG", "M", share_option="HARVEST_SHARE")
            == "2026_20_abc_KG_M_HARVEST_SHARE"
        )

    def test_a_slot_of_every_option_has_none(self):
        assert compose_slot_id(2026, 20, "abc", "KG", "M") == "2026_20_abc_KG_M"

    def test_an_option_with_underscores_round_trips(self):
        """``HARVEST_SHARE_FRUIT`` holds two underscores of its own."""
        slot_id = compose_slot_id(
            2026, 20, "abc", "KG", "M", share_option="HARVEST_SHARE_FRUIT"
        )
        assert parse_slot_id(slot_id, fields=SLOT_FIELDS, code=SLOT_CODE) == {
            "year": 2026,
            "delivery_week": 20,
            "share_article": "abc",
            "unit": "KG",
            "size": "M",
            "share_option": "HARVEST_SHARE_FRUIT",
        }

    def test_an_id_without_the_option_names_every_option(self):
        parsed = parse_slot_id("2026_20_abc_KG_M", fields=SLOT_FIELDS, code=SLOT_CODE)
        assert parsed["size"] == "M"
        assert parsed["share_option"] is None

    @pytest.mark.parametrize(
        "slot_id",
        [
            "2026_20_abc_KG_M_NO_SUCH_OPTION",
            "2026_20_abc_KG",
            "x_20_abc_KG_M_HARVEST_SHARE",
            "",
            None,
        ],
    )
    def test_a_malformed_id_is_refused_with_the_given_code(self, slot_id):
        with pytest.raises(CompositeIdInvalid) as excinfo:
            parse_slot_id(slot_id, fields=SLOT_FIELDS, code=SLOT_CODE)
        assert excinfo.value.code == SLOT_CODE
