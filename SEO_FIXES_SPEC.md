# Merri Beauty — SEO & GEO Fixes Spec

**Purpose:** Give a fresh agent (or developer) with zero prior context a complete, actionable spec to fix the SEO and Generative Engine Optimization (GEO) gaps found in the 2026-08-06 audit. Every code item includes the exact location, the fix, and how to verify. Content/off-site items are written so they can be handed to Marie or a content writer.

**Branch:** work off `marwane`.

**Two concepts, one investment:**
- **SEO** (classical) — rank in Google's traditional link results + Maps Local Pack.
- **GEO** (Generative Engine Optimization) — get cited inside ChatGPT / Perplexity / Google AI Overviews / Gemini answers.

The technical foundations (clean HTML, structured data, canonicals, geo) serve **both**. The differentiator is content: classical SEO rewards keyword-targeted pages; GEO rewards quotable, declarative, fact-dense prose. This spec covers both, prioritized by leverage.

---

## 0. Read this first — what's already done

The basics are in place and correct. Do not redo these:

- **`<html lang="fr-BE">`** — `app/layout.js:48`. Correct.
- **Sitemap** — `app/sitemap.js`, dynamic, includes all four flows + product/event/formation/animator detail pages, filters unpublished/soft-deleted. Referenced from robots. ✓
- **robots.txt** — `app/robots.js`, sensible allow/disallow, points to sitemap, blocks dashboard/api/auth/cart/success pages. ✓
- **Server-rendered HTML on marketing pages** — `app/(public)/page.js`, `evenements/page.js`, `formations/[id]/page.js`, etc. are `async` server components with real text content. Good.
- **Root metadata** — `app/layout.js:23-44`: `metadataBase`, title template, default description with city + local intent, OpenGraph (`type: website`, `locale: fr_BE`, `siteName`), Twitter `summary_large_image`.
- **One `HairSalon` JSON-LD** — `app/(public)/layout.js:21-55`, HTML-escaped, with conditional `name`, `telephone`, `address.streetAddress`, `addressCountry: BE`, `openingHoursSpecification` (from `salon.workingDays`), `sameAs` (Instagram/Facebook/TikTok).
- **Fonts** — `next/font/google` Cormorant Garamond, `display: swap`, self-hosted, no render-blocking.
- **Hero LCP optimized** — `priority` on the hero `<Image>` (`Hero.jsx:50`).

---

## 1. 🔴 SEO blockers — will actively hurt you (fix before anything else)

### B1. Hardcoded placeholder NAP (name/address/phone) — fake data can be indexed

**Location:** `app/(public)/contact/page.jsx:13-15` and dead code in `components/website/Hero.jsx:17-23`.

**Root cause:** Contact page falls back to template dummy text when the salon DB record is empty:
- `phone: "+32 123 456 789"`
- `email: "contact@meribeauty.be"`
- `address: "66 Broklyn Golden Street\nJette, Belgique"`

`Hero.jsx:23` also has a dead `ADDRESS = "66 Broklyn Golden Street\nNew York, USA"` constant (never displayed, but cruft). `Hero.jsx:17-21` has a dead `WORKING_HOURS` array.

If Google (or ChatGPT/Perplexity) crawls the contact page while the salon record is empty, it indexes **fake NAP** — which is actively harmful for local SEO (Google loses trust in inconsistent NAP) and a GEO liability (AI engines learn wrong facts about the business).

**Fix:**
1. In `app/(public)/contact/page.jsx:13-15`, remove the placeholder fallback strings. Either render nothing (empty state) when the salon record is missing, or throw a 503 / return a "salon non configuré" error. **Never fall through to dummy text.**
2. Delete the dead `ADDRESS` constant in `Hero.jsx:23` and the dead `WORKING_HOURS` array in `Hero.jsx:17-21`.
3. Audit the rest of the codebase for any other `Broklyn` / `Golden Street` / `123 456 789` strings: `grep -ri "broklyn\|golden street\|123 456 789\|contact@meribeauty" app/ components/` and remove everywhere.

**Acceptance criteria:** No placeholder NAP string exists anywhere in `app/` or `components/`. The contact page renders an empty state (not fake data) when the salon record is absent.

