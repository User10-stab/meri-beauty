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

## The rendez-vous scenario is the Connect one

`rendez-vous-connect-refund.spec.mjs` is the only scenario here that is **not**
charged on the platform account. A rendez-vous is a Stripe Connect *direct
charge* on the staff member's own connected account, which changes almost
every step: the Checkout Session is created with `{ stripeAccount }`, the
refund has to be issued on that account, and both
`checkout.session.completed` and `charge.refunded` arrive carrying
`event.account` that settlement must resolve back to the right staff member.

The atelier specs would all keep passing with that routing completely broken,
because they never produce an event that carries an account at all.

Two consequences worth knowing before editing it:

- It **cannot seed its own staff member.** `Staff.stripeAccountId` is
  `@unique`, so a second row cannot even borrow the existing account, and
  Express onboarding is an interactive Stripe flow. The spec finds the real
  onboarded staff member and books against them, changing nothing about their
  configuration. With `depositEnabled: false` that means a full online
  payment — a deposit variant would require mutating a shared row.
- It books by inserting the appointment rather than driving the public
  booking wizard. The funnel is UI; what is under test here is the money.

## The boutique scenario is the only one with stock

`boutique-order-online-refund.spec.mjs` is not a variation on the ateliers.
It is the only paid path where **stock** moves, and it moves in three places,
each in a different module and a different transaction:

| When | What | Where |
|---|---|---|
| checkout | `reservedQuantity` up | `createOrderFromCart` |
| fulfilment | `stockQuantity` down, `reservedQuantity` back | `fulfillOrderPayment` (webhook) |
| cancellation | `stockQuantity` back up | `open-refund-operation` |

An atelier exercises none of it — seats are a count on one row. The spec
asserts the pair at every step, including that the goods return **when the
order is cancelled, not when the money lands**: the item is back on the shelf
and sellable while the refund may sit in the worklist for days. A test that
only checked stock at the end would pass either way.

It uses PICKUP_PREPAID rather than shipping deliberately: Mondial Relay rate
tiers are still a placeholder (PROJECT_REQUIREMENTS.md §2), so a shipping
test would assert a price nobody has agreed to.

## The redelivery scenario proves a duplicate is ignored

`webhook-redelivery-idempotency.spec.mjs` delivers the same `charge.refunded`
twice. Every other scenario here delivers each event exactly once, so all of
them would keep passing with that guard removed entirely — while a duplicate
wrote a second `REFUND` row for money that only moved once.

The guard is arithmetic, not an event-id ledger: settlement subtracts what our
transactions already record from what Stripe says was refunded in total, and
writes the difference. That is the better design — it also absorbs a refund
made by hand that produced no event we saw — but only if the subtraction is
right, and nothing exercised it.

Two things about the test worth keeping if it is ever edited:

- It holds the invariant across a **25-second window** instead of checking
  once. Redelivery is asynchronous, so a single read straight afterwards
  passes by being early — exactly how this could look green with the bug
  present.
- It compares the REFUND **rows**, not their count. A settlement that rewrote
  the existing row with a doubled amount keeps the count at one and is just
  as catastrophic.

`resendChargeRefundedEvent` is scoped to a specific charge on purpose. Taking
"the most recent charge.refunded on the account" would, on a shared test key,
usually pick up a colleague's refund — passing while proving nothing, and
replaying a stranger's settlement into this database on the way past.

## The credit-note scenario is the only B2B refund

`credit-note-delivery.spec.mjs` is the only scenario here that produces a
credit note somebody actually receives, and it has to be B2B: a credit note
reverses an invoice, and an invoice is only issued to a buyer with a
validated VAT number. The other three refund scenarios are all B2C, so their
`assertNumberingContiguous` call is a no-op — correct, but not coverage.

It asserts the **mailbox**, not `CreditNote.emailSentAt`. That column records
what the application believed; `sendEmail` resolves `{ success: false }` on a
provider failure rather than throwing, so the two can disagree — and a B2B
customer cannot reclaim VAT on a document they were never sent. The column is
only checked once the PDF has been seen in Mailpit, and the attachment's size
is asserted too, because a zero-byte PDF satisfies "has an attachment" and is
useless to the recipient.

Two hazards if you edit it:

- **Sending is two clicks from sending the wrong document.** The invoice
  cell's "Gérer l'envoi" and the drawer's "Envoyer la note de crédit" open
  the same dialog with different `kind`s. Clicking the wrong one e-mails a
  real invoice to a real address (T10).
- **Every run burns a legal number.** It issues a real credit note into the
  gapless series, and those are never deleted. When it fails, read the
  `error-context.md` snapshot rather than re-running to see if it was a flake
  (T12).

## The formation scenario proves money does *not* move

`formation-non-refundable.spec.mjs` is the only scenario here whose point is
that nothing is refunded. `PROJECT_REQUIREMENTS.md` §2 records that a
formation's deposit **and** balance are non-refundable regardless of
attendance, and `cancelFormationReservation` implements that: an ordinary
cancellation returns nothing, and `refundPayment` is an admin-discretion
exception requiring a written reason.

"No refund" is an absence, and an absence is what a passing test can most
easily assert for the wrong reason — a booking that never got paid at all
would satisfy "no RefundOperation exists". So the assertions are positive
first: the payment is still `PAID`, the collected total is unchanged, and
**Stripe itself still reports nothing refunded**. Only then the absence.

It also asserts the disclosure on the booking page ("ne sont remboursables en
aucun cas") — not decoration, since that sentence is what makes keeping the
money defensible, and it sits on the same screen as the pay button.

§4 flags this policy for legal re-check. That is a reason to pin it: if it
changes, somebody has to change an assertion and notice.

## A known limitation

A **mixed-method refund is currently unreachable through the UI.**
`settleReservation` and `completeAppointment` both flip the item to
`COMPLETED` in the same transaction that records the solde, and
`authorizeRefund` denies `COMPLETED`. POS sales and boutique orders are
single-method. So `planRefund`'s multi-leg allocation only ever serves
historical reprise cases today — invariant 2 above guards it, but no scenario
can construct it through the browser.
