# Launch Runbook — meribeautystudio.com

Current state (as of 2026-08-08): deployed to prod on OVH, reachable at
`https://meribeautystudio.com`, but the DB is empty and the password gate
(`SITE_ACCESS_PASSWORD` in `middleware.js`) is on — effectively a private staging
environment at the real domain. That gate is actually the right move right now; don't
remove it until the steps below are done. This is the ordered path from here to public
launch. Full detail/rationale for each item lives in `PROD_READINESS_CHECKLIST.md` — this
file is the sequence.

---

## Step 1 — Get the database populated

1. [ ] On the VPS, confirm migrations are applied: `npx prisma migrate status` should be
       clean against the prod DB. If not, `npx prisma migrate deploy`.
2. [ ] Set a strong `ADMIN_PASSWORD` env var on the VPS (do **not** leave it at whatever
       default/dev value it might be), then run the seed: `npm run seed`. This creates
       exactly two things:
       - One admin user: `admin@meribeauty.com`, password = whatever `ADMIN_PASSWORD`
         was set to.
       - One bare `Salon` row: name = "Meri Beauty", everything else (description,
         phone, email, address, socials) is an **empty string**, working hours default
         to Mon–Sat 9–18, Sun closed.
       Seeding is idempotent — it checks for an existing admin/salon and skips if
       already there, safe to re-run.
3. [ ] Log into the admin dashboard with that seeded account **immediately** and change
       the password to something only Marie/the team knows — don't leave the seeded one
       active.
4. [ ] Through the dashboard, fill in the real salon data the seed left blank:
       description, phone, email, address, Instagram/Facebook/TikTok, real opening
       hours if different from the Mon–Sat 9–18 default.
5. [ ] Create real services, staff/animateurs, and (if boutique launches at the same
       time) at least the initial product catalog. This is the bulk of "no data" —
       there's no shortcut, it's manual data entry through the dashboard Marie/team
       needs to do.

## Step 2 — Legal pages (blocking, illegal to skip)

6. [ ] Get Marie's full legal name and drop it into wherever `/cgv`,
       `/mentions-legales`, `/politique-de-confidentialite` currently render
       `[Nom et prénom complets de la responsable — à compléter]`.
7. [ ] Confirm brand spelling is consistent everywhere before this content is public
       (footer, legal pages, `Hero.jsx` has a stray "Mery Beauty" typo).

## Step 3 — Verify/lock down prod config on the VPS

8. [ ] Re-check every env var is a **real prod value**, not a dev leftover:
       `AUTH_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, and
       `NEXT_PUBLIC_APP_URL=https://meribeautystudio.com` (this one matters a lot now
       that the real domain is live — wrong value here breaks sitemap/canonical URLs
       silently).
9. [ ] Decide: is checkout going live with real Stripe charges at launch, or later?
       - If launching payments now: switch `STRIPE_SECRET_KEY`/publishable key to
         `sk_live_...`, register the **production** webhook endpoint in the Stripe
         Dashboard pointing at `https://meribeautystudio.com/api/webhooks/stripe`
         (or whatever the route is), and set `STRIPE_WEBHOOK_SECRET` to the secret
         Stripe gives you for *that* endpoint — not the local `stripe listen` one.
       - Also register the separate **Stripe Connect** webhook and set
         `STRIPE_CONNECT_WEBHOOK_SECRET` (see `PROD_READINESS_CHECKLIST.md`, this was
         a gap: one webhook secret can't correctly serve both event types).
10. [ ] Confirm `pm2 startup` + `pm2 save` were run so the app survives a VPS reboot,
        not just a process crash (you said PM2's already handling the process itself).

## Step 4 — Fix the one real code bug found during testing

11. [ ] `app/sitemap.js` has no try/catch around its Prisma calls — if the DB hiccups
        during a build, `next build` hard-crashes and the deploy fails. Low risk while
        you're not redeploying often, but fix it before your next `git push`/rebuild so
        a bad moment doesn't brick a future deploy. (Wrap it like `getSalon` /
        `getPublicServices` already do elsewhere in the codebase — catch, fall back to
        `staticRoutes` only.)

## Step 5 — Shipping (blocking only if boutique ships physical orders at launch)

12. [ ] Confirm Mondial Relay production API access (Marie chasing their "homologation"
        process) and confirm the real negotiated rate table — checkout is currently
        pricing on placeholder tiers. Don't accept real shipping orders until this is
        resolved, or every shipment is mispriced.

## Step 6 — Private UAT, still behind the gate

13. [ ] With the gate still up, walk through the full flows yourself end-to-end:
        booking an appointment, a boutique checkout (Stripe test mode is fine for this
        if step 9 hasn't flipped to live yet), an admin refund, a formation/atelier
        reservation, and confirm reminder emails actually send (Resend).
14. [ ] Spot-check the remaining unverified HIGH items from
        `SECURITY_FIXES_SPEC.md`: refund-amount cap behavior, refund-failure handling,
        cancel-vs-webhook race, Mondial Relay pickup-point validation. (Listed in
        `PROD_READINESS_CHECKLIST.md` under High Priority.)

## Step 7 — Open the gate

15. [ ] Once steps 1–6 are done: unset `SITE_ACCESS_PASSWORD` on the VPS and restart
        the app (`pm2 restart <app>`). That's the entire mechanism —
        `middleware.js` only gates when that env var is set, there's no other switch.
16. [ ] Optional but cheap hardening: add a code-level guard so this gate can never be
        accidentally left on in prod again (currently nothing stops someone from
        re-setting it later and silently de-indexing the site from Google).

## Step 8 — Just after opening

17. [ ] Submit `https://meribeautystudio.com/sitemap.xml` to Google Search Console.
18. [ ] Spot check `robots.txt` points at the real sitemap URL, not localhost.
        (Should already be correct given `NEXT_PUBLIC_APP_URL` is set right in step 8 —
        just confirm.)
19. [ ] Watch PM2 logs for the first hour or two after opening, especially around the
        first few real bookings/orders/payments.
20. [ ] Claim/verify the Google Business Profile (pure Marie action, no code).

---

## Not blocking, can trail behind launch

Favicon/manifest, blog/GEO content, OG images, remaining `npm audit` HIGH findings (fix
via a `next@15.5.23` bump when convenient), minor dependency bumps. Full list in
`PROD_READINESS_CHECKLIST.md` under Low Priority.
