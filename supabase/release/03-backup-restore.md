# Backup and restore procedure — availability migration

Prepared for STEP 10A. **Not executed.** This document describes the restore
point required before applying
`supabase/migrations/202611230001_booking_availability.sql` to production.

Project: `ervdtrhnxltrqaacbfpe`. The database is small (see §2), but it holds
guest personal data, so every export below is gated on explicit owner approval.

## 1. What the migration changes

| Object | Change | Rows touched |
| --- | --- | --- |
| `public.booking_requests` | 2 `CHECK` constraints (`NOT VALID`), 1 GiST exclusion constraint, 1 trigger, 1 index | none |
| `public.blackout_dates` | 1 `CHECK` constraint (`NOT VALID`), 1 GiST exclusion constraint, 1 trigger, 1 index | none |
| `public` schema | 5 functions, `btree_gist` extension | none |
| Function privileges | `EXECUTE` revoked from `anon` and `authenticated`, granted to `service_role` | none |

The migration contains no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` or column
DDL. A correct release therefore leaves every row byte-identical. That is the
primary integrity assertion.

## 2. Data at risk (verified read-only on 2026-11-24)

| Table | Rows | Personal data |
| --- | --- | --- |
| `public.booking_requests` | 3 (all `declined`) | name, email, message, `ip_hash` |
| `public.blackout_dates` | 0 | none |
| `public.properties` | 2 (both active) | none public-facing |
| `public.property_photos` | 11 | none |

Only `booking_requests` and `blackout_dates` are structurally affected.
`properties` and `property_photos` are unchanged but are referenced by the
constraints; they are covered by any full backup.

## 3. Authorization and preconditions

Do not start unless all of the following are true:

1. The owner approved this release window.
2. **This project is on the Supabase Free plan: there are no automated backups
   and no PITR.** The restore point is the encrypted logical dump prepared in
   `05-free-plan-logical-backup.md`, taken with owner approval. Record the
   literal Database → Backups state anyway (plan, any listed backup, PITR
   value).
3. PITR is **not assumed**. If the dashboard does not explicitly show PITR as
   enabled with a restore window, treat the project as daily-backup only.
4. The owner explicitly approved exporting the two tables if the logical dump
   in §4.2 is used. Without that approval, rely on the dashboard backup only
   and skip §4.2.
5. Nobody else is writing bookings during the window (no pending confirmation
   in progress in the admin inbox).

## 4. Taking the restore point

### 4.1 Dashboard backup (paid plans only)

On the Free plan this section is unavailable: the dashboard exposes no backup
action and no PITR. Skip to `05-free-plan-logical-backup.md`.

1. Supabase Dashboard → project `ervdtrhnxltrqaacbfpe` → Database → Backups.
2. Confirm the newest completed backup and its timestamp; start a manual backup
   if the plan exposes that action.
3. Record in the release log: project ref, backup id/type, timestamp (UTC),
   and whether PITR is enabled (state the literal UI value).

This restore point covers the whole database and requires no PII handling.

### 4.2 Logical dump of the affected tables (only with approval)

**For this project use `05-free-plan-logical-backup.md`.** The
`supabase link` / `supabase db dump --linked` path below needs CLI access to
the project; the stored CLI account currently gets 403 on it. The alternative
in `05` uses the owner's session-pooler credentials and `pg_dump` 17.

The dump contains guest names, emails, messages and `ip_hash`.

```bash
# Requires a linked project and the database password (prompted, never echoed).
supabase link --project-ref ervdtrhnxltrqaacbfpe
supabase db dump --linked --data-only \
  -t public.booking_requests -t public.blackout_dates \
  -f staynaples-pre-availability-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Then, outside the repository:

```bash
sha256sum staynaples-pre-availability-*.sql > staynaples-pre-availability.sha256
# Encrypt before storing anywhere else, e.g.
age -p -o staynaples-pre-availability.sql.age staynaples-pre-availability.sql
```

