/**
 * Anniversary-based automatic monthly invoicing engine for staff members.
 *
 * Instead of calendar-month-based billing (1st of each month), each staff member's
 * invoices are generated on their contract anniversary date.
 *
 * Example:
 *   - Staff starts on 20/09/2026 → invoiced on 20/09, 20/10, 20/11, etc.
 *   - Staff starts on 31/01/2026 → invoiced on 31/01, 28/02 (month-end), 31/03, etc.
 *
 * Entry point: sendDailyStaffInvoices()
 *   Called daily, checks each staff's nextInvoiceDate against today.
 *   If nextInvoiceDate <= today, generates and sends invoice, then advances nextInvoiceDate.
 *
 * Workflow per staff member:
 *   1. Load all active staff with FIXED_RENT contracts
 *   2. Check if today >= staff.nextInvoiceDate (or contract.nextInvoiceDate if multiple)
 *   3. Validate staff & contract eligibility
 *   4. Create StaffMonthlyInvoice row (with billingYear/billingMonth for dedup)
 *   5. Issue invoice via issueInvoice() with source STAFF_CONTRACT
 *   6. Send email outside transaction
 *   7. Calculate and save nextInvoiceDate (or set to NULL if contract ended)
 */

import { prisma } from "@/lib/prisma";
import { issueInvoice, buildRentalDescription } from "@/lib/invoicing";
import { formatUserAddress } from "@/lib/format-address";
import { sendEmail } from "@/lib/email";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { captureCriticalError } from "@/lib/monitoring";
import { invoiceEmail } from "@/lib/email-templates";
import { calculateVatTotals, BELGIUM_VAT_RATE } from "@/lib/tax-policy";

// ─── TIMEZONE & DATE HELPERS ──────────────────────────────────────────────────

/**
 * Returns today's date in Europe/Brussels timezone.
 * { year: 2026, month: 9, day: 10 }
 */
export function todayInBrussels() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = fmt.formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === "year").value),
    month: Number(parts.find((p) => p.type === "month").value),
    day: Number(parts.find((p) => p.type === "day").value),
  };
}

/**
 * Normalizes a date to midnight UTC on its calendar date (as seen in Brussels).
 * Used to compare nextInvoiceDate (stored as UTC DateTime) as a calendar date,
 * not a timestamp. E.g. 2026-09-10T14:30:00Z → 2026-09-10T00:00:00Z.
 */
function toUtcDateOnly(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

/**
 * Calculate the next anniversary invoice date based on a start date.
 *
 * If the billing day (e.g., 31st) doesn't exist in the target month,
 * use the last day of that month (month-end handling).
 *
 * @param {Date} startDate - The contract/billing start date
 * @param {Date} fromDate - Calculate next anniversary from this date
 * @param {Date|null} contractEndDate - If set, don't return date after contract ends
 * @returns {Date|null} - Next invoice date, or null if past contract end
 */
export function calculateNextAnniversaryDate(startDate, fromDate = new Date(), contractEndDate = null) {
  const billingDay = startDate.getUTCDate(); // Day of month (1-31)
  
  // Start with the first day of next month (UTC)
  const year = fromDate.getUTCFullYear();
  const month = fromDate.getUTCMonth(); // 0-11
  
  // Next month
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }
  
  // Get the max day in that month
  const lastDayOfNextMonth = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  
  // Use the minimum of billingDay and last day
  const dayToUse = Math.min(billingDay, lastDayOfNextMonth);
  
  // Create the date at UTC
  const nextDate = new Date(Date.UTC(nextYear, nextMonth, dayToUse, 0, 0, 0));
  
  // If contract has endDate and next_date would be after it, return null
  if (contractEndDate && nextDate > new Date(contractEndDate)) {
    return null;
  }
  
  return nextDate;
}

/**
 * Extract year/month from a date for use in StaffMonthlyInvoice dedup constraint.
 * Since billing is now anniversary-based, we still use calendar year/month for dedup,
 * but calculated from the nextInvoiceDate.
 */
function extractBillingPeriod(date) {
  const d = new Date(date);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1, // 1-12
  };
}

/**
 * First and last instant (inclusive) of the calendar month for a given date,
 * returned in UTC so Prisma date comparisons work correctly.
 *
 * Used for contract date range validation and invoice line descriptions.
 */
