# Merri Beauty — Payment & Security Fixes Spec

**Purpose:** Give a fresh agent (or developer) with zero prior context a complete, actionable spec to fix the security and money-correctness bugs found in the 2026-08-06 audit. Every item below includes the exact location, the root cause, the fix pattern (which already exists elsewhere in this codebase — copy it), the acceptance criteria, and how to verify.

**Branch:** work off `marwane`. Each CRITICAL should be its own commit so a regression is easy to bisect.

**Do not** treat this doc as a list of "nice to haves." Items marked 🔴 are exploitable today and can cost real money or leak real customer PII. Ship blockers.

---

## 0. Read this first — the two patterns everything below reuses

The codebase already solves the two bug classes at the heart of most of these findings. Before starting, read these two reference implementations and copy their shape:

### Pattern A — Atomic conditional status transition (the "claim")

**Reference:** `actions/boutique/returns.js:432-441` inside `completeReturnRequest`.

The bug class: a function reads a row's status, checks it, then does an unconditional `update` plus side effects (Stripe call, email, stock move). Two concurrent calls both pass the read before either commits → double execution.

The fix: instead of `findUnique` → `if (status === X) return` → `update`, do the read-claim-and-write in **one atomic `updateMany` gated on the expected prior status**, inside the transaction:

```js
const claim = await tx.returnRequest.updateMany({
  where: { id: rr.id, status: "APPROVED" },   // <-- the gate
  data: { status: "COMPLETED", completedAt: new Date(), ... },
});
if (claim.count === 0) {
  throw new Error("ALREADY_PROCESSED");
}
// only the winner reaches here → safe to restock, credit-note, refund
```

`updateMany` returns `{ count }`. Postgres makes the row-lock + condition + write atomic, so exactly one concurrent caller gets `count === 1`. This is a database-level compare-and-swap. **Every money-moving state transition in this codebase must use this pattern.**

### Pattern B — Ownership check on server actions

**Reference:** `actions/appointment/manage-appointment.js:19-62` (`authorizeAppointmentAction`), `actions/boutique/orders.js:1171-1196` (`cancelMyOrder`).

The rule: any `"use server"` function that touches user data must (a) call the project's auth helper (`auth()` or the wrapper in `lib/authorization.js`), and (b) verify the resource belongs to `session.user.id` (or that the user has a dashboard role). Anything in a `"use server"` file is callable from any client — there is no implicit auth on server actions.

---

## 1. 🔴 CRITICAL fixes (ship blockers — do these first, in this order)

### C1. `confirmPayment` has no auth — anyone can mark any appointment paid

**Location:** `actions/reservation/create-reservation.js:516-580` (function `confirmPayment`).

