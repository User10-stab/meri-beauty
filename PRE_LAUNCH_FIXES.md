# Pre-Launch Audit & Fix Plan

**Project:** Merri Beauty (Next.js 15 + NextAuth v5 + Prisma)
**Audit date:** 2026-08-06 · **Last updated:** 2026-08-07 (evening pass)
**Branch:** `marwane` (synced with `master`)

This document is the go-live gate. Every item carries a status badge against
the **current code on disk** (verified 2026-08-07), not against the original
audit — so a new reader sees what's actually done, not what was planned.

**Status legend:**
- ✅ **DONE** — fix is committed and verified in the codebase
- ⏳ **TODO (code)** — code fix still needed; no external input required
- 🔒 **BLOCKED (external)** — needs Marie's data, an ops/env value, or a deploy decision before it can ship
- ❓ **DECISION** — needs a product/policy answer before coding

---

## §0. Non-code reminders (don't ship without these)

These are notes from earlier sessions that don't belong in a code-fix table
but **must not be forgotten**. None are tracked elsewhere.

- ✅ **How to verify Marie's NUM TVA / BCE-KBO number** — resolved with a
  real two-tier check: offline format + Belgian mod-97 checksum
  (`lib/vat-validation.js`) as a hard gate on every save, plus a live VIES
  registry lookup (`verifyVatWithVies`) required to actually persist a
  number on the customer profile settings page and at ateliers/formations
  checkout. Deliberately **not** added to boutique checkout or appointment
  booking — see the decision note below.
- **RGPD / legal pages.** Illegal to launch an e-commerce site in Belgium
  without **CGV**, **Politique de confidentialité**, **Mentions légales**.
  Footer links are currently `href="#"`. No cookie consent. No newsletter
  consent proof. Promoted to a launch-blocker in §1 below (was buried here
  in the previous version).
- ✅ **Unanswered client decisions — resolved by Marie:**
  - **Deposit % harmonization** → keep both at **50% acompte / 50% solde**.
    Formations' schema default, DB rows, Zod defaults, and dashboard form
    defaults were all `30` — harmonized to `50` everywhere (matching
    workshops, which were already `50`). One live formation's DB row
    backfilled directly (schema drift blocked `prisma migrate dev` from
    running safely against the shared dev DB — used `prisma db execute`
    instead so the shared migration history was never touched).
  - **Formations cancellation window** → turned out not to be a real
    contradiction. Code already enforces admin-only cancellation (no
    client self-service) and the public copy already says refunds are
    never given "que vous participiez ou non à la formation" — consistent
    with each other. No code change needed.
- **VAT number scope decision (new, not in original audit):** discussed
  adding a VAT-number field to boutique checkout too (mirroring
  ateliers/formations) — built it, then **reverted it** on request. Final
  scope: profile settings + ateliers + formations only. Boutique and
  appointment booking intentionally excluded.

---

## §1. Launch-blockers (must fix before go-live)

