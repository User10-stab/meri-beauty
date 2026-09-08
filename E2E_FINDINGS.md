# E2E findings log

Everything the end-to-end testing campaign turns up: bugs found and fixed,
things that look like bugs and are not, and the traps that cost time when
writing the tests themselves.

Kept because the value of an e2e run is not only the green tick. Most of what
follows was invisible to 1129 passing unit tests, and several entries are
things a future test author would otherwise rediscover the hard way.

Status key: **FIXED** · **OPEN** · **WON'T FIX** · **NOTE** (not a defect)

---

## What we should fix next

Nothing below has been changed. Each is something the campaign turned up that
is still true today, with what it would cost and why it has been left.

Ordered by what I would do first.

### F1 — Answer the same 403 whether or not the invoice exists · small
`app/api/invoices/[id]/pdf/route.js:118` returns **404 for a missing invoice
before it authorises anyone**, and 403 at :121 once it does. The file's own
header comment already promises the opposite — "which invoices exist, and
which belong to whom, is not something an id-guesser should learn from the
difference between two error messages" — so the code contradicts its stated
intent, which is the part that makes it worth fixing rather than the leak
itself. Invoice ids are cuids, so this is narrow.

Fix: move the lookup behind the auth check, or return `denied` for both.
One line. `invoice-pdf-access.spec.mjs` deliberately does not assert
indistinguishability today; once fixed, it should.

### F2 — What an uncollected pickup does to stock · BUILT 2026-09-05
`PROJECT_REQUIREMENTS.md` §2 listed as ✅ *Confirmed non-negotiable*:

> Pickup-on-site orders auto-expire and release stock after 7 days uncollected

The code had stopped doing the second half, and nothing recorded why. Both
behaviours were defensible and the document and the code simply disagreed.

**Resolved by keeping the substance of the rule and changing its timing.**

The system cannot distinguish *"never collected"* from *"collected at the
counter and never recorded"*. Releasing on that guess put goods already in a
customer's bag back on sale — unrecoverable. Holding instead is recoverable
with one click, but only if somebody eventually clicks, and nobody opens a
worklist unprompted forever. So neither pure option was right:

| Day | What happens now |
|---|---|
| 7 | Expire, **hold** the stock, raise the worklist, alert the salon — **and ask the customer** whether they already collected |
| — | The worklist count follows staff onto every dashboard page (sidebar badge) |
| 21 | `releaseUnverifiedPickups` releases it anyway, tells the customer, and sends the salon one digest saying the stock figure may now be wrong |

Three things this turned on that were previously missing:

- **The customer was never asked.** They are the only party who knows whether
  they walked out with the bag, and they got total silence at day 7. That is
  now the cheapest and most reliable way these resolve.
- **The hold had no ceiling.** An unbounded hold is a promise about staff
  habit sustained forever. 7 + 14 = 21 days, `PICKUP_VERIFICATION_GRACE_DAYS`.
- **The worklist was invisible.** Without the badge the 14-day backstop stops
  being a backstop and quietly becomes the normal path.

An automatic release leaves `stockReleasedByUserId` null and writes a
different audit action (`…_released_automatically`) from the human one, so
"staff checked the shelf" and "the clock ran out" stay separable.

Why day 7 was too early to automate but day 21 is acceptable: an expiry only
happens when **no money was recorded**, so a pickup that really was handed
over is also an unrecorded sale — which the till reconciliation surfaces as a
variance long before three weeks are up.

**⚠️ Still open with Marie: the number 14.** The principle is hers and is
preserved; only the figure is a developer's choice. §2 now says so.

**Coverage** — `tests/critical/unverified-pickup-auto-release-contracts.test.js`
(15 tests: the release itself, the grace-period cutoff, the idempotency claim
against a simultaneous staff click, audit distinguishability, both e-mails,
the digest, batch resilience, both job runners, and that the badge counts the
same rows the worklist lists).

### F3 — `ADMIN_ONLY_ROUTES` protects four routes and reads as if it protects all · small
`auth.config.js:10` lists six prefixes. Two match no route that exists
(`/dashboard/categories` — actually `/dashboard/boutique/categories`;
`/dashboard/salon-settings` — actually `/dashboard/settings`, separately
listed). It omits ten genuinely admin-only routes: `promo-codes`,
`operations`, `audit-logs`, `boutique/products/new`, `boutique/products/import`,
`appointments/exceptions`, `reservations/exceptions`, `payments/disputes`,
`reviews`.

**Nothing is exposed.** `requireAdmin()` inside each page refuses all sixteen,
and `rbac-dashboard-routes.spec.mjs` proves it. The risk is a reader treating
this list as the security boundary and deleting a `requireAdmin()` that looks
redundant.

Fix: complete the list, or delete it and rely on the page guards alone. I
would complete it — defence in depth is worth the six lines.

### F4 — Three comments point at a file that does not exist · trivial
`docs/PRODUCTION_ISSUES.md` is cited by
`actions/appointment/manage-appointment.js:810`,
`lib/orders/expire-stale-orders.js:179` and
`tests/critical/prelaunch-risk-fixes-contracts.test.js:9`. There is no `docs/`
directory. Each reference is a numbered pointer (`#2`, `#5`) into content
nobody can read, attached to the exact code that most needs explaining.

Fix: write the file, or rewrite the three comments to stand alone.

### F5 — Confirm the production job runner · deployment check, not code
`JOBS_RUNNER` is unset, so `lib/background-jobs.js:42` falls back to
`in-process`: the interval runs inside the Next process. That is right for dev.
In production it wants deciding explicitly — an in-process interval on more
than one instance runs every job more than once, and `external` with no real
cron calling `/api/cron` runs them never. The health endpoint reports which
mode it is in, so this is a five-minute check against the deployed instance.

