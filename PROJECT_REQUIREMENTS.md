# Merri Beauty — Project Requirements & Audit Brief

**Purpose of this document:** brief a fresh reviewer (human or agent) with zero prior context on this project, so they can check whether the current codebase (branch `marwane`) actually does what it's supposed to do. Every requirement below is tagged by where it came from — treat that tag as a confidence level, not decoration.

**Tags used throughout:**
- ✅ **CONFIRMED** — validated with the client (Marie) in a meeting, or is a hard legal requirement. Safe to treat as a spec.
- 📝 **BRIEF** — specified explicitly by the developer/product-owner side (not the end client), e.g. in a written brief for a new module. Treat as intentional, but not client-signed-off.
- ⚠️ **ASSUMED** — a default the developer picked while building, because a decision was needed and no answer existed yet. **The client has not seen or approved this.** These are exactly the things a compliance check should flag as open risk, not silently validate against.
- 🔴 **CHANGED** — deviated from an earlier confirmed decision, for a documented technical reason, without a new round of client sign-off.

Do not treat ⚠️/🔴 items as bugs if the code matches them consistently — they're **undecided policy**, not defects. A defect is when the code *itself* is inconsistent (two different numbers for the same rule) or doesn't do what even the assumed policy says it should.

---

## 1. What this project is

A booking + e-commerce platform for a Belgian beauty salon (**Merri Beauty**, owner/client: **Marie**). One Next.js app serves four customer-facing booking/purchase flows plus a staff/admin dashboard:

1. **Appointments** — book a service with a specific staff member (the original core feature).
2. **Boutique** — e-commerce shop for retail products (pickup or shipping).
3. **Ateliers & Événements** ("workshops") — group classes/events, deposit-or-full payment.
4. **Formations** — professional training courses (private 1:1 or group), newest module.

All four share: Stripe Checkout for payment, a polymorphic `Payment` model (exactly one of `appointmentId`/`orderId`/`workshopReservationId`/`formationReservationId` set, enforced by a DB CHECK constraint), Belgian invoicing (21% VAT, gapless legal numbering), and NextAuth v5 role-based access (`OWNER`/`ADMIN`/`STAFF`/`CUSTOMER`).

**Stack:** Next.js 15 (App Router), Prisma 6 + PostgreSQL (Neon, shared dev DB across the team), NextAuth v5 (JWT sessions), Stripe Checkout (card + Bancontact), Resend (transactional email), Tailwind, Zod.

---

## 2. Confirmed, non-negotiable requirements

These should hold everywhere in the codebase without exception. If you find a place that violates one of these, that's a real bug, not an open question.

| Requirement | Status |
|---|---|
| Belgium only, EUR, single 21% VAT rate | ✅ Confirmed |
| Mondial Relay as the only shipping carrier (pickup-point delivery, not home address) | 🔴 Changed 2026-08-06 — Marie dropped bpost as too expensive; confirmed exact Mondial Relay cost + 21% VAT, no markup, always base-tier pricing. **Two open blockers**: no real rate grid yet (checkout still runs on the old bpost weight tiers as a placeholder, see `lib/shipping.js`), and Marie is unsure whether her Mondial Relay API/Enseigne access from the old Shopify setup is still active. Label automation is stubbed (`actions/boutique/mondial-relay.js`) pending that. |
| Belgian 14-day right-of-withdrawal (returns) on boutique orders | ✅ Legal requirement — the client's original instinct ("no refunds after delivery") was explicitly illegal for EU distance selling and had to be corrected, not just implemented as asked |
| Exactly 3 boutique fulfilment modes: pickup-paid-online, pickup-paid-on-site, shipping-paid-online (no "shipping paid on-site") | ✅ Confirmed |
| Pickup-on-site orders auto-expire and release stock after 7 days uncollected | ✅ Confirmed |
| Product weight is optional; a weightless product falls back to the cheapest shipping tier | 📝 Agreed with the dev-side brief |
| Max 4 subcategories per brand — display-only rule, not DB-enforced | ✅ Confirmed |
| Formations: two types, Private (exactly 1 seat) vs Group (no seat cap) | 📝 Brief |
| Formations: deposit AND balance are both non-refundable regardless of attendance | 📝 Brief — but flagged for legal re-check, see §4 |
| Formations: staff manage only their own formations; admin manages everything | 📝 Brief |

