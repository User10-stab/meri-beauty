# Merri Beauty — Current DB & Logic Audit

**Date:** 2026-08-08  
**Branch / commit:** `marwane` at `a4d3bc0`  
**Scope:** current database and business-logic review, checked against the existing project audit/spec documents. This review is read-only; no application code was changed.

## Executive summary

The recent security work has closed many of the issues described in `SECURITY_FIXES_SPEC.md`: payment source XOR constraints, appointment overlap constraints, payment transaction-reference uniqueness, refund states, authorization narrowing, underpayment checks, and several atomic claims are present in the current branch.

Six current defects or material data-model gaps remain. The most important can leave appointment availability permanently blocked or duplicate accounting records and legal credit notes. The additional findings below cover singleton integrity, cancellation auditability, and rental-to-contract traceability. One schema-cleanup item is recorded separately as informational.

## Findings

### HIGH — Unpaid appointment checkout rows never expire and can permanently block a slot

**Evidence**

- `actions/payment/createCheckoutSession.js:291-346` creates an `Appointment(PENDING)` and `Payment(PENDING)` before calling Stripe.
- `actions/payment/createCheckoutSession.js:426-429` deliberately keeps both rows when Stripe session creation fails.
- Abandoning a successfully-created Stripe Checkout also leaves the same rows pending.
- `actions/payment/createCheckoutSession.js:294-316` reuses a pending row only for the same customer/fingerprint; other customers still see the appointment as an occupied slot.
- The appointment schema has no hold-expiry timestamp, and neither `app/api/cron/route.js`, `app/api/cron/appointments/route.js`, nor `lib/background-jobs.js` expires stale pending appointment payments.
- Slot/conflict queries treat `PENDING` as occupied, and the PostgreSQL overlap constraint also covers active pending appointments.

**Impact**

A customer who closes Stripe Checkout—or a Stripe API failure after the DB transaction—can reserve a staff slot forever until a human manually rejects/cancels the appointment. Repeated abandoned attempts can make otherwise free calendar time unavailable.

**Recommended fix**

Add an appointment/payment hold expiry (for example 15 minutes, consistent with workshops/formations), exclude expired holds from availability, and add an idempotent expiry job that atomically changes stale `PENDING` appointments/payments to a terminal state. The database exclusion constraint must also exclude expired holds, which may require changing status during expiry rather than relying only on a timestamp.

**Verification**

Create an online-payment appointment, abandon Checkout, advance past the hold duration/run the expiry job, and confirm another customer can book the same staff/time while a late Stripe completion is refunded rather than resurrecting the expired appointment.

### HIGH — Concurrent `charge.refunded` deliveries can duplicate refund ledger entries and credit notes

**Evidence**

- `app/api/webhooks/stripe/route.js:255-268` reads all existing refund transactions and calculates `newlyRefunded` before entering a transaction or acquiring a row lock.
- `app/api/webhooks/stripe/route.js:276-297` then unconditionally creates a new `Transaction(REFUND)` and credit note.
- `prisma/schema.prisma:1312-1327` has no unique Stripe event/refund identifier on `Transaction` and no constraint that can reject the duplicate.

Two concurrent deliveries can both read the same `alreadyRecorded` total, both calculate the same positive delta, and both commit. The comment at lines 270-272 only handles sequential redelivery, not concurrent redelivery.

**Impact**

The application can record twice the amount actually refunded by Stripe, generate two legal credit notes, and corrupt VAT/accounting exports. Payment status alone does not expose the duplication because both transactions write the same final status.

**Recommended fix**

Store and uniquely claim the Stripe event ID, or lock the `Payment` row and recompute the refund total inside the same transaction. Prefer both: a `ProcessedStripeEvent(eventId @unique)` claim provides event idempotency, while a payment row lock protects delta calculations across different refund events for the same charge.

**Verification**

Invoke the handler concurrently twice with the same `charge.refunded` event. Assert exactly one refund transaction and one credit note exist and their summed amount equals Stripe's `amount_refunded`.

### MEDIUM — Reminder jobs are not concurrency-safe and can send duplicates

**Evidence**

- `lib/background-jobs.js:6-15` explicitly claims reminder jobs are safe to run concurrently with HTTP-triggered jobs.
- `actions/appointment/reminders.js:20-61` performs `findMany` with a `notifications.none` filter, then a separate unconditional `Notification.create`. `Notification` has no uniqueness constraint for `(appointmentId, type, title)`.
- `actions/workshops/send-reminders.js` and `actions/formations/send-reminders.js` perform `findMany(reminderSentAt: null)`, then separate unconditional updates. Two workers can select the same row before either update commits.
- Emails are dispatched after those non-conditional writes, so both workers can send.

**Impact**

Server startup jobs and either cron endpoint can overlap, causing customers to receive duplicate 24-hour/2-hour reminders. Multiple application processes make this more likely.

**Recommended fix**

Atomically claim each reminder before sending. For workshop/formation reservations use `updateMany({ where: { id, reminderSentAt: null }, data: { reminderSentAt: now } })` and send only when `count === 1`. For appointments add a database unique key for the reminder identity and treat unique conflicts as already claimed, or introduce a dedicated reminder-delivery table with a unique `(appointmentId, window)` key.

