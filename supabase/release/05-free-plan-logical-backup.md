# Free-plan logical backup — encrypted, verified, rehearsed

Prepared for STEP 10C. **Not executed.** Nothing below may run until the owner
approves the export of personal data (see §7).

Project: `ervdtrhnxltrqaacbfpe` — PostgreSQL 17.6, Supabase **Free** plan.

## 1. Why this document exists

The Free plan provides **no automated database backups and no PITR**. The
Supabase dashboard offers no "create backup" action on this plan. Therefore the
only restore point before the availability migration is a **logical dump that
we take ourselves**.

Record in the release log, read literally from Dashboard → Database → Backups:
plan name, any backup listed (id, type, UTC time), and the PITR value. If a
backup is listed after all, use it **in addition** to this procedure, not
instead of it.

## 2. Scope

- Full `public` schema, custom format: all six tables, indexes, constraints,
  triggers, functions, RLS policies, grants for the app objects.
- Supabase-managed schemas (`auth`, `storage`, `extensions`, …) are **not**
  part of the app restore point and are not dumped or restored manually.
- The migration is DDL-only and touches no rows, so the dump is used only if
  §6.1 of `03-backup-restore.md` shows changed data or an operator error
  damages rows during the window.

## 3. Preconditions and approvals

Do not start unless all are true:

1. Owner approved this release window and the export of personal data
   (`guest_name`, `email`, `message`, `ip_hash`).
2. Owner named the storage location, outside the repository, Vercel and any
   public bucket.
3. Owner is the passphrase custodian (password manager). The passphrase is
   never stored next to the backup and never written into any file in this
   repository.
4. Quiet window: no admin confirmation in progress. `pg_dump` takes a
   consistent snapshot, but the metadata snapshot in §5 must describe the same
   state; if a booking arrives in between, redo both.
5. The commands run from Git Bash. No `psql`/`pg_dump` is installed locally, so
   everything runs in the official `postgres:17-alpine` image (matches the 17.6
   server major version).

## 4. Connection (official owner credentials, never exposed)

1. Dashboard → Connect → **Session pooler** (port `5432`, host
   `aws-0-<region>.pooler.supabase.com`, user `postgres.<project-ref>`).
   The transaction pooler on port `6543` does **not** support `pg_dump`.
   The direct connection may be IPv6-only and is not required.
2. Keep the database password out of the command line, shell history and this
   repository. Use a temporary `PGPASSFILE`:

```bash
export BACKUP_DIR="$HOME/StayNaplesBackups/$(date -u +%Y%m%dT%H%M%SZ)"
export PGPASS_DIR="$(mktemp -d)"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR" "$PGPASS_DIR"

# Write the line below with an editor (LF endings), not with echo, then:
#   host:5432:postgres:postgres.<project-ref>:<database-password>
chmod 600 "$PGPASS_DIR/.pgpass"
```

3. Dump (fill in the session-pooler host and user only):

```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(cygpath -w "$BACKUP_DIR"):/backup" \
  -v "$(cygpath -w "$PGPASS_DIR"):/pgpass:ro" \
  -e PGPASSFILE=/pgpass/.pgpass \
  postgres:17-alpine \
  pg_dump -h <session-pooler-host> -p 5432 -U postgres.<project-ref> \
          -d postgres --schema=public --format=custom \
          -f /backup/staynaples-pre-availability.dump
```

`MSYS_NO_PATHCONV=1` stops Git Bash from rewriting the container-side paths
(`/backup`, `/pgpass`); `cygpath -w` gives Docker the Windows host path. This
combination was rehearsed on this machine.

Expected: exit code 0, no password prompt (it comes from `PGPASSFILE`), a dump
of a few hundred KB. On Windows bind mounts libpq may refuse a `.pgpass` that
looks group/world-readable; if it prints that warning, use the fallback below
and delete the variable immediately.

```bash
read -rs -p "Database password: " DB_PASSWORD; echo
MSYS_NO_PATHCONV=1 docker run --rm -v "$(cygpath -w "$BACKUP_DIR"):/backup" \
  -e PGPASSWORD="$DB_PASSWORD" \
  postgres:17-alpine pg_dump -h <session-pooler-host> -p 5432 \
  -U postgres.<project-ref> -d postgres --schema=public --format=custom \
  -f /backup/staynaples-pre-availability.dump
unset DB_PASSWORD
```

Then delete the credential file:

```bash
rm -rf "$PGPASS_DIR"
```

## 5. Metadata snapshot (no personal data printed)

Run this in the SQL editor **immediately before** the dump and save the output
verbatim. It prints counts, status buckets and hashes only.

```sql
select 'booking_requests' as table_name, count(*) as rows
from public.booking_requests
union all
select 'blackout_dates', count(*) from public.blackout_dates
union all
select 'properties', count(*) from public.properties
union all
select 'property_photos', count(*) from public.property_photos;

select coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text)), 'empty')
       as booking_requests_md5
from public.booking_requests t;

select coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text)), 'empty')
       as blackout_dates_md5
from public.blackout_dates t;

select status, count(*) from public.booking_requests group by status order by status;
```