---

## 3. Assumed / not-yet-validated business rules

**This is the actual "what's left before we can call this done" list right now** — every row here is implemented and internally consistent, but the client has not seen or confirmed it. The client has been unreachable so far; the moment contact happens, these are the exact questions to put in front of her (a decision form covering the formations-specific ones was already prepared and sent — see `actions/*` history — still awaiting a response). Until then, do not change any of these unilaterally again; they're deliberately left as-is so there's one clean list to review together.

### Boutique
- **🔴 Shipping pricing changed after the original agreement.** Confirmed-at-the-time policy was a flat €4.95, free over €50. It's now weight-tiered (€7.50–€35 by weight, via `lib/shipping.js`), free over €150. Reason: the flat rate didn't cover bpost's real cost on heavy parcels — but this is a real change to what customers pay and needs to be presented to the client as a choice, not slipped in as a bugfix.
- **⚠️ Carts over 30kg require a manual quote.** Previously this silently charged a flat €45 regardless of actual weight (a real money-losing bug); now it correctly blocks the automatic price and instead offers a "Demander un devis" flow that emails the salon (`actions/boutique/shipping.js`). The *mechanism* is solid; whether ">30kg = always manual quote" is the right policy at all is still open.
- **⚠️ The "Général" subcategory is hidden from the public site.** It's an auto-generated bucket from the product import; hidden purely so it doesn't look broken to customers. Never discussed with the client as a policy.

### Ateliers & Événements
- **⚠️ 8-person cap per session** — no evidence this matches the salon's actual room capacity.
- **⚠️ No cancellation within 48h of the session**, enforced dashboard-side.
- **⚠️ 50% deposit, balance due on-site.**
- **⚠️ Deposit is never refunded on cancellation**, for any reason.
- **⚠️ 10% fee to change session or seat count** — flat regardless of whether seats are being added or removed.
- ~~Two different "low seats" thresholds~~ — **was a real bug, fixed 2026-08-06.** `actions/workshops/notify-low-seats.js` and `actions/formations/notify-low-seats.js` used to broadcast at `available >= 0` while the homepage banner only shows at `available > 0` — so booking a session's literal last seat fired a newsletter email reading "Il ne reste plus que 0 place !" at the exact moment there was nothing left to book. Both guards now match the banner's `0 < available < 3` exactly. Verified against real seeded DB data: at `available=0` the broadcast no longer fires; `available=1/2` unaffected.
- **⚠️ Uncapped waiting list, first-to-pay-wins** — when a seat frees up, *everyone* waiting gets notified simultaneously; there's no queue order beyond who pays fastest.
- **⚠️ Unpaid reservation hold expires after 15 minutes.**

### Formations
- **⚠️ 30% default deposit** — inconsistent with ateliers' 50% unless there's a real commercial reason (formations being pricier in absolute terms, etc.) — worth asking the client directly whether this gap is intentional.
- **⚠️ No cancellation or modification once booked, at all**, client-side. No waiting list, no session-change fee, no low-seats warning — deliberately simpler than ateliers, but never presented to the client as a design choice.
- A decision form was already sent asking specifically: should a 48h cancellation window exist for formations? Should clients be able to modify a reservation post-booking? Should this extend to ateliers too? Is a per-change fee appropriate? **No answer received as of this document.** Do not build any of this without an answer — this is explicitly blocked, not just deprioritized.

---

## 4. Legal/compliance flags worth a lawyer's or accountant's eyes, not just Marie's