**Verification**

Run each reminder function concurrently with `Promise.all`. Assert one claim row/timestamp transition and one email invocation per reservation/window.

### MEDIUM — `Salon` is treated as a singleton but the database does not enforce it

**Evidence**

- `prisma/schema.prisma:497-520` gives `Salon` a generated CUID primary key and has no singleton sentinel or other unique constraint that limits the table to one row.
- More than twenty call sites use unordered `prisma.salon.findFirst()`, so their result becomes nondeterministic if the table contains two rows. These call sites affect availability, invoicing identity, contact details, newsletters, shipping, Stripe alerts, closures, and working hours.
- `actions/salon/update-salon.js:28-47` uses `findFirst()` followed by `create()` when empty. Two concurrent first-time settings submissions can both observe an empty table and create separate rows.
- `prisma/seed.mjs` already assumes a stable `id: "main-salon"`, but normal application writes do not preserve that convention.

**Impact**

If a duplicate is created, different requests can use different salon contact information, opening hours, closures, or legal invoice identity. This is low probability after initial setup but high fan-out because the singleton assumption is embedded across the application.

**Recommended fix**

Standardize all reads and writes on `id: "main-salon"` and use `upsert`, or add a required sentinel column with a database unique constraint. Before applying the migration, check the live table for duplicates and reconcile them explicitly rather than deleting one automatically.

### LOW — Appointment cancellation actor and reason are not persisted

**Evidence**

- `WorkshopReservation` and `FormationReservation` persist `cancelledAt`, `cancelledByUserId`, and a relation to the cancelling user.
- `Appointment` has only its final `status`; it has no cancellation timestamp, actor, or reason fields.
- `rejectAppointment(appointmentId, reason)` accepts a reason and uses it for downstream communication, but the status update persists only `CANCELLED`.
- Customer cancellation and cancellation caused by payment/refund safety paths likewise write only the status.

**Impact**

Support, refund disputes, staff accountability, and incident investigation cannot determine from the database who cancelled a regular appointment, when, or why. This is an auditability/data-retention gap rather than a direct booking-correctness failure.

**Recommended fix**

Add nullable `cancelledAt`, `cancelledByUserId`, `cancelReason`, and an explicit cancellation source for system/webhook cancellations. Populate them in every cancellation path in the same transaction as the status transition.

### LOW / DESIGN GAP — Approved rental requests are not traceable to the resulting contract

**Evidence**

- `RentalRequest` stores a broad `commissionType` but no proposed/accepted percentage or fixed-rent amount and no `staffId`/`contractId` relation.
- `actions/staff/create-staff-from-rental.js` creates the `Staff` and `Contract`, but it receives no rental-request ID and cannot link the generated records back to the request.
- The generated contract is currently always `FIXED_RENT`, independently of the request's `commissionType`.

**Impact**

After approval, the database cannot prove which contract fulfilled a request or preserve the commercial terms proposed versus accepted. This may be an intentionally manual workflow, so it should be confirmed as a product requirement before being treated as a release blocker.

**Recommended fix**

If approval is meant to create staff automatically, pass the rental-request ID into one transaction, persist the agreed financial fields, link the request to the resulting staff/contract, and atomically transition the request to `APPROVED`.

### INFORMATIONAL — Unused `Language` enum remains in the Prisma schema

`prisma/schema.prisma:90-96` retains a `Language` enum, while `Staff.languages` is a `String[]` and current code does not reference the enum. It has no runtime correctness impact. Remove it during a future related migration after confirming no external SQL/reporting consumer depends on the database enum type.

## Environment and verification results

- `npm run lint`: passes with 14 `no-img-element` performance warnings and no errors.
- `npx tsc --noEmit`: passes.
- `node --test tests/*.test.js`: passes, but the suite contains only one test file (`reservation-payment.test.js`), so none of the concurrency paths above are covered.
- `npx prisma validate`: passes.
- Production build: compilation succeeds when network access is available; the restricted run fails while fetching/building external resources. The successful compile reports Edge-runtime compatibility warnings from Prisma/Auth imports and 14 image warnings.
- Live app: `localhost:3000` was not reachable from the audit environment. Starting Next locally is blocked here by `listen EPERM`, so browser/live route checks could not be performed.
- Database: the configured datasource is PostgreSQL at `localhost:5432`, but repeated attempts still returned `P1001`. Migration status and live invariant/data checks could not yet be performed even after the live database was reported available; the port/tunnel is not visible from this execution environment.

## Recommended order

1. Fix and test stale appointment hold expiry.
2. Make external refund synchronization event-idempotent and payment-serialized.
3. Make all reminder claims atomic.
4. Enforce the `Salon` singleton after checking/reconciling live rows.
5. Add concurrency regression tests for the four race-sensitive findings before release.
6. Add appointment cancellation audit fieqqqqqqqqqqqqqqqqqqqqqqqqlds; confirm the intended rental approval workflow before changing its schema.
