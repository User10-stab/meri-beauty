import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("point-of-sale security contracts", () => {
  const pos = source("actions/boutique/point-of-sale.js");

  test("requires the dedicated point-of-sale permission", () => {
    expect(pos).toContain("STAFF_PERMISSIONS.POINT_OF_SALE");
    expect(pos).toContain("hasDashboardPermission");
    expect(pos).toContain("requirePointOfSaleAccess");
  });

  test("settles payment, stock, invoice and audit together", () => {
    expect(pos).toContain("prisma.$transaction");
    expect(pos).toContain('status: "COMPLETED"');
    expect(pos).toContain('paymentType: "ON_SITE"');
    expect(pos).toContain('stockQuantity: { decrement: item.quantity }');
    expect(pos).toContain('type: "SALE"');
    expect(pos).toContain("issueInvoice(tx");
    expect(pos).toContain('action: "order.point_of_sale_completed"');
  });

  test("QR checkout is idempotent, reserves stock, and never records a manual card payment", () => {
    expect(pos).toContain('method === "CARD_QR"');
    expect(pos).toContain("posAttemptKey: attemptKey");
    expect(pos).toContain('source: "POS"');
    expect(pos).toContain("reservedQuantity: { increment: item.quantity }");
    expect(pos).toContain("idempotencyKey: `pos-qr-${order.posAttemptKey}`");
    expect(pos).toContain('metadata = { kind: "order", orderId: order.id, source: "pos" }');
  });

  test("status, recovery, and cancellation actions enforce POS ownership", () => {
    expect(pos).toContain("getPointOfSaleOrderStatus");
    expect(pos).toContain("recoverPointOfSaleCheckout");
    expect(pos).toContain("cancelPointOfSaleCheckout");
    expect(pos).toContain("canAccessPosOrder");
    expect(pos).toContain('order.source !== "POS"');
    expect(pos).toContain("stripe.checkout.sessions.expire");
    expect(pos).toContain("reservedQuantity: { decrement: item.quantity }");
  });

  test("locks each stock row before checking availability", () => {
    expect(pos).toContain('FROM "ProductVariant"');
    expect(pos).toContain("FOR UPDATE");
    expect(pos).toContain("POS_STOCK_UNAVAILABLE");
  });

  test("sends a transactional receipt without marketing consent", () => {
    expect(pos).toContain("newsletterSubscribed: false");
    expect(pos).toContain("Merci pour votre achat");
    expect(pos).toContain("renderTicketPdf");
    expect(pos).toContain("receiptEmailSent");
  });

  // 31 Aug 2026: the invoice PDF used to be attached and e-mailed directly
  // from the till for a valid-VAT customer — see
  // tests/critical/pos-receipt-vs-invoice-contracts.test.js for the full
  // contract. It must never come back here.
  test("never auto-e-mails the invoice PDF itself from the till", () => {
    expect(pos).not.toContain("renderInvoicePdf");
  });

  test("the counter UI supports ZXing camera scanning", () => {
    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(ui).toContain('from "@zxing/browser"');
    expect(ui).toContain("BrowserMultiFormatReader");
    expect(ui).toContain("decodeFromConstraints");
    expect(ui).toContain("facingMode");
  });

  test("the counter UI renders, polls, recovers, and explicitly cancels Stripe QR payments", () => {
    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(ui).toContain('from "qrcode"');
    expect(ui).toContain("recoverPointOfSaleCheckout");
    expect(ui).toContain("getPointOfSaleOrderStatus");
    expect(ui).toContain("cancelPointOfSaleCheckout");
    expect(ui).toContain('localStorage.setItem("meri-pos-attempt-key"');
    expect(ui).toContain("QR code Stripe Checkout");
    expect(ui).toContain("Terminal externe");
  });

  test("POS identity and idempotency are database-enforced", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260811203000_add_pos_qr_order_identity/migration.sql");
    expect(schema).toContain("posAttemptKey");
    expect(schema).toContain("createdByStaffId");
    expect(schema).toContain("source");
    expect(migration).toContain('CONSTRAINT "Order_pos_identity_check"');
    expect(migration).toContain('CREATE UNIQUE INDEX "Order_posAttemptKey_key"');
  });

  test("cash sales require an amount received that covers the total and record change given", () => {
    const validation = source("lib/validations/point-of-sale.js");
    expect(validation).toContain('data.method !== "CASH" || data.cashReceived != null');

    expect(pos).toContain('method === "CASH" && cashReceived < subtotal');
    expect(pos).toContain('throw new Error("POS_CASH_INSUFFICIENT")');
    expect(pos).toContain('cashReceived: method === "CASH" ? cashReceived : null');
    expect(pos).toContain('changeGiven: method === "CASH" ? changeGiven : null');

    const schema = source("prisma/schema.prisma");
    expect(schema).toContain("cashReceived");
    expect(schema).toContain("changeGiven");

    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(ui).toContain("pos-cash-received");
    expect(ui).toContain("Monnaie à rendre");
  });

  test("billing address is required only when the resolved customer doesn't already have one on file", () => {
    expect(pos).toContain('throw new Error("POS_ADDRESS_REQUIRED")');
    expect(pos).toContain("needsAddress = !customer?.addressLine1");
    expect(pos).toContain('error.message === "POS_ADDRESS_REQUIRED"');

    const validation = source("lib/validations/point-of-sale.js");
    expect(validation).toContain("addressLine1");
    // Optional at the schema level — completePointOfSaleSale enforces the
    // real requirement server-side once it knows the customer's DB state.
    expect(validation).toContain('.optional().or(z.literal(""))');

    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(ui).toContain("needsAddress = !addressOnFile");
    expect(ui).toContain("updateCustomerAddress");
  });

  test("an existing email is reused case-insensitively instead of creating a duplicate customer", () => {
    expect(pos).toContain("resolvePointOfSaleCustomer");
    expect(pos).toContain('email: { equals: requestedCustomer.email, mode: "insensitive" }');
    expect(pos).toContain("customer = await resolvePointOfSaleCustomer(tx, requestedCustomer, billingProfileInclude)");
    expect(pos).toContain("Order.userId");
  });

  test("the counter can sell an ad-hoc service line alongside products, with no stock/variant lookup for it", () => {
    expect(pos).toContain('item.type !== "PRODUCT"');
    expect(pos).toContain("serviceLines = items.filter");
    expect(pos).toContain("serviceSubtotal");
    expect(pos).toContain("...pricedServiceLines.map((item) => ({");

    const validation = source("lib/validations/point-of-sale.js");
    expect(validation).toContain('type: z.literal("PRODUCT")');
    expect(validation).toContain('type: z.literal("SERVICE")');
    expect(validation).toContain("discriminatedUnion");

    const schema = source("prisma/schema.prisma");
    expect(schema).toContain("variantId String?");

    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(ui).toContain("addServiceLine");
    expect(ui).toContain('type: "SERVICE"');
  });

  test("a walk-in client de passage sale creates no account and issues a ticket instead of an invoice", () => {
    expect(pos).toContain("const isWalkIn = requestedCustomer === null");
    expect(pos).toContain("userId: customer?.id ?? null");
    expect(pos).toContain("const wantsInvoice = !isWalkIn && (customer?.isCompany || requestInvoice)");
    expect(pos).toContain("const invoice = !wantsInvoice");
    expect(pos).toContain("renderTicketPdf(");

    const validation = source("lib/validations/point-of-sale.js");
    expect(validation).toContain("customer: customerSchema.nullable()");
    expect(validation).toContain('data.customer !== null || data.method !== "CARD_QR"');

    const schema = source("prisma/schema.prisma");
    expect(schema).toMatch(/userId String\?\s*\n\s*user\s+User\?/);

    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(ui).toContain("isWalkIn");
    expect(ui).toContain("toggleWalkIn");
    expect(ui).toContain('customer: isWalkIn ? null : customer');
  });

  test("shared Stripe fulfillment completes POS orders and attributes stock to the cashier", () => {
    const fulfillment = source("lib/orders/fulfill-order-payment.js");
    expect(fulfillment).toContain('order.source === "POS"');
    expect(fulfillment).toContain('? "COMPLETED"');
    expect(fulfillment).toContain("pickedUpByStaffId: order.createdByStaffId");
    expect(fulfillment).toContain("createdById: isPointOfSale ? order.createdByStaffId : null");
    expect(fulfillment).toContain('action: "order.point_of_sale_qr_paid"');
  });

  test("external terminal sales require explicit approval and a ticket reference before completing", () => {
    const validation = source("lib/validations/point-of-sale.js");
    expect(validation).toContain('data.method !== "EXTERNAL_TERMINAL" || data.terminalApproved === true');
    expect(validation).toContain('data.method !== "EXTERNAL_TERMINAL" || Boolean(data.terminalReference?.trim())');

    expect(pos).toContain('manualReference: method === "EXTERNAL_TERMINAL" ? terminalReference.trim() : null');

    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(ui).toContain("terminalApproved");
    expect(ui).toContain("terminalReference");
    expect(ui).toContain("APPROUVÉ");
    expect(ui).toContain("Confirmer le paiement par terminal externe");
    expect(ui).toContain("confirmDisabled={!terminalApproved || !terminalReference.trim()}");
  });

  test("the counter accepts both USB scans and QR camera results", () => {
    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    const labels = source("components/dashboard/boutique/BarcodeLabelDialog.jsx");
    expect(ui).toContain("Lecteur USB : QR ou code-barres");
    expect(ui).toContain("BrowserMultiFormatReader");
    expect(ui).toContain("scanResult.getText()");
    expect(labels).toContain("QRCode.toDataURL(variant.barcode");
  });
});

describe("inventory scanner contracts", () => {
  test("stock scan resolves an exact barcode or SKU before opening adjustment", () => {
    const stock = source("components/dashboard/boutique/StockPageClient.jsx");
    expect(stock).toContain("handleUsbScan");
    expect(stock).toContain("item.barcode?.trim() === code");
    expect(stock).toContain("item.sku?.trim().toLowerCase() === code.toLowerCase()");
    expect(stock).toContain("setAdjusting(variant)");
  });

  test("catalogue, self-scan and pickup dialogs expose USB scan fields", () => {
    const catalogue = source("components/dashboard/boutique/ProductScanDialog.jsx");
    const selfScan = source("components/boutique/ProductScanClient.jsx");
    const pickup = source("components/dashboard/boutique/PickupScannerDialog.jsx");
    expect(catalogue).toContain("handleUsbScan");
    expect(catalogue).toContain("Lecteur USB : QR ou code-barres");
    expect(selfScan).toContain("handleUsbScan");
    expect(selfScan).toContain("Lecteur USB : QR ou code-barres");
    expect(pickup).toContain("Lecteur USB : scannez le QR");
    expect(pickup).toContain("onDecoded(code.toUpperCase())");
  });
});