**Verify:** `grep -ri "broklyn" app/ components/` returns nothing. Load `/contact` with an empty salon record and confirm no fake data renders.

---

### B2. No canonical URLs anywhere → duplicate content

**Location:** root `app/layout.js` (no `alternates.canonical`); every `generateMetadata` in the app.

**Root cause:** Grep for `alternates` / `canonical` returns only `metadataBase`. No page sets a canonical URL. Consequences:
- `/boutique?category=...&brand=...&sort=...` creates dozens of variant URLs, all treated as separate pages by Google.
- `/boutique/[slug]?variant=...` (the product page reads a `variant` searchParam — `app/(public)/boutique/[slug]/page.jsx:6-12,17`) duplicates each product page per variant.
- `/evenements?type=event` etc. duplicate the events list.

With no canonical signal, Google picks its own canonical (often wrong). Split link equity, thinner pages, lower rankings.

**Fix:**
1. In root `app/layout.js` metadata, add nothing global (canonical is per-page).
2. In **every** `generateMetadata` (search: `grep -rl "generateMetadata" app/`), add:
   ```js
   alternates: { canonical: `/the/page/path` }
   ```
   For detail pages, use the real slug path (e.g. `/boutique/${product.slug}`).
3. For list pages with query-param filtering (`/boutique`, `/evenements`, `/formations`), set the canonical to the **bare path** (no query string) so all filter variants consolidate:
   ```js
   // app/(public)/boutique/page.jsx generateMetadata
   alternates: { canonical: `/boutique` }
   ```
4. For the product detail page, set canonical to the slug-only URL (without `?variant=`), so all variant selections consolidate to the canonical product URL.

**Acceptance criteria:** Every indexable page emits a `<link rel="canonical">` pointing at its clean URL. Query-string variants all canonicalize to the bare path.

**Verify:** View source on `/boutique?category=foo` — confirm canonical is `/boutique`. View source on `/boutique/[slug]?variant=xyz` — confirm canonical is `/boutique/[slug]` with no query.

---

### B3. No favicon, no manifest, no theme-color

**Location:** absent everywhere — no `app/icon.*`, no `app/apple-icon.*`, no `public/favicon.ico`, no `app/manifest.*`, no `metadata.icons` / `metadata.manifest` / `viewport.themeColor`.

**Root cause:** Browsers request `/favicon.ico` and get a 404. No PWA presence. Looks unprofessional in SERPs and browser tabs.

**Fix:**
1. Generate a favicon set from the existing `public/Images/Logo.webp` (used in `Footer.jsx:154`). Use RealFaviconGenerator or `npx @frog-solutions/favicon-generator` — produce:
   - `app/icon.png` (32×32) and `app/icon.svg`
   - `app/apple-icon.png` (180×180)
   - `public/favicon.ico` (legacy)
2. Create `app/manifest.ts` (or `.js`):
   ```js
   export default function manifest() {
     return {
       name: "Merri Beauty — Salon de beauté à Jette",
       short_name: "Merri Beauty",
       description: "...",
       start_url: "/",
       display: "standalone",
       background_color: "#ffffff",
       theme_color: "<brand color>",
       lang: "fr-BE",
       icons: [/* icon set */],
     };
   }
   ```
3. In root `app/layout.js`, export a `viewport` (Next 15 pattern, separate from `metadata`):
   ```js
   export const viewport = {
     themeColor: "<brand color>",
     colorScheme: "light",
   };
   ```

**Acceptance criteria:** `/favicon.ico` returns 200. Browser tab shows the logo. `/manifest.webmanifest` returns 200. Lighthouse PWA audit passes the installable check.

**Verify:** Open the site — tab has an icon. DevTools → Application → Manifest loads. `curl -I /favicon.ico` → 200.

---

### B4. Latent kill-switch in middleware — never enable in prod

**Location:** `middleware.js`.

**Root cause:** When `SITE_ACCESS_PASSWORD` is set, `middleware.js` 302-redirects **every visitor** (including Googlebot) to `/acces`, which renders a generic "en cours de développement" page with no salon content. Currently OFF (the env var is commented out in `.env` line 21), but enabling it in production would remove the entire site from Google's index within days.

