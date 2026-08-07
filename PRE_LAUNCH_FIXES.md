# Pre-Launch Audit & Fix Plan

**Project:** Meri Beauty (Next.js 15 \+ NextAuth v5 \+ Prisma) **Branch:** `marwane` (synced with `master`) **Audit date:** 2026-08-06 **Status:** Audits complete; fixes grouped below by priority.

---

—----dont forget those—------------

how to check NUM TVA of a professional entrepreneur before we actually proceed 

| 1\. RGPD / legal pages | Illegal to launch an e-commerce site in Belgium without CGV, Politique de confidentialité, Mentions légales. Footer links are currently href="\#". No cookie consent. No newsletter consent proof. You raised this yourself earlier — it's the biggest missing piece. | Marie's business data \+ the answers from the RGPD questions I drafted |
| :---- | :---- | :---- |
| 2\. Cron scheduler | Orders/holds won't auto-expire → 7-day pay-on-site cleanup never runs → stuck carts. Code works, nothing triggers it. | CRON\_SECRET in deploy env \+ a scheduler (Vercel cron / external) |
| 3\. Marie's real business data | Fake "66 Broklyn" address is indexed by Google → kills local SEO. Also needed for mentions légales \+ invoices. | Her real address, phone, BCE/KBO number, TVA |
| 4\. Production Stripe keys | Currently sk\_test\_... (test mode). Real charges won't work. | Switch to sk\_live\_... \+ enable Bancontact in Stripe Dashboard |
| 5\. Production secrets | AUTH\_SECRET, CRON\_SECRET, STRIPE\_WEBHOOK\_SECRET must be set on the deploy host (not just local). Admin password should be rotated from the seeded default. | Set on Vercel/OVH env |
| 6\. Production domain \+ deploy | NEXT\_PUBLIC\_APP\_URL still localhost; no deploy target live. | Real domain \+ DNS pointing at Vercel/OVH |
| 7\. Unanswered client decisions | Deposit % harmonization (30 vs 50), formations cancellation window contradiction |  |

—----------------------------------------------------------------------

## Executive summary

Three independent audits were run against the codebase:

1. **Requirements coverage** — \~95% implemented. One real gap (blank dashboard overview).  
2. **Security** — notably strong for a project at this stage. IDOR protection, atomic Stripe claims, parameterized queries, bcrypt-12, signed tokens everywhere. One FAIL (no HSTS) plus a few WARNs.  
3. **SEO** — fundamentals sound (`lang="fr-BE"`, dynamic sitemap, robots.txt, metadata). Two FAILs (localhost URL leaking into prod metadata; fake placeholder address) plus several high-leverage improvements.

The fixes below are **fully unblocked** (no external input required) unless marked otherwise in §5.

---

## §1. Launch-blockers (fix before go-live)

| \# | Issue | Source | Impact |
| :---- | :---- | :---- | :---- |
| **1** | **Production URLs resolve to `http://localhost:3000`** | `.env` sets `NEXT_PUBLIC_APP_URL`; `sitemap.js`, `robots.js`, `layout.js`, `(public)/layout.js` read it | Google crawls localhost; OG images broken; sitemap useless |
| **2** | **No HSTS header** | `next.config.mjs` headers missing `Strict-Transport-Security` | MITM risk on auth/payment flows |
| **3** | **Dashboard overview is blank** | `app/dashboard/page.jsx` — entire body commented out | Admin landing page renders nothing |
| **4** | **Fake placeholder NAP** ("66 Broklyn Golden Street") | `contact/page.jsx:13-15`, `Hero.jsx:23` | Google indexes fake address → kills local SEO |
| **5** | **Cron never runs in prod** | `app/api/cron/route.js` needs `CRON_SECRET` \+ a scheduler (no `vercel.json` cron) | Stale orders/holds never auto-expire |

---

## §2. High-leverage but non-blocking