### F6 — Webhook redelivery is untested · RESOLVED 2026-09-05
The helper sat in the money fixtures, fully written and called by nothing.
It is now called by `webhook-redelivery-idempotency.spec.mjs`, which proves
a duplicate `charge.refunded` settles once.

Rewritten on the way: it took whatever `charge.refunded` was newest on the
account, and the Stripe test key is shared with the team — so it would
routinely have resent a colleague's refund, passing while proving nothing
about ours and replaying a stranger's settlement into this database. It is
now `resendChargeRefundedEvent({ chargeId })` and fails loudly if our own
event is not in the search window.

### F7 — `pickupsToVerify` needs a native read in nl and en · small
The strings added for the pickup worklist were written by me. French is
Marie's own wording; Dutch and English are translations that have not been
read by anyone who speaks them, and they sit on a screen where the wrong verb
decides whether stock goes back on sale.


## Bugs

### B1 — The "she did come" pickup outcome crashed the orders page · FIXED
**Found by** `tests/e2e-dashboard/boutique-pickup-verification.spec.mjs`
**Severity** high — the feature's main path was unusable, and the only
reachable alternative was the wrong one.

Clicking **"Elle est venue — finaliser le retrait"** in the expired-pickup
worklist took the whole orders page down to the error boundary:

```
TypeError: Cannot read properties of undefined (reading 'toFixed')
    at PickupConfirmDialog
```

`PickupsToVerify` builds its own payload for the dialog rather than passing
the order through, and omitted `totalAmount`. An on-site pickup is unpaid by
definition, so the dialog always renders its needs-payment branch, where a
bare `order.totalAmount.toFixed(2)` threw.

Consequence: staff could not record a handover at all. The only outcome they
could reach was **"jamais retirée — remettre en vente"**, which puts stock
back on sale — for goods that may already be in the customer's bag. That is
precisely the double-sell the worklist was built to prevent.

**Fix** — `components/dashboard/boutique/PickupsToVerify.jsx` passes
`totalAmount`; `components/dashboard/boutique/PickupConfirmDialog.jsx` now
hides the amount line when it is missing rather than throwing. Deliberately
hidden rather than shown as `0,00 €`: a wrong figure at the till is worse than
no figure, and the server recomputes the total anyway.

**Regression guard** —
`tests/critical/expired-pickup-stock-confirmation-contracts.test.js`.

**Why it survived** — the contract test for this feature asserted the actions
exist, the guards exist and the component is wired in. All of that was true.
Nothing a source grep can see was wrong.

### B2 — A balance could never be settled from the appointments list · FIXED
**Found by** `tests/e2e-dashboard/appointment-completion-guards.spec.mjs`
**Severity** high (function), none (money) — no wrong money was ever recorded;
the operation was simply impossible.

`getAllAppointments` flattens the payment onto each row —
`paymentStatus`, `paymentType`, `totalAmount`, `paidAmount`,
`remainingAmount`. There is **no nested `payment` object**.

`AppointmentsPageClient` decided which path "Terminer" should take by reading
`a.payment?.status`, which was therefore permanently `undefined`. Every click
took the no-payment path, calling `completeAppointment(id)` with no method and
no confirmation. The server then correctly refused:

> Mode de paiement requis pour encaisser le solde restant.

So a deposit-paid rendez-vous could **not be completed from
`/dashboard/appointments` at all**, and the "Encaisser le solde restant"
dialog next to it — including its payment-confirmation checkbox — was
unreachable dead code. Had it ever opened it would have thrown as well:
`toComplete.payment.totalAmount` is the same non-existent object (same shape
of failure as B1).

The calendar drawer reads `appointment.paymentStatus` and works, so staff had
a route — just not this one.

**Fix** — `components/dashboard/appointments/AppointmentsPageClient.jsx` now
reads the flattened fields it is actually given.

**Verified** — the dialog opens, "Encaisser et terminer" is disabled until the
confirmation box is ticked, and completing writes a `FINAL_PAYMENT`
transaction of 30 € by CARD with no cash-book piece number, moving the
appointment to `COMPLETED` and its payment to `PAID`.

### B3 — Searching appointments by customer name or e-mail matched nothing · FIXED
Same root cause as B2, same file. The filter built its haystack from
`a.customer?.fullName` and `a.customer?.email` — both permanently `undefined`,
so the string searched was literally `"undefined undefined <service>"`. Only
the service name was ever searchable; typing a client's name returned nothing.

### B4 — The reject dialog said "Le rendez-vous de undefined" · FIXED
Same root cause again: `toReject.customer?.fullName` instead of
`toReject.customerName`. Staff were asked to confirm cancelling an
appointment without being told whose it was.

### B5 — Opérations printed the raw Prisma enum as the payment state · FIXED
**Found by** Marie's own eye on the Opérations screen, not by a test.
**Severity** medium — nothing wrong was recorded; the screen simply could not
be read.

A fully refunded atelier row showed:

> Paiement complet · 45,00 €   Remboursé · 45,00 €

and the reported complaint was that the status should be one or the other.

The badges are not the status. That column ("Règlement") records what money
*moved*, and it is right to keep showing the collection after a refund —
dropping it would erase the fact that 45 € was ever taken, which the books
need. The real problem was next to it.

