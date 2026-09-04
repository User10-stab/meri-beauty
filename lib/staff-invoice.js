import { prisma } from "@/lib/prisma";
import { issueInvoice, buildInvoiceCustomer, buildRentalDescription } from "@/lib/invoicing";
import { formatUserAddress } from "@/lib/format-address";
import { sendEmail } from "@/lib/email";
import { renderInvoicePdf } from "@/lib/pdf/render";

/**
 * Creates and emails an invoice for a staff contract's fixed rent.
 *
 * Reuses the existing invoice system (issueInvoice / renderInvoicePdf / sendEmail)
 * — no new invoice tables or PDF templates.
 *
 * - Agreed price: contract.fixedRent (VAT-inclusive)
 * - Due date: 7 days after contract.startDate (not creation time)
 * - Recipient: staff member's email
 * - Idempotent: if an invoice already exists for this contract, it is reused
 *   (prevents double-billing on retry).
 * - Email failure does not roll back the staff/contract — it is logged and
 *   the staff creation still succeeds.
 *
 * Must be called AFTER the staff+contract transaction has committed.
 *
 * @param {{ contract: { id: string, fixedRent: any, startDate: Date }, staff: { id: string, userId: string }, user: { fullName: string, email: string, vatNumber?: string|null, isCompany?: boolean, billingProfile?: any } }} params
 * @returns {Promise<{ invoice: any|null, emailed: boolean, error?: string }>}
 */
