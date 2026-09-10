import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin, seedActivitySessionOwnedBy, seedFormationReservation } from "./fixtures/seed-dashboard.mjs";

/**
 * The Operations B2B delivery dialog — the combined-channel redesign.
 *
 * The dialog is now a channel checklist (e-mail, Peppol via Peppyrus, or
 * both) plus a global, admin-managed internal address book offered when
 * e-mail is ticked. Nothing is pre-selected; the admin ticks channels and
 * addresses, then confirms once.
 *
 * tests/critical/b2b-document-delivery-recipients-contracts.test.js pins the
 * server contracts (admin-gating, de-dupe, "client address never comes from
 * the caller"). This drives the real dialog against a real seeded B2B
 * invoice and asserts the wiring a source grep cannot see — the list loads,
 * an address can be added / edited / removed, and "Envoyer" stays disabled
 * until a real recipient is chosen. It stops at the confirm step: no send is
 * fired, so no e-mail leaves and no Peppyrus message is transmitted (unlike
 * the old Billit integration, a Peppyrus send IS a live Peppol
 * transmission — see the confirmation copy assertion below).
 */

const OPERATIONS_PAGE = "/dashboard/operations";
const BE_VAT = "BE0123456749"; // well-formed mod-97 checksum

function rowFor(page, text) {
  return page.locator("tr").filter({ hasText: text }).first();
}

test.describe("the B2B delivery dialog offers a managed recipient list and a combined send", () => {
  let admin;
  let customer;
  let formationTitle;

  test.afterAll(async () => {
    await disconnect();
  });

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    admin = await seedAdmin({ label: "delivery" });
    customer = await seedCustomer({ label: "delivery-buyer", withAddress: true });

    const { formation, session } = await seedActivitySessionOwnedBy({
      kind: "FORMATION",
      createdById: admin.user.id,
      price: 200,
    });
    formationTitle = formation.title;

    const { payment } = await seedFormationReservation({ session, customer, price: 200 });

    await prisma.invoice.create({
      data: {
        number: `E2E-${getRunId()}-B2B`,
        source: "FORMATION",
        paymentId: payment.id,
        sellerName: "Meri Beauty (e2e)",
        customerName: customer.fullName,
        customerLegalName: `${customer.fullName} SPRL`,
        customerEmail: customer.email,
        customerAddress: "Avenue de la Livraison 12, 1000 Bruxelles",
        customerType: "B2B",
        customerVatNumber: BE_VAT,
        taxCountryCode: "BE",
        subtotalExclVat: 165.29,
        vatRate: 21,
        vatAmount: 34.71,
        totalInclVat: 200,
        lines: {
          create: [
            {
              description: "Formation (e2e)",
              quantity: 1,
              unitPrice: 200,
              lineTotal: 200,
              unitPriceExclVat: 165.2893,
              lineTotalExclVat: 165.29,
            },
          ],
        },
      },
    });
  });

  test("channels start unchecked, the internal list is editable, and send is gated on a recipient", async ({ page }) => {
    await loginAs(page, admin.credentials);
    await page.goto(`${OPERATIONS_PAGE}?tab=formations`);

    const row = rowFor(page, formationTitle);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: /envoyer la facture/i }).click();

    const dialog = page.getByRole("dialog", { name: /envoyer la facture/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // ── Nothing pre-selected ─────────────────────────────────────────────
    const emailBox = dialog.getByRole("checkbox", { name: /envoyer par e-mail/i });
    const peppyrusBox = dialog.getByRole("checkbox", { name: /envoyer via peppol/i });
    await expect(emailBox).not.toBeChecked();
    await expect(peppyrusBox).not.toBeChecked();
    // Peppyrus is enabled here — this invoice is B2B with a Belgian VAT number.
    await expect(peppyrusBox).toBeEnabled();

    const sendButton = dialog.getByRole("button", { name: "Envoyer", exact: true });
    await expect(sendButton).toBeDisabled();

    // ── Tick e-mail: the address book loads with the salon's own address ──
    await emailBox.check();
    await expect(dialog.getByText("contact@meribeautystudio.com")).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(customer.email, { exact: false })).toBeVisible();

    // Still nothing chosen -> still disabled (client toggle + all rows unticked).
    await dialog.getByRole("checkbox", { name: /envoyer aussi au client/i }).uncheck();
    await expect(sendButton).toBeDisabled();

    // ── Add an internal address ──────────────────────────────────────────
    const uniqueEmail = `compta+${getRunId()}@meribeautystudio.com`.toLowerCase();
    await dialog.getByRole("button", { name: /ajouter une adresse/i }).click();
    await dialog.getByPlaceholder("adresse@exemple.com").fill(uniqueEmail);
    await dialog.getByPlaceholder("Libellé (facultatif)").fill("Compta e2e");
    await dialog.getByRole("button", { name: /^Ajouter$/ }).click();

    const addedRow = dialog.locator("li").filter({ hasText: uniqueEmail });
    await expect(addedRow).toBeVisible({ timeout: 10_000 });
    // Auto-checked on add -> a real recipient exists -> send unlocks.
    await expect(addedRow.getByRole("checkbox")).toBeChecked();
    await expect(sendButton).toBeEnabled();

    // ── Edit it ─────────────────────────────────────────────────────────
    await addedRow.getByRole("button", { name: /^Modifier / }).click();
    const labelInput = dialog.getByPlaceholder("Libellé (facultatif)");
    await labelInput.fill("Comptabilité");
    await dialog.getByRole("button", { name: /Enregistrer/ }).click();
    await expect(dialog.locator("li").filter({ hasText: "Comptabilité" })).toBeVisible({ timeout: 10_000 });

    // ── Both channels -> the confirm step names both, then we stop ───────
    await peppyrusBox.check();
    await sendButton.click();
    await expect(dialog.getByText(/Confirmer l'envoi/i)).toBeVisible();
    await expect(dialog.getByText(/E-mail à :/).filter({ hasText: uniqueEmail })).toBeVisible();
    // The live-send warning: unlike the old Billit copy ("finalisé
    // manuellement"), this must be unambiguous that confirming transmits
    // the document over the real Peppol network immediately.
    await expect(dialog.getByText(/transmet immédiatement le document sur le réseau Peppol réel/i)).toBeVisible();

    // Back out — this test moves no money and sends no e-mail.
    await dialog.getByRole("button", { name: /Annuler/ }).click();

    // ── Remove the address we added, leaving the list as we found it ─────
    await addedRow.getByRole("button", { name: /^Supprimer / }).click();
    await dialog.getByRole("button", { name: /Confirmer/ }).click();
    await expect(dialog.locator("li").filter({ hasText: uniqueEmail })).toHaveCount(0, { timeout: 10_000 });

    // Nothing was ever sent.
    const invoice = await prisma.invoice.findFirst({ where: { customerVatNumber: BE_VAT }, orderBy: { issuedAt: "desc" } });
    expect(invoice.emailSentAt).toBeNull();
    expect(invoice.peppyrusSentAt).toBeNull();
  });
});
