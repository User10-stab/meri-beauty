import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * One counter, one set of fields (2026-09-21).
 *
 * The retail till, « Pointage & encaissement » (booking balance, pickup
 * order, new prestation, new atelier/formation seat) and the two appointment
 * collection screens each grew their own payment UI: tiles here, radio
 * buttons there, a dropdown elsewhere — « Terminal externe » on one screen
 * and « Carte — terminal » on the next, for the very same payment. The buyer
 * capture drifted the same way (the booking fiche had its own VAT and
 * address inputs).
 *
 * These pin the shared components so they cannot drift apart again. They are
 * source checks, like the other counter UI contracts: what is asserted is
 * that every screen renders the SAME component, not how it looks.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const PAYMENT_SCREENS = [
  "components/dashboard/boutique/counter/CounterCart.jsx", // retail till
  "components/dashboard/boutique/counter/FicheSettleAction.jsx", // booking balance
  "components/dashboard/boutique/counter/PickupFiche.jsx", // boutique pickup
  "components/dashboard/boutique/counter/CounterBookingComposer.jsx", // prestation + séance
  "components/dashboard/appointments/AppointmentsPageClient.jsx", // « Terminer » a RDV
  "components/dashboard/calendar/AppointmentDrawer.jsx", // the same, from the calendar
];

describe("every screen that takes money uses the same payment fields", () => {
  const shared = source("components/dashboard/boutique/counter/CounterPaymentMethods.jsx");

  it("one component owns the method tiles, the labels and the terminal reference", () => {
    for (const [method, label] of [
      ["CARD_QR", "Carte QR"],
      ["CASH", "Espèces"],
      ["EXTERNAL_TERMINAL", "Terminal externe"],
      ["TRANSFER", "Virement"],
    ]) {
      expect(shared).toContain(`${method}: { label: "${label}"`);
    }
    expect(shared).toContain('export const TERMINAL_REFERENCE_LABEL = "Référence du ticket du terminal"');
  });

  it("no screen rolls its own method picker any more", () => {
    for (const path of PAYMENT_SCREENS) {
      const code = source(path);
      expect(code, path).toContain("<CounterPaymentMethodTiles");
      // The three shapes this replaced.
      expect(code, path).not.toContain("Carte — terminal");
      expect(code, path).not.toMatch(/<option value="EXTERNAL_TERMINAL">/);
      expect(code, path).not.toMatch(/type="radio"[^>]*EXTERNAL_TERMINAL/);
    }
  });

  it("the terminal's receipt reference is asked the same way, and stays required", () => {
    for (const path of PAYMENT_SCREENS) {
      const code = source(path);
      if (!code.includes("EXTERNAL_TERMINAL")) continue;
      expect(code, path).toContain("<CounterTerminalReference");
    }
    expect(shared).toContain('aria-label={TERMINAL_REFERENCE_LABEL}');
  });

  it("cash shows the change due on every screen that takes cash", () => {
    expect(shared).toContain("Monnaie à rendre");
    for (const path of [
      "components/dashboard/boutique/counter/CounterCart.jsx",
      "components/dashboard/boutique/counter/FicheSettleAction.jsx",
      "components/dashboard/boutique/counter/PickupFiche.jsx",
      "components/dashboard/boutique/counter/CounterBookingComposer.jsx",
    ]) {
      expect(source(path), path).toContain("<CounterCashReceived");
    }
  });

  it("each screen offers what its own action accepts", () => {
    expect(source("components/dashboard/boutique/counter/CounterCart.jsx")).toContain('["CARD_QR", "CASH", "EXTERNAL_TERMINAL", "TRANSFER"]');
    // A boutique pickup is always the salon's own sale, so both the QR and
    // the transfer are unconditional there.
    expect(source("components/dashboard/boutique/counter/PickupFiche.jsx")).toContain(
      'methods={["CARD_QR", "CASH", "EXTERNAL_TERMINAL", "TRANSFER"]}'
    );
    // A booking or a séance can belong to an independent — the salon never
    // banks her sale, so « Virement » is withheld there. Both screens choose
    // the list from that flag rather than hard-coding it.
    expect(source("components/dashboard/boutique/counter/FicheSettleAction.jsx")).toContain(
      `const settleMethods = ticket.independent
    ? ["CASH", "EXTERNAL_TERMINAL"]
    : ["CARD_QR", "CASH", "EXTERNAL_TERMINAL", "TRANSFER"]`
    );
    expect(source("components/dashboard/boutique/counter/CounterBookingComposer.jsx")).toContain(
      'const sessionMethods = session?.independent ? ["CASH", "EXTERNAL_TERMINAL"] : ["CASH", "EXTERNAL_TERMINAL", "TRANSFER"]'
    );
    // The appointment modals settle on the spot only.
    for (const path of [
      "components/dashboard/appointments/AppointmentsPageClient.jsx",
      "components/dashboard/calendar/AppointmentDrawer.jsx",
    ]) {
      expect(source(path), path).toContain('methods={["CASH", "EXTERNAL_TERMINAL"]}');
    }
  });

  it("at the counter the submit button is the attestation — it names the amount received", () => {
    // No separate "j'ai bien reçu" checkbox left on the counter screens; the
    // modal collections (appointments) keep their explicit tick.
    for (const path of PAYMENT_SCREENS.slice(0, 4)) {
      expect(source(path), path).not.toMatch(/type="checkbox"[^>]*(received|Received)/);
    }
    expect(source("components/dashboard/boutique/counter/FicheSettleAction.jsx")).toContain("J'ai bien reçu ${formatPrice(amountDue)}");
    expect(source("components/dashboard/boutique/counter/PickupFiche.jsx")).toContain("J'ai bien reçu ${formatPrice(order.totalAmount)}");
    expect(source("components/dashboard/boutique/counter/CounterBookingComposer.jsx")).toContain("J'ai bien reçu ${money(finalTotal)}");
    expect(source("components/dashboard/boutique/counter/CounterBookingComposer.jsx")).toContain("J'ai bien reçu ${money(sessionCollected)}");
  });
});