| # | Issue | Status | Notes / evidence |
|---|---|---|---|
| **L1** | **RGPD / legal pages missing** (CGV, Politique de confidentialité, Mentions légales) | 🔒 | Belgian legal requirement. Footer links are `href="#"`. Needs Marie's business data + a privacy-policy draft. Tracked here so it's not lost. |
| **L2** | **Production Stripe keys** (still `sk_test_...` test mode) | 🔒 | Switch to `sk_live_...`; enable Bancontact in Stripe Dashboard → Payment methods. |
| **L3** | **Production secrets on deploy host** | 🔒 | `AUTH_SECRET`, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET` (real one, not local `stripe listen` secret), `RESEND_API_KEY` must all be set on Vercel/OVH — not just local `.env`. Admin password seeded default must be rotated. |
| **L4** | **Cron never runs in prod** | ✅ | Solved differently than originally scoped, on purpose: since the plan is a single self-hosted OVH process (not serverless), an **in-process scheduler** (`lib/background-jobs.js`, started once per process from `instrumentation.js`) now runs every 5 min inside the Next server itself — no external trigger needed at all. It calls `expireStaleOrders`, `sendWorkshopReservationReminders`, `sendFormationReservationReminders`, and `sendAppointmentReminders` (see next row) directly against the DB. Verified live: it caught and correctly expired a real stuck test order, releasing its stock hold, the moment the server restarted. The HTTP routes (`/api/cron`, `/api/cron/appointments`) stay too, for manual triggers or monitoring — safe to run alongside the in-process job since every job dedupes/claims atomically. Only remaining gap: this requires the Node process itself to be kept alive by something (PM2/systemd) once actually deployed — that's a deploy-time step, not code. |
| **L4b** | **`sendAppointmentReminders` was dead code** (found during L4 work, not in original audit) | ✅ | Fully built (24h + 2h windows, self-deduplicating via a Notification row per window) with a docstring literally saying "for the /api/cron job runner" — but nothing ever called it. Now wired into both the in-process scheduler and a new `app/api/cron/appointments/route.js` (split from the main cron route, matching that route's own comment about appointment jobs belonging to a separate endpoint). Auth logic extracted to shared `lib/cron-auth.js`. |
| **L5** | **Production domain + `NEXT_PUBLIC_APP_URL`** | 🔒 | Still defaults to placeholder `meribeautystudio.com`. Set the real domain in the deploy env. (Code mechanism is now fully centralized — see L10, done.) |
| **L6** | **Mondial Relay integration** (the live business blocker) | 🔒 | Needs Marie's real `NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID` (Enseigne) + confirmation her API access is still active. `lib/shipping.js` still runs on placeholder bpost weight tiers (€7.50–€35); `actions/boutique/mondial-relay.js` label automation is stubbed. |
| **L7** | **No HSTS header** | ✅ | Added to `next.config.mjs`'s `headers()`, production-only (`NODE_ENV === "production"` gate — a local `http://localhost` dev session never sends it). |
| **L8** | **Dashboard overview is blank** | ✅ | Uncommented `PaymentsOverview`, `WeeksProfit`, `UsedDevices`, `TopChannels` in `app/dashboard/page.jsx`. Left `OverviewCardsGroup`, `RegionLabels`, `ChatsCard` (+ skeleton) commented — those components don't exist in the codebase, rebuilding them would be scope creep. |
| **L9** | **Fake placeholder NAP** ("66 Broklyn Golden Street") | ✅ | Removed from all 4 locations: `contact/page.jsx` (×2), `Hero.jsx`, `ContactFormSection.jsx`. Empty-fallback now — no fake data renders if the salon record is empty. Commit `ab80591`. |
| **L10** | **URL mechanism: `lib/site-url.js` written but not wired in** | ✅ | Wired `getAppBaseUrl()`/`getMetadataBase()` into all 4 originally-scoped files (`app/layout.js`, `app/sitemap.js`, `app/robots.js`, `app/(public)/layout.js`) **and** 3 more that had grown the same inline `process.env.NEXT_PUBLIC_APP_URL \|\| "https://meribeautystudio.com"` pattern since the original audit (`boutique/[slug]/page.jsx`, `evenements/[id]/page.js`, `formations/[id]/page.js`). Also moved the hardcoded fallback into `lib/site-url.js` itself as `PRODUCTION_DEFAULT_URL`, so `getAppBaseUrl()` never silently weakens to an empty string in prod the way it did before this pass. |

---

## §2. Payment & data integrity (closed this cycle)

These were flagged as critical in the 2026-08-06 post-Stripe-merge audit.
**All committed** — listed here so a reviewer can see the money paths are
covered. Full detail in `SECURITY_FIXES_SPEC.md`.

