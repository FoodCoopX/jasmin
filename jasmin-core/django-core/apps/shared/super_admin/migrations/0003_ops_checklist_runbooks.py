"""Correct the ops-checklist runbooks and add the missing rotations.

0002's seed only creates rows that don't exist yet, so the descriptions of
existing rows are rewritten here. Every command is run from the repo root on
the server.
"""

from django.db import migrations, models

RUNBOOKS = {
    "rotate_django_secret": (
        '"Run rotation" generates the new key and lists the steps. In short: '
        "move the current key to DJANGO_SECRET_KEY_FALLBACK in .env, set "
        "DJANGO_SECRET_KEY to the new one, then\n"
        "  docker compose up -d backend huey\n"
        "  docker compose restart gateway\n"
        "Every user and super-admin is logged out — the access and refresh "
        "tokens are signed with this key and the fallback doesn't cover them — "
        "so pick a quiet hour. Password-reset and protected-media links keep "
        "working through the fallback; remove DJANGO_SECRET_KEY_FALLBACK after "
        "24 hours and run the two commands again."
    ),
    "rotate_field_encryption": (
        "Every encrypted value (6 fields across 4 models, in the public schema "
        "and every tenant schema) is re-encrypted with the new key. In a quiet "
        "window:\n"
        "  1. Take a backup:\n"
        "       docker compose exec backup /usr/local/bin/backup.sh now\n"
        "  2. Generate the new key:\n"
        "       docker compose exec backend python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'\n"
        "     and PREPEND it in .env: FIELD_ENCRYPTION_KEY=<new>,<old>\n"
        "  3. docker compose up -d backend huey\n"
        "     docker compose restart gateway\n"
        "     New writes use the new key; old values still decrypt with the "
        "old one.\n"
        "  4. Re-encrypt every existing value:\n"
        "       docker compose exec backend python manage.py rotate_field_encryption --dry-run\n"
        "       docker compose exec backend python manage.py rotate_field_encryption\n"
        "  5. Once it finished cleanly, drop the old key "
        "(FIELD_ENCRYPTION_KEY=<new>) and repeat step 3.\n"
        "Keep the old key in the password manager: backups taken before step 4 "
        "hold values only it decrypts."
    ),
    "rotate_db_password": (
        '"Run rotation" generates the new password and lists the steps. In '
        "short: set it on the database role with psql's \\password in\n"
        '  docker compose exec postgres sh -c \'psql -U "$POSTGRES_USER" -d '
        '"$POSTGRES_DB"\'\n'
        "set POSTGRES_PASSWORD in .env, then\n"
        "  docker compose up -d backend huey backup\n"
        "  docker compose restart gateway\n"
        "and check that docker compose exec backup /usr/local/bin/backup.sh now "
        "still writes a backup."
    ),
    "rotate_bunny_token": (
        "Nothing on the server uses a Bunny credential, so .env stays as it "
        "is. In the Bunny dashboard, reset the account's API key, update any "
        "tool outside this platform that uses it, save it in the password "
        "manager and check that two-factor login is still on."
    ),
    "rotate_email_creds": (
        "Platform SMTP (EMAIL_HOST_USER / EMAIL_HOST_PASSWORD in .env): create "
        "new credentials at the provider, set them in .env, then\n"
        "  docker compose up -d backend huey\n"
        "  docker compose restart gateway\n"
        "  docker compose exec backend python manage.py sendtestemail <your address>\n"
        "and revoke the old credentials once the test mail arrived.\n"
        'Tenant SMTP: "Run rotation" clears every tenant\'s stored SMTP '
        "password. Each tenant admin re-enters it under Configuration → Email, "
        "and the tenant sends no email until they do — tell them first."
    ),
    "restore_drill": (
        "Export BACKUP_ENCRYPTION_KEY — paste it from the password manager, "
        "which also proves the stored copy is current — and run\n"
        "  ./scripts/restore_drill.sh\n"
        "It restores the newest backup into a throwaway database, compares "
        "row counts with production, dry-runs the GDPR erasure replay and "
        "unpacks the newest media archive, and writes its log to "
        "backups/restore-drills/. Mark this item done with the result and the "
        "log's file name in the notes. A failed drill is an incident: find the "
        "cause before you sign off."
    ),
    "postgres_security_upgrade": (
        "Check https://www.postgresql.org/support/security/ for a new Postgres "
        "15 advisory. If there is one, in a quiet window:\n"
        "  docker compose exec backup /usr/local/bin/backup.sh now\n"
        "  docker compose pull postgres\n"
        "  docker compose up -d postgres\n"
        "A plain restart would keep the old image. Afterwards check that "
        "backend and huey are healthy (docker compose ps) and a tenant page "
        "loads."
    ),
    "csp_audit": (
        "Look through the last quarter's CSP violation reports:\n"
        '  journalctl CONTAINER_NAME=jasmin-platform-backend-1 --since "90 days ago" | grep csp.violation\n'
        "Every legitimate external source should already be in the policy — "
        "nginx/security_headers.conf for the tenant hosts, "
        "nginx/security_headers_admin.conf for the admin host. Investigate "
        "anything else."
    ),
}