function brusselsMonthBounds(year, month) {
  // Midnight Brussels on the 1st of the month
  const approxFirstUtc = new Date(Date.UTC(year, month - 1, 1));
  const firstDayOffset = getBrusselsOffsetMs(approxFirstUtc);
  const firstDay = new Date(approxFirstUtc.getTime() - firstDayOffset);

  // Midnight Brussels on the 1st of the NEXT month (= exclusive upper bound)
  const approxNextUtc = new Date(Date.UTC(year, month, 1));
  const nextOffset = getBrusselsOffsetMs(approxNextUtc);
  const nextMonthFirstDay = new Date(approxNextUtc.getTime() - nextOffset);

  // lastDay = 1ms before the next month starts (inclusive end)
  const lastDay = new Date(nextMonthFirstDay.getTime() - 1);

  return { firstDay, lastDay };
}

/**
 * Get the UTC offset for a given UTC date in Brussels timezone (handles DST).
 */
function getBrusselsOffsetMs(utcDate) {
  const local = new Date(
    utcDate.toLocaleString("en-US", { timeZone: "Europe/Brussels" })
  );
  return local.getTime() - utcDate.getTime();
}

/** Month name in French for email copy and invoice descriptions. */
function frenchMonthName(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

/**
 * Parses Contract.dueDate (a string like "7" meaning "7 days after
 * billing-period start") and returns a Date.
 * Falls back to 7 days after the first of the billing month.
 */
function resolveDueDate(contractDueDateStr, billingMonthFirstDay) {
  if (contractDueDateStr != null && String(contractDueDateStr).trim() !== "") {
    const n = Number(String(contractDueDateStr).trim());
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 365) {
      const d = new Date(billingMonthFirstDay);
      d.setDate(d.getDate() + n);
      return d;
    }
  }
  // Default: 7 days after billing period start
  const d = new Date(billingMonthFirstDay);
  d.setDate(d.getDate() + 7);
  return d;
}

/**
 * Builds the customer object that issueInvoice() expects.
 */
async function buildStaffCustomer(staff, user) {
  let fullUser = user;
  try {
    const db = await prisma.user.findUnique({
      where: { id: user.id },
      include: { billingProfile: true },
    });
    if (db) fullUser = db;
  } catch {
    // Non-fatal — proceed with whatever we have
  }

  const address = formatUserAddress(fullUser) || fullUser?.vatValidationAddress || null;

  return {
    fullName: fullUser.fullName,
    email: fullUser.email,
    vatNumber: fullUser.vatNumber ?? staff.vatNumber ?? null,
    vatValidatedAt: fullUser.vatValidatedAt ?? null,
    address,
    isCompany: fullUser.isCompany ?? false,
    legalName: fullUser.billingProfile?.companyLegalName ?? null,
    companyRegistrationNo: fullUser.billingProfile?.companyRegistrationNo ?? null,
    billingContactName: fullUser.billingProfile?.billingContactName ?? null,
    purchaseOrderReference: fullUser.billingProfile?.purchaseOrderReference ?? null,
  };
}

// ─── PER-STAFF BILLING ─────────────────────────────────────────────────────────

/**
 * Bills a single staff member for a specific contract based on their anniversary date.
 *
 * @param {object} staff - The staff record with user and contracts
 * @param {object} contract - The specific contract to bill (must be eligible)
 * @param {Date} billingDate - The contract's nextInvoiceDate (used for billing period + dedup)
 * @returns {{ staffId, status, invoiceNumber?, emailed?, emailError?, skippedReason?, error? }}
 */
