# Merri Beauty — Full Production Readiness Audit

**Audit date:** 2026-08-09  
**Branch / commit:** `marwane` at `a4d3bc0`  
**Surfaces checked:** current source, prior audit documents, dependency advisories, production build compilation, live app at `192.168.11.130:3000`, and read-only live PostgreSQL integrity queries.

## Verdict

**NO-GO for public production today.** The application has a sound base and the current database is internally consistent, but there are unresolved security, legal, payments, shipping, configuration, and production-data blockers. Do not switch Stripe to live mode or accept public orders until every P0 item below is closed.

## P0 — Must fix before public launch

### P0.1 — Unauthenticated Stripe Connect onboarding-link server action

`actions/stripe/createAccountLink.js:20-70` is a `"use server"` action that accepts any `staffId`, reads its connected Stripe account, and creates an Account Link without calling `auth()` or checking ownership/role. The API route that imports it is authenticated, but the action itself is not a safe trust boundary and is included in server-action code through that import.

**Risk:** an unauthenticated caller who can invoke the action and knows a staff ID can create a sensitive Stripe onboarding link for that staff account.

**Fix:** enforce the same STAFF-self / ADMIN-or-OWNER authorization inside the action itself, or turn it into a non-action internal helper that is callable only from the authenticated API route. Add unauthenticated, cross-staff, and admin tests.

Also remove or secure the unused legacy `actions/staff/independant-staff.js`; all three mutation actions in it lack authentication. It appears unused today, but it is unsafe dead code and must not be wired back accidentally.

### P0.2 — Legal identity placeholder is publicly rendered

All three live legal pages render `[Nom et prénom complets de la responsable — à compléter]`:

- `app/(public)/cgv/page.jsx:26`
- `app/(public)/mentions-legales/page.jsx:25`
- `app/(public)/politique-de-confidentialite/page.jsx:21`

**Fix:** obtain Marie’s complete legal name, replace every occurrence, and have the CGV/privacy language reviewed before opening the site.

### P0.3 — Production URL and secrets are still development values

Current environment verification:

- `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`, and `AUTH_URL` point to `http://localhost:3000`.
- Stripe secret/publishable keys are test-mode keys.
- The live `/dashboard` redirect and Auth.js callback cookie point to `localhost:3000`.
- `robots.txt` advertises `Sitemap: http://localhost:3000/sitemap.xml`.
- Mondial Relay public/API credentials are absent.

**Fix:** configure the real HTTPS origin consistently in the production process environment, generate production-only secrets, register the real Stripe webhook endpoint, set its Dashboard signing secret, and use live Stripe keys only after UAT. Never copy the local `.env` wholesale to production.

### P0.4 — Current database contains incomplete launch data and an unchanged admin credential

Read-only live checks found:

- `Salon(main-salon)` exists, but phone, email, address, and VAT number are empty.
- The only active ADMIN/OWNER account still matches the currently configured `ADMIN_PASSWORD`.
- The only active staff account is not Stripe charge/payout ready.
- There are three active products; all three active variants have `weightGrams = 0`.
- There are no published workshops or formations.

**Impact:** contact/legal/invoice identity is incomplete; appointment online payment cannot work for the active staff member; shipping falls back to the cheapest tier for every current product; the seeded admin credential has not been rotated.

**Fix:** populate and verify salon identity, rotate the admin password and production auth secrets, finish staff Stripe Connect onboarding, enter real product weights, and explicitly decide whether empty events/formations are acceptable at launch.

### P0.5 — Shipping prices and pickup-point trust are not production-ready

`lib/shipping.js` explicitly uses placeholder tiers inherited from bpost, not Marie’s confirmed Mondial Relay contract. The real widget/API credentials are missing. All active variants currently have zero weight, so every shipment receives the fallback/cheapest-tier behavior.

The checkout schema validates only the shape of client-supplied pickup-point fields. It does not verify that a supplied ID/address is a real Mondial Relay point. The manual fallback deliberately permits a null point ID.

**Fix:** do not enable `SHIPPING_PREPAID` until contract rates and production API access are confirmed. Store real weights. When API credentials exist, verify selected point IDs server-side and derive point details from Mondial Relay rather than trusting client text. If shipping must wait, launch with the two pickup modes only.