**"État paiement" — the column that answers exactly that question — rendered
`payment.status` raw.** So it displayed `REFUNDED`, `PARTIALLY_REFUNDED`,
`PAID`: Prisma enum values, in English, in an otherwise entirely French
table. That reads as debug output rather than as a state, so it gets skipped
and the money badges beside it get read as the status instead. An identical
`PAYMENT_STATUS_LABELS` map already existed, duplicated, in
`components/dashboard/{workshops,formations}/ReservationRow.jsx` — Opérations
was the one screen that never got one.

A second defect surfaced while fixing it. The refunded figure came from
`row.refundState.totalRefunded`, which only the order/workshop/formation
hydrators supply. Appointment rows carry a **different** `refundState`
(`admin-operations.js` builds them per transaction, not per entity), so on a
rendez-vous that read was permanently `undefined` and the refund line never
rendered at all. **Same shape as B2**: reading a field the row does not carry,
invisible because `undefined` fails quietly.

**Fix**
- `PAYMENT_STATUS_LABELS` moved to `lib/dashboard/operation-filters.js`,
  alongside the two label maps already there, and used in Opérations.
- The refunded total is summed from the row's own transactions, which works
  for all four sources.
- The amount is no longer repeated under a status that already says
  "Remboursé" — that repetition was part of what made the row ambiguous.
- A fully refunded row strikes through its collection badges and states
  **Net encaissé : 0,00 €**. A partial refund states its net too, since that
  is the case where the arithmetic is genuinely hard to do at a glance.

**Regression guard** — `tests/critical/operations-payment-state-labels.test.js`,
including a test that walks the `PaymentStatus` enum in `schema.prisma` and
fails if any value lacks a French label. A missing entry falls through to the
raw enum, which is the bug itself.

**Why it survived** — 1144 unit tests and 52 e2e tests. The money suite drives
this exact screen four times per run, clicking "Voir / gérer" on refunded
rows. Not one of them looks at what the row *says*: they assert the database
balances afterwards. A row can be unreadable and perfectly correct.

### B6 — A private consumer's 14-day withdrawal refund cannot be completed · FIXED
**Found by** writing the Batch G returns scenario; confirmed against the dev
database, not inferred from the code alone.
**Severity** high — it blocks a statutory right, for exactly the class of
person the statute protects.

`completeReturnRequest` (`actions/boutique/returns.js:590`) refuses outright
when the order's payment has no invoice:

> Aucune facture n'est associée à cette commande — impossible d'émettre une
> note de crédit.

But an order only gets an invoice when the buyer has a **validated VAT
number**: `fulfill-order-payment.js:224` gates issuance on
`hasInvoiceableVatIdentity`, which is `hasReusableVatValidation(...)`. A
particulier never has one, by design and correctly — a consumer is not
entitled to a VAT invoice.

So the flow works right up until the money: the customer looks their order
up, requests the return, staff approve it — and then completion, the step
that actually refunds, is impossible. There is no other route from the
returns worklist.

**This is the requirement `PROJECT_REQUIREMENTS.md` §2 records as the one
that had to correct the client's instinct**, "no refunds after delivery"
having been explicitly illegal for EU distance selling. The 14-day right of
withdrawal is a *consumer* right. It is currently only exercisable by
companies.

**Measured, not assumed** — of 55 paid orders in the dev database:

| | with invoice | without |
|---|---|---|
| ONLINE, no VAT number | 12 | **9** |
| ONLINE, VAT number | 18 | 0 |
| POS, no VAT number | 8 | **7** |

Restricted to `COMPLETED` orders, the only ones a return is possible on:
**11 of 24 have no invoice, every one of them a particulier.** (The no-VAT
orders that *do* have invoices look historical, from before issuance was
gated — worth confirming separately.)

There are **zero** `ReturnRequest` rows in the database, so nobody has
reached this wall yet. It is waiting for the first consumer who changes their
mind.

**Fixed — option 1**, refunding without a credit note when there is no
invoice to correct. The decisive evidence was that this was never a new
policy question: the codebase had already answered it three times.

- `queueManualRefund` states the real rule — `if (!creditNoteId &&
  customerIsBusiness) throw`. Only a **B2B** refund requires a credit note.
- `cancelWorkshopReservation` and the two `manage-reservation` actions had
  already been refunding B2C customers with no credit note, using the exact
  idiom now adopted here: `let creditNoteId = null; if (payment.invoice) {…}`.
- `send-b2c-refund-confirmation.js` opens by saying a B2C customer receives
  "no credit note, refund receipt, accounting-adjustment wording, or
  attachment". The written policy already existed.

The boutique return was the outlier, not the precedent.

The two alternatives were rejected on their merits rather than on effort.
**Issuing an invoice for every order** inverts `issueInvoice`'s central
`B2C_INVOICE_NOT_ALLOWED` guard, whose own comment says it exists to stop a
future call site consuming a number a B2C buyer is not entitled to. **A
separate consumer-refund series** contradicts the B2C policy quoted above and
is a project in its own right; if an accountant later asks for one, it should
be built deliberately, not smuggled in to unblock a refund.

**What changed**

| File | Change |
|---|---|
| `actions/boutique/returns.js` | Guard removed; credit note conditional; `creditNoteId`/`invoiceId` passed as `?? null`; PDF and attachment skipped when there is no note |
| `lib/email-templates.js` | `returnCompletedEmail` takes `creditNoteAttached`; the "pièce jointe" sentence is written only when the file is really attached |

No migration: `Transaction.creditNoteId`, `RefundOperation.creditNoteId` and
`ReturnRequest.creditNoteId` were all already nullable.

