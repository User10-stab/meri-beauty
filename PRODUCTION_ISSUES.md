# Production Issues — Full Audit Findings

**Project:** Meri Beauty (Next.js 16 + NextAuth v5 + Prisma)
**Audited branch:** `origin/marwane` @ `fd7ced1` (13 commits ahead of local checkout as of 2026-08-10)
**Audits run:** Security, Money/Payments, Race Conditions/Data Integrity
**Status:** Local file only — not committed, not pushed.

---

## How to read this

Each issue is tagged `[SEC]` (security), `[MONEY]` (payment/pricing), or `[RACE]` (concurrency/data integrity). Severity is the audit's rating. File:line references point at the `origin/marwane` tree.

**The good news up front:** the audits found **zero CRITICAL issues**. The core money and integrity guarantees are genuinely enforced — no way to steal money, forge payments, double-book, or corrupt stock/invoice flows. The issues below are real but bounded; the 🔴 set is what I'd fix before launch.

---

## 🔴 FIX BEFORE LAUNCH (real money / integrity / security impact)

### 1. [MONEY M9] Workshop cancellation over-counts refunds in the ledger
**File:** `actions/workshops/manage-reservation.js:135`
**What's wrong:** `cancelWorkshopReservation` records the refund `Transaction` with `amount: payment.paidAmount` (the gross), ignoring any prior partial refund. Its siblings (`performOrderCancellation` at `actions/boutique/orders.js:957-964`, `rejectAppointment` at `manage-appointment.js:174-180`) correctly compute `remaining = paidAmount - alreadyRefunded`. Workshop is the outlier.
**Impact:** After a dashboard partial refund + a workshop cancellation, the ledger shows `refunded = priorPartial + full paidAmount`, overstating refunds. Revenue reports and TVA exports are wrong. Stripe itself doesn't over-refund (no `amount` param = remaining only), so no customer-side over-payment.
**Fix:** `cancelWorkshopReservation` must compute `remaining = paidAmount - alreadyRefunded` like its siblings and pass that as the `amount` to both `stripe.refunds.create` and the `Transaction{REFUND}` row. Severity arguably HIGH (tax-reporting integrity).

---

### 2. [MONEY H5] Appointment balance-then-refund over-claims in the ledger
**Files:** `actions/appointment/manage-appointment.js:425-432` (balance collection) vs `:174-180` (refund cap)
**What's wrong:** `completeAppointment({ method: "CASH" })` sets `payment.paidAmount = totalAmount` and writes a `FINAL_PAYMENT` transaction *before* the cash is physically collected. If staff never actually received the cash, the DB now believes the full amount was paid. A later `rejectAppointment` caps the refund at `paidAmount` (now the full total) → tries to refund money that was never collected.
**Impact:** Stripe blocks the actual over-refund (throws → `REFUND_FAILED`), but the internal ledger claims €X cash was collected and €X refunded. Dashboard revenue/reports wrong; customer gets a "we'll refund you" email promising more than was collected.
**Fix:** Cap `rejectAppointment`'s refund at the sum of `ONLINE`-method transactions, not total `paidAmount`. Or gate the cash-balance write behind a separate "balance collected" confirmation step.

---

### 3. [RACE H1] `retryFailedRefunds` + `reconcileMissedRefunds` run concurrently → duplicate refund ledger rows
**File:** `app/api/cron/route.js:33-41` (the `Promise.all`)
**What's wrong:** The cron handler runs both jobs simultaneously. If a Payment is in `REFUND_FAILED`/`REFUND_PENDING`, the retry job calls `stripe.refunds.create` and writes the `Transaction{REFUND}` row in a *separate, later* transaction (not under any lock). If the reconcile job runs in the window between Stripe accepting the refund and the ledger row being committed, it sees stale `alreadyRecorded`, computes `newlyRefunded > 0`, and writes a second `Transaction{REFUND}` for the same Stripe refund.
**Impact:** Duplicate refund ledger rows, possibly duplicated credit notes. Revenue/TVA accounting wrong. No customer-side money duplication (Stripe caps the actual payout).
**Fix (one-line):** Drop the `Promise.all` and `await` the two jobs sequentially in the cron handler. More robust: have `retryFailedRefunds` acquire `pg_advisory_xact_lock('external-refund:' || payment.id)` and write the `Transaction{REFUND}` row *before* the Stripe call (optimistic, rollback on failure) — same pattern `performOrderCancellation` already uses.