Expected pre-migration (2026-11-24): `3 / 0 / 2 / 11`, `declined = 3`.

## 6. Integrity, encryption, isolated restore

### 6.1 Integrity of the archive

```bash
cd "$BACKUP_DIR"
sha256sum staynaples-pre-availability.dump | tee staynaples-pre-availability.sha256
docker run --rm -v "$(cygpath -w "$BACKUP_DIR"):/backup" postgres:17-alpine \
  pg_restore --list /backup/staynaples-pre-availability.dump > restore-list.txt
wc -l restore-list.txt
```

`pg_restore --list` must succeed and the list must contain the six tables,
their indexes/constraints, the two RLS policies sets and the `public` schema
objects. Save `restore-list.txt` with the checksum files.

### 6.2 Encrypt, then prove the round trip

```bash
read -rs -p "Backup passphrase: " PASSPHRASE; echo
printf '%s' "$PASSPHRASE" | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in staynaples-pre-availability.dump \
  -out staynaples-pre-availability.dump.enc -pass stdin
unset PASSPHRASE
sha256sum staynaples-pre-availability.dump.enc | tee staynaples-pre-availability.dump.enc.sha256

# decrypt to a throwaway file and compare
read -rs -p "Passphrase again: " PASSPHRASE; echo
printf '%s' "$PASSPHRASE" | openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in staynaples-pre-availability.dump.enc -out roundtrip.dump -pass stdin
unset PASSPHRASE
sha256sum -c staynaples-pre-availability.sha256
cmp staynaples-pre-availability.dump roundtrip.dump && echo "ROUNDTRIP_OK"
rm -f roundtrip.dump
```

Only after `ROUNDTRIP_OK` and a successful `sha256sum -c`, remove the plaintext
dump (`rm -f staynaples-pre-availability.dump`) and keep the `.enc` plus both
checksum files. Git Bash may not have `shred`; record that deletion is
best-effort on SSD.

### 6.3 Restore rehearsal in an isolated database

Uses a disposable container only; no other container is touched. Run the
commands from the root of the release-candidate worktree, where
`scripts/availability-test-schema.sql` lives.

```bash
docker run -d --name stay-naples-freeplan-restore \
  -e POSTGRES_PASSWORD=local-restore-check \
  -p 127.0.0.1:55460:5432 postgres:17-alpine

# schema shape for the two affected tables (no policies, no Supabase roles)
docker exec -i stay-naples-freeplan-restore \
  psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < scripts/availability-test-schema.sql

# decrypt (same pattern as §6.2) to restore.dump, then data only:
docker cp restore.dump stay-naples-freeplan-restore:/tmp/restore.dump
# parent table first: the test schema already has the foreign keys
MSYS_NO_PATHCONV=1 docker exec stay-naples-freeplan-restore \
  pg_restore -U postgres --data-only --no-owner --no-privileges \
  -t properties -d postgres /tmp/restore.dump
MSYS_NO_PATHCONV=1 docker exec stay-naples-freeplan-restore \
  pg_restore -U postgres --data-only --no-owner --no-privileges \
  -t booking_requests -t blackout_dates -d postgres /tmp/restore.dump

# compare with §5 (counts and hashes must be identical)
docker exec -i stay-naples-freeplan-restore \
  psql -At -U postgres -d postgres <<'SQL'
select (select count(*) from public.booking_requests) || ' / '
     || (select count(*) from public.blackout_dates);
select coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text)), 'empty')
from public.booking_requests t;
select coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text)), 'empty')
from public.blackout_dates t;
SQL

docker rm -f stay-naples-freeplan-restore
rm -f restore.dump
```

The rehearsal proves that the encrypted archive decrypts, restores, and carries
the same rows. `-t` must be unqualified (`booking_requests`, not
`public.booking_requests`); a schema-qualified name matched nothing in the
local rehearsal. Restoring `properties` first is required because the test
schema already enforces the foreign keys.

This exact mechanics (dump → sha256 → AES-256 round trip → `pg_restore --list`
→ parent-first data restore → checksum compare) was rehearsed on this machine
with synthetic rows only: 39 TOC entries, checksums identical, no container
left behind. A full-schema restore into a Supabase-compatible local stack is
only needed if the owner wants to test the whole database, not just the
affected tables; do not restore into the running `rc-08` stack.

## 7. What is forbidden without a separate approval

- Exporting personal data before the owner approves §3.1.
- Storing the dump, the encrypted file or the passphrase inside the repository,
  the Vercel project, a public bucket, a ticket or a chat attachment.
- Restoring over production, or restoring more than the agreed scope.
- Running the migration while the dump or its checksum verification is
  incomplete.

## 8. After the release

Keep the encrypted archive and the checksums until the release is accepted and
for at least 30 days after. Delete the plaintext at the end of §6.2. Record in
the release log: dump timestamp (UTC), plaintext sha256, ciphertext sha256,
`restore-list.txt` line count, rehearsal result, and the §5 snapshot.