| # | Issue | Status | Notes |
|---|---|---|---|
| **P1** | `FAILED` missing from `PaymentStatus` enum → failed-payment webhook threw enum violation → infinite Stripe retry | ✅ | Enum + migration `20260806000000_add_failed_payment_status`. |
| **P2** | `createConnectAccount` had no auth — any CUSTOMER could stamp Stripe accounts on staff | ✅ | Now requires auth + role; STAFF self-scopes; ADMIN/OWNER may target any `staffId`. |
| **P3** | Webhook didn't refund on appointment underpayment | ✅ | Pre-transaction guard refunds on underpayment (with `UNDERPAYMENT_EPSILON`), mirroring workshop path. |
| **P4** | Webhook re-confirmed cancelled appointments (cancel-resurrection race) | ✅ | Pre-transaction guard checks `appointment.status === "CANCELLED"` and refunds. |
| **P5** | `getPaymentStatusBySession` leaked buyer PII (name/email/phone) | ✅ | Public polling endpoint now returns only status + amounts + appointment time. |
| **P6** | `cancelReservation` not atomic + never refunded paid bookings | ✅ | Rewritten as atomic `updateMany` claim + credit note + Stripe refund with `alreadyRefunded` guard. |
| **P7** | Slot overlap constraint keyed on `staffServiceId` → cross-service double-booking | ✅ | `staffId` denormalized onto `Appointment`; constraint re-keyed. Migration `20260806103000_appointment_staff_overlap`. |
| **P8** | **TOCTOU residual on P3/P4** — cancelled-check is read before the `FOR UPDATE` lock | ✅ | Re-checks `existingPayment.appointment.status === "CANCELLED"` inside the transaction, right after the lock and the fresh `tx.payment.findUnique` read. On a hit, the transaction bails with `reason: "appointment-cancelled"` (no writes committed) and the caller issues the Stripe refund *outside* the transaction — same reasoning as the original pre-transaction check: never hold a Stripe API call under a row lock. |
| **P9** | **`promoCode` silently dropped in `createCheckoutSession`** | ✅ | Wired `resolvePromoCode(promoCode, rawTotalAmount)` in, mirroring `create-reservation.js` exactly: re-validated server-side regardless of any client preview, `discountAmount` flows into `getReservationPaymentDecision` so `paymentDecision.totalAmount` comes back already net of the discount, and `promoCodeId`/`discountAmount` are now persisted on the `Payment` row for the record. |
| **P10** | **Connect `account.updated` on wrong webhook endpoint** | 🔒 | One `STRIPE_WEBHOOK_SECRET` can't receive both account + Connect events — one family silently fails → `staff.stripeChargesEnabled` goes stale. Register a separate Connect webhook in Stripe Dashboard + add `STRIPE_CONNECT_WEBHOOK_SECRET`. |
| **P11** | **OAuth state not bound to `userId`** (`lib/stripe-oauth.js`) | ✅ | `createStripeOAuthState`/`buildStripeOAuthUrl` now also encode the initiating `userId`; the callback (`app/api/stripe/oauth/callback/route.js`) calls `auth()` once and rejects (new `session_mismatch` error key, mapped to a French message in the dashboard page) if the live session's `userId` doesn't match the one embedded in `state`. This intentionally overrides the route's original "never touch the session" design — worth it here since `state` travels through a redirected URL and can leak (history, referrer, shared screen) within its 10-minute window; a stolen value alone can no longer complete the link. |

---

## §3. High-leverage SEO + GEO (non-blocking but high ROI)

| # | Issue | Status | Notes |
|---|---|---|---|
| **S1** | Canonical URLs (boutique `?variant=` variants) | ✅ | `boutique/page.jsx` + `boutique/[slug]/page.jsx` set `alternates.canonical`. Commit `ab80591`. |
| **S2** | `Product` / `Event` / `Course` JSON-LD on detail pages | ✅ | Added to `boutique/[slug]`, `evenements/[id]`, `formations/[id]`. Server-fetched data only, HTML-escaped. Commit `ab80591`. |
| **S3** | `BreadcrumbList` schema | ✅ | Added to `boutique/[slug]/page.jsx`, mirroring the visible breadcrumb (Boutique › Category › Subcategory › product). Category/subcategory point at `/boutique` rather than a fabricated deep link, since there's no dedicated category page today (filtering is client-side state, not a URL) — honest and functional beats a fake URL. `FAQPage` schema is still not implemented — no FAQ content surface exists yet, so there's nothing to mark up (see S10, a content decision). |
| **S4** | Favicon / Apple icon / manifest / theme-color | 🔒 | None present (`/favicon.ico` 404s). Needs a design asset — `public/Images/Logo.webp` could be the basis. |
| **S5** | Boutique uses raw `<img>` (CLS, no optimization) | ✅ | All 5 raw `<img>` tags converted to `next/image` with the `fill` + `sizes` pattern (`ProductCard.jsx`, `ProductDetailClient.jsx` ×2, `CartPageClient.jsx`, `ProductScanClient.jsx`) — one more than originally counted, `ProductCard.jsx` (the listing grid) had one too. Added `**.wixstatic.com` to `images.remotePatterns` in `next.config.mjs` first (was only in CSP `img-src`, the wrong layer for `next/image`). Verified: boutique listing, a product page, and cart all still return clean 200s post-conversion. |
| **S6** | Rate-limit memory leak | ✅ | `lib/rate-limit.js` now evicts dead keys when their window empties. Commit `ab80591`. |
| **S7** | Site-access gate is a shared password | 🔒 | Disable at real go-live (`SITE_ACCESS_PASSWORD=""`). With it on, `middleware.js` 302s the whole site (including Googlebot) to `/acces`. |
| **S8** | Local SEO: `geo` + structured address in `HairSalon` schema | 🔒 | Needs Marie's real address + lat/long. Extend `Salon` model with `city`/`postalCode`/`latitude`/`longitude`, then emit in `app/(public)/layout.js`. Without `geo`, Google can't place you in Maps results. |
| **S9** | Claim Google Business Profile (off-site) | 🔒 | Single biggest local-SEO lever — more important than any code change. Marie must claim/verify at business.google.com with NAP matching the site exactly. |
| **S10** | GEO content surface (`/blog` or `/conseils`) | ❓ | The only thing that moves GEO (AI citation). Needs a product decision on whether to invest in content marketing. See `SEO_FIXES_SPEC.md` §5 for the full plan. |