- Formations' "deposit and balance both non-refundable no matter what" is a much stronger no-refund stance than ateliers has, for what's often a more expensive product. Belgian consumer law treats services differently from goods; this specific wording should be checked for enforceability, not just commercial acceptability.
- Invoice numbering (`lib/invoicing.js`, `NumberingCounter` model) is built to be legally gapless per Belgian TVA rules — this is implemented correctly and atomically (verified: uses a single `UPDATE ... RETURNING` inside the same transaction as the document, not a racy `SELECT MAX+1`). Don't "simplify" this later without understanding why it's built this way.

---
اكدح
## 5. Known technical/ops gaps (not client decisions — just unfinished work)

- **Cron never wired up.** `expireStaleOrders()` and the reminder-email job both exist and work correctly when called, but only via `GET /api/cron` guarded by `CRON_SECRET`. No `vercel.json` cron config and no external scheduler currently calls this route in any environment. Until this is wired, abandoned boutique orders/holds only clear when a customer happens to retry checkout on the same cart (which now correctly supersedes the stale hold — see §6) — they don't clean up on their own.
- **`STRIPE_WEBHOOK_SECRET`** in `.env` is the local `stripe listen` dev secret. Production needs the real secret from the Stripe Dashboard's registered webhook endpoint, or webhooks silently never process (see §7 for what that looks like when it happens).
- **Bancontact** is implemented in code (`payment_method_types: ["card", "bancontact"]` on every checkout session) but needs to actually be enabled in the Stripe Dashboard's payment methods settings for the live account — code-side readiness doesn't guarantee Stripe will offer it to customers.
- ~~No invoice download from `/mon-compte`~~ — **stale, already built.** `/api/invoices/[id]/pdf` (`app/api/invoices/[id]/pdf/route.js`) already does the ownership check across all 4 polymorphic `Payment` sources (order/appointment/workshopReservation/formationReservation), and invoice links already appear on `/mon-compte` (boutique orders, ateliers/événements, formations) and on the separate `/appointments` page. Verified live 2026-08-06: a customer can download their own invoice (200) and is rejected on someone else's (403).
- **Staff vs. Admin catalogue (products/categories/brands) permission split** — proposed, never confirmed with anyone, independent of the client entirely.
- **Client questionnaire partially resolved 2026-08-06**: Marie answered shipping-carrier and promo-code questions (see §2 and the promo codes feature, now built). Still open: whether prior/legacy invoice numbering needs to be respected, commission-on-product-sales for staff.
- **Mondial Relay pickup-point widget not live yet.** `components/boutique/MondialRelayPicker.jsx` embeds the real Mondial Relay widget (map + native geolocation search) when `NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID` is set; until Marie provides that Enseigne/Brand ID, checkout falls back to a manual pickup-point text form so the flow keeps working end-to-end.

---

## 6. Bugs fixed this session (2026-08-04) — logic correctness, not policy

These were found via targeted code audit + live concurrency testing against the dev DB, and are fixed as of this branch but **not yet committed** (`git status` shows them as unstaged modifications plus one new migration folder). A reviewer should verify these actually landed correctly:

1. **Appointment double-booking / double-charge race** — two concurrent Stripe webhook deliveries for overlapping slots could both pass the app-level conflict check before either committed. Fixed with a real Postgres exclusion constraint (`Appointment_no_overlap`, migration `20260804090000_appointment_no_overlap`), not just an app-level check. Verified live: attempting to create two overlapping appointments directly against the DB, the second is rejected by Postgres.
2. **`completeReturnRequest` double-processing** — could double-refund and double-restock if triggered twice concurrently. Fixed with an atomic conditional status transition (`updateMany` gated on `status: APPROVED`).
3. **Workshop/formation seat overselling** — capacity check and reservation insert were two separate, unguarded steps. Fixed with a row lock (`SELECT ... FOR UPDATE` on the session) wrapping both in one transaction. Verified live: two concurrent bookings for the last seat of a test session — exactly one succeeded, the other correctly got "sold out," final count did not exceed capacity.
4. **`rejectAppointment` never refunded a paid appointment on cancellation** — fixed to mirror the boutique order-cancellation flow (Stripe refund, `Payment` → `REFUNDED`, `Transaction` of type `REFUND`, credit note if invoiced, cancellation email).
5. **Non-atomic stock updates** (`stockQuantity` read-then-write instead of atomic `{increment/decrement}`) in `actions/boutique/stock.js`, `actions/boutique/orders.js`, `actions/boutique/returns.js` — could silently lose one side of a concurrent stock change. Converted to atomic DB operations throughout.
6. **Workshop fee-change webhooks (session/seat change) didn't check for a cancelled-in-the-meantime reservation** before applying the paid change — could reinstate a cancelled booking with a real, unrefunded charge. Fixed to match the existing safety net already used elsewhere in the same webhook file.