async function billStaffMember(staff, contract, billingDate) {
  const tag = `[monthly-billing] staff=${staff.id} contract=${contract.id} billingDate=${billingDate.toISOString().split("T")[0]}`;

  // ── 1. Staff eligibility ───────────────────────────────────────────────────
  if (!staff.user?.isActive || staff.user?.isDeleted) {
    console.log(`${tag} skip: staff user inactive or deleted`);
    await upsertSkipped(staff.id, billingDate, null, "Staff inactif ou supprimé");
    return { staffId: staff.id, status: "SKIPPED", skippedReason: "Staff inactif ou supprimé" };
  }

  if (!staff.isActive || staff.isDeleted) {
    console.log(`${tag} skip: staff record inactive or deleted`);
    await upsertSkipped(staff.id, billingDate, null, "Fiche staff inactive ou supprimée");
    return { staffId: staff.id, status: "SKIPPED", skippedReason: "Fiche staff inactive ou supprimée" };
  }

  // ── 2. Contract eligibility ────────────────────────────────────────────────
  if (contract.type !== "FIXED_RENT" || contract.status === "TERMINATED") {
    console.log(`${tag} skip: contract not eligible (type=${contract.type}, status=${contract.status})`);
    await upsertSkipped(staff.id, billingDate, contract.id, "Contrat non éligible");
    return { staffId: staff.id, status: "SKIPPED", skippedReason: "Contrat non éligible" };
  }

  if (!contract.fixedRent || Number(contract.fixedRent) <= 0) {
    console.log(`${tag} skip: fixedRent <= 0`);
    await upsertSkipped(staff.id, billingDate, contract.id, "Loyer fixe invalide");
    return { staffId: staff.id, status: "SKIPPED", skippedReason: "Loyer fixe invalide" };
  }

  const { year: billingYear, month: billingMonth } = extractBillingPeriod(billingDate);
  const { firstDay, lastDay } = brusselsMonthBounds(billingYear, billingMonth);

  // ── 3. Dedup check — is there already an invoice for this billing period? ───
  const existing = await prisma.staffMonthlyInvoice.findUnique({
    where: {
      staffId_billingYear_billingMonth: {
        staffId: staff.id,
        billingYear,
        billingMonth,
      },
    },
    include: { invoice: true },
  });

  if (existing && existing.status !== "PENDING" && existing.status !== "ERROR") {
    console.log(`${tag} already billed — status=${existing.status}, skipping`);
    return {
      staffId: staff.id,
      status: existing.status,
      invoiceNumber: existing.invoice?.number ?? null,
      skippedReason: "Facture déjà générée pour ce mois",
    };
  }

  // ── 4. Build invoice data ──────────────────────────────────────────────────
  const amount = Number(contract.fixedRent);
  const dueDate = resolveDueDate(contract.dueDate, firstDay);
  const monthLabel = frenchMonthName(billingYear, billingMonth);

  let customer;
  try {
    customer = await buildStaffCustomer(staff, staff.user);
  } catch (err) {
    const msg = `Impossible de construire le profil client : ${err.message}`;
    console.error(`${tag} ${msg}`, err);
    await upsertError(staff.id, billingDate, contract.id, msg);
    return { staffId: staff.id, status: "ERROR", error: msg };
  }

  // ── 5. Issue invoice + create StaffMonthlyInvoice atomically ──────────────
  let monthlyRow;
  let invoice;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.staffMonthlyInvoice.create({
        data: {
          staffId: staff.id,
          billingYear,
          billingMonth,
          contractId: contract.id,
          status: "PENDING",
        },
      });

      const inv = await issueInvoice(tx, {
        monthlyInvoiceId: row.id,
        source: "STAFF_CONTRACT",
        totalInclVat: amount,
        customer,
        lines: [
          {
            description: buildRentalDescription({
              startDate: firstDay,
              endDate: lastDay,
              rentalType: contract.rentalRequest?.rentalType ?? null,
            }),
            quantity: 1,
            unitPrice: amount,
          },
        ],
        dueDate,
      });

      const updated = await tx.staffMonthlyInvoice.update({
        where: { id: row.id },
        data: {
          invoiceId: inv.id,
          status: "GENERATED",
        },
      });

      return { row: updated, invoice: inv };
    }, { timeout: 30_000 });

    monthlyRow = result.row;
    invoice = result.invoice;
  } catch (err) {
    if (err?.code === "P2002") {
      console.log(`${tag} concurrent run beat us — skipping`);
      return { staffId: staff.id, status: "SKIPPED", skippedReason: "Créé par une exécution concurrente" };
    }

    const msg = err?.userMessage ?? err?.message ?? "Erreur lors de la création de la facture";
    console.error(`${tag} transaction failed`, err);
    captureCriticalError(err, { area: "monthly-billing", staffId: staff.id, billingYear, billingMonth });
    await upsertError(staff.id, billingDate, contract.id, msg);
    return { staffId: staff.id, status: "ERROR", error: msg };
  }

  // ── 6. Send invoice by email (outside transaction) ─────────────────────────
  try {
    const pdf = await renderInvoicePdf(invoice);

    const invoiceWithLines = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: { lines: true },
    });

    const invData = invoiceWithLines ?? invoice;
    const vatRate = Number(invData.vatRate ?? BELGIUM_VAT_RATE);
    const subtotalExclVat = Number(invData.subtotalExclVat ?? 0);
    const vatAmount = Number(invData.vatAmount ?? 0);
    const totalInclVat = Number(invData.totalInclVat ?? 0);

    const { subject, text, html } = invoiceEmail({
      customerName: customer.fullName,
      invoiceNumber: invoice.number,
      issuedAt: invoice.issuedAt ?? new Date(),
      dueDate: dueDate ?? null,
      lines: (invoiceWithLines?.lines ?? []).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: Number(l.unitPriceExclVat ?? l.unitPrice),
        lineTotal: Number(l.lineTotalExclVat ?? l.lineTotal),
      })),
      subtotalExclVat,
      vatRate,
      vatAmount,
      totalInclVat,
    });

    const emailResult = await sendEmail({
      to: customer.email,
      subject,
      text,
      html,
      attachments: [{ filename: `facture-${invoice.number}.pdf`, content: pdf }],
    });

    if (emailResult?.success === false) {
      const emailErr = emailResult.error ?? "Échec de l'envoi de l'e-mail";
      console.error(`${tag} email failed`, emailErr);
      await prisma.staffMonthlyInvoice.update({
        where: { id: monthlyRow.id },
        data: { status: "EMAIL_FAILED", emailError: emailErr },
      });
      // NOTE: Do NOT advance nextInvoiceDate on email failure
      return { staffId: staff.id, status: "EMAIL_FAILED", invoiceNumber: invoice.number, emailError: emailErr };
    }

    // Confirmed sent — update invoice and advance nextInvoiceDate
    const now = new Date();
    
    // Calculate next invoice date
    const nextDate = calculateNextAnniversaryDate(
      new Date(contract.startDate),
      billingDate,
      contract.endDate ? new Date(contract.endDate) : null
    );

    await prisma.$transaction([
      prisma.staffMonthlyInvoice.update({
        where: { id: monthlyRow.id },
        data: { status: "SENT", emailSentAt: now, emailError: null },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { emailSentAt: now },
      }),
      // Update contract.nextInvoiceDate
      prisma.contract.update({
        where: { id: contract.id },
        data: { nextInvoiceDate: nextDate },
      }),
      // Update staff.nextInvoiceDate to earliest of all active contracts
      prisma.staff.update({
        where: { id: staff.id },
        data: {
          nextInvoiceDate: nextDate,
        },
      }),
    ]);

    console.log(`${tag} ✓ invoice=${invoice.number} sent to ${customer.email}, nextInvoiceDate=${nextDate?.toISOString().split("T")[0] ?? "NULL"}`);
    return { staffId: staff.id, status: "SENT", invoiceNumber: invoice.number, emailed: true };
  } catch (err) {
    const emailErr = err?.message ?? "Échec de l'envoi de l'e-mail";
    console.error(`${tag} email threw`, err);
    await prisma.staffMonthlyInvoice.update({
      where: { id: monthlyRow.id },
      data: { status: "EMAIL_FAILED", emailError: emailErr },
    }).catch(() => {}); // best-effort
    // NOTE: Do NOT advance nextInvoiceDate on email failure
    return { staffId: staff.id, status: "EMAIL_FAILED", invoiceNumber: invoice.number, emailError: emailErr };
  }
}