**Root cause:** No `auth()` call, no ownership check. The function takes `paymentId`, looks up the Payment, and unconditionally marks it `PAID`/`PARTIALLY_PAID`, writes a `Transaction{DEPOSIT}`, transitions the linked `Appointment` to `CONFIRMED`, and fires notifications. Anyone who guesses or obtains a `paymentId` (they're exposed in the reservation return payload and URLs) can confirm any appointment and corrupt the ledger.

**Fix:**
1. At the top of `confirmPayment`, call `const session = await auth(); if (!session?.user) throw new Error("UNAUTHORIZED");`
2. After `prisma.payment.findUnique`, assert ownership: `if (payment.appointment.userId !== session.user.id) throw new Error("FORBIDDEN");` (read the appointment relation if not already included).
3. Return a generic error to the client on both cases — don't leak whether the payment exists.

**Also see C2** — this function is currently the live appointment "payment" path because appointments don't use real Stripe Checkout. Decide C2 before deciding whether `confirmPayment` should even exist in prod.

**Acceptance criteria:**
- Calling `confirmPayment` unauthenticated throws / returns unauthorized.
- Calling it as User A with User B's `paymentId` throws / returns forbidden.
- Calling it as the legitimate owner still works.

**Verify:** `curl` the server action endpoint without a session cookie → 401/throws. Logged in as the wrong user → 403.

---

### C2. Appointments don't charge real money — `confirmPayment` is a DEMO stub wired into the UI

**Location:** `components/reservation/steps/PaymentStep.jsx:283` calls `confirmPayment(id, "DEMO_${Date.now()}")` after a `setTimeout`. The only file that builds a real appointment Stripe session — `actions/payment/createCheckoutSession.js` — is **dead code** (nothing in `components/` or `app/` imports it) **and** it hardcodes the deposit as `totalAmount * 0.1` (line 101), ignoring the staff member's `depositEnabled` / `depositPercentage` settings that the rest of the system uses via `lib/reservation-payment.js#computeDepositAmount`.

**Root cause:** The appointment online-payment flow was never finished. The webhook (`app/api/webhooks/stripe/route.js#processCheckoutSession`) is already written to handle real appointment checkout sessions, but the UI never creates one.

**This is a product decision, not a one-line fix. Pick one before doing the rest:**

- **Option 1 (recommended if appointments should be prepaid online):** Build a real appointment checkout. Replace the `confirmPayment` stub call in `PaymentStep.jsx` with a call to a new/revived appointment checkout action that builds a `stripe.checkout.sessions.create` from `staffService.price` server-side, using `computeDepositAmount(price, staff.depositEnabled, staff.depositPercentage)` for the deposit. Mirror `create-workshop-reservation.js:35-98`. Delete `confirmPayment` once the Stripe path is live.
- **Option 2 (if appointments stay pay-on-site):** Remove the fake "pay online" option from `PaymentStep.jsx` entirely. Do not present a payment UI that doesn't charge. Then `confirmPayment` can be deleted, and C1 is moot.
- **Either way:** Delete `actions/payment/createCheckoutSession.js` (dead code with a wrong deposit hardcode — a latent footgun if someone re-wires it).

**Acceptance criteria:**
- No UI element implies online payment unless a real Stripe Checkout session is created.
- No `"DEMO_"` transaction reference can reach the `Transaction` table in prod.
- The 10% deposit hardcode cannot be reintroduced by accident.

**Verify:** Walk the appointment booking flow end to end as a customer. Confirm there is no path that produces a `CONFIRMED` appointment with `paidAmount > 0` but no real Stripe charge.

---

### C3. `getAppointmentById` leaks full customer PII — no auth

**Location:** `actions/appointment/manage-appointment.js:444-492` (function `getAppointmentById`).

**Root cause:** Every sibling function in this file routes through `authorizeAppointmentAction()`. This one was missed. It does a bare `findUnique` and returns `user.fullName`, `user.email`, `user.phone`, notes, and payment info. CUIDs are enumerable (they're in URLs and emails).

**Fix:**
1. Add `const session = await auth(); if (!session?.user) throw new Error("UNAUTHORIZED");`
2. If the caller is a `CUSTOMER`, require `appointment.userId === session.user.id`. If `OWNER`/`ADMIN`/`STAFF`, allow (via the existing role helpers in `lib/authorization.js`).
3. **Narrow the `select`** — the code comment says this is "used by the payment page." Only return the fields the payment page actually needs. Do not return `user.phone`, `user.email`, or free-text notes unless the caller is the owner or staff.

**Acceptance criteria:**
- Unauthenticated call → unauthorized.
- Customer A calling with Customer B's appointment → forbidden / not found (don't leak existence).
- Owner of the appointment → succeeds.
- Staff/Owner dashboard role → succeeds.

**Verify:** `curl` the action with another user's appointment id → blocked.

---

### C4. Order cancellation is not idempotent → double refund + double restock

**Location:** `actions/boutique/orders.js:1038-1134` (`performOrderCancellation`), called by both `cancelOrder` (staff, line 1137) and `cancelMyOrder` (customer, line 1171).

**Root cause:** The function does a read-time status check (`if (["CANCELLED","EXPIRED","COMPLETED"].includes(order.status)) return`) then an unconditional `update({ status: "CANCELLED" })` inside the transaction, then restocks + issues a credit note inside the tx, then calls `stripe.refunds.create` outside the tx. Two concurrent callers both pass the read before either commits → both restock, both credit-note, both refund.

This is the **exact bug class** that `completeReturnRequest` was fixed for — see Pattern A. Cancellation wasn't given the same treatment.

**Fix:**
1. Replace the unconditional `tx.order.update({ status: "CANCELLED", ... })` with an atomic claim:
   ```js
   const claim = await tx.order.updateMany({
     where: { id: orderId, status: { in: ["PENDING_PAYMENT","PENDING_PICKUP","PAID","PROCESSING","READY_FOR_PICKUP","SHIPPED"] } },
     data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason ?? null },
   });
   if (claim.count === 0) return { alreadyProcessed: true };
   ```
2. Do the restock + credit note inside the same transaction (already the case).
3. **Guard the Stripe refund** so it can't fire twice even if the DB guard is ever bypassed: before calling `stripe.refunds.create`, check whether a `Transaction{ transactionType: "REFUND", paymentId }` row already exists; if so, skip. (See H1 — boutique refunds should be writing this row regardless.)
4. Remove the now-redundant pre-transaction status read in `cancelOrder`/`cancelMyOrder`, OR keep it only as a fast-path UX hint (not as a safety check).

**Acceptance criteria:**
- Two concurrent cancellations of the same paid order → exactly one Stripe refund, one credit note, one restock.
- Second concurrent caller gets a clean "already processed" result, not a crash.
- A `CANCELLED` order cannot be cancelled again (no double effect).

**Verify:** Write a script (or use `Promise.all` in a Node REPL against the dev DB) that fires `cancelOrder(orderId)` twice concurrently on a PAID order. Confirm exactly one refund in Stripe, one credit note row, stock decremented once / restocked once net.

---

### C5. `rejectAppointment` is not idempotent → double refund

**Location:** `actions/appointment/manage-appointment.js:183-306` (`rejectAppointment`).

**Root cause:** Same as C4. Reads `if (appointment.status === "CANCELLED") return` then unconditional `tx.appointment.update({ status: "CANCELLED" })` + `Payment.status = "REFUNDED"` + `Transaction{REFUND}` + credit note + `stripe.refunds.create`. Double-click = double refund.

**Fix:**
1. Atomic claim in the transaction:
   ```js
   const claim = await tx.appointment.updateMany({
     where: { id: appointmentId, status: { in: ["PENDING","CONFIRMED","COMPLETED","NO_SHOW"] } },
     data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
   });
   if (claim.count === 0) return { alreadyProcessed: true };
   ```
2. Before the Stripe call, check for an existing `Transaction{ transactionType: "REFUND", paymentId }` and skip if present.
3. **(Optional, see L1)** Consider whether `COMPLETED`/`NO_SHOW` should be cancellable at all — currently a misclick refunds a finished service. If policy says no, remove them from the `in: [...]` list.

**Acceptance criteria & verify:** Same shape as C4.

---

### C6. `requestReturn` race → over-claim quantities → double refund on completion

**Location:** `actions/boutique/returns.js:170-233` (`requestReturn`).

**Root cause:** `claimedQuantities` is computed from existing non-rejected `ReturnRequest` rows (lines 196-207), validated as `requested.quantity <= remaining`, then a new `ReturnRequest` is inserted. No row lock on the order or its return requests, no DB uniqueness. Two concurrent `requestReturn` calls for the same `orderItemId` both read the same `claimed` snapshot, both pass, both insert. When staff later completes both, each `completeReturnRequest` passes its own (correct) self-idempotency guard — but there are now two requests for the same units → refund + restock twice.

The `completeReturnRequest` guard (Pattern A) only stops the **same** request completing twice. It does not stop two **different** requests for the same items.

**Fix:** Serialize return-request creation per order. Inside a transaction:
1. `SELECT ... FOR UPDATE` on the `Order` row — mirror the locking already used in `createOrderFromCart` (`actions/boutique/orders.js:336` does `FOR UPDATE` on the cart; do the same on the order).
2. Recompute `claimedQuantities` **after** acquiring the lock.
3. Re-validate `requested.quantity <= remaining`.
4. Then insert the `ReturnRequest`.

**Alternative (defense in depth, do both):** In `completeReturnRequest`, re-validate the total claimed-vs-bought at completion time inside its existing transaction, and abort if the sum would exceed the bought quantity. This catches the race even if creation slips through.

**Acceptance criteria:**
- Two concurrent `requestReturn` calls for the same item, each requesting the full remaining quantity → only one succeeds; the other gets "quantity exceeds returnable."
- A single order's items can never be refunded for more than was bought (across all its return requests).

**Verify:** `Promise.all([requestReturn(...), requestReturn(...)])` for the same `orderItemId` with `quantity = remaining`. Exactly one should succeed.

---

### C7. Webhook never rejects underpayment

**Location:** `app/api/webhooks/stripe/route.js:274` (`processCheckoutSession`), `:506` (`processWorkshopCheckoutSession`), `:657` (`processFormationCheckoutSession`); `actions/boutique/orders.js:626` (`fulfillOrderPayment`).

**Root cause:** Each fulfillment path records `paidAmount = session.amount_total / 100` and stores it on the Payment, with `totalAmount` set from the expected DB total — but **no branch ever asserts `paidAmount >= expectedTotal`**. The Payment is marked `PAID` and an invoice is issued regardless. Hard to exploit today (checkout line items are built server-side), but the webhook is the last line of defense and must be paranoid about money.

**Fix:** In every fulfillment path, after computing `paidAmount` and `expectedTotal`, add:
```js
const EPSILON = 0.01; // 1 cent tolerance for float/rounding
if (paidAmount + EPSILON < expectedTotal) {
  await refundSession(session); // refund what was paid
  console.error(`[stripe-webhook] UNDERPAYMENT: paid ${paidAmount} expected ${expectedTotal} for session ${session.id}`);
  return { received: true, refunded: true, reason: "underpayment" };
}
```
For deposits, the expected total is the deposit amount (not the full price) when the session was created as a deposit checkout — compare against the deposit, not the full price.

**Acceptance criteria:**
- A checkout session paid less than expected → refunded, not fulfilled, no invoice, no stock/reservation change, logged.
- A correctly-paid session → fulfilled normally.

**Verify:** Create a test checkout session, manually craft a `checkout.session.completed` event (or use Stripe test mode) with `amount_total` below the expected. Confirm refund + no fulfillment.

---

## 2. 🟠 HIGH fixes

### H1. Webhook idempotency is a scan, not a constraint; fee-change paths have none

**Location:** `prisma/schema.prisma:1151` (`transactionReference String?` — not `@unique`); `app/api/webhooks/stripe/route.js:181-187, 472-478, 624-630` (the `findFirst`-based idempotency checks); `route.js:464-469` (fee-change paths short-circuit before the idempotency lookup).

**Root cause:** Two issues —
1. `Payment.transactionReference` is not `@unique`. The idempotency check is a `findFirst`, which is not a lock. Two near-simultaneous deliveries can both read "not processed" before either inserts → duplicate fulfillment (double stock decrement, double invoice).
2. The workshop fee-change paths (`applyWorkshopSessionChangeFee`, `applyWorkshopSeatsChangeFee`) create no Payment row, so they have **no idempotency at all**. A Stripe redelivery can double-apply the change fee (`changeFeeAmount: { increment }` runs twice, two `Transaction` rows).

**Fix:**
1. Add a migration: `@unique` on `Payment.transactionReference` (use a partial unique index if nulls must coexist — Postgres `CREATE UNIQUE INDEX ... WHERE "transactionReference" IS NOT NULL`). Then the second `payment.create` throws Prisma `P2002`; catch it in the handler and treat as "already processed."
2. Bring the fee-change paths under idempotency: record the processed `session.id` somewhere claimable (e.g. a `lastProcessedSessionId` on the reservation, or a small `ProcessedEvent` table keyed on `session.id`), asserted inside the transaction.

**Acceptance criteria:**
- The same `checkout.session.completed` delivered twice → fulfilled exactly once for **every** path, including fee changes.
- No P2002 crashes a legitimate request.

**Verify:** Replay the same Stripe event id twice (Stripe CLI: `stripe events resend <id>`). Confirm no duplicate rows anywhere.

---

### H2. Refund amount never validated against paid; boutique refunds don't write `Transaction{REFUND}` or update Payment status

**Location:** `actions/boutique/returns.js:408-425, 471-480`; `actions/boutique/orders.js:1075-1097`; `actions/appointment/manage-appointment.js:267-276`; `prisma/schema.prisma:38-43` (`PaymentStatus` enum).

**Root cause:**
- Refund total is computed from `OrderItem.unitPrice * quantity` + shipping, never capped at `Payment.paidAmount − alreadyRefunded`.
- The `PaymentStatus` enum has no `PARTIALLY_REFUNDED`. Boutique refund paths never set `Payment.status` away from `PAID` → dashboard shows refunded orders as paid.
- Boutique refund paths never write a `Transaction{ transactionType: "REFUND" }` row (the appointment path does — `manage-appointment.js:231`). Ledger is incomplete and inconsistent.

**Fix:**
1. Add `PARTIALLY_REFUNDED` to the `PaymentStatus` enum (migration).
2. In every refund path, inside the transaction: compute `alreadyRefunded = SUM(creditNotes.totalInclVat)` for the invoice + any prior `Transaction{REFUND}` rows; assert `totalRefund + alreadyRefunded <= Number(payment.paidAmount)`; abort otherwise.
3. Write a `Transaction{ transactionType: "REFUND", amount: totalRefund, paymentId }` row in the same tx.
4. Set `Payment.status` to `REFUNDED` (full) or `PARTIALLY_REFUNDED` (partial) inside the tx.

**Acceptance criteria:**
- A refund that would exceed the paid amount → rejected with a clear error, no Stripe call.
- After a boutique refund, the Payment status reflects it and the ledger has a `REFUND` row.

**Verify:** Attempt to refund more than paid → blocked. After a normal refund, `Payment.status` is `REFUNDED` and a `Transaction{REFUND}` row exists.

---

### H3. Stripe refund failures are silently swallowed

**Location:** `actions/boutique/returns.js:472-480`; `actions/boutique/orders.js:1086-1097`; `actions/workshops/manage-reservation.js:92-104`; `actions/appointment/manage-appointment.js:267-276`.

**Root cause:** DB transaction commits first (status flipped, credit note issued), then `stripe.refunds.create()` runs in a `try/catch` that only `console.error`s. If Stripe fails, the customer is told "Remboursé €X" while no refund happened — but the legal credit note is already issued. The webhook's own `refundSession` (`route.js:950-959`) does this correctly (re-throws); these four callers don't.

**Fix:** For each of the four callers:
1. Surface the failure to the operator, not the customer. Return `{ success: false, refundFailed: true, paymentId }` and show a retry button in the dashboard.
2. Do **not** tell the customer a refund happened until Stripe confirms.
3. Optionally: write a `refundPending` flag on the Payment and add a cron/dashboard retry. At minimum, the failure must not be silent.

**Acceptance criteria:**
- A Stripe refund failure → operator sees it, customer is not falsely told "refunded," DB state is consistent with reality, retry is possible.

**Verify:** Force a Stripe error (bad PI id in a test, or `stripe.refunds.create` stubbed to throw) → confirm the operator is notified and the customer-facing message does not claim success.

---

### H4. `expireStaleOrders` cron is not idempotent

**Location:** `actions/boutique/orders.js:1206-1269`.

**Root cause:** Selects stale orders, then per-order runs a tx that does `{ reservedQuantity: { decrement } }` and sets `status: "EXPIRED"`. No conditional gate on the status transition. Two overlapping cron runs (likely now that cron is being wired up per `PROJECT_REQUIREMENTS.md` §5) process the same order twice → double stock release + double expiry email. The `ProductVariant_reserved_within_stock` CHECK catches some cases but only after partial work.

**Fix:**
1. Atomic claim per order:
   ```js
   const claim = await tx.order.updateMany({
     where: { id: order.id, status: order.status },  // only if still in the original status
     data: { status: "EXPIRED", expiredAt: new Date() },
   });
   if (claim.count === 0) return; // already processed
   ```
2. Make the cron a singleton (Postgres advisory lock, e.g. `pg_try_advisory_lock`) so two schedules can't overlap.

**Acceptance criteria:** Two concurrent `expireStaleOrders` runs → each stale order processed exactly once.

---

### H5. Customer `cancelMyOrder` races webhook `fulfillOrderPayment`

**Location:** `actions/boutique/orders.js:1171-1196` (`cancelMyOrder`) vs `596-735` (`fulfillOrderPayment`).

**Root cause:** Both read the order outside their transaction and pass their status checks, then both mutate. If the webhook fulfills (creates Payment, decrements stock SALE, sets `PAID`) between the customer's read and the customer's `performOrderCancellation`, the cancellation overwrites `PAID` → `CANCELLED`, releases the reservation, and issues no refund. Customer charged, order dead, stock miscounted.

**Fix:** Both sides need the atomic claim from Pattern A:
1. `fulfillOrderPayment`: change `tx.order.update(...)` to `tx.order.updateMany({ where: { id, status: "PENDING_PAYMENT" }, ... })`; abort on `count === 0`.
2. `performOrderCancellation`: already covered by C4's atomic claim.

With both gated on the prior status, exactly one wins; the loser cleanly aborts. If the webhook wins, the cancellation sees `PAID` and either refuses (for `cancelMyOrder`, which is gated to pre-payment statuses) or refunds (for staff `cancelOrder`).

**Acceptance criteria:** A customer cancellation and a webhook fulfillment landing at the same instant → exactly one outcome, no orphaned payment, no stock drift.

---

### H6. Mondial Relay pickup point stored unvalidated

**Location:** `actions/boutique/orders.js:393-397`; `components/boutique/MondialRelayPicker.jsx:96-151`.

**Root cause:** Pickup-point fields (`id`, `name`, `address`, `postalCode`, `city`) come straight from client input and are stored verbatim. The Zod schema only checks the postal code regex and non-emptiness. Until the real widget is live, a customer can type any address and pay the pickup-point rate. Even with the widget, DevTools can fire `onChange` with arbitrary values.

**Fix:** When the real Mondial Relay widget is live (i.e. when `NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID` is set), validate `pickupPoint.id` against the Mondial Relay WSI4 point-search API server-side before order creation. Until then:
- Mark manual pickup-point orders as requiring staff review before label generation (the `generateShippingLabel` action is currently a stub — `actions/boutique/mondial-relay.js:48` — so today this only affects where the parcel is addressed, not the rate).

**Acceptance criteria:** A client-supplied pickup point that isn't a real MR point → rejected at order creation (once widget is live) or flagged for staff review.

---

### H7. Cron secret checked with `===` (not timing-safe)

**Location:** `app/api/cron/route.js:30`.

**Root cause:** `if (!secret || authHeader !== \`Bearer ${secret}\`)` — string `===` short-circuits on the first non-matching byte. The rest of the codebase uses `timingSafeEqual` correctly (`lib/autologin.js`, `actions/site-access.js`). This route was missed.

**Fix:** Replace with `crypto.timingSafeEqual` after a length check, mirroring `lib/autologin.js`.

**Acceptance criteria:** Timing-safe comparison; matches the rest of the codebase.

---

## 3. 🟡 MEDIUM / LOW (batch these after the criticals)

| # | Sev | Location | Fix |
|---|---|---|---|
| M1 | MED | `actions/boutique/orders.js:812, 962, 1012` | Gate `markOrderShipped` / `markOrderCompleted` / `markOrderReadyForPickup` with atomic `updateMany` on prior status (Pattern A). Prevents double emails and bad transitions. |
| M2 | MED | `lib/invoicing.js:82-94` | In `issueCreditNote`, sum existing credit notes for the invoice inside the tx; assert `existing + totalInclVat <= invoice.totalInclVat`. Defense in depth for C6. |
| M3 | MED | `actions/boutique/returns.js:404-406` | Decouple refund from credit note. Refund via Stripe + write `Transaction{REFUND}` regardless; create the credit note only if an invoice exists; surface the missing-invoice case to staff separately. Don't block the legal withdrawal right on a back-office doc gap. |
| M4 | MED | `app/api/webhooks/stripe/route.js:910` | Workshop seat-increase webhook re-validates `newTotalPrice`/`newDepositAmount` against the reservation's current state at webhook time, not just metadata. |
| M5 | MED | `app/api/webhooks/stripe/route.js` | Add a `charge.refunded` / `charge.dispute.created` handler so Dashboard-initiated refunds sync the DB (credit note, stock/seat reversal, Payment status). Today a Dashboard refund leaves the DB showing `PAID` and the books wrong — a Belgian TVA compliance gap. |
| M6 | MED | `app/api/webhooks/stripe/route.js:79-89` | Handle `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` explicitly (Bancontact async paths), and `checkout.session.expired`. |
| L1 | LOW | `actions/appointment/manage-appointment.js:213` | Decide whether `COMPLETED`/`NO_SHOW` appointments can be "rejected" + refunded. If not, remove them from the cancellable set (ties into C5). |
| L2 | LOW | `actions/boutique/products.js:224` | Add `requireAdmin()` to `getProductById`, or branch on role and use `withoutMargin` for non-admins (match what `getProducts` does). Currently leaks `costPrice`/`marginPercent`. |
| L3 | LOW | `actions/formations/create-formation-reservation.js:187`, `actions/workshops/create-workshop-reservation.js:156` | Add a Zod schema for `seatsCount` (integer, positive, bounded) validated **before** any account-creation side effects. Mirror the boutique validation. |
| L4 | LOW | `actions/formations/manage-reservation.js:71-85` | Await the `prisma.salon.findFirst(...).then(...)` chain and add `.catch` on the DB call. Currently an unhandled rejection risk. |
| L5 | LOW | many (`actions/**/waiting-list.js`, `notify-low-seats.js`, `send-reminders.js`, `actions/appointment/reminders.js`, `expireStaleOrders`) | Move pure-internal helpers out of `"use server"` files into `lib/`. They're callable directly from any client today. At minimum, add auth/role guards to each. |

---

## 4. Out of scope / decisions needed before coding

These came up during the audit but are **policy or product decisions**, not bugs. Do not build them without an answer — flag them back:

1. **Should appointments be prepaid online at all?** (Decides C2 Option 1 vs Option 2.)
2. **Can a `COMPLETED`/`NO_SHOW` appointment be cancelled + refunded?** (L1.) Likely no — a finished service shouldn't be reversible by a misclick.
3. **Partial cancellations of boutique orders (cancel one line item)?** Today orders are all-or-nothing; `performOrderCancellation` refunds the full `paidAmount`. If partial cancel is ever wanted, H2's cap + a per-item refund amount become load-bearing.
4. **Should `STAFF` be able to refund, or only `OWNER`/`ADMIN`?** Verify the role gate on every refund entry point matches policy.
5. **Atelier "low seats" thresholds differ between site banner (2 left) and email trigger (0–1).** Already flagged in `PROJECT_REQUIREMENTS.md` §3 as probably-a-bug. Pick one before prod.

---

## 5. Suggested implementation order

1. **C1 + C3** — the two auth bypasses. Small, contained, high impact. Do these first.
2. **C4 + C5 + C6** — the three double-refund races. Same fix pattern (Pattern A); do them together so the approach is consistent. Add the per-payment refund guard from H1/H2 as you go.
3. **H1** — `@unique` on `transactionReference` + fee-change idempotency. Prevents the duplicate-fulfillment class globally.
4. **C7 + H2 + H3** — webhook underpayment check, refund cap, refund-failure surfacing. These together make the money-out side honest.
5. **H4 + H5** — cron idempotency and cancel-vs-fulfill race. Do before wiring up the cron scheduler.
6. **Decide C2** (appointment payment) — blocks any prod ship that includes appointment prepayment.
7. **H6, H7, then the MEDIUM/LOW batch.**

Each CRITICAL = its own commit. Run the per-fix verification after each, not all at the end.

---

## 6. Cross-cutting verification (do this after the batch)

After the fixes land, before prod:

- **Concurrency sweep:** for every state-transitioning action (cancel, refund, return, fulfill, expire, fee-change), write a `Promise.all([f(id), f(id)])` test against the dev DB and confirm idempotency. This is the single most valuable verification you can do — it would have caught C4, C5, C6, H4 directly.
- **Webhook replay sweep:** resend 3-4 real Stripe events via `stripe events resend` and confirm zero duplicate rows in `Payment`, `Transaction`, `CreditNote`, `OrderItem`, reservations, and `stockMovement`.
- **Auth sweep:** for every `"use server"` function, confirm it either (a) calls `auth()` and verifies ownership/role, or (b) is intentionally public and documented as such. Grep for `"use server"` files and audit each export.
- **Refund integrity sweep:** pick a few paid orders/appointments, force refunds (including failures), and confirm: `SUM(Transaction{REFUND}) + SUM(CreditNote) <= Payment.paidAmount`, `Payment.status` correct, ledger complete.
- **`prisma migrate status` clean** before prod, and a fresh migration for the `@unique` constraint and `PARTIALLY_REFUNDED` enum.

---

*Generated 2026-08-06 from a four-axis audit (webhook, checkout pricing, authorization/IDOR, refund/return/stock) of branch `marwane`. Every file:line reference was verified against the live code. Where this doc says "Pattern A" or "Pattern B," the referenced code already implements the fix correctly elsewhere — copy it, don't reinvent it.*
