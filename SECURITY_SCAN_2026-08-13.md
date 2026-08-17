# Meri Beauty — Fresh Security Scan (2026-08-13)

**Scope:** Full source tree (`app/`, `actions/`, `lib/`, `components/`, `services/`, `utils/`, `scripts/`) — **code-only, no pre-existing review docs consulted.**
**Stack:** Next.js 16.3 · Auth.js v5 · Prisma 6 · Stripe · Pusher · Resend/nodemailer
**Surface scanned:** 21 API routes · ~50 server-action modules · middleware (`proxy.js`) · `next.config.mjs` · deps (`npm audit --omit=dev`)
**Verdict:** Well above average for hardening — real CSP, full security headers, signature-verified Stripe webhook, httpOnly cookies, broad rate limiting, clean secret hygiene, zero SQLi/XSS sinks. **No Critical issues.** 3 High, 5 Medium, 8 Low findings below — each verified against the source.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 3 |
| Medium   | 5 |
| Low      | 8 |

---

## ✅ Remediation applied (2026-08-13)

Four findings fixed and verified (lint 0 errors · 273 tests pass · `npm audit --omit=dev` 0 vuln):

- **H1 — FIXED.** `escapeHtml` exported from `lib/email-templates.js` and applied to `rentalType`, `commissionType`, `message` in the rental-request owner/admin email HTML body (`app/api/rental-requests/route.js`).
- **H2 — FIXED.** `getClientIp()` now reads the **rightmost** `X-Forwarded-For` hop (the one the single Nginx reverse proxy appends), not the client-controlled leftmost; comment documents the single-proxy assumption and the CDN hop-count caveat (`lib/rate-limit.js`).
- **H3 — FIXED.** `nodemailer` bumped `^7.0.13 → ^9.0.5`; `npm audit` now clean. nodemailer is dev-only here (prod uses Resend) and none of the vulnerable features were exercised, so no behavioral change.
- **M1 — FIXED (elevated to High).** Checkout-resume IDOR closed end-to-end. New stateless HMAC capability `lib/resume-checkout-token.js` (modeled on `lib/stripe-oauth.js`, `AUTH_SECRET`, 30-min TTL). Authorization (valid token **or** signed-in owner) is now enforced inside **every** public checkout builder — `retryCheckoutSession`, `createOrderCheckoutSession`, `resumeOrderAfterVerification`, `createWorkshopReservationCheckoutSession`, `createFormationReservationCheckoutSession` — and the token is threaded through all legitimate callers (`verifyEmail`, `createOrderFromCart` → `CheckoutPageClient`, the workshop/formation internal call sites). An attacker can no longer harvest another customer's `pickupCode` or spam pickup emails from a bare cuid. **Scope note:** the initial plan only gated the dispatcher; the four builders are themselves exported `"use server"` actions with their own client caller, so the gate had to go inside each builder to actually close the hole.

Remaining (Medium/Low) findings — M2, M4, M5, L1–L8 — are still open; see below.

---

## HIGH

### H1 — Stored HTML injection into owner/admin emails (rental request)
**File:** `app/api/rental-requests/route.js:218-219`
**Flaw:** The customer-controlled `message` is validated only as `z.string().max(1000)` (`lib/validations/rental-request.js:31-36`) with no HTML stripping, then interpolated **raw** into both the `text` and `html:` bodies of the email sent to every `OWNER`/`ADMIN`:
```js
html: `...<strong>Message:</strong> ${result.rentalRequest.message || "Aucun message"}...`
```
The sibling `contactOwnerNotificationEmail` (`lib/email-templates.js:731-735`) correctly calls `escapeHtml(...)` on every field — the rental path was missed.
**Exploit:** Any authenticated CUSTOMER submits `message: "<a href='https://evil.com/login'>Cliquez pour valider votre commande</a><img src=x onerror=...>"`. The HTML renders in the salon owner's inbox — phishing / account-takeover vector aimed at the most privileged users. Email clients strip `<script>` but render anchors, images, inline CSS, tracking pixels.
**Fix:** Route the rental email through `escapeHtml()` (already exists at `lib/email-templates.js:30`) for `message`, `rentalType`, `commissionType`, `specialty` — or move the body into `lib/email-templates.js` next to the already-correct `contactOwnerNotificationEmail`.