| \# | Issue | Fix effort |
| :---- | :---- | :---- |
| **6** | No canonical URLs (boutique has `?variant=` URL variants) | Add `alternates.canonical` to product pages |
| **7** | Structured data thin — only `HairSalon`, no `Product`/`Breadcrumb`/`FAQ` schema | Add JSON-LD to boutique/formations |
| **8** | No favicon / icons / manifest / proper OG image (OG reuses a 2 MB hero) | Add `app/icon.*`, build a 1200×630 OG image |
| **9** | Boutique uses raw `<img>` (CLS, no optimization) | Switch to `next/image` |
| **10** | Rate-limiter is in-memory \+ has no eviction | Add pruning; move to Redis if multi-instance |
| **11** | Site-access gate is a shared password (cosmetic only) | Disable (`SITE_ACCESS_PASSWORD=""`) at real go-live |

---

## §3. Confirmed solid (no action)

- **Auth** — JWT, 7-day, bcrypt-12, session-version invalidation, email verification, password reset (15-min, single-use, hashed).  
- **Authorization & IDOR** — ownership checks everywhere; RBAC matrix in `lib/authorization.js`.  
- **Input validation** — Zod consistent across actions \+ API routes.  
- **SQL injection** — zero unsafe raw queries; all parameterized (`$queryRaw` tagged templates).  
- **File uploads** — MIME allowlist, path-traversal blocked, auth required (`app/api/upload/route.js`).  
- **Stripe webhook** — signature verified, idempotent, amount-checked, refund-on-cancel.  
- **Requirements coverage** — salon, staff, services, reservations, boutique, workshops, formations, reviews, invoicing, newsletter, contact, rentals — all implemented.  
- **robots.txt** — blocks `/api/`, `/dashboard/`, auth routes, transactional pages.  
- **Sitemap** — dynamic, covers key public flows, filters unpublished/soft-deleted.  
- **`<html lang="fr-BE">`** — correct for a Belgian French site.

---

## §4. Implementation plan (fully unblocked fixes)

All fixes below need **no external data** (no Marie input, no ops decision). Items needing external input are listed in §5.

### Group 1 — Launch-blocking security fix (HSTS)

**File:** `next.config.mjs`

- Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` to the `headers()` array (next to the existing CSP / X-Frame-Options at lines 48–65).  
- Pure addition, zero downside. Addresses issue **\#2**.

---

### Group 2 — Restore the dashboard overview

**File:** `app/dashboard/page.jsx`

- Uncomment only the chart/table grid (`PaymentsOverview`, `WeeksProfit`, `UsedDevices`, `TopChannels` \+ skeleton). Those 4 components **exist and resolve cleanly** with self-contained fetch logic.  
- Leave the 4 deleted components commented (`OverviewCardsGroup`, `OverviewCardsSkeleton`, `RegionLabels`, `ChatsCard`) — they were never committed; rebuilding them from mock data is scope creep.  
- Result: admin landing page shows real analytics again instead of blank.  
- Addresses issue **\#3**.

---

### Group 3 — Centralize URL resolution \+ production fallback

**Files:** `lib/site-url.js`, `app/sitemap.js`, `app/robots.js`, `app/layout.js`, `app/(public)/layout.js`

- **Reconcile the fallback gap first:** `getAppBaseUrl()` returns `""` in prod when no env var is set, but the 4 SEO files hardcode `https://meribeautystudio.com` as the final fallback. Add that production default into `lib/site-url.js` (new `PRODUCTION_DEFAULT_URL`) so centralizing doesn't *weaken* the current fail-safe.  
- Replace the inline `const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "..."` pattern in all 4 files with `getAppBaseUrl()` / `getMetadataBase()`.  
- This fixes the *mechanism* (single source of truth, multi-env fallback). The *localhost value* in `.env` is correct for local dev — the production domain fix happens when you set `NEXT_PUBLIC_APP_URL` on the deploy target. The centralized code now fails safe to the real domain even if env is missing.  
- Addresses issue **\#1** (mechanism).

---

### Group 4 — Canonical URLs \+ structured data

**Files:** `app/(public)/boutique/[slug]/page.jsx`, `app/(public)/boutique/page.jsx`

