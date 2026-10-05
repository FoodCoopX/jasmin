"""``scripts/module_length.py``: which modules the backend size gate refuses,
and which pins it asks to lower."""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "module_length.py"
_spec = importlib.util.spec_from_file_location("module_length", SCRIPT)
assert _spec is not None and _spec.loader is not None
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

OVER = gate.LIMIT + 200


class TestGrowth:
    def test_a_long_module_without_a_pin_is_refused(self):
        assert gate.growth({"apps/new.py": gate.LIMIT + 1}, {}) == [
            f"apps/new.py: {gate.LIMIT + 1} lines, over the {gate.LIMIT}-line limit"
        ]

    def test_a_pinned_module_may_not_grow(self):
        problems = gate.growth({"apps/big.py": OVER + 1}, {"apps/big.py": OVER})

        assert problems == [
            f"apps/big.py: {OVER + 1} lines, longer than its pin of {OVER}"
        ]

    def test_modules_within_the_limit_or_their_pin_pass(self):
        lengths = {"apps/small.py": gate.LIMIT, "apps/big.py": OVER}

        assert gate.growth(lengths, {"apps/big.py": OVER}) == []


class TestSlack:
    def test_a_shrunk_module_asks_for_a_lower_pin(self):
        assert gate.slack({"apps/big.py": OVER - 50}, {"apps/big.py": OVER}) == [
            f"apps/big.py: pinned at {OVER}, now {OVER - 50}"
        ]

    def test_a_module_back_under_the_limit_drops_its_pin(self):
        stale = gate.slack({"apps/big.py": gate.LIMIT}, {"apps/big.py": OVER})

        assert stale == [
            f"apps/big.py: pinned at {OVER}, now {gate.LIMIT} — under the limit"
        ]

    def test_a_deleted_module_drops_its_pin(self):
        assert gate.slack({}, {"apps/big.py": OVER}) == [
            f"apps/big.py: pinned at {OVER}, but the module is gone"
        ]

    def test_a_module_at_its_pin_is_fine(self):
        assert gate.slack({"apps/big.py": OVER}, {"apps/big.py": OVER}) == []


def test_tests_and_migrations_are_not_measured():
    lengths = gate.measure()

    assert lengths
    assert not any(
        "/tests/" in path or "/migrations/" in path or path.endswith("conftest.py")
        for path in lengths
    )