**The e-mail half was the trap.** Shipping the action fix alone would have
sent every particulier a message pointing at a credit note that is not
attached — the identical failure to B5, B7 and B8, in the same campaign that
found them.

**Now covered** — `boutique-returns-withdrawal.spec.mjs` follows a
particulier's refund all the way through: the return completes, a
`RefundOperation` is queued for the full amount with a PENDING ONLINE leg
pointing back at the original collection, and the credit-note count does not
move. That last assertion is the one that matters legally — it proves the fix
did not buy the refund by burning a number from the gapless sequence. The
contract block in `returns-refund-honesty-contracts.test.js` was rewritten
from pinning the defect to asserting the rule, as its own note instructed.

**Still worth one line to Marie's accountant**: whether a Belgian B2C refund
needs *any* corrective document. Four places in this codebase say no. That
question does not block anything — the behaviour before this fix was not "no
document", it was "no refund".

**Why it survived** — no test has ever created a `ReturnRequest`, and the
contract tests for returns assert the guards exist rather than that the flow
completes. The guard does exist. It is simply wrong for half the customers.

### B7 — The returns screen promised an automatic Stripe refund that never happens · FIXED
**Found by** reading the returns flow while writing the Batch G scenario.
**Severity** high — the failure mode is a customer who is never refunded and
nobody realising.

Finalising an approved return on a **card-paid-online** order showed:

> Le remboursement sera envoyé automatiquement via Stripe après confirmation
> de réception.

`completeReturnRequest` calls `queueManualRefund`
(`actions/boutique/returns.js:774`). Nothing is sent automatically — by the
confirmed policy of 2026-09-02 this application never calls Stripe to refund
anything; it records a debt an OWNER/ADMIN settles by hand.

So staff clicked "Confirmer réception & rembourser", read that Stripe had
taken care of it, and moved on. The money sat in *Opérations › Remboursements
dus* untouched, and the only thing that would ever surface it is somebody
noticing the worklist — which is precisely what B5's sibling problems and the
pickup worklist have already shown does not happen on its own.

The wrong branch is the **common** one:
`isManualOrderRefund(payment)` is `getOrderPaymentMethod(payment) !== "ONLINE"`,
so a normal online boutique purchase takes the `else`, which is the branch
that lied. Counter payments (cash/terminal) already got correct instructions.

**The rest of the app already told the truth.**
`components/dashboard/boutique/OrderDetailClient.jsx:544` says outright
"Aucun argent ne sera envoyé automatiquement." The returns screen was the
single outlier, which is what makes this a slip rather than a
misunderstanding.

**Fix** — the message now says the refund is *mis en attente*, that an
administrator must perform it by hand in Stripe, and where it will sit until
they do.

**Why it survived** — it is prose. No source grep asserts what a paragraph
claims, and every behavioural test around returns checks what the server
does, which was right all along. The screen and the code disagreed and only
the code was under test.

### B8 — The cancel dialog promised a Stripe refund too · FIXED
**Found by** reading the formations cancellation path while building its
first e2e scenario.
**Severity** high, and arguably higher than B7.

`CancelReservationDialog` — shared by **both** ateliers and formations — told
the admin:

> 45,00 € (acompte) sera remboursé via Stripe.

`cancelWorkshopReservation` and `cancelFormationReservation` both call
`queueManualRefund`. Neither touches Stripe. The money is recorded as a debt
in *Opérations › Remboursements dus* and waits for a human.

This is the same defect as B7, in a second place, and worse in one respect:
**this is the dialog where an admin decides to grant an exceptional refund.**
They tick "Rembourser à titre exceptionnel", read that Stripe has it in hand,
and close the dialog. The customer they just decided to compensate is never
paid.

Both cancellation paths are exception paths — a formation deposit is
non-refundable by default, an atelier acompte likewise — so the affected
customers are precisely the ones being granted something out of goodwill,
usually for a medical or force-majeure reason. Those are the worst people to
silently not pay.

**Fix** — the line now says the refund is *mis en attente*, that an
administrator must perform it by hand in Stripe, and where it will sit until
they do. One string, both modules, since the component is shared.

**Why it survived** — `atelier-acompte-refund.spec.mjs` drives this exact
dialog on every money run and passes, because it asserts what the database
records afterwards. It never reads the sentence above the button. Same blind
spot as B5 and B7: **every test here checks what the server writes, and none
checks what the screen claims.**

That is now three defects of one shape found in one campaign. It is not a
coincidence and it should change what gets written next.

### B9 — Staff were offered stock movements the server always refused · FIXED
**Found by** writing the stock-adjustment scenario.
**Severity** medium — nothing wrong was recorded; the feature was simply a
dead end for the role it was built for.

`recordStockMovement` allows a STAFF session exactly one movement type,
SALON_USAGE, and refuses RESTOCK, LOSS and ADJUSTMENT. That guard is right:
those three move stock in any direction for any stated reason, which is how
an inventory discrepancy gets papered over, so they belong to an admin.

`StockAdjustDialog` offered **all four to everybody**, with RESTOCK selected
by default and no role passed into the component at all. A staff member with
the stock permission opened it, typed a quantity, submitted, and got

> Accès non autorisé.

with nothing on screen indicating which option they were allowed to use.

**The action's own comment is what let this survive:**

> The UI only ever offers SALON_USAGE to a STAFF user, but the UI is not a
> security boundary…

It did not. Anyone verifying the guard reads that sentence, agrees the server
check is a sensible backstop, and never opens the dialog. A comment asserting
someone else's behaviour is a claim, and this one was false.