---

## 7. How to actually check compliance (per area)

Don't just read the code — every one of these has a concrete DB/UI check.

**Boutique checkout**
- Add an item, check out via all 3 fulfilment modes as both guest and logged-in customer — confirm no "Données invalides" (this was a real, now-fixed bug earlier: logged-in customers couldn't check out at all because the session never carried `phone`/`fullName`).
- Push a cart over 30kg, confirm the "Demander un devis" flow actually emails the salon rather than silently failing or charging a flat rate.
- With `stripe listen --forward-to localhost:3000/api/webhooks/stripe` running (**required for any local payment test** — without it, Stripe processes payment but the app never finds out, which looks like "the order is stuck" or "the cart never empties" but isn't a code bug), pay for an order and confirm: order → `PAID`/`PROCESSING`, cart → `CONVERTED`, stock decremented, invoice issued.
- Abandon a checkout, retry on the same cart, confirm the old hold is released rather than double-reserving stock.

**Appointments**
- Book and pay for a slot, then have staff cancel it from the dashboard — confirm a real Stripe refund appears (this was broken until today's fix).
- Try to construct two overlapping bookings for the same staff member directly (or via a script) — confirm the DB rejects the second one.

**Ateliers/Formations**
- Book the last seat of a session from two sessions/tabs at once — confirm only one succeeds.
- Try to pay an old "change session" fee link after the reservation was cancelled — confirm it refunds rather than silently reinstating the booking.

**Cross-cutting**
- Check `git log` and `prisma migrate status` for anything landed since this document was written — it reflects the state as of 2026-08-04 on branch `marwane`, not a static spec.

---

## 8. Where to look, by module

| Module | Server actions | Webhook logic | Public pages |
|---|---|---|---|
| Appointments | `actions/appointment/`, `actions/reservation/`, `actions/payment/createCheckoutSession.js` | `app/api/webhooks/stripe/route.js` → `processCheckoutSession` | `app/(public)/reservation/` |
| Boutique | `actions/boutique/` (orders, cart, shipping, returns, stock, inventory) | `app/api/webhooks/stripe/route.js` → `fulfillOrderPayment` (in `actions/boutique/orders.js`) | `app/(public)/boutique/` |
| Ateliers | `actions/workshops/` | `app/api/webhooks/stripe/route.js` → `processWorkshopCheckoutSession` + fee handlers | `app/(public)/evenements/`, `/reservation-atelier/` |
| Formations | `actions/formations/` | `app/api/webhooks/stripe/route.js` → `processFormationCheckoutSession` | `app/(public)/formations/`, `/reservation-formation/` |
| Invoicing | `lib/invoicing.js`, `lib/pdf/render.js` | called from inside each webhook handler's transaction | — |
| Auth/permissions | `auth.js`, `auth.config.js`, `lib/authorization.js`, `lib/route-protection.js` | — | `/login`, `/mon-compte` |

---

*Generated from the real codebase state on branch `marwane`, 2026-08-04 — not from assumptions. Where this document says "confirmed," that traces back to an actual client meeting or explicit brief; everything else is a flag for follow-up, not a rubber stamp.*
