# Real-database concurrency tests

`tests/critical/security-contracts.test.js` proves the source code still
*contains* the right locking statements (`FOR UPDATE`, `STOCK_RACE`, etc.). It
never actually runs two concurrent requests against a real database, so it
can't prove the locking actually works. This directory does that.

## What's covered

- **Stock race** (`actions/boutique/orders.js#createOrderFromCart`): two
  simultaneous checkouts against the last unit of a variant's stock — exactly
  one must win.
- **Workshop capacity race**
  (`actions/workshops/create-workshop-reservation.js#createWorkshopReservation`):
  two simultaneous bookings against a session's last seat — exactly one must
  win.

Both call the real, unmodified server actions. Only the Next.js request
plumbing (`cookies()`, via `next/headers`) and true third parties (Stripe,
Resend) are mocked — the same boundary `CRITICAL_TESTING.md` already draws
for the unit-level suite. The database, the transaction, the `FOR UPDATE`
locks, and the race outcome are all real.

## One-time setup

1. In the [Neon console](https://console.neon.tech), open the `Meri_Beauty`
   project → **Branches** → **Create branch**. Name it something like
   `test-integration`. **Neon branches are copy-on-write — the new branch
   starts with a full copy of production data.** That's fine; every test in
   this suite creates its own uniquely-tagged rows and deletes exactly those
   rows in `afterAll`. Never write a test here that touches existing rows.
2. Copy the branch's connection string and put it in a new `.env.test.local`
   file at the repo root (already gitignored via `.env*`):
   ```
   TEST_DATABASE_URL="postgresql://...the branch's connection string..."
   ```
3. `npm run test:integration`

`tests/integration/setup.js` refuses to run if `TEST_DATABASE_URL` is
missing, or if it happens to equal the real `DATABASE_URL`.

## Why this isn't part of `npm test` / CI

It needs a secret (`TEST_DATABASE_URL`) that isn't configured in CI, and it's
slower (real network round-trips per lock). Run it locally before a release,
or wire `TEST_DATABASE_URL` into CI as a secret pointing at a
purpose-made branch if you want it gated on every push.
