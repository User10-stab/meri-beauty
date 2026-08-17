# Prod Readiness Checklist — meri-beauty

Generated 2026-08-08. Synthesized from `PRE_LAUNCH_FIXES.md`, `SECURITY_FIXES_SPEC.md`,
`SEO_FIXES_SPEC.md`, `PROJECT_REQUIREMENTS.md`, `QUESTIONS_FOR_MARIE.md`, plus fresh
source-code verification and a local build/dev run done today.

**Note on `SECURITY_FIXES_SPEC.md`:** that doc is the *original* 2026-08-06 audit with no
status badges — it reads like an open to-do list but isn't one anymore. Spot-checked 6 of
its 7 CRITICAL findings directly against current source; all 6 are already fixed
(confirmPayment auth, live Stripe checkout, atomic order-cancellation claim, row-locked
returns, underpayment epsilon check, unique transaction reference, atomic stale-order
expiry, timing-safe cron secret check). Treat that file as history, not a task list.

---

## 🔴 BLOCKING — must fix before go-live

- [ ] **RGPD legal pages have a live placeholder.** `/cgv`, `/mentions-legales`,
      `/politique-de-confidentialite` are wired into the footer and publicly reachable,
      but all three still render the literal string
      `[Nom et prénom complets de la responsable — à compléter]` instead of Marie's legal
      name. Illegal to launch as-is. *(Needs: Marie's full legal name, then a legal
      read-through.)*

- [ ] **Production secrets not on the VPS.** `AUTH_SECRET`, `CRON_SECRET`,
      `STRIPE_WEBHOOK_SECRET` (the real Stripe Dashboard one — current `.env` has the
      local `stripe listen` dev secret), `RESEND_API_KEY` all need real values set
      directly in the VPS environment, not just local `.env`. Rotate the seeded admin
      password too. *(Deploy-time config.)*

- [ ] **Stripe still in test mode** (`sk_test_...`). Flip to `sk_live_...` when ready to
      take real payments. Bancontact is off by Marie's own choice — intentional, not a
      gap. *(Deploy-time config + Marie's go-ahead.)*

- [ ] **`NEXT_PUBLIC_APP_URL` unset in prod falls back to a placeholder domain** —
      breaks sitemap/canonicals/`metadataBase`. Domain is confirmed
      (`meribeautystudio.com`, OVH); just needs to actually be set on the VPS.
      *(Deploy-time config.)*

- [ ] **Mondial Relay real shipping rates unconfirmed — live money-losing risk.**
      Checkout currently prices shipments on placeholder bpost weight tiers, not real
      Mondial Relay rates. Brand ID + sandbox API creds work; production API access is
      blocked on Mondial Relay's own "homologation" process (Marie is chasing their
      support). Two candidate public rate tables were found in the repo but neither is
      confirmed to match Marie's actual negotiated contract. **Every order shipped before
      this is resolved is mispriced.** *(Blocked on Marie + Mondial Relay.)*

- [ ] **`next build` hard-fails if the DB is unreachable during build — verified today.**
      Ran `npm run build` locally: compiles fine, then dies with
      `Export encountered an error on /sitemap.xml/route, exiting the build`. Cause:
      `app/sitemap.js` calls Prisma with **no try/catch**, unlike other data-fetching
      code in the app that catches and logs DB errors gracefully. If the DB (Neon) has
      any blip during `npm run build` on the VPS, the whole deploy breaks. **Fix:** wrap
      `app/sitemap.js`'s Prisma calls in try/catch, falling back to `staticRoutes` only
      on failure — same pattern already used elsewhere in the codebase (e.g. `getSalon`,
      `getPublicServices`). Small, cheap, real fix.

- [ ] **3 HIGH-severity `npm audit` findings** (not previously flagged in any doc — found
      this pass): transitive via Next.js's bundled `sharp` (image processing CVEs) and
      `postcss` (sourcemap path issue, GHSA-6g55-p6wh-862q). Full fix requires
      `next@16.3.0` (breaking major). Recommend: bump to `next@15.5.23` now (patch, no
      breaking changes, available today) as a partial mitigation; treat the Next 16
      major upgrade as a deliberate post-launch project.

