# Dashboard e2e tests

Real database, real login, **no money**.

This is the third Playwright suite, and it exists because neither of the other
two can host these tests:

| Suite | Viewport | Database | Stripe | Good for |
|---|---|---|---|---|
| `tests/e2e` | Pixel 5, 390px | none | none | public pages, mobile overflow, form wiring |
| `tests/e2e-dashboard` | Desktop 1440px | dev (Neon) | none | **permissions, dashboard workflows, admin screens** |
| `tests/e2e-money` | Desktop 1440px | dev (Neon) | real test-mode charges | payment, refund, `charge.refunded` settlement |

Asking "does a staff member without ORDERS get a 403 on this invoice?" does
not need to move a euro. Paying the money suite's cost and risk to ask it
would have meant the question quietly never got asked; running it in the safe
suite is impossible, because that one has no database and collapses the
dashboard tables at 390px.

## Running them

```bash
npm run test:e2e:dashboard
```

Plain `npm run dev` is enough — nothing here waits on a Stripe webhook. An
already-running `npm run dev:stripe` is adopted just as happily
(`reuseExistingServer`).

## The guardrails

The **same** `fixtures/env-guard.mjs` as the money suite, unchanged and
deliberately not weakened: Neon host, non-production `NODE_ENV`,
`EMAIL_PROVIDER=mailpit`, `sk_test_` key. This suite charges nothing, so the
Stripe rail is not load-bearing here — but it writes to a dev database holding
real customer rows, and several of the flows it drives send e-mail. One
definition of "safe to run against" beats a second, weaker one that drifts.

## What is seeded, and why it is seeded rather than borrowed

Every staff member is created with an **explicit** `dashboardPermissions`
array. The schema default grants seven permissions, so a seeded staff member
with the field omitted would silently hold `APPOINTMENTS`, `SERVICES`,
`CUSTOMERS`, `FORMATIONS`, `FORMATION_RESERVATIONS`, `WORKSHOP_RESERVATIONS`
and `NEWSLETTER` — and every "is this refused?" assertion would be testing the
wrong subject. `seedStaff` therefore refuses to default: pass `[]` for a staff
member with none.

Borrowing an existing dev staff row would be worse still: the test would
assert against whatever permissions that colleague happens to hold today.

### The one seeded invoice

The dev database holds 57 invoices and **not one is appointment-backed**, so
the branch that matters most — a staff member may read an appointment invoice
only when the appointment is theirs — cannot be exercised against existing
data.

That invoice is issued with a number **outside the legal series**
(`E2E-<run>-RDV`, not `2026-000058`). Allocating a real number to prove an
access check would consume one out of a gapless sequence that is a Belgian
legal requirement, and it would then have to stay forever, exactly as the
money suite's documents do. The route under test never parses the number.
This is also why, unlike the money suite's, this suite's purge script deletes
its invoice: nothing is preserved by keeping it.

The order invoice is *read* from real data rather than seeded — the ORDERS
branch needs no ownership relationship to be interesting, and seeding an Order
would mean inventing stock, variants and a cash session.

## Log in once per file, not per test

`actions/auth/login.js` rate-limits to **10 attempts per email+IP per 5
minutes**. A `beforeEach` that signs the same admin in for every test burns
through that within a couple of runs, and the symptom is not an error: the
login form simply stays put, so every test in the file fails at the sign-in
step and it reads like a broken application.

Sign in once in `beforeAll` on a shared page (see
`boutique-pickup-verification.spec.mjs`), or seed a distinct account per
persona (see `rbac-dashboard-routes.spec.mjs` — separate e-mails, separate
buckets).

## The till spec leaves a row behind, and cannot not

`caisse-till-session.spec.mjs` opens a till, closes it with a deliberate 5 €
surplus, and leaves that **closed session in the cash-book history**. There is
no un-closing a till, and the purge script does not touch cash sessions — a
closure is a bookkeeping act, not test residue to be swept up.

So each run adds one closed session at a 150 € float with a +5 € variance.
That is the cost of testing the reconciliation for real; if it ever becomes a
nuisance, the answer is a separate database, not a script that deletes
closures.

The spec refuses to start if a session it did not open is already open, for
the same reason.

## Cleaning up

```bash
node scripts/purge-e2e-dashboard-data.mjs --run e2e-20260905-abc123          # dry run
node scripts/purge-e2e-dashboard-data.mjs --run e2e-20260905-abc123 --apply
```

Never automatic, and never from an `afterAll`. A test that tidies up after
itself destroys exactly the evidence needed to work out why it failed.

## `boutique-order-expiry.spec.mjs` triggers the real cron

It calls `GET /api/cron`, which runs **all seven** jobs, because that endpoint
is the production trigger and it exercises the advisory lock and the heartbeat
on the way past. Before that was written, the blast radius against the dev
database was measured: zero stale orders, zero workshop reminders and zero
formation reminders were due. The spec seeds its own orders and asserts only
on those.

If that stops being true, the spec starts mutating a colleague's data as a
side effect — so when it fails oddly, re-measure rather than assume.

## Two things the route matrix deliberately does not assert

**Not the HTTP status of a refusal.** Admin-only pages are refused by two
independent layers — `auth.config.js#ADMIN_ONLY_ROUTES` (applied through
`proxy.js`) redirects 6 path prefixes before the page runs, and `requireAdmin()`
inside the page calls `notFound()`. Which one fires is incidental. Worse, a
page with a `loading.jsx` has already flushed its shell — and therefore its
`200` — by the time `notFound()` throws: `/dashboard/boutique/products/new`
answers **200 while rendering "Cette page n'existe pas"**. Asserting 404 there
fails a page that is refusing perfectly well. The suite asserts *refusal*: the
browser is not on the requested path, or the not-found body is on screen.

**Not that refusals are indistinguishable from missing invoices.** The invoice
PDF route answers 404 before it authorises, so a 403 does confirm an invoice
exists. Ids are cuids, so that is a narrow leak rather than an enumeration
hole — but writing a test that claimed otherwise would bake the wrong promise
into the suite.

## The returns scenario is the legally-mandated one

`boutique-returns-withdrawal.spec.mjs` covers the Belgian/EU 14-day right of
withdrawal — the requirement `PROJECT_REQUIREMENTS.md` §2 records as having
had to *correct* the client, since "no refunds after delivery" is illegal for
EU distance selling.

The distinction it exists for is the one a naive implementation flattens:
**the 14-day clock governs a change of mind and nothing else.** A defective or
wrong item is not rétractation and is not time-barred by it. One scenario
proves both halves against the same out-of-window order.

Two things to know before editing it:

- **It is rate limited, and being throttled looks like a broken feature.**
  The public endpoints allow 5 return requests per IP per 10 minutes; these
  three scenarios use four. A second run inside the window is skipped with an
  explanation rather than failed. See T1b in E2E_FINDINGS.md.
- **Its third scenario asserts a defect on purpose.** `completeReturnRequest`
  cannot refund a consumer, because it demands an invoice and only
  VAT-registered buyers get one (B6). The test pins that so it cannot be
  forgotten. When B6 is fixed the test must be **rewritten to follow the
  refund through**, not deleted — it carries a message saying so, keyed on
  the invoice appearing.