// ─── UPSERT HELPERS ────────────────────────────────────────────────────────────

async function upsertSkipped(staffId, billingDate, contractId, reason) {
  const { year: billingYear, month: billingMonth } = extractBillingPeriod(billingDate);
  try {
    await prisma.staffMonthlyInvoice.upsert({
      where: { staffId_billingYear_billingMonth: { staffId, billingYear, billingMonth } },
      create: { staffId, billingYear, billingMonth, contractId, status: "SKIPPED", emailError: reason },
      update: { status: "SKIPPED", emailError: reason },
    });
  } catch (err) {
    console.warn("[monthly-billing] upsertSkipped failed (non-fatal)", err?.message);
  }
}

async function upsertError(staffId, billingDate, contractId, msg) {
  const { year: billingYear, month: billingMonth } = extractBillingPeriod(billingDate);
  try {
    await prisma.staffMonthlyInvoice.upsert({
      where: { staffId_billingYear_billingMonth: { staffId, billingYear, billingMonth } },
      create: { staffId, billingYear, billingMonth, contractId, status: "ERROR", emailError: msg },
      update: { status: "ERROR", emailError: msg },
    });
  } catch (err) {
    console.warn("[monthly-billing] upsertError failed (non-fatal)", err?.message);
  }
}

// ─── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