Store the archive outside Git and outside the Vercel project. Delete the plain
dump once the release is accepted (keep the checksum). Never commit it, never
paste it into a ticket, never upload it to a public bucket.

If the Supabase CLI is unavailable, exporting the same two tables as CSV from
the SQL editor is acceptable — it has exactly the same PII constraints and the
same approval requirement.

### 4.3 Metadata snapshot (contains no personal data)

Run in the SQL editor and record the output verbatim in the release log:

```sql
-- Row counts
select 'booking_requests' as table_name, count(*) as rows
from public.booking_requests
union all
select 'blackout_dates', count(*)
from public.blackout_dates;

-- Content checksums (hashes only; no names, emails or messages are printed)
select
  coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text)), 'empty')
  as booking_requests_md5
from public.booking_requests t;

select
  coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text)), 'empty')
  as blackout_dates_md5
from public.blackout_dates t;

-- Status distribution
select status, count(*) from public.booking_requests group by status order by status;
```

Record also the SHA-256 of the migration file that will be applied:

```bash
sha256sum supabase/migrations/202611230001_booking_availability.sql
```

## 5. Integrity verification

### 5.1 Immediately after the migration (read-only)

1. `supabase/release/02-verify-after-migration.sql` must complete without
   raising. Expected summary: `5 | 0 | 2 | 2 | 2`.
2. Re-run the §4.3 row counts and both MD5 queries. **Both checksums and both
   row counts must be identical to the pre-migration snapshot.** A difference
   means the migration touched data: stop, do not deploy, investigate.
3. Compare the status distribution; no booking may have changed status.

### 5.2 Backup restorability

The dashboard backup is only useful if it can be restored. On the Free plan the
logical dump in `05-free-plan-logical-backup.md` is the only restore point, so
the isolated restore rehearsal there is **mandatory**, not optional.

## 6. Recovery procedures

### 6.1 Application-level rollback (objects only)

Used when the migration lands correctly but the feature must be withdrawn.

1. Revert the application deployment first: the new admin UI calls
   `confirm_booking_request` and `create_blackout`.
2. Run `supabase/migrations/rollback/202611230001_booking_availability.rollback.sql`.
3. Verify: zero of the five functions remain, zero of the five constraints,
   zero of the two triggers; `btree_gist` stays installed.
4. Re-run the §4.3 checksums; they must still match.

Rollback never restores data because it never changed data. A confirmation made
after the migration stays `confirmed` — that is business state, not schema
state. Reverse a wrong confirmation from the admin inbox (`Mark New`), not with
SQL.

### 6.2 Data restore (should never be needed)

Only if §5.1 shows changed rows, or if an operator error damages data during
the window.

1. Freeze writes: put the site in maintenance or stop the admin session; take a
   fresh backup of the damaged state for forensics.
2. Preferred: restore the affected table into a scratch table from the dump,
   compare row by row against production, then merge the missing/changed rows
   with explicit `UPDATE`/`INSERT` statements reviewed before execution.
3. `TRUNCATE` + `COPY` of a live table is destructive and requires a second,
   explicit owner approval naming the table and the restore timestamp.
4. After any restore, re-run the §4.3 counts/checksums and §5.1 verification,
   and confirm the exclusion constraints still hold.

### 6.3 Interpreting a failed release

| Symptom | Action |
| --- | --- |
| Migration aborts on a constraint | Nothing changed (single transaction). Run `01-preflight.sql`, fix the offending rows with owner approval, retry. |
| `02-verify` raises | Roll back objects, keep the code undeployed, fix forward. |
| Admin confirmation fails after deploy | Check `to_regprocedure('public.confirm_booking_request(uuid)')`; if null, the migration did not land — do not retry data changes. |
| Double booking suspected | Stop the admin UI, export current rows, compare with checksums, escalate before any restore. |

## 7. Explicit non-goals

- No backup, export or restore is executed by STEP 10A.
- No PITR capability is claimed; it must be read from the dashboard.
- No production SQL from this document is run without the §3 approvals.