**Fix:**
1. Add a hard guard so the gate can never apply in production:
   ```js
   if (process.env.NEXT_PUBLIC_APP_ENV === "production") {
     // never gate in prod, regardless of SITE_ACCESS_PASSWORD
     return nextauthMiddleware(req); // or just next()
   }
   ```
2. Or, exclude crawler user-agents from the redirect, so the site stays indexable even when the gate is on for humans (less ideal — cloaking risk).
3. Document this in `PROJECT_REQUIREMENTS.md` §5 next to the existing cron note.

**Acceptance criteria:** With `SITE_ACCESS_PASSWORD` set and `NODE_ENV=production`, the public site is still served normally.

**Verify:** Set the env var, hit the site with `curl -A "Googlebot"` against a production build — confirm 200, not 302.

---

### B5. Confirm the production domain — currently defaults to a placeholder

**Location:** `app/layout.js:19`, `app/sitemap.js:3`, `app/robots.js:1`.

**Root cause:** All three default to `https://meribeautystudio.com` when `NEXT_PUBLIC_APP_URL` is unset. There's also visible brand drift on-site ("Meri Beauty" / "MeriBeauty Studio" / "Mery Beauty" typo in `Hero.jsx:79`).

If the env var is unset in prod, `metadataBase`, every sitemap URL, and the `sitemap:` directive in robots will all point at the wrong domain — meaning Google indexes URLs for a domain you don't control.

**Fix:**
1. Confirm the real production domain with Marie and set `NEXT_PUBLIC_APP_URL` in the production environment (Vercel/Neon).
2. Decide on the canonical brand spelling ("Meri Beauty" — one r, two words) and use it everywhere. Fix the `Hero.jsx:79` "Mery Beauty" typo. Grep: `grep -rn "MeriBeauty\|Mery Beauty\|meribeauty" app/ components/`.
3. Make the fallback throw in production rather than silently use a placeholder:
   ```js
   const SITE_URL = process.env.NEXT_PUBLIC_APP_URL;
   if (!SITE_URL && process.env.NODE_ENV === "production") {
     throw new Error("NEXT_PUBLIC_APP_URL must be set in production");
   }
   const fallback = "http://localhost:3000";
   ```

**Acceptance criteria:** `NEXT_PUBLIC_APP_URL` is set in prod. Brand spelling is consistent. No "Mery" typo in the codebase.

**Verify:** `grep -rn "Mery Beauty" app/ components/` returns nothing. `curl` the production sitemap and confirm URLs use the real domain.

---

### B6. Remove the fake review claim

**Location:** `components/website/Hero.jsx:108-110` — "4.9 / 5 — plus de 2 000 clientes conquises" with rendered stars, but no review platform, no aggregate schema, no real data behind it.

**Root cause:** Hardcoded social proof. Problems:
- **GEO/trust liability** — if ChatGPT/Perplexity picks it up, it's an unverifiable self-claim; generative engines discount these and future updates may treat it as deceptive.
- **EU fake-review rules** — the UCPD (transposed in Belgium) treats unverifiable consumer-review claims as a potential unfair commercial practice. Low risk today, rising.
- **Inconsistent with reality** — a new salon claiming 2,000 satisfied customers is exactly the pattern review platforms are trained to distrust.

**Fix:**
1. Remove the hardcoded claim and stars from `Hero.jsx:108-110`.
2. Replace with **truthful** social proof: Marie's name + credential ("Fondé par Marie, [certification]"), real before/after Instagram embeds, or named attributed testimonials you can actually back up.
3. Do **not** add stars back until there are 15-25+ real Google reviews to aggregate (see §4).

**Acceptance criteria:** No hardcoded "4.9/5" or star claim anywhere. Hero shows verifiable social proof only.

**Verify:** `grep -rn "4.9\|2 000 clientes\|2000 clientes" components/` returns nothing.

---

## 2. 🟠 Local SEO + geo (the recognition lever — biggest bang for buck)

This is the section that decides whether you rank for "salon beauté Jette" / "soin visage Bruxelles". Currently weak: the `HairSalon` schema has no `geo`, no `postalCode`, no `addressLocality`, no `priceRange`, no stable `@id`. The DB has no structured address fields.

### L1. Extend the `Salon` model with structured address + geo coordinates

**Location:** `prisma/schema.prisma:488-511` (the `Salon` model currently has only `address String?`).