/**
 * Daily billing check: find all staff whose nextInvoiceDate <= today and process them.
 * Called once per day by the background job scheduler.
 *
 * Before billing, initializes any eligible staff/contracts with null nextInvoiceDate
 * by calculating startDate + 1 month. No invoice is created during initialization.
 *
 * @returns {{
 *   billingDate: Date,
 *   processed: number,
 *   sent: number,
 *   skipped: number,
 *   emailFailed: number,
 *   errors: number,
 *   initialized: number,
 *   results: Array,
 * }}
 */
export async function sendDailyStaffInvoices() {
  const today = todayInBrussels();
  const todayDate = toUtcDateOnly(new Date(Date.UTC(today.year, today.month - 1, today.day)));
  const tomorrowDate = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000);

  console.log(`[monthly-billing] starting daily check for ${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`);

  // ── Phase 1: Initialize null nextInvoiceDate for eligible staff/contracts ──
  const uninitializedContracts = await prisma.contract.findMany({
    where: {
      type: "FIXED_RENT",
      status: { not: "TERMINATED" },
      fixedRent: { gt: 0 },
      nextInvoiceDate: null,
      staff: {
        isActive: true,
        isDeleted: false,
      },
    },
    select: { id: true, staffId: true, startDate: true, endDate: true },
  });

  let initialized = 0;
  for (const c of uninitializedContracts) {
    const nextDate = calculateNextAnniversaryDate(
      new Date(c.startDate),
      new Date(c.startDate),
      c.endDate ? new Date(c.endDate) : null
    );
    try {
      await prisma.$transaction([
        prisma.contract.update({
          where: { id: c.id },
          data: { nextInvoiceDate: nextDate },
        }),
        prisma.staff.update({
          where: { id: c.staffId },
          data: { nextInvoiceDate: nextDate },
        }),
      ]);
      initialized++;
    } catch (err) {
      console.error(`[monthly-billing] failed to initialize nextInvoiceDate for contract ${c.id}`, err);
    }
  }
  if (initialized > 0) {
    console.log(`[monthly-billing] initialized ${initialized} contract(s) with null nextInvoiceDate`);
  }

  // ── Phase 2: Load staff with due contracts ─────────────────────────────────
  // Use a date range [todayDate, tomorrowDate) to match nextInvoiceDate as a
  // calendar date, not a timestamp. E.g. nextInvoiceDate=2026-09-10T00:00:00Z
  // or 2026-09-10T14:30:00Z both fall within [2026-09-10, 2026-09-11).
  const allStaff = await prisma.staff.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      contracts: {
        some: {
          type: "FIXED_RENT",
          status: { not: "TERMINATED" },
          fixedRent: { gt: 0 },
          nextInvoiceDate: { gte: todayDate, lt: tomorrowDate },
        },
      },
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          isActive: true,
          isDeleted: true,
          isCompany: true,
          vatNumber: true,
          vatValidatedAt: true,
          vatValidationAddress: true,
          vatValidationName: true,
          addressLine1: true,
          addressLine2: true,
          addressCity: true,
          addressPostalCode: true,
          addressCountry: true,
        },
      },
      contracts: {
        where: { type: "FIXED_RENT" },
        include: {
          rentalRequest: { select: { rentalType: true } },
        },
      },
    },
  });

  console.log(`[monthly-billing] found ${allStaff.length} staff with billing dates due today`);

  // ── Phase 3: Collect all due (staff, contract) pairs ───────────────────────
  const duePairs = [];
  for (const staff of allStaff) {
    for (const contract of staff.contracts) {
      if (!contract.nextInvoiceDate) continue;
      // Normalize nextInvoiceDate to date-only for calendar-date comparison
      const contractDate = toUtcDateOnly(contract.nextInvoiceDate);
      if (contractDate.getTime() <= todayDate.getTime()) {
        duePairs.push({ staff, contract, billingDate: contract.nextInvoiceDate });
      }
    }
  }

  console.log(`[monthly-billing] ${duePairs.length} contract(s) due for billing`);

  // ── Phase 4: Process each due contract ─────────────────────────────────────
  const settled = await Promise.allSettled(
    duePairs.map(({ staff, contract, billingDate }) =>
      billStaffMember(staff, contract, billingDate)
    )
  );

  const results = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") return outcome.value;
    const staffId = duePairs[i].staff.id;
    const msg = outcome.reason?.message ?? "Erreur inattendue";
    captureCriticalError(outcome.reason, { area: "monthly-billing", staffId });
    return { staffId, status: "ERROR", error: msg };
  });

  const summary = {
    billingDate: todayDate,
    processed: results.length,
    sent: results.filter((r) => r.status === "SENT").length,
    skipped: results.filter((r) => r.status === "SKIPPED").length,
    emailFailed: results.filter((r) => r.status === "EMAIL_FAILED").length,
    errors: results.filter((r) => r.status === "ERROR").length,
    initialized,
    results,
  };

  console.log(
    `[monthly-billing] done — processed=${summary.processed} sent=${summary.sent} ` +
    `skipped=${summary.skipped} emailFailed=${summary.emailFailed} errors=${summary.errors} initialized=${summary.initialized}`
  );

  return summary;
}

