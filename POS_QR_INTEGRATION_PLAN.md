# POS QR Card Payment — Implementation Plan

**Goal:** Add a "Carte (QR)" payment option to the POS so customers can pay by card on their own phone (via Stripe Checkout), with real Stripe charges, real invoices, and zero card-reader hardware.

**Status:** Local planning doc — not committed, not pushed.
**Date:** 2026-08-11
**Branch to build on:** `marwane` (after pulling latest `origin/marwane`)

---

## §0. Decision & scope

| Decision | Choice |
|---|---|
| In-person card payment method | **QR code → Stripe Checkout on customer's phone** |
| Product scanning | **Existing USB barcode scanner** (already works, no changes) |
| Card reader hardware | ❌ Not buying (SumUp Air can't integrate; S700 deferred) |
| SumUp Air | Backup device only (standalone, manual, cash/offline fallback) |
| Cash payments | Current POS CASH path stays exactly as-is |

**In scope:**
- A new "Carte (QR)" flow in the POS that generates a Stripe Checkout link, shows it as a QR, polls for payment, and fulfills via the existing webhook.
- Real Stripe charge → real invoice → real payment record (fixes the "CARD is just a label" gap).

**Out of scope (deferred):**
- Stripe Reader S700 integration (add later if customers ask for tap-to-pay)
- SumUp Cloud API integration (not recommended — dual-processor)
- Appointment + product bundling on one ticket (separate schema work)
- Promo codes in the POS (separate enhancement)

---

## §1. The architecture insight (read this first)

**The existing online-payment pipeline is order-source-agnostic.** The Stripe webhook's `fulfillOrderPayment` function (`lib/orders/fulfill-order-payment.js:37`) doesn't care HOW an order was created — it only cares that:
1. The order exists with `status: "PENDING_PAYMENT"`
2. The Stripe Checkout Session has `metadata: { kind: "order", orderId: "<the order id>" }`
3. `paidAmount >= order.totalAmount`

When those conditions are met, `fulfillOrderPayment` atomically: claims the order → flips status to `PAID` → creates a real `Payment{ONLINE, PAID}` with a `transactionReference` (the Stripe session id) → creates a `Transaction{ONLINE}` with the real `stripePaymentIntentId` → generates an invoice → decrements stock → emails the receipt.

**This means the POS "Carte (QR)" flow reuses ALL of that.** We are NOT building a parallel payment pipeline. The POS just becomes a second way to create an order that flows through the same fulfillment.

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│ POS (staff tablet)  │     │ Customer's phone     │     │ Stripe              │
│                     │     │                      │     │                     │
│ build cart          │     │                      │     │                     │
│ pick "Carte (QR)"   │     │                      │     │                     │
│ click Encaisser     │     │                      │     │                     │
│   ↓                 │     │                      │     │                     │
│ createOrder         │────▶│                      │     │                     │
│   (PENDING_PAYMENT) │     │                      │     │                     │
│   ↓                 │     │                      │     │                     │
│ createCheckoutSessn │─────────────────────────────────▶│ sessions.create    │
│   ↓                 │     │                      │     │   metadata.orderId  │
│ show QR (session url│     │                      │     │                     │
│   ↓                 │     │                      │     │                     │
│ poll payment status │     │ scan QR → checkout   │────▶│ Checkout page       │
│   ↓                 │     │   type card / ApplePay│     │   charge €XX.XX     │
│   ↓ (webhook fires) │     │   ✓ paid             │     │                     │
│   ↓                 │◀─────────────────────────────────│ checkout.session.   │
│ show ✓ Payé         │     │                      │     │   completed         │
│   redirect to order │     │                      │     │                     │
└─────────────────────┘     └──────────────────────┘     └─────────────────────┘
                                                                  │
                                                  webhook → fulfillOrderPayment
                                                  (stock, invoice, email — all reused)
```

---

## §2. Concrete file changes

### Change 1 — `actions/boutique/point-of-sale.js` (the core split)

**Current:** `completePointOfSaleSale(input)` always creates the order as `status: "COMPLETED"` with a manual `Payment{ON_SITE}` — works for CASH, wrong for CARD-with-QR.

**New behavior:** split into two paths based on `method`.

#### CASH path (unchanged from today)
Keep the existing logic exactly: create order `COMPLETED`, `Payment{ON_SITE, PAID}`, `Transaction{method:"CASH"}`, `issueInvoice`, decrement stock, email receipt. This is correct for cash — cash is instant, no Stripe involved.

#### CARD path (new)
1. **Create the order as `status: "PENDING_PAYMENT"`** (not `COMPLETED`), `fulfilmentMode: "PICKUP_PREPAID"` (see §5 below for why not `PICKUP_ON_SITE`).
2. **Reserve stock**: increment `reservedQuantity` for each variant (do NOT decrement `stockQuantity` yet — the webhook's `fulfillOrderPayment` will do the real decrement on payment success).
3. **Set `expiresAt`** to `now + 30 minutes` (POS card orders should expire if unpaid — a customer who walks away without paying releases the reservation).
4. **Generate the Stripe Checkout Session** via a new helper (see Change 2) → returns `{ url, sessionId }`.
5. **Persist `stripeCheckoutSessionId`** on the order (so the webhook can correlate, and so a second Encaisser click reuses the same session).
6. **Return** `{ success: true, data: { orderId, orderNumber, checkoutUrl, sessionId } }` — the client renders the QR from `checkoutUrl`.

**File:** `actions/boutique/point-of-sale.js:115` (`completePointOfSaleSale`)
**Validation impact:** `lib/validations/point-of-sale.js` — the `method` enum stays `["CASH", "CARD"]`. The difference is now in the action's behavior, not the schema. No schema change needed.

**Stock-reservation detail:** for each item, inside the same `prisma.$transaction`:
```js
prisma.productVariant.update({
  where: { id: variantId },
  data: { reservedQuantity: { increment: quantity } }
})
```
This mirrors what `createOrderFromCart` does at `actions/boutique/orders.js:419`.

### Change 2 — New helper: `createPointOfSaleCheckoutSession(orderId)`

**File:** `actions/boutique/point-of-sale.js` (add a new export) OR inline in `completePointOfSaleSale`.

This builds the Stripe Checkout Session. It's a POS-specific variant of the existing `createOrderCheckoutSession` (`actions/boutique/orders.js:612`) because the success/cancel URLs must differ (the POS experience, not the online cart experience).

**Stripe call (mirror orders.js:667-676):**
```js
stripe.checkout.sessions.create({
  payment_method_types: ["card"],
  line_items: lineItems,           // same price_data construction as orders.js
  mode: "payment",
  success_url: `${getAppBaseUrl()}/dashboard/boutique/point-of-sale?paid=${order.id}`,
  cancel_url: `${getAppBaseUrl()}/dashboard/boutique/point-of-sale?canceled=${order.id}`,
  customer_email: order.user.email,
  metadata: { kind: "order", orderId: order.id, source: "pos" },  // ← CRITICAL: kind:"order" routes the webhook to fulfillOrderPayment
  payment_intent_data: { metadata: { kind: "order", orderId: order.id, source: "pos" } },
  expires_at: Math.floor((Date.now() + 30 * 60 * 1000) / 1000),  // 30-min Stripe session expiry (matches order.expiresAt)
})
```

**Import** `stripe` from `@/lib/stripe` (the lazy-init client — confirmed working). **Import** `getAppBaseUrl` from `@/lib/site-url`.

**Auth:** this runs server-side inside `completePointOfSaleSale` which already calls `requirePointOfSaleAccess()`. No separate guard needed.

### Change 3 — `components/dashboard/boutique/PointOfSaleClient.jsx` (QR modal + polling)

**Current state (verified):**
- `method` state defaults to `"CARD"` (line 23)
- CASH/CARD toggle at lines 225-228
- "Encaisser et envoyer le reçu" button at line 232 calls `submitSale` (lines 124-143)
- On success, redirects to `/dashboard/boutique/orders/${orderId}` (line 141)
- **Imports needed but NOT currently present:** `qrcode` (npm, v1.5.4 installed), no polling lib

**New behavior when `method === "CARD"`:**

1. **`submitSale` branches on `method`:**
   - If `CASH`: current behavior (call `completePointOfSaleSale` → redirect to order).
   - If `CARD`: call `completePointOfSaleSale` → get back `{ checkoutUrl, sessionId, orderId }` → open the QR modal instead of redirecting.

2. **New QR modal state:**
   ```jsx
   const [qrModal, setQrModal] = useState(null); // { checkoutUrl, sessionId, orderId }
   ```
   When open, render a modal containing:
   - The QR code (generate from `checkoutUrl` using `qrcode.toDataURL()`)
   - "Total à payer: €XX.XX"
   - "Scannez avec votre téléphone pour payer"
   - A spinner / "En attente de paiement…"
   - A "Annuler" button (closes modal, cancels — see edge cases)

3. **Polling loop (when QR modal open):**
   ```jsx
   useEffect(() => {
     if (!qrModal) return;
     let active = true;
     const poll = async () => {
       const res = await getPointOfSaleOrderStatus(qrModal.orderId);
       if (res.status === "PAID" || res.status === "COMPLETED") {
         active = false;
         setQrModal(null);
         toast.success("Paiement confirmé");
         router.push(`/dashboard/boutique/orders/${qrModal.orderId}`);
       } else if (res.status === "CANCELLED" || res.status === "EXPIRED") {
         active = false;
         setQrModal(null);
         toast.error("Paiement annulé ou expiré");
       }
     };
     const interval = setInterval(poll, 2500);  // every 2.5s
     poll(); // immediate first check
     return () => { active = false; clearInterval(interval); };
   }, [qrModal]);
   ```

4. **New server action** `getPointOfSaleOrderStatus(orderId)` in `actions/boutique/point-of-sale.js`:
   - Auth: `requirePointOfSaleAccess()`
   - Returns `{ status: order.status }` (just the status field — cheap poll)
   - The webhook flips `PENDING_PAYMENT → PAID` so the poll sees the change within ~2.5s of the customer paying.

**QR generation (client-side):**
```jsx
import QRCode from "qrcode";
// inside the modal render:
const [qrDataUrl, setQrDataUrl] = useState("");
useEffect(() => {
  if (qrModal?.checkoutUrl) {
    QRCode.toDataURL(qrModal.checkoutUrl, { width: 256, margin: 1 }).then(setQrDataUrl);
  }
}, [qrModal?.checkoutUrl]);
// render: <img src={qrDataUrl} alt="QR code de paiement" />
```

### Change 4 — Email text fix in `fulfillOrderPayment`

**File:** `lib/orders/fulfill-order-payment.js:237-240`

**Problem:** the confirmation email special-cases `PICKUP_PREPAID` vs everything-else (shipping text). A POS order needs its own message.

**Decision:** set POS card orders to `fulfilmentMode: "PICKUP_PREPAID"` (not `PICKUP_ON_SITE`). Rationale:
- `PICKUP_PREPAID` = "pay online, collect in salon" — which is exactly what a POS card-via-QR sale is (the customer pays online via Stripe, then walks out with the product).
- `PICKUP_ON_SITE` = "reserve online, pay at counter" — that's the manual SumUp path, not the QR path.
- This means the existing `PICKUP_PREPAID` email branch works without modification.

**If you prefer `PICKUP_ON_SITE` instead**, add a branch at fulfill-order-payment.js:237 for the POS-specific message (e.g., "Votre paiement a été reçu. Merci pour votre achat en boutique.").

### Change 5 — POS order expiry handling

**Problem:** a POS card-via-QR order created as `PENDING_PAYMENT` will expire in 30 minutes if unpaid. The existing `expireStaleOrders` cron (`lib/orders/expire-stale-orders.js`) handles `PENDING_PAYMENT` orders — it cancels them and releases `reservedQuantity`. **This is exactly what we want** for a customer who walks away without paying.

**No change needed** — the cron already handles this. Just confirm the `expiresAt = now + 30min` set in Change 1 is respected by `expireStaleOrders` (it filters on `expiresAt < now`, verified at `expire-stale-orders.js:24-66`).

---

## §3. The flow — staff + customer experience

### Happy path (customer pays)
1. Sarah opens **Boutique → Caisse** on the tablet.
2. Scans the shampoo + serum with the USB scanner → cart shows €52.50.
3. Picks customer "Julie Martin" from autocomplete.
4. Picks **Carte** (already the default).
5. Clicks **Encaisser**.
6. A QR modal appears on the tablet: *"Total à payer: €52.50 — Scannez pour payer."*
7. Sarah says to Julie: *"Scannez ce code."*
8. Julie scans with her phone → Stripe Checkout opens → taps Apple Pay (3s) or types card (~30s) → ✓ paid.
9. The tablet auto-updates: modal flips to green "✓ Payé", redirects to the order detail page.
10. Julie receives the invoice PDF by email automatically (via the webhook → `fulfillOrderPayment` → `sendEmail`).

**Total staff time:** ~15 seconds of clicking + the time Julie spends on her phone.

### Cash path (unchanged)
Sarah picks **Espèces** → clicks Encaisser → order completes immediately → invoice emailed. Same as today.

---

## §4. Edge cases

| Scenario | Handling |
|---|---|
| **Customer doesn't pay / walks away** | Order stays `PENDING_PAYMENT`, `reservedQuantity` holds stock. After 30 min, `expireStaleOrders` cancels it + releases reservation. Sarah can also click "Annuler" in the QR modal to cancel immediately. |
| **Customer pays but WiFi drops on the tablet** | The webhook still fires from Stripe → `fulfillOrderPayment` runs server-side → order is fulfilled regardless of tablet connectivity. The tablet's poll just won't see the update until WiFi returns. |
| **Customer scans QR twice / opens checkout twice** | Stripe Checkout is idempotent per session — paying once succeeds, a second attempt shows "already paid." |
| **Staff clicks Encaisser twice** | First click creates the order + session. If a second Encaisser fires, check if `order.stripeCheckoutSessionId` already exists and the session is still open → reuse the existing QR instead of creating a new order. (Add this guard in `completePointOfSaleSale` CARD path.) |
| **Customer closes the checkout without paying** | Stripe session expires after 30 min → order expires via cron. No charge, stock released. |
| **Refund needed later** | ✅ **Now works** — the order has a real `Payment.transactionReference` + `Transaction.stripePaymentIntentId`, so `cancelOrder`/`reconcileStripeProductOrderRefund` can issue a real Stripe refund. (This fixes the broken-POS-refund gap from `PRODUCTION_ISSUES.md`.) |
| **Stripe session creation fails** | `completePointOfSaleSale` CARD path returns `{ success: false, message: "..." }`. Sarah sees an error toast, can retry or fall back to CASH / SumUp. |
| **Tablet refresh mid-sale** | The QR modal is ephemeral React state — refreshing loses the modal. BUT the order + session still exist. Add a "recovery" check: on POS page load, if `?paid=<orderId>` or there's a recent PENDING_PAYMENT order by this staff, offer to reopen the QR modal. (Nice-to-have, not MVP.) |

---

## §5. Why `PICKUP_PREPAID` (not `PICKUP_ON_SITE`) for POS card orders

The three fulfilment modes:
- `PICKUP_PREPAID` — pay online, collect in salon
- `PICKUP_ON_SITE` — reserve online, pay at counter (cash/manual)
- `SHIPPING_PREPAID` — pay online, ship via Mondial Relay

A POS card-via-QR sale is "pay online (Stripe Checkout), collect in salon (walk out with product)" = **`PICKUP_PREPAID`**. This also means the existing email branch and the `fulfillOrderPayment` next-status logic (`PAID` for non-shipping) both work without modification.

The CASH path stays `PICKUP_ON_SITE` (it really is "pay at counter").

---

## §6. Dependencies — all already installed

| Package | Version | Used for | Status |
|---|---|---|---|
| `qrcode` | ^1.5.4 | Generate QR from checkout URL (client-side) | ✅ Installed |
| `@stripe/stripe-js` | ^9.12.0 | (Optional) Stripe.js client if needed | ✅ Installed |
| `stripe` | ^22.3.2 | Server-side Checkout Session creation | ✅ Installed |

**No new npm dependencies.** No `npm install` needed.

---

## §7. Stripe account setup (one-time, in Stripe Dashboard)

1. **Confirm Checkout is enabled** — Stripe Dashboard → Settings → Payment methods → Checkout (enabled by default for all accounts).
2. **Webhook endpoint already exists** — the production webhook (`/api/webhooks/stripe`) already handles `checkout.session.completed` and routes to `fulfillOrderPayment` when `metadata.kind === "order"`. **No new webhook needed.** The POS Checkout Sessions carry the same `metadata.kind = "order"` so they flow through the same handler.
3. **Test mode** — use `sk_test_...` keys (already in `.env`). Test cards: `4242 4242 4242 4242` (Visa, succeeds), `4000 0027 6000 3184` (3D Secure), `4000 0000 0000 9995` (declines).

---

## §8. Testing plan

### Unit / local testing
1. **CASH path regression** — confirm the existing CASH flow still works identically (no behavior change).
2. **CARD path, happy path** — pick Carte → Encaisser → QR shows → simulate payment by hitting the webhook manually (or completing the checkout in a second browser tab with a test card) → confirm order flips to PAID, stock decrements, invoice generates, email sends.
3. **CARD path, walk-away** — pick Carte → Encaisser → DON'T pay → wait 30 min (or manually trigger cron) → confirm order expires, reservation released.
4. **Refund** — after a CARD-via-QR sale, run `cancelOrder` → confirm a real Stripe refund is issued (check Stripe Dashboard test mode). This is the fix for the broken-POS-refund gap.
5. **Double-click guard** — click Encaisser twice rapidly → confirm only one order + session created.

### Manual QR test (with a real phone)
1. Run `npm run dev` locally.
2. Use ngrok/cloudflare tunnel to expose localhost:3000 to the internet (so the customer's phone can reach the checkout URL): `npx localtunnel --port 3000` or `ngrok http 3000`.
3. Set `NEXT_PUBLIC_APP_URL` to the tunnel URL in `.env`.
4. Open the POS on your laptop, build a cart, pick Carte, Encaisser.
5. Scan the QR with your phone → complete checkout with `4242...` test card.
6. Confirm the laptop POS updates to "✓ Payé".

### Edge-case tests
- Customer pays then immediately asks to cancel → refund works.
- WiFi drops on staff tablet after QR shown → webhook still fulfills.
- 30-min expiry fires while customer is mid-checkout → order cancelled, customer's payment (if it lands) gets refunded by the `ORDER_NO_LONGER_PENDING` path in `fulfillOrderPayment`.

---

## §9. Implementation order (suggested sequence)

1. **Change 1 + 2** (server-side first): modify `completePointOfSaleSale` to split CASH/CARD, add `createPointOfSaleCheckoutSession` + `getPointOfSaleOrderStatus`. Test the action returns a valid Checkout URL for CARD, and CASH still works.
2. **Change 3** (client): add the QR modal + polling to `PointOfSaleClient.jsx`. Test the QR renders and polling detects payment.
3. **Change 4** (email): confirm `PICKUP_PREPAID` email is acceptable for POS, or add a POS-specific branch.
4. **Change 5** (expiry): no code needed — verify the cron handles POS orders by setting a short `expiresAt` in dev and waiting.
5. **End-to-end test** with a phone + tunnel (§8).
6. **Refund test** — confirm the broken-POS-refund gap is now closed.

**Estimated effort:** 1 day of focused dev for someone who knows the codebase.

---

## §10. What this fixes (bonus)

This change **closes two gaps from `PRODUCTION_ISSUES.md`:**

- **Issue #5 (POS refund broken):** POS card sales now have a real `Payment.transactionReference` + `Transaction.stripePaymentIntentId`, so `cancelOrder` / `reconcileStripeProductOrderRefund` can issue a real Stripe refund. Counter refunds are no longer silently skipped.
- **The "Carte is a label" gap:** POS card payments become real Stripe charges, not staff assertions. Invoices are backed by real transactions. Reconciliation matches Stripe payouts automatically.

---

## §11. File reference (exact line numbers, `origin/marwane` tree)

| File | What | Line |
|---|---|---|
| `actions/boutique/point-of-sale.js` | `completePointOfSaleSale` (split CASH/CARD here) | 115 |
| `actions/boutique/point-of-sale.js` | Order creation (status COMPLETED → PENDING_PAYMENT for CARD) | 174-203 |
| `actions/boutique/point-of-sale.js` | Payment + Transaction (CASH keeps; CARD removes) | 205-218 |
| `actions/boutique/point-of-sale.js` | Stock decrement (CASH keeps; CARD reserves instead) | 233-250 |
| `actions/boutique/orders.js` | `createOrderCheckoutSession` (reference for Stripe call shape) | 612-686 |
| `lib/orders/fulfill-order-payment.js` | `fulfillOrderPayment` (reused — no changes unless email branch) | 37, 237-240 |
| `app/api/webhooks/stripe/route.js` | Webhook dispatch to `fulfillOrderPayment` (no changes) | 177-178 |
| `components/dashboard/boutique/PointOfSaleClient.jsx` | CASH/CARD toggle | 225-228 |
| `components/dashboard/boutique/PointOfSaleClient.jsx` | Encaisser button → `submitSale` | 232, 124-143 |
| `components/dashboard/boutique/PointOfSaleClient.jsx` | Add QR modal + polling here | new code |
| `lib/validations/point-of-sale.js` | Schema (no change — CASH/CARD enum stays) | full file |
| `lib/stripe.js` | Lazy Stripe client (import from here) | — |
| `lib/site-url.js` | `getAppBaseUrl()` for success/cancel URLs | 23 |

---

## §12. Open question (decide before coding)

**Should POS card-via-QR orders use `PICKUP_PREPAID` or `PICKUP_ON_SITE`?**

- **`PICKUP_PREPAID` (recommended)** — zero email-text changes, semantically correct ("pay online, collect in salon"), works with existing `fulfillOrderPayment` branches.
- **`PICKUP_ON_SITE`** — requires adding a POS-specific email branch in `fulfill-order-payment.js:237`. More accurate to the literal "on site" naming but more code.

Pick `PICKUP_PREPAID` unless there's a reporting reason to distinguish POS sales from online-pickup sales.

---

**End of plan. Ready to start development.**