**Fix:** Add structured fields:
```prisma
model Salon {
  // ...existing fields...
  address       String?   // keep as the street address line
  streetAddress String?   // optional, if you want to split house number
  city          String?   // e.g. "Jette"
  postalCode    String?   // e.g. "1090"
  addressRegion String?   // e.g. "Région de Bruxelles-Capitale"
  country       String?   // default "BE"
  latitude      Float?
  longitude     Float?
  priceRange    String?   // e.g. "€€"
}
```

Create a migration: `npx prisma migrate dev --name add_salon_geo_and_structured_address`.

**Populate** the row with the salon's real data — use Google Maps or [geo.localfocus.nl](https://geo.localfocus.nl/) to get the exact lat/long for the salon's pinpoint. **NAP must match the Google Business Profile exactly** (see L6).

**Acceptance criteria:** Migration runs clean. Salon row has city, postalCode, latitude, longitude populated.

**Verify:** `prisma migrate status` clean. Query the salon row, confirm fields set.

---

### L2. Emit complete `HairSalon` schema with `geo` and structured address

**Location:** `app/(public)/layout.js:21-55`.

**Fix:** Expand the JSON-LD to include the new fields:
```js
const schema = {
  "@context": "https://schema.org",
  "@type": ["HairSalon", "BeautySalon"],   // add BeautySalon secondary
  "@id": `${SITE_URL}#salon`,              // stable @id — Google uses this
  name: salon.name,
  url: SITE_URL,
  image: salon.logo,
  logo: salon.logo,                        // separate logo field (recommended)
  telephone: salon.phone,
  email: salon.email,
  priceRange: salon.priceRange ?? "€€",
  address: {
    "@type": "PostalAddress",
    streetAddress: salon.streetAddress ?? salon.address,
    addressLocality: salon.city,
    postalCode: salon.postalCode,
    addressRegion: salon.addressRegion,
    addressCountry: salon.country ?? "BE",
  },
  geo: salon.latitude && salon.longitude ? {
    "@type": "GeoCoordinates",
    latitude: salon.latitude,
    longitude: salon.longitude,
  } : undefined,
  hasMap: salon.latitude ? `https://www.google.com/maps/search/?api=1&query=${salon.latitude},${salon.longitude}` : undefined,
  openingHoursSpecification: /* existing */,
  sameAs: /* existing */,
};
```

**Acceptance criteria:** The JSON-LD emitted on every public page passes the [Google Rich Results Test](https://search.google.com/test/rich-results) for `LocalBusiness` with all recommended fields populated.

**Verify:** Run the live URL through the Rich Results Test. Confirm `geo`, `address.postalCode`, `address.addressLocality`, `priceRange`, `@id` are all detected with no warnings.

---

### L3. Add `Product` schema on boutique detail pages

**Location:** `app/(public)/boutique/[slug]/page.jsx` and `components/boutique/ProductDetailClient.jsx` (prices rendered at `:92,94` as plain `€{price}` text — no machine-readable offer).

**Fix:** In `boutique/[slug]/page.jsx` (server component), inject a JSON-LD `Product` block from the product data:
```js
const productSchema = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: product.name,
  image: product.images,
  description: product.description,
  sku: product.id,
  brand: { "@type": "Brand", name: product.brand.name },
  category: product.category?.name,
  offers: {
    "@type": "Offer",
    price: product.variant.price,
    priceCurrency: "EUR",
    availability: product.variant.stockQuantity > 0
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock",
    url: `${SITE_URL}/boutique/${product.slug}`,
    seller: { "@type": "Organization", name: "Merri Beauty" },
  },
};
// render via <script type="application/ld+json" dangerouslySetInnerHTML=... />
```

Loop variants → use `offers` as an array of `Offer` if multiple variants/price points exist.

**Acceptance criteria:** Each boutique detail page emits `Product` schema. Rich Results Test detects it with no errors, and product offers show price + currency + availability.

**Verify:** Pick 3 product URLs, run each through Rich Results Test, confirm `Product` + valid `Offer`.

---

### L4. Add `Event` schema on atelier/événement pages

**Location:** `app/(public)/evenements/[id]/page.js` (renders date/location/price but no schema).

**Fix:** In `evenements/[id]/page.js`, inject:
```js
{
  "@context": "https://schema.org",
  "@type": "Event",
  name: activity.title,
  startDate: session.startDate,
  endDate: session.endDate,
  eventStatus: "https://schema.org/EventScheduled",
  eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
  location: {
    "@type": "Place",
    name: "Merri Beauty",
    address: { /* same PostalAddress as L2 */ },
  },
  image: activity.imageUrl,
  description: activity.description,
  offers: {
    "@type": "Offer",
    price: activity.price,
    priceCurrency: "EUR",
    availability: /* seatsLeft > 0 ? InStock : SoldOut */,
    url: `${SITE_URL}/reservation-atelier?activity=${activity.id}`,
    validFrom: new Date().toISOString(),
  },
  organizer: { "@type": "Organization", name: "Merri Beauty", url: SITE_URL },
}
```

**Acceptance criteria & verify:** Each event detail page passes Rich Results Test for `Event`.

---

### L5. Add `Course` schema on formation pages

**Location:** `app/(public)/formations/[id]/page.js`.

**Fix:** Inject `Course` schema (formations are educational and target ChatGPT queries like "formation brow lamination Bruxelles"):
```js
{
  "@context": "https://schema.org",
  "@type": "Course",
  name: formation.title,
  description: formation.description,
  provider: {
    "@type": "Organization",
    name: "Merri Beauty",
    sameAs: SITE_URL,
  },
  hasCourseInstance: {
    "@type": "CourseInstance",
    courseMode: "onsite",
    location: { /* PostalAddress */ },
    instructor: { "@type": "Person", name: formation.animator.name },
    startDate: session.startDate,
  },
  offers: { "@type": "Offer", price: formation.price, priceCurrency: "EUR", category: "paid" },
}
```

**Acceptance criteria & verify:** Formation detail pages pass Rich Results Test for `Course`.

---

### L6. Claim & verify Google Business Profile (off-site, Marie does this)

This is the single highest-leverage local-SEO action — more important than any code change. Code-side only needs to ensure NAP consistency.

**Actions for Marie:**
1. Claim/verify the GBP at [business.google.com](https://business.google.com). Use the **exact** name, address, phone, and categories that the site emits.
2. Pick primary category **"Salon de beauté"** (or the most specific relevant category), add secondary categories.
3. Add 10+ real photos (interior, team, work).
4. Set working hours to match what's in the DB (and what `HairSalon.openingHoursSpecification` emits).
5. Write a keyword-rich business description (~750 chars, FR primary, mention services + city: "Salon de beauté à Jette spécialisé en soins du visage, brow lamination, microblading...").
6. Start collecting reviews (see §4).
7. Add the GBP geo coordinates to the `Salon` row (L1) — copy them from the Maps pinpoint.

**NAP consistency rule:** the name, address, phone, and hours in the DB must match GBP **exactly**, character for character. Inconsistent NAP is one of the top local-SEO ranking killers.

---

## 3. 🟡 Classical SEO improvements (medium leverage)

### M1. Add per-page OpenGraph images

**Location:** `generateMetadata` in `boutique/[slug]`, `formations/[id]`, `evenements/[id]` (these currently only set title/description).

**Fix:** Each `generateMetadata` should set `openGraph.images` to the entity's image:
```js
openGraph: {
  title: product.name,
  description: product.description,
  images: [{ url: product.imageUrl, width: 1200, height: 630, alt: product.name }],
},
```

Also set OG image `width`/`height`/`alt` in root `app/layout.js:36` for the homepage hero.

**Acceptance criteria:** Sharing a product/event/formation link on Facebook/WhatsApp shows that entity's image, not the homepage hero.

---

### M2. Convert `<img>` to `next/image` on commerce/content pages

**Location:** `evenements/page.js:382,409,436`; `evenements/[id]/page.js:118`; `formations/[id]/page.js:106`; `components/boutique/ProductDetailClient.jsx:55,77`; `app/(public)/boutique/order/success/page.jsx:125`; `components/boutique/CartPageClient.jsx:93`.

**Root cause:** Marketing pages use `next/image`, but commerce/content flows use raw `<img>` — losing lazy-loading, responsive sizing, AVIF/WebP negotiation, and LCP priority. Core Web Vitals hit.

**Fix:** Replace each `<img>` with `<Image>` from `next/image`. For product images hotlinked from Wix/Shopify, either re-host them in `public/` or whitelist the host in `next.config.mjs:25` (already done) and use `next/image` with the remote URL. Add meaningful `alt` text (not empty — see M5).

**Acceptance criteria:** No raw `<img>` on public pages except where semantically required. Lighthouse image audit passes.

**Verify:** `grep -rn "<img " app/\(public\)/ components/boutique/` — only acceptable exceptions remain.

---

### M3. Add slugs for events/formations (replace CUID URLs)

**Location:** `app/(public)/evenements/[id]/page.js`, `app/(public)/formations/[id]/page.js` (URLs like `/formations/clxyz123`).

**Root cause:** CUIDs in URLs carry no keyword signal. `/formations/initiation-brow-lamination` is meaningfully better for SEO than `/formations/clxyz123`.

**Fix:**
1. Add a `slug String? @unique` field to the `Activity` and `Formation` models (migration).
2. Generate slugs on create/update (kebab-case French title).
3. Update routes to `[slug]` or to `[id]-[slug]` (the latter keeps backward compat).
4. Update the sitemap (`app/sitemap.js:26-69`) to use slugs.
5. 301 the old CUID URLs to the new slug URLs.

**Acceptance criteria:** Event/formation URLs contain real French keywords.

---

### M4. Fix double `<h1>` on `/reservation`

**Location:** `app/(public)/reservation/page.jsx:17` (via `PageHero`) and `:39` (explicit "Réservez votre rendez-vous").

**Fix:** Keep one `<h1>` per page. Change the explicit one at `:39` to `<h2>`, or remove it (let the `PageHero` h1 stand).

**Verify:** `grep -c "<h1" app/\(public\)/reservation/page.jsx` should reflect a single h1.

---

### M5. Add meaningful `alt` text on product/content images

**Location:** empty `alt=""` on `ProductDetailClient.jsx:77`, `CartPageClient.jsx:93`, `Hero.jsx:48`, etc.

**Fix:** Empty `alt` is correct **only** for purely decorative images. Product thumbnails and content images should have descriptive alt (e.g. "Crème hydratante visage [brand] [product]"). Grep `alt=""` and audit each.

---

### M6. Sitemap gaps

**Location:** `app/sitemap.js:11-24`.

**Fix:**
1. Add `/reservation-formation` and `/reservation-atelier` to the static routes (they're real public entry pages).
2. Replace `lastModified: new Date()` for static routes (always "now", useless) with a build-time constant or a config-driven date.
3. Consider adding `/boutique/[category]` and `/boutique/[brand]` landing pages (keyword-rich targets) — but only if you build those routes (see M3-equivalent for boutique filters).

---

### M7. Multilingual strategy (Brussels is bilingual FR/NL)

**Decision needed.** Belgium is FR/NL/DE. Brussels is officially bilingual. For now the site is FR-only, which is defensible if the salon only serves French speakers — but declaring it explicitly helps.

**Minimum (do this):**
- In root metadata add `alternates: { languages: { "fr-BE": SITE_URL, "x-default": SITE_URL } }` so Google knows the canonical locale and that there are no variants.

**If Marie wants to target Dutch speakers:**
- Build `/nl` route variants (Next.js App Router i18n, or a manual `/nl/...` tree).
- Translate UI + key content.
- Add `hreflang` pairs: `nl-BE`, `fr-BE`, `x-default`.
- This is a real build (not a one-day job); defer unless Dutch reach is a goal.

---

## 4. Reviews — do this, not Trustpilot

The headline: **don't add Trustpilot for the salon side. Add a Google review collection workflow, then embed those real reviews.** Trustpilot is right only for the boutique (e-commerce) surface, and only if product reviews become a strategic priority.

### R1. Post-appointment / post-order review-request email (build this)

**Location:** new — slot into the existing Resend transactional email infra (`lib/email-templates.js`, `actions/*` post-fulfillment flows).

**Fix:**
1. Add an email template `reviewRequest` in `lib/email-templates.js` — sent 24h after a completed appointment, shipped order, or completed workshop/formation.
2. The email links directly to the Google Business Profile review URL (Marie provides it after claiming GBP — see L6). Direct-linking is the single highest-leverage review-collection tactic.
3. Add a `reviewRequestedAt` field to `Appointment` / `Order` / reservations to ensure each gets asked exactly once.
4. Trigger from the existing post-fulfillment hooks (or from the cron, once wired per `PROJECT_REQUIREMENTS.md` §5).

**Acceptance criteria:** A customer gets exactly one review-request email 24h after their service. The link goes to GBP.

---

### R2. Embed Google reviews on-site with `AggregateRating` schema (once 15-25 reviews exist)

**Location:** new component + JSON-LD.

**Prerequisite:** Do **not** ship this until there are 15-25+ real Google reviews. Embedding a near-empty aggregate looks worse than nothing.

**Fix (when ready):**
1. Build a `ReviewsCarousel` component that fetches from the GBP API (or use a widget like Elfsight / Google Reviews Widget).
2. Render reviews with the customer's name, star count, and snippet.
3. Inject `AggregateRating` JSON-LD in the page where the reviews are shown:
   ```js
   {
     "@context": "https://schema.org",
     "@type": "SalonAndSpa", // or HairSalon
     name: "Merri Beauty",
     aggregateRating: {
       "@type": "AggregateRating",
       ratingValue: "4.8",
       reviewCount: "47",
       bestRating: "5",
     }
   }
   ```

**Critical rule:** only `AggregateRating` based on **verified third-party data** (GBP) earns review snippet rich results. Self-collected reviews on your own site about yourself are ignored by Google for rich results. Do not build a native-only review system expecting SEO lift.

---

## 5. GEO — Generative Engine Optimization (getting cited by ChatGPT/Perplexity/AI Overviews)

GEO rewards **quotable, declarative, fact-dense content** — sentences LLMs lift verbatim. The site currently has zero citation-worthy content (no blog, no conseils, no FAQ). This is the single biggest GEO gap.

### G1. Build a `/blog` or `/conseils` content surface

**What this is:** a CMS-lite section of the site where Marie (or a content writer) publishes articles answering real ChatGPT-shaped questions. Each article is written in the format AI engines extract best:
- A clear H1 that **is** the question: *"Combien coûte un soin du visage à Bruxelles en 2026 ?"*
- A direct one-paragraph answer at the top (BLUF — bottom line up front): *"Un soin du visage à Bruxelles coûte en moyenne entre 60€ et 120€ selon le type de soin. Chez Merri Beauty à Jette, nos soins vont de 65€ (hydratation) à 110€ (drainage lymphatique)."*
- Detail below: comparison tables, bullet points, protocol descriptions.
- Marie as named author with bio + credentials (E-E-A-T).

**Suggested first 8-12 articles (each targets a real AI query):**
1. *Combien coûte un soin du visage à Bruxelles en 2026 ?* (price-comparison, original data)
2. *C'est quoi le drainage lymphatique facial ?* (definition + protocol + price + duration)
3. *Brow lamination vs microblading : quelle différence ?* (comparison table)
4. *Combien de temps dure le brow lamination ?* (specific factual answer)
5. *Quelles sont les contre-indications du microblading ?*
6. *Comment devenir brow artist en Belgique ?* (formations funnel — high GEO value)
7. *Peeling chimique vs peau éclat : lequel choisir ?*
8. *Comment se préparer à un soin du visage ?* (how-to)
9. *Quels soins faire pendant la grossesse ?* (niche long-tail)
10. *Salon de beauté à Jette : nos conseils pour choisir*

**Tech setup (code):**
- Route group `app/(public)/blog/` with `page.js` (list) and `[slug]/page.js` (detail).
- Server-rendered HTML (critical — not a client shell).
- `Article` schema with `author: { @type: Person, name: "Marie", sameAs: "/a-propos" }`.
- Add `/blog` and `/blog/[slug]` to `app/sitemap.js`.
- Include in navigation (header/footer).

**Acceptance criteria:** `/blog` is crawlable, server-rendered, has `Article` schema, articles have named authors, content is BLUF-formatted.

---

### G2. Add `FAQPage` + `HowTo` schema where applicable

**Location:** wherever a page already has Q&A content (or where you add it).

**Fix:** For the new blog articles, and for any service page with FAQs, inject `FAQPage` JSON-LD with real Q/A pairs. For protocol/how-to articles, inject `HowTo` schema with `step` arrays. These are heavily extracted by AI engines.

---

### G3. Build the entity layer (off-site, the underweighted GEO lever)

Most Belgian local businesses have no entity presence. This is cheap and high-leverage.

**For Marie / off-site:**
1. **Wikidata entry for Merri Beauty** — create a `Q` entity with `instance of: hair salon / beauty salon`, `located in: Jette`, `coordinate location`, `official website`, `sameAs` (GBP, Instagram). Most Belgian salons don't have one; this massively helps model recognition (ChatGPT, Gemini, Perplexity all use Wikidata as a core entity source).
2. **Get listed on Belgian directories** — 11800, PagesBlanches, local beauty repertoires. These get crawled and corroborate your existence for AI engines.
3. **Get mentioned on third-party authoritative sources** — Reddit, local press, beauty blogs. LLMs trust what multiple independent sources corroborate; a site talking about itself is weak evidence.

---

## 6. Suggested implementation order

**Phase 1 — SEO blockers (do first, ~1 day):**
1. B1 (remove placeholder NAP)
2. B5 (set `NEXT_PUBLIC_APP_URL`, fix brand typo)
3. B2 (canonical URLs everywhere)
4. B3 (favicon/manifest/theme-color)
5. B6 (remove fake reviews)
6. B4 (production guard on `SITE_ACCESS_PASSWORD`)

**Phase 2 — Local SEO + geo (the recognition lever, ~2 days):**
1. L1 (extend `Salon` model, migration)
2. L2 (complete `HairSalon` schema with geo + structured address)
3. L6 (Marie claims GBP — parallel, off-site)
4. L3 / L4 / L5 (Product / Event / Course schema on detail pages)

**Phase 3 — Classical SEO improvements (~2-3 days):**
1. M1 (per-page OG images)
2. M2 (`next/image` on commerce pages)
3. M4 / M5 (h1 fix, alt text)
4. M6 (sitemap gaps)
5. M3 (slugs for events/formations) — bigger build, can defer
6. M7 (hreflang minimum) — defer NL variants unless targeting Dutch speakers

**Phase 4 — Reviews (parallel, kicks in once GBP is live):**
1. R1 (review-request email) — build now
2. R2 (embed + `AggregateRating`) — build once 15-25 reviews exist

**Phase 5 — GEO content surface (strategic, ongoing):**
1. G1 (build `/blog` section, publish first 8-12 articles) — biggest GEO lever
2. G2 (`FAQPage` / `HowTo` schema)
3. G3 (Wikidata entity + directories — Marie/off-site)

---

## 7. Verification checklist (after each phase)

- **Phase 1:** `grep -ri "broklyn\|Mery Beauty\|4.9/5\|2 000 clientes" app/ components/` returns nothing. View-source on `/boutique?category=foo` shows canonical `/boutique`. `/favicon.ico` returns 200. `NEXT_PUBLIC_APP_URL` set in prod.
- **Phase 2:** [Rich Results Test](https://search.google.com/test/rich-results) on the homepage detects a complete `LocalBusiness` (with `geo`, `postalCode`, `addressLocality`, `priceRange`, `@id`, no warnings). Product/event/formation detail pages each pass their respective schema tests. GBP verified with matching NAP.
- **Phase 3:** Lighthouse SEO audit > 90. No raw `<img>` on public pages. One `<h1>` per page.
- **Phase 4:** Test order triggers exactly one review-request email 24h later. `AggregateRating` schema validates only once 15+ real reviews exist.
- **Phase 5:** `/blog` crawlable, server-rendered, `Article` schema valid, named authors. Wikidata `Q` entity created. Manual GEO audit: ask ChatGPT/Perplexity the target queries monthly and track citation presence.

---

*Generated 2026-08-06 from a full SEO + GEO audit of branch `marwane`. Every file:line reference was verified against the live code. The single highest-leverage items are: B1 (placeholder NAP), L1+L2 (geo + structured address), L6 (claim GBP), and G1 (build the content surface). Without L6 + G1, the site will rank for its brand name but not for "salon beauté Jette" or any ChatGPT query about Belgian beauty services.*