- **Canonical:** add `alternates: { canonical }` to the `generateMetadata` in `boutique/[slug]/page.jsx` (resolves the `?variant=` duplicate-URL problem) and to `boutique/page.jsx`.  
- **Product JSON-LD:** inject a `<script type="application/ld+json">` with `Product` schema into `ProductPage` (server component, line 18\) — full product data (`name`, `description`, `brand`, `images`, `variants[].price/sku/availableQuantity`) is already available from `getStorefrontProductBySlug`. Mirrors the existing `HairSalon` JSON-LD pattern in `(public)/layout.js:76-83`.  
- **BreadcrumbList JSON-LD:** matching structured data for the existing visual breadcrumb (Boutique \> Category \> Subcategory).  
- No CSP change needed (inline JSON-LD is allowed under the existing `script-src`).  
- Addresses issues **\#6, \#7**.

---

### Group 5 — Rate-limit memory-leak fix

**File:** `lib/rate-limit.js`

- In `isRateLimited`: when `recent.length === 0` after filtering stale timestamps, call `store.delete(key)` instead of `store.set(key, [])`. Evicts dead keys at the natural moment they're discovered — no sweep timer, no perf cost.  
- Keep the existing single-instance caveat comment (it documents a *correctness* limit, not a *memory* one — this fix only addresses memory).  
- Addresses issue **\#10**.

---

### Group 6 — Boutique image optimization

**Files:** `next.config.mjs`, `components/boutique/ProductCard.jsx`, `components/boutique/ProductDetailClient.jsx`, `components/boutique/CartPageClient.jsx`, `components/boutique/ProductScanClient.jsx`

- **Config prerequisite (must-do first):** add `{ protocol: "https", hostname: "**.wixstatic.com" }` to `images.remotePatterns` in `next.config.mjs`. Product images are mixed-origin (Wix legacy URLs \+ local `/uploads/*`). Without this, `next/image` breaks all Wix-sourced product images.  
- Convert the **5 raw `<img>` tags** to `next/image` using the `fill` pattern (matching `components/website/Hero.jsx`), since the parents already constrain dimensions via `aspect-square` / fixed sizes. Each gets `sizes` \+ `className="object-cover"`.  
- Addresses issue **\#9**.

---

## §5. Out of scope (need external input — documented gaps)

These were identified by the audits but **cannot be fixed without external data or an ops decision**. They are tracked here so they're not forgotten.

| \# | Issue | What's needed |
| :---- | :---- | :---- |
| **\#1 (value)** | Production domain in deploy env | Set `NEXT_PUBLIC_APP_URL` to the real domain on Vercel/OVH (mechanism fixed in Group 3\) |
| **\#4** | Fake NAP placeholders | Marie's real address / phone / email to replace the \` |
| **\#5** | Cron never runs | `CRON_SECRET` set in deploy env \+ an external scheduler (Vercel cron / external) |
| **\#8** | Favicon / OG image | Design assets (1200×630 OG image, icon files) |
| **\#11** | Site-access gate | Disable at real go-live — set `SITE_ACCESS_PASSWORD=""` |

---

## §6. Verification

After each group:

- `npm run dev` stays running; hit affected routes to confirm no regressions.

Final check covers:

- Homepage (`/`) — HTTP 200  
- Boutique listing (`/boutique`) — HTTP 200, canonical present  
- A product page (`/boutique/[slug]`) — HTTP 200, Product JSON-LD present, canonical present  
- Dashboard (`/dashboard`) — post-login, charts render  
- `sitemap.xml` — entries point to real domain (not localhost)  
- `robots.txt` — sitemap reference correct

---

## Local environment notes

- **Postgres** runs locally (built from source into `~/pg`, data dir `~/pgdata`, port 5432). If it stops: `~/pg/bin/pg_ctl -D ~/pgdata -l ~/pgdata/server.log start`  
- **Neon DB** — the real production `DATABASE_URL` lives at `/home/yzz/Desktop/env`. This sandbox blocks outbound port 5432, so Neon is unreachable here; it works from any normal host.  
- **Admin login:** `admin@meribeauty.com` / `Admin@123`  
- **Real services active locally:** Stripe (test mode), Resend, Instagram. Mondial Relay config present but `NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID` empty (widget won't render until Marie provides it).