export async function createAndSendStaffContractInvoice({ contract, user }) {
  if (!contract?.id || !contract?.fixedRent || !contract?.startDate || !user?.email) {
    console.warn("[staff-invoice] missing contract/user data, skipping invoice", { contractId: contract?.id });
    return { invoice: null, emailed: false, error: "Données manquantes pour la facturation" };
  }

  const amount = Number(contract.fixedRent);
  if (!Number.isFinite(amount) || amount < 0) {
    console.warn("[staff-invoice] invalid fixedRent", { contractId: contract.id, fixedRent: contract.fixedRent });
    return { invoice: null, emailed: false, error: "Montant du contrat invalide" };
  }

  // Idempotency: check if invoice already exists for this contract
  try {
    const existing = await prisma.invoice.findUnique({
      where: { contractId: contract.id },
      include: { lines: true },
    });
    if (existing) {
      // Already invoiced — ensure email is sent (best-effort) but don't duplicate invoice
      console.log(`[staff-invoice] invoice already exists for contract ${contract.id}: ${existing.number} — skipping creation`);
      // Optionally re-send email if requested? For now just return existing without re-sending to avoid spam on retry.
      return { invoice: existing, emailed: false };
    }
  } catch (err) {
    console.error("[staff-invoice] idempotency check failed", err);
    // Continue to try creation — unique constraint will guard anyway
  }

  // Due date = 7 days after contract start date (calendar days, not creation time)
  const startDate = new Date(contract.startDate);
  const dueDate = new Date(startDate);
  dueDate.setDate(dueDate.getDate() + 7);

  // Build customer from user — staff users have minimal fields (no address), so
  // we ensure at least name/email are present; address is optional for STAFF_CONTRACT.
  // If user has no address, formatUserAddress returns null, which is allowed for staff invoices.
  let customer;
  // Cabin/space type for the line description (Contract has no rentalType
  // column — it lives on RentalRequest). Hoisted so the invoice lines below
  // can use it even if customer building falls back.
  let rentalType = contract.rentalType ?? null;
  try {
    // Try to load full user with billingProfile for B2B handling if not already included
    let fullUser = user;
    if (!user.addressLine1 && user.userId) {
      // user param may be minimal; fetch full row if needed
      const dbUser = await prisma.user.findUnique({
        where: { id: user.userId ?? user.id },
        include: { billingProfile: true },
      });
      if (dbUser) fullUser = dbUser;
    } else if (user.id && !user.billingProfile) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: { billingProfile: true },
      });
      if (dbUser) fullUser = { ...dbUser, ...user, billingProfile: dbUser.billingProfile };
    }

    // Enrichment from the contract row itself (best-effort, never blocking):
    // the cabin/space type lives on RentalRequest, and the staff VAT number
    // lives on Staff (independent staff created via the dashboard store it
    // there, not on User).
    let staffVatNumber = null;
    try {
      const enriched = await prisma.contract.findUnique({
        where: { id: contract.id },
        select: {
          staff: { select: { vatNumber: true } },
          rentalRequest: { select: { rentalType: true } },
        },
      });
      rentalType = enriched?.rentalRequest?.rentalType ?? contract.rentalType ?? null;
      staffVatNumber = enriched?.staff?.vatNumber ?? null;
    } catch (err) {
      console.error("[staff-invoice] contract enrichment failed (non-blocking)", err);
    }

    // Use buildInvoiceCustomer for consistency (handles VIES, B2B, etc.)
    // but override address fallback for staff: staff users created via the
    // dashboard have no address on file, so fall back to the VIES-validated
    // professional address when one was captured at VAT verification time.
    const address = formatUserAddress(fullUser) || fullUser?.vatValidationAddress || null;
    // For staff, vatNumber may be on Staff.vatNumber, not User.vatNumber
    // We pass the staff vat if user doesn't have one — caller should merge
    if (fullUser) {
      customer = {
        fullName: fullUser.fullName,
        email: fullUser.email,
        vatNumber: fullUser.vatNumber ?? user.vatNumber ?? staffVatNumber ?? null,
        vatValidatedAt: fullUser.vatValidatedAt ?? null,
        address,
        isCompany: fullUser.isCompany ?? false,
        legalName: fullUser.billingProfile?.companyLegalName ?? null,
        companyRegistrationNo: fullUser.billingProfile?.companyRegistrationNo ?? null,
        billingContactName: fullUser.billingProfile?.billingContactName ?? null,
        purchaseOrderReference: fullUser.billingProfile?.purchaseOrderReference ?? null,
      };
    } else {
      customer = {
        fullName: user.fullName,
        email: user.email,
        vatNumber: user.vatNumber ?? null,
        address: null,
        isCompany: false,
        legalName: null,
      };
    }
  } catch (err) {
    console.error("[staff-invoice] failed to build customer", err);
    customer = {
      fullName: user.fullName,
      email: user.email,
      vatNumber: user.vatNumber ?? null,
      address: null,
      isCompany: false,
      legalName: null,
    };
  }

  let invoice = null;
  try {
    invoice = await prisma.$transaction(async (tx) => {
      // Re-check inside transaction to avoid race
      const already = await tx.invoice.findUnique({ where: { contractId: contract.id } });
      if (already) return already;

      return issueInvoice(tx, {
        contractId: contract.id,
        source: "STAFF_CONTRACT",
        totalInclVat: amount,
        customer,
        lines: [
          {
            description: buildRentalDescription({
              startDate: contract.startDate,
              endDate: contract.endDate ?? null,
              rentalType,
            }),
            quantity: 1,
            unitPrice: amount,
          },
        ],
        dueDate,
      });
    });
  } catch (err) {
    // Unique constraint race — fetch existing
    if (err?.code === "P2002") {
      try {
        const existing = await prisma.invoice.findUnique({ where: { contractId: contract.id }, include: { lines: true } });
        if (existing) {
          console.log(`[staff-invoice] concurrent creation, reusing ${existing.number}`);
          return { invoice: existing, emailed: false };
        }
      } catch {}
    }
    console.error("[staff-invoice] issueInvoice failed", err);
    return { invoice: null, emailed: false, error: err.message ?? "Erreur lors de la création de la facture" };
  }

  // Send email with PDF — must not roll back staff/contract if it fails
  try {
    const pdf = await renderInvoicePdf(invoice);
    const dueDateStr = dueDate.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" });
    const result = await sendEmail({
      to: customer.email,
      subject: `Votre facture ${invoice.number} — Meri Beauty`,
      text:
        `Bonjour ${customer.fullName},\n\n` +
        `Votre facture ${invoice.number} d'un montant de ${Number(invoice.totalInclVat).toFixed(2)} € a été émise.\n` +
        `Échéance : ${dueDateStr} (7 jours après le début de votre contrat le ${startDate.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}).\n\n` +
        `Vous la trouverez en pièce jointe.\n\nL'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${customer.fullName},</p>` +
        `<p>Votre facture <strong>${invoice.number}</strong> d'un montant de <strong>${Number(invoice.totalInclVat).toFixed(2)} €</strong> a été émise.</p>` +
        `<p>Échéance : <strong>${dueDateStr}</strong> (7 jours après le début de votre contrat le ${startDate.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}).</p>` +
        `<p>Vous la trouverez en pièce jointe.</p>` +
        `<p>L'équipe Meri Beauty</p>`,
      attachments: [{ filename: `facture-${invoice.number}.pdf`, content: pdf }],
    });

    if (result && result.success === false) {
      console.error("[staff-invoice] sendEmail returned failure", result.error);
      return { invoice, emailed: false, error: result.error ?? "Échec de l'envoi de l'e-mail" };
    }

    return { invoice, emailed: true };
  } catch (err) {
    console.error("[staff-invoice] sendEmail threw", err);
    return { invoice, emailed: false, error: err.message ?? "Échec de l'envoi de l'e-mail" };
  }
}
