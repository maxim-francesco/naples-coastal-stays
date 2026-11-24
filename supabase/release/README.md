# Booking availability — production release package (STEP 06B)

Prepared locally. **Nothing in this package has been applied to production.**
No database write, deploy, DNS or storage change was performed.

## Artifacts

| File | Purpose |
| --- | --- |
| `supabase/migrations/202611230001_booking_availability.sql` | The migration to apply. Secured: `SECURITY DEFINER` + empty `search_path`, explicit revokes for `anon` and `authenticated`, verifies the ACL before finishing. |
| `supabase/migrations/rollback/202611230001_booking_availability.rollback.sql` | Reverts every object the migration adds. Leaves `btree_gist` installed. |
| `supabase/release/01-preflight.sql` | Read-only preflight gate. |
| `supabase/release/04-catalog-inventory.sql` | Read-only catalog inventory (PG version, extensions, constraint/trigger/policy/grant/function/index collisions, exact column types). Complements `01-preflight.sql`. |
| `supabase/release/02-verify-after-migration.sql` | Read-only post-migration verification; raises on any broken invariant. |
| `supabase/release/03-backup-restore.md` | Backup, integrity-verification and restore procedure. Prepared, not executed. |
| `supabase/release/05-free-plan-logical-backup.md` | Free-plan path: encrypted logical dump, integrity proof, isolated restore rehearsal. Prepared, not executed. |
| `scripts/verify-availability-release.sh` | Local rehearsal: preflight → migration → verification → real role checks → rollback → data integrity. |
| `tests/availability.privileges.postgres.test.ts` | 15 real-role tests (anon, authenticated, service_role). |
| `tests/availability.postgres.test.ts` | 10 constraint and concurrency tests. |

## 1. Backup requirements

Do not start without a restore point.

- The project is on the Supabase **Free** plan: no automated backups and no
  PITR. The restore point is the encrypted logical dump in
  `05-free-plan-logical-backup.md`, taken only after owner approval.
- Record project ref, plan, and the literal Database → Backups state.
- The migration only adds constraints, indexes, triggers and functions, and
  revokes function privileges. It does not alter columns and does not touch
  rows. A logical export of `booking_requests` and `blackout_dates` is still
  required as the cheapest recovery path.
- The exclusion constraints are built on the live tables. They take a
  `SHARE ROW EXCLUSIVE` lock; with the current row volume the lock is
  sub-second, but schedule a quiet window anyway.
- Note the current row counts from the preflight inventory so the post-release
  comparison is factual.
- Full procedure, checksums and restore paths: `supabase/release/03-backup-restore.md`.

## 2. Preflight (read-only)

Run `supabase/release/04-catalog-inventory.sql` and then
`supabase/release/01-preflight.sql` in the Supabase SQL editor, as two separate
queries (each file is self-contained and runs inside `begin read only` when it
declares so; paste the whole file, with no text selected).

- `04-catalog-inventory.sql` returns one grid: every row must be `PASS` or
  `INFO`; any `FAIL` stops the release. It covers what the row checks below do
  not: PostgreSQL version, extension/opclass visibility, existing constraints,
  triggers, RLS policies, grants and same-named function/index collisions.
- `01-preflight.sql` returns the data-integrity gate and an inventory set.

- Every row of the first result set must read `PASS`.
- Any `FAIL` stops the release. The most likely failures are overlapping
  confirmed bookings, invalid ranges, or `availability_objects_not_yet_installed`
  = 1 (which means the migration is already applied — verify instead of
  re-applying).
- Expected state observed on 2026-11-23: 3 booking requests, all `declined`;
  0 blackouts; 2 active properties; no overlaps, invalid ranges, orphans or
  duplicate constraints; RLS enabled on both tables.

The second result set is inventory only and contains no guest data.

## 3. Exact release order

1. Verify backup / PITR (section 1).
2. Run the preflight; all checks `PASS`.
3. Apply `supabase/migrations/202611230001_booking_availability.sql`.
4. Run `supabase/release/02-verify-after-migration.sql`. Expect
   `privileged_functions = 5`, `browser_role_grants = 0`,
   `availability_triggers = 2`, `exclusion_constraints = 2`,
   `supporting_indexes = 2`.
5. Run the read-only smoke tests (section 4).
6. Deploy the application code that uses the RPCs. The migration is
   deliberately applied first: the currently deployed site does not call the
   new functions, and the new code refuses to confirm anything if they are
   missing. This order can never double-book.