### P0.6 — Abandoned appointment payments can block calendar slots indefinitely

`actions/payment/createCheckoutSession.js` creates `Appointment(PENDING)` and `Payment(PENDING)` before Stripe. Failed or abandoned Checkout sessions remain pending with no expiry field/job. Pending appointments occupy availability and are covered by the database overlap exclusion constraint.

**Fix:** add an explicit appointment payment-hold expiry, an atomic expiry job, and late-payment refund handling. Test abandonment and late webhook completion.

### P0.7 — Refund synchronization is not fully concurrency-safe or durably recoverable

`handleChargeRefunded()` calculates the unrecorded refund amount before taking a payment lock, then unconditionally creates a refund ledger row and credit note. Concurrent Stripe deliveries can both record the same delta. `Transaction` has no unique Stripe event/refund identifier.

Separately, cancellation/return flows commit cancellation, stock restoration, completion, and sometimes a credit note before the Stripe refund call. Failures are logged and emailed, but there is no durable `REFUND_PENDING`/`REFUND_FAILED` record or retry queue. If the alert email also fails, the unpaid refund exists only in logs and customer-facing state is already terminal.

**Fix:** uniquely claim Stripe event IDs, lock/recompute refund totals inside the transaction, and introduce durable refund-attempt state with an idempotent retry/reconciliation job. Do not rely on email as the recovery record.

### P0.8 — Current production dependencies have three HIGH advisories

`npm audit --omit=dev` reports three HIGH production findings through Next’s transitive `postcss` and `sharp` packages, including arbitrary source-map file disclosure/path traversal and libvips image-processing CVEs. The installed Next version is already `15.5.23`; npm currently offers a full automatic fix only through a Next 16 major upgrade.

**Fix:** assess exploitability for this deployment, test a supported Next upgrade path, and at minimum avoid processing attacker-controlled CSS/images through affected paths until patched. Record a documented risk acceptance if launch precedes the major upgrade.

### P0.9 — Payment-flow test coverage is far below launch risk

Only `tests/reservation-payment.test.js` exists and `package.json` has no `test` script. There are no automated tests for webhook idempotency, concurrent cancellations/refunds, stock holds, return caps, appointment overlap/expiry, reminder claims, authorization, or invoice ownership.

**Fix:** before live payments, add targeted integration tests for the money/concurrency paths and execute the existing manual end-to-end payment checklists with Stripe test webhooks. A clean lint/type check is not a substitute for payment tests.

## P1 — Strongly recommended before launch

### P1.1 — Stripe platform and Connect webhook configuration is conflated

The webhook route verifies every event with one `STRIPE_WEBHOOK_SECRET` while also handling `account.updated`. Platform-account and connected-account webhook destinations commonly have different signing secrets. Configure and test the correct Connect event destination/secret so staff charge/payout readiness cannot silently go stale.

### P1.2 — Reminder deduplication races

Appointment reminders use a read-then-create marker with no unique key. Workshop/formation reminders use read-then-unconditional-update. The in-process scheduler and authenticated cron routes can overlap, and multiple production processes make overlap more likely.

**Fix:** atomically claim each delivery and enforce a unique reminder identity.

### P1.3 — `Salon` singleton is assumed but not database-enforced

The live DB is healthy today: exactly one row with ID `main-salon`. The schema still allows multiple salons, `updateSalon` uses racy `findFirst → create`, and more than twenty call sites use unordered `findFirst()`.

**Fix:** standardize on `main-salon` with `upsert` or add a database-enforced singleton sentinel.

### P1.4 — Sitemap generation has no database-failure fallback

`app/sitemap.js` performs four Prisma queries without `try/catch`. A transient DB failure during static generation can fail deployment. The production compilation succeeded while the LAN database was reachable, but deploy resilience remains weak.

**Fix:** return static routes when dynamic sitemap queries fail and log the degraded build.

### P1.5 — Pre-launch access gate can accidentally remain active in production

`middleware.js` enables the whole-site gate whenever `SITE_ACCESS_PASSWORD` is set, without a production guard. A stale environment value can hide the public site and block crawlers after launch.

**Fix:** hard-disable the gate in public production or require an explicit non-production app environment.

### P1.6 — Production scheduler topology is unsafe/unclear

