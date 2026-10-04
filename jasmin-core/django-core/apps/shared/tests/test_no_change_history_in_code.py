"""Guard: comments and test names carry no change history.

CLAUDE.md's comment rule — comments explain the code as it is, not how it got
there — is a review matter almost everywhere, because history narration is
ordinary prose. Two forms of it are mechanical enough to catch here: audit tags
(``CFG-1``, ``PERF-9``, a bracketed open-findings id) and a handful of phrases
that only ever narrate a change ("before the fix", "the finding", "used to
500"). A hit means: write the present-tense reason instead, and leave the
history to the commit message.

This is a tripwire, not a proof — most narration still gets past it.

Scanned: the backend (``apps``, ``core``, ``config``, ``scripts``; migrations
are frozen history and stay out), the frontend's ``src`` and ``scripts``, and
the ops files at the repo root. The frontend and ops halves skip, with a
reason, where those trees aren't checked out — the dev backend container
mounts only parts of react-core.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from pathlib import Path

import pytest

# This file lives at apps/shared/tests/<file>, so django-core is three up.
DJANGO_CORE = Path(__file__).resolve().parents[3]
REACT_CORE = DJANGO_CORE.parent / "react-core"
REPO = DJANGO_CORE.parent.parent

# An audit tag: a known audit-category prefix and a number, or a bracketed
# open-findings id such as ``[M12]``. Standard identifiers of the same shape —
# EN 16931's BR-CO-10 / BT-131, UTF-8, SHA-256 — use other prefixes.
_TAG = re.compile(
    r"\b(?:A11Y|BL|CFG|CORR|DOC|FIN|MOV|MT|OPS|PERF|SEC|SHR)-\d{1,3}[a-z]?\b"
    r"|\[[ADHLMPU]\d{1,3}[a-z]?\]"
)
# Phrases that narrate a change and have no present-tense reading.
_PHRASE = re.compile(
    r"\b(?:before|after|since) the fix\b"
    r"|\bthe finding\b"
    r"|\bclos(?:es|ed) audit\b"
    r"|\bused to (?:500|crash)\b"
    r"|\bpreviously,? we\b",
    re.IGNORECASE,
)

_SKIP_DIRS = {
    "__pycache__",
    "migrations",
    "node_modules",
    "generated",
    "dist",
    "coverage",
    "htmlcov",
    ".venv",
    "venv",
}
_CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"}
# Config and scripts only: ``.ini`` and ``.env*`` files hold credentials and are
# never read.
_OPS_SUFFIXES = {".yml", ".yaml", ".sh", ".conf", ".template", ".txt"}
_OPS_NAMES = {"Makefile", "Dockerfile"}


def _files(root: Path, suffixes: set[str], names: Iterable[str] = ()) -> Iterator[Path]:
    names = set(names)
    for path in sorted(root.rglob("*")):
        if _SKIP_DIRS.intersection(path.relative_to(root).parts):
            continue
        if path.name == Path(__file__).name or not path.is_file():
            continue
        if path.suffix in suffixes or path.name in names:
            yield path


def _offences(paths: Iterable[Path]) -> list[str]:
    offences = []
    for path in paths:
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = _TAG.search(line) or _PHRASE.search(line)
            if match:
                offences.append(
                    f"{path.relative_to(REPO)}:{lineno}: {match.group(0)!r} "
                    f"in {line.strip()[:120]}"
                )
    return offences


def _assert_clean(paths: Iterable[Path]) -> None:
    offences = _offences(paths)
    assert not offences, (
        "Change history in code — write the present-tense reason instead and "
        "leave the history to the commit message (CLAUDE.md, working "
        "agreements):\n  " + "\n  ".join(offences)
    )


def test_backend_code_carries_no_change_history():
    _assert_clean(
        path
        for top in ("apps", "core", "config", "scripts")
        for path in _files(DJANGO_CORE / top, _CODE_SUFFIXES | {".txt", ".html"})
    )


def test_frontend_code_carries_no_change_history():
    if not (REACT_CORE / "src" / "app").is_dir():
        pytest.skip("the frontend source isn't checked out here")
    _assert_clean(
        [
            *_files(REACT_CORE / "src", _CODE_SUFFIXES),
            *_files(REACT_CORE / "scripts", _CODE_SUFFIXES),
            *(
                path
                for path in REACT_CORE.iterdir()
                if path.is_file()
                and (
                    path.suffix in _CODE_SUFFIXES | {".conf"} or path.name in _OPS_NAMES
                )
            ),
        ]
    )


def test_ops_files_carry_no_change_history():
    if not (REPO / "docker-compose.yml").is_file():
        pytest.skip("the repo root isn't checked out here")
    _assert_clean(
        [
            *(REPO / name for name in ("Makefile", ".gitignore")),
            *REPO.glob("docker-compose*.yml"),
            *(DJANGO_CORE / name for name in ("Dockerfile", "docker_entrypoint.sh")),
            *(
                path
                for top in ("scripts", "backups", "nginx", "certbots", ".github")
                for path in _files(REPO / top, _OPS_SUFFIXES, _OPS_NAMES)
            ),
        ]
    )


@pytest.mark.parametrize(
    "line",
    [
        "# Nightly encrypted DB backup (closes audit CFG-1).",
        '  it("FIN-1: NetPrice BasisQuantity is 1", () => {',
        "/* A11Y-27: skip-to-main-content link */",
        '"""The case the finding describes: an ex-employee."""',
        "the case pre-check used to 500 on it",
        "# see [M12] in the audit",
    ],
)
def test_history_is_caught(line):
    assert _TAG.search(line) or _PHRASE.search(line)


@pytest.mark.parametrize(
    "line",
    [
        'it("NetPrice × BilledQty − Allowance == LineTotalAmount (BR-CO-10)", () => {',
        "# Pre-block used to display formatted JSON",
        'text = raw.decode("UTF-8")',
        "# The fix is always to wrap the access in a formatter.",
        "row = matrix[index]",
    ],
)
def test_present_tense_text_passes(line):
    assert not (_TAG.search(line) or _PHRASE.search(line))
