"""Guard: a test changes settings through ``override_settings`` or through
pytest-django's ``settings`` fixture, never both.

The decorator undoes its change when the test function returns; the fixture
undoes its own at teardown, afterwards, by restoring the settings layer it was
stacked on — which is the decorator's. The decorator's value then stays for
every later test, so whatever runs after it sees, say, ``DEBUG=True``.
"""

from __future__ import annotations

import ast
from pathlib import Path

APPS = Path(__file__).resolve().parents[2]


def _decorated_with_override_settings(node: ast.FunctionDef) -> bool:
    for decorator in node.decorator_list:
        func = decorator.func if isinstance(decorator, ast.Call) else decorator
        name = getattr(func, "id", None) or getattr(func, "attr", None)
        if name == "override_settings":
            return True
    return False


def test_no_test_takes_both():
    offenders = []
    for path in sorted(APPS.rglob("test_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            if _decorated_with_override_settings(node) and "settings" in {
                arg.arg for arg in node.args.args
            }:
                offenders.append(f"{path.relative_to(APPS.parent)}:{node.lineno}")
    assert not offenders, (
        "Set the value on the ``settings`` fixture instead of decorating with "
        "``override_settings``:\n  " + "\n  ".join(offenders)
    )