NEW_ITEMS = [
    # (kind, title, interval_days, description)
    (
        "rotate_redis_password",
        "Rotate Redis password",
        365,
        "REDIS_PASSWORD protects the cache and the Huey queue; it is part of "
        "every REDIS_URL.\n"
        "  1. Generate it — URL-safe, since it sits inside REDIS_URL — and "
        "save it in the password manager:\n"
        "       openssl rand -hex 32\n"
        "  2. Set REDIS_PASSWORD in .env.\n"
        "  3. docker compose up -d redis backend huey\n"
        "     (add glitchtip-web glitchtip-worker if they run)\n"
        "     docker compose restart gateway\n"
        "     Queued Huey tasks survive: Redis keeps them in its append-only "
        "file.\n"
        "  4. Check that redis, backend and huey are healthy "
        "(docker compose ps).",
    ),
    (
        "rotate_backup_encryption_key",
        "Rotate BACKUP_ENCRYPTION_KEY",
        730,
        "BACKUP_ENCRYPTION_KEY encrypts every database backup, media archive "
        "and the off-site copy of the GDPR deletion ledger. Backups are kept "
        "for years, monthly ones for good, so the old key has to stay in the "
        "password manager for as long as a backup made with it exists.\n"
        "  1. Generate the new key and save it next to the old one, both with "
        "the dates they were in use:\n"
        "       openssl rand -hex 32\n"
        "  2. Set BACKUP_ENCRYPTION_KEY in .env, then\n"
        "       docker compose up -d backup\n"
        "     Only the backup container uses it; it takes a backup with the "
        "new key when it starts.\n"
        "  3. Export the new key from the password manager and run "
        "./scripts/restore_drill.sh — it has to decrypt the new backup and "
        "media archive.\n"
        "The off-site copy of the GDPR deletion ledger keeps the old key until "
        "the next erasure changes the ledger.",
    ),
    (
        "rotate_offsite_backup_credentials",
        "Rotate off-site backup credentials",
        365,
        "The backup container copies every encrypted backup to the Hetzner "
        "Storage Box over SFTP with the key backups/storagebox_key (rclone "
        "config: backups/rclone.conf). The key can delete what is on the box "
        "too.\n"
        '  1. ssh-keygen -t ed25519 -f backups/storagebox_key.new -N "" '
        '-C "jasmin-backup"\n'
        "  2. Add the new public key to the box (asks for the Storage Box "
        "password):\n"
        "       ssh-copy-id -s -p23 -i backups/storagebox_key.new.pub "
        "<user>@<user>.your-storagebox.de\n"
        "  3. mv backups/storagebox_key.new backups/storagebox_key\n"
        "     mv backups/storagebox_key.new.pub backups/storagebox_key.pub\n"
        "  4. Check that rclone still gets in (RCLONE_REMOTE from .env):\n"
        "       docker compose run --rm --entrypoint rclone backup --config "
        "/backups/rclone.conf ls <RCLONE_REMOTE> | tail\n"
        "  5. Remove the old public key from the box's .ssh/authorized_keys "
        "(sftp -P 23 <user>@<user>.your-storagebox.de), reset the Storage Box "
        "password in Hetzner's console and save it in the password manager.",
    ),
    (
        "rotate_dns_api_token",
        "Rotate Linode DNS API token",
        365,
        "certbots/linode.ini holds the Linode API token certbot renews the "
        "wildcard certificate with (DNS-01). It can change the domain's DNS "
        "records, so it is scoped to Domains only.\n"
        "  1. Linode Cloud Manager → API Tokens → Create a Personal Access "
        "Token: Domains read/write, everything else none. Set an expiry and "
        "note the date.\n"
        "  2. Put it in certbots/linode.ini (dns_linode_key = <token>, keep "
        "dns_linode_version = 4 and chmod 600), then\n"
        "       docker compose restart certbot\n"
        "     The file is bind-mounted, so the running container only sees the "
        "new one after a restart.\n"
        "  3. Test a renewal against the staging CA (about two minutes):\n"
        "       docker compose exec certbot certbot renew --dry-run --dns-linode "
        "--dns-linode-credentials /linode.ini "
        "--dns-linode-propagation-seconds 120\n"
        "  4. Revoke the old token in Cloud Manager.",
    ),
]


