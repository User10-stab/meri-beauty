# Questions & information needed from Marie before launch

**Purpose:** a single checklist to send Marie, replacing the scattered 🔒 flags across
`PRE_LAUNCH_FIXES.md` / `PROJECT_REQUIREMENTS.md`. Nothing here needs a developer — every
item is either a piece of information only she has, an account/credential only she can
access, or a business decision only she can make.

---

## 1. Legal identity (needed to publish the CGV / Mentions légales / Politique de confidentialité)

- [ ] **Nom et prénom complets** (état civil) — required by Belgian law on the mentions
      légales for a `personne physique` (sole trader). We only have the business/trade name.
- [ ] **Do you get the person's okay before posting photos that show clients/visitors** on
      Instagram (which the site then re-displays in its own Instagram section/gallery)? We've
      added a "droit à l'image" clause to the Mentions légales and Politique de
      confidentialité assuming you do, with a takedown-request channel (email us, we remove
      the photo) as a safety net. If that's not consistently true today, this is worth fixing
      in practice — a photo of an identifiable client posted without her okay is a real
      exposure (right to one's own image + GDPR, since a photo of a person is personal data),
      independent of anything the code can fix.
- [ ] Confirm the exact spelling of the brand everywhere: **"Meri Beauty"** vs **"Meri Beauty
      Studio"** (the email domain is `meribeautystudio.com`, but the site currently mixes
      both — including a typo, "Mery Beauty", still in the homepage hero text).
- [ ] Confirm the business number is correct: **BE 0751.854.027** — and check with your
      accountant whether it's registered for **intra-community VAT trade**. We ran it through
      the EU's official VIES lookup and it came back "not valid for cross-border trade" even
      though the format/checksum is correct. This matters because the site now **blocks**
      anyone (including you, if you ever needed to) from saving that exact number anywhere
      the site asks for a VAT number, until VIES confirms it. Worth resolving before launch —
      see §5 below.

## 2. Mondial Relay (blocks real shipping rates + label printing)

Status as of 07/08/2026, after Marie's account screenshot:

- [x] **Code Enseigne (Brand ID) — found: `CC229KZ2`.** Wired into
      `NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID`. The real pickup-point widget (map, geolocation
      search) is now live on `/boutique/checkout` — confirmed working.
- [x] **Sandbox API V2.0 credentials — working, verified.** Test call to Mondial Relay's real
      sandbox shipment endpoint returned a clean, expected response (auth accepted, request
      format correct). Wired in with `MONDIAL_RELAY_SANDBOX=true` — cannot create real/billable
      shipments, safe to keep building/testing against.
- [ ] **Production API V2.0 credentials — confirmed blocked, not a portal bug.** Tried clicking
      "Générer des identifiants d'API" for production directly — it does nothing, no real error
      shown. Confirms this isn't a code or account-config problem on our side: it's Mondial
      Relay's **"homologation" validation step** gating production access entirely. **Marie is
      contacting Mondial Relay support herself** to ask what homologation requires and whether
      it can be unlocked — waiting on her outcome before doing anything further here.
      - Fallback considered: her account already has a fully generated **production** Enseigne +
        private key under the older "API 1" (WSI2 SOAP) system — likely grandfathered in from
        her pre-2024 Shopify integration, so it might work without the homologation wait at all.
        Deliberately **not building this** unless V2 stays blocked after she talks to support —
        it's a second, deprecated protocol (different signing scheme entirely) that Mondial
        Relay could stop honoring at any time, so it'd be throwaway work if V2 clears soon.
- [x] **Parcel drop-off — confirmed CCC.** Marie confirmed she wants a courier to collect
      parcels at the salon (mode CCC) rather than dropping them off herself. Wired into
      `MONDIAL_RELAY_COLLECTION_MODE=CCC`. Still needs the paid collection contract with Mondial
      Relay to actually be active before this works in production — harmless in sandbox either
      way.
- [x] Label format: confirmed **thermique 10×15** — already the default in code.
- [ ] The real **rate grid** (price per weight tier) — checkout still runs on placeholder
      weight-tier pricing, not real Mondial Relay rates. Not covered by this form, needs a
      separate ask once production access is unblocked.

## 3. Stripe / production payments

- [ ] Switch from test keys (`sk_test_...`) to **live keys** (`sk_live_...`) when ready to
      accept real payments.
- [ ] Enable **Bancontact** in the Stripe Dashboard's payment methods settings (the code
      already requests it on every checkout — it just needs to be turned on for the live
      account).
- [ ] A small Stripe configuration step (a second webhook for Connect account events) still
      needs doing — no action from you beyond giving access when we're ready for it.

## 4. Hosting & domain

- [x] **Confirmed: OVH + `https://meribeautystudio.com/`.** Wired into the Mentions légales
      (hosting line now reads OVH SAS, 2 rue Kellermann, 59100 Roubaix — their real registered
      address). `NEXT_PUBLIC_APP_URL`/`PRODUCTION_DEFAULT_URL` already default to this domain
      everywhere in the code.

## 5. Policy decisions

- [ ] **VAT verification strictness.** The site currently refuses to save a VAT number
      anywhere (your customers' or, hypothetically, your own) unless the EU's VIES registry
      actively confirms it. We found this can false-negative on real, validly-registered
      Belgian numbers (see §1). Options: keep it strict and accept that risk, or relax it so
      staff can manually approve a number VIES won't confirm. **Your call.**
- [x] **Formations force-majeure refunds — confirmed manual via Stripe.** No new dashboard tool
      built for formations; stays exactly as today (ateliers keep their one-click exception
      tool, formations refunds — if ever granted — are handled by hand in the Stripe Dashboard).
- [x] **Who can issue refunds — confirmed OWNER/ADMIN only.** Implemented: `cancelOrder`
      (boutique) and `rejectAppointment` now block STAFF specifically when the
      order/appointment was actually paid (a real refund would fire) — STAFF can still cancel
      *unpaid* orders/appointments, that's routine management, not a refund. `completeReturnRequest`
      (always refunds) is now admin-only outright; `approveReturnRequest`/`rejectReturnRequest`
      stay STAFF-accessible since neither moves money. Workshop/formation cancellations were
      already admin-only before this change.
- [x] **Can a completed appointment be "un-completed" and refunded? — confirmed: keep as is.**
      An admin/owner can still cancel+refund an appointment already marked COMPLETED or
      NO_SHOW from the dashboard (only OWNER/ADMIN, per the refund-permission fix above — STAFF
      cannot). No further restriction added; exceptional refunds after completion stay a
      deliberate admin action rather than being blocked outright.

---

*SEO/marketing items (Google Business Profile, favicon, blog, etc.) are tracked separately in
`PRE_LAUNCH_FIXES.md` §3 — left out here on purpose so this list stays focused on what Marie
needs to decide or provide right now.*

*Once you have answers/credentials for the above, send them back the same way you sent the
business details and shipping/formations survey — we'll wire each one in as it arrives.*
