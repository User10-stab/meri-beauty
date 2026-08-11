import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("point-of-sale security contracts", () => {
  const pos = source("actions/boutique/point-of-sale.js");

  test("requires the normal staff/admin orders permission", () => {
    expect(pos).toContain("DASHBOARD_PERMISSIONS.ORDERS");
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

  test("locks each stock row before checking availability", () => {
    expect(pos).toContain('FROM "ProductVariant"');
    expect(pos).toContain("FOR UPDATE");
    expect(pos).toContain("POS_STOCK_UNAVAILABLE");
  });

  test("sends a transactional receipt without marketing consent", () => {
    expect(pos).toContain("newsletterSubscribed: false");
    expect(pos).toContain("Merci pour votre achat");
    expect(pos).toContain("renderInvoicePdf");
    expect(pos).toContain("receiptEmailSent");
  });

  test("the counter UI supports ZXing camera scanning", () => {
    const ui = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(ui).toContain('from "@zxing/browser"');
    expect(ui).toContain("BrowserMultiFormatReader");
    expect(ui).toContain("decodeFromConstraints");
    expect(ui).toContain("facingMode");
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