---

## §4. Confirmed solid (no action needed)

These were verified in the audits and re-verified during the fix cycle. Do
not re-touch unless you have a reason.

- **Auth** — JWT, 7-day, bcrypt-12, session-version invalidation, email verification, password reset (15-min, single-use, hashed).
- **Authorization & IDOR** — ownership checks across customer resources; RBAC matrix in `lib/authorization.js`; invoice/credit-note PDF polymorphic ownership verified.
- **Input validation** — Zod consistent across actions + API routes.
- **SQL injection** — zero unsafe raw queries; all parameterized (`$queryRaw` tagged templates).
- **File uploads** — MIME allowlist, path-traversal blocked, auth required (`app/api/upload/route.js`).
- **Stripe webhook** — signature verified against raw body, idempotent on `Payment.transactionReference`, amount-checked per path, refund-on-cancel for all four flows (boutique / appointment / workshop / formation).
- **Invoice numbering** — gapless via `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` inside the caller's transaction; a rolled-back transaction never burns a number.
- **Atomic stock ops** — read-then-write eliminated; `{increment/decrement}` + DB CHECK constraints.
- **`<html lang="fr-BE">`** — correct for a Belgian French site.
- **Sitemap** — dynamic, covers all four flows, filters unpublished/soft-deleted.
- **robots.txt** — blocks `/api/`, `/dashboard/`, auth routes, transactional pages.
- **Fonts** — `next/font/google`, `display: swap`, self-hosted.

---

## §5. Recommended next code passes (no external input needed)

All 8 originally-listed items are done (L8, L7, P8, P9, P11, L10, S3, S5) —
plus L4/L4b (cron, done differently than scoped) and the deposit %
harmonization decision. What's left all needs external input:

1. **RGPD/legal pages (L1)** — needs a real legal draft + Marie's business
   data. Biggest remaining launch-blocker.
2. **P10 — Connect webhook split** — needs a second webhook endpoint
   registered in the Stripe Dashboard + `STRIPE_CONNECT_WEBHOOK_SECRET`.
3. **S4 — favicon/OG image** — needs a design asset.
4. **S10 — GEO content surface** — needs a product decision on content
   marketing investment before any code.
5. Everything in §1/§3 marked 🔒 — all deploy-time or Marie-data items, see
   each row for the specific blocker.

---

## §6. Verification checklist

After each code pass:

- `npm run dev` stays running (unless the change touches `next.config.mjs` — coordinate first); hit affected routes to confirm no regressions.

Final go-live check:

- Homepage (`/`) — HTTP 200, no fake NAP in source.
- Boutique listing (`/boutique`) — canonical present.
- A product page (`/boutique/[slug]`) — Product JSON-LD present, canonical present, no `?variant=` duplication.
- Atelier detail (`/evenements/[id]`) — Event JSON-LD present.
- Formation detail (`/formations/[id]`) — Course JSON-LD present.
- Dashboard (`/dashboard`) — post-login, charts render.
- `sitemap.xml` — entries point to real domain (not localhost).
- `robots.txt` — sitemap reference correct.
- `/favicon.ico` — 200 (once S4 done).
- Stripe: live webhook secret set, Bancontact enabled, Connect webhook endpoint registered (once P10 done).
- `prisma migrate status` clean in prod; `NumberingCounter` reset for legal invoice numbering.
- Legal pages live: CGV, Politique de confidentialité, Mentions légales.

---

*Statuses verified against branch `marwane`/`master` on 2026-08-07. Where
this doc says DONE, the change is in the code; where it says BLOCKED, the
blocker is external (Marie's data, env config, or a deploy decision), not
code. For full per-finding detail on the payment work, see
`SECURITY_FIXES_SPEC.md`; for the SEO/GEO plan, see `SEO_FIXES_SPEC.md`.*