7. Run the write smoke test with owner approval (section 5).
8. Watch server logs and the admin calendar for 24 h.

## 4. Post-migration smoke tests (read-only)

All of these are safe to run in production because they must be refused or
return public data only.

1. **Browser role denial over REST.** With the anon key:
   `POST {SUPABASE_URL}/rest/v1/rpc/confirm_booking_request` body
   `{"p_booking_id":"<any uuid>"}` must return a non-2xx response with
   `code: 42501` (permission denied). It must never return `{"ok": true}`.
2. **Same through SQL.** In the SQL editor:
   `set role authenticated; select public.confirm_booking_request('<any uuid>');`
   must fail with `42501`. Repeat with `set role anon;`.
3. **Backend path works.** Through the deployed admin UI, open the calendar for
   both properties. It must load bookings and manual blocks with no console
   errors.
4. **Public calendar.** Open a property page; the availability calendar must
   render, past dates must be disabled, and no guest data may appear in the
   network payloads.
5. **Fail-closed check.** `select to_regprocedure('public.confirm_booking_request(uuid)')`
   must not be null. If it is null, confirmation is correctly refused by the
   app but the migration did not land — stop and investigate.

## 5. Write smoke test (requires explicit owner approval)

Only after the read-only checks pass, and only in a quiet window:

1. Pick a test property and a free future range at least 60 days out.
2. Create a manual block from the admin calendar for that range.
3. Confirm it appears in "Manual blocks" and on the public calendar.
4. Delete it and confirm the public calendar refreshes.
5. Confirm one real pending request only if the owner names it; verify the
   request shows `Confirmed` and the dates become unavailable publicly.

Every step above writes production data. Do not run it without the owner's
approval for that specific request.

## 6. Rollback

Rollback order matters: the new admin UI calls `confirm_booking_request` and
`create_blackout`. Revert the application code first, then run
`supabase/migrations/rollback/202611230001_booking_availability.rollback.sql`.
Dropping the functions while the new code is live makes every confirmation and
every block fail (fail-closed, no data corruption, but a broken admin UI).

The rollback drops the triggers, the five functions, the five constraints and
the two indexes. It does not modify rows and does not drop `btree_gist`. It was
rehearsed on a disposable PostgreSQL 17 container: after rollback, zero
availability objects remain and every row checksum is unchanged.

### Conditions requiring immediate rollback

- `02-verify-after-migration.sql` raises any exception.
- `browser_role_grants` is not `0`.
- Admin confirmation or blocking returns the "availability protection is not
  installed" message after the code deploy.
- The admin calendar fails to load availability after deploy.
- A legitimate confirmation is rejected as a conflict although the preflight
  showed no overlapping rows.
- Any evidence of double booking or of guest data reaching a browser payload.

Do **not** roll back for cosmetic issues, copy changes or unrelated UI
regressions; record them and fix them forward.

## 7. Local rehearsal

```bash
AVAILABILITY_TEST_PORT=55442 bash scripts/verify-availability-release.sh
AVAILABILITY_TEST_PORT=55441 bash scripts/run-availability-db-tests.sh
```

Both create and remove only their own disposable container. The rehearsal
mirrors the production shape (declined requests only, no blackouts) and proves
that the migration applies to existing data, that both browser roles are
denied, that `service_role` can confirm, and that the rollback restores the
prior state without touching rows.

## 8. Known limitations

- The three `CHECK` constraints are added `NOT VALID` on purpose so legacy rows
  cannot block the deploy; they still apply to every new insert and update.
  They can be validated later with `ALTER TABLE ... VALIDATE CONSTRAINT` once
  the preflight violations stay at zero.
- `booking_requests.property_id` is already `NOT NULL` in production, so the
  `booking_requests_confirmed_property_check` constraint is redundant there.
  It is kept so the schema stays correct in environments where the column is
  nullable.
- The advisory lock key is `hashtextextended('stay-naples-availability:' || id)`.
  Per-property serialization is correct; do not change the prefix without a
  migration that re-locks existing traffic.
- Supabase normally reloads the PostgREST schema cache automatically after a
  DDL change. If an RPC still answers `PGRST202` right after the migration,
  run `notify pgrst, 'reload schema';` and retry before assuming a failure.
