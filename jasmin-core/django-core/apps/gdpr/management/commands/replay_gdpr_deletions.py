"""Re-apply the GDPR erasures that a backup restore undid.

A restore brings back personal data erased after the backup was taken, and
rolls back the deletion log that recorded those erasures. The log is also kept
outside the database (``backups/backup.sh ledger`` writes
``/backups/gdpr-deletion-ledger.jsonl``); this command reads that copy and
erases every subject that has personal data again.

Usage, after the restore and before the app serves requests again:

    docker compose exec -T backup cat /backups/gdpr-deletion-ledger.jsonl \\
      | docker compose run --rm --no-deps -T -e SKIP_MIGRATIONS=0 \\
          huey manage replay_gdpr_deletions --ledger -
"""

from __future__ import annotations

import datetime
import hashlib
import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils.dateparse import parse_datetime
from django_tenants.utils import schema_context

from apps.gdpr.errors import RetentionPeriodActive
from apps.gdpr.models import DeletionLog
from apps.gdpr.services import GDPRService
from apps.gdpr.services.subjects import ANONYMIZED_EMAIL_SUFFIX, ErasureSubject
from apps.shared.tenants.models import Tenant

REPLAYED_DESCRIPTION = (
    "Re-applied after a backup restore, from the deletion ledger kept outside "
    "the database."
)


@dataclass(frozen=True)
class LedgerEntry:
    schema: str
    log_id: str
    deleted_at: datetime.datetime
    user_pk: str
    member_pk: str
    reseller_pk: str
    email_sha256: str

    @property
    def ref(self) -> str:
        keys = ("user_pk", "member_pk", "reseller_pk")
        named = [
            f"{key[:-3]}={getattr(self, key)}" for key in keys if getattr(self, key)
        ]
        return " ".join([f"log={self.log_id}", *named])


def read_ledger(lines) -> list[LedgerEntry]:
    """Parse the ledger's JSON lines. An entry can appear more than once (a
    later export adds keys to an old row); the last line wins."""
    by_key: dict[tuple[str, str], dict] = {}
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CommandError(f"Ledger line {number} is not JSON: {exc}") from None
        if not isinstance(row, dict) or not row.get("schema") or not row.get("id"):
            raise CommandError(f"Ledger line {number} has no schema or id.")
        merged = by_key.setdefault((row["schema"], row["id"]), {})
        merged.update(row)

    entries = []
    for (schema, log_id), row in sorted(by_key.items()):
        deleted_at = parse_datetime(str(row.get("deleted_at") or ""))
        if deleted_at is None:
            raise CommandError(f"Ledger entry {schema}/{log_id} has no deleted_at.")
        entries.append(
            LedgerEntry(
                schema=schema,
                log_id=log_id,
                deleted_at=deleted_at,
                user_pk=row.get("user_pk") or "",
                member_pk=row.get("member_pk") or "",
                reseller_pk=row.get("reseller_pk") or "",
                email_sha256=row.get("email_sha256") or "",
            )
        )
    return entries


def email_sha256(email: str) -> str:
    """The ledger's hash of an email: lower-cased and trimmed, as
    ``backup.sh`` computes it in SQL."""
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


class Command(BaseCommand):
    help = (
        "GDPR: after restoring a backup, re-apply the erasures the restore "
        "undid, from the deletion ledger kept outside the database."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--ledger",
            required=True,
            help=(
                "The deletion ledger written by `backups/backup.sh ledger`, or "
                "'-' to read it from stdin."
            ),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be re-applied and change nothing.",
        )

    def handle(self, *args, **options):
        dry_run: bool = options["dry_run"]
        entries = self._load(options["ledger"])
        tenant_schemas = set(
            Tenant.objects.exclude(schema_name="public").values_list(
                "schema_name", flat=True
            )
        )
        outcomes: Counter[str] = Counter()

        for schema in sorted({entry.schema for entry in entries}):
            schema_entries = [entry for entry in entries if entry.schema == schema]
            if schema not in tenant_schemas:
                # A tenant created after the backup: none of its data came back.
                outcomes["tenant_not_restored"] += len(schema_entries)
                continue
            with schema_context(schema):
                replay = _SchemaReplay(dry_run=dry_run)
                for entry in schema_entries:
                    outcome = replay.apply(entry)
                    outcomes[outcome] += 1
                    if outcome in ("replayed", "would_replay", "blocked"):
                        self.stdout.write(f"  [{schema}] {outcome}: {entry.ref}")
                outcomes["log_restored"] += replay.logs_written

        self._report(outcomes, total=len(entries), dry_run=dry_run)

    def _load(self, source: str) -> list[LedgerEntry]:
        if source == "-":
            return read_ledger(sys.stdin)
        path = Path(source)
        if not path.is_file():
            raise CommandError(f"No deletion ledger at {path}.")
        with path.open(encoding="utf-8") as ledger:
            return read_ledger(ledger)

    def _report(self, outcomes: Counter[str], *, total: int, dry_run: bool) -> None:
        labels = [
            ("would_replay", "would be erased again"),
            ("would_be_blocked", "would be blocked by a retention obligation"),
            ("replayed", "erased again"),
            ("blocked", "blocked by a retention obligation — erase them once it ends"),
            ("already_erased", "already erased"),
            ("subject_not_restored", "subject not in the restored data"),
            ("tenant_not_restored", "tenant not in the restored data"),
        ]
        lines = [
            f"{'Dry run: ' if dry_run else ''}{total} ledger entries.",
            *(f"  {outcomes[key]} {label}" for key, label in labels if outcomes[key]),
        ]
        if outcomes["log_restored"]:
            lines.append(f"  {outcomes['log_restored']} deletion-log rows written back")
        self.stdout.write(self.style.SUCCESS("\n".join(lines)))


