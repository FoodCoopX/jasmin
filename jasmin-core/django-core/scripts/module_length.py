#!/usr/bin/env python
"""Shrink-only gate for the length of backend modules.

A module longer than ``LIMIT`` lines usually holds more than one concern and is
hard to review; the frontend holds its files to the same limit through ESLint's
``max-lines``. The modules that were already longer when the gate arrived are
pinned in ``module-length-baseline.txt`` at the length they had, and a pin only
goes down:

* a module over the limit without a pin fails — split it;
* a pinned module longer than its pin fails — it grew; split it;
* a pinned module shorter than its pin, or back under the limit, fails until
  ``freeze`` lowers or drops the pin, so the room it freed can't fill up again.

``freeze`` writes the register the first time and afterwards only lowers or
drops pins: it refuses while a module is over the limit unpinned or above its
pin.

Production code only: tests, migrations and ``conftest.py`` files don't count.

Usage
-----
    poetry run python scripts/module_length.py check    # CI gate
    poetry run python scripts/module_length.py freeze   # after shrinking a module
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTER = ROOT / "module-length-baseline.txt"
TARGETS = ["apps", "config", "core", "scripts"]
LIMIT = 1000


def _counted(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    return not (
        "migrations" in rel.parts
        or "tests" in rel.parts
        or path.name.startswith("test_")
        or path.name == "conftest.py"
    )


def measure() -> dict[str, int]:
    """Line count of every counted module, keyed by its path from ROOT."""
    lengths: dict[str, int] = {}
    for target in TARGETS:
        for path in sorted((ROOT / target).rglob("*.py")):
            if _counted(path):
                text = path.read_text(encoding="utf-8")
                lengths[path.relative_to(ROOT).as_posix()] = len(text.splitlines())
    return lengths


def read_register() -> dict[str, int]:
    pins: dict[str, int] = {}
    for line in REGISTER.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        path, _, length = line.rpartition(":")
        pins[path.strip()] = int(length)
    return pins


def write_register(pins: dict[str, int]) -> None:
    header = [
        f"# Backend modules longer than {LIMIT} lines, pinned at their length.",
        "# Managed by scripts/module_length.py; do not hand-edit. A pin only goes",
        "# down: split the module, then",
        "#     poetry run python scripts/module_length.py freeze",
        f"# {len(pins)} module(s).",
        "",
    ]
    body = [f"{path}: {pins[path]}" for path in sorted(pins)]
    REGISTER.write_text("\n".join(header + body) + "\n", encoding="utf-8")


def growth(lengths: dict[str, int], pins: dict[str, int]) -> list[str]:
    """Modules over the limit without a pin, or longer than their pin."""
    problems = []
    for path, length in sorted(lengths.items()):
        if length <= LIMIT:
            continue
        pin = pins.get(path)
        if pin is None:
            problems.append(f"{path}: {length} lines, over the {LIMIT}-line limit")
        elif length > pin:
            problems.append(f"{path}: {length} lines, longer than its pin of {pin}")
    return problems


def slack(lengths: dict[str, int], pins: dict[str, int]) -> list[str]:
    """Pins above what their module measures now."""
    stale = []
    for path, pin in sorted(pins.items()):
        length = lengths.get(path)
        if length is None:
            stale.append(f"{path}: pinned at {pin}, but the module is gone")
        elif length <= LIMIT:
            stale.append(f"{path}: pinned at {pin}, now {length} — under the limit")
        elif length < pin:
            stale.append(f"{path}: pinned at {pin}, now {length}")
    return stale


def cmd_check() -> int:
    if not REGISTER.exists():
        print(f"No register at {REGISTER.relative_to(ROOT)} — create it with freeze.")
        return 1
    lengths, pins = measure(), read_register()
    problems, stale = growth(lengths, pins), slack(lengths, pins)
    if problems:
        print("Modules over their allowed length:\n")
        print("\n".join(f"  {problem}" for problem in problems))
        print(
            "\nSplit them along their concerns; a pin is never raised and a new "
            "module never gets one."
        )
    if stale:
        print("\nPins above their module's length:\n")
        print("\n".join(f"  {entry}" for entry in stale))
        print("\nLower them:\n    poetry run python scripts/module_length.py freeze")
    if problems or stale:
        return 1
    print(f"module length: {len(pins)} pinned module(s), none over its pin.")
    return 0


def cmd_freeze() -> int:
    lengths = measure()
    if not REGISTER.exists():
        pins = {path: length for path, length in lengths.items() if length > LIMIT}
        write_register(pins)
        print(f"Wrote {REGISTER.name}: {len(pins)} module(s) pinned.")
        return 0
    pins = read_register()
    problems = growth(lengths, pins)
    if problems:
        print("Refusing to freeze — these would need a new or higher pin:\n")
        print("\n".join(f"  {problem}" for problem in problems))
        return 1
    lowered = {
        path: lengths[path]
        for path in pins
        if path in lengths and lengths[path] > LIMIT
    }
    write_register(lowered)
    print(f"Wrote {REGISTER.name}: {len(pins)} -> {len(lowered)} module(s) pinned.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["check", "freeze"])
    args = parser.parse_args()
    return cmd_check() if args.command == "check" else cmd_freeze()


if __name__ == "__main__":
    sys.exit(main())