describe("every screen that captures a buyer uses the same fields", () => {
  const buyerForm = source("components/dashboard/boutique/counter/CounterBuyerForm.jsx");

  it("the VAT box and the address block are shared components", () => {
    expect(buyerForm).toContain("export function CounterVatField");
    expect(buyerForm).toContain("export function CounterAddressFields");
    // The booking fiche's « compléter le client » panel had its own copies.
    const fiche = source("components/dashboard/boutique/counter/FicheBuyerAction.jsx");
    expect(fiche).toContain("<CounterVatField");
    expect(fiche).toContain("<CounterAddressFields");
    expect(fiche).not.toContain('placeholder="Rue et numéro"');
    expect(fiche).not.toContain('placeholder="Pays (BE, FR…)"');
  });

  it("the address is asked in one order, with one set of placeholders", () => {
    const block = buyerForm.slice(buyerForm.indexOf("export function CounterAddressFields"));
    const order = ["Rue et numéro", "Boîte, étage (facultatif)", "Code postal", "Ville"].map((placeholder) =>
      block.indexOf(`placeholder="${placeholder}"`)
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the phone stays optional everywhere, as the server schema has it", () => {
    expect(buyerForm).toContain('placeholder="Téléphone (facultatif)"');
    expect(source("lib/validations/counter-customer.js")).toContain("phone: z.string().trim().max(20).optional()");
    // The booking composer used to demand it before the server ever saw it.
    expect(source("components/dashboard/boutique/counter/CounterBookingComposer.jsx")).toContain(
      "Choisissez ou créez le client — nom et e-mail sont requis."
    );
  });

  it("each screen says why the address is required, without claiming the other's rule", () => {
    expect(buyerForm).toContain("Adresse de facturation obligatoire {addressReason}");
    // The till: any new customer or one with no address on file.
    expect(buyerForm).toContain('addressReason = "pour ce client (nouveau ou sans adresse enregistrée)"');
    // A booking: only once a VAT number is attached (resolveCounterCustomer).
    expect(source("components/dashboard/boutique/counter/CounterBookingComposer.jsx")).toContain(
      'addressReason="pour un client avec un numéro de TVA"'
    );
  });
});
