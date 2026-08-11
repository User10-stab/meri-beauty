# Database backup & restore runbook — meristudio (production)

## Critical finding (2026-08-10) — read this first

The pre-existing cron job on the OVH VPS, `/home/ubuntu/db_backup_dailytrac/daily_backup.sh`
(runs daily at 17:00), backs up a database called **`old_app_backup`** —
a leftover, unrelated database. It has never backed up this app's real
database. **`meristudio` (this app's actual production database) had zero
automated backup coverage until this runbook's script was added.**

That old job has been left in place untouched (it may still matter for
whatever `old_app_backup`/`old_app_import`/`old_data_backup`/`terramad` are —
other databases present on the same Postgres instance, not investigated,
out of scope here). It backs up something unrelated to this app; it is not
a redundant safety net for `meristudio`.

## What's in place now

- **Script**: `/home/ubuntu/meristudio_backup.sh` on the VPS. Dumps the real
  `meristudio` database (`pg_dump --format=custom`, authenticated via
  `~/.pgpass`, never a password on the command line), writes to
  `/home/ubuntu/meristudio_backups/`, deletes anything older than 14 days.
- **Schedule**: cron, once daily at 03:00 UTC (`0 3 * * *`) — chosen
  deliberately over more frequent runs for now since there's effectively no
  real transactional data yet (see RPO below); revisit once real orders/
  payments start flowing.
- **Storage**: local disk on the VPS only, for now (explicit decision,
  2026-08-10) — **this is the main remaining gap**. A lost/wiped VPS loses
  every backup along with the live data. Off-site copying (OVH Object
  Storage or another provider) is the natural next step once a destination
  is chosen — see "Next steps" below.

## Verified restore drill (2026-08-10)

Performed for real against the live production database, not simulated:

1. Ran `meristudio_backup.sh` for real → produced a 141KB `.dump` file
   (10MB raw DB, `meristudio` is currently minimal test data: 2 users, 1
   salon, 0 orders/payments/invoices/appointments — this is a freshly
   deployed app, not yet carrying real customer transactions).
2. Restored that exact dump into a throwaway scratch database
   (`meristudio_restore_drill`) on the same Postgres instance —
   **`meristudio` itself was never touched, only ever read from**.
3. Verified restore correctness two ways, not just "no errors":
   - Row counts for every business-critical table (`User`, `Staff`,
     `Service`, `Product`, `ProductVariant`, `Order`, `Payment`, `Invoice`,
     `Transaction`, `Appointment`, `Salon`) matched exactly between
     original and restored.
   - MD5 checksum of the full serialized `User` and `Salon` table contents
     matched exactly between original and restored (byte-for-byte proof,
     not just row counts agreeing by coincidence).
4. Timed: restore of the current (10MB) database took **~1 second**. Will
   grow with data volume but should stay well under a minute for a long
   time at this app's scale.
5. Cleaned up: dropped the scratch database, removed the temporary
   `.pgpass` entry used for the drill, confirmed `meristudio`'s own data
   checksum was unchanged before vs. after the entire drill.

## RPO / RTO

- **RPO (Recovery Point Objective): up to 24 hours** — the gap between
  backups at the current once-daily schedule. Explicit tradeoff accepted
  2026-08-10 given there's no real transactional data yet. **Once real
  orders/payments start flowing, revisit this** — losing up to a day of
  real Stripe-linked orders/invoices is a real business cost; a 6-hourly or
  hourly schedule is trivial to switch to (the dump takes ~1 second and is
  a few MB — cost is negligible, this is purely a schedule-line change).
- **RTO (Recovery Time Objective): restore itself is seconds** at current
  data volume. The realistic bottleneck in an actual incident is
  operational (noticing the outage, deciding to restore, redeploying the
  app pointed at the restored data), not the `pg_restore` command itself.

## How to actually restore in a real disaster

```bash
# 1. Stop the app so nothing writes to the DB mid-restore.
#    (however this app's process manager is run — pm2/systemd/etc.)

# 2. Pick the backup to restore from:
ls -la /home/ubuntu/meristudio_backups/*.dump

# 3. Rename the broken DB rather than dropping it outright (keeps a copy
#    to investigate/recover further data from if the restore itself needs
#    a second attempt):
sudo -u postgres psql -c "ALTER DATABASE meristudio RENAME TO meristudio_broken_$(date +%Y%m%d);"
sudo -u postgres createdb -O meri meristudio

# 4. Restore the chosen dump:
pg_restore -h localhost -U meri -d meristudio --no-owner --no-acl \
  /home/ubuntu/meristudio_backups/meristudio_<TIMESTAMP>.dump

# 5. Verify before bringing the app back — at minimum, row counts on
#    Order/Payment/Invoice/Appointment/Transaction look sane and recent.

# 6. Restart the app.
```

## Next steps (not done in this pass)

- Off-site copy of backups (OVH Object Storage or another provider —
  needs the destination/credentials chosen first).
- Once real transactional volume exists: shorten the backup interval
  (6-hourly is a one-line cron change) and consider WAL archiving for true
  point-in-time recovery instead of only daily/6-hourly snapshots.
- Uploaded media (`public/uploads`) has no backup at all — separate, smaller
  task, deliberately out of scope for this pass.
- Investigate whether `old_app_backup`/`old_app_import`/`old_data_backup`/
  `terramad` databases on the same instance are still needed by anything,
  or are truly dead — not touched or judged here.