**Fix** — the page resolves the session role and passes it down; the dialog
filters the type list and defaults to SALON_USAGE for staff. The projected
new-stock figure also stopped assuming RESTOCK is the only additive type,
which it was reading as `type === "RESTOCK"` rather than from the option's
own sign.

**Coverage** — `tests/e2e-dashboard/stock-adjustments.spec.mjs`: staff see one
option and using it decrements stock and is attributed to them; an admin sees
four and a restock adds. The second is the control — narrowing staff to a
single option would be equally satisfied by a dialog that showed nobody
anything.

### B10 — Marking a no-show failed every time, and always had · FIXED
**Found by** `tests/e2e-dashboard/appointment-reschedule-noshow.spec.mjs`.
**Severity** high — a whole feature that has never once worked in production
or in development.

Clicking **"Absente"** on a past appointment did nothing. Staff got

> Erreur lors du marquage de l'absence

and the row stayed CONFIRMED. **There were zero `NO_SHOW` appointments in the
database**, against 75 CONFIRMED, 19 CANCELLED and 12 COMPLETED — the feature
has never succeeded a single time.

The cause is one missing string. `lib/validations/notification.js` lists the
notification types Zod will accept, and the Prisma enum had grown four values
the list never gained:

```
APPOINTMENT_NO_SHOW
APPOINTMENT_CANCELLATION_REQUEST
RESERVATION_CANCELLATION_REQUEST
ORDER_CANCELLATION_REQUEST
```

`createNotificationsBulk` **throws** on an unknown type rather than skipping
it, and `markAppointmentNoShow` builds its notifications *inside the same
transaction* that flips the status. So the throw rolled back the status
change, the payment update and the invoice — everything — and the user saw a
generic error with no clue that a notification was involved.

Only the no-show was affected: the three CANCELLATION_REQUEST callers use
`prisma.notification.createMany` directly and never reach the schema (27
`APPOINTMENT_CANCELLATION_REQUEST` rows exist, which is what showed the
difference). They are added to the list anyway — a list claiming to mirror
an enum should mirror it.

**The file already carried the instruction that would have prevented this:**

> Keep this list in sync with the schema whenever the enum is extended.

It is now derived and checked instead.
`tests/critical/notification-types-parity.test.js` parses the enum out of
`schema.prisma` and fails on drift in either direction, including a
guard-the-guard case so a parsing change cannot make it trivially pass.

**Why it survived** — no test ever marked an absence. Every appointment
scenario in the suite ends in COMPLETED or CANCELLED, and 1170 unit tests
mock Prisma, so the enum and its Zod mirror were never compared to each
other by anything.

---

## Not defects, but worth knowing

### N1 — A refused admin page can answer HTTP 200 · NOTE
`/dashboard/boutique/products/new` returns **200 while rendering "Cette page
n'existe pas"**. No content leaks — `requireAdmin()` fires correctly and the
rendered body is the 404 page.

The cause is streaming: the route has a `loading.jsx`, so the shell (and its
`200`) is already flushed by the time `notFound()` throws, and the status can
no longer be changed. Routes without a `loading.jsx` answer a real 404.

Only matters if something ever monitors these routes by status code. It is
also why `rbac-dashboard-routes.spec.mjs` asserts *refusal* rather than status.

### N2 — Admin-only pages are refused by two layers, unevenly · NOTE
`auth.config.js#ADMIN_ONLY_ROUTES` (applied through `proxy.js`) redirects six
path prefixes before the page runs. `requireAdmin()` inside each page calls
`notFound()`. Both refuse; which one fires is incidental.

Two of the six prefixes match **no route that exists**:

| Listed | Actual route |
|---|---|
| `/dashboard/categories` | `/dashboard/boutique/categories` |
| `/dashboard/salon-settings` | `/dashboard/settings` (separately listed, so covered) |

The list also omits most genuinely admin-only routes (`promo-codes`,
`operations`, `audit-logs`, `boutique/products/new|import`,
`appointments/exceptions`, `reservations/exceptions`, `payments/disputes`,
`reviews`). Nothing is exposed — the page-level `requireAdmin()` catches all of
them — but the outer layer is protecting four routes, not sixteen.

**Not changed**, because it is app code and nothing is currently at risk.
Verified by `rbac-dashboard-routes.spec.mjs`, which asserts every one of the
sixteen is refused however it happens.

### N3 — A 403 on an invoice PDF confirms the invoice exists · NOTE
`app/api/invoices/[id]/pdf/route.js` answers 404 for a missing invoice
*before* it authorises, so an unauthorised caller can distinguish "exists" from
"does not exist". Invoice ids are cuids, so this is a narrow leak rather than
an enumeration hole.

Left as is, and the test suite deliberately does **not** assert that refusals
are indistinguishable — writing that assertion would bake a false promise into
the suite.

### N5 — `settledAmount` is null on a leg that settled in full · NOTE
A `RefundLeg` that settles for exactly what was planned records
`settledAmount: null`, not the amount. The field exists to carry a
*shortfall*: `lib/refunds/operation-status.js` and the ledger helper both read
null as "settled in full".

Recorded because it looks like a bug from the outside — the first version of
the Connect scenario asserted the amount and failed with `expected 22,
received 0` on a refund that had settled perfectly. The euros live on the
`REFUND` transaction the settlement writes.

### N4 — `docs/PRODUCTION_ISSUES.md` does not exist · NOTE
Referenced from `actions/appointment/manage-appointment.js:810`,
`lib/orders/expire-stale-orders.js:179` and
`tests/critical/prelaunch-risk-fixes-contracts.test.js:9`. There is no `docs/`
directory; the project's markdown lives at the repository root. The comments
point at nothing.