---

### 4. [RACE H2] Workshop seat-increase webhook commits without capacity re-check → overbooking
**Files:** `app/api/webhooks/stripe/route.js` (`applyWorkshopSeatsChangeFee` ~line 1180, `applyWorkshopSessionChangeFee` ~line 1070); admin action `actions/workshops/manage-reservation.js:362-367`
**What's wrong:** Admin increases a reservation's seat count. The availability check happens at link-creation (no lock), but the actual `seatsCount` mutation happens *later in the webhook*, minutes later (after the customer pays the change fee on Stripe's hosted page). Two admins each increasing seats on the same session: both see capacity available, both customers pay, both webhooks commit with only a `updateMany WHERE seatsCount !== seats` guard — **no capacity re-check, no FOR UPDATE on the session row**.
**Impact:** Workshop/formation session overbooked — customers arrive for seats that don't exist. Reputational + refund burden.
**Fix:** In `applyWorkshopSeatsChangeFee` / `applyWorkshopSessionChangeFee`, before the `updateMany`, take `SELECT id FROM workshop_sessions WHERE id = ? FOR UPDATE` inside the transaction, re-aggregate `SUM(seatsCount)`, reject (refund the fee + revert) if the increase would exceed capacity. Mirror `createWorkshopReservation:266-294` which already does this lock-then-aggregate.

---

### 5. [MONEY H1/H8] `PICKUP_ON_SITE` order expiry can leak merchandise
**Files:** `actions/boutique/orders.js:734-853` (`completeOrderPickup`), `lib/orders/expire-stale-orders.js:24-66`
**What's wrong:** "Pay on site" mode never decrements real stock at order time (only `reservedQuantity`). Real stock decrement + SALE movement only happens when staff run `completeOrderPickup`. If staff hand over the goods but forget to run `completeOrderPickup`, the order auto-expires at 7 days, `reservedQuantity` is released, and the system shows full stock for items the customer physically has. No payment record, no invoice, no SALE movement.
**Impact:** Free merchandise + phantom inventory. No alert surfaces that an on-site order expired (which should always be investigated as a potential leak).
**Fix:** (a) For `PICKUP_ON_SITE` expirations, send an internal staff alert and require admin acknowledgement before releasing stock. (b) Optionally forbid status transition out of `PENDING_PICKUP`/`READY_FOR_PICKUP` without `completeOrderPickup`.

---

### 6. [MONEY L4] Shipping tiers are PLACEHOLDERS — real Mondial Relay rates not wired in
**File:** `lib/shipping.js:8-20` (the `MONDIAL_RELAY_TIERS_PLACEHOLDER` array)
**What's wrong:** The file's own header documents these as placeholders carried over from old bpost rates. Every shipped order's margin is wrong until the real rates are wired in.
**Impact:** Operationally the single biggest concrete money risk — salon loses or gains the delta between placeholder and real Mondial Relay charges on every shipment.
**Fix:** Replace with real Offre Start rates. Marie confirmed **Grille n°2 (Offre Start, par palier de colis/mois)** in her latest form response (2026-08-10). Source: `https://www.mondialrelay.be/solutions-professionnels/nos-offres-ecommercants/offre-start`. Rated LOW only because it's a known/documented placeholder — operationally HIGH.

---

## 🟠 FIX SOON (security + correctness, narrow risk — first week post-launch)

### 7. [SEC H1] `rescheduleAppointment` skips `validateAppointmentSlot`
**File:** `actions/reservation/reschedule-appointment.js:113-160`
**What's wrong:** Checks ownership, the 48h window, past time, and conflict — but never calls `validateAppointmentSlot` (unlike its sibling `createReservation` which the P0 commit specifically hardened). So a customer can reschedule their own booking to a salon closing day, a staff day-off, or outside working hours.
**Exploit:** Authenticated customer edits their booking to a day the salon is closed → phantom CONFIRMED appointment the salon can't honor.
**Fix:** After computing `startTime`/`appointmentDate`, call `validateAppointmentSlot` and early-return on invalid, mirroring `createReservation:232`.

---

### 8. [SEC H2] `createService` has no role check — any customer can create Service rows
**File:** `actions/services/create-service.js:125-251`
**What's wrong:** The only guard is `if (!session?.user)`. No check that the role is STAFF/ADMIN/OWNER. Sibling `updateService`/`deleteService` in the same file DO enforce role (lines 299/469). A CUSTOMER can invoke this server action directly, skip the STAFF auto-assign and admin branches, and create a `Service` row with empty staff assignments.
**Impact:** Authenticated customer pollutes the service catalog with arbitrary services. Not directly bookable (no StaffService), but data integrity / brand-vandalism; appears in admin lists.
**Fix:** Add `canAccessDashboard(session.user.role)` or an explicit role check at the top of `createService`, before the category lookup. One-liner mirroring `updateService`.

---

### 9. [SEC H3] `resumeCheckoutAfterVerification` trusts client-supplied `userId` → password-overwrite oracle
**File:** `actions/shared/resume-checkout-after-verification.js:38-66`
**What's wrong:** A directly-invocable `"use server"` export. Takes `userId` from the client and immediately does `prisma.user.update({ password: hashedPassword })` + sends a credentials email. No auth, no token check, no ownership check. The intended caller passes `userId` from a verified token result, but the action itself trusts the client.
**Exploit:** Attacker loops over candidate user ids calling this action. Each call overwrites that user's password and emails it to the user's own address. Impact: mass forced password resets / account-lockout DoS (attacker doesn't receive the new password — not takeover) + outbound email spam via the salon's mailer.
**Fix:** Don't trust client `userId`. Either (a) require the raw verification token here and re-resolve the user from a valid, unused, checkout-tagged token (like `resetPassword` does), or (b) make this function non-exported and have `verifyEmail` itself do the resume server-side before returning.

---

### 10. [RACE H3] `joinWaitingList` — duplicate queue positions
**Files:** `actions/workshops/waiting-list.js:111-127`, `actions/formations/waiting-list.js` (near-identical), schema `WaitingListEntry` (`prisma/schema.prisma:365-387`)
**What's wrong:** Reads `lastEntry.position`, computes `nextPosition = position + 1`, inserts — all outside any transaction/lock. Two customers joining the same session's waiting list simultaneously both read the same `position`, both insert with the same `nextPosition`. No unique constraint on `(sessionId, position)` — `@@index([sessionId, position])` is non-unique.
**Impact:** Corrupted queue ordering; both customers get a "you are #N" email with the same number; "first come, first served" violated. Not money-affecting.
**Fix:** Either (a) wrap in a transaction with `SELECT ... FOR UPDATE` on the session before computing position, (b) add `@@unique([sessionId, position])` and retry on P2002, or (c) make `position` a `bigserial`/`autoincrement()`. Option (c) is cleanest if a schema migration is acceptable.

---

### 11. [MONEY M2] 100% promo code is createable → produces €0 Stripe session → checkout crashes
**Files:** `lib/validations/promo-codes.js:33-37` (caps PERCENTAGE at 100), `lib/promo-codes.js:8-11` (`Math.min(raw, subtotal)`), checkout actions
**What's wrong:** A 100% code yields `discountAmount === subtotal` → €0 order. `createOrderCheckoutSession` builds a Stripe session with line items totalling 0 → Stripe rejects `Invalid integer`. Same for workshops/formations (€0 session). Customer gets a generic error; the order row exists at €0 in a broken state.
**Impact:** Broken UX. 100%-off is a legitimate "comp" tool but the code doesn't short-circuit a €0 charge to "mark paid without Stripe."
**Fix:** In each checkout action, if computed `totalAmount <= 0`, skip Stripe and mark the order/reservation paid directly. Or reject 100% codes outright in validation.

---

### 12. [MONEY M3] Promo codes have no expiry date and no per-code usage limit
**Files:** `prisma/schema.prisma:1238-1251` (PromoCode model), `lib/promo-codes.js` (resolution)
**What's wrong:** Schema fields: `code, type, value, minOrderAmount, isActive, createdAt, updatedAt`. No `expiresAt`, no `maxUses`, no `usedCount`. The validation comment explicitly says "never auto-expire." `resolvePromoCode` checks only `isActive` + `minOrderAmount`.
**Impact:** A leaked or typo'd code (e.g. 90% instead of 9%) is valid forever with no cap — drains revenue indefinitely.
**Fix:** Add `expiresAt DateTime?` and `maxUses Int?` / `usedCount Int @default(0)` to the PromoCode model + migration. Enforce in `resolvePromoCode`.

---

### 13. [MONEY H6/H7] Refund `Transaction` rows missing `stripePaymentIntentId` in several paths
**Files:** `lib/payments/retry-failed-refunds.js:79-82` (retry success), `actions/appointment/manage-appointment.js:233-240`, `actions/workshops/manage-reservation.js:124-141`
**What's wrong:** These paths create a `Transaction{REFUND}` row without `stripePaymentIntentId`. Compare `performOrderCancellation` (`orders.js:1044-1053`) which sets it correctly. The fast-path in `reconcile-missed-refunds.js` (`findPaymentForPaymentIntent`) looks up by `Transaction.stripePaymentIntentId` — without it, the safety net's linkage degrades.
**Impact:** The reconciliation chain still works (advisory lock prevents double-refund, and the slower lookup path resolves the Payment), but it's fragile. A future refactor could silently break it.
**Fix:** Set `stripePaymentIntentId` from `stripeSession.payment_intent` in the retry's `transaction.create`. Set it from the session in the appointment/workshop cancel paths (before the `transaction.updateMany` backfill).

---

### 14. [MONEY H3] Change-fee webhook branches skip the amount-verification check
**Files:** `app/api/webhooks/stripe/route.js` `applyWorkshopSessionChangeFee` (~line 1070), `applyWorkshopSeatsChangeFee` (~line 1180)
**What's wrong:** Unlike the four main `checkout.session.completed` paths (order/workshop/formation/appointment) which all have explicit `paidAmount + UNDERPAYMENT_EPSILON < expectedAmount` checks, the change-fee branches read `changeFeeAmount = session.amount_total / 100` and apply unconditionally. No expected-amount comparison.
**Impact:** Low real-world money risk (line item is built server-side from `reservation.totalPrice * 0.1`, customer can't tamper). Breaks the otherwise-uniform "verify amount" invariant. If Stripe ever applies a partial refund or the session is replayed, the system trusts whatever Stripe reports.
**Fix:** Add the same `expectedAmount` guard the other paths have.

---

## 🟡 HARDENING (post-launch acceptable)

### 15. [RACE M1] Concurrent appointment booking creates an orphan account for the race loser
**File:** `actions/reservation/create-reservation.js:330-359`
**What's wrong:** DB constraint (`btree_gist` EXCLUDE) prevents the double-booking itself — loser's transaction rolls back. But `resolveOrCreateCustomer` runs *before* the transaction, so the loser still created a real user account / sent a welcome email / generated an autologin token for a booking that then failed. Also: the exclusion-violation error isn't caught specifically → generic French error instead of "Ce créneau vient d'être réservé."
**Fix:** Move `resolveOrCreateCustomer` inside the transaction (or after the appointment insert succeeds). Catch `err.code === '23P01'` (exclusion violation) to return the friendly "slot just taken" message. Same in `createCheckoutSession`.

---

### 16. [RACE M2] Cron has no overlap protection (no mutex)
**File:** `app/api/cron/route.js`
**What's wrong:** If the external scheduler fires again while a previous invocation is still running, both run. Mitigated by atomic claims on every expiry/cancel path, but widens issue #3 (H1) and doubles Stripe API calls.
**Fix:** Add a `pg_advisory_lock` at the top of the GET handler (released on response), or configure the external scheduler to guarantee non-overlap.

---

### 17. [MONEY M1] Display pricing uses raw floats — cart total can drift ±1¢ from Stripe charge
**File:** `lib/pricing.js:23-26, 50-65`
**What's wrong:** `calculateItemPricing` returns `totalPrice = price * quantity` unrounded, `subtotalExclVat = totalPrice / 1.21` unrounded, and `calculateCartPricing` sums unrounded floats. The Stripe charge (built in `createOrderCheckoutSession`) uses `Math.round(Number(item.unitPrice) * 100)` per line. A cart of many fractional-price items can show €X.XX on the React total but charge €X.XX±0.01 at Stripe. The webhook then rejects it as underpayment and refunds — the customer sees a confusing "payment refunded."
**Fix:** Round per-line in `pricing.js` (`round2(price * quantity)`, `round2(total / 1.21)`).

---

### 18. [SEC M1] Dead but reachable `createAppointment` lacks `validateAppointmentSlot`
**File:** `actions/appointment/create-appointment.js:75`
**What's wrong:** A `"use server"` export with zero callers (real flow is `createReservation`). Does only a manual conflict check — no working-hours/closures/time-off/past-time validation. Auth present but no role/ownership check.
**Fix:** Delete this unused function, or move it out of a `"use server"` file, or add the same `validateAppointmentSlot` + ownership logic as `createReservation`.

---

### 19. [SEC M2] `joinFormationWaitingList` is not rate-limited (inconsistent with workshop)
**File:** `actions/formations/waiting-list.js:32`
**What's wrong:** The workshop counterpart `joinWaitingList` is rate-limited (`isRateLimited("join-waiting-list", ...)`); the formations version is not. Creates user accounts (bcrypt hashing) and sends emails on every call.
**Fix:** Add the same rate-limit block as `joinWaitingList` (keyed on `email:ip`).

---

### 20. [SEC M3] Checkout-session creation endpoints are not rate-limited
**Files:** `actions/payment/createCheckoutSession.js`, `actions/payment/resume-reservation-payment.js`, `actions/boutique/orders.js` (`createOrderCheckoutSession`), `actions/formations/create-formation-reservation.js`, `actions/workshops/create-workshop-reservation.js`
**What's wrong:** Guest *hold*-creation paths are rate-limited, but the pure "build a new Stripe Checkout Session for an existing reservation/order" actions are not. Each makes a Stripe API call and writes `stripeCheckoutSessionId`.
**Fix:** Add a light `isRateLimited` guard keyed on `userId/ip` or `reservationId/ip`.

---

### 21. [SEC M4] File upload trusts MIME header without magic-byte verification
**File:** `app/api/upload/route.js:62-66`
**What's wrong:** MIME is whitelisted and extension forced from validated MIME map (good — defeats the prior XSS-via-spoofed-extension bug). But the MIME type is read from `file.type` (client-supplied) without checking the file's actual magic bytes.
**Impact:** Limited — dashboard-authed users only (STAFF/ADMIN/OWNER), CSP blocks script execution, extension forced to image type. A polyglot/corrupt file could be served.
**Fix:** Validate the buffer's magic bytes (JPEG/PNG/WEBP/GIF signatures) before writing.

---

### 22. [SEC M5] `getProductCategories` / `getCatalogueTree` expose inactive categories without auth
**Files:** `actions/boutique/categories.js:48, 95`
**What's wrong:** `"use server"` reads with no `auth()` check. A client can pass `includeInactive:true` to enumerate the full (incl. disabled) category structure.
**Fix:** Gate `includeInactive` behind dashboard auth, or drop the inactive branch for unauthenticated callers.

---

### 23. [MONEY M4] Seat-change fee computed from `reservation.totalPrice` — after a promo, fee is disproportionate
**File:** `actions/workshops/manage-reservation.js:213`
**What's wrong:** `SESSION_CHANGE_FEE_RATE = 0.1` applied to `Number(reservation.totalPrice)` which is post-discount. After a 50% promo, the change fee is 10% of the discounted price. May be intended, but inconsistent. Low money impact.
**Fix:** Document or pick one basis consistently.

---

### 24. [MONEY M6] Invoice line totals not asserted against invoice total
**File:** `lib/invoicing.js:50-55, 117`
**What's wrong:** `subtotalExclVat = round2(total / 1.21)`, `vatAmount = round2(total - subtotalExclVat)` (correct Belgian TTC-derivation). But `InvoiceLine.lineTotal = round2(unitPrice * quantity)` independently, and the sum of line totals is NOT checked against `subtotalExclVat + vatAmount`. Low real risk because in the order flow both are built from the same `unitPrice`.
**Fix:** Add an assertion `sum(lineTotal) === totalInclVat` inside `issueInvoice`.

---

### 25. [MONEY M7] `issueCreditNote` cap check relies on outer lock for concurrent-safety
**File:** `lib/invoicing.js:125-137`
**What's wrong:** Aggregates existing `CreditNote.totalInclVat` inside the caller's `tx`. Because Prisma interactive transactions use the same snapshot, two concurrent credit-note issuances for the same invoice could both read the same "already issued" sum and both pass. Currently safe because every caller acquires an outer lock (advisory lock / FOR UPDATE / atomic claim), but fragile if a future caller forgets the lock.
**Fix:** Add a `SELECT ... FOR UPDATE` on the invoice row inside `issueCreditNote` itself. Defense-in-depth.

---

### 26. [RACE M3] `expireStaleOrders` vs in-flight payment — order cancelled, then payment refunded
**Files:** `lib/orders/expire-stale-orders.js`, `lib/orders/fulfill-order-payment.js:48-67`
**What's wrong:** A `PENDING_PAYMENT` order hits its 30-min expiry while the customer's card charge clears at the same moment. Expiry claims the order → cancelled, stock released. Webhook then sees CANCELLED → refunds the just-cleared charge. This is the *documented, correct behavior* (customer gets refunded, not double-charged), but the UX is confusing — they paid, saw a success screen, then got a "cancelled/expired" email + refund days later. The item may have been the last one and now goes back to stock.
**Fix:** In `expireStaleOrders`, before claiming a `PENDING_PAYMENT` order with a `stripeCheckoutSessionId`, retrieve the session and skip expiry if `payment_status === "paid"` — let the webhook fulfill it. Mirrors the guard already in `createOrderFromCart`'s supersede path (`orders.js:255-272`).

---

### 27. [RACE M4] Double-tab checkout session creation — orphan Stripe sessions, possible spurious refund
**Files:** `actions/boutique/orders.js:569-616`, `actions/workshops/create-workshop-reservation.js:23-72`, `actions/formations/create-formation-reservation.js:22-72`
**What's wrong:** Customer opens checkout in two tabs. Both call `createOrderCheckoutSession(orderId)`. Two Stripe sessions created, both with `metadata.orderId = X`. Last writer wins on `order.stripeCheckoutSessionId`; the previous session stays valid in Stripe. Webhook is idempotent (`Payment.transactionReference` unique + P2002 catch), so no money corruption. But if both sessions are paid (rare), `fulfillOrderPayment` sees the order is no longer pending and refunds the second as `ORDER_NO_LONGER_PENDING` — spurious refund + cancellation.
**Fix:** At the top of `createOrderCheckoutSession`, if `order.stripeCheckoutSessionId` is already set and the session still exists + is open, return its existing URL instead of creating a new one.

---

### 28. [MONEY M9-alias] Partial dashboard refund on a workshop leaves the seat unreleasable
**Files:** `app/api/webhooks/stripe/route.js:300-359`, `lib/payments/reconcile-reservation-refund.js:53-56`
**What's wrong:** `reconcileExceptionalReservationFullRefund` returns early with `reason: "partial-refund"` if not fully refunded. So a partial goodwill refund (admin in Stripe dashboard) leaves the workshop seat CONFIRMED but the ledger `PARTIALLY_REFUNDED`. Then `cancelWorkshopReservation` (issue #1) over-counts the refund because it doesn't cap against the prior partial.
**Fix:** Resolved by fixing issue #1 (cap workshop refund at `paidAmount - alreadyRefunded`). Then the cancellation path handles prior partials correctly.

---

## ✅ VERIFIED CLEAN (so you don't re-audit)

These were checked and found correct:

- **Auth/session**: bcrypt cost 12 everywhere; JWT `maxAge` 7d; 5-min DB revalidation; `sessionVersion` invalidation on password change; CUSTOMER/STAFF blocked from login until `emailVerified`; deleted/inactive accounts rejected.
- **Password reset**: bcrypt-hashed single-use tokens, 15-min expiry, table-scan rate-limited, `sessionVersion` bumped.
- **Email verification**: hashed, single-use, expiry, cannot skip.
- **IDOR**: ownership checks verified on `cancelReservation`, `cancelMyOrder`, `rescheduleAppointment`, review creation, invoice/credit-note PDF routes, order/appointment history, profile.
- **Stripe webhook**: signature verified against raw body; idempotent via `Payment.transactionReference` unique; underpayment/cancelled-order auto-refund; atomic status claims.
- **Injection**: zero `$queryRawUnsafe`/`$executeRawUnsafe`; all raw SQL uses tagged templates or `Prisma.sql`.
- **Signed tokens**: autologin (HMAC, 10-min exp, `timingSafeEqual`, fail-closed), newsletter unsubscribe (HMAC, `timingSafeEqual`), Stripe OAuth state (HMAC-signed, expiry, nonce, session re-check), calendar feed (128-bit random DB-stored, revocable), cron secret (`timingSafeEqual`, fail-closed).
- **Site-access gate**: cookie stores SHA-256 of the gate password (not user input); `timingSafeEqual`; `httpOnly`/`secure`/`sameSite`/`maxAge`; fails closed when unset.
- **Security headers**: CSP (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `unsafe-eval` dev-only), HSTS (prod, 2y, includeSubDomains, preload), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy.
- **Secrets**: no `.env` committed; `.env*` gitignored; no hardcoded keys/passwords/tokens in source.
- **Rate limiting**: eviction fix present; namespaces cover login, register, forgot/reset password, verify-email, contact, VAT, guest-checkout-holds, init-customer-verification, join-waiting-list (workshops).
- **Mass assignment**: all update actions use strict Zod schemas — none accept `role`/`isActive`/`isDeleted`/`emailVerified` from client (except admin-only `updateCustomer.isActive`).
- **Stock negative**: PREVENTED — `ProductVariant_stock_non_negative` CHECK + atomic decrement + FOR UPDATE at checkout.
- **Appointment double-booking**: PREVENTED — btree_gist EXCLUDE on `(staffId, tsrange)`, re-keyed correctly in migration `20260806103000`.
- **Workshop/formation last-seat race (initial booking)**: PREVENTED — FOR UPDATE on session row in both `createWorkshopReservation` and `createFormationReservation`.
- **Gapless invoice numbering**: CORRECT — `NumberingCounter` INSERT … ON CONFLICT … RETURNING, atomic.
- **Stripe amounts in cents**: every `unit_amount` and `stripe.refunds.create({ amount })` uses `Math.round(x * 100)`.
- **Promo discount never negative**: `Math.min(raw, subtotal)` + outer `Math.max(0, …)`.
- **Cart modification after session creation**: line items built from `order.items` snapshot, not live cart.
- **Empty cart prevention**: blocked at `createOrderFromCart`.

---

## Summary by severity

| Severity | Count | IDs |
|---|---|---|
| 🔴 Fix before launch | 6 | 1, 2, 3, 4, 5, 6 |
| 🟠 Fix first week | 8 | 7, 8, 9, 10, 11, 12, 13, 14 |
| 🟡 Hardening | 14 | 15–28 |
| ✅ Verified clean | ~30 areas | (see above) |
| CRITICAL | **0** | — |

**Bottom line:** No catastrophic issues. The core money/integrity guarantees hold. The 6 🔴 items are what I'd fix before launch — the biggest is **#1 (workshop refund ledger)** for tax-reporting integrity, **#5 (on-site pickup leak)** for real merchandise loss, and **#6 (shipping placeholders)** for per-shipment margin accuracy.
