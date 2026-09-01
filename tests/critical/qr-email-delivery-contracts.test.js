import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { qrPngAttachment } from "@/lib/qrcode";
import {
  reservationConfirmedEmail,
  workshopReservationConfirmationEmail,
  formationReservationConfirmationEmail,
} from "@/lib/email-templates";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// "Mon compte" was the only place a QR ever appeared. Most customers never
// open it, and the moment they need the code — standing at the counter or at
// a door, on their phone — is the moment they are least likely to go looking
// for it. The confirmation e-mail is the one thing they all receive.
describe("the QR travels with the confirmation e-mail", () => {
  test("it is produced as a real PNG file, not an inline image", async () => {
    // A `data:` URI is stripped by Gmail and most webmail; CID embedding is
    // spelled differently by our two transports (Resend: content_id,
    // nodemailer: cid). An attachment is the only form that renders for
    // every recipient.
    const attachment = await qrPngAttachment("A-3F9C1B2D4E", "billet.png");
    expect(attachment.filename).toBe("billet.png");
    expect(Buffer.isBuffer(attachment.content)).toBe(true);
    // PNG magic number — proves it is a decodable image, not a data URL string.
    expect(attachment.content.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  test("sendEmail already accepts the shape it produces", () => {
    expect(source("lib/email.js")).toContain("attachments?.length ? { attachments } : {}");
  });
});

describe("a boutique order carries its pickup QR", () => {
  test("the paid-online pickup confirmation attaches it", () => {
    const fulfil = source("lib/orders/fulfill-order-payment.js");
    expect(fulfil).toContain('qrPngAttachment(order.pickupCode, `retrait-${order.orderNumber}.png`)');
    expect(fulfil).toContain("...(emailAttachments.length ? { attachments: emailAttachments } : {})");
  });

  test("it rides alongside the ticket rather than replacing it", () => {
    // 1 Sep 2026: the invoice PDF itself is no longer auto-attached here —
    // only a ticket goes out automatically, same rule as every other
    // channel (see pos-receipt-vs-invoice-contracts.test.js).
    const fulfil = source("lib/orders/fulfill-order-payment.js");
    const block = fulfil.slice(fulfil.indexOf("const emailAttachments = ["));
    expect(block).toContain("ticketPdf ? [{ filename: `ticket-${order.orderNumber}.pdf`");
    expect(block).toContain("pickupQr ? [pickupQr] : []");
  });

  test("a shipped order and a POS sale get no pickup QR", () => {
    // Neither has a counter to present anything at: the POS customer is
    // already standing at the till, and a parcel goes to a relay point.
    expect(source("lib/orders/fulfill-order-payment.js")).toContain(
      '!isPointOfSale && order.pickupCode && order.fulfilmentMode === "PICKUP_PREPAID"'
    );
  });

  test("the pay-on-site pickup e-mail attaches it too", () => {
    const orders = source("actions/boutique/orders.js");
    expect(orders).toContain("async function sendPickupConfirmationEmail(");
    expect(orders).toContain('qrPngAttachment(pickupCode, `retrait-${order.orderNumber}.png`)');
    expect(orders).toContain("...(qr ? { attachments: [qr] } : {})");
  });
});

describe("an atelier or formation booking carries its door ticket", () => {
  test.each([
    ["lib/workshops/fulfill-workshop-reservation-payment.js", "billet-atelier"],
    ["lib/formations/fulfill-formation-reservation-payment.js", "billet-formation"],
  ])("%s attaches the ticket QR", (file, prefix) => {
    const content = source(file);
    expect(content).toContain(`qrPngAttachment(checkInCode, \`${prefix}-\${checkInCode}.png\`)`);
    expect(content).toContain("...(emailAttachments.length ? { attachments: emailAttachments } : {})");
  });

  test.each([
    ["lib/workshops/fulfill-workshop-reservation-payment.js"],
    ["lib/formations/fulfill-formation-reservation-payment.js"],
  ])("%s passes the readable code to the e-mail body", (file) => {
    expect(source(file)).toContain("      checkInCode,\n    }),");
  });
});

describe("every appointment confirmation path carries an R-ticket", () => {
  test.each([
    ["actions/appointment/create-manual-appointment.js"],
    ["actions/appointment/confirm-accepted-appointment.js"],
    ["lib/appointments/accepted-payment.js"],
    ["actions/reservation/create-reservation.js"],
    ["app/api/webhooks/stripe/route.js"],
  ])("%s builds the appointment QR after confirmation", (file) => {
    const content = source(file);
    expect(content).toContain("buildAppointmentCheckInEmailAssets");
    expect(content).toContain("checkInCode: ticket.checkInCode");
    expect(content).toContain("ticket.attachment");
  });

  test("the helper keeps the readable code when PNG generation fails", () => {
    const helper = source("lib/activities/appointment-check-in-qr.js");
    expect(helper).toContain("return { checkInCode, attachment }");
    expect(helper).toContain("CHECK_IN_KINDS.APPOINTMENT");
    expect(helper).toContain("billet-rendez-vous-${checkInCode}.png");
  });
});

describe("the e-mail body carries the code, not just the attachment", () => {
  const templates = source("lib/email-templates.js");

  test("appointments and both activity confirmations render the ticket block", () => {
    expect(templates).toContain("function checkInTicketBlock(code)");
    expect(templates.match(/\$\{checkInTicketBlock\(checkInCode\)\}/g) ?? []).toHaveLength(3);
  });

  test("the block disappears entirely when no code was minted", () => {
    // A mint failure must not leave an empty dashed box promising a ticket.
    expect(templates).toContain('if (!code) return "";');
  });

  test("the readable code survives a stripped attachment", () => {
    // It is also what staff type in when the customer's phone is dead or the
    // room has no signal.
    expect(templates).toContain("${code}</p>");
    expect(templates).toContain("ou donnez simplement le code ci-dessus");
  });

  test("the plain-text part is not left behind", () => {
    // Missing or thin text parts raise spam scoring, and some clients show
    // only that half.
    expect(templates.match(/Le QR code correspondant est joint/g) ?? []).toHaveLength(3);
  });
});

// Rendering the templates for real, rather than matching their source: this
// is what actually proves the code reaches the customer's inbox.
describe("a rendered confirmation e-mail shows the ticket", () => {
  const base = {
    customerName: "Camille Dupont",
    sessionDate: "samedi 6 septembre 2026, 14:00",
    seatsCount: 2,
    paidAmount: 45,
    totalAmount: 90,
    balanceDue: 45,
    isFullPayment: false,
  };

  const CASES = [
    ["atelier", workshopReservationConfirmationEmail, { ...base, activityTitle: "Maquillage jour" }],
    ["formation", formationReservationConfirmationEmail, { ...base, formationTitle: "Colorimétrie" }],
  ];

  test.each(CASES)("%s: the code appears in both the HTML and the text part", (_label, render, params) => {
    const email = render({ ...params, checkInCode: "A-3F9C1B2D4E" });

    expect(email.html).toContain("A-3F9C1B2D4E");
    expect(email.text).toContain("A-3F9C1B2D4E");
    expect(email.html).toContain("Le QR code est joint");
  });

  test.each(CASES)("%s: no ticket block at all when no code was minted", (_label, render, params) => {
    const email = render({ ...params, checkInCode: null });

    expect(email.html).not.toContain("Votre billet d'entrée");
    expect(email.text).not.toContain("Votre billet d'entrée");
    // The rest of the confirmation is unaffected.
    expect(email.html).toContain("Camille Dupont");
  });

  test("rendez-vous: the R-code appears in both HTML and plain text", () => {
    const email = reservationConfirmedEmail({
      customerName: "Camille Dupont",
      serviceName: "Soin visage",
      staffName: "Sarah",
      date: new Date("2026-09-06T12:00:00.000Z"),
      time: "14:00",
      checkInCode: "R-3F9C1B2D4E",
    });
    expect(email.html).toContain("R-3F9C1B2D4E");
    expect(email.text).toContain("R-3F9C1B2D4E");
    expect(email.html).toContain("Le QR code est joint");
  });
});