---

## Traps for whoever writes the next test

### T1 — Log in once per file, never per test
`actions/auth/login.js` rate-limits to **10 attempts per email+IP per 5
minutes**. A `beforeEach` signing the same admin in for every test exhausts
that within a couple of runs.

The symptom is not an error. The login form simply stays put, so every test in
the file fails at the sign-in step and it reads like a broken application.

Sign in once in `beforeAll` on a shared page, or give each persona its own
seeded e-mail (separate buckets).

### T1c — The two e2e suites share one admin rate-limit budget
`boutique-pickup-verification.spec.mjs` failed once during a full five-suite
sweep and passed on every isolated re-run, including with the two specs that
precede it. The report is the tell:

```
1 failed
3 did not run
```

Four tests in that file, so the whole file aborted — which means `beforeAll`,
and `beforeAll` is where it calls `loginAsAdmin`.

Both suites sign in as the same `admin@meribeauty.com`, and
`actions/auth/login.js` allows **10 attempts per email+IP per 5 minutes**.
That was comfortable when the money suite had four scenarios. It now has
seven, each signing in as admin, and when the money suite runs immediately
before the dashboard suite their windows overlap.

`loginAs` does assert the redirect away from `/login`, so this fails
honestly rather than silently — but it fails in `beforeAll`, where the
message is attributed to the first test in the file and reads like that test
being broken.

**FIXED.** `seedAdmin({ label })` gives every dashboard spec its own
admin-role account, so each has its own rate-limit bucket and neither suite
can exhaust the other's. Verified equivalent rather than assumed: the real
admin is role `ADMIN` with **no Staff row**, and `OnboardingGuard` ignores
anyone who is not STAFF.

Recorded rather than dismissed as a flake, because "passes on re-run" is
exactly what this looks like and exactly what it is not. The old arrangement
worked by an ordering rule that was true when it was written and silently
stopped being true when the money suite grew from four scenarios to seven —
which is the real argument for removing the coupling instead of restating the
rule.

Two smaller things fell out of the change, both worth knowing:

- Two of the six call sites were not logins at all. They looked the admin up
  by e-mail purely to stamp `createdById` on a seeded row, and now use the
  seeded admin's id directly.
- One of them lived in a **second `test.describe` block** that could not see
  the first block's `adminId`, so the first attempt failed with a bare
  `ReferenceError`. A `describe` is a scope; a per-file admin has to be
  seeded per block that needs one, not hoisted by assumption.
- `scripts/purge-e2e-dashboard-data.mjs` now recognises `e2e+admin.` accounts
  in its "does this run look dashboard-shaped?" guard — the guard that once
  stopped the dashboard purge being pointed at money-suite data (T7).

### T2 — Seeded staff must be *complete* people
`checkOnboardingStatus()` computes setup completeness from **languages +
contract + working hours**, ignoring the `Staff.setupCompleted` column.
`OnboardingGuard` then client-side redirects any incomplete staff member to
`/dashboard/account-settings` from every other page.

A staff member seeded without those three is bounced out of the very screen a
permission test just granted them — and because the guard fires from an effect
after a server action, it lands *during* the assertion. It failed one route
and not another within a single run, which reads exactly like a flaky
authorisation bug and is nothing of the sort.

`seedStaff` now creates whole people.

### T3 — `networkidle` never arrives against `next dev`
Every navigation using `waitUntil: "networkidle"` burns the full test timeout.
`load` fires while the dashboard shell is still showing a Suspense
placeholder, so reading then is too early.

"Wait until the text stops changing" does not work either: the shell is
perfectly still for ~3.5s before `notFound()` replaces the document, so a
stability heuristic scores a refused page as a rendered one — i.e. as a
security failure. Poll for the outcome you are actually waiting for.

### T4 — A negative source grep cannot tell code from prose about code
`expect(source).not.toContain("order.totalAmount.toFixed")` fails against the
*fixed* file, because the comment explaining the bug quotes it. Assert
positively on the shape the fixed code has.

(The same trap bit an earlier assertion that spanned an emoji with a variation
selector.)

**It recurred while fixing B7**, in the test written to prevent B7 recurring:
the comment in `ReturnsPageClient.jsx` explaining the removed sentence quoted
that sentence, so the guard matched its own explanation. The fix is to
paraphrase in the comment and say why — a comment that quotes a forbidden
string is itself the string. Twice now is enough to call this the most
expensive habit in this file.

### T5 — `GET /api/cron` runs all seven jobs
`boutique-order-expiry.spec.mjs` triggers it because that endpoint *is* the
production trigger. Before writing it, the blast radius against the dev
database was measured: zero stale orders, zero workshop reminders, zero
formation reminders were due, and the order-status distribution was identical
before and after the run.

If that stops being true, the spec starts mutating a colleague's data as a
side effect. When it fails oddly, re-measure rather than assume.

### T5b — `GET /api/cron` now runs eight jobs, and one of them releases stock
`releaseUnverifiedPickups` was added to the same endpoint the order-expiry
spec drives. Before wiring it, the blast radius against the dev database was
measured the same way T5 was:

```
expired on-site pickups awaiting a verdict: 2
of those, past the 14-day grace (would auto-release NOW): 0
```

Zero, so the spec still mutates nothing a colleague owns. That will stop being
true on its own as those two rows age past 14 days — this is a measurement
with an expiry date, not a standing guarantee. Re-measure before assuming.