- [ ] **No test coverage, no test runner.** `tests/` has exactly one 65-line file
      (`reservation-payment.test.js`); `package.json` has no `test` script at all. For an
      app moving real money across 4 payment flows, this is thin. Not a hard blocker
      *if* the manual verification checklists in `PRE_LAUNCH_FIXES.md` §6 and
      `PROJECT_REQUIREMENTS.md` §7 are actually run by hand before launch — but there's
      no evidence they were re-run recently. At minimum, walk through those checklists
      once, live, before flipping Stripe to live mode.

---

## 🟠 HIGH PRIORITY — fix soon after, ideally before

- [ ] **Site-access kill-switch has no hard prod guard.** `SITE_ACCESS_PASSWORD` is
      currently commented out in `.env` (safe), but `middleware.js` has no code-level
      block against it ever being set in production — if it is, it 302s the entire site
      including Googlebot. Cheap fix: hard-disable this gate whenever
      `NODE_ENV === "production"`.
- [ ] **Stripe Connect webhook split.** One `STRIPE_WEBHOOK_SECRET` can't correctly
      receive both regular and Connect account events; `staff.stripeChargesEnabled` can
      go stale. Needs a second webhook registered in the Stripe Dashboard +
      `STRIPE_CONNECT_WEBHOOK_SECRET`.
- [ ] **VAT verification strictness — Marie's decision pending.** The site hard-blocks
      saving any VAT number that VIES won't actively confirm — and Marie's own real,
      validly-formatted BE number (`BE0751.854.027`) currently fails that live VIES
      check. Could bite real customers with valid-but-VIES-lagging numbers at launch.
      Needs her call: strict block vs. staff manual override.
- [ ] **Remaining HIGH items from `SECURITY_FIXES_SPEC.md` not spot-checked this pass**
      (time-boxed verification to CRITICALs): H2 (refund-amount cap +
      `PARTIALLY_REFUNDED` status), H3 (silent Stripe refund-failure swallowing), H5
      (cancel-vs-webhook-fulfill race), H6 (unvalidated Mondial Relay pickup point).
      Every other item checked this pass was already fixed, so these likely are too —
      but given they touch refund correctness and TVA-relevant ledger state, worth a
      final 15-minute grep-verify before go-live rather than assuming.
- [ ] **Stray untracked directories** — `.zcode/` (agent-session artifact) and
      `_charifa_dev_alternatives/` (unused alternate dashboard components). Neither is
      committed to git, but both sit in the working tree. Delete or `.gitignore` them
      before deploy/clone, for hygiene.
- [ ] **Structured-data / SEO gaps that affect week-one visibility** — see LOW PRIORITY
      below for detail, bumped here only because Marie will likely ask "why aren't we on
      Google" within days if fully skipped.

---

## 🟢 LOW PRIORITY / polish

- [ ] Favicon/manifest completely absent — confirmed no `app/icon.*`,
      `app/apple-icon.*`, `public/favicon.ico`, or `app/manifest.*`.
- [ ] Google Business Profile unclaimed — biggest local-SEO lever, zero code involved,
      entirely Marie's action.
- [ ] No `/blog` or `/conseils` content surface — biggest lever for AI-engine (GEO)
      citation; needs a product decision before any code.
- [ ] Minor SEO: per-page OG images, remaining non-`next/image` commerce images, event/
      formation slugs instead of raw CUID URLs, duplicate `<h1>` on `/reservation`, `alt`
      text audit.
- [ ] Brand spelling inconsistency ("Meri Beauty" vs "Meri Beauty Studio" vs a stray
      "Mery Beauty" typo in `Hero.jsx`) — needs Marie's confirmed spelling.
- [ ] Minor dependency bumps available with no breaking changes (react-hook-form, resend,
      stripe SDK, `@hookform/resolvers`, etc.) — safe to batch anytime, not urgent.