class _SchemaReplay:
    """Replays the ledger entries of the tenant schema currently active."""

    def __init__(self, *, dry_run: bool) -> None:
        self.dry_run = dry_run
        self.logs_written = 0
        self._users_by_email_hash: dict[str, list] | None = None

    def apply(self, entry: LedgerEntry) -> str:
        # The restored database still has the row when the erasure predates
        # the backup.
        log_exists = DeletionLog.objects.filter(pk=entry.log_id).exists()
        subject = self._subject_of(entry)

        if subject is None or subject.is_erased:
            if not log_exists and not self.dry_run:
                self._write_back_log(entry)
            if subject is None and not log_exists:
                return "subject_not_restored"
            return "already_erased"

        if self.dry_run:
            if GDPRService.check_retention_blocks_for_subject(subject):
                return "would_be_blocked"
            return "would_replay"

        replayed_log = None if log_exists else self._log_row(entry)
        try:
            GDPRService.anonymize_subject(subject, replayed_log=replayed_log)
        except RetentionPeriodActive:
            # A restored obligation (open coop share, invoice, charge). Erasing
            # now would breach it; the ledger keeps the entry for a later run.
            return "blocked"
        if replayed_log is not None:
            self.logs_written += 1
        return "replayed"

    def _subject_of(self, entry: LedgerEntry) -> ErasureSubject | None:
        if entry.user_pk or entry.member_pk or entry.reseller_pk:
            return ErasureSubject.from_keys(
                user_pk=entry.user_pk,
                member_pk=entry.member_pk,
                reseller_pk=entry.reseller_pk,
            )
        if not entry.email_sha256:
            return None
        # An entry written before the log kept subject ids names its user only
        # by the email hash. Someone can sign up again with an erased address,
        # so only an account that existed at the time of the erasure matches.
        for user in self._users_with_email_hash(entry.email_sha256):
            if user.date_joined < entry.deleted_at:
                return ErasureSubject.of_user(user)
        return None

    def _users_with_email_hash(self, digest: str) -> list:
        if self._users_by_email_hash is None:
            self._users_by_email_hash = {}
            users = get_user_model().objects.exclude(
                email__endswith=ANONYMIZED_EMAIL_SUFFIX
            )
            for user in users.only("pk", "email", "date_joined"):
                if user.email:
                    self._users_by_email_hash.setdefault(
                        email_sha256(user.email), []
                    ).append(user)
        return self._users_by_email_hash.get(digest, [])

    @staticmethod
    def _log_row(entry: LedgerEntry) -> DeletionLog:
        return DeletionLog(
            id=entry.log_id,
            deleted_at=entry.deleted_at,
            user_pk=entry.user_pk,
            member_pk=entry.member_pk,
            reseller_pk=entry.reseller_pk,
            description=REPLAYED_DESCRIPTION,
        )

    def _write_back_log(self, entry: LedgerEntry) -> None:
        """Put the restored database's deletion log back in line with the
        ledger, so its own record of the erasure survives the next restore
        too."""
        row = self._log_row(entry)
        row.save(force_insert=True)
        DeletionLog.objects.filter(pk=row.pk).update(deleted_at=entry.deleted_at)
        self.logs_written += 1