### T6 — A dialog closing is not a result, and neither is a list re-rendering
Both `AppointmentsPageClient` and `PickupsToVerify` clear their dialog state on
the success *and* the failure branch, then refresh the list. So "the dialog
went away" and "the row went away" are equally true when the server refused.

Asserting on those and then reading the database produced a bare
`expected COMPLETED, received CONFIRMED` — and, in the pickup spec, an
intermittent failure that only appeared when the whole suite ran together,
because the assertion was racing the re-render rather than waiting for an
outcome.

Wait for the toast (`[data-sonner-toast]`) and assert on its text. The refusal
then reports itself in the server's own words, and the wait is anchored to
something that only happens once the action has actually returned.

### T6c — "The row is not there" can mean "not there *yet*"
The boutique spec clicked "Ajouter au panier", navigated straight to
`/boutique/cart`, and failed with the product missing from the cart.

The product was in the cart. `addToCart` is a server action; the navigation
raced its commit, so the page rendered an empty cart and moved on. Checking
the database rather than re-running is what showed this — the `CartItem` was
sitting there, and a re-run would have passed intermittently and been filed
as flake.

Same lesson as T6 from the other direction: there, a dialog closing was
mistaken for success; here, a row's absence was mistaken for failure. Both
come from reading the screen at a moment nothing guaranteed was after the
write. Wait for the toast.

### T1b — The login limiter is not the only one
`actions/boutique/returns.js` rate-limits the public endpoints, and the
ceilings are low because they should be — this is unauthenticated and it
reveals whether an order number and an e-mail go together:

| | limit |
|---|---|
| lookup, per IP | 10 / 5 min |
| lookup, per order number | 10 / 15 min |
| **request, per IP** | **5 / 10 min** |

Three scenarios make four requests. One run fits; a second inside ten minutes
does not — and being throttled looks *exactly* like the feature being broken,
because the request is simply never recorded and the database assertion fails
with "expected 1, received 0".

`boutique-returns-withdrawal.spec.mjs` now reads the toast and `test.skip()`s
with the reason, so a throttled re-run reports itself instead of pointing at
the application. The limiter is in-memory (`lib/rate-limit.js`), so restarting
the dev server also clears it.

The general rule: before writing against any public endpoint, grep it for
`isRateLimited` first.

### T6e — "The toast" is not the toast
Asserting `expect(page.locator("[data-sonner-toast]")).toContainText(...)`
re-reads whichever toast is already on screen. After approving a return, the
"Demande de retour approuvée" toast was still up, so the next assertion read
that one until it timed out — reporting

> unexpected value "Demande de retour approuvée."

which names the wrong toast rather than the missing one, and sends you
looking for a bug in the action that just succeeded.

Filter by content instead: `.filter({ hasText: /aucune facture/i })` waits for
a toast that matches, among however many are stacked.

### T6f — A dialog that closes on success reopens holding stale state
`ReturnsPageClient`'s drawer calls `onClose()` on every successful action and
then refetches the list. Clicking the row again immediately reopens it with
whatever the *previous* fetch put in client state — so the per-item condition
selects, which only render while the row is `APPROVED`, were absent.

That fails as "the select never appeared", which reads like a markup problem
and is really a timing one. Wait for the row's own status badge to change
before reopening it.

### T6b — Fixture changes make assertions stale
Adding the seeded `DEPOSIT` transaction (so `refundableRecordedAmount` sees
real money) silently invalidated an assertion that counted *all* transactions
on an appointment and expected zero. It had been correct when written.

The assertion now names what must not appear — a `FINAL_PAYMENT` or `REFUND` —
rather than asserting an absence of everything.

### T6d — Prisma `include` is not a snapshot
The money suite's fulfilment wait polled until `payment.transactions` existed,
then asserted the reservation's status from the same row. It failed once with
`expected CONFIRMED, received PENDING_DEPOSIT` — while the payment showed the
full 40 € acompte collected.

The reservation was CONFIRMED in the database a second later, and the webhook
writes the status and the transaction inside **one** `prisma.$transaction`. So
that state never existed: Prisma resolves an `include` as separate queries, and
at READ COMMITTED the parent row was read before the commit while its
relations were read after it.

Any poll gate must include the field the assertions afterwards depend on. All
three atelier specs now wait for `status === "CONFIRMED"` as well as the
transactions.

Worth knowing beyond the tests: **any** `findFirst` with `include` can return a
parent and child observed at different instants.

### T10 — Two buttons open the same dialog for different documents
`DocumentDeliveryDialog` sends whichever document it is handed. The invoice
cell's "Gérer l'envoi" passes `kind: "INVOICE"`; the transaction drawer's
"Envoyer la note de crédit" passes `kind: "CREDIT_NOTE"`. They look alike and
sit two clicks apart.

The first version of `credit-note-delivery.spec.mjs` clicked the invoice one
and then failed hunting for a credit-note e-mail — having cheerfully re-sent
`F-2026-000076` to a customer on the way past. The failure message named the
right symptom only because `waitForEmail` lists what it *did* find; a bare
timeout would have sent somebody debugging the credit-note code.

Worth remembering beyond this test: **a wrong click here sends a real
document to a real address.**

### T11 — A nested dialog needs its accessible name, not its text
`getByRole("dialog").filter({ hasText: /note de crédit/i })` matched two
elements — the transaction drawer, which is itself `role="dialog"` and
mentions the credit note, and the delivery dialog on top of it. Playwright
reports that as a strict mode violation, which reads like "the dialog never
opened" when the dialog had opened perfectly.

Address it by name: the delivery dialog is labelled "Envoyer la note de
crédit NC2026-…". Every dialog in this app has an `aria-label` or
`aria-labelledby`, so there is never a reason to match one by its contents.