def _update_runbooks(apps, schema_editor):
    OpsChecklistItem = apps.get_model("super_admin", "OpsChecklistItem")
    for kind, description in RUNBOOKS.items():
        OpsChecklistItem.objects.filter(kind=kind).update(description=description)
    for kind, title, interval, description in NEW_ITEMS:
        OpsChecklistItem.objects.get_or_create(
            kind=kind,
            defaults={
                "title": title,
                "interval_days": interval,
                "description": description,
            },
        )


def _remove_new_items(apps, schema_editor):
    # The rewritten descriptions stay: the texts they replaced were wrong.
    OpsChecklistItem = apps.get_model("super_admin", "OpsChecklistItem")
    OpsChecklistItem.objects.filter(
        kind__in=[kind for kind, _, _, _ in NEW_ITEMS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("super_admin", "0002_seed_ops_checklist"),
    ]

    operations = [
        migrations.AlterField(
            model_name="opschecklistitem",
            name="kind",
            field=models.CharField(
                choices=[
                    ("rotate_django_secret", "Rotate DJANGO_SECRET_KEY"),
                    ("rotate_field_encryption", "Rotate FIELD_ENCRYPTION_KEY"),
                    ("rotate_db_password", "Rotate Postgres password"),
                    ("rotate_bunny_token", "Rotate Bunny CDN API token"),
                    ("rotate_email_creds", "Rotate email-provider credentials"),
                    ("rotate_redis_password", "Rotate Redis password"),
                    ("rotate_backup_encryption_key", "Rotate BACKUP_ENCRYPTION_KEY"),
                    (
                        "rotate_offsite_backup_credentials",
                        "Rotate off-site backup credentials",
                    ),
                    ("rotate_dns_api_token", "Rotate Linode DNS API token"),
                    ("restore_drill", "Restore-from-backup drill"),
                    ("postgres_security_upgrade", "Postgres security upgrade"),
                    ("apt_upgrade", "OS apt upgrade"),
                    ("user_account_review", "Review super-admin + admin accounts"),
                    ("dependency_audit", "Manual dependency audit"),
                    ("penetration_test", "External penetration test"),
                    ("csp_audit", "CSP allowlist audit"),
                    ("custom", "Custom"),
                ],
                max_length=64,
            ),
        ),
        migrations.RunPython(_update_runbooks, _remove_new_items),
    ]