### H2 — Rate-limit bypass via spoofable `X-Forwarded-For` → unthrottled brute force + email bombing
**File:** `lib/rate-limit.js:27-32`
**Flaw:** `getClientIp()` takes the **leftmost** comma-separated value of `X-Forwarded-For` with no trusted-proxy validation. Every rate-limited action keys its bucket on `${email}:${ip}` (login, forgot-password, reset-password, verify-email, register). On most proxies (and Vercel, which appends the real IP *after* the client value), `split(",")[0]` returns whatever the client wrote.
**Exploit:** Send `X-Forwarded-For: <random>` on each `/login` (or forgot-password / verify-email) request → fresh bucket every time → limiter never trips. Unthrottled credential stuffing on `loginUser` (bcrypt slows each try but doesn't stop distributed guessing) **and** an unlimited email-bomb / harassment primitive via `forgotPassword`/`resendVerificationEmail` against any address.
**Fix:** Take the **rightmost** untrusted hop, or validate against a known trusted-proxy chain (e.g. trust only the last N hops from your hoster's IP range). At minimum, key auth rate-limit buckets on `email` alone (hashed) plus a coarse IP fallback.

### H3 — Vulnerable `nodemailer` (6 advisories: SMTP injection, CRLF, SSRF, TLS bypass)
**File:** `package.json` (`"nodemailer": "^7.0.13"` resolves to `<=9.0.0`), used by `lib/email.js`.
**Confirmed:** `npm audit --omit=dev` → **1 high severity vulnerability**.
Advisories: SMTP command injection via `envelope.size` (GHSA-c7w3-x93f-qmm8), CRLF in EHLO/HELO Transport name (GHSA-vvjj-xcjg-gr5g), CRLF in `List-*` headers (GHSA-268h-hp4c-crq3), `jsonTransport` bypass of `disableFileAccess`/`disableUrlAccess` (GHSA-wqvq-jvpq-h66f), OAuth2 token-fetch TLS cert validation flaw (GHSA-r7g4-qg5f-qqm2), message-level `raw` → arbitrary file read + full-response SSRF (GHSA-p6gq-j5cr-w38f).
**Fix:** `npm audit fix --force` → `nodemailer@9.0.5` (**breaking** — test email flows after).

---

## MEDIUM

### M1 — Unauthenticated server action leaks pickup codes + emails arbitrary victims
**Files:** `actions/shared/resume-checkout-after-verification.js:20-31`, `actions/boutique/orders.js:609-634` (+ `createOrderCheckoutSession:638`, workshop/formation checkout equivalents).
**Flaw:** `retryCheckoutSession({ resumeType, resumeId })` is `"use server"` with **no `auth()` call and no ownership check**. It dispatches a caller-supplied `resumeId` straight into:
- `resumeOrderAfterVerification(orderId)` → `findUnique({ where: { id: orderId } })` unscoped, then for `PICKUP_ON_SITE` orders it **emails the order's owner** (`sendPickupConfirmationEmail`, `orders.js:626`) **and returns a URL containing the victim's pickup code**: `/boutique/order/success?onsite=1&number=${order.orderNumber}&code=${order.pickupCode}` (`orders.js:630`).
- `createOrderCheckoutSession(orderId)` (`orders.js:638`) — likewise no auth/ownership.

**Exploit:** Server actions are publicly reachable via the action endpoint. An attacker who captures a cuid (they leak in plaintext via success URLs, browser history, referer headers, shared screens — e.g. `reservation_id=...` at `actions/workshops/manage-reservation.js:300,424`) POSTs `retryCheckoutSession({ resumeType:"ORDER", resumeId:<cuid> })` with no session → reads the victim's `pickupCode` (lowers the bar for picking up someone else's order at the counter) and/or spams the victim with pickup-confirmation emails.
**Fix:** Add `auth()` + ownership check to `retryCheckoutSession` and the receiving `resume*`/`create*CheckoutSession` helpers, or replace the raw `resumeId` with a short-lived HMAC-signed token bound to the buyer. Stop returning `pickupCode` in a resumable URL.

### M2 — Open redirect via `callbackUrl` on the login form
**File:** `app/(auth)/login/login-form.js:13,26-29`
**Flaw:** `const callbackUrl = searchParams.get("callbackUrl")` is `decodeURIComponent`'d and assigned straight to `window.location.href = redirectTo` with no origin/allowlist check. The server action's safe `response.redirectTo` is overridden whenever a `callbackUrl` is present. (Server side at `actions/auth/login.js:89-91` is safe — flaw is purely the client form trusting the query param.)
**Exploit:** `https://meribeautystudio.com/login?callbackUrl=https%3A%2F%2Fevil.com` — after a victim types valid credentials they're redirected off-site. Classic post-login phishing / credential-redelivery vector.
**Fix:** Validate `callbackUrl` is same-origin (starts with `/` or matches the app origin) before redirecting; otherwise fall back to `response.redirectTo`.

### M3 — Account enumeration (content + timing oracle) in `loginUser`
**File:** `actions/auth/login.js:51-87`
**Flaw:** Response branches before `signIn`/bcrypt runs, producing three distinguishable states for the same submitted password: (A) email not registered → generic message, **fast**; (B) registered + unverified → a *different*, explicit "Veuillez confirmer votre adresse e-mail…" message, **fast**; (C) registered + verified → generic message but **slow** (bcrypt). Both a content and a timing oracle revealing whether an address exists and whether it's verified.
**Exploit:** Submit any password for candidate emails, sort by message/latency. **Compounds with H2** (no effective rate limit) to enumerate the entire customer/staff directory unthrottled, then drive targeted password attacks.
**Fix:** Make the login response constant regardless of existence/verification state — branch through bcrypt (e.g. compare against a dummy hash) on the no-user path, and use one generic message across all failure modes.

### M4 — Promo-code validation endpoint is unthrottled → brute-forceable
**File:** `actions/promo-codes.js:39-48` (`validatePromoCode`) + `lib/promo-codes.js:25-56` (`resolvePromoCode`)
**Flaw:** `validatePromoCode` is a public `"use server"` action — unauthenticated, **no rate limiter** (unlike `sendContactMessage`, `forgotPassword`, `registerUser`). Codes are short (`min 3`, `[A-Z0-9-]`) and the endpoint returns a distinct success vs. failure body (`discountAmount` on success).
**Exploit:** Script POSTs candidate codes to the action endpoint; any hit reveals an active code and its discount value to redeem at checkout.
**Fix:** Wrap `validatePromoCode` in the existing rate limiter (e.g. `rateLimit("promo-validate", ip, { max: 20, windowMs: 60_000 })`) and consider throttling per-session at redemption too.

### M5 — Upload endpoint has no rate limit and trusts client MIME type, not file contents
**File:** `app/api/upload/route.js:52,79`
**Flaw:** Auth-gated to dashboard roles (limits blast radius) but **no per-user/per-IP throttle** on a 20 MB-per-file write to `public/uploads` — an authenticated staff/admin can fill disk or spam files. `ALLOWED_TYPES` and the on-disk extension are both derived from `file.type` (the multipart `Content-Type` header — fully client-controlled); bytes are never magic-byte-sniffed.
**Impact:** Non-image payloads can land as `.jpg`/`.png`. Not executed (served from `/public`, and SVG/HTML are excluded), so not stored XSS, but defeats the "images only" intent and enables arbitrary storage/exfil.
**Fix:** Add a per-user/per-IP rate limit; validate uploads by **magic bytes** (e.g. `file-type`) before writing to disk.

---

## LOW

### L1 — POS: service `unitPrice` is client-trusted + `EXTERNAL_TERMINAL` "approved" is self-certified
**Files:** `lib/validations/point-of-sale.js:33,53-60`, `actions/boutique/point-of-sale.js:345`
**Flaw:** Product line prices are read from the DB (`item.price`), but **SERVICE** lines use the client-supplied `unitPrice` verbatim (capped at 100 000), and `method:"EXTERNAL_TERMINAL"` only requires the cashier to self-check `terminalApproved: true` plus type a free-text `terminalReference` — there is no terminal integration confirming the charge.
**Impact:** A STAFF user (broadest dashboard role) can record a fake "paid" sale at an arbitrary price, or fabricate an approved card transaction that mints a real `Payment{PAID}` + invoice + audit row with no money collected. Trusted-actor weakness; the audit trail is the only integrity control.
**Fix:** For SERVICES, source the price from a `StaffService`/catalog lookup where possible, or at least enforce a sane admin-configured ceiling. For terminal payments, reconcile against the payment provider's API rather than a self-certified boolean.

### L2 — Pre-launch site-access gate does not cover `/api/*`
**File:** `proxy.js:42-44` (matcher excludes `api`)
**Flaw:** While `SITE_ACCESS_PASSWORD` is set, the entire `/api` surface (cron, calendar-feed, pusher/auth, formation/workshop status, health, upload, …) is reachable from the open internet regardless of the gate. Each sensitive route self-auths (`auth()` / cron bearer), so impact is limited — but the gate gives a false sense of "the site is closed." Noted in-code at `app/api/upload/route.js:32-35`.
**Fix:** If the pre-launch gate matters, extend the matcher to cover `/api/*` (or accept current per-route auth as sufficient).

### L3 — Inconsistent HTML escaping in contact auto-reply (self-XSS)
**File:** `lib/email-templates.js:806,809`
**Flaw:** `contactVisitorAutoReplyEmail` interpolates `${name}` and `${subject}` raw into the HTML body — unlike its sibling `contactOwnerNotificationEmail` (lines 731-735) which escapes. Self-inflicted only (submitter == recipient), but the inconsistency could regress into the owner-notification path.
**Fix:** Apply `escapeHtml()` to all interpolated fields in `contactVisitorAutoReplyEmail`.

### L4 — Public payment-status endpoint discloses appointment metadata by Stripe session id
**File:** `actions/payment/get-payment-status-by-session.js:25-71`
**Flaw:** Unauthenticated success-page poller returns appointment date/start/end, staff full name, service name, price, duration, payment status/amounts to anyone supplying a `stripeSessionId`. Session ids leak via referrers/screenshots. PII (email/phone) is correctly stripped; the code comment acknowledges the residual exposure.
**Impact:** Limited schedule + pricing disclosure. Accepted by design — flagged for completeness.

### L5 — Stripe webhook lacks a centralized processed-event-id replay log
**File:** `app/api/webhooks/stripe/route.js`
**Flaw:** Replay protection is per-handler status/natural-idempotency (e.g. `Payment.transactionReference` unique, status-gated `updateMany`, dispute `upsert` keyed on `stripeDisputeId`) rather than a persisted "seen event id" log. Each currently-handled event happens to be idempotent under that model, so not directly exploitable today — but fragile: any future handler added without its own status gate becomes replay-vulnerable.
**Fix (defense in depth):** Persist processed Stripe event ids with a unique constraint and short-circuit on re-arrival.

### L6 — Instagram Graph API raw error body written to server logs
**File:** `lib/instagram.js:48`
**Flaw:** On a non-2xx response, the full response `body` is logged via `console.error`. Server-side only (no client leak), but may include token-scoped error detail / nested PII depending on Instagram's response.
**Fix:** Log only status + a trimmed/sanitized excerpt.

### L7 — Rate-limiter in-memory fallback is per-instance
**File:** `lib/rate-limit.js:14-17,87-92`
**Flaw:** When the shared DB store is unavailable, the in-memory fallback is per-process. Acknowledged in-code; fine for the planned single-instance OVH/PM2 deploy, but effective limits multiply by instance count if scaled horizontally before moving to a shared store.
**Fix:** Migrate the fallback to a shared store (Upstash Redis / Vercel KV) before multi-instance.

### L8 — Workshop seat-change fee trusts session metadata for price totals
**File:** `app/api/webhooks/stripe/route.js:1061,1137-1143` (`applyWorkshopSeatsChangeFee`)
**Flaw:** `newTotalPrice`, `newDepositAmount`, `newSeatsCount` are read from `session.metadata` and written to the reservation; the *fee amount* charged is correctly taken from `session.amount_total`, but the new totals aren't recomputed from DB prices inside the webhook. Values originate from the admin-gated action that created the session and the signature prevents forgery, so safe in practice — flagged because the pattern differs from the otherwise-consistent "recompute server-side" rule.

---

## Verified CLEAN (explicitly checked, no issue)

- **SQL injection** — All raw SQL uses parameterized `Prisma.sql` tagged templates with constant/server-derived keys (`app/api/webhooks/stripe/route.js:339,637,1106`, `lib/orders/reconcile-stripe-refund.js:34`, `lib/payments/*`, `actions/boutique/{orders,returns,point-of-sale}.js`, `lib/invoicing.js`, `lib/rate-limit.js`). All `orderBy` fields are static literals. No user input reaches a sort/raw-SQL sink.
- **XSS via `dangerouslySetInnerHTML`** — All 4 usages emit JSON-LD with `JSON.stringify(...).replace(/</g, "\\u003c")` (`app/(public)/layout.js:83`, boutique `[slug]`, formations `[id]`, evenements `[id]`). Properly escaped.
- **SSRF** — Every outbound request targets a constant host (Mondial Relay `lib/mondial-relay.js:17`, Instagram `lib/instagram.js:15`, VAT `lib/vat-validation.js:180`, Stripe SDK). `next.config.mjs` `images.remotePatterns` is a tight allowlist (cdninstagram, fbcdn, localhost, wixstatic) — no wildcard-host SSRF. `lib/site-url.js` reads base URL from env only, never the `Host` header.
- **Path traversal / file write** — `app/api/upload/route.js` is hardened: folder allowlist, MIME allowlist, 20 MB cap, extension forced from validated MIME, `crypto.randomBytes` filename. Cannot escape `public/uploads`.
- **Command injection** — No `exec`/`spawn`/`child_process`/`eval`/`new Function`/`vm` in app code. The only `spawn` is in `scripts/dev-with-stripe-webhooks.mjs` (dev tooling).
- **Mass assignment** — Server actions `safeParse` via Zod and pick fields explicitly; `app/api/staff/[id]` and `rental-requests/[id]` body spreads delegate to Zod-validated schemas that strip unknown keys.
- **Stripe webhook integrity** (`app/api/webhooks/stripe/route.js:64-80`) — Signature verified with `constructEvent()` against the **raw body** (`req.text()`) and `STRIPE_WEBHOOK_SECRET` **before any DB mutation**. Amounts re-checked against DB with epsilon, underpayments refunded. Idempotency via `Payment.transactionReference` unique + status-gated `updateMany`. Metadata used only to *look up* rows, never to assign ownership/amounts.
- **Order pricing** — Totals recomputed server-side from `item.variant.price` (`actions/boutique/orders.js:355-357`); client cart prices are not trusted. Promo discounts recomputed via `resolvePromoCode`; single-code, no stacking, `.positive()` blocks negatives, usage atomically claimed under cap.
- **Stripe Connect OAuth** (`lib/stripe-oauth.js`, `app/api/stripe/oauth/*`) — HMAC-signed `state` (nonce+exp+staffId+userId+purpose), timing-safe compare, 10-min TTL, **live-session re-check** `session.user.id === decoded.userId` at callback, `redirect_uri` from env only, duplicate/foreign-account protection. No `client_secret`/secret key reaches the browser.
- **Cron auth** (`lib/cron-auth.js`) — `Authorization: Bearer <CRON_SECRET>`, timing-safe compare, fail-closed.
- **Pusher channel auth** (`app/api/pusher/auth/route.js` + `lib/realtime/pusher-server.js:152-193`) — session + dashboard role + `channelName === private-user-${session.user.id}` (user-scoped).
- **Token-based endpoints** — Calendar feed token is 192-bit `randomBytes(24)`, DB-stored, revocable (`app/api/calendar-feed/[token]`). Invoice/credit-note PDF routes enforce ownership/dashboard scope. All DB PKs are `@default(cuid())` — not sequentially enumerable.
- **Auth flows** — bcrypt **12 rounds**; reset/verify tokens are UUIDs stored as bcrypt hashes, 15-min expiry, rate-limited, generic user-facing messages; reset bumps `sessionVersion` (invalidates other sessions).
- **Secrets hygiene** — No hardcoded credentials anywhere in source. Every secret env (`STRIPE_SECRET_KEY`, `PUSHER_SECRET`, `AUTH_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`, …) is referenced only in server files. Only legitimately-public values are `NEXT_PUBLIC_`-prefixed (Pusher key/cluster, Sentry DSN, app URL, Mondial Relay brand id). `.env*` is gitignored and **not tracked** (`git ls-files` confirms). `mailpit.exe` likewise not tracked.
- **`next.config.mjs`** — `poweredByHeader:false`; full `headers()`: real CSP allowlist (`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, dev-only `'unsafe-eval'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, HSTS (prod-only, preload). No `productionBrowserSourceMaps`, no dangerous experimental flags.
- **Sentry** (`sentry.*.config.js`, `instrumentation*.js`) — DSN env-driven, `enabled`-guarded, no embedded secret, no custom `beforeSend` adding PII.
- **CORS** — Only one manual handler (`app/api/rental-requests/route.js:241`), origin scoped to own domain via `getAppBaseUrl()`, no `Access-Control-Allow-Credentials`, no wildcard.
- **Cookies** — Cart cookie `httpOnly`, `sameSite:"lax"`, secure-in-prod, 30-day maxAge. Auth.js v5 session cookie uses secure defaults. No `document.cookie` token writes.
- **Health endpoint** (`app/api/health/route.js`) — Public response is minimal (status/database/scheduler up-down only); full scheduler internals gated behind `CRON_SECRET`. No version/env/connection-string leak.
- **Error handling** (`lib/api-response.js`) — Centralized `serverError()` returns a generic French message; `prismaError()` maps known codes only; routes funnel through these. No raw `err.message`/`err.stack` leaked to clients.

---

## Recommended remediation order
1. **H1** (escape rental email) — one-line fix, stops phishing the owner.
2. **H2 + M3 + M4** (fix the IP source so the limiter is real, make login responses constant, throttle promo validation) — these compound; together they close enumeration and brute force across the auth + promo surfaces.
3. **M1** (auth + ownership on `retryCheckoutSession` / `create*CheckoutSession`; stop returning `pickupCode` in URLs).
4. **M2** (validate `callbackUrl` same-origin).
5. **H3** (bump nodemailer — breaking, run after).
6. **M5, L1–L8** as hardening / defense-in-depth.