### T12 — Re-running a money scenario is not free
Every run of `credit-note-delivery.spec.mjs` issues a **real credit note into
the real gapless series**, and those are never deleted (see the money
README). Three debugging runs consumed three numbers.

That is acceptable — the numbers stay, tagged, exactly as the suite's own
policy says — but it changes how a failure should be handled here: read the
`error-context.md` page snapshot and fix the cause, rather than re-running to
see whether it was a flake. The snapshot named the strict-mode violation
outright and would have saved a run.

### T13 — An explicit `role` hides the implicit one
`RowActions` renders each menu entry as `<button role="menuitem">`. The
explicit role wins, so `getByRole("button", { name: /supprimer/i })` never
matches it — the entry is a menuitem and nothing else, as far as the
accessibility tree is concerned.

The failure reads as "the menu did not open", which sends you looking at the
trigger click that worked perfectly. `getByRole("menuitem", …)`.

Worth checking for generally in this codebase: several components set an
explicit `role` on an element that already had a useful implicit one.

### T14 — Playwright auto-dismisses `window.confirm`
`handleNoShow` guards with a native `window.confirm`. Playwright dismisses
native dialogs automatically unless a listener is registered, so the handler
returned immediately and the server action was never called.

The dangerous half is not the failure. It is the test that *passed*: "a
future appointment cannot be written off" asserted that the status had not
changed, and the status had not changed — because nothing ran. It was green
and worthless.

    page.on("dialog", (dialog) => dialog.accept());

Any assertion of the form "X did not happen" behind a native confirm is
suspect until you have proved the code under it executed at all. Both tests
now read the resulting toast, which is the evidence that the action returned.

### T7 — Both suites tag rows the same way; the purge scripts do not
`tests/e2e-money` and `tests/e2e-dashboard` both stamp rows with
`e2e-<timestamp>-<random>`, so a loosely-built list of run ids picks up both.
Pointing the dashboard purge at a money run tries to delete customers who own
workshop reservations it knows nothing about.

Nothing was lost when this happened — `Transaction_paymentId_fkey` is RESTRICT
and aborted the delete — but relying on a foreign key as the safety net is
luck. `scripts/purge-e2e-dashboard-data.mjs` now refuses any run that has
tagged users but none of the rows a dashboard run creates.

Its own ordering had the mirror-image bug: it deleted appointment payments
before their transactions, which the same RESTRICT blocked. Transactions
before payments, both sources.

### T8 — The database has real integrity constraints; seed data must respect them
Three separate ones bit the fixtures, each surfacing as a raw Postgres or
Prisma error in the middle of an unrelated assertion:

| Constraint | What it means | How the fixture handles it |
|---|---|---|
| `Appointment_no_overlap` (exclusion, 23P01) | one staff member cannot hold two overlapping appointments | shift the slot forward an hour and retry, up to 8 times |
| `StaffService` unique on `(staffId, serviceId)` | a staff member offers a service once | reuse the existing row instead of creating |
| `User.email` partial unique (active users only) | Prisma does not expose it as a unique selector | `findFirst`, never `findUnique`, on e-mail |

All three are correct and worth keeping. They are listed here because each one
reads like a test-harness bug and is in fact the schema doing its job.

### T9 — The single open CashSession is a global resource
Exactly one till session may be open system-wide, enforced by an advisory
lock. `caisse-till-session.spec.mjs` therefore opens its own and closes it
again, and **refuses to start** if a session it did not open is already open.

It will not close somebody else's: closing a till writes a Z-closure into a
legally shaped cash book, which is not a test's decision to make.

---

## Environment

### E3 — An open till blocks the POS scenarios · BLOCKED
A `CashSession` opened 2026-09-05 15:38 UTC by Admin (300 € float) is still
open, which is why four `caisse-till-session.spec.mjs` tests skip.

It also blocks the planned **POS counter-sale** scenario, and more firmly
than it blocks the till tests. A counter sale writes `Transaction` rows into
whichever session is open — so running one now would inject test sales into
a real till and corrupt its Z-closure, the legally shaped cash book produced
when somebody closes it.

The suite will not close a session it did not open (T9), and that stands:
closing writes that Z-closure, which is not a test's decision. So the POS
scenario waits until the till is closed by whoever opened it.

### E2 — Mailpit has to be running, not merely configured
`EMAIL_PROVIDER=mailpit` satisfies the env guard, but if the Mailpit process
itself is not up, every send fails with `connect ECONNREFUSED
127.0.0.1:1025`. The application catches those, so nothing breaks visibly —
the failures appear only in the dev server log, e.g.
`[completeAppointment] ticket email failed`.

Any assertion about e-mail is silently meaningless until Mailpit is started:

```
mailpit --smtp 0.0.0.0:1025 --listen 0.0.0.0:8025
```


**Seen for real, 2026-09-06.** Mailpit stopped mid-session and the signup
scenario failed with the guard's own message rather than with a missing
e-mail — `requireMailpit()` in `tests/e2e-money/fixtures/mailpit.mjs` is
there precisely so this reports itself. Restarting the binary and re-running
was the whole fix. Without that guard the failure would have read "no
verification e-mail arrived", which points at the application.


### E1 — A wedged Turbopack cache serves 500 on every route
Symptom: every route, including `/`, returns 500 with
`Reading source code for parsing failed … node process exited before we could
connect to it with exit code: 0xc0000142`.

It is not a code fault and restarting the dev server does not clear it. Stop
the server, `rm -rf .next`, start again.