`instrumentation.js` starts a five-minute in-process interval in every Node process while HTTP cron endpoints remain active. With PM2 clustering or multiple instances, every process runs the scheduler. Existing job dedupe is not consistently atomic.

**Fix:** choose one scheduler owner (single worker or external cron), disable in-process jobs in web workers, and add durable job claims/monitoring.

### P1.7 — Live PDF authorization endpoints returned 500 during audit

Unauthenticated checks correctly returned 401 for upload, Stripe onboarding/connect, and rental-request APIs. `/api/invoices/fake/pdf` and `/api/credit-notes/fake/pdf` returned HTML 500 instead of their coded 401 response during this run. This may have been caused by running a production build against the same `.next` directory as the active dev server, so it is not yet attributed to route logic.

**Fix:** restart the dev server, retest both endpoints unauthenticated and with valid/wrong ownership, then run the same checks against a clean production process. Do not launch until they reliably return 401/403/404 as intended.

## P2 — Data quality, auditability, and polish

- Add appointment `cancelledAt`, cancellation actor/source, and persisted reason.
- Link approved `RentalRequest` rows to the resulting Staff/Contract and preserve agreed commercial terms.
- Remove the unused Prisma `Language` enum during a related migration.
- Add favicon, app manifest, and Apple icon.
- Replace 14 remaining raw `<img>` usages and add `sizes` to the Instagram fill image.
- Audit the homepage’s one image with missing/empty alt text.
- Confirm canonical brand spelling and remove remaining English/US placeholders in authentication/dashboard forms.
- Decide whether strict VIES failure should block validly formatted VAT numbers or allow staff override.
- Migrate away from deprecated `package.json#prisma` configuration before Prisma 7.

## Verified healthy

### Code/build checks

- ESLint: 0 errors, 14 image-performance warnings.
- TypeScript: passes with `npx tsc --noEmit`.
- Prisma schema: valid.
- Focused Node test: passes.
- Production compilation: succeeds with the live DB/network reachable; route static-generation completion needs a clean isolated production run because the current dev server shares `.next`.
- `.env` and `.env.local-backup` are gitignored and absent from tracked history.

### Live HTTP checks

- Public routes `/`, `/reservation`, `/boutique`, `/boutique/cart`, `/boutique/returns`, `/evenements`, `/formations`, `/contact`, and all three legal pages return 200.
- Unknown route returns 404.
- `/dashboard` redirects unauthenticated users to login.
- Both cron endpoints reject missing secrets with 401.
- Security headers include CSP, `X-Frame-Options: DENY`, `nosniff`, referrer policy, and permissions policy. Development CSP includes `unsafe-eval`; production code omits it.
- Public customer-flow pages rendered without application console errors; observed warnings were development/Electron HTTP/CSP warnings plus one Next Image `sizes` warning.

### Live database integrity

- 43 migrations applied; latest completed 2026-08-08.
- Exactly one Salon row: `main-salon`.
- Required `Appointment_no_overlap` and `Payment_exactly_one_source` constraints exist.
- No invalid stock/reserved quantities.
- No invalid payment source counts or amount equations.
- No incorrect order-total equations.
- No nonpositive order/return quantities.
- No appointment denormalized staff mismatch.
- No oversold active workshop/formation sessions.
- No duplicate invoice numbers.
- No pending appointment payments, duplicate refund groups, or duplicate appointment reminder groups in current data.

## Launch sequence

1. Fix P0.1, P0.6, and P0.7 with regression tests.
2. Complete legal identity and salon production data; rotate admin/auth secrets.
3. Decide shipping launch scope. Keep shipping disabled until real rates, weights, and point verification are ready.
4. Finish staff Stripe Connect onboarding and configure separate production webhook destinations/secrets.
5. Upgrade or formally risk-accept vulnerable dependencies.
6. Run clean production build/start in an isolated deployment directory.
7. Execute card-payment UAT for appointments, pickup orders, shipping (only if enabled), workshops, formations, cancellations, partial/full refunds, webhook replay, invoices, and credit notes.
8. Verify real-domain redirects, cookies, sitemap, robots, HTTPS/HSTS, email delivery, cron ownership, backups, and monitoring.
9. Open public access only after all P0 acceptance checks pass.

