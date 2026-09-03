# Money-path e2e tests

These tests spend real (test-mode) money. They create Stripe charges, issue
real invoices and credit notes into the gapless numbering counters, and refund
by calling Stripe exactly the way Marie does from the dashboard.

They exist because nothing else covers that. `tests/critical/` greps the source
and mocks Stripe; `tests/integration/` proves row locks against a real database
but never drives a payment. So the three things most likely to lose money — a
real Checkout payment, a real manual refund, and the `charge.refunded` webhook
that reconciles them — have never been exercised together.

The question every scenario ends with is not "did the button work" but **"do
the books still balance"**.

## Running them

```bash
# 1. One terminal — Next PLUS the Stripe CLI listener. Not `npm run dev`.
npm run dev:stripe

# 2. Another terminal
npm run test:e2e:money
```

`npm run dev:stripe` is not optional. It starts `stripe listen`, captures the
signing secret and injects it into Next. Without it no webhook is ever
delivered, so nothing is fulfilled and no refund ever settles — every
settlement assertion simply times out.

Note that `playwright.money.config.mjs` sets `reuseExistingServer`, so a plain
`npm run dev` already running **will be adopted silently** and every test will
fail in that confusing way. The timeout message in `fixtures/db.mjs` says so.

## Before the first run

`EMAIL_PROVIDER` must be `mailpit` in `.env.local`. The suite refuses to start
otherwise, and that refusal is deliberate: these flows send cancellation and
refund e-mails, the dev database holds real customer addresses, and a sent
e-mail is the only thing here that cannot be undone.

## The guardrails

`fixtures/env-guard.mjs` aborts the whole run unless all of:

| Check | Why |
|---|---|
| `DATABASE_URL` is a `neon.tech` host | Production is self-hosted Postgres on OVH. Requiring Neon is a positive assertion of "this is dev", not just the absence of a production marker. |
| `STRIPE_SECRET_KEY` starts with `sk_test_` | Same rail `scripts/dev-with-stripe-webhooks.mjs` uses. |
| `NODE_ENV` is not `production` | Belt and braces. |
| `EMAIL_PROVIDER` is `mailpit` | See above. Waived for the purge script, which sends nothing. |

## Run ids

The Stripe test key and the dev database are both shared. Every row and every
Stripe object this suite creates is tagged with a run id
(`e2e-<timestamp>-<random>`), printed at the top of each run, and every
assertion filters on it — so a colleague's `charge.refunded` landing mid-test
is invisible rather than a flake.

This matters more than it looks. `checkout.session.*` is already protected by
the machine-scoped deployment stamp in `lib/stripe-deployment.js`, but
`charge.refunded` carries no stamp and never can: a refund made by hand in the
Stripe dashboard has none of our metadata on it.

## Cleaning up

```bash
node scripts/purge-e2e-money-data.mjs --run e2e-20260903-abc123          # dry run
node scripts/purge-e2e-money-data.mjs --run e2e-20260903-abc123 --apply
```

Never automatic, and never from an `afterAll`. A test that tidies up after
itself destroys exactly the evidence needed to work out why it failed.

**Invoices and credit notes are never deleted.** Their numbers are gapless by
law and removing one leaves a hole that has to be renumbered by hand. Test
documents stay, tagged.

## What the ledger assertions check

`fixtures/ledger.mjs#assertLedgerSound` runs at the end of every scenario:

1. Never refunded more than was collected.
2. **Per method** — never refunded more by card than was taken by card, and
   never *planned* to. This is the mixed-payment guard: a 21 € reservation
   settled 10,50 € online and 10,50 € in cash must ask Stripe for 10,50 €.
3. Legs total to their operation, which totals to its credit note.
4. Every `Transaction{REFUND}` traces to a `RefundLeg`.
5. `Payment.status` follows the arithmetic.
6. Cash rows carry a cash-book `pieceNumber`; online rows do not.

Plus `assertNumberingContiguous`, because this suite issues real credit notes
and must not leave a gap behind.

## Expect to re-run it sometimes

The checkout step is flaky here, and it is **not** the harness or the app.
Reaching Stripe from this machine is slow and erratic: the same unchanged test
has completed in ~15s, and has also sat on the Checkout page with no network
activity at all until it timed out. In one run the server action that creates
the Checkout Session took **46 seconds** on its own.

The timeouts are set generously for that (90s to reach Checkout, 120s to come
back). If a run still dies at the checkout step, re-run it — that failure
means "Stripe was unreachable or slow", not "the money logic is wrong".

Every stalled attempt observed so far left the booking at `PENDING_DEPOSIT`
with **zero transactions** — no charge, no half-fulfilled state, nothing to
clean up. That is worth knowing: a checkout that never completes is safe.

A failure at any step *after* checkout is a real signal and should be read,
not re-run.

## A known limitation

A **mixed-method refund is currently unreachable through the UI.**
`settleReservation` and `completeAppointment` both flip the item to
`COMPLETED` in the same transaction that records the solde, and
`authorizeRefund` denies `COMPLETED`. POS sales and boutique orders are
single-method. So `planRefund`'s multi-leg allocation only ever serves
historical reprise cases today — invariant 2 above guards it, but no scenario
can construct it through the browser.