/**
 * Resends the invoice email for a given StaffMonthlyInvoice row.
 * Only allowed when status is EMAIL_FAILED. Does NOT regenerate invoice.
 * Does NOT advance nextInvoiceDate (already recorded, just retry send).
 *
 * @param {string} monthlyInvoiceId
 * @returns {{ success: boolean, error?: string }}
 */
export async function resendMonthlyInvoiceEmail(monthlyInvoiceId) {
  const row = await prisma.staffMonthlyInvoice.findUnique({
    where: { id: monthlyInvoiceId },
    include: {
      invoice: { include: { lines: true } },
      staff: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              isCompany: true,
              vatNumber: true,
              vatValidatedAt: true,
              vatValidationAddress: true,
              addressLine1: true,
              addressLine2: true,
              addressCity: true,
              addressPostalCode: true,
              addressCountry: true,
              billingProfile: true,
            },
          },
        },
      },
    },
  });

  if (!row) return { success: false, error: "Ligne de facturation introuvable" };
  if (!row.invoice) return { success: false, error: "Facture introuvable" };
  if (row.status === "SENT") return { success: false, error: "La facture a déjà été envoyée avec succès" };
  if (row.status === "SKIPPED") return { success: false, error: "Cette facture a été ignorée (staff inéligible)" };

  const invoice = row.invoice;
  const monthLabel = frenchMonthName(row.billingYear, row.billingMonth);

  try {
    const pdf = await renderInvoicePdf(invoice);

    const vatRate = Number(invoice.vatRate ?? BELGIUM_VAT_RATE);
    const subtotalExclVat = Number(invoice.subtotalExclVat ?? 0);
    const vatAmount = Number(invoice.vatAmount ?? 0);
    const totalInclVat = Number(invoice.totalInclVat ?? 0);

    const { subject, text, html } = invoiceEmail({
      customerName: invoice.customerName,
      invoiceNumber: invoice.number,
      issuedAt: invoice.issuedAt ?? new Date(),
      dueDate: invoice.dueDate ?? null,
      lines: (invoice.lines ?? []).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: Number(l.unitPriceExclVat ?? l.unitPrice),
        lineTotal: Number(l.lineTotalExclVat ?? l.lineTotal),
      })),
      subtotalExclVat,
      vatRate,
      vatAmount,
      totalInclVat,
    });

    const emailResult = await sendEmail({
      to: invoice.customerEmail,
      subject,
      text,
      html,
      attachments: [{ filename: `facture-${invoice.number}.pdf`, content: pdf }],
    });

    if (emailResult?.success === false) {
      const emailErr = emailResult.error ?? "Échec de l'envoi de l'e-mail";
      await prisma.staffMonthlyInvoice.update({
        where: { id: row.id },
        data: { status: "EMAIL_FAILED", emailError: emailErr },
      });
      return { success: false, error: emailErr };
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.staffMonthlyInvoice.update({
        where: { id: row.id },
        data: { status: "SENT", emailSentAt: now, emailError: null },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { emailSentAt: now },
      }),
    ]);

    return { success: true };
  } catch (err) {
    const msg = err?.message ?? "Erreur inattendue lors de l'envoi";
    await prisma.staffMonthlyInvoice.update({
      where: { id: row.id },
      data: { status: "EMAIL_FAILED", emailError: msg },
    }).catch(() => {});
    return { success: false, error: msg };
  }
}
