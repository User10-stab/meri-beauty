# Running meri-beauty locally

Next.js 15 (App Router) + Prisma/Postgres + NextAuth + Stripe. This is the setup for
running the site on your own machine for development — not the VPS deploy steps (see
`PROD_LAUNCH_STEPS.md` for that).

## 1. Prerequisites

- **Node.js 24.x** and **npm 12.x** (whatever version you have installed — this repo
  was last run on Node v24.18.0 / npm 12.0.1, no `engines` field pins a version, so
  anything reasonably recent should work).
- **A reachable Postgres database.** Two options:
  - **Option A — point at the real Neon dev DB.** A ready-to-use `.env` with the real
    Neon `DATABASE_URL` is backed up at `~/Desktop/env`. Copy it in
    (`cp ~/Desktop/env .env`) and you're pointed at the same DB the rest of the team
    uses in dev — no local Postgres install needed. This only works from a network that
    isn't blocking outbound port 5432.
  - **Option B — run Postgres locally.** If you want a fully local, disposable DB:
    ```bash
    # install Postgres (Ubuntu/Debian) if you don't have it
    sudo apt install postgresql
    sudo -u postgres psql -c "CREATE USER meri WITH PASSWORD 'yourpassword';"
    sudo -u postgres psql -c "CREATE DATABASE meribeauty OWNER meri;"
    ```
    Then set `DATABASE_URL="postgresql://meri:yourpassword@localhost:5432/meribeauty?schema=public"`
    in your `.env`.

## 2. Install dependencies

```bash
npm install
```

`postinstall` runs `prisma generate` automatically — no separate step needed.

## 3. Set up `.env`

The project already has a `.env` in the repo root (gitignored, so it never leaves your
machine) with all required keys. If you're starting fresh or it's missing, here's every
variable it needs and what it's for:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string — see step 1. |
| `AUTH_SECRET`, `AUTH_URL`, `NEXTAUTH_URL` | NextAuth session signing + base URL (`http://localhost:3000` locally). |
| `ADMIN_PASSWORD` | Used only by the seed script (step 4) to create the initial admin login. |
| `CRON_SECRET` | Bearer token for manually hitting `/api/cron` and `/api/cron/appointments`. Not required for the app to run — the in-process scheduler in `lib/background-jobs.js` runs regardless. Only needed if you want to call those routes yourself. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally — used for sitemap/canonical URLs. |
| `RESEND_API_KEY` | Transactional email (reminders, confirmations). Use a Resend test/dev key. |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Use **test-mode** (`sk_test_...`/`pk_test_...`) Stripe keys locally. For the webhook secret, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (Stripe CLI) — it prints a `whsec_...` secret to use here. |
| `MONDIAL_RELAY_*`, `NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID` | Shipping integration — use Mondial Relay's sandbox credentials for local dev. |
| `INSTA_API` | Instagram feed integration. |
| `SITE_ACCESS_PASSWORD` | Only relevant if you want to test the password gate locally. Leave **unset** for normal local dev — if set, `middleware.js` gates the entire site behind a password prompt. |

## 4. Set up the database schema + seed data

```bash
npx prisma migrate deploy   # applies all migrations in prisma/migrations/
npm run seed                # creates one admin user + one bare salon row
```

The seed script (`prisma/seed.mjs`) is idempotent — safe to re-run, it skips creating
the admin/salon if they already exist. It creates:
- Admin login: `admin@meribeauty.com`, password = whatever `ADMIN_PASSWORD` was set to
  in `.env` at the time you ran `npm run seed`.
- A `Salon` row named "Meri Beauty" with everything else (phone/email/address/socials)
  blank, and default Mon–Sat 9–18 hours (Sun closed) — you'll want to fill in real data
  through the dashboard once logged in.

If you're using Option A (`~/Desktop/env`, the shared Neon DB), the DB likely already
has real data in it — you probably don't need to seed again, just check
`npx prisma studio` first to see what's there.

## 5. Run the dev server

```bash
npm run dev
```

Open `http://localhost:3000`. Log into the admin dashboard with the seeded credentials
above (or whatever real admin account already exists if you're on the shared DB).

You should see this in the terminal on startup, confirming the in-process job scheduler
is running (order expiry + reminder emails, every 5 min):

```
[background-jobs] started, running every 5 min
```

## 6. Optional: Stripe webhooks locally

If you're testing checkout/payment flows, run this in a second terminal so Stripe
events reach your local server:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` in `.env` and restart
`npm run dev`.

## Other useful commands

| Command | What it does |
|---|---|
| `npm run build` | Production build. Note: this **requires a reachable database** — several pages (including `/sitemap.xml`) query the DB at build time, and the build will fail if the DB is unreachable. |
| `npm run start` | Runs the production build (`npm run build` first). |
| `npm run lint` | ESLint. |
| `npx prisma studio` | Visual DB browser — handy for checking/editing data without writing SQL. |
| `npx prisma migrate dev` | Create + apply a new migration during schema development (don't use `migrate deploy` for this — that's prod-only, no-drift). |

## Troubleshooting

- **`Can't reach database server at localhost:5432`** — your `DATABASE_URL` doesn't
  point at a running Postgres. Either start your local Postgres, or switch to the Neon
  `.env` from `~/Desktop/env` (make sure outbound 5432 isn't blocked on your network).
- **Build fails on `/sitemap.xml`** — same root cause, DB unreachable during build. This
  is also a real bug worth fixing (`app/sitemap.js` has no error handling around its
  Prisma calls) — see `docs/PROD_READINESS_CHECKLIST.md`.
- **Stuck behind a password gate you didn't expect** — check if `SITE_ACCESS_PASSWORD`
  is set in your `.env`; unset it for normal local dev.