---

## ❓ Open questions for Marie (business decisions, zero code needed)

From `QUESTIONS_FOR_MARIE.md` (2026-08-07, the current source of truth):

1. Her full legal name — blocks the legal pages.
2. Consent for posting client photos to Instagram (the droit-à-l'image clause assumes
   yes).
3. Confirmed brand spelling everywhere.
4. Whether her VAT number is actually registered for intra-community trade (accountant
   question) — VIES currently rejects it.
5. Mondial Relay production API access outcome + which rate table (if either) matches
   her real contract.
6. When to flip Stripe to live keys.
7. VAT verification strictness policy (strict VIES-only vs. staff manual override).

Already answered, do not re-ask: Mondial Relay Brand ID/sandbox creds, CCC collection
mode, label format, Bancontact off, hosting = OVH + confirmed domain, formations refunds
stay manual via Stripe, refunds restricted to OWNER/ADMIN only, completed appointments
refundable by admin only.

From `PROJECT_REQUIREMENTS.md` (older, 2026-08-04): formations
cancellation/modification policy (48h window? self-service? per-change fee? extend to
ateliers?) was sent to Marie and never answered — do not build without an answer. Lower
stakes, shippable-as-is: 8-person atelier cap, 10% atelier change fee. Note: the
30%/50% formations-vs-ateliers deposit mismatch this doc flags appears **already
resolved** — `PRE_LAUNCH_FIXES.md` says deposits were harmonized to 50% everywhere since.

---

## 🚀 Deploy-time config checklist (concrete VPS/OVH steps)

1. [ ] Set real env vars on the VPS: `AUTH_SECRET`, `CRON_SECRET`,
       `STRIPE_WEBHOOK_SECRET` (from Stripe Dashboard's registered prod endpoint),
       `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL` (real domain), Stripe live keys once
       ready.
2. [ ] Rotate the seeded admin password.
3. [ ] Confirm `pm2 startup` + `pm2 save` were run (survives VPS *reboot*, not just a
       process crash) — PM2 itself is already installed.
4. [ ] Confirm `SITE_ACCESS_PASSWORD` stays unset/empty in prod.
5. [ ] Register the Stripe Connect webhook endpoint + set
       `STRIPE_CONNECT_WEBHOOK_SECRET`.
6. [ ] Enable Bancontact in Stripe Dashboard only if Marie reverses her "card-only"
       decision.
7. [ ] `prisma migrate status` clean check on the prod DB before first traffic; confirm
       `NumberingCounter` reset correctly for legal invoice numbering start.
8. [ ] Make sure the DB is reliably reachable during the `npm run build` step on the VPS
       (see the `sitemap.js` build-failure finding above — fix that first, but also just
       don't build while the DB is flaky).
9. [ ] Post-deploy smoke test (from `PRE_LAUNCH_FIXES.md` §6): homepage 200 + no fake
       NAP, boutique canonical present, product JSON-LD present, `sitemap.xml` points at
       the real domain not localhost, `robots.txt` sitemap reference correct, dashboard
       renders post-login.

---

## What was actually verified locally today (not just doc-reading)

- `npm run build`: compiles successfully, then **hard-fails** prerendering
  `/sitemap.xml` due to an uncaught Prisma error in `app/sitemap.js` (no DB reachable in
  this sandbox — see finding above; likely same failure mode on any real transient DB
  blip during a VPS build).
- `npm run dev`: background job scheduler (`lib/background-jobs.js`) starts correctly on
  boot (`[background-jobs] started, running every 5 min`) and **fails gracefully** when
  the DB is unreachable (caught, logged, doesn't crash the process) — confirms the
  scheduler mechanism itself is sound, independent of the sitemap issue.
- `git status`: clean, no uncommitted work, only the two stray untracked directories
  noted above.
- Secrets: `.env` / `.env.local-backup` gitignored and never appear in `git log --all` or
  `git ls-files` — safe.
